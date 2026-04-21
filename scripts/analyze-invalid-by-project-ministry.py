"""
問題あり支出先 × 事業名 / 府省庁 深掘り分析

入力:
  data/result/recipients_without_total.csv  - 元の支出レコード
  data/result/recipient_dictionary.csv      - valid/invalid 分類結果

実行:
  python3 scripts/analyze-invalid-by-project-ministry.py
"""

import csv
import re
import unicodedata
import collections
from pathlib import Path

REPO_ROOT   = Path(__file__).parent.parent
SRC_CSV     = REPO_ROOT / 'data' / 'result' / 'recipients_without_total.csv'
DICT_CSV    = REPO_ROOT / 'data' / 'result' / 'recipient_dictionary.csv'

TOP_N = 30   # 上位表示件数


def normalize(s: str) -> str:
    return unicodedata.normalize('NFKC', s)


def to_int(s: str) -> int:
    try:
        return int(s.replace(',', '').strip())
    except Exception:
        return 0


# ─── 問題あり分類（辞書スクリプトと同じロジック）───
COLLECTIVE_RE = [
    re.compile(r'ほか'), re.compile(r'など'), re.compile(r'^その他'),
    re.compile(r'[0-9]+社'), re.compile(r'[0-9]+者以降'), re.compile(r'[0-9]+件'),
    re.compile(r'\([0-9]+[^)]*[市町村都道府県機関][^)]*\)'),
    re.compile(r'[・、].+(?:法人|会社|機関|組合)'),
    re.compile(r'(?:法人|会社|機関|組合)[・、]'),
]
PROJECT_RE     = re.compile(r'事業$|プロジェクト$|計画$|プログラム$|基金$|補助金$|助成金$|給付金$|交付金$|支援金$|委託$')
PROJECT_NOT_RE = re.compile(r'法人|会社|組合|機構|独立行政|大学|学校')
KAKU_LIST      = ['株式会社', '有限会社', '合同会社', '一般社団法人', '公益社団法人',
                  '一般財団法人', '公益財団法人', '特定非営利活動法人', '独立行政法人',
                  '国立大学法人', '学校法人', '社会福祉法人', '医療法人']
ARBITRARY_RE   = re.compile(r'協会|連合会|連盟|協議会|委員会|センター|コンソーシアム|フォーラム|研究会|学会|振興会')
FOREIGN_RE     = re.compile(r'LLC|Ltd\.?|Inc\.?|Corp\.?|GmbH|B\.V\.|S\.A\.|PTE\.?|PLC|AG ')
ASCII_ONLY_RE  = re.compile(r'^[A-Za-z0-9\s\.\,\-\&\(\)\'\"\/\\\+\#\@\!\?\*\:\;]+$')


def get_invalid_reason(name: str, cn: str, ci: bool, nm: bool, nc: bool) -> str:
    norm = normalize(name)
    if any(p.search(name) for p in COLLECTIVE_RE):
        return '集合・複数表現'
    if re.match(r'^その他', name):
        return 'その他プレースホルダー'
    if ASCII_ONLY_RE.match(norm) and not re.search(r'[\u3040-\u9FFF]', norm):
        return '英字のみ'
    if FOREIGN_RE.search(name):
        return '外国法人疑い'
    if cn and ci and not nm and not nc:
        return '入力ミス・名称不一致'
    if PROJECT_RE.search(name) and not PROJECT_NOT_RE.search(name):
        return '事業・プログラム名'
    if not cn and not any(k in name for k in KAKU_LIST) and ARBITRARY_RE.search(name):
        return '任意団体・法人番号なし'
    if not cn and any(k in name for k in KAKU_LIST):
        return '法人格あり・CN未登録'
    return 'その他未分類'


# ─── データ読み込み ───

print('辞書読み込み中...')
dict_map: dict[str, dict] = {}  # name → row
with open(DICT_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        dict_map[r['name']] = r

print(f'  {len(dict_map):,}件')

print('元データ読み込み中...')
with open(SRC_CSV, encoding='utf-8') as f:
    src_rows = list(csv.DictReader(f))
print(f'  {len(src_rows):,}行')

# ─── 各行に valid/invalid/reason を付ける ───

# 集計用構造体
# project: {事業名 → {total, valid_cnt, invalid_cnt, invalid_amount, reasons_counter}}
# ministry: {府省庁 → {...}}
# ministry_bureau: {(府省庁, 局庁) → {...}}

def make_stat():
    return {'total_amount': 0, 'valid_cnt': 0, 'invalid_cnt': 0,
            'invalid_amount': 0, 'reasons': collections.Counter()}

project_stat:         dict[str, dict] = collections.defaultdict(make_stat)
ministry_stat:        dict[str, dict] = collections.defaultdict(make_stat)
ministry_bureau_stat: dict[tuple, dict] = collections.defaultdict(make_stat)
reason_stat:          dict[str, dict] = collections.defaultdict(make_stat)

# 事業名×理由クロス集計
project_reason_counter: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
ministry_reason_counter: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

for row in src_rows:
    name    = row['支出先名'].strip()
    amount  = to_int(row.get('支出先の合計支出額', '') or row.get('金額', ''))
    project = row.get('事業名', '').strip()
    ministry = row.get('府省庁', '').strip()
    bureau   = row.get('局・庁', '').strip()

    if not name:
        continue

    d = dict_map.get(name)
    if d is None:
        continue

    is_valid = d['valid'] == 'True'
    cn = d['corporate_number']
    ci = d['cn_in_db'] == 'True'
    nm = d['name_cn_match'] == 'True'
    nc = d['cn_name_contained'] == 'True'
    reason = get_invalid_reason(name, cn, ci, nm, nc) if not is_valid else 'valid'

    for stat_dict, key in [
        (project_stat, project),
        (ministry_stat, ministry),
        (ministry_bureau_stat, (ministry, bureau)),
    ]:
        s = stat_dict[key]
        s['total_amount'] += amount
        if is_valid:
            s['valid_cnt'] += 1
        else:
            s['invalid_cnt'] += 1
            s['invalid_amount'] += amount
            s['reasons'][reason] += 1

    if not is_valid:
        project_reason_counter[project][reason] += 1
        ministry_reason_counter[ministry][reason] += 1

    if not is_valid:
        s2 = reason_stat[reason]
        s2['invalid_cnt'] += 1
        s2['invalid_amount'] += amount


def pct(a, b): return f'{a/(b or 1)*100:.1f}%'
def fmt_m(n): return f'{n/1e8:.1f}億'


# ═══════════════════════════════════════════════════════════
# 1. 事業名別 invalid率（上位）
# ═══════════════════════════════════════════════════════════

print()
print('=' * 80)
print(f'  【事業名別】invalid率 上位{TOP_N}（invalid件数5件以上、金額降順）')
print('=' * 80)
print(f'{"事業名":<40} {"invalid":>7} {"invalid%":>8} {"invalid額":>10}  主な理由')
print('-' * 80)

proj_sorted = sorted(
    [(k, v) for k, v in project_stat.items()
     if v['invalid_cnt'] >= 5 and k],
    key=lambda x: x[1]['invalid_amount'], reverse=True
)
for proj, s in proj_sorted[:TOP_N]:
    total  = s['valid_cnt'] + s['invalid_cnt']
    top_r  = s['reasons'].most_common(2)
    r_str  = '  '.join(f'{r}({c})' for r, c in top_r)
    print(f'{proj[:38]:<40} {s["invalid_cnt"]:>7,}件  {pct(s["invalid_cnt"], total):>7}  {fmt_m(s["invalid_amount"]):>10}  {r_str}')

# ═══════════════════════════════════════════════════════════
# 2. 事業名別 invalid率（割合が高い上位）
# ═══════════════════════════════════════════════════════════

print()
print('=' * 80)
print(f'  【事業名別】invalid率が高い上位{TOP_N}（total件数5件以上、割合降順）')
print('=' * 80)
print(f'{"事業名":<40} {"total":>6} {"invalid%":>8}  主な理由')
print('-' * 80)

proj_by_pct = sorted(
    [(k, v) for k, v in project_stat.items()
     if (v['valid_cnt'] + v['invalid_cnt']) >= 5 and k],
    key=lambda x: x[1]['invalid_cnt'] / (x[1]['valid_cnt'] + x[1]['invalid_cnt']),
    reverse=True
)
for proj, s in proj_by_pct[:TOP_N]:
    total = s['valid_cnt'] + s['invalid_cnt']
    top_r = s['reasons'].most_common(2)
    r_str = '  '.join(f'{r}({c})' for r, c in top_r)
    print(f'{proj[:38]:<40} {total:>6,}件  {pct(s["invalid_cnt"], total):>7}  {r_str}')

# ═══════════════════════════════════════════════════════════
# 3. 府省庁別 invalid率
# ═══════════════════════════════════════════════════════════

print()
print('=' * 80)
print('  【府省庁別】invalid率（件数降順）')
print('=' * 80)
print(f'{"府省庁":<25} {"total":>7} {"valid":>7} {"invalid":>8} {"invalid%":>8} {"invalid額":>10}  主な理由')
print('-' * 80)

min_sorted = sorted(
    [(k, v) for k, v in ministry_stat.items() if k],
    key=lambda x: x[1]['invalid_cnt'], reverse=True
)
for ministry, s in min_sorted:
    total = s['valid_cnt'] + s['invalid_cnt']
    top_r = s['reasons'].most_common(2)
    r_str = '  '.join(f'{r}({c})' for r, c in top_r)
    print(f'{ministry[:23]:<25} {total:>7,}件  {s["valid_cnt"]:>6,}件  {s["invalid_cnt"]:>7,}件  {pct(s["invalid_cnt"], total):>7}  {fmt_m(s["invalid_amount"]):>10}  {r_str}')

# ═══════════════════════════════════════════════════════════
# 4. 府省庁×局庁 invalid件数上位
# ═══════════════════════════════════════════════════════════

print()
print('=' * 80)
print(f'  【府省庁×局庁】invalid件数 上位{TOP_N}')
print('=' * 80)
print(f'{"府省庁":<20} {"局・庁":<25} {"invalid":>8} {"invalid%":>8} {"invalid額":>10}  主な理由')
print('-' * 80)

mb_sorted = sorted(
    [(k, v) for k, v in ministry_bureau_stat.items()
     if k[0] and v['invalid_cnt'] >= 3],
    key=lambda x: x[1]['invalid_cnt'], reverse=True
)
for (ministry, bureau), s in mb_sorted[:TOP_N]:
    total = s['valid_cnt'] + s['invalid_cnt']
    top_r = s['reasons'].most_common(2)
    r_str = '  '.join(f'{r}({c})' for r, c in top_r)
    print(f'{ministry[:18]:<20} {bureau[:23]:<25} {s["invalid_cnt"]:>7,}件  {pct(s["invalid_cnt"], total):>7}  {fmt_m(s["invalid_amount"]):>10}  {r_str}')

# ═══════════════════════════════════════════════════════════
# 5. invalid理由別 事業名サンプル
# ═══════════════════════════════════════════════════════════

print()
print('=' * 80)
print('  【invalid理由別】 件数が多い事業名サンプル（各理由上位5事業）')
print('=' * 80)

all_reasons = ['集合・複数表現', '入力ミス・名称不一致', '英字のみ', '任意団体・法人番号なし',
               '法人格あり・CN未登録', 'その他プレースホルダー', '事業・プログラム名', '外国法人疑い']

for reason in all_reasons:
    proj_for_reason = sorted(
        [(p, c) for p, c in project_reason_counter.items() if c.get(reason, 0) > 0],
        key=lambda x: x[1][reason], reverse=True
    )[:5]
    if not proj_for_reason:
        continue
    print(f'\n--- {reason} ---')
    for proj, c in proj_for_reason:
        print(f'  {c[reason]:>4,}件  {proj[:60]}')
