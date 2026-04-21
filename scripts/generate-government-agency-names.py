"""
行政機関辞書生成スクリプト

以下のソースから government_agency_names.csv を生成する:
  1. supplementary_valid_names.csv の government_branch エントリ（431件）→ 全件移行
  2. recipient_dictionary.csv の valid=False から行政機関委員会等を自動抽出
     （教育委員会・農業委員会・消防局等: cn_in_db=True AND DB名=自治体名）

出力: public/data/dictionaries/government_agency_names.csv

列:
  name          - 支出先名（辞書キー）
  agency_type   - 機関種別 (field_office / prefectural_branch / municipal_committee / special_org)
  parent_name   - 上位組織名（法人番号DBの法人名 または省庁名）
  parent_cn     - 上位組織の法人番号（13桁、不明の場合は空）
  ministry      - 所轄府省庁
  prefecture    - 所属都道府県（市区町村・都道府県機関のみ）
  municipality  - 所属市区町村（市区町村委員会のみ）
  note          - 備考・分類根拠

実行:
  python3 scripts/generate-government-agency-names.py
"""

import csv
from pathlib import Path
from collections import defaultdict

REPO_ROOT   = Path(__file__).parent.parent
SUPP_CSV    = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'supplementary_valid_names.csv'
DICT_CSV    = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'recipient_dictionary.csv'
MUNI_CSV    = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'municipality_names.csv'
OUTPUT_CSV  = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'government_agency_names.csv'

# ── note → agency_type マッピング ──
NOTE_TO_AGENCY_TYPE = {
    '労働局':                   'field_office',
    '都道府県警察':              'prefectural_branch',
    '国土交通省の地方機関':       'field_office',
    '法務局':                   'field_office',
    '厚生労働省の地方機関':       'field_office',
    '海上保安庁の地方機関':       'field_office',
    '市区町村':                  'municipal_committee',
    '農政局':                   'field_office',
    '森林管理局':                'field_office',
    '地方整備局':                'field_office',
    '農林水産省の地方機関':       'field_office',
    '厚生局':                   'field_office',
    '防衛局':                   'field_office',
    '警察庁の地方機関':           'field_office',
    '財務省の地方機関':           'field_office',
    '運輸局':                   'field_office',
    '管区警察局':                'field_office',
    '経済産業局':                'field_office',
    '公安調査局':                'field_office',
    '出入国在留管理局':           'field_office',
    '内閣府の地方機関':           'field_office',
    '気象庁の地方機関':           'field_office',
    '環境省の地方機関':           'field_office',
    '国税庁の地方機関':           'field_office',
    '航空局':                   'field_office',
    '総合通信局':                'field_office',
    '防衛省の地方機関':           'field_office',
    '都道府県':                  'prefectural_branch',
    '国税局':                   'field_office',
    '開発局':                   'field_office',
    '特殊法人・独立行政法人':      'special_org',
    '学校法人武庫川学院の地方機関': 'special_org',
    '学校法人濱名山手学院の地方機関': 'special_org',
    '学校法人福島学院の地方機関':  'special_org',
    '大聖院の地方機関':           'special_org',
    '学校法人明治学院の地方機関':  'special_org',
    '学校法人聖心女子学院の地方機関': 'special_org',
}

# ── note → ministry マッピング ──
NOTE_TO_MINISTRY = {
    '労働局':                   '厚生労働省',
    '都道府県警察':              '警察庁',
    '国土交通省の地方機関':       '国土交通省',
    '法務局':                   '法務省',
    '厚生労働省の地方機関':       '厚生労働省',
    '海上保安庁の地方機関':       '国土交通省',
    '農政局':                   '農林水産省',
    '森林管理局':                '農林水産省',
    '地方整備局':                '国土交通省',
    '農林水産省の地方機関':       '農林水産省',
    '厚生局':                   '厚生労働省',
    '防衛局':                   '防衛省',
    '警察庁の地方機関':           '警察庁',
    '財務省の地方機関':           '財務省',
    '運輸局':                   '国土交通省',
    '管区警察局':                '警察庁',
    '経済産業局':                '経済産業省',
    '公安調査局':                '法務省',
    '出入国在留管理局':           '法務省',
    '内閣府の地方機関':           '内閣府',
    '気象庁の地方機関':           '国土交通省',
    '環境省の地方機関':           '環境省',
    '国税庁の地方機関':           '財務省',
    '航空局':                   '国土交通省',
    '総合通信局':                '総務省',
    '防衛省の地方機関':           '防衛省',
    '都道府県':                  '',
    '市区町村':                  '',
    '国税局':                   '財務省',
    '開発局':                   '国土交通省',
    '特殊法人・独立行政法人':      '',
    '学校法人武庫川学院の地方機関': '',
    '学校法人濱名山手学院の地方機関': '',
    '学校法人福島学院の地方機関':  '',
    '大聖院の地方機関':           '',
    '学校法人明治学院の地方機関':  '',
    '学校法人聖心女子学院の地方機関': '',
}

# ── 新規追加対象: 行政機関サフィックス → (agency_type, ministry) ──
NEW_GOV_SUFFIXES = {
    '教育委員会': ('municipal_committee', '文部科学省'),  # 都道府県・市区町村で判別
    '農業委員会': ('municipal_committee', '農林水産省'),
    '消防局':    ('municipal_committee', '総務省消防庁'),
    '消防本部':  ('municipal_committee', '総務省消防庁'),
    '消防署':    ('municipal_committee', '総務省消防庁'),
}

# 都道府県レベルの行政委員会（agency_typeを prefectural_branch にするもの）
PREF_LEVEL_SUFFIXES = ('都', '道', '府', '県')
MUNI_LEVEL_SUFFIXES = ('市', '区', '町', '村')


def main():
    # ── municipality_names.csv でcanonical名→都道府県ルックアップ ──
    print('市区町村辞書ロード中...')
    # canonical_name → prefecture_name マッピング
    canonical_to_pref: dict[str, str] = {}
    with open(MUNI_CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            canonical_to_pref[r['canonical_name']] = r['prefecture_name']
            canonical_to_pref[r['name']] = r['prefecture_name']
    print(f'  {len(canonical_to_pref):,}エントリ')

    # ── recipient_dictionary.csv をロード ──
    print('厳密辞書ロード中...')
    dict_map: dict[str, dict] = {}
    with open(DICT_CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            dict_map[r['name']] = r
    print(f'  {len(dict_map):,}件')

    out_rows: list[dict] = []
    seen_names: set[str] = set()

    def add_row(name, agency_type, parent_name, parent_cn, ministry, prefecture, municipality, note):
        if name in seen_names:
            return
        seen_names.add(name)
        out_rows.append({
            'name':         name,
            'agency_type':  agency_type,
            'parent_name':  parent_name,
            'parent_cn':    parent_cn,
            'ministry':     ministry,
            'prefecture':   prefecture,
            'municipality': municipality,
            'note':         note,
        })

    # ── Phase 1: supplementary_valid_names.csv の government_branch を移行 ──
    print('補助辞書 government_branch の移行中...')
    with open(SUPP_CSV, encoding='utf-8') as f:
        supp_rows = list(csv.DictReader(f))

    # note=市区町村: 単純な市区町村名・会計管理者でCNなし → 行政機関ではないのでスキップ
    # note=都道府県: 都道府県略称（例: 和歌山）→ 厳密辞書の pref_abbr=True で対応
    SKIP_NOTES = {'市区町村', '都道府県'}

    gov_branch = [r for r in supp_rows if r['category'] == 'government_branch']
    for r in gov_branch:
        if r['note'] in SKIP_NOTES:
            continue
        name = r['name']
        note = r['note']
        agency_type = NOTE_TO_AGENCY_TYPE.get(note, 'field_office')
        ministry    = NOTE_TO_MINISTRY.get(note, '')

        # 厳密辞書からCN情報を取得
        dr = dict_map.get(name, {})
        parent_cn   = dr.get('corporate_number', '')
        parent_name = dr.get('db_name_by_cn', '')

        # 都道府県・市区町村の判定
        prefecture  = ''
        municipality = ''
        if parent_name:
            if parent_name.endswith(PREF_LEVEL_SUFFIXES):
                prefecture = parent_name
            elif parent_name.endswith(MUNI_LEVEL_SUFFIXES):
                municipality = parent_name
                prefecture = canonical_to_pref.get(parent_name, '')

        add_row(name, agency_type, parent_name, parent_cn, ministry, prefecture, municipality, note)

    print(f'  移行: {len(out_rows)}件')

    # ── Phase 2: recipient_dictionary の valid=False から行政機関委員会等を抽出 ──
    print('厳密辞書 invalid から行政機関委員会等を抽出中...')
    invalid_rows = [r for r in dict_map.values() if r['valid'] == 'False']

    new_count = 0
    for dr in invalid_rows:
        name   = dr['name']
        db     = dr['db_name_by_cn']
        cn     = dr['corporate_number']
        cn_in  = dr['cn_in_db'] == 'True'

        if not cn_in or not db:
            continue

        for suffix, (base_type, ministry) in NEW_GOV_SUFFIXES.items():
            if not name.endswith(suffix):
                continue

            # DB名が自治体名（都道府県・市区町村）で終わることを確認
            if not (db.endswith(PREF_LEVEL_SUFFIXES) or db.endswith(MUNI_LEVEL_SUFFIXES)):
                continue

            # 都道府県レベル or 市区町村レベルの判定
            if db.endswith(PREF_LEVEL_SUFFIXES):
                agency_type  = 'prefectural_branch'
                prefecture   = db
                municipality = ''
            else:
                agency_type  = 'municipal_committee'
                municipality = db
                prefecture   = canonical_to_pref.get(db, '')

            add_row(name, agency_type, db, cn, ministry, prefecture, municipality, suffix)
            new_count += 1
            break

    print(f'  新規追加: {new_count}件')

    # ── ソートして出力 ──
    out_rows.sort(key=lambda r: r['name'])

    fieldnames = ['name', 'agency_type', 'parent_name', 'parent_cn',
                  'ministry', 'prefecture', 'municipality', 'note']
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    # ── サマリー ──
    from collections import Counter
    type_count = Counter(r['agency_type'] for r in out_rows)
    ministry_count = Counter(r['ministry'] for r in out_rows if r['ministry'])

    print()
    print('=' * 60)
    print('  行政機関辞書 生成サマリー')
    print('=' * 60)
    print(f'総エントリ数: {len(out_rows):,}件')
    print()
    print('agency_type 内訳:')
    for atype, cnt in sorted(type_count.items(), key=lambda x: -x[1]):
        print(f'  {cnt:4d}  {atype}')
    print()
    print('ministry 内訳 (上位10):')
    for min_, cnt in ministry_count.most_common(10):
        print(f'  {cnt:4d}  {min_}')
    print()
    print(f'出力: {OUTPUT_CSV}')


if __name__ == '__main__':
    main()
