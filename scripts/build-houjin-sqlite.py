#!/usr/bin/env python3
"""
NTA法人番号CSVをSQLiteデータベースに変換する

入力: data/download/houjin-bangou/00_zenkoku_all_20260130.zip
出力: data/houjin.db

変換後は build-houjin-lookup.py が高速にクエリできる。

法人番号CSV列定義（Unicode版、ヘッダ行なし）:
  0:  連番
  1:  法人番号（13桁）
  2:  法人種別 (01=国の機関, 02=地方公共団体, 03=設立登記法人, 04=その他)
  3:  更新区分
  4:  変更年月日
  5:  登記年月日
  6:  商号又は名称
  7:  商号又は名称（カナ）
  8:  郵便番号
  9:  都道府県
  10: 市区町村
  11: 丁目番地等
"""

import csv
import io
import json
import os
import sqlite3
import sys
import time
import zipfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
ZIP_PATH = os.path.join(REPO_ROOT, 'data/download/houjin-bangou/00_zenkoku_all_20260130.zip')
OUTPUT_DB = os.path.join(REPO_ROOT, 'data/houjin.db')

BATCH_SIZE = 10_000
COMMIT_INTERVAL = 500_000


def create_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS houjin (
            corporate_number TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            name_kana        TEXT,
            type_code        TEXT,
            prefecture       TEXT,
            city             TEXT,
            address          TEXT,
            updated_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_name ON houjin(name);
    """)
    conn.commit()


def build_db() -> None:
    if not os.path.exists(ZIP_PATH):
        print(f'エラー: ZIPファイルが見つかりません: {ZIP_PATH}', file=sys.stderr)
        sys.exit(1)

    # 既存DBを削除して再作成
    if os.path.exists(OUTPUT_DB):
        os.remove(OUTPUT_DB)
        print(f'既存DB削除: {OUTPUT_DB}')

    conn = sqlite3.connect(OUTPUT_DB)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = NORMAL')
    conn.execute('PRAGMA cache_size = -64000')  # 64MB cache
    create_db(conn)

    start = time.time()
    row_count = 0
    batch: list[tuple] = []

    print(f'ZIPを読み込み中: {ZIP_PATH}', flush=True)
    with zipfile.ZipFile(ZIP_PATH, 'r') as zf:
        csv_name = [n for n in zf.namelist() if n.endswith('.csv')][0]
        print(f'  CSVファイル: {csv_name}', flush=True)

        with zf.open(csv_name) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
            for row in reader:
                if len(row) < 11:
                    continue

                corporate_number = row[1].strip()
                if not corporate_number:
                    continue

                name      = row[6].strip()
                name_kana = row[7].strip() if len(row) > 7 else ''
                type_code  = row[2].strip()
                prefecture = row[9].strip() if len(row) > 9 else ''
                city       = row[10].strip() if len(row) > 10 else ''
                address    = (prefecture + city) if (prefecture or city) else ''
                updated_at = row[4].strip() if len(row) > 4 else ''

                batch.append((corporate_number, name, name_kana, type_code,
                              prefecture, city, address, updated_at))
                row_count += 1

                if len(batch) >= BATCH_SIZE:
                    conn.executemany(
                        'INSERT OR REPLACE INTO houjin VALUES (?,?,?,?,?,?,?,?)',
                        batch
                    )
                    batch.clear()

                if row_count % COMMIT_INTERVAL == 0:
                    conn.commit()
                    elapsed = time.time() - start
                    print(f'  {row_count:,} 行処理済み ({elapsed:.0f}秒)', flush=True)

    # 残りをコミット
    if batch:
        conn.executemany('INSERT OR REPLACE INTO houjin VALUES (?,?,?,?,?,?,?,?)', batch)
    conn.commit()
    conn.close()

    elapsed = time.time() - start
    db_size_mb = os.path.getsize(OUTPUT_DB) / 1024 / 1024
    print(f'\n完了: {row_count:,} 行 → {OUTPUT_DB}')
    print(f'  DB サイズ: {db_size_mb:.1f} MB / 所要時間: {elapsed:.0f}秒')


if __name__ == '__main__':
    build_db()
