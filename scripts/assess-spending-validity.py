"""
支出先 妥当性評価スクリプト

設計: docs/tasks/20260304_1135_支出先妥当性評価軸設計.md

判定ロジック:
  1. 集合・混在パターンに該当 → ng
  2. 国名/都道府県/市区町村辞書に完全一致 → ok  (地理辞書)
  3. 府省庁/出先機関/警察辞書に完全一致 → ok  (府省庁辞書)
  4. 受益者辞書に完全一致、または l2 が受益者集合/匿名受益者 → ok  (受益者辞書)
  5. ok_kaku.csv の承認格ワードを含む → ok  (承認格)
  6. それ以外 → ng

実行:
  python3 scripts/assess-spending-validity.py
"""

import csv
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DICT_DIR  = REPO_ROOT / 'public' / 'data' / 'dictionaries'
INPUT     = REPO_ROOT / 'public' / 'data' / 'entity-labels-csv.json'
OUTPUT    = REPO_ROOT / 'public' / 'data' / 'spending-validity.json'

# ─────────────────────────────────────────────────────────────
# 集合・混在の除外パターン（いずれかにマッチ → ng 確定）
# ─────────────────────────────────────────────────────────────
COLLECTIVE_PATTERNS = [
    re.compile(r'ほか'),                                          # ○○ほか、石川県ほか
    re.compile(r'など'),                                          # ○○など
    re.compile(r'^その他'),                                       # その他37県、その他の支出先
    re.compile(r'[0-9]+社'),                                      # 97社、5社
    re.compile(r'[0-9]+者以降'),                                  # 上位11者以降
    re.compile(r'[0-9]+件[）\)）]?$'),                            # N件、(N件)
    re.compile(r'\([0-9]+[^)]*[市町村都道府県機関][^)]*\)'),      # (43市町村等)
    re.compile(r'[・、].+法人'),                                   # A法人・B法人 形式
    re.compile(r'法人[・、]'),                                     # 法人・○○ 形式
]

def is_collective(name: str) -> bool:
    return any(p.search(name) for p in COLLECTIVE_PATTERNS)

# ─────────────────────────────────────────────────────────────
# 辞書ロード
# ─────────────────────────────────────────────────────────────

def load_name_set(csv_path: Path, name_col: str) -> set[str]:
    """単一列から名称セットを構築"""
    result = set()
    with open(csv_path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            v = row.get(name_col, '').strip()
            if v and not v.startswith('#'):
                result.add(v)
    return result

def load_ministry_names(csv_path: Path, cols: list[str]) -> set[str]:
    """府省庁系辞書（複数列）から名称セットを構築"""
    result = set()
    with open(csv_path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            for col in cols:
                v = row.get(col, '').strip()
                if v and not v.startswith('#'):
                    result.add(v)
    return result

def load_kaku_list(csv_path: Path) -> list[str]:
    result = []
    with open(csv_path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            k = row.get('kaku', '').strip()
            if k:
                result.append(k)
    return sorted(result, key=len, reverse=True)

# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────

def main():
    # ── 地理辞書 ──
    geo_names = (
        load_name_set(DICT_DIR / 'country_names.csv', 'name') |
        load_name_set(DICT_DIR / 'prefecture_names.csv', 'name') |
        load_name_set(DICT_DIR / 'municipality_names.csv', 'name') |
        load_name_set(DICT_DIR / 'municipality_supplement.csv', 'name')
    )

    # ── 府省庁辞書 ──
    ministry_names = (
        load_ministry_names(DICT_DIR / 'ministry_names.csv',
                            ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit']) |
        load_ministry_names(DICT_DIR / 'ministry_from_ichiran.csv',
                            ['ministry', 'bureau', 'bureau_alias', 'section']) |
        load_ministry_names(DICT_DIR / 'ministry_supplement.csv',
                            ['ministry', 'bureau', 'bureau_alias', 'section']) |
        load_name_set(DICT_DIR / 'field_office_names.csv', 'name') |
        load_name_set(DICT_DIR / 'police_names.csv', 'name')
    )

    # ── 受益者辞書 ──
    beneficiary_names = load_name_set(DICT_DIR / 'beneficiary_names.csv', 'name')
    # l2 ベースで受益者と判定するラベル（辞書未登録の受給者カテゴリをカバー）
    BENEFICIARY_L2 = {'受益者集合', '匿名受益者'}

    # ── 承認格 ──
    kaku_list = load_kaku_list(DICT_DIR / 'ok_kaku.csv')

    # 入力ロード
    with open(INPUT, encoding='utf-8') as f:
        entries = json.load(f)

    print(f'対象エントリ数: {len(entries):,}')

    # ─────────────────────────────────────────────────────────
    # 判定
    # ─────────────────────────────────────────────────────────
    results:  dict[str, str] = {}
    ok_by:    dict[str, list] = {'geo': [], 'ministry': [], 'beneficiary': [], 'kaku': []}
    ng_by:    dict[str, list] = {'collective': [], 'no_match': []}

    for entry in entries:
        name = entry['name']
        l2   = entry.get('l2', '')

        if is_collective(name):
            results[name] = 'ng'
            ng_by['collective'].append(name)
            continue

        if name in geo_names:
            results[name] = 'ok'
            ok_by['geo'].append(name)
            continue

        if name in ministry_names:
            results[name] = 'ok'
            ok_by['ministry'].append(name)
            continue

        if name in beneficiary_names or l2 in BENEFICIARY_L2:
            results[name] = 'ok'
            ok_by['beneficiary'].append(name)
            continue

        if any(k in name for k in kaku_list):
            results[name] = 'ok'
            ok_by['kaku'].append(name)
            continue

        results[name] = 'ng'
        ng_by['no_match'].append(name)

    # ─────────────────────────────────────────────────────────
    # 集計
    # ─────────────────────────────────────────────────────────
    def entry_amount(name_set):
        return sum(e['amount'] for e in entries if e['name'] in name_set)

    ok_entries   = [e for e in entries if results.get(e['name']) == 'ok']
    ng_entries   = [e for e in entries if results.get(e['name']) == 'ng']
    ok_amount    = sum(e['amount'] for e in ok_entries)
    ng_amount    = sum(e['amount'] for e in ng_entries)
    total_amount = sum(e['amount'] for e in entries)
    total_count  = len(entries)

    geo_set   = set(ok_by['geo'])
    min_set   = set(ok_by['ministry'])
    ben_set   = set(ok_by['beneficiary'])
    kaku_set  = set(ok_by['kaku'])
    coll_set  = set(ng_by['collective'])
    nm_set    = set(ng_by['no_match'])

    def fmt(n):    return f'{n/1e12:.2f}兆円'
    def pct(n, d): return f'{n/d*100:.1f}%' if d else '0%'

    print()
    print('=' * 62)
    print('  支出先 妥当性評価 カバレッジレポート')
    print('=' * 62)
    print(f'総エントリ: {total_count:>8,}件  {fmt(total_amount)}')
    print()
    print(f'【ok（問題なし）】  {len(ok_entries):>7,}件  {pct(len(ok_entries), total_count)}'
          f'  {fmt(ok_amount)}  {pct(ok_amount, total_amount)}')
    print(f'  └ 地理辞書       {len(geo_set):>6,}件  {fmt(entry_amount(geo_set))}')
    print(f'  └ 府省庁辞書     {len(min_set):>6,}件  {fmt(entry_amount(min_set))}')
    print(f'  └ 受益者辞書     {len(ben_set):>6,}件  {fmt(entry_amount(ben_set))}')
    print(f'  └ 承認格マッチ   {len(kaku_set):>6,}件  {fmt(entry_amount(kaku_set))}')
    print()
    print(f'【ng（問題あり）】  {len(ng_entries):>7,}件  {pct(len(ng_entries), total_count)}'
          f'  {fmt(ng_amount)}  {pct(ng_amount, total_amount)}')
    print(f'  └ 集合・混在除外 {len(coll_set):>6,}件  {fmt(entry_amount(coll_set))}')
    print(f'  └ 格・辞書未マッチ{len(nm_set):>5,}件  {fmt(entry_amount(nm_set))}')

    # ─── ng 上位30（格・辞書未マッチ）───
    print()
    print('─' * 62)
    print('  ng 上位30件（格・辞書未マッチ、金額降順）')
    print('─' * 62)
    nm_entries = sorted([e for e in entries if e['name'] in nm_set],
                        key=lambda e: e['amount'], reverse=True)
    for e in nm_entries[:30]:
        print(f"  {e['amount']/1e8:>8.1f}億円  [{e.get('l1','')}:{e.get('l2','')}]  {e['name']}")

    # ─── ng 上位20（集合・混在）───
    print()
    print('─' * 62)
    print('  集合・混在除外 上位20件（金額降順）')
    print('─' * 62)
    coll_sorted = sorted([e for e in entries if e['name'] in coll_set],
                         key=lambda e: e['amount'], reverse=True)
    for e in coll_sorted[:20]:
        print(f"  {e['amount']/1e8:>8.1f}億円  [{e.get('l1','')}:{e.get('l2','')}]  {e['name']}")

    # ─── 承認格別ヒット数 ───
    print()
    print('─' * 62)
    print('  承認格別 ヒット数（件数降順）')
    print('─' * 62)
    kaku_hit: dict[str, dict] = {}
    for e in entries:
        if e['name'] in kaku_set:
            matched = next((k for k in kaku_list if k in e['name']), None)
            if matched:
                if matched not in kaku_hit:
                    kaku_hit[matched] = {'count': 0, 'amount': 0}
                kaku_hit[matched]['count'] += 1
                kaku_hit[matched]['amount'] += e['amount']
    for k, v in sorted(kaku_hit.items(), key=lambda x: x[1]['count'], reverse=True):
        print(f"  {v['count']:>6,}件  {v['amount']/1e12:.2f}兆円  {k}")

    # ─── JSON 出力 ───
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print()
    print(f'出力: {OUTPUT}')

if __name__ == '__main__':
    main()
