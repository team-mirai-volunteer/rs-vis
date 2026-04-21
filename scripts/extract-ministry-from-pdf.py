#!/usr/bin/env python3
"""
内閣官房「行政機構図」PDFから府省庁の組織名を抽出する。

対象PDF: https://www.cas.go.jp/jp/gaiyou/jimu/jinjikyoku/kikouzu_202508/2.pdf ~ 24.pdf
  - 2.pdf:  総括図
  - 3.pdf:  組織一覧（府省庁名のみ）
  - 4〜18.pdf: 各府省庁の組織図
  - 19〜23.pdf: 各府省庁の組織図（続き）
  - 24.pdf: 職務権限説明（所掌事務記載）

出力: data/result/ministry_from_pdf.csv
列: ministry_header, category, org_name, raw_line
  ministry_header: ページ上のヘッダ（農林水産省 など）
  category: 内部部局 / 施設等機関 / 地方支分部局 / 特別の機関 / 外局
  org_name: 抽出した組織名
  raw_line: 元のテキスト行
"""

import csv
import os
import re
import urllib.request

PDF_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'download', 'kikouzu_202508')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'result', 'ministry_from_pdf.csv')

# 組織名に使われる末尾文字
ORG_ENDINGS = re.compile(r'[課局部室庁省所館会団署院府道委員院組]$')

# 除外パターン: カウント・説明文・文脈句
EXCLUDE_PATTERNS = [
    re.compile(r'^\d'),                   # 数字始まり（職員数など）
    re.compile(r'^[（(]'),                # カッコ始まり
    re.compile(r'^\['),
    re.compile(r'人$'),                   # 「○人」
    re.compile(r'^※'),
    re.compile(r'。$'),                   # 説明文
    re.compile(r'[、。に係をのためにおける]'),  # 説明的助詞
    re.compile(r'.{25,}'),               # 長すぎる行
]

CATEGORY_MARKERS = [
    '内部部局', '施設等機関', '地方支分部局', '特別の機関', '外局',
    '審議会等', '附属機関', '試験研究機関',
]


def join_split_chars(text: str) -> str:
    """
    1文字ずつ改行で分割されている縦書きテキストを結合する。
    例: '大\n\n臣\n\n官\n\n房' → '大臣官房'
    """
    # 単一文字行（漢字1文字）が連続して \n\n で繋がるパターンを検出して結合
    result = re.sub(
        r'(?<!\n)([\u3000-\u9FFF\uF900-\uFAFF]{1})\n\n(?=[\u3000-\u9FFF\uF900-\uFAFF]{1}\n)',
        r'\1',
        text
    )
    # 残った 1文字 + 改行のパターンも処理（末尾処理）
    result = re.sub(
        r'([\u3000-\u9FFF\uF900-\uFAFF]{1})\n\n([\u3000-\u9FFF\uF900-\uFAFF]{1})(?!\n)',
        r'\1\2',
        result
    )
    return result


def normalize_org_name(name: str) -> str:
    """スペース区切りの組織名からスペースを除去。"""
    # '広 報 評 価 課' → '広報評価課'
    s = re.sub(r'\s+', '', name)
    # 職員数アノテーション除去: （3,789） など
    s = re.sub(r'（[\d,]+）', '', s)
    s = re.sub(r'（[^）]{1,30}）', '', s)  # （東北、関東…）等も除去
    return s.strip()


def is_org_name(name: str) -> bool:
    if not name or len(name) < 2:
        return False
    if not ORG_ENDINGS.search(name):
        return False
    for pat in EXCLUDE_PATTERNS:
        if pat.search(name):
            return False
    return True


def extract_from_pdf(pdf_path: str) -> list[dict]:
    from pdfminer.high_level import extract_text
    try:
        raw = extract_text(pdf_path)
    except Exception as e:
        print(f"  ERROR reading {pdf_path}: {e}")
        return []

    # ページ分割（\x0c = form feed）
    pages = raw.split('\x0c')
    results = []
    current_ministry = ''
    current_category = ''

    for page in pages:
        joined = join_split_chars(page)
        lines  = [l.strip() for l in joined.split('\n')]
        lines  = [l for l in lines if l]

        # ページ先頭の省庁ヘッダを検出（「農林水産省」「総務省」等）
        for i, line in enumerate(lines[:3]):
            clean = normalize_org_name(line)
            if re.match(r'^.{2,10}[省庁院府]$', clean) and '委員会' not in clean and '審議会' not in clean:
                current_ministry = clean
                break

        for line in lines:
            norm = normalize_org_name(line)

            # カテゴリ検出
            for cat in CATEGORY_MARKERS:
                if cat in norm:
                    current_category = cat
                    break

            if not is_org_name(norm):
                continue

            # スペース含む行を再正規化
            norm2 = re.sub(r'\s', '', line)
            norm2 = re.sub(r'（[\d,]+）', '', norm2).strip()
            norm2 = re.sub(r'（[^）]{1,30}）', '', norm2).strip()

            name = norm2 if is_org_name(norm2) else norm
            if not is_org_name(name):
                continue

            results.append({
                'ministry_header': current_ministry,
                'category': current_category,
                'org_name': name,
                'raw_line': line[:80],
            })

    return results


def main():
    from pdfminer.high_level import extract_text  # 確認

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    all_rows = []
    # 2〜23.pdf が組織図本体（24.pdf は所掌事務説明なので除外）
    for i in range(2, 24):
        pdf_path = os.path.join(PDF_DIR, f'{i}.pdf')
        if not os.path.exists(pdf_path):
            print(f"  SKIP: {pdf_path} not found")
            continue
        rows = extract_from_pdf(pdf_path)
        print(f"  {i:2d}.pdf → {len(rows):4d} org names extracted")
        all_rows.extend(rows)

    # 重複除去（ministry + category + org_name で一意化）
    seen = set()
    unique_rows = []
    for r in all_rows:
        key = (r['ministry_header'], r['category'], r['org_name'])
        if key not in seen:
            seen.add(key)
            unique_rows.append(r)

    with open(OUT_PATH, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['ministry_header', 'category', 'org_name', 'raw_line'])
        w.writeheader()
        w.writerows(unique_rows)

    print(f"\n生成完了 → {OUT_PATH}")
    print(f"  総行数（重複除去後）: {len(unique_rows)}")

    # 農林水産省 + 北海道農政事務所の確認
    maff = [r for r in unique_rows if '農林水産' in r['ministry_header']]
    print(f"\n農林水産省関連: {len(maff)} 件")
    hokkaido = [r for r in unique_rows if '北海道農政' in r['org_name']]
    if hokkaido:
        print(f"  ✓ 北海道農政事務所 ヒット: {hokkaido}")
    else:
        print("  ✗ 北海道農政事務所 見つからず")


if __name__ == '__main__':
    main()
