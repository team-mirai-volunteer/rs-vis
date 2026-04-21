"""
府省庁 → 局庁 → 部 → 課・室 → 班 → 係 ドリルダウン分析（全府省庁版）

実行:
  python3 scripts/analyze-invalid-by-org.py
"""

import csv
import re
import unicodedata
import collections
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SRC_CSV   = REPO_ROOT / 'data' / 'result' / 'recipients_without_total.csv'
DICT_CSV  = REPO_ROOT / 'data' / 'result' / 'recipient_dictionary.csv'

def normalize(s):
    return unicodedata.normalize('NFKC', s)

def to_int(s):
    try:    return int(str(s).replace(',', '').strip())
    except: return 0

COLLECTIVE_RE  = [re.compile(p) for p in [r'ほか', r'など', r'^その他', r'[0-9]+社',
    r'[0-9]+者以降', r'[0-9]+件', r'\([0-9]+[^)]*[市町村都道府県機関][^)]*\)',
    r'[・、].+(?:法人|会社|機関|組合)', r'(?:法人|会社|機関|組合)[・、]']]
PROJECT_RE     = re.compile(r'事業$|プロジェクト$|計画$|プログラム$|基金$|補助金$|助成金$|給付金$|交付金$|支援金$|委託$')
PROJECT_NOT_RE = re.compile(r'法人|会社|組合|機構|独立行政|大学|学校')
KAKU_LIST      = ['株式会社', '有限会社', '合同会社', '一般社団法人', '公益社団法人',
                  '一般財団法人', '公益財団法人', '特定非営利活動法人', '独立行政法人',
                  '国立大学法人', '学校法人', '社会福祉法人', '医療法人']
ARBITRARY_RE   = re.compile(r'協会|連合会|連盟|協議会|委員会|センター|コンソーシアム|フォーラム|研究会|学会|振興会')
FOREIGN_RE     = re.compile(r'LLC|Ltd\.?|Inc\.?|Corp\.?|GmbH|B\.V\.|S\.A\.|PTE\.?|PLC|AG ')
ASCII_ONLY_RE  = re.compile(r'^[A-Za-z0-9\s\.\,\-\&\(\)\'\"\/\\\+\#\@\!\?\*\:\;]+$')

def get_reason(name, cn, ci, nm, nc):
    norm = normalize(name)
    if any(p.search(name) for p in COLLECTIVE_RE): return '集合・複数表現'
    if re.match(r'^その他', name):                  return 'その他PH'
    if ASCII_ONLY_RE.match(norm) and not re.search(r'[\u3040-\u9FFF]', norm): return '英字のみ'
    if FOREIGN_RE.search(name):                     return '外国法人疑い'
    if cn and ci and not nm and not nc:             return '入力ミス'
    if PROJECT_RE.search(name) and not PROJECT_NOT_RE.search(name): return '事業・プログラム名'
    if not cn and not any(k in name for k in KAKU_LIST) and ARBITRARY_RE.search(name): return '任意団体'
    if not cn and any(k in name for k in KAKU_LIST): return '法人格CN無'
    return '未分類'

# ── 辞書ロード ──
print('辞書ロード中...')
dict_map = {}
with open(DICT_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        dict_map[r['name']] = r

# ── 元データロード ──
print('元データロード中...')
with open(SRC_CSV, encoding='utf-8') as f:
    src_rows = list(csv.DictReader(f))
print(f'  {len(src_rows):,}行')

# ── 全府省庁を動的に取得 ──
all_ministries = sorted(set(r.get('府省庁','').strip() for r in src_rows if r.get('府省庁','').strip()),
                        key=lambda m: sum(1 for r in src_rows if r.get('府省庁','').strip() == m), reverse=True)
print(f'  府省庁数: {len(all_ministries)}')

def make_stat():
    return {'total': 0, 'valid': 0, 'invalid': 0, 'amount': 0, 'inv_amount': 0,
            'reasons': collections.Counter()}

# 集計辞書 (m, b, d, s, han, kakari) の全組み合わせ
all_stat = collections.defaultdict(make_stat)   # (m,b,d,s,han,kakari)
min_stat = collections.defaultdict(make_stat)   # (m,)

print('集計中...')
for row in src_rows:
    name = row['支出先名'].strip()
    if not name:
        continue
    dic = dict_map.get(name)
    if dic is None:
        continue

    amount   = to_int(row.get('支出先の合計支出額', '') or row.get('金額', ''))
    m        = row.get('府省庁', '').strip()
    b        = row.get('局・庁', '').strip()
    d        = row.get('部', '').strip()
    s        = row.get('課', '').strip() or row.get('室', '').strip()
    han      = row.get('班', '').strip()
    kakari   = row.get('係', '').strip()
    if not m:
        continue

    is_valid = dic['valid'] == 'True'
    reason   = get_reason(name, dic['corporate_number'],
                          dic['cn_in_db'] == 'True', dic['name_cn_match'] == 'True',
                          dic['cn_name_contained'] == 'True') if not is_valid else 'valid'

    key = (m, b, d, s, han, kakari)
    st = all_stat[key]
    st['total']  += 1
    st['amount'] += amount
    if is_valid:
        st['valid'] += 1
    else:
        st['invalid']     += 1
        st['inv_amount']  += amount
        st['reasons'][reason] += 1

    ms = min_stat[(m,)]
    ms['total']  += 1
    ms['amount'] += amount
    if is_valid:
        ms['valid'] += 1
    else:
        ms['invalid']    += 1
        ms['inv_amount'] += amount
        ms['reasons'][reason] += 1

def pct(a, b):  return f'{a/(b or 1)*100:.1f}%'
def fmtb(n):    return f'{n/1e8:,.0f}億'
def top2(c):    return '  '.join(f'{r}({v})' for r, v in c.most_common(2))

def agg_by(keys_slice):
    """all_stat を keys_slice でグループ集計"""
    result = collections.defaultdict(make_stat)
    for key, st in all_stat.items():
        gkey = key[:keys_slice]
        r = result[gkey]
        r['total']     += st['total']
        r['valid']     += st['valid']
        r['invalid']   += st['invalid']
        r['amount']    += st['amount']
        r['inv_amount'] += st['inv_amount']
        for reason, cnt in st['reasons'].items():
            r['reasons'][reason] += cnt
    return result

bureau_stat = agg_by(2)   # (m, b)
div_stat    = agg_by(3)   # (m, b, d)
sec_stat    = agg_by(4)   # (m, b, d, s)

# ════════════════════════════════════════════════════════════════
# 1. 府省庁別サマリー
# ════════════════════════════════════════════════════════════════
print()
print('=' * 105)
print('  【府省庁別】サマリー（全37府省庁）')
print('=' * 105)
print(f'{"府省庁":<22} {"総数":>7} {"valid":>7} {"invalid":>8} {"invalid率":>9} {"invalid額":>13}  主な理由（上位2）')
print('-' * 105)
for m in all_ministries:
    s = min_stat[(m,)]
    if s['total'] == 0:
        continue
    print(f'{m:<22} {s["total"]:>7,} {s["valid"]:>7,} {s["invalid"]:>8,} {pct(s["invalid"],s["total"]):>9} {fmtb(s["inv_amount"]):>13}  {top2(s["reasons"])}')

# ════════════════════════════════════════════════════════════════
# 2. 局庁別 上位50
# ════════════════════════════════════════════════════════════════
print()
print('=' * 115)
print('  【局庁別】invalid件数 上位50')
print('=' * 115)
print(f'{"府省庁":<20} {"局・庁":<30} {"総数":>7} {"invalid":>8} {"invalid率":>9} {"invalid額":>13}  主な理由')
print('-' * 115)
bureau_sorted = sorted([(k, v) for k, v in bureau_stat.items() if k[0] and v['invalid'] > 0],
                       key=lambda x: x[1]['invalid'], reverse=True)
for (m, b), s in bureau_sorted[:50]:
    print(f'{m:<20} {b or "(なし)":<30} {s["total"]:>7,} {s["invalid"]:>8,} {pct(s["invalid"],s["total"]):>9} {fmtb(s["inv_amount"]):>13}  {top2(s["reasons"])}')

# ════════════════════════════════════════════════════════════════
# 3. 部レベル 上位50
# ════════════════════════════════════════════════════════════════
print()
print('=' * 120)
print('  【部別】invalid件数 上位50（部が空白のものは除く）')
print('=' * 120)
print(f'{"府省庁":<18} {"局・庁":<25} {"部":<22} {"総数":>7} {"invalid":>8} {"invalid率":>9} {"invalid額":>13}  主な理由')
print('-' * 120)
div_sorted = sorted([(k, v) for k, v in div_stat.items() if k[0] and k[2] and v['invalid'] > 0],
                    key=lambda x: x[1]['invalid'], reverse=True)
for (m, b, d), s in div_sorted[:50]:
    print(f'{m:<18} {b or "(なし)":<25} {d:<22} {s["total"]:>7,} {s["invalid"]:>8,} {pct(s["invalid"],s["total"]):>9} {fmtb(s["inv_amount"]):>13}  {top2(s["reasons"])}')

# ════════════════════════════════════════════════════════════════
# 4. 課・室レベル 上位50
# ════════════════════════════════════════════════════════════════
print()
print('=' * 130)
print('  【課・室別】invalid件数 上位50（課・室が空白のものは除く）')
print('=' * 130)
print(f'{"府省庁":<15} {"局・庁":<22} {"部":<15} {"課・室":<22} {"総数":>7} {"invalid":>8} {"invalid率":>9} {"invalid額":>12}  主な理由')
print('-' * 130)
sec_sorted = sorted([(k, v) for k, v in sec_stat.items() if k[0] and k[3] and v['invalid'] > 0],
                    key=lambda x: x[1]['invalid'], reverse=True)
for (m, b, d, sc), s in sec_sorted[:50]:
    print(f'{m:<15} {b or "(なし)":<22} {d or "(なし)":<15} {sc:<22} {s["total"]:>7,} {s["invalid"]:>8,} {pct(s["invalid"],s["total"]):>9} {fmtb(s["inv_amount"]):>12}  {top2(s["reasons"])}')

# ════════════════════════════════════════════════════════════════
# 5. 全府省庁ドリルダウン（府省庁→局庁→部）
# ════════════════════════════════════════════════════════════════
print()
print('=' * 120)
print('  【全府省庁】局庁→部 ドリルダウン（invalid 3件以上）')
print('=' * 120)

for ministry in all_ministries:
    ms = min_stat[(ministry,)]
    if ms['invalid'] == 0:
        continue

    print()
    print(f'  ▶ {ministry}  total={ms["total"]:,}  invalid={ms["invalid"]:,}  {pct(ms["invalid"],ms["total"])}  {fmtb(ms["inv_amount"])}')
    print(f'  {"局・庁":<30} {"total":>6} {"invalid":>8} {"invalid率":>9} {"invalid額":>12}  主な理由')
    print('  ' + '-' * 95)

    # 局庁集計
    bureau_for_m = {(b,): v for (m, b), v in bureau_stat.items() if m == ministry and v['invalid'] > 0}
    for (b,), bst in sorted(bureau_for_m.items(), key=lambda x: x[1]['invalid'], reverse=True):
        if bst['invalid'] < 3:
            continue
        print(f'  {b or "(局なし)":<30} {bst["total"]:>6,} {bst["invalid"]:>8,} {pct(bst["invalid"],bst["total"]):>9} {fmtb(bst["inv_amount"]):>12}  {top2(bst["reasons"])}')

        # 部集計
        div_for_b = [(d, v) for (m2, b2, d), v in div_stat.items()
                     if m2 == ministry and b2 == b and d and v['invalid'] >= 3]
        for d, dst in sorted(div_for_b, key=lambda x: x[1]['invalid'], reverse=True)[:5]:
            print(f'    {"└ " + d:<30} {dst["total"]:>6,} {dst["invalid"]:>8,} {pct(dst["invalid"],dst["total"]):>9} {fmtb(dst["inv_amount"]):>12}  {top2(dst["reasons"])}')

            # 課・室集計
            sec_for_d = [(sc, v) for (m2, b2, d2, sc), v in sec_stat.items()
                         if m2 == ministry and b2 == b and d2 == d and sc and v['invalid'] >= 3]
            for sc, sst in sorted(sec_for_d, key=lambda x: x[1]['invalid'], reverse=True)[:3]:
                print(f'      {"└ " + sc:<30} {sst["total"]:>6,} {sst["invalid"]:>8,} {pct(sst["invalid"],sst["total"]):>9} {fmtb(sst["inv_amount"]):>12}  {top2(sst["reasons"])}')
