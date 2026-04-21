#!/usr/bin/env python3
"""
内閣官房「国の行政機関の組織の一覧表」PDFから府省庁の組織名を抽出する。

対象PDF: data/download/kouji_ichiran/r071215kouji.pdf (令和7年12月15日現在)
  形式: 各省庁 → Ａ内部部局 / Ｂ審議会等 / Ｃ施設等機関 / Ｄ特別の機関 / Ｅ外局 / Ｆ地方支分部局
        局・部名 ［課名、課名、...］ という構造

出力: public/data/dictionaries/ministry_from_ichiran.csv
列: ministry, category, bureau, section
"""

import csv
import os
import re

PDF_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'download', 'kouji_ichiran', 'r071215kouji.pdf'
)
OUT_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'ministry_from_ichiran.csv'
)

# 省庁ヘッダパターン（章番号 + 省庁名）
MINISTRY_HEADER = re.compile(
    r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹI\d一二三四五六七八九十]+\s+(.{2,20}[省庁院府委員会])$'
)

# カテゴリパターン (Ａ内部部局 など)
CATEGORY_PATTERN = re.compile(
    r'^[ＡＢＣＤＥＦＧａｂｃｄｅｆ]\s+(.{2,20})$'
)

# 局・部の末尾
BUREAU_ENDINGS = re.compile(r'[局部館院庁所]$')

# 課の末尾
SECTION_ENDINGS = re.compile(r'[課室班係官]$')


def join_char_split(text: str) -> str:
    """縦書き分割文字を結合: '外 務 省' → '外務省'"""
    # 全角スペースや半角スペースで区切られた1文字ずつのテキストを結合
    # パターン: 漢字1文字 + スペース + 漢字1文字...
    # ただし単語間スペースは保持する難しさがあるので、シンプルに全スペース除去した版も作る
    return re.sub(r'\s+', '', text)


def normalize_line(line: str) -> str:
    """行を正規化: スペース除去、数字アノテーション除去"""
    s = re.sub(r'\s+', '', line)
    # ［...］内も含めて保持
    # 職員数・人数の括弧注記を除去: （2人）、（各2人）、（充て職）等
    s = re.sub(r'（[^）]{1,30}）', '', s)
    # 半角括弧も
    s = re.sub(r'\([^)]{1,30}\)', '', s)
    return s.strip()


_KANJI_NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
_ARABIC_KANJI = {1:'一',2:'二',3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十',11:'十一',12:'十二'}


def _kanji_to_int(s: str) -> int:
    """漢数字（一〜十二程度）を整数に変換: 十一→11"""
    if s in _KANJI_NUM:
        return _KANJI_NUM[s]
    if s == '十':
        return 10
    if s.startswith('十'):
        return 10 + _KANJI_NUM.get(s[1:], 0)
    if s.endswith('十'):
        return _KANJI_NUM.get(s[0], 1) * 10
    if '十' in s:
        parts = s.split('十', 1)
        return _KANJI_NUM.get(parts[0], 1) * 10 + _KANJI_NUM.get(parts[1], 0)
    return 0


def _expand_item(item: str) -> list[str]:
    """カンマ区切り後の1要素を展開: '第五～第九' → ['第五',...,'第九'], 'X' → ['X']"""
    m = re.match(r'^第([一二三四五六七八九十]+)～第([一二三四五六七八九十]+)$', item.strip())
    if m:
        start = _kanji_to_int(m.group(1))
        end = _kanji_to_int(m.group(2))
        return [f'第{_ARABIC_KANJI[i]}' for i in range(start, end + 1) if i in _ARABIC_KANJI]
    return [item.strip()] if item.strip() else []


def expand_angle_content(text: str) -> list[str]:
    """＜...＞内コンテンツをプレフィックスリストに展開する。
    通常: '東北、関東、...' → ['東北', '関東', ...]
    単純範囲: '第一～第十一' → ['第一', ..., '第十一']
    混合: '第一～第四、第六～第十' → ['第一', ..., '第四', '第六', ..., '第十']
    """
    result = []
    for item in text.split('、'):
        result.extend(_expand_item(item))
    return result


def strip_count(s: str) -> str:
    """末尾の半角・全角数字を除去: '管区警察局６' → '管区警察局'"""
    return re.sub(r'[0-9０-９]+$', '', s).strip()


def extract_bureaus_and_sections(bracket_text: str) -> tuple[list[str], list[str]]:
    """
    '官房長、公文書監理官、...、総務課、人事課、...' から
    課名リストを抽出する。
    """
    items = [s.strip() for s in bracket_text.split('、') if s.strip()]
    sections = []
    for item in items:
        item_clean = re.sub(r'\s', '', item)
        item_clean = re.sub(r'（[^）]{1,30}）', '', item_clean).strip()
        if item_clean and SECTION_ENDINGS.search(item_clean) and len(item_clean) >= 2:
            sections.append(item_clean)
    return sections


def join_continuation_lines(raw_text: str) -> list[str]:
    """
    インデントあり行（新エントリ）とインデントなし行（前行の継続）を結合する。
    例:
      '  大 臣 官 房 ［ 官 房 長 、 公 文 書 監 理 官 、 監 察 査 察'
      '官 、 儀 典 長 ...]'
      → '大臣官房［官房長、公文書監理官、監察査察官、儀典長...]'

    ただし以下の行は継続ではなく新エントリとして扱う:
      - 章番号始まり: '２ 外 局', '(1)林野庁' など
      - 角括弧 ＜ 始まり
      - ページ番号（数字のみ）
    """
    # 新エントリ強制パターン（インデントなしでも新ブロック開始）
    FORCE_NEW = re.compile(
        r'^(\d+\s|[（(]\d|[２３４５６７８９１]+\s|＜|【|\d+$)'
    )

    blocks = []
    current = None
    open_brackets = 0  # ［ の未閉じ数

    for raw_line in raw_text.split('\n'):
        if not raw_line.strip():
            continue
        stripped = raw_line.strip()
        # ページ番号行（1〜3桁の数字のみ）は ＜...＞ 内容を分断するためスキップ
        if re.match(r'^\d{1,3}$', stripped):
            continue
        has_indent = raw_line.startswith(' ') or raw_line.startswith('\t')
        is_forced_new = bool(FORCE_NEW.match(stripped))

        if (has_indent or current is None or is_forced_new) and not (
            current is not None and open_brackets > 0 and not has_indent
        ):
            if current is not None:
                blocks.append(current)
            current = stripped
            open_brackets = stripped.count('［') - stripped.count('］')
        else:
            # 継続行: スペースなしで結合
            current = current + stripped
            open_brackets += stripped.count('［') - stripped.count('］')
            open_brackets = max(0, open_brackets)

    if current:
        blocks.append(current)
    return blocks


def parse_pdf(pdf_path: str) -> list[dict]:
    from pdfminer.high_level import extract_text
    raw = extract_text(pdf_path)

    rows = []
    current_ministry = ''
    current_category = ''

    # ページ分割（フォームフィード）
    # ＜...＞ の内容がページ境界で分断される場合は次ページと結合する（総合通信局等の対策）
    raw_pages = raw.split('\x0c')
    pages: list[str] = []
    i = 0
    while i < len(raw_pages):
        page_text = raw_pages[i]
        open_angles = page_text.count('＜') - page_text.count('＞')
        while open_angles > 0 and i + 1 < len(raw_pages):
            i += 1
            page_text = page_text + '\n' + raw_pages[i]
            open_angles += raw_pages[i].count('＜') - raw_pages[i].count('＞')
        pages.append(page_text)
        i += 1

    # ── ＜...＞展開用の状態変数 ──────────────────────────────────────────
    prev_bureau_base = ''  # 直前の局名（数字除去済み）
    prev_bureau_full = ''  # 直前の局名（フル）
    last_prefixes: list[str] = []  # 直近の展開で使ったプレフィックス（兄弟展開用）
    last_count_str: str = ''       # 直近展開に使った数字文字列（兄弟展開判定用）

    # 末尾文字パターン: prev_bureau_base にセットする条件（校=警察学校・海上保安学校等）
    ORG_ENDS = re.compile(r'[局部所署台庁会校区]$')

    for page_idx, page in enumerate(pages):
        blocks = join_continuation_lines(page)

        for idx, block in enumerate(blocks):
            norm = normalize_line(block)
            if not norm:
                continue

            # ── 次ブロックを先読み（兄弟展開判定用） ──────────────────────
            next_norm = ''
            for j in range(idx + 1, len(blocks)):
                nn = normalize_line(blocks[j])
                if nn:
                    next_norm = nn
                    break
            # ページ末尾の場合は次ページ先頭ブロックも参照（跨ぎ展開対応）
            if not next_norm and page_idx + 1 < len(pages):
                next_page_blocks = join_continuation_lines(pages[page_idx + 1])
                for b in next_page_blocks:
                    nn = normalize_line(b)
                    if nn:
                        next_norm = nn
                        break
            next_is_angle = bool(re.match(r'^＜', next_norm))

            # ── ＜...＞ 展開ブロック ─────────────────────────────────────
            # 末尾に余分な文字がある場合も考慮（例: ＜第一～第十一＞54）
            angle_m = re.match(r'^＜(.+?)＞', norm)
            if angle_m and prev_bureau_base:
                prefixes = expand_angle_content(angle_m.group(1))
                last_prefixes = prefixes
                cm = re.search(r'[0-9０-９]+$', prev_bureau_full)
                last_count_str = cm.group() if cm else ''
                for prefix in prefixes:
                    expanded = prefix + prev_bureau_base
                    rows.append(dict(
                        ministry=current_ministry,
                        category=current_category,
                        bureau=expanded,
                        section='',
                        expanded_from=prev_bureau_full,
                    ))
                prev_bureau_base = ''
                prev_bureau_full = ''
                continue

            # ＜...＞ 以外の行が来たらリセット
            prev_bureau_base = ''
            prev_bureau_full = ''

            # ── 省庁ヘッダ ──────────────────────────────────────────────
            m = re.match(r'^[XⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫxivl\d]+(.{2,20}[省庁院府])$', norm)
            if m:
                candidate = m.group(1)
                if not re.match(r'^本[省庁]$', candidate):
                    current_ministry = candidate
                    current_category = ''
                continue

            # 単独省庁名行
            if (re.match(r'^.{2,15}[省庁院府]$', norm)
                    and '（' not in norm and '、' not in norm
                    and not re.search(r'^[本１２３４５６７８９(（\d]', norm)):
                current_ministry = norm
                current_category = ''
                continue

            # ── カテゴリ行 ──────────────────────────────────────────────
            cat_m = re.match(r'^[ＡＢＣＤＥＦＧＨＩａｂｃｄｅｆA-I](.{2,15})$', norm)
            if cat_m:
                cat_text = cat_m.group(1)
                if re.search(r'[局部会機関]$', cat_text):
                    current_category = cat_text
                    continue

            # ── 局名＋課名 ─────────────────────────────────────────────
            bracket_m = re.match(r'^(.+?)［(.+?)］(.*)$', norm)
            if bracket_m:
                bureau_raw = bracket_m.group(1).strip()
                sections_raw = bracket_m.group(2)
                sections = extract_bureaus_and_sections(sections_raw)

                count_stripped = strip_count(bureau_raw)
                if count_stripped != bureau_raw and ORG_ENDS.search(count_stripped):
                    # 兄弟展開チェック: 次ブロックが ＜...＞ でなく、同じカウントなら流用
                    bm = re.search(r'[0-9０-９]+$', bureau_raw)
                    cur_count = bm.group() if bm else ''
                    if (not next_is_angle and last_prefixes
                            and cur_count and cur_count == last_count_str):
                        for prefix in last_prefixes:
                            rows.append(dict(
                                ministry=current_ministry,
                                category=current_category,
                                bureau=prefix + count_stripped,
                                section='',
                                expanded_from=bureau_raw,
                            ))
                        last_count_str = ''  # 兄弟適用済み → 連鎖防止
                    else:
                        prev_bureau_base = count_stripped
                        prev_bureau_full = bureau_raw

                if bureau_raw and 2 <= len(bureau_raw) <= 35:
                    rows.append(dict(
                        ministry=current_ministry,
                        category=current_category,
                        bureau=bureau_raw,
                        section='',
                        expanded_from='',
                    ))
                for sec in sections:
                    rows.append(dict(
                        ministry=current_ministry,
                        category=current_category,
                        bureau=bureau_raw,
                        section=sec,
                        expanded_from='',
                    ))
                continue

            # ── 局名のみ（括弧なし） ────────────────────────────────────
            # 末尾が組織文字 か、数字除去後に組織文字で終わる（例: 管区警察局６）
            _cs = strip_count(norm)
            _ends_org = bool(re.search(r'[局部所署館庁校区]$', norm)) or (
                _cs != norm and bool(ORG_ENDS.search(_cs))
            )
            if _ends_org and 2 <= len(norm) <= 25 and '（' not in norm and '、' not in norm:
                count_stripped = _cs
                if count_stripped != norm and ORG_ENDS.search(count_stripped):
                    # 兄弟展開チェック
                    sm = re.search(r'[0-9０-９]+$', norm)
                    cur_count = sm.group() if sm else ''
                    if (not next_is_angle and last_prefixes
                            and cur_count and cur_count == last_count_str):
                        for prefix in last_prefixes:
                            rows.append(dict(
                                ministry=current_ministry,
                                category=current_category,
                                bureau=prefix + count_stripped,
                                section='',
                                expanded_from=norm,
                            ))
                        last_count_str = ''  # 兄弟適用済み → 連鎖防止
                    else:
                        prev_bureau_base = count_stripped
                        prev_bureau_full = norm

                rows.append(dict(
                    ministry=current_ministry,
                    category=current_category,
                    bureau=norm,
                    section='',
                    expanded_from='',
                ))

    return rows


def main():
    rows = parse_pdf(PDF_PATH)

    # 重複除去
    seen = set()
    unique = []
    for r in rows:
        key = (r['ministry'], r['category'], r['bureau'], r['section'])
        if key not in seen and r['ministry']:
            seen.add(key)
            unique.append(r)

    # bureau_alias: ＜...＞展開済みエントリで「地方」を含む場合、除去したaliasを付与
    # 例: 九州地方防衛局 → alias=九州防衛局（支出先名の表記に合わせる）
    # ただし「地方整備局」など実データが「地方」付きの名称で存在する場合は alias を生成しない
    # → recipients.db で alias候補の実在を確認してから付与
    import sqlite3 as _sqlite3
    _con = _sqlite3.connect(os.path.join(os.path.dirname(__file__), '..', 'data', 'result', 'recipients.db'))
    _cur = _con.cursor()

    def _exists_in_db(name: str) -> bool:
        _cur.execute('SELECT 1 FROM recipients WHERE recipient_name = ? LIMIT 1', (name,))
        return _cur.fetchone() is not None

    for r in unique:
        alias = ''
        if r.get('expanded_from') and '地方' in r['bureau']:
            candidate = r['bureau'].replace('地方', '')
            # aliasが実データに存在し、かつ元のbureauが実データに存在しない場合のみ付与
            if candidate != r['bureau'] and _exists_in_db(candidate) and not _exists_in_db(r['bureau']):
                alias = candidate
        r['bureau_alias'] = alias

    _con.close()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['ministry', 'category', 'bureau', 'bureau_alias', 'section', 'expanded_from'])
        w.writeheader()
        w.writerows(unique)

    ministries = {r['ministry'] for r in unique}
    bureaus    = {(r['ministry'], r['bureau']) for r in unique if r['bureau']}
    sections   = {r['section'] for r in unique if r['section']}

    print(f"生成完了 → {OUT_PATH}")
    print(f"  総行数: {len(unique)}")
    print(f"  省庁数: {len(ministries)}")
    print(f"  局・部（ユニーク）: {len(bureaus)}")
    print(f"  課（ユニーク）: {len(sections)}")

    # 外務省の確認
    gaimu = [r for r in unique if '外務省' in r['ministry']]
    print(f"\n外務省 ({len(gaimu)}行):")
    for r in gaimu[:20]:
        print(f"  [{r['category']}] {r['bureau']} / {r['section']}")

    # 農林水産省・北海道農政事務所の確認
    hokkaido = [r for r in unique if '北海道農政' in r['bureau']]
    print(f"\n北海道農政事務所: {'✓ ヒット' if hokkaido else '✗ なし'}")
    for r in hokkaido:
        print(f"  {r}")

    # ＜...＞展開 + alias の確認
    expanded = [r for r in unique if r.get('expanded_from')]
    with_alias = [r for r in expanded if r['bureau_alias']]
    print(f"\n＜...＞展開: {len(expanded)}件  うちalias付き: {len(with_alias)}件")

    print("\nalias付きエントリ（bureau → bureau_alias）:")
    for r in with_alias:
        print(f"  [{r['ministry']}] {r['bureau']}  →  {r['bureau_alias']}")

    # 九州地方整備局の確認（bureau または bureau_alias で検索）
    kyushu = [r for r in unique if '九州地方整備局' in r['bureau'] or '九州地方整備局' in r.get('bureau_alias', '')]
    print(f"\n九州地方整備局: {'✓ ヒット' if kyushu else '✗ なし'}")
    for r in kyushu:
        print(f"  bureau={r['bureau']}  alias={r['bureau_alias']}")


if __name__ == '__main__':
    main()
