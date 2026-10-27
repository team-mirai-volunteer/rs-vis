"""Audit downloaded RS CSVs without modifying their contents.

python scripts/audit-rs-csv.py --year 2025 --before data/audit/20261027-rs-refresh/year_2025-before --output data/audit/20261027-rs-refresh/audit.json
Findings are investigation candidates, not findings of improper expenditure.
"""
import argparse
import csv
import hashlib
import json
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


def amount(value):
    value = (value or '').strip().replace(',', '')
    if value in ('', '-', '―', '－'):
        return None
    return int(Decimal(value))


def read_rows(file):
    with file.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'Invalid CSV column count: {file}')
            yield {unicodedata.normalize('NFKC', k).strip(): v for k, v in row.items()}


def audit(year, before):
    root = Path(f'data/year_{year}')
    files = []
    for file in sorted(root.glob('*.csv')):
        previous = before / file.name
        rows = list(read_rows(file))
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        changed = None
        if previous.exists():
            old, new = defaultdict(list), defaultdict(list)
            for r in read_rows(previous): old[r.get('予算事業ID')].append(r)
            for r in rows: new[r.get('予算事業ID')].append(r)
            changed = sorted(p for p in old.keys() | new.keys() if old.get(p) != new.get(p))
        files.append({'file': file.name, 'rows': len(rows), 'sha256': sha,
                      'beforeSha256': hashlib.sha256(previous.read_bytes()).hexdigest() if previous.exists() else None,
                      'changedPids': changed})

    def rows(prefix): return read_rows(next(root.glob(f'{prefix}_*.csv')))
    budgets = {}
    for row in rows('2-1'):
        if row['予算年度'] == str(year - 1) and row['計(歳出予算現額合計)'].strip():
            budgets[row['予算事業ID']] = {
                'budget': amount(row['計(歳出予算現額合計)']),
                'execution': amount(row['執行額(合計)'])}
    contracts, names = defaultdict(int), {}
    for row in rows('5-1'):
        pid = row['予算事業ID']
        names[pid] = row['事業名']
        # Only contract rows; do not add block and payee subtotals again.
        value = amount(row['金額'])
        if value is not None: contracts[pid] += value
    zero_budget_spending = []
    large_ratio = []
    for pid, value in contracts.items():
        b = budgets.get(pid)
        if not b or value <= 0: continue
        entry = {'pid': pid, 'name': names[pid], 'contractRowsTotal': value, **b}
        if b['budget'] == 0 and b['execution'] == 0: zero_budget_spending.append(entry)
        if b['budget'] and value > b['budget'] * 10: large_ratio.append(entry)
    missing = []
    for row in rows('2-2'):
        if row['予算年度'] != str(year - 1): continue
        if amount(row['予算額(歳出予算項目ごと)']) is None:
            missing.append({'pid': row['予算事業ID'], 'item': row['項'], 'subItem': row['目'],
                            'nextYearRequestAmount': amount(row['翌年度要求額(歳出予算項目ごと)'])})
    return {
        'checkedAt': datetime.now(timezone.utc).isoformat(), 'sheetYear': year,
        'sourceUrl': f'https://rssystem.go.jp/download-csv/{year}', 'files': files,
        'scope': 'Seven main CSVs; row structure, before/after comparison, budget/spending checks. Does not verify every contract against the live API.',
        'caveat': 'Contract row totals may include indirect payments or multiple-year contracts. Flags are not proof of an error.',
        'missingBudgetAmounts': missing,
        'zeroBudgetAndExecutionWithSpending': sorted(zero_budget_spending, key=lambda r: -r['contractRowsTotal']),
        'spendingOverTenTimesBudget': sorted(large_ratio, key=lambda r: -r['contractRowsTotal']),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.year, args.before)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(result['files']), 'missingBudgetAmounts': len(result['missingBudgetAmounts']),
                      'zeroBudgetAndExecutionWithSpending': len(result['zeroBudgetAndExecutionWithSpending']),
                      'spendingOverTenTimesBudget': len(result['spendingOverTenTimesBudget'])}))
