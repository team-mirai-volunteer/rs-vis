"""
支出先名 → L1/L2 ラベルマッピング生成スクリプト

analyze-label-coverage.py の格パターン・辞書ロジックを使い、
全 spendingName に対して L1/L2 ラベルを付与した
public/data/entity-labels.json を生成する。

実行:
  python3 scripts/generate-entity-labels.py
  # または
  npm run generate-entity-labels
"""

import csv
import json
import os
import re
import sys

# ─────────────────────────────────────────────────────────────
# パス設定
# ─────────────────────────────────────────────────────────────
REPO_ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRUCTURED_JSON  = os.path.join(REPO_ROOT, 'public', 'data', 'rs2024-structured.json')
DICT_DIR         = os.path.join(REPO_ROOT, 'public', 'data', 'dictionaries')
OUTPUT_JSON      = os.path.join(REPO_ROOT, 'public', 'data', 'entity-labels.json')

# ─────────────────────────────────────────────────────────────
# 辞書ファイルごとの L1/L2 ラベル
# ─────────────────────────────────────────────────────────────
DICT_LABEL: dict[str, tuple[str, str]] = {
    # 国の機関
    'ministry_names.csv':          ('国の機関', '府省庁'),
    'ministry_from_ichiran.csv':    ('国の機関', '府省庁'),
    'ministry_supplement.csv':      ('国の機関', '府省庁'),
    'police_names.csv':             ('国の機関', '警察'),
    # 地方公共団体
    'prefecture_names.csv':         ('地方公共団体', '都道府県'),
    'municipality_names.csv':       ('地方公共団体', '市区町村'),
    'municipality_supplement.csv':  ('地方公共団体', '市区町村'),
    # 国の機関（地方機関）
    'field_office_names.csv':       ('国の機関', '行政機関'),
    # 外国法人・国際機関
    'foreign_agency_names.csv':     ('外国法人・国際機関', '外国政府機関'),
    'embassy_names.csv':            ('外国法人・国際機関', '大使館'),
    'international_org_names.csv':  ('外国法人・国際機関', '国際機関'),
    'country_names.csv':            ('外国法人・国際機関', '外国'),
    # ※ aggregate_names.csv は category フィールドで L2 を決めるため別処理
    # ※ special_corporation_names.csv は special_subtype を使うため別処理
}

# 府省庁スキーマ（ministry系CSVは 'name' 列なし、特定列から抽出）
MINISTRY_SCHEMA_COLS = {
    'ministry_names.csv':        ['ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit'],
    'ministry_from_ichiran.csv': ['ministry', 'bureau', 'bureau_alias', 'section'],
    'ministry_supplement.csv':   ['ministry', 'bureau', 'bureau_alias', 'section'],
}

# ─────────────────────────────────────────────────────────────
# Step 2: 格パターン（L1大分類, L2中分類, 正規表現）
# ─────────────────────────────────────────────────────────────
KAKU_PATTERNS = [
    ('民間企業',      '株式会社',          r'株式会社|[（(]株[）)]'),
    ('民間企業',      '有限会社',          r'有限会社|[（(]有[）)]'),
    ('民間企業',      '合同会社',          r'合同会社|[（(]合[）)]'),
    ('民間企業',      '合資会社',          r'合資会社'),
    ('民間企業',      '合名会社',          r'合名会社'),
    ('独立行政法人等', '国立研究開発法人',  r'国立研究開発法人'),
    ('独立行政法人等', '独立行政法人',      r'独立行政法人'),
    ('大学法人',      '国立大学法人',      r'国立大学法人'),
    ('大学法人',      '公立大学法人',      r'公立大学法人'),
    ('大学法人',      '学校法人(大学)',  r'学校法人.*大学|大学.*学校法人'),
    ('公益法人・NPO', '公益社団法人',      r'公益社団法人|[（(]公社[）)]'),
    ('公益法人・NPO', '公益財団法人',      r'公益財団法人|[（(]公財[）)]'),
    ('公益法人・NPO', '一般社団法人',      r'一般社団法人|[（(]一社[）)]'),
    ('公益法人・NPO', '一般財団法人',      r'一般財団法人|[（(]一財[）)]'),
    ('公益法人・NPO', '特定非営利活動法人', r'特定非営利活動法人|NPO法人'),
    ('協同組合等',    '農業協同組合',      r'農業協同組合'),
    ('協同組合等',    '漁業協同組合',      r'漁業協同組合'),
    ('協同組合等',    '森林組合',          r'森林組合'),
    ('協同組合等',    '消費生活協同組合',  r'消費生活協同組合'),
    ('協同組合等',    '共済組合',          r'共済組合'),
    ('協同組合等',    '商工会議所',        r'商工会議所'),
    ('協同組合等',    '商工会',            r'商工会'),
    ('協同組合等',    '連合会',            r'連合会'),
    ('協同組合等',    '業界団体',          r'中央会$'),
    ('協同組合等',    '業界団体',          r'連盟$'),
    ('協同組合等',    '労働組合',          r'総連合$|労働組合総連合$'),
    ('民間企業',      'SPC（特定目的会社）', r'特定目的会社'),
    ('民間企業',      '保険会社',          r'相互会社$'),
    ('協同組合等',    '年金基金',          r'年金基金'),
    ('学校法人',      '学校法人',          r'学校法人'),
    ('医療・福祉法人', '社会医療法人',     r'社会医療法人'),
    ('医療・福祉法人', '医療法人',         r'医療法人'),
    ('医療・福祉法人', '社会福祉法人',     r'社会福祉法人'),
    ('医療・福祉法人', '赤十字',           r'赤十字'),
    ('その他法人',    '宗教法人',          r'宗教法人'),
    ('その他法人',    '管理組合法人',      r'管理組合法人'),
    # 専門職法人
    ('専門職法人',    '監査法人',          r'監査法人'),
    ('専門職法人',    '弁護士法人',        r'弁護士法人'),
    ('専門職法人',    '税理士法人',        r'税理士法人'),
    ('専門職法人',    '司法書士法人',      r'司法書士法人'),
    ('専門職法人',    '社会保険労務士法人', r'社会保険労務士法人'),
    ('専門職法人',    '弁理士法人',        r'弁理士法人'),
    ('専門職法人',    '行政書士法人',      r'行政書士法人'),
    ('専門職法人',    '土地家屋調査士法人', r'土地家屋調査士法人'),
    # 特殊法人・特別の法人
    ('大学法人',      '大学共同利用機関法人', r'大学共同利用機関法人'),
    ('その他法人',    '更生保護法人',      r'更生保護法人'),
    ('その他法人',    '技術研究組合',      r'技術研究組合'),
    # 地方公共法人
    ('地方公共法人',  '土地開発公社',      r'土地開発公社'),
    ('地方公共法人',  '住宅供給公社',      r'住宅供給公社'),
    ('地方公共法人',  '高速道路公社',      r'高速道路公社'),
    ('地方公共法人',  '道路公社',          r'道路公社'),
    ('地方公共法人',  '港務局',            r'港務局'),
    # 地方公共団体（特別地方公共団体等）
    ('地方公共団体',  '市区町村',          r'^[^\s]{2,5}(?:都|道|府|県)[^\s]{2,10}(?:市|区|町|村)$'),
    ('地方公共団体',  '広域連合',          r'広域連合'),
    ('地方公共団体',  '企業団',            r'企業団(?!体)'),
    ('地方公共団体',  '一部事務組合',      r'事務組合'),
    # 保険組合・再開発組合・事業協同組合
    ('協同組合等',    '保険組合',          r'健康保険組合|保険組合'),
    ('協同組合等',    '再開発組合',        r'再開発組合|土地区画整理組合'),
    ('協同組合等',    '事業協同組合',      r'事業協同組合'),
    # コンソーシアム・共同体
    ('コンソーシアム・共同体', '共同企業体', r'共同企業体|協働企業体'),
    ('コンソーシアム・共同体', 'JV',        r'JV$'),
    ('コンソーシアム・共同体', '共同提案体', r'共同提案体'),
    ('コンソーシアム・共同体', '共同研究体', r'共同研究体'),
    ('コンソーシアム・共同体', '共同事業体', r'共同事業体'),
    ('コンソーシアム・共同体', '共同体',     r'共同体'),
    ('コンソーシアム・共同体', '受託企業体', r'受託企業体'),
    ('コンソーシアム・共同体', 'コンソーシアム', r'コンソーシアム'),
    # 協議会
    ('協議会',        '協議会',            r'協議会'),
    # 実行委員会等
    ('実行委員会等',  '実行委員会',        r'実行委員会'),
    ('実行委員会等',  '運営委員会',        r'運営委員会'),
    ('実行委員会等',  '組織委員会',        r'組織委員会'),
    # その他（集合・プレースホルダー）
    ('国の機関',    '行政機関集合',   r'^(その他|局ほか)[0-9]+(都道府県)?労働局'),  # 集合形式（辞書未収録）
    ('国の機関',    '行政機関集合',   r'^その他[\(（]?\d+局[\)）]?$'),              # その他(37局)等
    # ─ 国の機関 局種別フォールバック ─────────────────────────────────────────
    ('国の機関',    '労働局',         r'^.+労働局$'),
    ('国の機関',    '法務局',         r'法務局'),
    ('国の機関',    '地方整備局',     r'地方整備局|整備局$'),
    ('国の機関',    '農政局',         r'農政局'),
    ('国の機関',    '運輸局',         r'運輸局$'),
    ('国の機関',    '経済産業局',     r'経済産業局'),
    ('国の機関',    '管区警察局',     r'管区警察局|警察支局$'),
    ('国の機関',    '厚生局',         r'厚生局'),
    ('国の機関',    '公安調査局',     r'公安調査局'),
    ('国の機関',    '防衛局',         r'防衛局$|防衛支局$'),
    ('国の機関',    '森林管理局',     r'森林管理局'),
    ('国の機関',    '出入国在留管理局', r'出入国在留管理局'),
    ('国の機関',    '総合通信局',     r'総合通信局'),
    ('国の機関',    '航空局',         r'航空局$'),
    ('国の機関',    '国税局',         r'国税局$'),
    ('国の機関',    '開発局',         r'開発局$'),
    ('その他',       'プレースホルダー', r'^その他$|^その他の支出先$|^その他支出先$|^その他の支出$|^その他契約$'),
    # 民間企業(集合)
    ('民間企業',      '民間企業(集合)',  r'その他民間|^その他事業者$|その他[（(]?[0-9]+社[）)]?|その他[0-9]+社'),
    # 医療機関(集合)
    ('医療・福祉法人', '医療機関(集合)', r'^その他.*(?:医療機関|補装具業者|補装具の制作業者)'),
    # 漁業者（集合）
    ('協同組合等',    '漁業者',            r'^その他.*漁業者'),
    ('協同組合等',    '漁業者',            r'漁業者$'),        # 沿岸漁業者等（「その他〜」以外）
    # ─ 地方公共団体集合（匿名化） ─────────────────────────────
    ('地方公共団体', '地方公共団体集合',  r'^地方公共団体\d+$'),  # 地方公共団体1等（匿名化）
    # ─ 国際機関事務局 ──────────────────────────────────────────
    ('外国法人・国際機関', '国際機関',    r'(?:APEC|OAS|PIF|SAARC|GEO|MOPAN|APG|PECC|ABAC|RCEP|カリコム|日中韓|国際獣疫|国際穀物|博覧会国際).*事務局$'),
    # ─ 実行委員会等（事務局） ──────────────────────────────────
    ('実行委員会等',  '実行委員会',       r'^カルテット事務局$'),  # 文化芸術系国内事務局
    # ─ 事業名・業務名・費目名混入 ──────────────────────────────
    ('事業', 'プロジェクト名', r'プロジェクト$|の構築$'),
    ('事業', '業務名',        r'関係業務$|に関する業務$|推進業務$|推進事業$|製表事業$|支援事業$|発展支援事業$'),
    ('事業', '費目名',        r'^調査費$|^補助金$|^補助金執行$|^研究業務費$|^審査業務費$|^事務費$|^積立・繰越金$|^法人共通$|^法人$'),
    # ─ 受益者集合（個別） ──────────────────────────────────────
    ('その他',       '受益者集合',       r'^文化功労者$'),  # 文化庁文化功労者補償金
    ('その他',       '受益者集合',       r'^申請人$'),      # 特許・審査等の申請者
    ('その他',       '受益者集合',       r'^通訳人$'),      # 裁判所・刑事司法機関の通訳人
    # ─ 匿名化エントリ ──────────────────────────────────────────
    ('その他',       'プレースホルダー', r'^[A-Z]$'),       # 匿名化エントリ（A〜J等・単一英字）
]

KAKU_COMPILED = [(l1, l2, re.compile(pat)) for l1, l2, pat in KAKU_PATTERNS]
SEPARATORS    = re.compile(r'[・、]')

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
        if any(pat.search(seg) for _, _, pat in KAKU_COMPILED)
    )
    return kaku_segments >= 2


# ─────────────────────────────────────────────────────────────
# Step 1: 辞書ロード（name → (l1, l2)）
# ─────────────────────────────────────────────────────────────
def load_dict_labels(dict_dir: str) -> dict[str, tuple[str, str]]:
    """各辞書 CSV からラベルマップを構築: {name → (l1, l2)}"""
    result: dict[str, tuple[str, str]] = {}

    for fname in sorted(os.listdir(dict_dir)):
        if not fname.endswith('.csv'):
            continue

        # 別処理ファイル
        if fname in ('special_corporation_names.csv', 'aggregate_names.csv'):
            continue

        fpath = os.path.join(dict_dir, fname)

        with open(fpath, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []

            if fname in MINISTRY_SCHEMA_COLS:
                # 府省庁スキーマ
                l1, l2 = DICT_LABEL.get(fname, ('国の機関', '府省庁'))
                for row in reader:
                    for col in MINISTRY_SCHEMA_COLS[fname]:
                        val = row.get(col, '').strip()
                        if val and val not in result:
                            result[val] = (l1, l2)

            elif 'name' in fieldnames and fname in DICT_LABEL:
                # 標準スキーマ（match_type列を尊重するが完全一致のみ辞書化）
                l1, l2_default = DICT_LABEL[fname]
                has_match_type = 'match_type' in fieldnames
                has_l2_col = 'l2' in fieldnames  # per-row l2 override (e.g. field_office_names.csv)
                for row in reader:
                    name = row.get('name', '').strip()
                    if not name or name.startswith('#'):
                        continue
                    if has_match_type and row.get('match_type', '').strip() == 'regex':
                        continue  # regex エントリはスキップ（完全一致のみ辞書化）
                    row_l2 = row.get('l2', '').strip() if has_l2_col else ''
                    l2 = row_l2 if row_l2 else l2_default
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
                # L2: 特殊法人 or 特殊会社
                l2 = '特殊会社' if subtype.startswith('特殊会社') else '特殊法人'
                if name not in result:
                    result[name] = ('特殊法人・特別の法人', l2)

    # aggregate_names.csv: category → (L1, L2) マッピング（完全一致のみ）
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
    _AGG_NAME_OVERRIDE_L1: dict[str, str] = {
        '都道府県が適当と認めた団体': 'その他',
    }
    _AGG_NAME_OVERRIDE_L2: dict[str, str] = {
        '都道府県が適当と認めた団体': '特定団体集合',
    }
    agg_path = os.path.join(dict_dir, 'aggregate_names.csv')
    if os.path.exists(agg_path):
        with open(agg_path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('name', '').strip()
                category = row.get('category', '').strip()
                match_type = row.get('match_type', '').strip()
                if not name or match_type == 'regex':
                    continue
                l1 = _AGG_NAME_OVERRIDE_L1.get(name) or _AGG_L1.get(category, 'その他')
                l2 = _AGG_NAME_OVERRIDE_L2.get(name) or _AGG_CATEGORY_L2.get(category, '不明')
                if name not in result:
                    result[name] = (l1, l2)

    return result


# ─────────────────────────────────────────────────────────────
# メイン処理
# ─────────────────────────────────────────────────────────────
def main():
    print('=== generate-entity-labels.py ===')

    # 全 spendingName を rs2024-structured.json から取得（実際の支出データ全件）
    print(f'読み込み: {STRUCTURED_JSON}')
    with open(STRUCTURED_JSON, encoding='utf-8') as f:
        structured: dict = json.load(f)
    # ユニーク spendingName を抽出（analyze-label-coverage.py と同じ母数）
    all_names: list[str] = sorted(set(
        s['spendingName'] for s in structured['spendings']
        if s.get('spendingName')
    ))
    print(f'  総 spendingName 数: {len(all_names):,}件')

    # ══════════════════════════════════════════════════════════
    # Step 1: 辞書マッチング
    # ══════════════════════════════════════════════════════════
    print('Step 1: 辞書ロード中...')
    dict_labels = load_dict_labels(DICT_DIR)
    print(f'  辞書エントリ数: {len(dict_labels):,}件')

    # ══════════════════════════════════════════════════════════
    # Step 2: 格パターンマッチング
    # ══════════════════════════════════════════════════════════
    print('Step 2: 格パターン適用中...')
    skipped_names = {n for n in all_names if is_skip_target(n)}
    target_names  = [n for n in all_names if n not in skipped_names]

    # name → (l1, l2) のラベルマップを構築
    # 優先度: Step 2 > Step 1（Step 2 はより詳細なL2を持つ）
    labels: dict[str, dict[str, str]] = {}

    # Step 1 を先に適用（下位優先）
    for name in all_names:
        if name in dict_labels:
            l1, l2 = dict_labels[name]
            labels[name] = {'l1': l1, 'l2': l2}

    # Step 2 を適用（上書き = 高優先）
    for name in target_names:
        matched = [(l1, l2) for l1, l2, pat in KAKU_COMPILED if pat.search(name)]
        if matched:
            # 最初のマッチを採用
            l1, l2 = matched[0]
            labels[name] = {'l1': l1, 'l2': l2}

    # コンソーシアム・共同体バイパス（is_skip_target で除外されていても適用）
    bypass_count = 0
    for name in skipped_names:
        if _CONSORTIUM_ANY.search(name):
            l2 = 'コンソーシアム'  # default
            for l2_label, pat in _CONSORTIUM_SUBS:
                if pat.search(name):
                    l2 = l2_label
                    break
            labels[name] = {'l1': 'コンソーシアム・共同体', 'l2': l2}
            bypass_count += 1

    labeled_count = len(labels)
    total_count   = len(all_names)
    print(f'  スキップ対象（複合名称）: {len(skipped_names):,}件  うちコンソーシアムバイパス: {bypass_count}件')
    print(f'  ラベル付与: {labeled_count:,}件 / {total_count:,}件 = {labeled_count/total_count*100:.1f}%')

    # L1 分布を表示
    from collections import Counter
    l1_counts = Counter(v['l1'] for v in labels.values())
    print('\n[L1 分布]')
    for l1, cnt in sorted(l1_counts.items(), key=lambda x: -x[1]):
        print(f'  {l1:<24s}: {cnt:6,}件')

    # ══════════════════════════════════════════════════════════
    # 出力
    # ══════════════════════════════════════════════════════════
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(labels, f, ensure_ascii=False, indent=None, separators=(',', ':'))

    size_kb = os.path.getsize(OUTPUT_JSON) / 1024
    print(f'\n出力: {OUTPUT_JSON}')
    print(f'  ファイルサイズ: {size_kb:.1f} KB ({size_kb/1024:.2f} MB)')
    print('完了')


if __name__ == '__main__':
    main()
