"""
受給者・補助対象者 辞書生成スクリプト
出力: data/result/beneficiary_names.csv

支出先名が特定エンティティではなく「給付の受け手カテゴリ」を示す場合を収録する。
法人番号なし（種別コードなし）で出現し、完全一致で識別可能な名称群。

対象カテゴリ:
  - 年金・恩給受給者
  - 児童・家族給付受給者
  - 医療・福祉給付受給者
  - 労働・雇用給付対象者
  - 農業・水産補助対象者
  - その他給付対象者

スキーマ:
  beneficiary_id : 一意ID（スネークケース）
  category       : 大分類
  canonical_name : データ上の代表名称
  name           : マッチング用名称
  name_type      : canonical / alias
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'beneficiary_names.csv')
FIELDNAMES = ['beneficiary_id', 'category', 'canonical_name', 'name', 'name_type']

def rows(bid, category, canonical, aliases=None):
    result = [{
        'beneficiary_id': bid,
        'category':        category,
        'canonical_name':  canonical,
        'name':            canonical,
        'name_type':       'canonical',
    }]
    for alias in (aliases or []):
        result.append({
            'beneficiary_id': bid,
            'category':        category,
            'canonical_name':  canonical,
            'name':            alias,
            'name_type':       'alias',
        })
    return result

all_rows = []

# ────────────────────────────────────────────
# 1. 年金・恩給受給者（~49.1兆円）
# ────────────────────────────────────────────
CAT_NENKIN = '年金・恩給受給者'

all_rows += rows('nenkin_jukyu',         CAT_NENKIN, '年金受給者')
all_rows += rows('nenkin_jukyu_to',      CAT_NENKIN, '年金受給者等',
                 aliases=['年金受給者その他'])
all_rows += rows('nenkin_seikatsusha',   CAT_NENKIN, '年金生活者支援給付金受給者')
all_rows += rows('engo_nenkin',          CAT_NENKIN, '援護年金受給者')
all_rows += rows('gunkoku_onkyu',        CAT_NENKIN, '旧軍人遺族等恩給受給者')
all_rows += rows('bunkan_onkyu',         CAT_NENKIN, '文官等恩給受給者')
all_rows += rows('giin_kyosai',          CAT_NENKIN, '国会議員互助年金受給者')
all_rows += rows('kaigo_teate',          CAT_NENKIN, '介護手当等受給者')
all_rows += rows('onkyu_hi',             CAT_NENKIN, '恩給費',
                 aliases=['恩給受給者'])

# ────────────────────────────────────────────
# 2. 児童・家族給付受給者（~1.4兆円）
# ────────────────────────────────────────────
CAT_JIDO = '児童・家族給付受給者'

all_rows += rows('jido_teate',     CAT_JIDO, '児童手当の受給者',
                 aliases=['児童手当受給者'])
all_rows += rows('jido_fuyo',      CAT_JIDO, '児童扶養手当の受給者',
                 aliases=['児童扶養手当受給者'])

# ────────────────────────────────────────────
# 3. 医療・福祉給付受給者（~0.6兆円）
# ────────────────────────────────────────────
CAT_IRY = '医療・福祉給付受給者'

all_rows += rows('iryo_teate',       CAT_IRY, '医療特別手当等受給者')
all_rows += rows('kyufukin_shogai',  CAT_IRY, '給付金受給者(特定障害者)')
all_rows += rows('sosai_jukyu',      CAT_IRY, '葬祭料受給者')
all_rows += rows('jukyu_sha',        CAT_IRY, '受給者')   # 汎用表記

# ────────────────────────────────────────────
# 4. 労働・雇用給付対象者（~2.9兆円）
# ────────────────────────────────────────────
CAT_RODO = '労働・雇用給付対象者'

all_rows += rows('kyushokusha_to',     CAT_RODO, '求職者等',
                 aliases=['求職者'])
all_rows += rows('hisai_rodosha_to',   CAT_RODO, '被災労働者等',
                 aliases=['被災労働者'])
all_rows += rows('hisai_rodosha_izo',  CAT_RODO, '被災労働者の遺族等')
all_rows += rows('hisai_iryokikan',    CAT_RODO, '被災労働者が受診した医療機関等')
all_rows += rows('seifushokuin_taisho',CAT_RODO, '政府職員等失業者退職手当の受給資格者')

# ────────────────────────────────────────────
# 5. 農業・水産補助対象者（~0.9兆円）
# ────────────────────────────────────────────
CAT_NOGY = '農業・水産補助対象者'

all_rows += rows('nogyosha_to',         CAT_NOGY, '農業者等',
                 aliases=['農業者', '農家等'])
all_rows += rows('niku_gyusha',         CAT_NOGY, '肉用牛契約生産者')
all_rows += rows('suisansha_to',        CAT_NOGY, '漁業者等',
                 aliases=['漁業者'])
all_rows += rows('ringyo_to',           CAT_NOGY, '林業者等',
                 aliases=['林業者'])

# ────────────────────────────────────────────
# 6. その他給付対象者
# ────────────────────────────────────────────
CAT_OTHER = 'その他給付対象者'

all_rows += rows('nendo_jukyusha',      CAT_OTHER, '年度受給者')


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
