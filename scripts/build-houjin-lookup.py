#!/usr/bin/env python3
"""
SQLiteの法人番号DBから、RSシステム使用法人番号のルックアップJSONを生成する

前提: data/houjin.db が存在すること（build-houjin-sqlite.py で生成）
入力: public/data/rs2024-structured.json
出力: public/data/houjin-lookup.json

法人番号ごとに { name, address, isMatch } を格納する。
"""

import json
import os
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(REPO_ROOT, 'data/houjin.db')
STRUCTURED_JSON = os.path.join(REPO_ROOT, 'public/data/rs2024-structured.json')
OUTPUT_PATH = os.path.join(REPO_ROOT, 'public/data/houjin-lookup.json')


def collect_target_cns() -> dict[str, set[str]]:
    """RSシステムの構造化JSONから「法人番号 → 所属spendingName集合」を収集する"""
    print('構造化JSONを読み込み中...', flush=True)
    with open(STRUCTURED_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # corporateNumber → spendingName の集合
    cn_to_names: dict[str, set[str]] = {}
    for s in data['spendings']:
        cn = (s.get('corporateNumber') or '').strip()
        if cn:
            cn_to_names.setdefault(cn, set()).add(s['spendingName'])

    print(f'  対象法人番号数: {len(cn_to_names):,}', flush=True)
    return cn_to_names


def build_lookup(cn_to_names: dict[str, set[str]]) -> dict:
    """SQLiteから法人情報を取得してルックアップを構築する"""
    if not os.path.exists(DB_PATH):
        print(f'エラー: {DB_PATH} が見つかりません。先に build-houjin-sqlite.py を実行してください。',
              file=sys.stderr)
        sys.exit(1)

    print(f'SQLiteからクエリ中: {DB_PATH}', flush=True)
    conn = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row

    target_cns = list(cn_to_names.keys())
    lookup = {}

    # IN句のサイズ上限を避けるため1000件ずつバッチ処理
    CHUNK = 1000
    for i in range(0, len(target_cns), CHUNK):
        chunk = target_cns[i:i + CHUNK]
        placeholders = ','.join('?' * len(chunk))
        rows = conn.execute(
            f'SELECT corporate_number, name, address FROM houjin WHERE corporate_number IN ({placeholders})',
            chunk
        ).fetchall()

        for row in rows:
            cn = row['corporate_number']
            nta_name = row['name']
            address = row['address']
            # このcnに関連するspendingNameと一致するか
            related_names = cn_to_names.get(cn, set())
            is_match = nta_name in related_names
            lookup[cn] = {
                'name': nta_name,
                'address': address,
                'isMatch': is_match,
            }

    conn.close()

    found = len(lookup)
    missing = len(target_cns) - found
    print(f'  {found:,} 件マッチ / {missing} 件未発見（NTA未登録）', flush=True)

    if missing > 0:
        unfound = [cn for cn in target_cns if cn not in lookup][:10]
        print(f'  未発見の先頭10件: {unfound}', flush=True)

    return lookup


def main():
    for path, label in [(STRUCTURED_JSON, '構造化JSON'), (DB_PATH, 'SQLite DB')]:
        if not os.path.exists(path):
            print(f'エラー: {label} が見つかりません: {path}', file=sys.stderr)
            sys.exit(1)

    cn_to_names = collect_target_cns()
    lookup = build_lookup(cn_to_names)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(lookup, f, ensure_ascii=False, indent=2)

    print(f'\n完了: {OUTPUT_PATH} に {len(lookup):,} 件を出力しました')


if __name__ == '__main__':
    main()
