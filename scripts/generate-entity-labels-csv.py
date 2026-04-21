"""
支出先名ラベリング生成スクリプト（CSV直接読み込み版）

入力: data/year_2024/5-1_RS_2024_支出先_支出情報.csv
      public/data/dictionaries/*.csv （14辞書ファイル）
出力: public/data/entity-labels-csv.json

対象レコード: 金額あり AND 支出先の合計支出額なし（個別支出先行）

実行:
  python3 scripts/generate-entity-labels-csv.py
  # または
  npm run generate-entity-labels-csv
"""

import csv
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

# ─────────────────────────────────────────────────────────────
# パス設定
# ─────────────────────────────────────────────────────────────
REPO_ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV      = os.path.join(REPO_ROOT, 'data', 'year_2024', '5-1_RS_2024_支出先_支出情報.csv')
DICT_DIR       = os.path.join(REPO_ROOT, 'public', 'data', 'dictionaries')
OUTPUT_JSON    = os.path.join(REPO_ROOT, 'public', 'data', 'entity-labels-csv.json')
HOUJIN_DB_PATH = os.path.join(REPO_ROOT, 'data', 'houjin.db')

# ─────────────────────────────────────────────────────────────
# 辞書ファイルの L1/L2 ラベル
# ─────────────────────────────────────────────────────────────
DICT_LABEL: dict[str, tuple[str, str]] = {
    'ministry_names.csv':          ('国の機関', '府省庁'),
    'ministry_from_ichiran.csv':   ('国の機関', '府省庁'),
    'ministry_supplement.csv':     ('国の機関', '府省庁'),
    'police_names.csv':            ('国の機関', '警察'),
    'prefecture_names.csv':        ('地方公共団体', '都道府県'),
    'municipality_names.csv':      ('地方公共団体', '市区町村'),
    'municipality_supplement.csv': ('地方公共団体', '市区町村'),
    'field_office_names.csv':      ('国の機関', '行政機関'),
    'foreign_agency_names.csv':    ('外国法人・国際機関', '外国政府機関'),
    'foreign_company_names.csv':   ('外国法人・国際機関', '外国企業'),
    'embassy_names.csv':           ('外国法人・国際機関', '大使館'),
    'international_org_names.csv': ('外国法人・国際機関', '国際機関'),
    'country_names.csv':           ('外国法人・国際機関', '外国'),
    'beneficiary_names.csv':       ('その他', '受益者集合'),
    'person_names.csv':            ('個人', '個人'),
}

MINISTRY_SCHEMA_COLS = {
    'ministry_names.csv':        ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit'],
    'ministry_from_ichiran.csv': ['ministry', 'bureau', 'bureau_alias', 'section'],
    'ministry_supplement.csv':   ['ministry', 'bureau', 'bureau_alias', 'section'],
}

# ─────────────────────────────────────────────────────────────
# Step 2: 格パターン（L1大分類, L2中分類, 正規表現）
# ─────────────────────────────────────────────────────────────
KAKU_PATTERNS = [
    ('民間企業',      '株式会社',            r'株式会社|[（(]株[）)]'),
    ('民間企業',      '有限会社',            r'有限会社|[（(]有[）)]'),
    ('民間企業',      '合同会社',            r'合同会社|[（(]合[）)]'),
    ('民間企業',      '合資会社',            r'合資会社'),
    ('民間企業',      '合名会社',            r'合名会社'),
    ('独立行政法人等', '国立研究開発法人',   r'国立研究開発法人'),
    ('独立行政法人等', '独立行政法人',       r'独立行政法人'),
    ('大学法人',      '国立大学法人',        r'国立大学法人'),
    ('大学法人',      '公立大学法人',        r'公立大学法人'),
    ('大学法人',      '学校法人(大学)',    r'学校法人.*大学|大学.*学校法人'),
    ('公益法人・NPO', '公益社団法人',        r'公益社団法人|[（(]公社[）)]'),
    ('公益法人・NPO', '公益財団法人',        r'公益財団法人|[（(]公財[）)]'),
    ('公益法人・NPO', '一般社団法人',        r'一般社団法人|[（(]一社[）)]'),
    ('公益法人・NPO', '一般財団法人',        r'一般財団法人|[（(]一財[）)]'),
    ('公益法人・NPO', '特定非営利活動法人',  r'特定非営利活動法人|NPO法人'),
    ('公益法人・NPO', '財団法人',            r'^財団法人'),  # 旧式財団法人（公益/一般への移行前）
    ('公益法人・NPO', '社団法人',            r'^社団法人'),  # 旧式社団法人（公益/一般への移行前）
    ('協同組合等',    '農業協同組合',        r'農業協同組合'),
    ('協同組合等',    '漁業協同組合',        r'漁業協同組合'),
    ('協同組合等',    '林業協同組合',        r'林業協同組合'),
    ('協同組合等',    '森林組合',            r'森林組合'),
    ('協同組合等',    '消費生活協同組合',    r'消費生活協同組合'),
    ('協同組合等',    '共済組合',            r'共済組合'),
    ('協同組合等',    '信用保証協会',        r'信用保証協会'),
    ('協同組合等',    '信用基金',            r'信用基金協会'),
    ('協同組合等',    '信用金庫',            r'信用金庫'),
    ('協同組合等',    '信用組合',            r'信用組合'),
    ('協同組合等',    '商工会議所',          r'商工会議所'),
    ('協同組合等',    '商工会',              r'商工会'),
    ('協同組合等',    '連合会',              r'連合会'),
    ('協同組合等',    '年金基金',            r'年金基金'),
    ('学校法人',      '学校法人',            r'学校法人'),
    ('医療・福祉法人', '社会医療法人',       r'社会医療法人'),
    ('医療・福祉法人', '医療法人',           r'医療法人'),
    ('医療・福祉法人', '社会福祉法人',       r'社会福祉法人'),
    ('医療・福祉法人', '赤十字',             r'赤十字'),
    ('医療・福祉法人', '病院',              r'病院$'),
    ('その他',       '特定団体集合',       r'^病院、訪問看護ステーション等$'),
    ('その他法人',    '宗教法人',            r'宗教法人|寺$|神社$|宮$|大社$|不動院$'),
    ('その他法人',    '互助会',              r'職員互助会'),
    ('その他法人',    '管理組合法人',        r'管理組合法人'),
    ('その他法人',    '管理組合',            r'管理組合$'),  # マンション・区分所有建物の管理組合
    ('その他法人',    '職業訓練法人',        r'職業訓練法人'),
    ('その他法人',    '投資法人',            r'投資法人'),
    ('専門職法人',    '監査法人',            r'監査法人'),
    ('専門職法人',    '弁護士法人',          r'弁護士法人'),
    ('専門職法人',    '税理士法人',          r'税理士法人'),
    ('専門職法人',    '司法書士法人',        r'司法書士法人'),
    ('専門職法人',    '社会保険労務士法人',  r'社会保険労務士法人'),
    ('専門職法人',    '弁理士法人',          r'弁理士法人'),
    ('専門職法人',    '行政書士法人',        r'行政書士法人'),
    ('専門職法人',    '土地家屋調査士法人',  r'土地家屋調査士法人'),
    # ─ 専門職系事務所（法人格なし）──────────────────────────────────────────────
    ('専門職法人',    '弁護士法人',          r'法律事務所|弁護士事務所|律師事務所'),
    ('専門職法人',    '弁理士法人',          r'特許.*事務所|知財.*事務所|知的財産.*事務所|専利.*事務所'),
    ('専門職法人',    '行政書士法人',        r'行政書士.*事務所'),
    ('専門職法人',    '税理士法人',          r'税理士.*事務所|公認会計士.*事務所|会計事務所$'),
    ('専門職法人',    '社会保険労務士法人',  r'社会保険労務士.*事務所'),
    ('専門職法人',    '土地家屋調査士法人',  r'土地家屋調査士.*事務所'),
    ('専門職法人',    '専門職法人',          r'中小企業診断士.*事務所'),
    ('専門職法人',    '弁護士会',            r'^弁護士知財ネット$'),                    # 日弁連支援の全国弁護士知財ネットワーク
    ('専門職法人',    '弁護士会',            r'弁護士会|司法書士会|税理士会|社会保険労務士会|弁理士会|行政書士会'),  # 各法律上の強制加入職能団体
    ('大学法人',      '大学共同利用機関法人', r'大学共同利用機関法人'),
    ('その他法人',    '更生保護法人',        r'更生保護法人'),
    ('その他法人',    '技術研究組合',        r'技術研究組合'),
    ('国の機関',      '刑務所',              r'刑務所'),
    ('国の機関',      '拘置所',              r'拘置所'),
    ('国の機関',      '出入国在留管理',      r'入国管理センター|出入国在留管理庁'),
    ('国の機関',      '在外公館',            r'^在.{0,10}[大総]$|^在外公館|^公館[A-Za-z\d]$'),  # 公館A〜J（匿名化）
    # ─ 国の機関 地方出先機関・独立行政法人海外拠点 ───────────────────────────────
    ('国の機関',      '地方出先機関',        r'自然環境事務所|地方環境事務所|土地改良.*事[務業]所|農地防災事[務業]所|農地管理事[務業]所|農業水利事業所|海岸保全事業所|防災事業所$|財務.*事務所$|財務局$|^四国事務所$|^地方事務所等$'),
    ('国の機関',      '地方出先機関',        r'^(?:近畿|東北|中国|四国|九州|関東|中部|北陸|北海道)局$'),  # 省庁の地方局（近畿局等・略称）
    ('国の機関',      '海外拠点',            r'^(?:ベトナム|ケニア|ブラジル|インドネシア|セネガル|タイ|コートジボワール|イラク|カンボジア|パキスタン|ロサンゼルス|ニューヨーク|ロンドン|パリ|トロント|ソウル|シンガポール|シドニー|北京|マドリード|ワシントン|サンフランシスコ|デイトン|在シェムリアップ)事務所$'),
    ('国の機関',      '海外拠点',            r'日本文化会館$'),  # パリ・ケルン・ローマ等 国際交流基金運営
    ('国の機関',      '海外拠点',            r'日本文化センター$'),  # シドニー・NY・ソウル・北京等 国際交流基金運営
    ('国の機関',      '矯正施設',            r'矯正医療センター|社会復帰促進センター'),  # 法務省矯正局管轄施設
    ('国の機関',      '府省庁',              r'税関$|^各府省$|^経産省$|^経産局$'),  # 略称・出先機関
    # ─ 国際機関（国連・ワクチン・感染症・環境等） ──────────────────────────────────
    ('外国法人・国際機関', '国際機関',       r'国際連合(?!協会)|UNDP|国連(?!NGO|代表部)'),
    ('外国法人・国際機関', '国際機関',       r'グローバルファンド|世界エイズ.*結核.*マラリア対策基金|COVAX|Gaviワクチンアライアンス|CEPI|感染症流行対策イノベーション連合'),
    ('外国法人・国際機関', '国際機関',       r'IGAD|東アジア.*(?:アセアン|ASEAN)経済研究センター|アセアン事務局|ASEAN事務局|モントリオール議定書.*(?:基金|事務局)'),
    ('外国法人・国際機関', '国際機関',       r'条約.*(?:事務局|機関|センター|ユニット)|包括的核実験禁止条約機関|北大西洋条約機構'),
    ('外国法人・国際機関', '国際機関',       r'まぐろ.*委員会|漁業委員会|メコン河委員会|日[・]ASEAN.*委員会'),
    ('外国法人・国際機関', '国際機関',       r'ASEAN\+3|ASEAN.*(?:センター|事務局|投資|貿易)|東アジア・ASEAN'),  # ASEAN系国際機関
    ('外国法人・国際機関', '国際機関',       r'軍縮.*(?:センター|不拡散)|漁業開発センター|OECD.*センター|OECDアジア|地球変動.*センター'),  # 国際開発センター系
    ('外国法人・国際機関', '国際機関',       r'国際貿易センター|国際地震センター|地雷除去.*センター|国際科学技術センター'),
    ('外国法人・国際機関', '国際機関',       r'気候技術センター|国際共同組合同盟|日独センター|欧州評議会'),  # CTCN・欧州評議会等
    ('外国法人・国際機関', '国際機関',       r'(?:APEC|OAS|PIF|SAARC|GEO|MOPAN|APG|PECC|ABAC|RCEP|カリコム|日中韓|国際獣疫|国際穀物|博覧会国際).*事務局$'),  # 国際機関事務局
    ('地方公共法人',  '土地開発公社',        r'土地開発公社'),
    ('地方公共法人',  '住宅供給公社',        r'住宅供給公社'),
    ('地方公共法人',  '高速道路公社',        r'高速道路公社'),
    ('地方公共法人',  '道路公社',            r'道路公社'),
    ('地方公共法人',  '港務局',              r'港務局'),
    ('地方公共団体',  '市区町村',            r'^[^\s]{2,5}(?:都|道|府|県)[^\s]{2,10}(?:市|区|町|村)$'),
    ('地方公共団体',  '市区町村',            r'^.{2,6}[市区町村]\([^)]+[都道府県]\)$'),
    ('地方公共団体',  '広域連合',            r'広域連合'),
    ('地方公共団体',  '企業団',              r'企業団(?!体)'),
    ('地方公共団体',  '企業局',              r'[都道府県市]企業局'),
    ('地方公共団体',  '一部事務組合',        r'事務組合'),
    ('地方公共団体',  '一部事務組合',        r'広域行政組合|広域市町村圏.*組合|衛生処理組合|衛生センター組合|広域組合$'),  # 広域行政組合・衛生処理組合等
    ('地方公共団体',  '環境組合',            r'衛生管理組合|廃棄物処理組合|環境施設組合|環境整備施設組合|清掃施設組合|衛生施設組合|環境整備事業組合|環境衛生組合'),
    ('地方公共団体',  '港湾管理組合',        r'港管理組合'),
    ('地方公共団体',  '病院組合',            r'病院組合|医療厚生組合'),
    ('地方公共団体',  '消防組合',            r'消防組合'),
    ('地方公共団体',  '試験場',              r'試験場$'),   # 道県立農業・畜産・林業試験場
    ('協同組合等',    '農林中央金庫',        r'農林中央金庫'),
    ('協同組合等',    '信用金庫',            r'信金中央金庫'),   # 信用金庫の中央銀行機能
    ('協同組合等',    '農事組合法人',        r'農事組合法人'),
    ('協同組合等',    '生産組合',            r'生産組合'),   # 野菜・飼料・水産等の農林水産業生産組合
    ('協同組合等',    '生活協同組合',        r'生活協同組合'),  # 生協（消費生活協同組合 より広い）
    ('協同組合等',    '企業組合',            r'企業組合'),   # 中小企業等協同組合法の企業組合
    ('協同組合等',    '協業組合',            r'協業組合'),   # 共同生産・施設の協業組合
    ('協同組合等',    '林業組合',            r'造林組合'),   # 地域造林組合
    ('協同組合等',    '土地改良区',          r'土地改良区'),
    ('協同組合等',    '保険組合',            r'健康保険組合|保険組合'),
    ('協同組合等',    '再開発組合',          r'再開発組合|土地区画整理組合'),
    ('協同組合等',    '事業協同組合',        r'事業協同組合'),
    ('協同組合等',    '中小企業団体中央会',  r'(?<!全国)中小企業団体中央会'),
    ('協同組合等',    '業界団体',            r'中央会$'),                      # 日本酒造組合中央会・沖縄県酒造組合中央会等
    ('協同組合等',    '業界団体',            r'連盟$'),                        # 石油連盟・日本映像ソフト協会連盟等
    ('協同組合等',    '労働組合',            r'総連合$|労働組合総連合$'),      # 全国建設労働組合総連合等
    ('民間企業',      'SPC（特定目的会社）', r'特定目的会社'),                 # 羽田みらい特定目的会社等
    ('民間企業',      '保険会社',            r'相互会社$'),                    # 富国生命保険相互会社・明治安田生命保険相互会社等
    ('コンソーシアム・共同体', '共同企業体', r'共同企業体|協働企業体'),
    ('コンソーシアム・共同体', 'JV',         r'JV$'),
    ('コンソーシアム・共同体', '共同提案体', r'共同提案体'),
    ('コンソーシアム・共同体', '共同研究体', r'共同研究体'),
    ('コンソーシアム・共同体', '共同事業体', r'共同事業体'),
    ('コンソーシアム・共同体', '共同体',     r'共同体'),
    ('コンソーシアム・共同体', '受託企業体', r'受託企業体'),
    ('コンソーシアム・共同体', 'コンソーシアム', r'コンソーシアム'),
    ('協議会',        '協議会',              r'協議会'),
    ('実行委員会等',  '実行委員会',          r'実行委員会'),
    ('実行委員会等',  '運営委員会',          r'運営委員会'),
    ('実行委員会等',  '組織委員会',          r'組織委員会'),
    ('実行委員会等',  '実行委員会',          r'イベント主催団体[A-Za-z\d]'),  # イベント主催団体A〜H
    ('実行委員会等',  '実行委員会',          r'^カルテット事務局$'),          # 文化芸術系国内事務局
    ('地方公共団体', '地方公共団体集合',   r'^他[0-9]+(都道府県|道府県|府県)$'),          # 他37都道府県等
    ('地方公共団体', '地方公共団体集合',   r'^地方公共団体\d+$'),                          # 地方公共団体1等（匿名化）
    ('国の機関',    '行政機関集合',       r'^他[0-9]+.*(局|庁)'),                         # 他37局・他37都道府県労働局等
    ('その他',       '特定団体集合',       r'^他[0-9]+医療機関'),                          # 他429医療機関等
    ('その他',       '不明',              r'^他[0-9]+'),                                   # 他88者等（種別不明の集合）
    ('その他',       '不明',              r'支出先上位\d+者以降|以降補助事業$'),  # 支出先上位11者以降補助事業等
    ('国の機関',    '行政機関集合',       r'^その他[\(（]?\d+局[\)）]?$'),       # その他37局・その他(37局)等
    # ─ 国の機関 局種別フォールバック（辞書未収録エントリ用） ─────────────────
    ('国の機関',    '労働局',             r'^.+労働局$'),                       # 都道府県別労働局（辞書未収録）
    ('国の機関',    '法務局',             r'法務局'),                           # 地方法務局・支局等
    ('国の機関',    '地方整備局',         r'地方整備局|整備局$'),               # 国土交通省地方整備局
    ('国の機関',    '農政局',             r'農政局'),                           # 農林水産省農政局
    ('国の機関',    '運輸局',             r'運輸局$'),                          # 国土交通省運輸局
    ('国の機関',    '経済産業局',         r'経済産業局'),                       # 経済産業省地方局・単体表記
    ('国の機関',    '管区警察局',         r'管区警察局|警察支局$'),             # 警察庁管区警察局
    ('国の機関',    '厚生局',             r'厚生局'),                           # 厚生労働省厚生局・支局
    ('国の機関',    '公安調査局',         r'公安調査局'),                       # 法務省公安調査局
    ('国の機関',    '防衛局',             r'防衛局$|防衛支局$'),                # 防衛省防衛局・支局
    ('国の機関',    '森林管理局',         r'森林管理局'),                       # 林野庁森林管理局
    ('国の機関',    '出入国在留管理局',   r'出入国在留管理局'),                 # 出入国在留管理庁地方局
    ('国の機関',    '総合通信局',         r'総合通信局'),                       # 総務省総合通信局
    ('国の機関',    '航空局',             r'航空局$'),                          # 国土交通省航空局
    ('国の機関',    '国税局',             r'国税局$'),                          # 国税庁国税局
    ('国の機関',    '開発局',             r'開発局$'),                          # 北海道開発局等
    ('その他',       '特定団体集合',       r'^その他.*センター連合|^その他.*センター運営法人'),  # その他シルバー人材センター連合等
    ('その他',       'プレースホルダー',   r'^その他$|^その他の支出先$|^その他支出先$|^その他の支出$|^その他契約$'),
    ('民間企業',      '民間企業(集合)',    r'その他民間|^その他事業者$|その他[（(]?[0-9]+社[）)]?|その他[0-9]+社|その他の?社$|^民間企業$|^民間企業等|^民間企業[A-Za-z]|補助事業者\(民間企業\)|^企業[A-Za-z]{1,2}$|^地域企業[A-Za-z]$'),
    ('外国法人・国際機関', '外国企業',        r'^外国企業|所在企業$'),
    ('外国法人・国際機関', '外国企業(集合)', r'^海外法人\d'),
    ('外国法人・国際機関', '海外日本人学校',   r'日本人学校.*(?:理事会|維持会|審議会|運営会)|日本語補習校.*理事会|各公館が管轄する日本人学校'),  # 在外邦人子女教育機関
    ('外国法人・国際機関', '外国政府',        r'共和国政府|独立国政府|州政府'),  # ペリリュー州政府・マーシャル諸島共和国政府等
    ('外国法人・国際機関', '外国政府',        r'(?:中国|米国|英国|仏国|独国|インドネシア|パプアニューギニア)外交部|(?:中国|米国|英国)(?:国務省|政府(?:省|庁|部))'),  # 中国外交部・米国国務省等
    ('外国法人・国際機関', '国際機関',        r'多数国間投資保証機関'),  # MIGA (World Bank Group)
    ('外国法人・国際機関', '国際機関',        r'ロス.*ダメージ.*基金|損失.*損害.*基金|気候変動.*基金'),  # 気候損失・損害基金等
    ('外国法人・国際機関', '外国企業',        r'公司'),  # 中国語圏の企業（有限公司・股份有限公司等）
    ('外国法人・国際機関', '外国企業',        r'リミテッド$|インコーポレーテッド$|インコーポレイテッド$|インコーポレイティッド$|コーポレーション$'),  # 外来語表記の法人格（全角・バリエーション）
    ('外国法人・国際機関', '外国企業',        r'(?<!\w)AS$'),  # ノルウェー・デンマーク等の株式会社サフィックス
    ('外国法人・国際機関', '外国企業',        r'(?<!\w)AB$'),  # スウェーデン/フィンランドAktiebolag
    ('外国法人・国際機関', '外国企業',        r'(?i)\bUnlimited Company\b'),  # アイルランド無限責任会社
    ('外国法人・国際機関', '外国',            r'^コンゴ[(（]民[)）]$'),   # コンゴ民主共和国（略称）
    # ─ 英語圏・欧州企業サフィックス ────────────────────────────────────────────────
    ('外国法人・国際機関', '外国企業',        r'(?i)\bInc\.?\b|\bCorp(?:oration)?\.?\b|\bLLC\b|\bLimited\b|\bLtd[a]?\.?\b|\bPty\.?\b|\bPLC\b|\bPvt\.?\b|\bLLP\b'),
    ('外国法人・国際機関', '外国企業',        r'\bB\.V\.|\bN\.V\.|\bGmbH\b|\bAG\b|\bS\.A(?:\.S?|\.[A-Z])?\.?(?=\b|$)|SAS$'),
    ('医療・福祉法人', '医療機関(集合)',   r'^その他.*(?:医療機関|補装具業者|補装具の制作業者)'),
    ('協同組合等',    '漁業者',              r'^その他.*漁業者'),
    ('協同組合等',    '漁業者',              r'漁業者$'),        # 沿岸漁業者等（「その他〜」以外の漁業者集合）
    ('協同組合等',    '漁業協同組合',        r'漁業共済加入組合'),  # ほたて・さけ等の漁業共済組合
    ('事業者',        '個人事業主',          r'個人事業[主者]'),
    ('事業者',        '民間事業者',          r'民間事業者'),
    ('事業者',        '補助事業者',          r'補助事業者'),
    ('事業者',        '事業主',              r'事業主'),
    ('事業者',        '事業者',              r'事業者'),
    ('事業者',        '事業者',              r'生産者'),  # 肉用子牛契約生産者・生産者ア〜コ等
    ('事業者',        '事業者',              r'^構成農業者'),  # 構成農業者等（集落営農等への補助金）
    ('個人',          '弁護士',              r'^個人[A-Za-z\d]弁護士'),          # 個人A弁護士等
    ('個人',          '個人',                r'^個人'),
    ('個人',          '在外研究員',          r'^在外研究員'),
    ('個人',          '在外出張者',          r'^在外出張者'),
    ('個人',          '出張者',              r'^出張者|^[（(][A-Za-z\d][）)]出張者'),
    ('個人',          '個人',                r'^研修生[A-Za-z\d]'),
    # ─ 匿名化個人 ────────────────────────────────────────────────────────────────
    ('個人',          '弁護士',              r'^弁護士[\u4e00-\u9fff]+$'),      # 弁護士児島幸良等（弁護士+漢字人名）
    ('個人',          '弁護士',              r'^弁護士[A-Za-z\d]$'),            # 弁護士A〜I（匿名化）
    ('個人',          '個人',                r'^学生[A-Za-z\d]$'),             # 学生A〜J
    ('個人',          '個人',                r'^[A-Z]氏$'),                    # A氏〜J氏
    ('その他',       'プレースホルダー',    r'^[A-Z]$'),                       # 匿名化エントリ（A〜J等・単一英字）
    ('個人',          '個人',                r'^外国人(?:講師)?[A-Za-z\d]'),   # 外国人A, 外国人講師A
    ('個人',          '個人',                r'^参与[A-Za-z\d]$|外務省参与'),  # 参与A, 外務省参与(1名)
    ('個人',          '個人',                r'^留学アドバイザー[A-Za-z\d]'),  # 留学アドバイザーA〜
    ('事業者',        '個人事業主',          r'フリーランス'),                  # 藤田雅弘(フリーランス)等
    ('個人',          '個人',                r'有識者'),                        # 外部有識者等
    ('個人',          '個人',                r'[(（]個人[)）]'),               # 米国(個人)・香港(個人)等
    ('個人',          '個人',                r'^学生$|^学生[(（]'),            # 学生・学生(協定派遣)等
    ('個人',          '個人',                r'大学.*学生$|大学院.*学生$'),     # 産業医科大学学生等
    ('個人',          '弁護士',              r'国選弁護|契約弁護士|常勤弁護士'),  # 国選弁護人・契約弁護士・常勤弁護士（個人弁護士）
    ('個人',          '個人',                r'就職支援ナビゲーター|ナビゲーター(?:等|[A-Z])'),  # 就職支援ナビゲーター等
    ('事業者',        '事業者',              r'^農家[A-Za-z\d]'),
    ('個人',          '土地所有者',          r'土地所有者'),
    ('個人',          '建物所有者',          r'建物所有者'),
    ('人件費',        '人件費',              r'人件費'),
    ('人件費',        '職員',                r'職員(?!厚生会|互助会)'),
    ('経費',          '経費',                r'経費'),
    ('経費',          '管理費',              r'管理費'),
    ('経費',          '事業費',              r'事業費'),
    ('経費',          '示達',                r'示達'),
    ('経費',          '繰入れ',              r'への繰入れ$|勘定への繰入れ'),   # ○○勘定への繰入れ
    ('経費',          '特別会計',            r'特別会計$|特別会計.*勘定$'),    # 食料安定供給特別会計・農業再保険勘定等
    ('経費',          '勘定',               r'年金勘定$|勘定$'),              # 基礎年金勘定・国民年金勘定等
    ('経費',          '庁費',               r'庁費$'),                        # 審査審判庁費等
    # ─ 事業（事業名・業務名・費目名が支出先欄に混入したもの） ────────────────────────
    ('事業', 'プロジェクト名', r'プロジェクト$|の構築$'),                   # SIP/BRIDGE等 研究課題名・システム構築名
    ('事業', '業務名',        r'関係業務$|に関する業務$|推進業務$|推進事業$|製表事業$|支援事業$|発展支援事業$'),  # 委託業務・委託事業の名称
    ('事業', '費目名',        r'^調査費$|^補助金$|^補助金執行$|^研究業務費$|^審査業務費$|^事務費$|^積立・繰越金$|^法人共通$|^法人$'),
    ('事業', '費目名',        r'^人権啓発活動等委託費$|^人権啓発活動等補助金$'),
    ('その他',       '受益者集合',          r'^利水者|^農業者年金|^被保険者|^退職者|^留学生|^研修生$|^給付対象者'),
    ('その他',       '受益者集合',          r'^ハンセン病療養所.*退所者'),  # ハンセン病補償給付金等
    ('その他',       '受益者集合',          r'^文化功労者$'),  # 文化庁文化功労者補償金
    ('その他',       '受益者集合',          r'^申請人$'),      # 特許・審査等の申請者
    ('その他',       '受益者集合',          r'^通訳人$'),      # 裁判所・刑事司法機関の通訳人
    ('民間企業',      '金融機関',          r'^金融機関'),                  # 金融機関への借入金返済・融資等
    # ─ 匿名化法人・企業 フォールバック ─────────────────────────────────────────
    ('事業者',        '事業者',              r'^[A-Za-z]事業所$'),          # A事業所〜J事業所（匿名化）
    ('事業者',        '事業者',              r'認定職業訓練実施機関[A-Za-z\d]+'),  # 認定職業訓練実施機関A〜J
    ('民間企業',      '民間企業(集合)',    r'^設置法人\d+$'),              # 設置法人10〜14（匿名化）
    ('民間企業',      '民間企業(集合)',    r'広告代理店[A-Za-z\d]?$|^旅行代理店$|^海外旅行代理店$|^現地旅行代理店'),  # 代理店系
    ('民間企業',      '民間企業(集合)',    r'^メディア媒体[A-Za-z\d]'),        # メディア媒体A〜H（匿名化）
    ('民間企業',      '民間企業',          r'新聞社$'),                        # 日本経済新聞社等
    ('公益法人・NPO', '学会',               r'学会$'),      # 学術学会等
    ('公益法人・NPO', '協会',               r'協会$'),      # 法人格記載のない業界・産地振興協会等（信用保証協会等の後ろに配置）
    ('公益法人・NPO', '振興会',             r'振興会$'),    # 茶業振興会・糖業振興会等
    ('外国法人・国際機関', '国際機関',       r'北大西洋海産哺乳類動物委員会|アジア.*アフリカ.*法律諮問委員会|みなみまぐろ保存委員会'),
    ('協同組合等',    '協同組合',            r'協同組合'),                  # フォールバック（農業・漁業・事業協同組合等の特定パターンが先勝ち）
    ('協同組合等',    '協同組合',            r'地主組合|地主会$'),            # 空港・軍用地等の地主の協同組合
    ('民間企業',      '民間企業(集合)',    r'[A-Za-z]{1,3}社$'),          # A社, トライアル雇用助成金を受給しているA社 等
    ('民間企業',      '民間企業(集合)',    r'(?<![式限同資名])会社[A-Za-z\d]'),  # 会社A, 民間会社G, 調査会社A, コンサル会社A（株式/有限/合同/合資/合名を除外）
    ('民間企業',      '民間企業(集合)',    r'法人[A-Za-z\d]$'),           # 法人A, 人材開発支援助成金を受給する法人A 等
    ('民間企業',      '民間企業(集合)',    r'^コンサル[A-Za-z\d]'),       # コンサルA, コンサルJ
    ('事業者',        '事業者',              r'^農業法人'),                 # 農業法人A〜F
    ('事業者',        '事業者',              r'集落$'),                     # 別海町集落・標茶集落等（農業集落の補助金受給主体）
    ('民間企業',      '民間企業',            r'林業$'),                     # 盛林業・嘉瀬林業等（林業会社・個人事業主）
    ('大学法人',      '大学',                r'大学$'),                     # フォールバック（外国大学・匿名化大学等、国立/公立/学校法人パターン非適用のもの）
    # ─ 匿名化個人・業者 フォールバック（既存の職員/事業者パターンが優先）─────────
    ('事業者',        '事業者',              r'^農業者'),   # 農業者/農業者等/農業者等A (農業者年金は受益者パターンが先勝ち)
    ('事業者',        '事業者',              r'^漁業者'),   # 漁業者等/漁業者等A (^その他.*漁業者は協同組合等が先勝ち)
    ('事業者',        '事業者',              r'業者[A-Za-z\d]'),
    ('個人',          '個人',                r'(?<!業)者等?[A-Za-z\d（(]'),
    ('個人',          '個人',                r'員[A-Za-z\d（(]'),
]

KAKU_COMPILED = [(l1, l2, re.compile(pat)) for l1, l2, pat in KAKU_PATTERNS]
SEPARATORS    = re.compile(r'[・、]')

# 同形文字（キリル文字→ラテン文字）正規化テーブル（マッチング専用・出力名には不使用）
_HOMOGLYPH_TABLE = str.maketrans({
    'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I',
    'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X',
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x',
})

def _normalize_for_match(name: str) -> str:
    """パターンマッチング専用の正規化（出力名には使わない）"""
    return name.translate(_HOMOGLYPH_TABLE)

# コンソーシアム・共同体バイパス
_CONSORTIUM_SUBS = [
    ('共同企業体',    re.compile(r'共同企業体|協働企業体')),
    ('共同提案体',    re.compile(r'共同提案体')),
    ('共同研究体',    re.compile(r'共同研究体')),
    ('共同事業体',    re.compile(r'共同事業体')),
    ('共同体',        re.compile(r'共同体')),
    ('コンソーシアム', re.compile(r'コンソーシアム')),
]
_CONSORTIUM_ANY = re.compile(r'共同企業体|協働企業体|共同提案体|共同研究体|共同事業体|共同体|コンソーシアム')


def is_skip_target(name: str) -> bool:
    """複合名称（A社・B社形式）をスキップ対象として検出"""
    # 法人格名で始まる場合は単一法人として扱う（例: 一般社団法人○○・△△協議会、弁護士法人○○・△△法律事務所）
    if re.match(r'^(?:一般|公益)(?:社団|財団)法人|^(?:弁護士|監査|税理士|司法書士|弁理士|行政書士|社会保険労務士|土地家屋調査士)法人', name):
        return False
    # 独立行政法人・国立研究開発法人で始まる場合も単一法人（「独立行政法人○○・○○機構...への繰入れ」等）
    if re.match(r'^(?:独立行政法人|国立研究開発法人|国立大学法人|公立大学法人)', name):
        return False
    # 特定非営利活動法人（NPO）は名称に・が含まれても単一法人
    if re.match(r'^特定非営利活動法人', name):
        return False
    # 株式会社で始まる場合は単一法人（例: 株式会社○○・コーポレーション）
    if re.match(r'^株式会社', name):
        return False
    if not SEPARATORS.search(name):
        return False
    segments = SEPARATORS.split(name)
    kaku_segments = sum(
        1 for seg in segments
        if any(pat.search(seg) for _, _, pat in KAKU_COMPILED)
    )
    return kaku_segments >= 2


# ─────────────────────────────────────────────────────────────
# Step 1: 辞書ロード（name → (l1, l2)）
# ─────────────────────────────────────────────────────────────
def load_dict_labels(dict_dir: str) -> tuple[dict[str, tuple[str, str]], list[tuple[re.Pattern, str, str]]]:
    """各辞書 CSV からラベルマップを構築: ({name → (l1, l2)}, [(regex, l1, l2)])"""
    result: dict[str, tuple[str, str]] = {}
    regex_entries: list[tuple[re.Pattern, str, str]] = []

    for fname in sorted(os.listdir(dict_dir)):
        if not fname.endswith('.csv'):
            continue
        if fname in ('special_corporation_names.csv', 'aggregate_names.csv'):
            continue

        fpath = os.path.join(dict_dir, fname)
        with open(fpath, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []

            if fname in MINISTRY_SCHEMA_COLS:
                l1, l2 = DICT_LABEL.get(fname, ('国の機関', '府省庁'))
                for row in reader:
                    for col in MINISTRY_SCHEMA_COLS[fname]:
                        val = row.get(col, '').strip()
                        if val and val not in result:
                            result[val] = (l1, l2)

            elif 'name' in fieldnames and fname in DICT_LABEL:
                l1, l2_default = DICT_LABEL[fname]
                has_match_type = 'match_type' in fieldnames
                has_l2_col = 'l2' in fieldnames  # per-row l2 override (e.g. field_office_names.csv)
                for row in reader:
                    name = row.get('name', '').strip()
                    if not name or name.startswith('#'):
                        continue
                    row_l2 = row.get('l2', '').strip() if has_l2_col else ''
                    l2 = row_l2 if row_l2 else l2_default
                    if has_match_type and row.get('match_type', '').strip() == 'regex':
                        try:
                            regex_entries.append((re.compile(name), l1, l2))
                        except re.error:
                            pass
                        continue
                    if name not in result:
                        result[name] = (l1, l2)

    # special_corporation_names.csv: special_subtype → L2
    special_path = os.path.join(dict_dir, 'special_corporation_names.csv')
    if os.path.exists(special_path):
        with open(special_path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('name', '').strip()
                if not name:
                    continue
                subtype = row.get('special_subtype', '').strip()
                l2 = '特殊会社' if subtype.startswith('特殊会社') else '特殊法人'
                if name not in result:
                    result[name] = ('特殊法人・特別の法人', l2)

    # aggregate_names.csv: category → (L1, L2) マッピング
    _AGG_L1: dict[str, str] = {
        '都道府県':    '地方公共団体',
        '市区町村':    '地方公共団体',
        '地方公共団体': '地方公共団体',
        '行政機関':    '国の機関',
        '国際機関':    'その他',
        '受益者':      'その他',
    }
    _AGG_CATEGORY_L2: dict[str, str] = {
        '都道府県':    '地方公共団体集合',
        '市区町村':    '地方公共団体集合',
        '地方公共団体': '地方公共団体集合',
        '行政機関':    '行政機関集合',
        '国際機関':    '特定団体集合',
        '受益者':      '受益者集合',
    }
    # 名称単位の特例（category で一括処理できないもの）
    _AGG_NAME_OVERRIDE_L1: dict[str, str] = {
        '都道府県が適当と認めた団体': 'その他',
    }
    _AGG_NAME_OVERRIDE_L2: dict[str, str] = {
        '都道府県が適当と認めた団体': '特定団体集合',  # 地方公共団体とは限らない指定団体
    }
    agg_path = os.path.join(dict_dir, 'aggregate_names.csv')
    if os.path.exists(agg_path):
        with open(agg_path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            # 行政機関パターンを先に追加: 都道府県パターンの部分一致（search）より
            # 具体的な行政機関パターンを優先させるため
            priority_regex: list[tuple[re.Pattern, str, str]] = []
            other_regex: list[tuple[re.Pattern, str, str]] = []
            for row in reader:
                name = row.get('name', '').strip()
                category = row.get('category', '').strip()
                match_type = row.get('match_type', '').strip()
                if not name:
                    continue
                l1 = _AGG_NAME_OVERRIDE_L1.get(name) or _AGG_L1.get(category, 'その他')
                l2 = _AGG_NAME_OVERRIDE_L2.get(name) or _AGG_CATEGORY_L2.get(category, '不明')
                if match_type == 'regex':
                    try:
                        entry = (re.compile(name), l1, l2)
                        if category == '行政機関':
                            priority_regex.append(entry)
                        else:
                            other_regex.append(entry)
                    except re.error:
                        pass
                    continue
                if name not in result:
                    result[name] = (l1, l2)
            regex_entries.extend(priority_regex)
            regex_entries.extend(other_regex)

    return result, regex_entries


# ─────────────────────────────────────────────────────────────
# CSV 読み込み・集計
# ─────────────────────────────────────────────────────────────
def load_csv_recipients(csv_path: str):
    """
    金額あり AND 支出先の合計支出額なし の行を対象に集計。
    返却: {支出先名: {'amount': int, 'count': int, 'cn': str, 'typeCodes': set}}
    """
    name_data: dict[str, dict] = defaultdict(
        lambda: {'amount': 0, 'count': 0, 'cn': '', 'typeCodes': set()}
    )
    with open(csv_path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name        = row.get('支出先名', '').strip()
            kinryo      = row.get('金額', '').strip()
            total       = row.get('支出先の合計支出額', '').strip()

            if not name or not kinryo or total:
                continue

            try:
                amount = int(kinryo.replace(',', ''))
            except ValueError:
                continue

            d = name_data[name]
            d['amount'] += amount
            d['count']  += 1

            cn = row.get('法人番号', '').strip()
            if cn and not d['cn']:
                d['cn'] = cn

            tc = row.get('法人種別', '').strip()
            if tc:
                d['typeCodes'].add(tc)

    return dict(name_data)


# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────
def main():
    print('=== generate-entity-labels-csv.py ===')

    # ── 存在確認 ──────────────────────────────────────────────
    if not os.path.exists(INPUT_CSV):
        print(f'エラー: 入力ファイルが見つかりません: {INPUT_CSV}', file=sys.stderr)
        sys.exit(1)

    # ── CSV 集計 ──────────────────────────────────────────────
    print(f'読み込み: {INPUT_CSV}')
    name_data = load_csv_recipients(INPUT_CSV)
    all_names = sorted(name_data.keys())
    total_count = len(all_names)
    print(f'  対象ユニーク支出先名: {total_count:,}件')

    # ── Step 1: 辞書マッチング ─────────────────────────────────
    print('Step 1: 辞書ロード中...')
    dict_labels, dict_regex = load_dict_labels(DICT_DIR)
    print(f'  辞書エントリ数: {len(dict_labels):,}件（正規表現: {len(dict_regex)}件）')

    # ── Step 2: 格パターン ─────────────────────────────────────
    print('Step 2: 格パターン適用中...')
    skipped_names = {n for n in all_names if is_skip_target(n)}
    target_names  = [n for n in all_names if n not in skipped_names]

    # ラベルマップ: name → {'l1', 'l2', 'source'}
    labels: dict[str, dict] = {}

    # Step 1 を先に適用（低優先）
    dict_hits: set[str] = set()
    for name in all_names:
        if name in dict_labels:
            l1, l2 = dict_labels[name]
            labels[name] = {'l1': l1, 'l2': l2, 'source': 'dict'}
            dict_hits.add(name)
        elif dict_regex:
            norm = _normalize_for_match(name)
            for pat, l1, l2 in dict_regex:
                if pat.search(norm):
                    labels[name] = {'l1': l1, 'l2': l2, 'source': 'dict'}
                    dict_hits.add(name)
                    break

    # Step 2 を適用（高優先）
    kaku_hits: set[str] = set()
    for name in target_names:
        norm = _normalize_for_match(name)
        matched = [(l1, l2) for l1, l2, pat in KAKU_COMPILED if pat.search(norm)]
        if matched:
            l1, l2 = matched[0]
            source = 'both' if name in dict_hits else 'kaku'
            labels[name] = {'l1': l1, 'l2': l2, 'source': source}
            kaku_hits.add(name)

    # コンソーシアム・共同体バイパス
    bypass_count = 0
    for name in skipped_names:
        if _CONSORTIUM_ANY.search(name):
            l2 = 'コンソーシアム'
            for l2_label, pat in _CONSORTIUM_SUBS:
                if pat.search(name):
                    l2 = l2_label
                    break
            source = 'both' if name in dict_hits else 'kaku'
            labels[name] = {'l1': 'コンソーシアム・共同体', 'l2': l2, 'source': source}
            kaku_hits.add(name)
            bypass_count += 1

    print(f'  スキップ対象（複合名称）: {len(skipped_names):,}件  うちバイパス: {bypass_count}件')

    # ── Step 3: 法人番号 → houjin.db 公式名称 → 辞書/格パターン ──
    step3_count = 0
    if os.path.exists(HOUJIN_DB_PATH):
        print('Step 3: houjin.db 公式名称ルックアップ中...')
        conn = sqlite3.connect(f'file:{HOUJIN_DB_PATH}?mode=ro', uri=True)
        cur  = conn.cursor()
        for name in all_names:
            if name in labels:
                continue
            cn = name_data[name]['cn']
            if not cn:
                continue
            row = cur.execute(
                'SELECT name FROM houjin WHERE corporate_number = ?', (cn,)
            ).fetchone()
            if not row:
                continue
            official = row[0]
            norm_off = _normalize_for_match(official)

            # Step 1a: 辞書完全一致
            if official in dict_labels:
                l1, l2 = dict_labels[official]
                labels[name] = {'l1': l1, 'l2': l2, 'source': 'cn_lookup'}
                step3_count += 1
                continue

            # Step 1b: 辞書正規表現
            matched_dict = False
            for pat, l1, l2 in dict_regex:
                if pat.search(norm_off):
                    labels[name] = {'l1': l1, 'l2': l2, 'source': 'cn_lookup'}
                    step3_count += 1
                    matched_dict = True
                    break
            if matched_dict:
                continue

            # Step 2: 格パターン
            if not is_skip_target(official):
                for l1, l2, pat in KAKU_COMPILED:
                    if pat.search(norm_off):
                        labels[name] = {'l1': l1, 'l2': l2, 'source': 'cn_lookup'}
                        step3_count += 1
                        break
        conn.close()
        print(f'  ラベル付与（Step 3）: {step3_count:,}件')
    else:
        print('Step 3: houjin.db が見つかりません（スキップ）')

    labeled_count = len(labels)
    print(f'  合計ラベル付与: {labeled_count:,}件 / {total_count:,}件 = {labeled_count/total_count*100:.1f}%')

    # L1 分布を表示
    from collections import Counter
    l1_counts = Counter(v['l1'] for v in labels.values())
    print('\n[L1 分布]')
    for l1, cnt in sorted(l1_counts.items(), key=lambda x: -x[1]):
        print(f'  {l1:<24s}: {cnt:6,}件')

    # ── JSON 組み立て ──────────────────────────────────────────
    output = []
    for name in all_names:
        d     = name_data[name]
        label = labels.get(name)
        output.append({
            'name':      name,
            'l1':        label['l1'] if label else None,
            'l2':        label['l2'] if label else None,
            'source':    label['source'] if label else 'none',
            'amount':    d['amount'],
            'count':     d['count'],
            'cn':        d['cn'],
            'typeCodes': sorted(d['typeCodes']),
        })

    # ── 出力 ──────────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=None, separators=(',', ':'))

    size_kb = os.path.getsize(OUTPUT_JSON) / 1024
    print(f'\n出力: {OUTPUT_JSON}')
    print(f'  ファイルサイズ: {size_kb:.1f} KB ({size_kb/1024:.2f} MB)')
    print('完了')


if __name__ == '__main__':
    main()
