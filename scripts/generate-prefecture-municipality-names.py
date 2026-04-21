#!/usr/bin/env python3
"""
都道府県・市区町村の名前リストを CSV で生成する。

出力1: data/result/prefecture_names.csv   (都道府県)
  列: pref_code, canonical_name, name, name_type

出力2: data/result/municipality_names.csv (市区町村)
  列: pref_code, prefecture_name, canonical_name, name, name_type

市区町村データのソース: data/houjin.db の (prefecture, city) カラム
  houjin.db の元データ: 国税庁 法人番号公表サイト（全件データ ZIP）
  https://www.houjin-bangou.nta.go.jp/download/zenken/index.html
"""

import csv
import os
import re
import sqlite3

HOUJIN_DB  = os.path.join(os.path.dirname(__file__), '..', 'data', 'houjin.db')
PREF_OUT   = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'prefecture_names.csv')
MUNI_OUT   = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'municipality_names.csv')

# 都道府県コード（JIS X 0401）と正式名称・通称
PREFECTURES = [
    ("01", "北海道",   []),
    ("02", "青森県",   ["青森"]),
    ("03", "岩手県",   ["岩手"]),
    ("04", "宮城県",   ["宮城"]),
    ("05", "秋田県",   ["秋田"]),
    ("06", "山形県",   ["山形"]),
    ("07", "福島県",   ["福島"]),
    ("08", "茨城県",   ["茨城"]),
    ("09", "栃木県",   ["栃木"]),
    ("10", "群馬県",   ["群馬"]),
    ("11", "埼玉県",   ["埼玉"]),
    ("12", "千葉県",   ["千葉"]),
    ("13", "東京都",   ["東京"]),
    ("14", "神奈川県", ["神奈川"]),
    ("15", "新潟県",   ["新潟"]),
    ("16", "富山県",   ["富山"]),
    ("17", "石川県",   ["石川"]),
    ("18", "福井県",   ["福井"]),
    ("19", "山梨県",   ["山梨"]),
    ("20", "長野県",   ["長野"]),
    ("21", "岐阜県",   ["岐阜"]),
    ("22", "静岡県",   ["静岡"]),
    ("23", "愛知県",   ["愛知"]),
    ("24", "三重県",   ["三重"]),
    ("25", "滋賀県",   ["滋賀"]),
    ("26", "京都府",   ["京都"]),
    ("27", "大阪府",   ["大阪"]),
    ("28", "兵庫県",   ["兵庫"]),
    ("29", "奈良県",   ["奈良"]),
    ("30", "和歌山県", ["和歌山"]),
    ("31", "鳥取県",   ["鳥取"]),
    ("32", "島根県",   ["島根"]),
    ("33", "岡山県",   ["岡山"]),
    ("34", "広島県",   ["広島"]),
    ("35", "山口県",   ["山口"]),
    ("36", "徳島県",   ["徳島"]),
    ("37", "香川県",   ["香川"]),
    ("38", "愛媛県",   ["愛媛"]),
    ("39", "高知県",   ["高知"]),
    ("40", "福岡県",   ["福岡"]),
    ("41", "佐賀県",   ["佐賀"]),
    ("42", "長崎県",   ["長崎"]),
    ("43", "熊本県",   ["熊本"]),
    ("44", "大分県",   ["大分"]),
    ("45", "宮崎県",   ["宮崎"]),
    ("46", "鹿児島県", ["鹿児島"]),
    ("47", "沖縄県",   ["沖縄"]),
]

# 都道府県名 → コードのマップ
PREF_CODE_MAP = {name: code for code, name, _ in PREFECTURES}


def strip_gun(city: str) -> str | None:
    """
    '三重郡川越町' → '川越町'
    郡付きでなければ None を返す。
    """
    m = re.match(r'^.{2,5}郡(.+)$', city)
    return m.group(1) if m else None


def strip_island(city: str) -> str | None:
    """
    '三宅島三宅村' → '三宅村', '八丈島八丈町' → '八丈町'
    島名プレフィックスがない場合は None。
    """
    m = re.match(r'^.{2,4}島(.+[村町])$', city)
    return m.group(1) if m else None


def generate_prefectures():
    rows = []
    for code, canonical, aliases in PREFECTURES:
        rows.append(dict(pref_code=code, canonical_name=canonical,
                         name=canonical, name_type="canonical"))
        for alias in aliases:
            rows.append(dict(pref_code=code, canonical_name=canonical,
                             name=alias, name_type="alias"))
    return rows


def generate_municipalities():
    con = sqlite3.connect(HOUJIN_DB)
    cur = con.cursor()
    cur.execute("""
        SELECT DISTINCT prefecture, city
        FROM houjin
        WHERE prefecture != '' AND city != ''
        ORDER BY prefecture, city
    """)
    raw = cur.fetchall()
    con.close()

    rows = []
    seen_names: set[str] = set()   # 重複チェック（同一名が複数府県に存在する場合は別エントリ）

    for prefecture, city in raw:
        pref_code = PREF_CODE_MAP.get(prefecture, "")

        entries = [(city, "canonical")]

        # 郡付き → 郡なしをaliasに追加
        short = strip_gun(city)
        if short:
            entries.append((short, "alias"))

        # 離島プレフィックス除去（東京都専用など）
        island_short = strip_island(city)
        if island_short and island_short not in [e[0] for e in entries]:
            entries.append((island_short, "alias"))

        for name, name_type in entries:
            rows.append(dict(
                pref_code=pref_code,
                prefecture_name=prefecture,
                canonical_name=city,
                name=name,
                name_type=name_type,
            ))

    return rows


def check_duplicates(rows: list[dict], key: str) -> list[str]:
    names = [r[key] for r in rows]
    seen, dups = set(), set()
    for n in names:
        if n in seen:
            dups.add(n)
        seen.add(n)
    return sorted(dups)


def main():
    os.makedirs(os.path.dirname(PREF_OUT), exist_ok=True)

    # --- 都道府県 ---
    pref_rows = generate_prefectures()
    with open(PREF_OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=["pref_code", "canonical_name", "name", "name_type"])
        w.writeheader()
        w.writerows(pref_rows)
    print(f"都道府県: {len(pref_rows)} rows (47 prefectures) → {PREF_OUT}")

    # --- 市区町村 ---
    muni_rows = generate_municipalities()
    with open(MUNI_OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            "pref_code", "prefecture_name", "canonical_name", "name", "name_type"])
        w.writeheader()
        w.writerows(muni_rows)

    canonical_count = sum(1 for r in muni_rows if r["name_type"] == "canonical")
    alias_count     = sum(1 for r in muni_rows if r["name_type"] == "alias")
    print(f"市区町村: {canonical_count} 件 + alias {alias_count} 件 = {len(muni_rows)} rows → {MUNI_OUT}")

    # 重複チェック（同一 name が同一 prefecture 内で重複している場合のみ警告）
    from collections import Counter
    name_pref_pairs = [(r["prefecture_name"], r["name"]) for r in muni_rows]
    dup_pairs = [p for p, cnt in Counter(name_pref_pairs).items() if cnt > 1]
    if dup_pairs:
        print(f"WARNING: {len(dup_pairs)} duplicate (prefecture, name) pairs: {dup_pairs[:5]}...")
    else:
        print("重複なし ✓")


if __name__ == '__main__':
    main()
