"""
政令指定都市 補完辞書生成スクリプト
出力: data/result/municipality_supplement.csv

municipality_names.csv（国税庁法人番号データから生成）は区レベルのみ収録のため、
政令指定都市名そのもの（大阪市、横浜市 等）が欠落している。
本スクリプトはその補完分を手動管理データとして生成する。

データソース: 総務省「政令指定都市の指定状況」（手動整理）
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'municipality_supplement.csv')

# 政令指定都市 20市（指定年月日順）
# 形式: (pref_code, prefecture_name, city_name)
DESIGNATED_CITIES = [
    ('01', '北海道',   '札幌市'),
    ('04', '宮城県',   '仙台市'),
    ('11', '埼玉県',   'さいたま市'),
    ('12', '千葉県',   '千葉市'),
    ('14', '神奈川県', '横浜市'),
    ('14', '神奈川県', '川崎市'),
    ('14', '神奈川県', '相模原市'),
    ('15', '新潟県',   '新潟市'),
    ('22', '静岡県',   '静岡市'),
    ('22', '静岡県',   '浜松市'),
    ('23', '愛知県',   '名古屋市'),
    ('26', '京都府',   '京都市'),
    ('27', '大阪府',   '大阪市'),
    ('27', '大阪府',   '堺市'),
    ('28', '兵庫県',   '神戸市'),
    ('33', '岡山県',   '岡山市'),
    ('34', '広島県',   '広島市'),
    ('40', '福岡県',   '北九州市'),
    ('40', '福岡県',   '福岡市'),
    ('43', '熊本県',   '熊本市'),
]

def main():
    rows = []
    for pref_code, prefecture_name, city_name in DESIGNATED_CITIES:
        rows.append({
            'pref_code':       pref_code,
            'prefecture_name': prefecture_name,
            'canonical_name':  city_name,
            'name':            city_name,
            'name_type':       'canonical',
        })

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['pref_code', 'prefecture_name', 'canonical_name', 'name', 'name_type'])
        writer.writeheader()
        writer.writerows(rows)

    print(f"✓ {OUTPUT_PATH}")
    print(f"  {len(rows)} 行出力（政令指定都市 {len(DESIGNATED_CITIES)} 市）")

if __name__ == '__main__':
    main()
