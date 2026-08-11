#!/usr/bin/env python3
"""
支出先の法人番号品質分析（houjin.db 突合）。

支出先インデックス再設計 Phase 2 の恒常化スクリプト。
data/result/houjin_quality/ にアドホックに存在した分類CSVを、いつでも再生成できるようにする。
RS支出データ（5-1）と国税庁法人番号DB（data/houjin.db）を突合し、名寄せ・補完の材料を出力する。

使い方:
  python3 scripts/analyze-houjin-quality.py [--year YEAR]
  デフォルト: --year 2024

入力:
  data/year_{YEAR}/5-1_RS_{YEAR}_支出先_支出情報.csv  (UTF-8)
  data/houjin.db  (SQLite: houjin(corporate_number PK, name, type_code, prefecture, ...))

出力（data/result は .gitignore 対象＝ローカル成果物）:
  data/result/houjin_quality/{YEAR}/01_invalid_cn_format.csv     法人番号の形式不正
  data/result/houjin_quality/{YEAR}/02_multi_cn_per_name.csv     同名に複数法人番号（誤記載/別実体）
  data/result/houjin_quality/{YEAR}/03_multi_name_per_cn.csv     1法人番号に複数名（表記揺れ）
  data/result/houjin_quality/{YEAR}/04_name_diff_with_houjin.csv RS名とhoujin公式名の食い違い
  data/result/houjin_quality/{YEAR}/06_cn_supplement_candidates.csv 番号欠落だが名称一致で補完候補

05_type_code_mismatch は再生成しない:
  現行 data/houjin.db の type_code は2桁コードで、NTA法人種別（3桁: 101/201/301…）を
  信頼的に表現していない（例: 国土交通省・大阪府・岐阜県がいずれも '01'）。
  アーカイブ版05が用いた3桁NTAコードは現DBから復元できないため、忠実再生成は不可。
  法人種別の突合を行う場合は3桁NTAコードを持つ法人番号DBの再構築が前提（Phase 3の宿題）。

法人番号の有効判定は app/lib/recipient-key.ts の isValidCorporateNumber と同一方針
（13桁数字・全桁同一のダミーを除外・チェックディジット検証）。チェックディジット不一致の番号は
形式不正として 01_invalid_cn_format.csv に分類される。
"""

import argparse
import csv
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(description='支出先の法人番号品質分析（houjin.db 突合）')
parser.add_argument('--year', type=int, default=2024, help='対象年度 (例: 2025, デフォルト: 2024)')
args = parser.parse_args()
YEAR = args.year

SPEND_CSV = REPO_ROOT / 'data' / f'year_{YEAR}' / f'5-1_RS_{YEAR}_支出先_支出情報.csv'
HOUJIN_DB = REPO_ROOT / 'data' / 'houjin.db'
OUT_DIR = REPO_ROOT / 'data' / 'result' / 'houjin_quality' / str(YEAR)

for p in (SPEND_CSV, HOUJIN_DB):
    if not p.exists():
        print(f'ERROR: 入力が見つかりません: {p}', file=sys.stderr)
        sys.exit(1)
OUT_DIR.mkdir(parents=True, exist_ok=True)


def has_valid_check_digit(cn: str) -> bool:
    """法人番号のチェックディジット検証。recipient-key.ts の hasValidCheckDigit と同一。
    検査用数字 = 9 −（Σ[n=1..12] Pn×Qn mod 9）, Pn=基礎番号の下n桁目, Qn=奇数1/偶数2。"""
    base = cn[1:]
    s = sum(int(base[12 - n]) * (1 if n % 2 == 1 else 2) for n in range(1, 13))
    return 9 - (s % 9) == int(cn[0])


def is_valid_corporate_number(cn: str) -> bool:
    """13桁数字・全桁同一でない・チェックディジット整合。recipient-key.ts と同一方針。"""
    cn = cn.strip()
    if len(cn) != 13 or not cn.isdigit():
        return False
    if cn == cn[0] * 13:  # 全桁同一のダミー（9999999999999 等）
        return False
    return has_valid_check_digit(cn)


def is_dummy_cn(cn: str) -> bool:
    """全桁同一の13桁（9999999999999 等）。個人・非公表・共同企業体等の
    「法人番号なし」プレースホルダであり、形式不正の誤記載とは区別する
    （2025データは欠落の代わりにこの値を多用する）。"""
    cn = cn.strip()
    return len(cn) == 13 and cn.isdigit() and cn == cn[0] * 13


def to_int(s: str) -> int:
    s = (s or '').replace(',', '').strip()
    try:
        return int(s)
    except ValueError:
        return 0


EXCLUDED_NAMES = {'', 'その他', '其他'}  # 集約行は個社として扱わない（recipient-key と同方針）

# ── 1. RS支出データ集計 ──
print(f'[1/3] RS支出データ集計: {SPEND_CSV.name}')
name_amount = defaultdict(int)          # 支出先名 → 金額合計
name_cns = defaultdict(set)             # 支出先名 → {有効法人番号}
name_types = defaultdict(set)           # 支出先名 → {法人種別}
name_has_empty_cn = defaultdict(bool)   # 支出先名 → 空欄法人番号の行があるか
cn_amount = defaultdict(int)            # 有効法人番号 → 金額合計
cn_names = defaultdict(set)             # 有効法人番号 → {支出先名}
cn_types = defaultdict(set)             # 有効法人番号 → {法人種別}
# 形式不正行: (name, cn, type) → 金額合計
invalid_rows = defaultdict(int)

row_count = 0
with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        name = (r.get('支出先名') or '').strip()
        if name in EXCLUDED_NAMES:
            continue
        cn = (r.get('法人番号') or '').strip()
        typ = (r.get('法人種別') or '').strip()
        amt = to_int(r.get('金額', ''))
        row_count += 1

        name_amount[name] += amt
        if typ:
            name_types[name].add(typ)

        if not cn or is_dummy_cn(cn):
            # 欠落、または全桁同一ダミー（実質的に法人番号なし）
            name_has_empty_cn[name] = True
        elif is_valid_corporate_number(cn):
            name_cns[name].add(cn)
            cn_amount[cn] += amt
            cn_names[cn].add(name)
            if typ:
                cn_types[cn].add(typ)
        else:
            # 番号記入ありだが形式不正（誤記載）。ダミーは上で除外済み
            invalid_rows[(name, cn, typ)] += amt

print(f'  処理行数: {row_count:,} / 支出先名ユニーク: {len(name_amount):,} / 有効法人番号ユニーク: {len(cn_amount):,}')

# ── 2. houjin.db 突合（有効法人番号・欠落名を一括ルックアップ）──
print('[2/3] houjin.db 突合')
conn = sqlite3.connect(f'file:{HOUJIN_DB}?mode=ro', uri=True)
cur = conn.cursor()

# 有効法人番号 → (公式名, 都道府県)
cur.execute('CREATE TEMP TABLE q_cn(cn TEXT PRIMARY KEY)')
cur.executemany('INSERT OR IGNORE INTO q_cn(cn) VALUES(?)', [(cn,) for cn in cn_amount])
houjin_by_cn = {}
for cn, name, pref in cur.execute(
    'SELECT h.corporate_number, h.name, h.prefecture '
    'FROM houjin h JOIN q_cn ON h.corporate_number = q_cn.cn'
):
    houjin_by_cn[cn] = (name or '', pref or '')

# 欠落名 → houjin候補（完全一致）。番号欠落の行を持つ名前のみ対象
empty_names = [n for n, has in name_has_empty_cn.items() if has]
cur.execute('CREATE TEMP TABLE q_name(name TEXT PRIMARY KEY)')
cur.executemany('INSERT OR IGNORE INTO q_name(name) VALUES(?)', [(n,) for n in empty_names])
houjin_by_name = defaultdict(list)  # RS名 → [(cn, pref), ...]
for name, cn, pref in cur.execute(
    'SELECT h.name, h.corporate_number, h.prefecture '
    'FROM houjin h JOIN q_name ON h.name = q_name.name'
):
    houjin_by_name[name].append((cn, pref or ''))

conn.close()
print(f'  houjin一致(番号): {len(houjin_by_cn):,} / houjin一致(欠落名): {len(houjin_by_name):,}')


def write_csv(fname, header, rows):
    path = OUT_DIR / fname
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f'  {fname}: {len(rows):,} 行')


# ── 3. 分類CSV出力 ──
print('[3/3] 分類CSV出力')

# 01: 法人番号の形式不正
rows01 = sorted(
    ([name, cn, typ, amt] for (name, cn, typ), amt in invalid_rows.items()),
    key=lambda x: -x[3]
)
write_csv('01_invalid_cn_format.csv', ['支出先名', '法人番号', '法人種別', '金額'], rows01)

# 02: 同名に複数法人番号（誤記載/別実体）
rows02 = []
for name, cns in name_cns.items():
    if len(cns) >= 2:
        tset = '|'.join(sorted(name_types[name]))
        for cn in sorted(cns):
            rows02.append([name, cn, tset, name_amount[name]])
rows02.sort(key=lambda x: (-x[3], x[0], x[1]))
write_csv('02_multi_cn_per_name.csv', ['支出先名', '法人番号', '法人種別セット', '合計金額'], rows02)

# 03: 1法人番号に複数名（表記揺れ）
rows03 = []
for cn, names in cn_names.items():
    if len(names) >= 2:
        tset = '|'.join(sorted(cn_types[cn]))
        for name in sorted(names):
            rows03.append([cn, name, tset, cn_amount[cn]])
rows03.sort(key=lambda x: (-x[3], x[0], x[1]))
write_csv('03_multi_name_per_cn.csv', ['法人番号', '支出先名', '法人種別セット', '合計金額'], rows03)

# 04: RS名とhoujin公式名の食い違い
rows04 = []
for cn, names in cn_names.items():
    if cn not in houjin_by_cn:
        continue
    official, pref = houjin_by_cn[cn]
    for name in sorted(names):
        if name != official:
            rows04.append([cn, name, official, pref, cn_amount[cn]])
rows04.sort(key=lambda x: (-x[4], x[0]))
write_csv('04_name_diff_with_houjin.csv',
          ['法人番号', 'RS支出先名', 'houjin公式名', '都道府県', 'RS合計金額'], rows04)

# 06: 番号欠落だが名称一致で補完候補
rows06 = []
for name in empty_names:
    hits = houjin_by_name.get(name)
    if not hits:
        continue
    cn, pref = hits[0]
    multi = 'TRUE' if len(hits) > 1 else 'FALSE'
    rs_type = '|'.join(sorted(name_types[name]))
    rows06.append([name, cn, pref, name_amount[name], rs_type, multi])
rows06.sort(key=lambda x: -x[3])
write_csv('06_cn_supplement_candidates.csv',
          ['支出先名', '補完法人番号', '都道府県', '合計金額', '現RS法人種別', '複数ヒット'], rows06)

print(f'\n完了: {OUT_DIR}')
print('  ※ 05_type_code_mismatch は現houjin.dbのtype_codeが2桁で信頼性が無いため再生成しない（docstring参照）')
