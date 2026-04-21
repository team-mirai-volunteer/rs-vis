"""
Invalid 支出先 分析スクリプト

data/result/recipient_dictionary.csv の invalid エントリを分類し、
データ作成元への改善提案のための分析データを出力する。

実行:
  python3 scripts/analyze-invalid-recipients.py
"""

import csv
import re
import unicodedata
import collections
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
INPUT_CSV = REPO_ROOT / 'data' / 'result' / 'recipient_dictionary.csv'


def normalize(s: str) -> str:
    return unicodedata.normalize('NFKC', s)


# ─── 集合・複数表現パターン ───
COLLECTIVE_RE = [
    re.compile(r'ほか'),
    re.compile(r'など'),
    re.compile(r'^その他'),
    re.compile(r'[0-9]+社'),
    re.compile(r'[0-9]+者以降'),
    re.compile(r'[0-9]+件'),
    re.compile(r'\([0-9]+[^)]*[市町村都道府県機関][^)]*\)'),
    re.compile(r'[・、].+(?:法人|会社|機関|組合)'),
    re.compile(r'(?:法人|会社|機関|組合)[・、]'),
]

# ─── 事業・プロジェクト名パターン ───
PROJECT_RE = re.compile(
    r'事業$|プロジェクト$|計画$|プログラム$|基金$|補助金$|助成金$|給付金$|交付金$|支援金$|委託$'
)
PROJECT_NOT_RE = re.compile(r'法人|会社|組合|機構|独立行政|大学|学校')

# ─── 法人格キーワード ───
KAKU_LIST = [
    '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
    '一般社団法人', '公益社団法人', '一般財団法人', '公益財団法人',
    '特定非営利活動法人', 'NPO法人',
    '独立行政法人', '国立研究開発法人', '国立大学法人', '公立大学法人',
    '学校法人', '社会福祉法人', '医療法人', '宗教法人',
    '農業協同組合', '漁業協同組合', '事業協同組合',
]

# ─── 任意団体っぽいキーワード ───
ARBITRARY_RE = re.compile(
    r'協会|連合会|連盟|協議会|委員会|実行委員会|推進協議会|センター|コンソーシアム'
    r'|フォーラム|研究会|学会|振興会|促進会|推進会|ネットワーク|プラットフォーム'
)

# ─── 英字のみ（全角変換後も日本語なし）───
ASCII_ONLY_RE = re.compile(r'^[A-Za-z0-9\s\.\,\-\&\(\)\'\"\/\\\+\#\@\!\?\*\:\;]+$')

# ─── 外国法人っぽいキーワード ───
FOREIGN_RE = re.compile(
    r'LLC|Ltd\.?|Inc\.?|Corp\.?|GmbH|B\.V\.|S\.A\.|PTE\.?|PLC|AG|KK'
    r'|Pty|N\.V\.|S\.p\.A\.|SARL|GmbH|Co\.,?\s?Ltd'
    r'|ＬＬＣ|Ｌｔｄ|Ｉｎｃ|Ｃｏｒｐ'
)


def classify(r: dict) -> list[str]:
    name  = r['name']
    norm  = normalize(name)
    cn    = r['corporate_number']
    ci    = r['cn_in_db'] == 'True'
    nm    = r['name_cn_match'] == 'True'
    nc    = r['cn_name_contained'] == 'True'

    cats = []

    # 1. 集合・複数表現
    if any(p.search(name) for p in COLLECTIVE_RE):
        cats.append('集合・複数表現')

    # 2. その他プレースホルダー
    if re.match(r'^その他', name):
        cats.append('その他プレースホルダー')

    # 3. 英字のみ（NFKC変換後も日本語文字なし）
    if ASCII_ONLY_RE.match(norm) and not re.search(r'[\u3040-\u9FFF]', norm):
        cats.append('英字のみ')

    # 4. 外国法人疑い（英字系の法人形態を含む）
    elif FOREIGN_RE.search(name) or FOREIGN_RE.search(norm):
        cats.append('外国法人疑い')

    # 5. 入力ミス・名称不一致（CNあり、DBの名称と不一致）
    if cn and ci and not nm and not nc:
        cats.append('入力ミス・名称不一致')

    # 6. 事業・プログラム名が支出先
    if PROJECT_RE.search(name) and not PROJECT_NOT_RE.search(name):
        cats.append('事業・プログラム名')

    # 7. 法人番号なし + 法人格なし + 任意団体系ワード
    if not cn and not any(k in name for k in KAKU_LIST) and ARBITRARY_RE.search(name):
        cats.append('任意団体・法人番号なし')

    # 8. 法人格あり・法人番号なし（格はあるがDB未登録）
    if not cn and any(k in name for k in KAKU_LIST):
        cats.append('法人格あり・CN未登録')

    # 9. その他未分類
    if not cats:
        cats.append('その他未分類')

    return cats


def main():
    with open(INPUT_CSV, encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    total   = len(rows)
    valid   = [r for r in rows if r['valid'] == 'True']
    invalid = [r for r in rows if r['valid'] == 'False']

    print(f'総エントリ: {total:,}  valid: {len(valid):,} ({len(valid)/total*100:.1f}%)  invalid: {len(invalid):,} ({len(invalid)/total*100:.1f}%)')
    print()

    cat_counter: dict[str, int]         = collections.Counter()
    cat_samples: dict[str, list[dict]]  = collections.defaultdict(list)

    for r in invalid:
        cs = classify(r)
        for c in cs:
            cat_counter[c] += 1
            if len(cat_samples[c]) < 15:
                cat_samples[c].append(r)

    inv = len(invalid)
    print('=' * 65)
    print('  Invalid カテゴリ別集計（重複あり）')
    print('=' * 65)
    for cat, cnt in cat_counter.most_common():
        print(f'  {cnt:>5,}件  {cnt/inv*100:5.1f}%  {cat}')

    print()
    for cat, cnt in cat_counter.most_common():
        print('─' * 65)
        print(f'  {cat}  ({cnt}件)')
        print('─' * 65)
        for r in cat_samples[cat]:
            cn   = r['corporate_number'] or '(なし)'
            db   = r['db_name_by_cn']    or '(なし)'
            print(f'  name={r["name"]}')
            if r['cn_in_db'] == 'True' or r['corporate_number']:
                print(f'       cn={cn}  db={db}')
        print()


if __name__ == '__main__':
    main()
