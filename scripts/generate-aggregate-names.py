"""
その他系集合名称 辞書生成スクリプト
出力: public/data/dictionaries/aggregate_names.csv

支出先名に「その他」を含む集合表現のうち、意味的に既存カテゴリへ分類できるものを
完全一致または正規表現でマッチングする辞書。

対象グループ:
  - 都道府県系      (pref_aggregate)
  - 市区町村系      (muni_aggregate)
  - 地方公共団体混合 (local_gov_mixed)
  - 労働局系        (rodo_kyoku_agg)
  - 国際機関系      (intl_org_agg)

スキーマ:
  aggregate_id  : 一意ID（スネークケース）
  category      : 分類カテゴリ
  canonical_name: 代表表記（UI表示・集計用）
  name          : マッチング対象文字列（完全一致 or 正規表現）
  name_type     : canonical / alias
  match_type    : exact / regex
"""

import csv
import os

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'aggregate_names.csv'
)
FIELDNAMES = ['aggregate_id', 'category', 'canonical_name', 'name', 'name_type', 'match_type']


def rows(aid, category, canonical, aliases=None, regex_aliases=None):
    """
    aliases       : list of exact-match alias strings
    regex_aliases : list of regex pattern strings (Python re.fullmatch 形式)
    """
    result = [{
        'aggregate_id':  aid,
        'category':      category,
        'canonical_name': canonical,
        'name':          canonical,
        'name_type':     'canonical',
        'match_type':    'exact',
    }]
    for alias in (aliases or []):
        result.append({
            'aggregate_id':  aid,
            'category':      category,
            'canonical_name': canonical,
            'name':          alias,
            'name_type':     'alias',
            'match_type':    'exact',
        })
    for pattern in (regex_aliases or []):
        result.append({
            'aggregate_id':  aid,
            'category':      category,
            'canonical_name': canonical,
            'name':          pattern,
            'name_type':     'alias',
            'match_type':    'regex',
        })
    return result


all_rows = []

# ────────────────────────────────────────────
# 1. 都道府県系（pref_aggregate / ~0.81兆円）
# ────────────────────────────────────────────
CAT_PREF = '都道府県'

all_rows += rows(
    'pref_aggregate', CAT_PREF, '都道府県（集合）',
    aliases=[
        'その他の県',          # 0.64兆（最大）
        'その他都道府県',       # 0.03兆
        'その他道府県',         # 0.004兆
        'その他の都道府県等',   # 0.001兆
        'その他の都府県',       # 0.000兆
        'その他の都道府県',     # 0.000兆
        'その他府県',           # 0.000兆
    ],
    regex_aliases=[
        r'その他[0-9]+(県|都道府県|道府県|府県)',  # その他37県 / その他37都道府県 等
    ],
)

# ────────────────────────────────────────────
# 2. 市区町村系（muni_aggregate / ~1.22兆円）
# ────────────────────────────────────────────
CAT_MUNI = '市区町村'

all_rows += rows(
    'muni_aggregate', CAT_MUNI, '市区町村（集合）',
    aliases=[
        'その他の市区町村',         # 1.20兆（最大）
        'その他市区町村等',          # 0.006兆
        'その他の市町村(保険者)',    # 0.002兆
        'その他市町村',              # 0.001兆
        'その他指定都市',            # 0.000兆
    ],
    regex_aliases=[
        r'その他[0-9]+市町村',  # その他31市町村 等
    ],
)

# ────────────────────────────────────────────
# 3. 都道府県＋市区町村混合（local_gov_mixed / ~2.19兆円）
# ────────────────────────────────────────────
CAT_LOCAL = '地方公共団体'

all_rows += rows(
    'local_gov_mixed', CAT_LOCAL, '地方公共団体（都道府県・市区町村集合）',
    aliases=[
        'その他都道府県・市及び福祉事務所を設置する町村',    # 2.00兆（最大）
        'その他都道府県・市・福祉事務所設置町村',            # 0.12兆
        'その他地方公共団体',                                # 0.04兆
        'その他自治体',                                      # 0.03兆
        'その他都道府県、市、福祉事務所を設置する町村',      # 0.005兆
        'その他都道府県・市町村',                            # 0.001兆
        'その他地方自治体',                                  # 0.001兆
        'その他(都道府県、保健所設置市、特別区)',            # 0.000兆
        'その他都道府県・指定都市',                          # 0.000兆
    ],
    regex_aliases=[
        r'その他自治体\([0-9]+\)',  # その他自治体(54) 等
    ],
)

# ────────────────────────────────────────────
# 4. 労働局系（rodo_kyoku_agg / ~0.10兆円）
# ────────────────────────────────────────────
CAT_RODO = '行政機関'

all_rows += rows(
    'rodo_kyoku_agg', CAT_RODO, '労働局（集合）',
    aliases=[
        'その他労働局',             # 0.076兆（最大）
        'その他の労働局',           # 0.009兆
        'その他都道府県労働局',     # 0.009兆
        'その他の都道府県労働局',   # 0.003兆
        'その他都道府県労働局合計', # 0.001兆
    ],
    regex_aliases=[
        r'その他[0-9]+(都道府県)?労働局',  # その他37都道府県労働局 / その他28労働局 等
        r'その他労働局\([0-9]+局\)',        # その他労働局(37局) / その他労働局(25局) 等
    ],
)

# ────────────────────────────────────────────
# 5. 国際機関系（intl_org_agg / ~0.003兆円）
# ────────────────────────────────────────────
CAT_INTL = '国際機関'

all_rows += rows(
    'intl_org_agg', CAT_INTL, '国際機関（集合）',
    aliases=[
        'その他国際機関',  # 0.003兆
    ],
)


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)

    canonical_count = sum(1 for r in all_rows if r['name_type'] == 'canonical')
    exact_count = sum(1 for r in all_rows if r['match_type'] == 'exact' and r['name_type'] == 'alias')
    regex_count = sum(1 for r in all_rows if r['match_type'] == 'regex')
    print(f"✓ {OUTPUT_PATH}")
    print(f"  {len(all_rows)} 行出力（canonical {canonical_count} 件 / exact alias {exact_count} 件 / regex {regex_count} 件）")


if __name__ == '__main__':
    main()
