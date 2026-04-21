"""
国際機関 辞書生成スクリプト
出力: data/result/international_org_names.csv

支出実績に出現する国連機関・国際開発機関・その他国際機関を収録する。
日本国内の「国際」を冠する法人（独立行政法人・株式会社等）は対象外。

スキーマ:
  org_id         : 一意ID（英語略称ベース）
  org_type       : 機関分類
  canonical_name : 主要な日本語名称
  name           : マッチング用名称（canonical + alias）
  name_type      : canonical / alias

データソース: 支出実績データから抽出・手動整理（2026-02-22）
"""

import csv
import os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'international_org_names.csv')
FIELDNAMES = ['org_id', 'org_type', 'canonical_name', 'name', 'name_type']

def rows(org_id, org_type, canonical, aliases=None):
    result = [{
        'org_id':        org_id,
        'org_type':      org_type,
        'canonical_name': canonical,
        'name':          canonical,
        'name_type':     'canonical',
    }]
    for alias in (aliases or []):
        result.append({
            'org_id':        org_id,
            'org_type':      org_type,
            'canonical_name': canonical,
            'name':          alias,
            'name_type':     'alias',
        })
    return result

all_rows = []

# ────────────────────────────────────────────
# 1. 国連システム（UN System）
# ────────────────────────────────────────────
TYPE_UN = '国連システム'

all_rows += rows('un',       TYPE_UN, '国際連合',
                 aliases=['国連', '国連事務局', '国際連合事務局'])
all_rows += rows('undp',     TYPE_UN, '国際連合開発計画',
                 aliases=['国連開発計画(UNDP)', 'UNDP', '国連開発計画'])
all_rows += rows('unido',    TYPE_UN, '国際連合工業開発機関',
                 aliases=['国連工業開発機関(UNIDO)'])
all_rows += rows('wfp',      TYPE_UN, '国際連合世界食糧計画',
                 aliases=['国連世界食糧計画', '世界食糧計画(WFP)'])
all_rows += rows('unicef',   TYPE_UN, '国際連合児童基金',
                 aliases=['国連児童基金(UNICEF)', 'UNICEF'])
all_rows += rows('unhcr',    TYPE_UN, '国際連合難民高等弁務官事務所',
                 aliases=['国連難民高等弁務官事務所(UNHCR)'])
all_rows += rows('fao',      TYPE_UN, '国際連合食糧農業機関',
                 aliases=['国際連合食糧農業機関事務局', '国連食糧農業機関(FAO)', 'FAO'])
all_rows += rows('unesco',   TYPE_UN, '国際連合教育科学文化機関',
                 aliases=['国連教育科学文化機関(UNESCO)', 'UNESCO'])
all_rows += rows('unfpa',    TYPE_UN, '国際連合人口基金',
                 aliases=['国連人口基金(UNFPA)'])
all_rows += rows('unep',     TYPE_UN, '国際連合環境計画',
                 aliases=['国連環境計画(UNEP)', 'UNEP', '国連環境計画', '日本国連環境計画',
                           '国連環境計画アジア太平洋事務所',
                           'EANET事務局(国連環境計画(UNEP)アジア太平洋事務所)',
                           '国連環境計画(UNEP)国際環境技術センター(IETC)'])
all_rows += rows('unhabitat',TYPE_UN, '国際連合人間居住計画(UN-Habitat)',
                 aliases=['国連人間居住計画', '国際連合人間居住計画(UNーHabitat)',
                           '国連人間の安全保障ユニット'])
all_rows += rows('unops',    TYPE_UN, '国際連合プロジェクト・サービス機関',
                 aliases=['国連プロジェクト・サービス機関(UNOPS)'])
all_rows += rows('unodc',    TYPE_UN, '国際連合薬物犯罪事務所',
                 aliases=['国際連合薬物犯罪事務所(UNODC)', '国連薬物犯罪事務所(UNODC)',
                           '国連薬物犯罪事務所'])
all_rows += rows('unrwa',    TYPE_UN, '国際連合パレスチナ難民救済事業機関',
                 aliases=['国連パレスチナ難民救済事業機関(UNRWA)'])
all_rows += rows('unwomen',  TYPE_UN, '国連女性機関',
                 aliases=['国連女性機関(UN Women)'])
all_rows += rows('unitar',   TYPE_UN, '国連訓練調査研究所(UNITAR)',
                 aliases=['国連訓練調査研究所'])
all_rows += rows('undrr',    TYPE_UN, '国連防災機関',
                 aliases=['国連防災機関(UNDRR)事務局', '国連防災機関(UNDRR)'])
all_rows += rows('unctad',   TYPE_UN, '国連貿易開発会議',
                 aliases=['国連貿易開発会議(UNCTAD)'])
all_rows += rows('unu',      TYPE_UN, '国際連合大学',
                 aliases=['国連大学', '国連大学サステイナビリティ高等研究所'])
all_rows += rows('dppa',     TYPE_UN, '国連政務平和構築局(DPPA)',
                 aliases=['国連平和構築支援オフィス(PBSO)', '国連平和活動局'])
all_rows += rows('unicri',   TYPE_UN, '国連地域間犯罪司法研究所(UNICRI)',
                 aliases=['国連地域間犯罪司法研究所'])
all_rows += rows('unsd',     TYPE_UN, '国連統計部',
                 aliases=['国連経済社会局(UNDESA)'])
all_rows += rows('uncef_trust', TYPE_UN, '国連特別目的信託基金',
                 aliases=['国連総会議長信託基金', '国連中央緊急対応基金',
                           '国際連合中央緊急対応基金'])
all_rows += rows('un_misc',  TYPE_UN, '国連事務局、UNICEF等派遣先国際機関',
                 aliases=['UNDP、ICAO等の派遣先国際機関',
                           '国連事務局、UNICEF等派遣先国際機関'])
all_rows += rows('unaids',   TYPE_UN, '国連合同エイズ計画',
                 aliases=['国連合同エイズ計画(UNAIDS)'])
all_rows += rows('unsc',     TYPE_UN, '国際連合安全保障理事会',
                 aliases=['国連安全保安局'])
all_rows += rows('un_disarm',TYPE_UN, '国連軍縮部',
                 aliases=['国際連合軍縮部', '国連軍縮部'])
all_rows += rows('un_pko',   TYPE_UN, '国連平和活動',
                 aliases=['国連アフガニスタン支援ミッション'])
all_rows += rows('un_regional', TYPE_UN, '国際連合地域開発センター',
                 aliases=['国連地域開発センター', '国連アジア太平洋統計社会委員会',
                           'アフリカ経済委員会', '国際連合欧州本部'])

# ────────────────────────────────────────────
# 2. 国際開発金融機関（MDB）
# ────────────────────────────────────────────
TYPE_MDB = '国際開発金融機関'

all_rows += rows('worldbank', TYPE_MDB, '国際復興開発銀行',
                 aliases=['世界銀行', 'World Bank'])
all_rows += rows('ifc',       TYPE_MDB, '国際金融公社',
                 aliases=['IFC'])
all_rows += rows('adb',       TYPE_MDB, 'アジア開発銀行',
                 aliases=['アジア開発銀行信託基金', 'ADB'])
all_rows += rows('afdb',      TYPE_MDB, 'アフリカ開発銀行',
                 aliases=['AfDB'])
all_rows += rows('iadb',      TYPE_MDB, '米州開発銀行',
                 aliases=['IDB', 'Inter-American Development Bank'])
all_rows += rows('ebrd',      TYPE_MDB, '欧州復興開発銀行',
                 aliases=['EBRD'])

# ────────────────────────────────────────────
# 3. 国連専門機関・関連機関
# ────────────────────────────────────────────
TYPE_SPEC = '国連専門機関'

all_rows += rows('iaea',     TYPE_SPEC, '国際原子力機関',
                 aliases=['国際原子力機関(IAEA)', 'IAEA'])
all_rows += rows('ilo',      TYPE_SPEC, '国際労働機関',
                 aliases=['国際労働機関(ILO)', 'ILO'])
all_rows += rows('imf',      TYPE_SPEC, '国際通貨基金',
                 aliases=['IMF'])
all_rows += rows('who',      TYPE_SPEC, '世界保健機関(WHO)',
                 aliases=['WHO', '世界保健機関'])
all_rows += rows('icao',     TYPE_SPEC, '国際民間航空機関',
                 aliases=['国際民間航空機関(ICAO)', 'ICAO'])
all_rows += rows('itu',      TYPE_SPEC, '国際電気通信連合',
                 aliases=['ITU'])
all_rows += rows('imo',      TYPE_SPEC, '国際海事機関',
                 aliases=['IMO'])
all_rows += rows('wipo',     TYPE_SPEC, '世界知的所有権機関',
                 aliases=['WIPO'])
all_rows += rows('ifad',     TYPE_SPEC, '国際農業開発基金',
                 aliases=['IFAD'])
all_rows += rows('upuu',     TYPE_SPEC, '万国郵便連合',
                 aliases=['UPU'])

# ────────────────────────────────────────────
# 4. OECD・その他経済協力機関
# ────────────────────────────────────────────
TYPE_OECD = '経済協力機関'

all_rows += rows('oecd',     TYPE_OECD, '経済協力開発機構(OECD)',
                 aliases=['OECD', '経済協力開発機構', 'OECD(経済協力開発機構)',
                           '経済協力開発機構(OECD事務局)', 'OECD事務局',
                           '経済協力開発機構・開発援助委員会(OECD・DAC)',
                           'ITE－OECD', 'OECD(経済協力開発機構)開発センター',
                           '経済協力開発機構原子力機関(OECD/NEA)'])
all_rows += rows('asean',    TYPE_OECD, '東南アジア諸国連合(ASEAN)事務局',
                 aliases=['ASEAN事務局', '日アセアン経済産業協力委員会'])
all_rows += rows('itf',      TYPE_OECD, 'ITF(国際交通フォーラム)',
                 aliases=['国際交通フォーラム(ITF)'])
all_rows += rows('iea',      TYPE_OECD, '国際エネルギー機関',
                 aliases=['国際エネルギー機関(IEA)', 'IEA', '国際エネルギー機関事務局',
                           '国際エネルギー・フォーラム', '国際エネルギーフォーラム',
                           '国際エネルギー・フォーラム事務局'])

# ────────────────────────────────────────────
# 5. その他国際機関・条約機関
# ────────────────────────────────────────────
TYPE_OTHER = 'その他国際機関'

all_rows += rows('icc',      TYPE_OTHER, '国際刑事裁判所',
                 aliases=['国際刑事裁判所被害者信託基金(ICCTFV)'])
all_rows += rows('interpol', TYPE_OTHER, '国際刑事警察機構(ICPO)',
                 aliases=['ICPO', 'Interpol'])
all_rows += rows('iter',     TYPE_OTHER, 'ITER(国際熱核融合エネルギー)機構',
                 aliases=['ITER機構'])
all_rows += rows('irena',    TYPE_OTHER, '国際再生可能エネルギー機関',
                 aliases=['国際再生可能エネルギー機関(IRENA)', 'IRENA',
                           '国際再生可能エネルギー機関事務局', '国際再生可能エネルギー機関拠出金'])
all_rows += rows('cgiar',    TYPE_OTHER, '国際農業研究協議グループ(CGIAR)',
                 aliases=['CGIAR', '国際農業研究機関'])
all_rows += rows('hfsp',     TYPE_OTHER, '国際ヒューマン・フロンティア・サイエンス・プログラム機構',
                 aliases=['HFSP'])
all_rows += rows('itto',     TYPE_OTHER, '国際熱帯木材機関(ITTO)',
                 aliases=['国際熱帯木材機関', 'ITTO'])
all_rows += rows('itlos',    TYPE_OTHER, '国際海洋法裁判所(ITLOS)',
                 aliases=['ITLOS'])
all_rows += rows('isa',      TYPE_OTHER, '国際海底機構(ISA)',
                 aliases=['国際海底機構', 'ISA'])
all_rows += rows('iom',      TYPE_OTHER, '国際移住機関',
                 aliases=['IOM'])
all_rows += rows('icrc',     TYPE_OTHER, '赤十字国際委員会',
                 aliases=['ICRC'])
all_rows += rows('ifrcs',    TYPE_OTHER, '国際赤十字・赤新月社連盟',
                 aliases=['国際赤十字赤新月社連盟', 'IFRC'])
all_rows += rows('au',       TYPE_OTHER, 'アフリカ連合(AU)',
                 aliases=['AU', 'アフリカ連合'])
all_rows += rows('iiasa',    TYPE_OTHER, '国際応用システム分析研究所(IIASA)',
                 aliases=['国際応用分析システム研究所(IIASA)', 'IIASA'])
all_rows += rows('iucn',     TYPE_OTHER, '国際自然保護連合(IUCN)',
                 aliases=['国際自然保護連合', 'IUCN'])
all_rows += rows('bimco',    TYPE_OTHER, '国際海事機関',
                 aliases=['国際航路標識協会'])
all_rows += rows('iais',     TYPE_OTHER, '保険監督者国際機構(IAIS)',
                 aliases=['IAIS'])
all_rows += rows('iosco',    TYPE_OTHER, '証券監督者国際機構(IOSCO)',
                 aliases=['証券監督者国際機構', 'IOSCO'])
all_rows += rows('bipm',     TYPE_OTHER, '国際度量衡中央事務局',
                 aliases=['BIPM'])
all_rows += rows('ippf',     TYPE_OTHER, '国際家族計画連盟(IPPF)',
                 aliases=['IPPF'])
all_rows += rows('unsc_other', TYPE_OTHER, 'その他国際機関',
                 aliases=['国際機関A', '国際機関B', '国際機関C', '国際機関D',
                           '国際機関E', '国際機関F', '国際機関G', '国際機関H',
                           '国際機関I', '国際機関J'])
all_rows += rows('iarc',     TYPE_OTHER, '国際がん研究機関(IARC)',
                 aliases=['IARC'])
all_rows += rows('iso',      TYPE_OTHER, '国際標準化機構',
                 aliases=['ISO'])
all_rows += rows('hague',    TYPE_OTHER, 'ハーグ国際私法会議事務局',
                 aliases=['ハーグ国際私法会議'])
all_rows += rows('unidroit', TYPE_OTHER, '私法統一国際協会事務局',
                 aliases=['ハーグ国際私法会議事務局'])
all_rows += rows('iccrom',   TYPE_OTHER, '文化財保存修復研究国際センター(ICCROM)',
                 aliases=['ICCROM'])
all_rows += rows('iwc',      TYPE_OTHER, '国際捕鯨委員会',
                 aliases=['IWC'])
all_rows += rows('cites_like', TYPE_OTHER, '大型クラゲ国際共同調査共同調査機関',
                 aliases=[])


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
