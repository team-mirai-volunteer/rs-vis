"""
大使館・領事館 辞書生成スクリプト
出力: data/result/embassy_names.csv

対象: 日本の在外公館（大使館・総領事館）および関連エンティティ
- 正式名称大使館・領事館（在フランス大使館 等）
- 在外公館顧問医（在英国大使館顧問医 等）
- 外国公館（英国大使館文化部）
- 関連法人（在エジプト日本大使館ファシリティマネジメント株式会社）
- 匿名在外公館（在S日本国大使館 等・日本産食品の魅力発信レセプション事業関連）

スキーマ:
  embassy_id    : 一意ID（スネークケース）
  embassy_type  : 種別（日本国大使館 / 日本国総領事館 / 在外公館顧問医 / 外国公館 / 関連法人 / 匿名在外公館）
  canonical_name: データ上の代表名称
  name          : マッチング用名称
  name_type     : canonical / alias
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'embassy_names.csv')
FIELDNAMES = ['embassy_id', 'embassy_type', 'canonical_name', 'name', 'name_type']


def rows(eid, etype, canonical, aliases=None):
    result = [{
        'embassy_id':     eid,
        'embassy_type':   etype,
        'canonical_name': canonical,
        'name':           canonical,
        'name_type':      'canonical',
    }]
    for alias in (aliases or []):
        result.append({
            'embassy_id':     eid,
            'embassy_type':   etype,
            'canonical_name': canonical,
            'name':           alias,
            'name_type':      'alias',
        })
    return result


all_rows = []

# ────────────────────────────────────────────
# 1. 日本国大使館
# ────────────────────────────────────────────
TYPE_EMB = '日本国大使館'

all_rows += rows('russia',      TYPE_EMB, '在ロシア日本国大使館')
all_rows += rows('france',      TYPE_EMB, '在フランス大使館')
all_rows += rows('fiji',        TYPE_EMB, '在フィジー大使館')
all_rows += rows('vietnam',     TYPE_EMB, '在ベトナム大使館')
all_rows += rows('cambodia',    TYPE_EMB, '在カンボジア大使館')
all_rows += rows('trinidad',    TYPE_EMB, '在トリニダード・トバゴ日本国大使館',
                  aliases=['在トリニダード・トバゴ大使館', '在トリニダード・トバコ大使館'])
all_rows += rows('ghana',       TYPE_EMB, '在ガーナ日本国大使館')
all_rows += rows('usa',         TYPE_EMB, '在米国大使館')
all_rows += rows('mozambique',  TYPE_EMB, '在モザンビーク日本国大使館')
all_rows += rows('malaysia',    TYPE_EMB, '在マレーシア大使館')
all_rows += rows('thailand',    TYPE_EMB, '在タイ大使館')
all_rows += rows('philippines', TYPE_EMB, '在フィリピン大使館')
all_rows += rows('paraguay',    TYPE_EMB, '在パラグアイ大使館')
all_rows += rows('moldova',     TYPE_EMB, '在モルドバ大使館')
all_rows += rows('turkey',      TYPE_EMB, '在トルコ日本大使館')
all_rows += rows('belize',      TYPE_EMB, '在ベリーズ大使館')
all_rows += rows('tunisia',     TYPE_EMB, '在チュニジア大使館')
all_rows += rows('bangladesh',  TYPE_EMB, '在バングラデシュ大使館')
all_rows += rows('canada',      TYPE_EMB, '在カナダ大使館')
all_rows += rows('belgium',     TYPE_EMB, '在ベルギー大使館')
all_rows += rows('botswana',    TYPE_EMB, '在ボツワナ大使館')
all_rows += rows('croatia',     TYPE_EMB, '在クロアチア大使館')
all_rows += rows('uae',         TYPE_EMB, '在アラブ首長国連邦大使館')
all_rows += rows('malawi',      TYPE_EMB, '在マラウイ大使館')
all_rows += rows('new_zealand', TYPE_EMB, '在ニュージーランド大使館')
all_rows += rows('senegal',     TYPE_EMB, '在セネガル大使館')
all_rows += rows('uk',          TYPE_EMB, '在英国大使館')
all_rows += rows('laos',        TYPE_EMB, '在ラオス大使館')
all_rows += rows('latvia',      TYPE_EMB, '在ラトビア大使館')
all_rows += rows('azerbaijan',  TYPE_EMB, '在アゼルバイジャン大使館')
all_rows += rows('zimbabwe',    TYPE_EMB, '在ジンバブエ大使館')
all_rows += rows('iraq',        TYPE_EMB, '在イラク大使館')
all_rows += rows('guinea',      TYPE_EMB, '在ギニア大使館')
all_rows += rows('micronesia',  TYPE_EMB, '在ミクロネシア大使館')
all_rows += rows('saudi',       TYPE_EMB, '在サウジアラビア大使館')
all_rows += rows('solomon',     TYPE_EMB, '在ソロモン大使館')
all_rows += rows('morocco',     TYPE_EMB, '在モロッコ大使館')

# ────────────────────────────────────────────
# 2. 日本国総領事館
# ────────────────────────────────────────────
TYPE_CON = '日本国総領事館'

all_rows += rows('new_york',   TYPE_CON, '在ニューヨーク総領事館')
all_rows += rows('chicago',    TYPE_CON, '在シカゴ総領事館')
all_rows += rows('istanbul',   TYPE_CON, '在イスタンブール日本国総領事館')
all_rows += rows('recife',     TYPE_CON, '在レシフェ総領事館')
all_rows += rows('calgary',    TYPE_CON, '在カルガリー総領事館')
all_rows += rows('mumbai',     TYPE_CON, '在ムンバイ総領事館')
all_rows += rows('frankfurt',  TYPE_CON, '在フランクフルト総領事館')
all_rows += rows('jeju',       TYPE_CON, '在済州総領事館')
all_rows += rows('toronto',    TYPE_CON, '在トロント総領事館')
all_rows += rows('hamburg',    TYPE_CON, '在ハンブルク総領事館')
all_rows += rows('honolulu',   TYPE_CON, '在ホノルル総領事館')

# ────────────────────────────────────────────
# 3. 在外公館顧問医
# ────────────────────────────────────────────
TYPE_MED = '在外公館顧問医'

all_rows += rows('uk_doctor',     TYPE_MED, '在英国大使館顧問医')
all_rows += rows('korea_doctor',  TYPE_MED, '在韓国大使館顧問医')
all_rows += rows('france_doctor', TYPE_MED, '在仏大使館顧問医')
all_rows += rows('sydney_doctor', TYPE_MED, '在シドニー総領事館顧問医')

# ────────────────────────────────────────────
# 4. 外国公館（外国政府の在日公館等）
# ────────────────────────────────────────────
TYPE_FOR = '外国公館'

all_rows += rows('uk_cultural', TYPE_FOR, '英国大使館文化部')

# ────────────────────────────────────────────
# 5. 関連法人（大使館関連の株式会社等）
# ────────────────────────────────────────────
TYPE_CORP = '関連法人'

all_rows += rows('egypt_fm', TYPE_CORP, '在エジプト日本大使館ファシリティマネジメント株式会社')

# ────────────────────────────────────────────
# 6. 匿名在外公館
#    在[一文字]日本国大使館 / 在[一文字]日本国総領事館 の形式
#    および [一文字]日本国大使館（在なし）の形式
#    主に「日本産食品の魅力発信レセプション」事業に紐づく
# ────────────────────────────────────────────
TYPE_ANON = '匿名在外公館'

all_rows += rows('anon_s_emb',  TYPE_ANON, '在S日本国大使館')
all_rows += rows('anon_d_con',  TYPE_ANON, '在D日本国総領事館')
all_rows += rows('anon_i_emb',  TYPE_ANON, '在I日本国大使館')
all_rows += rows('anon_p_emb',  TYPE_ANON, '在P日本国大使館')
all_rows += rows('anon_t_emb',  TYPE_ANON, '在T日本国大使館')
all_rows += rows('anon_b_emb',  TYPE_ANON, '在B日本国大使館')
all_rows += rows('anon_a_emb',  TYPE_ANON, '在A日本国大使館')
all_rows += rows('anon_m_emb',  TYPE_ANON, '在M日本国大使館')
all_rows += rows('anon_y_emb',  TYPE_ANON, '在Y日本国大使館')
all_rows += rows('anon_u_emb',  TYPE_ANON, '在U日本国大使館')
all_rows += rows('anon_m_con',  TYPE_ANON, '在M日本国総領事館')
all_rows += rows('anon_o_emb',  TYPE_ANON, 'O日本国大使館')
all_rows += rows('anon_t2_emb', TYPE_ANON, 'T日本国大使館')
all_rows += rows('anon_q_emb',  TYPE_ANON, 'Q日本国大使館')
all_rows += rows('anon_c_emb',  TYPE_ANON, 'C日本国大使館')


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
