"""
完全一致・格分類 統合カバレッジ調査スクリプト

Step 1: public/data/dictionaries/ の全辞書（完全一致 + 正規表現）
Step 2: 格パターン（法人格分類）

実行:
  python3 scripts/analyze-label-coverage.py
"""

import csv
import os
import re
import sys
from collections import defaultdict

# ─────────────────────────────────────────────────────────────
# パス設定
# ─────────────────────────────────────────────────────────────
REPO_ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_CSV      = os.path.join(REPO_ROOT, 'data', 'result', 'recipients_without_total.csv')
DICT_DIR       = os.path.join(REPO_ROOT, 'public', 'data', 'dictionaries')
OUTPUT_CSV     = os.path.join(REPO_ROOT, 'data', 'result', 'uncovered_recipients.csv')
OUTPUT_REPORT  = os.path.join(REPO_ROOT, 'data', 'result', 'label_coverage_report.txt')


class _Tee:
    """stdout と同時にファイルへ書き出すラッパー"""
    def __init__(self, *streams):
        self._streams = streams

    def write(self, data: str) -> None:
        for s in self._streams:
            s.write(data)

    def flush(self) -> None:
        for s in self._streams:
            s.flush()

# ─────────────────────────────────────────────────────────────
# 府省庁スキーマ: name 列を持たない辞書の抽出対象列
# ─────────────────────────────────────────────────────────────
MINISTRY_SCHEMA_COLS = {
    'ministry_names.csv':       ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit'],
    'ministry_from_ichiran.csv': ['ministry', 'bureau', 'bureau_alias', 'section'],
    'ministry_supplement.csv':  ['ministry', 'bureau', 'bureau_alias', 'section'],
}

# ─────────────────────────────────────────────────────────────
# Step 2: 格パターン定義（L1大分類, L2中分類, 正規表現）
# generate-entity-labels-csv.py の KAKU_PATTERNS と同期させること
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
    ('その他法人',    '管理組合',            r'管理組合$'),
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
    ('専門職法人',    '弁護士法人',          r'法律事務所|弁護士事務所|律師事務所'),
    ('専門職法人',    '弁理士法人',          r'特許.*事務所|知財.*事務所|知的財産.*事務所|専利.*事務所'),
    ('専門職法人',    '行政書士法人',        r'行政書士.*事務所'),
    ('専門職法人',    '税理士法人',          r'税理士.*事務所|公認会計士.*事務所|会計事務所$'),
    ('専門職法人',    '社会保険労務士法人',  r'社会保険労務士.*事務所'),
    ('専門職法人',    '土地家屋調査士法人',  r'土地家屋調査士.*事務所'),
    ('専門職法人',    '専門職法人',          r'中小企業診断士.*事務所'),
    ('専門職法人',    '弁護士会',            r'^弁護士知財ネット$'),
    ('専門職法人',    '弁護士会',            r'弁護士会|司法書士会|税理士会|社会保険労務士会|弁理士会|行政書士会'),
    ('大学法人',      '大学共同利用機関法人', r'大学共同利用機関法人'),
    ('その他法人',    '更生保護法人',        r'更生保護法人'),
    ('その他法人',    '技術研究組合',        r'技術研究組合'),
    ('国の機関',      '刑務所',              r'刑務所'),
    ('国の機関',      '拘置所',              r'拘置所'),
    ('国の機関',      '出入国在留管理',      r'入国管理センター|出入国在留管理庁'),
    ('国の機関',      '在外公館',            r'^在.{0,10}[大総]$|^在外公館|^公館[A-Za-z\d]$'),
    ('国の機関',      '地方出先機関',        r'自然環境事務所|地方環境事務所|土地改良.*事[務業]所|農地防災事[務業]所|農地管理事[務業]所|農業水利事業所|海岸保全事業所|防災事業所$|財務.*事務所$|財務局$|^四国事務所$|^地方事務所等$'),
    ('国の機関',      '地方出先機関',        r'^(?:近畿|東北|中国|四国|九州|関東|中部|北陸|北海道)局$'),
    ('国の機関',      '海外拠点',            r'^(?:ベトナム|ケニア|ブラジル|インドネシア|セネガル|タイ|コートジボワール|イラク|カンボジア|パキスタン|ロサンゼルス|ニューヨーク|ロンドン|パリ|トロント|ソウル|シンガポール|シドニー|北京|マドリード|ワシントン|サンフランシスコ|デイトン|在シェムリアップ)事務所$'),
    ('国の機関',      '海外拠点',            r'日本文化会館$'),
    ('国の機関',      '海外拠点',            r'日本文化センター$'),
    ('国の機関',      '矯正施設',            r'矯正医療センター|社会復帰促進センター'),
    ('国の機関',      '府省庁',              r'税関$|^各府省$|^経産省$|^経産局$'),
    ('外国法人・国際機関', '国際機関',       r'国際連合(?!協会)|UNDP|国連(?!NGO|代表部)'),
    ('外国法人・国際機関', '国際機関',       r'グローバルファンド|世界エイズ.*結核.*マラリア対策基金|COVAX|Gaviワクチンアライアンス|CEPI|感染症流行対策イノベーション連合'),
    ('外国法人・国際機関', '国際機関',       r'IGAD|東アジア.*(?:アセアン|ASEAN)経済研究センター|アセアン事務局|ASEAN事務局|モントリオール議定書.*(?:基金|事務局)'),
    ('外国法人・国際機関', '国際機関',       r'条約.*(?:事務局|機関|センター|ユニット)|包括的核実験禁止条約機関|北大西洋条約機構'),
    ('外国法人・国際機関', '国際機関',       r'まぐろ.*委員会|漁業委員会|メコン河委員会|日[・]ASEAN.*委員会'),
    ('外国法人・国際機関', '国際機関',       r'ASEAN\+3|ASEAN.*(?:センター|事務局|投資|貿易)|東アジア・ASEAN'),
    ('外国法人・国際機関', '国際機関',       r'軍縮.*(?:センター|不拡散)|漁業開発センター|OECD.*センター|OECDアジア|地球変動.*センター'),
    ('外国法人・国際機関', '国際機関',       r'国際貿易センター|国際地震センター|地雷除去.*センター|国際科学技術センター'),
    ('外国法人・国際機関', '国際機関',       r'気候技術センター|国際共同組合同盟|日独センター|欧州評議会'),
    ('外国法人・国際機関', '国際機関',       r'(?:APEC|OAS|PIF|SAARC|GEO|MOPAN|APG|PECC|ABAC|RCEP|カリコム|日中韓|国際獣疫|国際穀物|博覧会国際).*事務局$'),
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
    ('地方公共団体',  '一部事務組合',        r'広域行政組合|広域市町村圏.*組合|衛生処理組合|衛生センター組合|広域組合$'),
    ('地方公共団体',  '環境組合',            r'衛生管理組合|廃棄物処理組合|環境施設組合|環境整備施設組合|清掃施設組合|衛生施設組合|環境整備事業組合|環境衛生組合'),
    ('地方公共団体',  '港湾管理組合',        r'港管理組合'),
    ('地方公共団体',  '病院組合',            r'病院組合|医療厚生組合'),
    ('地方公共団体',  '消防組合',            r'消防組合'),
    ('地方公共団体',  '試験場',              r'試験場$'),
    ('協同組合等',    '農林中央金庫',        r'農林中央金庫'),
    ('協同組合等',    '信用金庫',            r'信金中央金庫'),
    ('協同組合等',    '農事組合法人',        r'農事組合法人'),
    ('協同組合等',    '生産組合',            r'生産組合'),
    ('協同組合等',    '生活協同組合',        r'生活協同組合'),
    ('協同組合等',    '企業組合',            r'企業組合'),
    ('協同組合等',    '協業組合',            r'協業組合'),
    ('協同組合等',    '林業組合',            r'造林組合'),
    ('協同組合等',    '土地改良区',          r'土地改良区'),
    ('協同組合等',    '保険組合',            r'健康保険組合|保険組合'),
    ('協同組合等',    '再開発組合',          r'再開発組合|土地区画整理組合'),
    ('協同組合等',    '事業協同組合',        r'事業協同組合'),
    ('協同組合等',    '中小企業団体中央会',  r'(?<!全国)中小企業団体中央会'),
    ('協同組合等',    '業界団体',            r'中央会$'),
    ('協同組合等',    '業界団体',            r'連盟$'),
    ('協同組合等',    '労働組合',            r'総連合$|労働組合総連合$'),
    ('民間企業',      'SPC（特定目的会社）', r'特定目的会社'),
    ('民間企業',      '保険会社',            r'相互会社$'),
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
    ('実行委員会等',  '実行委員会',          r'イベント主催団体[A-Za-z\d]'),
    ('実行委員会等',  '実行委員会',          r'^カルテット事務局$'),
    ('地方公共団体', '地方公共団体集合',   r'^他[0-9]+(都道府県|道府県|府県)$'),
    ('地方公共団体', '地方公共団体集合',   r'^地方公共団体\d+$'),
    ('国の機関',    '行政機関集合',       r'^他[0-9]+.*(局|庁)'),
    ('その他',       '特定団体集合',       r'^他[0-9]+医療機関'),
    ('その他',       '不明',              r'^他[0-9]+'),
    ('その他',       '不明',              r'支出先上位\d+者以降|以降補助事業$'),
    ('国の機関',    '行政機関集合',       r'^その他[\(（]?\d+局[\)）]?$'),
    ('国の機関',    '労働局',             r'^.+労働局$'),
    ('国の機関',    '法務局',             r'法務局'),
    ('国の機関',    '地方整備局',         r'地方整備局|整備局$'),
    ('国の機関',    '農政局',             r'農政局'),
    ('国の機関',    '運輸局',             r'運輸局$'),
    ('国の機関',    '経済産業局',         r'経済産業局'),
    ('国の機関',    '管区警察局',         r'管区警察局|警察支局$'),
    ('国の機関',    '厚生局',             r'厚生局'),
    ('国の機関',    '公安調査局',         r'公安調査局'),
    ('国の機関',    '防衛局',             r'防衛局$|防衛支局$'),
    ('国の機関',    '森林管理局',         r'森林管理局'),
    ('国の機関',    '出入国在留管理局',   r'出入国在留管理局'),
    ('国の機関',    '総合通信局',         r'総合通信局'),
    ('国の機関',    '航空局',             r'航空局$'),
    ('国の機関',    '国税局',             r'国税局$'),
    ('国の機関',    '開発局',             r'開発局$'),
    ('その他',       '特定団体集合',       r'^その他.*センター連合|^その他.*センター運営法人'),
    ('その他',       'プレースホルダー',   r'^その他$|^その他の支出先$|^その他支出先$|^その他の支出$|^その他契約$'),
    ('民間企業',      '民間企業(集合)',    r'その他民間|^その他事業者$|その他[（(]?[0-9]+社[）)]?|その他[0-9]+社|その他の?社$|^民間企業$|^民間企業等|^民間企業[A-Za-z]|補助事業者\(民間企業\)|^企業[A-Za-z]{1,2}$|^地域企業[A-Za-z]$'),
    ('外国法人・国際機関', '外国企業',        r'^外国企業|所在企業$'),
    ('外国法人・国際機関', '外国企業(集合)', r'^海外法人\d'),
    ('外国法人・国際機関', '海外日本人学校',   r'日本人学校.*(?:理事会|維持会|審議会|運営会)|日本語補習校.*理事会|各公館が管轄する日本人学校'),
    ('外国法人・国際機関', '外国政府',        r'共和国政府|独立国政府|州政府'),
    ('外国法人・国際機関', '外国政府',        r'(?:中国|米国|英国|仏国|独国|インドネシア|パプアニューギニア)外交部|(?:中国|米国|英国)(?:国務省|政府(?:省|庁|部))'),
    ('外国法人・国際機関', '国際機関',        r'多数国間投資保証機関'),
    ('外国法人・国際機関', '国際機関',        r'ロス.*ダメージ.*基金|損失.*損害.*基金|気候変動.*基金'),
    ('外国法人・国際機関', '外国企業',        r'公司'),
    ('外国法人・国際機関', '外国企業',        r'リミテッド$|インコーポレーテッド$|インコーポレイテッド$|インコーポレイティッド$|コーポレーション$'),
    ('外国法人・国際機関', '外国企業',        r'(?<!\w)AS$'),
    ('外国法人・国際機関', '外国企業',        r'(?<!\w)AB$'),
    ('外国法人・国際機関', '外国企業',        r'(?i)\bUnlimited Company\b'),
    # ─ 英語圏・欧州企業サフィックス ────────────────────────────────────────────────
    ('外国法人・国際機関', '外国企業',        r'(?i)\bInc\.?\b|\bCorp(?:oration)?\.?\b|\bLLC\b|\bLimited\b|\bLtd[a]?\.?\b|\bPty\.?\b|\bPLC\b|\bPvt\.?\b|\bLLP\b'),
    ('外国法人・国際機関', '外国企業',        r'\bB\.V\.|\bN\.V\.|\bGmbH\b|\bAG\b|\bS\.A(?:\.S?|\.[A-Z])?\.?(?=\b|$)|SAS$'),
    ('医療・福祉法人', '医療機関(集合)',   r'^その他.*(?:医療機関|補装具業者|補装具の制作業者)'),
    ('協同組合等',    '漁業者',              r'^その他.*漁業者'),
    ('協同組合等',    '漁業者',              r'漁業者$'),
    ('協同組合等',    '漁業協同組合',        r'漁業共済加入組合'),
    ('事業者',        '個人事業主',          r'個人事業[主者]'),
    ('事業者',        '民間事業者',          r'民間事業者'),
    ('事業者',        '補助事業者',          r'補助事業者'),
    ('事業者',        '事業主',              r'事業主'),
    ('事業者',        '事業者',              r'事業者'),
    ('事業者',        '事業者',              r'生産者'),
    ('事業者',        '事業者',              r'^構成農業者'),
    ('個人',          '弁護士',              r'^個人[A-Za-z\d]弁護士'),
    ('個人',          '個人',                r'^個人'),
    ('個人',          '在外研究員',          r'^在外研究員'),
    ('個人',          '在外出張者',          r'^在外出張者'),
    ('個人',          '出張者',              r'^出張者|^[（(][A-Za-z\d][）)]出張者'),
    ('個人',          '個人',                r'^研修生[A-Za-z\d]'),
    ('個人',          '弁護士',              r'^弁護士[\u4e00-\u9fff]+$'),
    ('個人',          '弁護士',              r'^弁護士[A-Za-z\d]$'),
    ('個人',          '個人',                r'^学生[A-Za-z\d]$'),
    ('個人',          '個人',                r'^[A-Z]氏$'),
    ('その他',       'プレースホルダー',    r'^[A-Z]$'),
    ('個人',          '個人',                r'^外国人(?:講師)?[A-Za-z\d]'),
    ('個人',          '個人',                r'^参与[A-Za-z\d]$|外務省参与'),
    ('個人',          '個人',                r'^留学アドバイザー[A-Za-z\d]'),
    ('事業者',        '個人事業主',          r'フリーランス'),
    ('個人',          '個人',                r'有識者'),
    ('個人',          '個人',                r'[(（]個人[)）]'),
    ('個人',          '個人',                r'^学生$|^学生[(（]'),
    ('個人',          '個人',                r'大学.*学生$|大学院.*学生$'),
    ('個人',          '弁護士',              r'国選弁護|契約弁護士|常勤弁護士'),
    ('個人',          '個人',                r'就職支援ナビゲーター|ナビゲーター(?:等|[A-Z])'),
    ('事業者',        '事業者',              r'^農家[A-Za-z\d]'),
    ('個人',          '土地所有者',          r'土地所有者'),
    ('個人',          '建物所有者',          r'建物所有者'),
    ('人件費',        '人件費',              r'人件費'),
    ('人件費',        '職員',                r'職員(?!厚生会|互助会)'),
    ('経費',          '経費',                r'経費'),
    ('経費',          '管理費',              r'管理費'),
    ('経費',          '事業費',              r'事業費'),
    ('経費',          '示達',                r'示達'),
    ('経費',          '繰入れ',              r'への繰入れ$|勘定への繰入れ'),
    ('経費',          '特別会計',            r'特別会計$|特別会計.*勘定$'),
    ('経費',          '勘定',               r'年金勘定$|勘定$'),
    ('経費',          '庁費',               r'庁費$'),
    ('事業', 'プロジェクト名', r'プロジェクト$|の構築$'),
    ('事業', '業務名',        r'関係業務$|に関する業務$|推進業務$|推進事業$|製表事業$|支援事業$|発展支援事業$'),
    ('事業', '費目名',        r'^調査費$|^補助金$|^補助金執行$|^研究業務費$|^審査業務費$|^事務費$|^積立・繰越金$|^法人共通$|^法人$'),
    ('事業', '費目名',        r'^人権啓発活動等委託費$|^人権啓発活動等補助金$'),
    ('その他',       '受益者集合',          r'^利水者|^農業者年金|^被保険者|^退職者|^留学生|^研修生$|^給付対象者'),
    ('その他',       '受益者集合',          r'^ハンセン病療養所.*退所者'),
    ('その他',       '受益者集合',          r'^文化功労者$'),
    ('その他',       '受益者集合',          r'^申請人$'),
    ('その他',       '受益者集合',          r'^通訳人$'),
    ('民間企業',      '金融機関',          r'^金融機関'),
    ('事業者',        '事業者',              r'^[A-Za-z]事業所$'),
    ('事業者',        '事業者',              r'認定職業訓練実施機関[A-Za-z\d]+'),
    ('民間企業',      '民間企業(集合)',    r'^設置法人\d+$'),
    ('民間企業',      '民間企業(集合)',    r'広告代理店[A-Za-z\d]?$|^旅行代理店$|^海外旅行代理店$|^現地旅行代理店'),
    ('民間企業',      '民間企業(集合)',    r'^メディア媒体[A-Za-z\d]'),
    ('民間企業',      '民間企業',          r'新聞社$'),
    ('公益法人・NPO', '学会',               r'学会$'),
    ('公益法人・NPO', '協会',               r'協会$'),
    ('公益法人・NPO', '振興会',             r'振興会$'),
    ('外国法人・国際機関', '国際機関',       r'北大西洋海産哺乳類動物委員会|アジア.*アフリカ.*法律諮問委員会|みなみまぐろ保存委員会'),
    ('協同組合等',    '協同組合',            r'協同組合'),
    ('協同組合等',    '協同組合',            r'地主組合|地主会$'),
    ('民間企業',      '民間企業(集合)',    r'[A-Za-z]{1,3}社$'),
    ('民間企業',      '民間企業(集合)',    r'(?<![式限同資名])会社[A-Za-z\d]'),
    ('民間企業',      '民間企業(集合)',    r'法人[A-Za-z\d]$'),
    ('民間企業',      '民間企業(集合)',    r'^コンサル[A-Za-z\d]'),
    ('事業者',        '事業者',              r'^農業法人'),
    ('事業者',        '事業者',              r'集落$'),
    ('民間企業',      '民間企業',            r'林業$'),
    ('大学法人',      '大学',                r'大学$'),
    ('事業者',        '事業者',              r'^農業者'),
    ('事業者',        '事業者',              r'^漁業者'),
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


# ─────────────────────────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────────────────────────
def to_cho(yen: int) -> str:
    return f'{yen / 1e12:.2f}兆円'


def pct(num: int, denom: int) -> str:
    return f'{num / denom * 100:.1f}%' if denom else '0.0%'


def is_skip_target(name: str) -> bool:
    """
    共同企業体等の合算名称を検出してスキップ対象とする。
    条件: 区切り文字(・ or 、)を含み、かつ区切られた複数セグメントの
         うち 2 セグメント以上に格ワードがマッチする。
    generate-entity-labels-csv.py の is_skip_target と同期させること。
    """
    # 法人格名で始まる場合は単一法人として扱う
    if re.match(r'^(?:一般|公益)(?:社団|財団)法人|^(?:弁護士|監査|税理士|司法書士|弁理士|行政書士|社会保険労務士|土地家屋調査士)法人', name):
        return False
    if re.match(r'^(?:独立行政法人|国立研究開発法人|国立大学法人|公立大学法人)', name):
        return False
    if re.match(r'^特定非営利活動法人', name):
        return False
    if re.match(r'^株式会社', name):
        return False
    if not SEPARATORS.search(name):
        return False
    segments = SEPARATORS.split(name)
    kaku_segments = sum(
        1 for seg in segments
        if any(pat.search(_normalize_for_match(seg)) for _, _, pat in KAKU_COMPILED)
    )
    return kaku_segments >= 2


# ─────────────────────────────────────────────────────────────
# 辞書の読み込み
# ─────────────────────────────────────────────────────────────
def load_dictionaries(dict_dir: str):
    """
    戻り値:
      dict_exact : {filename: set[str]}         完全一致セット
      dict_regex : {filename: list[re.Pattern]}  正規表現リスト
    """
    dict_exact: dict[str, set] = {}
    dict_regex: dict[str, list] = {}

    for fname in sorted(os.listdir(dict_dir)):
        if not fname.endswith('.csv'):
            continue

        fpath = os.path.join(dict_dir, fname)
        exact_set: set[str] = set()
        regex_list: list = []

        with open(fpath, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []

            if 'name' in fieldnames:
                # 標準スキーマ
                has_match_type = 'match_type' in fieldnames
                for row in reader:
                    name = row.get('name', '').strip()
                    if not name:
                        continue
                    if has_match_type and (row.get('match_type') or '').strip() == 'regex':
                        try:
                            regex_list.append(re.compile(name))
                        except re.error as e:
                            print(f'  [WARN] regex compile error in {fname}: {name!r} ({e})',
                                  file=sys.stderr)
                    else:
                        exact_set.add(name)

            elif fname in MINISTRY_SCHEMA_COLS:
                # 府省庁スキーマ
                for row in reader:
                    for col in MINISTRY_SCHEMA_COLS[fname]:
                        val = row.get(col, '').strip()
                        if val:
                            exact_set.add(val)

        dict_exact[fname] = exact_set
        dict_regex[fname] = regex_list

    return dict_exact, dict_regex


# ─────────────────────────────────────────────────────────────
# 入力 CSV の読み込み
# ─────────────────────────────────────────────────────────────
def load_recipients(input_csv: str):
    """
    戻り値:
      name_amount : {支出先名: 金額合計（円）}
      name_meta   : {支出先名: {'count': int, 'type_codes': set[str], 'first_cn': str}}
    """
    name_amount: dict[str, int]  = defaultdict(int)
    name_meta:   dict[str, dict] = defaultdict(
        lambda: {'count': 0, 'type_codes': set(), 'first_cn': ''}
    )
    with open(input_csv, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('支出先名', '').strip()
            if not name:
                continue
            try:
                amount = int(row.get('金額', '0').replace(',', ''))
            except ValueError:
                amount = 0
            name_amount[name] += amount
            meta = name_meta[name]
            meta['count'] += 1
            tc = row.get('法人種別', '').strip()
            if tc:
                meta['type_codes'].add(tc)
            cn = row.get('法人番号', '').strip()
            if cn and not meta['first_cn']:
                meta['first_cn'] = cn
    return dict(name_amount), dict(name_meta)


# ─────────────────────────────────────────────────────────────
# 推定区分ヒント（未カバー分析用）
# ─────────────────────────────────────────────────────────────
_AGG_PAT = re.compile(
    r'^その他|民間事業者|事業主|受給者|農業者|被保険者|利水者|漁業者|林業者|'
    r'入居者|入所者|補助対象者|助成対象|支給対象|酪農事業者|上位\d+者|'
    r'^業務経費$|^示達$|^地方公共団体$|^民間企業$|^民間事業者等$|^支援対象者$|'
    r'ほか\d+件|以降\d+者|補助事業$'
)
_TYPE_HINT = {
    '101': '国の機関（101）',
    '201': '地方公共団体（201）',
    '301': '民間企業（301）', '302': '民間企業（302）',
    '303': '民間企業（303）', '304': '民間企業（304）', '305': '民間企業（305）',
    '399': '設立登記法人（399）',
    '401': '外国会社等（401）',
    '499': 'その他法人（499）',
}

def infer_hint(name: str, type_codes: set, first_cn: str) -> str:
    if _AGG_PAT.search(name):
        return '集合・汎用名称'
    for tc, hint in _TYPE_HINT.items():
        if tc in type_codes:
            return hint
    if not first_cn:
        return '法人番号なし'
    return '（法人番号あり・種別不明）'


# ─────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────
def main():
    # ── 存在確認 ──────────────────────────────────────────────
    if not os.path.exists(INPUT_CSV):
        print(f'エラー: 入力ファイルが見つかりません: {INPUT_CSV}', file=sys.stderr)
        print('  npm run normalize && npm run generate-structured を先に実行してください',
              file=sys.stderr)
        sys.exit(1)

    # ── レポートファイルへの同時出力 ───────────────────────────
    _orig_stdout = sys.stdout
    _report_file = open(OUTPUT_REPORT, 'w', encoding='utf-8')
    sys.stdout   = _Tee(_orig_stdout, _report_file)

    # ── データ読み込み ─────────────────────────────────────────
    print('読み込み中...', end=' ', flush=True)
    name_amount, name_meta = load_recipients(INPUT_CSV)
    dict_exact, dict_regex = load_dictionaries(DICT_DIR)
    print('完了')

    all_names    = list(name_amount.keys())
    total_count  = len(all_names)
    total_amount = sum(name_amount.values())

    # ══════════════════════════════════════════════════════════
    # Step 1: 完全一致辞書マッチング
    # ══════════════════════════════════════════════════════════
    dict_hit_names: dict[str, set] = {}  # fname -> set of matched names

    for fname in dict_exact:
        exact_set  = dict_exact[fname]
        regex_list = dict_regex.get(fname, [])
        hits: set[str] = set()
        for name in all_names:
            if name in exact_set:
                hits.add(name)
            elif regex_list and any(p.fullmatch(name) for p in regex_list):
                hits.add(name)
        dict_hit_names[fname] = hits

    # aggregate_names の exact/regex 内訳（表示用）
    agg_fname     = 'aggregate_names.csv'
    agg_exact_hits: set[str] = set()
    agg_regex_hits: set[str] = set()
    if agg_fname in dict_exact:
        for name in all_names:
            if name in dict_exact[agg_fname]:
                agg_exact_hits.add(name)
            elif dict_regex.get(agg_fname) and any(
                    p.fullmatch(name) for p in dict_regex[agg_fname]):
                agg_regex_hits.add(name)

    # 全辞書の和集合
    s1_hit_names: set[str] = set()
    for hits in dict_hit_names.values():
        s1_hit_names |= hits
    s1_count  = len(s1_hit_names)
    s1_amount = sum(name_amount[n] for n in s1_hit_names)

    # ══════════════════════════════════════════════════════════
    # Step 2: 格パターンマッチング
    # ══════════════════════════════════════════════════════════
    skipped_names = {n for n in all_names if is_skip_target(n)}
    target_names  = [n for n in all_names if n not in skipped_names]

    l1_hits:   dict[str, set] = defaultdict(set)
    l2_hits:   dict[str, set] = defaultdict(set)
    label_cnt: dict[str, int] = {}   # name -> L2 ラベル数

    for name in target_names:
        norm = _normalize_for_match(name)
        matched = [(l1, l2) for l1, l2, pat in KAKU_COMPILED if pat.search(norm)]
        for l1, l2 in matched:
            l1_hits[l1].add(name)
            l2_hits[l2].add(name)
        label_cnt[name] = len(matched)

    s2_hit_names: set[str] = set()
    for hits in l2_hits.values():
        s2_hit_names |= hits
    s2_count  = len(s2_hit_names)
    s2_amount = sum(name_amount[n] for n in s2_hit_names)

    # ── コンソーシアム・共同体バイパス: is_skip_target 対象でも適用 ──
    # 「A社・B社共同企業体」形式は複合名称としてスキップされるが、
    # 実態は単一の支出先（コンソーシアム）のため、共同.*体を含む場合は明示的に適用する。
    _CONSORTIUM_SUBS = [
        ('共同企業体',   re.compile(r'共同企業体|協働企業体')),
        ('共同提案体',   re.compile(r'共同提案体')),
        ('共同研究体',   re.compile(r'共同研究体')),
        ('共同事業体',   re.compile(r'共同事業体')),
        ('共同体',       re.compile(r'共同体')),
        ('コンソーシアム', re.compile(r'コンソーシアム')),
    ]
    _CONSORTIUM_ANY = re.compile(r'共同企業体|協働企業体|共同提案体|共同研究体|共同事業体|共同体|コンソーシアム')
    kigyotai_bypass = {n for n in skipped_names if _CONSORTIUM_ANY.search(n)}
    for name in kigyotai_bypass:
        l1_hits['コンソーシアム・共同体'].add(name)
        for l2_label, pat in _CONSORTIUM_SUBS:
            if pat.search(name):
                l2_hits[l2_label].add(name)
                break
    if kigyotai_bypass:
        s2_hit_names |= kigyotai_bypass
        s2_count  = len(s2_hit_names)
        s2_amount = sum(name_amount[n] for n in s2_hit_names)

    # ラベル数分布
    dist = {0: 0, 1: 0, 2: 0}
    for name in target_names:
        c = label_cnt.get(name, 0)
        dist[min(c, 2)] += 1

    # ══════════════════════════════════════════════════════════
    # 合算・未カバー
    # ══════════════════════════════════════════════════════════
    union_names   = s1_hit_names | s2_hit_names
    overlap_names = s1_hit_names & s2_hit_names
    union_count   = len(union_names)
    union_amount  = sum(name_amount[n] for n in union_names)

    uncovered = sorted(
        ((name_amount[n], n) for n in all_names if n not in union_names),
        reverse=True
    )

    # ══════════════════════════════════════════════════════════
    # レポート出力
    # ══════════════════════════════════════════════════════════
    SEP = '─' * 58

    print()
    print('=== 完全一致・格分類 統合カバレッジレポート ===')
    print(f'入力: {INPUT_CSV}')
    print(f'ユニーク支出先名: {total_count:,}件 / 総金額: {to_cho(total_amount)}')

    # ── Step 1 ───────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1: 完全一致辞書')
    print(SEP)
    print('[辞書別ヒット数（辞書間重複含む）]')

    for fname in sorted(dict_hit_names.keys()):
        hits     = dict_hit_names[fname]
        h_count  = len(hits)
        h_amount = sum(name_amount[n] for n in hits)
        extra    = ''
        if fname == agg_fname:
            extra = f'  (exact: {len(agg_exact_hits)}件 / regex: {len(agg_regex_hits)}件)'
        print(f'  {fname:<38s}: {h_count:5,}件  {to_cho(h_amount)}{extra}')

    print()
    print('[Step 1 合計（辞書間重複除外）]')
    print(f'  件数カバレッジ: {s1_count:,}件 / {total_count:,}件 = {pct(s1_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s1_amount, total_amount)}')

    # ── Step 2 ───────────────────────────────────────────────
    print()
    print(SEP)
    print(f'Step 2: 格パターン（スキップ {len(skipped_names):,}件除く {len(target_names):,}件対象、共同.*体は全件適用）')
    print(SEP)

    L1_ORDER = [
        '民間企業', '公益法人・NPO', '協同組合等', '独立行政法人等',
        '大学法人', '学校法人', '医療・福祉法人', 'その他法人',
        '専門職法人', '地方公共法人', '地方公共団体', 'コンソーシアム・共同体', '協議会', '実行委員会等',
        'その他',
    ]
    print('[L1大分類別]')
    for l1 in L1_ORDER:
        hits = l1_hits.get(l1, set())
        if hits:
            print(f'  {l1:<18s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    print()
    print('[L2中分類別（件数降順）]')
    for l2, hits in sorted(l2_hits.items(), key=lambda x: -len(x[1])):
        print(f'  {l2:<22s}: {len(hits):6,}件  {to_cho(sum(name_amount[n] for n in hits))}')

    # コンソーシアム・共同体の複合名称内訳
    consortium_l2 = (
        l2_hits.get('共同企業体', set()) | l2_hits.get('JV', set()) |
        l2_hits.get('共同提案体', set()) | l2_hits.get('共同研究体', set()) |
        l2_hits.get('共同事業体', set()) | l2_hits.get('共同体', set())
    )
    cs_comp  = consortium_l2 & skipped_names   # バイパス適用分（A社・B社形式）
    cs_plain = consortium_l2 - skipped_names   # 通常マッチ分（名称単体）
    if consortium_l2:
        print(f'  ↳ コンソーシアム内訳 単体: {len(cs_plain):,}件 {to_cho(sum(name_amount[n] for n in cs_plain))}'
              f' / 複合（A社・B社形式）: {len(cs_comp):,}件 {to_cho(sum(name_amount[n] for n in cs_comp))}')

    print()
    print('[ラベル数分布]')
    print(f'  0ラベル（格なし）: {dist[0]:6,}件  {pct(dist[0], len(target_names))}')
    print(f'  1ラベル          : {dist[1]:6,}件  {pct(dist[1], len(target_names))}')
    print(f'  2ラベル以上      : {dist[2]:6,}件  {pct(dist[2], len(target_names))}')

    print()
    print('[Step 2 合計]')
    print(f'  件数カバレッジ: {s2_count:,}件 / {total_count:,}件 = {pct(s2_count, total_count)}')
    print(f'  金額カバレッジ: {pct(s2_amount, total_amount)}')

    # ── 合算 ─────────────────────────────────────────────────
    print()
    print(SEP)
    print('Step 1 ∪ Step 2 合算')
    print(SEP)
    print(f'  件数カバレッジ: {union_count:,}件 / {total_count:,}件 = {pct(union_count, total_count)}')
    print(f'  金額カバレッジ: {pct(union_amount, total_amount)}')
    print(f'  重複（両ステップでヒット）: {len(overlap_names):,}件')

    # ── 未カバー 上位件 ──────────────────────────────────────
    top_n = 20
    print()
    print(SEP)
    print(f'未カバー 上位{top_n}件（金額降順）')
    print(SEP)
    for amount, name in uncovered[:top_n]:
        print(f'  {to_cho(amount)}  {name}')

    # ── 未カバー 推定区分別サマリー ───────────────────────────
    hint_summary: dict[str, dict] = defaultdict(lambda: {'count': 0, 'amount': 0})
    for amount, name in uncovered:
        meta = name_meta.get(name, {})
        hint = infer_hint(name, meta.get('type_codes', set()), meta.get('first_cn', ''))
        hint_summary[hint]['count']  += 1
        hint_summary[hint]['amount'] += amount

    print()
    print(SEP)
    print('未カバー 推定区分別サマリー（金額降順）')
    print(SEP)
    for hint, stats in sorted(hint_summary.items(), key=lambda x: -x[1]['amount']):
        print(f'  {hint:<28s}: {stats["count"]:5,}件  {to_cho(stats["amount"])}')

    # ── CSV 出力 ──────────────────────────────────────────────
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            '支出先名', '金額合計（円）', '件数', '法人種別コード', '法人番号', '推定区分'
        ])
        for amount, name in uncovered:
            meta      = name_meta.get(name, {})
            type_str  = ','.join(sorted(meta.get('type_codes', set())))
            first_cn  = meta.get('first_cn', '')
            hint      = infer_hint(name, meta.get('type_codes', set()), first_cn)
            writer.writerow([name, amount, meta.get('count', 0), type_str, first_cn, hint])

    print()
    print(f'未カバー CSV:    {OUTPUT_CSV}  ({len(uncovered):,}件)')
    print(f'カバレッジレポート: {OUTPUT_REPORT}')
    print()

    sys.stdout = _orig_stdout
    _report_file.close()


if __name__ == '__main__':
    main()
