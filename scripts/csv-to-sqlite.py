#!/usr/bin/env python3
"""
recipients_without_total.csv を SQLite DB に変換する。
出力: data/result/recipients.db
"""

import csv
import sqlite3
import os
import sys

CSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'result', 'recipients_without_total.csv')
DB_PATH  = os.path.join(os.path.dirname(__file__), '..', 'data', 'result', 'recipients.db')

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS recipients (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_type              TEXT,
    fiscal_year             INTEGER,
    project_id              INTEGER,
    project_name            TEXT,
    ministry_order          INTEGER,
    policy_ministry         TEXT,
    ministry                TEXT,
    bureau                  TEXT,
    division                TEXT,
    section                 TEXT,
    office                  TEXT,
    team                    TEXT,
    unit                    TEXT,
    block_number            TEXT,
    block_name              TEXT,
    recipient_count         INTEGER,
    role                    TEXT,
    block_total_amount      INTEGER,
    recipient_name          TEXT,
    corporate_number        TEXT,
    address                 TEXT,
    corporate_type          INTEGER,
    is_other                INTEGER,   -- 0/1 boolean
    recipient_total_amount  INTEGER,
    contract_summary        TEXT,
    amount                  INTEGER,
    contract_method         TEXT,
    contract_method_detail  TEXT,
    bidder_count            INTEGER,
    winning_rate            REAL,
    single_bidder_reason    TEXT,
    other_contract          INTEGER    -- 0/1 boolean
)
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_project_id      ON recipients(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_corporate_number ON recipients(corporate_number)",
    "CREATE INDEX IF NOT EXISTS idx_recipient_name  ON recipients(recipient_name)",
    "CREATE INDEX IF NOT EXISTS idx_ministry         ON recipients(ministry)",
    "CREATE INDEX IF NOT EXISTS idx_amount          ON recipients(amount)",
]

COLUMN_MAP = {
    'シート種別':     'sheet_type',
    '事業年度':       'fiscal_year',
    '予算事業ID':     'project_id',
    '事業名':         'project_name',
    '府省庁の建制順': 'ministry_order',
    '政策所管府省庁': 'policy_ministry',
    '府省庁':         'ministry',
    '局・庁':         'bureau',
    '部':             'division',
    '課':             'section',
    '室':             'office',
    '班':             'team',
    '係':             'unit',
    '支出先ブロック番号': 'block_number',
    '支出先ブロック名':   'block_name',
    '支出先の数':     'recipient_count',
    '事業を行う上での役割': 'role',
    'ブロックの合計支出額': 'block_total_amount',
    '支出先名':       'recipient_name',
    '法人番号':       'corporate_number',
    '所在地':         'address',
    '法人種別':       'corporate_type',
    'その他支出先':   'is_other',
    '支出先の合計支出額': 'recipient_total_amount',
    '契約概要':       'contract_summary',
    '金額':           'amount',
    '契約方式等':     'contract_method',
    '具体的な契約方式等': 'contract_method_detail',
    '入札者数':       'bidder_count',
    '落札率':         'winning_rate',
    '一者応札・一者応募又は競争性のない随意契約となった理由及び改善策(支出額10億円以上)': 'single_bidder_reason',
    'その他の契約':   'other_contract',
}

INTEGER_COLS = {
    'fiscal_year', 'project_id', 'ministry_order', 'recipient_count',
    'block_total_amount', 'corporate_type', 'recipient_total_amount',
    'amount', 'bidder_count',
}
REAL_COLS    = {'winning_rate'}
BOOL_COLS    = {'is_other', 'other_contract'}  # TRUE/FALSE → 1/0


def to_int(v: str):
    v = v.strip().replace(',', '')
    return int(v) if v else None

def to_real(v: str):
    v = v.strip().replace('%', '').replace(',', '')
    return float(v) if v else None

def to_bool(v: str):
    return 1 if v.strip().upper() == 'TRUE' else 0

def convert(col: str, raw: str):
    if col in BOOL_COLS:
        return to_bool(raw)
    if col in INTEGER_COLS:
        return to_int(raw)
    if col in REAL_COLS:
        return to_real(raw)
    return raw.strip() if raw.strip() else None


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing DB: {DB_PATH}")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute(CREATE_TABLE)
    for idx_sql in CREATE_INDEXES:
        cur.execute(idx_sql)

    cols_ordered = list(COLUMN_MAP.values())
    placeholders = ', '.join(['?'] * len(cols_ordered))
    insert_sql = f"INSERT INTO recipients ({', '.join(cols_ordered)}) VALUES ({placeholders})"

    total = 0
    with open(CSV_PATH, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        batch = []
        for row in reader:
            values = [convert(COLUMN_MAP[jp], row[jp]) for jp in reader.fieldnames]
            batch.append(values)
            if len(batch) >= 5000:
                cur.executemany(insert_sql, batch)
                total += len(batch)
                batch = []
                print(f"  inserted {total:,} rows...", end='\r', flush=True)
        if batch:
            cur.executemany(insert_sql, batch)
            total += len(batch)

    con.commit()
    con.close()
    print(f"\nDone. {total:,} rows → {DB_PATH}")
    size_mb = os.path.getsize(DB_PATH) / 1024 / 1024
    print(f"DB size: {size_mb:.1f} MB")


if __name__ == '__main__':
    main()
