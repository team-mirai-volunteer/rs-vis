"""Convert the downloaded household survey table and OECD Taxing Wages extracts into public/data JSON.

Inputs (data/raw/tax-burden/, fetched by scripts/fetch-tax-burden-sources.mjs):
  kakei-2024-table3-quintile-decile.xlsx       家計調査 2024年 第3表（総世帯・勤労者世帯、年間収入五分位・十分位）
  oecd-taxing-wages-jpn-2024-2025.csv          OECD Taxing Wages country table, Japan, all measures
  oecd-taxing-wages-npatr-all-2023-2025.csv    OECD Taxing Wages, net personal average tax rate, all countries
Outputs:
  public/data/tax-burden-consumption-2024.json(.gz)   十分位別の税込消費支出（課税区分別）・直接税・社会保険料
  public/data/tax-burden-oecd-2025.json(.gz)          OECD 定点比較と日本の参照値（R8）
CSV/Excel processing only; no UI or API logic here.
"""
from __future__ import annotations

import csv
import gzip
import json
import re
import statistics
import sys
from datetime import date
from pathlib import Path

import openpyxl

RAW = Path('data/raw/tax-burden')
OUT = Path('public/data')
MAP = json.loads(Path('scripts/data/tax-burden-consumption-map.json').read_text(encoding='utf-8'))

OECD_MEMBERS = ['AUS', 'AUT', 'BEL', 'CAN', 'CHL', 'COL', 'CRI', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'IRL', 'ISR',
                'ITA', 'JPN', 'KOR', 'LVA', 'LTU', 'LUX', 'MEX', 'NLD', 'NZL', 'NOR', 'POL', 'PRT', 'SVK', 'SVN', 'ESP', 'SWE', 'CHE', 'TUR', 'GBR', 'USA']


def write_json(path: Path, data: dict) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    path.write_text(text, encoding='utf-8')
    with gzip.open(str(path) + '.gz', 'wb', compresslevel=9) as f:
        f.write(text.encode('utf-8'))


def read_sheet(ws):
    """Return list of rows (level, label, values[16]) and the header cells for class bounds."""
    header = [str(c.value) if c.value is not None else '' for c in ws[9]]
    rows = []
    for r in range(10, ws.max_row + 1):
        cells = [c.value for c in ws[r]]
        if cells[11] is None:
            continue
        level = int(str(cells[9]).strip()) if cells[9] is not None and str(cells[9]).strip().isdigit() else None
        rows.append((level, str(cells[11]).strip(), cells[12], cells[13:29]))
    return header, rows


def find_row(rows, label, level, parent):
    """Locate a leaf by label/level whose nearest ancestor at level-1 (or the named parent) matches."""
    for i, (lv, lb, _unit, vals) in enumerate(rows):
        if lb != label or lv != level:
            continue
        j = i - 1
        while j >= 0 and (rows[j][0] is None or rows[j][0] >= level):
            j -= 1
        if j >= 0 and rows[j][1] == parent:
            return vals
    raise KeyError(f'{parent} > {label} (level {level}) not found')


def value_row(rows, label, level=None):
    for lv, lb, _unit, vals in rows:
        if lb == label and (level is None or lv == level):
            return vals
    raise KeyError(label)


def parse_bounds(header):
    """Decile columns are indexes 19..28; header text like '年間収入十分位階級2(\\2,730,000～\\3,670,000)'."""
    bounds = []
    for idx in range(19, 29):
        nums = [int(n.replace(',', '')) for n in re.findall(r'([\d,]{5,})', header[idx])]
        text = header[idx]
        lower = None if text.split('(')[1].startswith('～') else nums[0]
        upper = nums[-1] if text.rstrip(')').endswith(tuple('0123456789')) and (lower is None or len(nums) > 1) else None
        bounds.append({'lower': lower, 'upper': upper})
    return bounds


def build_consumption(retrieved: str) -> dict:
    wb = openpyxl.load_workbook(RAW / 'kakei-2024-table3-quintile-decile.xlsx', data_only=True)
    ws = wb['勤労']
    header, rows = read_sheet(ws)
    bounds = parse_bounds(header)
    consumption = value_row(rows, '消費支出', 3)
    leaves = []
    for leaf in MAP['leaves']:
        vals = find_row(rows, leaf['label'], leaf['level'], leaf['parent'])
        leaves.append((leaf, vals))
    deciles = []
    for d in range(10):
        col = 6 + d  # values[0]=平均, 1..5 五分位, 6..15 十分位
        classes = {'standard': 0.0, 'reduced': 0.0, 'exempt': 0.0}
        leaf_total = 0.0
        for leaf, vals in leaves:
            monthly = float(vals[col] or 0)
            leaf_total += monthly
            for cls, share in leaf['shares'].items():
                classes[cls] += monthly * share
        monthly_consumption = float(consumption[col])
        if abs(leaf_total - monthly_consumption) > max(50.0, monthly_consumption * 0.002):
            raise SystemExit(f'decile {d + 1}: leaves {leaf_total:.0f} != 消費支出 {monthly_consumption:.0f}')
        annual = lambda label, level=None: round(float(value_row(rows, label, level)[col]) * 12)
        deciles.append({
            'decile': d + 1,
            'lowerBound': bounds[d]['lower'],
            'upperBound': bounds[d]['upper'],
            'annualIncome': int(value_row(rows, '年間収入', 1)[col]) * 10000,
            'householdSize': float(value_row(rows, '世帯人員', 1)[col]),
            'earners': float(value_row(rows, '有業人員', 1)[col]),
            'headAge': float(value_row(rows, '世帯主の年齢', 1)[col]),
            'realIncomeAnnual': annual('実収入', 2),
            'disposableAnnual': annual('可処分所得', 1),
            'consumptionAnnual': round(monthly_consumption * 12),
            'standardGross': round(classes['standard'] * 12),
            'reducedGross': round(classes['reduced'] * 12),
            'exemptGross': round(classes['exempt'] * 12),
            'directTaxes': {'incomeTax': annual('勤労所得税', 5), 'residentTax': annual('個人住民税', 5), 'other': annual('他の税', 5)},
            'socialInsurance': {'pension': annual('公的年金保険料', 5), 'health': annual('健康保険料', 5), 'care': annual('介護保険料', 5), 'other': annual('他の社会保険料', 5)},
            'propensity': float(value_row(rows, '平均消費性向', 1)[col]) / 100,
        })
    return {
        'metadata': {
            'survey': '家計調査 家計収支編 2024年 第3表 年間収入五分位・十分位階級別',
            'statInfId': '000040246659',
            'sourceUrl': 'https://www.e-stat.go.jp/stat-search/files?stat_infid=000040246659',
            'population': '二人以上の世帯のうち勤労者世帯',
            'unit': '年額・円（公表月額×12）。支出は税込',
            'retrievedOn': retrieved,
            'mapVersion': MAP['version'],
            'notes': MAP['notes'] + [
                '単身世帯は本表の対象外。単身類型にも二人以上勤労者世帯の支出構成比を当てているため参考値。',
                '年収階級は世帯の年間収入（税込・世帯員合計）。年間収入は階級平均（万円）を円換算。',
            ],
        },
        'deciles': deciles,
    }


def build_oecd(retrieved: str) -> dict:
    rows = list(csv.DictReader(open(RAW / 'oecd-taxing-wages-npatr-all-2023-2025.csv', encoding='utf-8')))
    jpn = list(csv.DictReader(open(RAW / 'oecd-taxing-wages-jpn-2024-2025.csv', encoding='utf-8')))
    years = sorted({r['TIME_PERIOD'] for r in rows})
    # Stylised household points: (household type, principal, spouse) -> our household id and total AW ratio.
    points = [
        ('S_C0', 'AW67', '_Z', 'single', 0.67, None),
        ('S_C0', 'AW100', '_Z', 'single', 1.0, None),
        ('S_C0', 'AW167', '_Z', 'single', 1.67, None),
        ('S_C2', 'AW67', '_Z', 'single-children', 0.67, None),
        ('C_C2', 'AW100', 'NOEARN_UNEMP', 'one-earner-children', 1.0, None),
        ('C_C2', 'AW100', 'AW67', 'two-earners-children', 1.67, 60),
        ('C_C2', 'AW100', 'AW100', 'two-earners-children', 2.0, 50),
        ('C_C0', 'AW100', 'AW67', 'two-earners', 1.67, 60),
    ]
    out_years = {}
    for year in years:
        yrows = [r for r in rows if r['TIME_PERIOD'] == year]
        aw = None
        for r in jpn:
            if r['TIME_PERIOD'] == year and r['MEASURE'] == 'GEBT' and r['HOUSEHOLD_TYPE'] == 'S_C0' and r['INCOME_PRINCIPAL'] == 'AW100':
                aw = float(r['OBS_VALUE'])
        entries = []
        for ht, princ, spouse, household, ratio, share in points:
            vals = {r['REF_AREA']: float(r['OBS_VALUE']) for r in yrows
                    if r['HOUSEHOLD_TYPE'] == ht and r['INCOME_PRINCIPAL'] == princ and r['INCOME_SPOUSE'] == spouse and r['OBS_VALUE'] != ''}
            members = {k: v for k, v in vals.items() if k in OECD_MEMBERS}
            if len(members) < 30:
                continue
            lo = min(members, key=members.get)
            hi = max(members, key=members.get)
            detail = {}
            for r in jpn:
                if r['TIME_PERIOD'] == year and r['HOUSEHOLD_TYPE'] == ht and r['INCOME_PRINCIPAL'] == princ and r['INCOME_SPOUSE'] == spouse \
                        and r['MEASURE'] in ('GEBT', 'CGITFP', 'SLT', 'EECSSC', 'CTGG', 'NPATR', 'THP') and r['OBS_VALUE'] != '':
                    detail[r['MEASURE']] = float(r['OBS_VALUE'])
            entries.append({
                'household': household, 'oecdHouseholdType': ht, 'principal': princ, 'spouse': spouse,
                'awRatioTotal': ratio, 'suggestedShare': share,
                'japan': members.get('JPN'), 'oecdAverage': round(statistics.fmean(members.values()), 3),
                'min': members[lo], 'minCountry': lo, 'max': members[hi], 'maxCountry': hi, 'countries': len(members),
                'japanDetail': detail,
            })
        out_years[year] = {'averageWageJpy': aw, 'points': entries}
    return {
        'metadata': {
            'source': 'OECD Taxing Wages – country tables (DSD_TAX_WAGES_COU@DF_TW_COU 2.1), measure NPATR = 所得税＋本人社会保険料−現金給付 ÷ 総給与',
            'sourceUrl': 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COU@DF_TW_COU,2.1/',
            'retrievedOn': retrieved,
            'notes': [
                'OECD平均は加盟38か国の単純平均（OECDが公表する加重・単純平均とは一致しない場合がある）。',
                '定点（平均賃金比67・100・167%、共働きは100+67・100+100）のみ。連続カーブは公開フローに無い。',
                '日本の平均賃金（AW）はOECD推計の給与所得者平均で、本試作の最低賃金・標準報酬とは別系列。',
                'japanDetail は R8（受入照合用）。GEBT=総給与, CGITFP=国の所得税, SLT=地方税, EECSSC=本人社会保険料, CTGG=現金給付, THP=手取り。',
            ],
        },
        'years': out_years,
    }


def main() -> None:
    retrieved = date.today().isoformat()
    for f in ('kakei-2024-table3-quintile-decile.xlsx', 'oecd-taxing-wages-jpn-2024-2025.csv', 'oecd-taxing-wages-npatr-all-2023-2025.csv'):
        if not (RAW / f).exists():
            sys.exit(f'missing {RAW / f}; run `node scripts/fetch-tax-burden-sources.mjs` first')
    consumption = build_consumption(retrieved)
    write_json(OUT / 'tax-burden-consumption-2024.json', consumption)
    oecd = build_oecd(retrieved)
    write_json(OUT / 'tax-burden-oecd-2025.json', oecd)
    print(f"consumption: {len(consumption['deciles'])} deciles; oecd years: {list(oecd['years'])}, points: {[len(v['points']) for v in oecd['years'].values()]}")


if __name__ == '__main__':
    main()
