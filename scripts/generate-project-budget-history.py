"""2025年版の最新CSVに記載された過年度値から、事業の予算推移を生成する。

node scripts/download-rs-csv.mjs 2025 2-1
python scripts/generate-project-budget-history.py

ZIPを直接読むことで、WindowsのZIPファイル名の文字化けも回避する。
過年度版のシートは混在させない。会計内訳は合計行に加算しない。
"""
import csv
import gzip
import hashlib
import io
import json
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SHEET_YEAR = 2025
FIELDS = {
    'initialBudget': '当初予算(合計)',
    'totalBudget': '計(歳出予算現額合計)',
    'executedAmount': '執行額(合計)',
}


def amount(value):
    value = value.strip().replace(',', '')
    if value in ('', '-', '―', '－'):
        return None
    # Fail on unexpected values rather than silently manufacturing a zero.
    from decimal import Decimal
    number = Decimal(value)
    if not number.is_finite() or number != number.to_integral_value():
        raise ValueError(f'Invalid yen amount: {value}')
    return int(number)


def build_projects(rows):
    projects = {}
    seen = set()
    for raw in rows:
        row = {unicodedata.normalize('NFKC', k).strip(): v for k, v in raw.items()}
        if row.get('事業年度') != str(SHEET_YEAR):
            raise ValueError('Unexpected RS sheet year')
        if not any(row.get(field, '').strip() for field in FIELDS.values()):
            continue  # 会計内訳行。合計を二重計上しない。
        pid, year = row['予算事業ID'], int(row['予算年度'])
        if not pid.isdigit() or not SHEET_YEAR - 4 <= year <= SHEET_YEAR:
            raise ValueError(f'Unexpected project/year: {pid}/{year}')
        if (pid, year) in seen:
            raise ValueError(f'Duplicate project/year: {pid}/{year}')
        seen.add((pid, year))
        point = {'fiscalYear': year, **{key: amount(row.get(field, '')) for key, field in FIELDS.items()}}
        if year >= SHEET_YEAR:
            point['executedAmount'] = None  # 当年度の 0 は確定実績ではない。
        projects.setdefault(pid, []).append(point)
    for points in projects.values():
        points.sort(key=lambda point: point['fiscalYear'])
    return projects


def main():
    source = Path('data/download/RS_2025/2-1_RS_2025_予算・執行_サマリ.zip')
    raw = source.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = [name for name in archive.namelist() if name.lower().endswith('.csv')]
        if len(names) != 1:
            raise ValueError('Expected one summary CSV')
        content = archive.read(names[0]).decode('utf-8-sig')
    projects = build_projects(csv.DictReader(io.StringIO(content)))
    if not projects:
        raise ValueError('No project history found')
    data = {
        'sheetYear': SHEET_YEAR,
        'sourceUrl': 'https://rssystem.go.jp/download-csv/2025',
        'retrievedAt': datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'projects': projects,
    }
    output = Path('public/data/rs2025-project-budget-history.json')
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    output.write_bytes(encoded)
    output.with_suffix('.json.gz').write_bytes(gzip.compress(encoded, mtime=0))
    print(f'Generated {len(projects)} projects / {sum(map(len, projects.values()))} fiscal-year records')


if __name__ == '__main__':
    main()
