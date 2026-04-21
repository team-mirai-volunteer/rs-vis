"""
法人番号・法人種別 データ品質調査スクリプト
出力: コンソールレポート + data/result/houjin_quality/ 以下に調査CSV

調査項目:
  1. 法人番号フォーマット異常（13桁以外・非数字）
  2. 同一支出先名で複数の法人番号（入力ミス疑い）
  3. 同一法人番号で複数の支出先名（表記ゆれ候補）
  4. houjin.db の公式名称との差異（表記ゆれ詳細）
  5. 法人種別コードと NTA 3桁コード（NTA CSV カラム[8]）の不整合
  6. 法人番号なしレコードで houjin.db 名称照合による補完候補

注意:
  NTA CSV カラム[2] = 更新区分（01=新規, 11=商号変更, 12=住所変更, 71=更正...）
  NTA CSV カラム[8] = 法人種別 3桁コード（RS CSV と同一体系）
  → build-houjin-sqlite.py はカラム[2] を type_code として保存しているが、
    これは法人種別ではなく更新区分であることに注意。
"""

import csv
import io
import os
import re
import sqlite3
import zipfile
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(SCRIPT_DIR)

RS_CSV    = os.path.join(REPO_ROOT, 'data/result/recipients_without_total.csv')
HOUJIN_DB = os.path.join(REPO_ROOT, 'data/houjin.db')
ZIP_PATH  = os.path.join(REPO_ROOT, 'data/download/houjin-bangou/00_zenkoku_all_20260130.zip')
OUT_DIR   = os.path.join(REPO_ROOT, 'data/result/houjin_quality')

os.makedirs(OUT_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────
# 1. RS CSV 読み込み
# ─────────────────────────────────────────────────────────

print('=== 法人番号・法人種別 データ品質調査 ===')
print(f'入力: {RS_CSV}')
print()

rows_all = []
with open(RS_CSV, encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows_all.append(row)

print(f'総レコード数: {len(rows_all):,}件')

# ユニーク支出先名ごとに集計
# name_info[name] = {'cn_set': set, 'type_set': set, 'amount': int, 'row_count': int}
name_info: dict[str, dict] = {}
# cn_info[cn] = {'name_set': set, 'type_set': set, 'amount': int}
cn_info: dict[str, dict] = {}

invalid_cn_rows  = []   # フォーマット異常
amount_by_name: dict[str, int] = defaultdict(int)

for row in rows_all:
    name    = row['支出先名'].strip()
    cn      = row['法人番号'].strip()
    ktype   = row['法人種別'].strip()
    try:
        amount = int(row['金額'].strip() or '0')
    except ValueError:
        amount = 0

    amount_by_name[name] += amount

    # 法人番号フォーマットチェック
    if cn:
        if not re.fullmatch(r'\d{13}', cn):
            invalid_cn_rows.append({'支出先名': name, '法人番号': cn, '法人種別': ktype, '金額': amount})

    # name_info
    if name not in name_info:
        name_info[name] = {'cn_set': set(), 'type_set': set(), 'amount': 0, 'row_count': 0}
    name_info[name]['row_count'] += 1
    name_info[name]['amount']    += amount
    if cn:
        name_info[name]['cn_set'].add(cn)
    if ktype:
        name_info[name]['type_set'].add(ktype)

    # cn_info
    if cn:
        if cn not in cn_info:
            cn_info[cn] = {'name_set': set(), 'type_set': set(), 'amount': 0}
        cn_info[cn]['name_set'].add(name)
        cn_info[cn]['amount']    += amount
        if ktype:
            cn_info[cn]['type_set'].add(ktype)

total_names = len(name_info)
print(f'ユニーク支出先名: {total_names:,}件')
print()

# ─────────────────────────────────────────────────────────
# 2. 法人番号フォーマット異常
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§1. 法人番号フォーマット異常（13桁以外・非数字）')
print('──────────────────────────────────────────')

if not invalid_cn_rows:
    print('  異常なし')
else:
    print(f'  異常件数: {len(invalid_cn_rows):,}件')
    uniq_invalid = {}
    for r in invalid_cn_rows:
        key = (r['支出先名'], r['法人番号'])
        if key not in uniq_invalid:
            uniq_invalid[key] = r
    print(f'  ユニーク（名称・番号）: {len(uniq_invalid):,}件')
    out_path = os.path.join(OUT_DIR, '01_invalid_cn_format.csv')
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['支出先名', '法人番号', '法人種別', '金額'])
        w.writeheader()
        w.writerows(sorted(uniq_invalid.values(), key=lambda r: -r['金額']))
    print(f'  → {out_path}')
    # 先頭5件表示
    for r in list(uniq_invalid.values())[:5]:
        print(f'    [{r["法人番号"]}] {r["支出先名"][:30]}  ({r["金額"]:,}円)')
print()

# ─────────────────────────────────────────────────────────
# 3. 同一支出先名で複数の法人番号（入力ミス疑い）
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§2. 同一支出先名で複数の法人番号（入力ミス疑い）')
print('──────────────────────────────────────────')

multi_cn = {name: info for name, info in name_info.items() if len(info['cn_set']) >= 2}
print(f'  該当ユニーク支出先名: {len(multi_cn):,}件')

out_rows_multi_cn = []
for name, info in sorted(multi_cn.items(), key=lambda x: -x[1]['amount']):
    for cn in sorted(info['cn_set']):
        out_rows_multi_cn.append({
            '支出先名': name,
            '法人番号': cn,
            '法人種別セット': '|'.join(sorted(info['type_set'])),
            '合計金額': info['amount'],
        })

if out_rows_multi_cn:
    out_path = os.path.join(OUT_DIR, '02_multi_cn_per_name.csv')
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['支出先名', '法人番号', '法人種別セット', '合計金額'])
        w.writeheader()
        w.writerows(out_rows_multi_cn)
    print(f'  → {out_path}')
    # 上位10件表示
    shown = set()
    count = 0
    for name, info in sorted(multi_cn.items(), key=lambda x: -x[1]['amount']):
        if count >= 10: break
        cns = sorted(info['cn_set'])
        print(f'    {name[:30]}: {cns}  ({info["amount"]:,}円)')
        count += 1
print()

# ─────────────────────────────────────────────────────────
# 4. 同一法人番号で複数の支出先名（表記ゆれ候補）
# ─────────────────────────────────────────հtml
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§3. 同一法人番号で複数の支出先名（表記ゆれ候補）')
print('──────────────────────────────────────────')

multi_name = {cn: info for cn, info in cn_info.items() if len(info['name_set']) >= 2}
print(f'  該当法人番号: {len(multi_name):,}件')

total_amount_multi_name = sum(info['amount'] for info in multi_name.values())
print(f'  合計金額: {total_amount_multi_name/1e12:.2f}兆円')

out_rows_multi_name = []
for cn, info in sorted(multi_name.items(), key=lambda x: -x[1]['amount']):
    for name in sorted(info['name_set']):
        out_rows_multi_name.append({
            '法人番号': cn,
            '支出先名': name,
            '法人種別セット': '|'.join(sorted(info['type_set'])),
            '合計金額': info['amount'],
        })

if out_rows_multi_name:
    out_path = os.path.join(OUT_DIR, '03_multi_name_per_cn.csv')
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['法人番号', '支出先名', '法人種別セット', '合計金額'])
        w.writeheader()
        w.writerows(out_rows_multi_name)
    print(f'  → {out_path}')
    # 上位10件表示（金額降順）
    count = 0
    for cn, info in sorted(multi_name.items(), key=lambda x: -x[1]['amount']):
        if count >= 10: break
        names = sorted(info['name_set'])
        print(f'    [{cn}] {names}')
        print(f'      → {info["amount"]/1e9:.1f}十億円')
        count += 1
print()

# ─────────────────────────────────────────────────────────
# 5. houjin.db 公式名称との差異（表記ゆれ詳細）
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§4. houjin.db 公式名称との差異（表記ゆれ詳細）')
print('──────────────────────────────────────────')

if not os.path.exists(HOUJIN_DB):
    print('  ⚠ houjin.db が見つかりません（スキップ）')
    houjin_name: dict[str, str] = {}
else:
    db  = sqlite3.connect(HOUJIN_DB)
    cur = db.cursor()

    # RS CSV に出現する全有効法人番号 → houjin.db から公式名称を一括取得
    valid_cns = [cn for cn in cn_info if re.fullmatch(r'\d{13}', cn)]
    print(f'  有効法人番号（13桁）: {len(valid_cns):,}件')

    # バッチで取得
    houjin_name: dict[str, str] = {}   # cn → 公式名称
    houjin_prefecture: dict[str, str] = {}  # cn → 都道府県
    BATCH = 500
    for i in range(0, len(valid_cns), BATCH):
        batch = valid_cns[i:i+BATCH]
        placeholders = ','.join('?' * len(batch))
        cur.execute(f'SELECT corporate_number, name, prefecture FROM houjin WHERE corporate_number IN ({placeholders})', batch)
        for cn_row in cur.fetchall():
            houjin_name[cn_row[0]]       = cn_row[1]
            houjin_prefecture[cn_row[0]] = cn_row[2]

    db.close()

    print(f'  houjin.db ヒット: {len(houjin_name):,}件 / {len(valid_cns):,}件')
    not_in_houjin = len(valid_cns) - len(houjin_name)
    print(f'  houjin.db 未登録（廃業・誤番号等）: {not_in_houjin:,}件')

    # 名称差異の検出
    name_diff_rows = []
    for cn, official_name in houjin_name.items():
        rs_names = cn_info[cn]['name_set']
        for rs_name in rs_names:
            if rs_name != official_name:
                name_diff_rows.append({
                    '法人番号':     cn,
                    'RS支出先名':   rs_name,
                    'houjin公式名': official_name,
                    '都道府県':     houjin_prefecture.get(cn, ''),
                    'RS合計金額':   cn_info[cn]['amount'],
                })

    print(f'  名称差異あり（表記ゆれ等）: {len(name_diff_rows):,}件')
    total_diff_amount = sum(r['RS合計金額'] for r in name_diff_rows)
    print(f'  差異金額（合計・重複含む）: {total_diff_amount/1e12:.2f}兆円')

    if name_diff_rows:
        out_path = os.path.join(OUT_DIR, '04_name_diff_with_houjin.csv')
        with open(out_path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['法人番号', 'RS支出先名', 'houjin公式名', '都道府県', 'RS合計金額'])
            w.writeheader()
            w.writerows(sorted(name_diff_rows, key=lambda r: -r['RS合計金額']))
        print(f'  → {out_path}')
        # 上位10件
        print('  [差異上位10件（金額降順）]')
        for r in sorted(name_diff_rows, key=lambda x: -x['RS合計金額'])[:10]:
            print(f'    [{r["法人番号"]}]')
            print(f'      RS  : {r["RS支出先名"]}')
            print(f'      公式: {r["houjin公式名"]}  ({r["RS合計金額"]/1e9:.1f}十億円)')
print()

# ─────────────────────────────────────────────────────────
# 6. 法人種別コードと NTA 3桁コード（NTA CSV カラム[8]）の照合
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§5. 法人種別コードと NTA 3桁コード（ZIP カラム[8]）の照合')
print('──────────────────────────────────────────')

# RS CSV 法人種別コード体系
# houjin.db type_code は更新区分（01=新規, 11=商号変更, 12=住所変更...）であり法人種別ではない
# NTA 3桁コードは NTA CSV カラム[8] に存在
# カラム[8] は RS CSV の「法人種別」列と同一体系を持つと考えられる

if not os.path.exists(ZIP_PATH):
    print('  ⚠ NTA ZIP が見つかりません（スキップ）')
    nta3_by_cn: dict[str, str] = {}
else:
    print(f'  ZIP 読み込み中: {ZIP_PATH}')
    # RS CSV に出現する有効法人番号セット
    rs_cn_set = set(cn for cn in cn_info if re.fullmatch(r'\d{13}', cn))
    nta3_by_cn: dict[str, str] = {}

    with zipfile.ZipFile(ZIP_PATH, 'r') as zf:
        csv_name = [n for n in zf.namelist() if n.endswith('.csv')][0]
        with zf.open(csv_name) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
            for row in reader:
                if len(row) < 9: continue
                cn_zip = row[1].strip()
                if cn_zip in rs_cn_set:
                    nta3 = row[8].strip()  # NTA 3桁法人種別コード
                    nta3_by_cn[cn_zip] = nta3

    print(f'  NTA ZIP ヒット: {len(nta3_by_cn):,}件 / {len(rs_cn_set):,}件')

    # 法人種別コード不整合チェック
    mismatch_rows = []
    for cn, nta3 in nta3_by_cn.items():
        rs_types = cn_info[cn]['type_set']
        for rs_type in rs_types:
            if rs_type != nta3:
                mismatch_rows.append({
                    '法人番号':        cn,
                    'RS法人種別':      rs_type,
                    'NTA3桁コード':    nta3,
                    '合計金額':        cn_info[cn]['amount'],
                    '支出先名例':      next(iter(cn_info[cn]['name_set'])),
                })

    print(f'  法人種別不整合: {len(mismatch_rows):,}件')
    total_mismatch_amount = sum(r['合計金額'] for r in mismatch_rows)
    print(f'  不整合金額（合計・重複含む）: {total_mismatch_amount/1e12:.3f}兆円')

    if mismatch_rows:
        out_path = os.path.join(OUT_DIR, '05_type_code_mismatch.csv')
        with open(out_path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['法人番号', 'RS法人種別', 'NTA3桁コード', '合計金額', '支出先名例'])
            w.writeheader()
            w.writerows(sorted(mismatch_rows, key=lambda r: -r['合計金額']))
        print(f'  → {out_path}')

        # RS vs NTA の差異パターン集計
        from collections import Counter
        pair_counter = Counter((r['RS法人種別'], r['NTA3桁コード']) for r in mismatch_rows)
        print('  [不整合パターン上位10（RS→NTA）]')
        for (rs, nta), cnt in pair_counter.most_common(10):
            print(f'    RS={rs} → NTA={nta}: {cnt:,}件')

        # 金額上位10件
        print('  [不整合 金額上位10件]')
        for r in sorted(mismatch_rows, key=lambda x: -x['合計金額'])[:10]:
            print(f'    [{r["法人番号"]}] {r["支出先名例"][:30]}')
            print(f'      RS={r["RS法人種別"]} / NTA={r["NTA3桁コード"]}  ({r["合計金額"]/1e9:.1f}十億円)')
print()

# ─────────────────────────────────────────────────────────
# 7. 法人番号なしレコードの補完候補（houjin.db 名称完全一致）
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§6. 法人番号なしレコードの補完候補（houjin.db 名称完全一致）')
print('──────────────────────────────────────────')

# 法人番号なしユニーク名称
no_cn_names = {name for name, info in name_info.items() if not info['cn_set']}
print(f'  法人番号なしユニーク支出先名: {len(no_cn_names):,}件')
total_no_cn_amount = sum(name_info[n]['amount'] for n in no_cn_names)
print(f'  合計金額: {total_no_cn_amount/1e12:.2f}兆円')

if not os.path.exists(HOUJIN_DB):
    print('  ⚠ houjin.db が見つかりません（スキップ）')
else:
    db  = sqlite3.connect(HOUJIN_DB)
    cur = db.cursor()

    # 名称完全一致で補完候補を探す
    # バッチで name IN (...) クエリ
    no_cn_list = list(no_cn_names)
    found_supplement: list[dict] = []
    BATCH = 200
    for i in range(0, len(no_cn_list), BATCH):
        batch = no_cn_list[i:i+BATCH]
        placeholders = ','.join('?' * len(batch))
        cur.execute(
            f'SELECT name, corporate_number, prefecture FROM houjin WHERE name IN ({placeholders})',
            batch
        )
        for row in cur.fetchall():
            h_name, h_cn, h_pref = row
            found_supplement.append({
                '支出先名':      h_name,
                '補完法人番号':  h_cn,
                '都道府県':      h_pref,
                '合計金額':      name_info[h_name]['amount'],
                '現RS法人種別':  '|'.join(sorted(name_info[h_name]['type_set'])),
            })

    db.close()

    # 同一名称で複数件ヒットする場合はその旨記録
    from collections import Counter
    name_hit_count = Counter(r['支出先名'] for r in found_supplement)
    multi_hit_names = {n for n, cnt in name_hit_count.items() if cnt > 1}

    single_hit = [r for r in found_supplement if r['支出先名'] not in multi_hit_names]
    multi_hit  = [r for r in found_supplement if r['支出先名'] in multi_hit_names]

    print(f'  houjin.db 名称完全一致 ヒット名称: {len(name_hit_count):,}件')
    print(f'    うち 1件のみヒット（高精度補完候補）: {len(set(r["支出先名"] for r in single_hit)):,}件')
    print(f'    うち 複数ヒット（同名法人が複数存在）: {len(multi_hit_names):,}件')

    total_supplement_amount = sum(name_info[n]['amount'] for n in name_hit_count)
    print(f'  補完候補の合計金額: {total_supplement_amount/1e12:.2f}兆円')

    if found_supplement:
        out_path = os.path.join(OUT_DIR, '06_cn_supplement_candidates.csv')
        with open(out_path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['支出先名', '補完法人番号', '都道府県', '合計金額', '現RS法人種別', '複数ヒット'])
            w.writeheader()
            for r in sorted(found_supplement, key=lambda x: -x['合計金額']):
                r['複数ヒット'] = 'TRUE' if r['支出先名'] in multi_hit_names else 'FALSE'
                w.writerow(r)
        print(f'  → {out_path}')
        # 上位10件（単一ヒットのみ）
        print('  [補完候補 上位10件（単一ヒット・金額降順）]')
        for r in sorted(single_hit, key=lambda x: -x['合計金額'])[:10]:
            print(f'    {r["支出先名"][:30]}')
            print(f'      → {r["補完法人番号"]}  ({r["都道府県"]})  ({r["合計金額"]/1e9:.1f}十億円)')

print()

# ─────────────────────────────────────────────────────────
# 8. houjin.db 更新区分（type_code）の内訳説明
# ─────────────────────────────────────────────────────────

print('──────────────────────────────────────────')
print('§7. houjin.db type_code の内訳（更新区分）')
print('──────────────────────────────────────────')
print('  ※ build-houjin-sqlite.py は NTA CSV カラム[2]（更新区分）を type_code として保存。')
print('  ※ NTA 3桁法人種別コードはカラム[8] にあり houjin.db には未収録。')
print()
UPDATE_TYPE_MAP = {
    '01': '新規', '11': '商号又は名称の変更', '12': '国内所在地の変更',
    '13': '合併による法人消滅', '14': '会社分割による法人消滅',
    '21': '清算の結了等', '22': '登記の嘱託等', '31': '登記官による変更',
    '41': '行政機関等への異動', '71': '提供情報更正', '72': '国外転出', '81': '閉鎖',
}
if os.path.exists(HOUJIN_DB):
    db  = sqlite3.connect(HOUJIN_DB)
    cur = db.cursor()
    cur.execute('SELECT type_code, COUNT(*) FROM houjin GROUP BY type_code ORDER BY COUNT(*) DESC')
    print('  [houjin.db 全件 type_code 分布]')
    for tc, cnt in cur.fetchall():
        label = UPDATE_TYPE_MAP.get(tc, '不明')
        print(f'    {tc}: {cnt:,}件  ({label})')
    db.close()

print()
print('=== 調査完了 ===')
print(f'出力ディレクトリ: {OUT_DIR}')
