"""
外国政府機関 辞書生成スクリプト
出力: data/result/foreign_agency_names.csv

country_names.csv は主権国家名のみを収録しており、外国政府の機関名は対象外。
本スクリプトは支出実績に出現する外国政府機関・国際機関を手動整理データとして生成する。

スキーマ:
  country_code : ISO 3166-1 alpha-2（不明・国際機関は 'intl'）
  country_name : 国名（日本語）
  canonical_name: 正式名称（日本語）
  name         : マッチング用名称
  name_type    : canonical / alias
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'foreign_agency_names.csv')

FIELDNAMES = ['country_code', 'country_name', 'canonical_name', 'name', 'name_type']

def rows_for(country_code, country_name, canonical_name, aliases=None):
    result = [{
        'country_code':  country_code,
        'country_name':  country_name,
        'canonical_name': canonical_name,
        'name':          canonical_name,
        'name_type':     'canonical',
    }]
    for alias in (aliases or []):
        result.append({
            'country_code':  country_code,
            'country_name':  country_name,
            'canonical_name': canonical_name,
            'name':          alias,
            'name_type':     'alias',
        })
    return result

all_rows = []

# ────────────────────────────────────────────
# アメリカ合衆国（在日米軍・米政府機関）
# ────────────────────────────────────────────
US_AGENCIES = [
    # canonical_name, [aliases]
    ('米空軍省',         ['アメリカ空軍省', '在日米空軍']),
    ('米海軍省',         ['アメリカ海軍省', '在日米海軍']),
    ('米陸軍省',         ['アメリカ陸軍省', '在日米陸軍']),
    ('在日米軍司令部',   ['在日米軍']),
]
for canonical, aliases in US_AGENCIES:
    all_rows.extend(rows_for('us', 'アメリカ合衆国', canonical, aliases))

# 米国政府機関（研究・外交等）
all_rows.extend(rows_for('us', 'アメリカ合衆国',
    '米国航空宇宙局(NASA)ジョンソン宇宙センター',
    ['NASA', 'アメリカ航空宇宙局']))
all_rows.extend(rows_for('us', 'アメリカ合衆国',
    '日米教育委員会',
    ['フルブライト委員会']))

# ────────────────────────────────────────────
# 国際機関
# ────────────────────────────────────────────
INTL_AGENCIES = [
    # canonical_name, [aliases]
    ('米州開発銀行',         ['IDB', 'Inter-American Development Bank']),
]
for canonical, aliases in INTL_AGENCIES:
    all_rows.extend(rows_for('intl', '国際機関', canonical, aliases))


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)

    canonical_count = sum(1 for r in all_rows if r['name_type'] == 'canonical')
    print(f"✓ {OUTPUT_PATH}")
    print(f"  {len(all_rows)} 行出力（canonical {canonical_count} 件）")

if __name__ == '__main__':
    main()
