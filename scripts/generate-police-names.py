"""
都道府県警察 辞書生成スクリプト
出力: data/result/police_names.csv

都道府県警察・警視庁は法人種別=201（地方公共団体）として計上されるが、
prefecture_names.csv（都道府県名）にも municipality_names.csv（市区町村名）にも
収録されていないため、専用ファイルとして補完する。

名称規則:
  - 東京都: 警視庁（慣行的名称）
  - その他: ○○道警察 / ○○府警察 / ○○県警察
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'police_names.csv')

# (pref_code, prefecture_name, canonical_name, alias)
# alias: 別称が存在する場合のみ設定
POLICE_ORGS = [
    ('01', '北海道',   '北海道警察',   None),
    ('02', '青森県',   '青森県警察',   None),
    ('03', '岩手県',   '岩手県警察',   None),
    ('04', '宮城県',   '宮城県警察',   None),
    ('05', '秋田県',   '秋田県警察',   None),
    ('06', '山形県',   '山形県警察',   None),
    ('07', '福島県',   '福島県警察',   None),
    ('08', '茨城県',   '茨城県警察',   None),
    ('09', '栃木県',   '栃木県警察',   None),
    ('10', '群馬県',   '群馬県警察',   None),
    ('11', '埼玉県',   '埼玉県警察',   None),
    ('12', '千葉県',   '千葉県警察',   None),
    ('13', '東京都',   '警視庁',       '東京都警察'),   # 慣行名称
    ('14', '神奈川県', '神奈川県警察', None),
    ('15', '新潟県',   '新潟県警察',   None),
    ('16', '富山県',   '富山県警察',   None),
    ('17', '石川県',   '石川県警察',   None),
    ('18', '福井県',   '福井県警察',   None),
    ('19', '山梨県',   '山梨県警察',   None),
    ('20', '長野県',   '長野県警察',   None),
    ('21', '岐阜県',   '岐阜県警察',   None),
    ('22', '静岡県',   '静岡県警察',   None),
    ('23', '愛知県',   '愛知県警察',   None),
    ('24', '三重県',   '三重県警察',   None),
    ('25', '滋賀県',   '滋賀県警察',   None),
    ('26', '京都府',   '京都府警察',   None),
    ('27', '大阪府',   '大阪府警察',   None),
    ('28', '兵庫県',   '兵庫県警察',   None),
    ('29', '奈良県',   '奈良県警察',   None),
    ('30', '和歌山県', '和歌山県警察', None),
    ('31', '鳥取県',   '鳥取県警察',   None),
    ('32', '島根県',   '島根県警察',   None),
    ('33', '岡山県',   '岡山県警察',   None),
    ('34', '広島県',   '広島県警察',   None),
    ('35', '山口県',   '山口県警察',   None),
    ('36', '徳島県',   '徳島県警察',   None),
    ('37', '香川県',   '香川県警察',   None),
    ('38', '愛媛県',   '愛媛県警察',   None),
    ('39', '高知県',   '高知県警察',   None),
    ('40', '福岡県',   '福岡県警察',   None),
    ('41', '佐賀県',   '佐賀県警察',   None),
    ('42', '長崎県',   '長崎県警察',   None),
    ('43', '熊本県',   '熊本県警察',   None),
    ('44', '大分県',   '大分県警察',   None),
    ('45', '宮崎県',   '宮崎県警察',   None),
    ('46', '鹿児島県', '鹿児島県警察', None),
    ('47', '沖縄県',   '沖縄県警察',   None),
]

def main():
    rows = []
    for pref_code, pref_name, canonical, alias in POLICE_ORGS:
        rows.append({
            'pref_code':       pref_code,
            'prefecture_name': pref_name,
            'canonical_name':  canonical,
            'name':            canonical,
            'name_type':       'canonical',
        })
        if alias:
            rows.append({
                'pref_code':       pref_code,
                'prefecture_name': pref_name,
                'canonical_name':  canonical,
                'name':            alias,
                'name_type':       'alias',
            })

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['pref_code', 'prefecture_name', 'canonical_name', 'name', 'name_type'])
        writer.writeheader()
        writer.writerows(rows)

    print(f"✓ {OUTPUT_PATH}")
    print(f"  {len(rows)} 行出力（{len(POLICE_ORGS)} 組織）")

if __name__ == '__main__':
    main()
