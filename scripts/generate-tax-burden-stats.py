"""Convert the downloaded household survey table and OECD Taxing Wages extracts into public/data JSON.

Inputs (data/raw/tax-burden/, fetched by scripts/fetch-tax-burden-sources.mjs):
  kakei-2024-table3-quintile-decile.xlsx       家計調査 2024年 第3表（総世帯・勤労者世帯、年間収入五分位・十分位）
  kakei-2024-table3-2-age.xlsx                 家計調査 2024年 第3-2表（二人以上の世帯・勤労者世帯・無職世帯、世帯主の年齢階級別）
  oecd-taxing-wages-jpn-2024-2025.csv          OECD Taxing Wages country table, Japan, all measures
  oecd-taxing-wages-npatr-all-2023-2025.csv    OECD Taxing Wages, net personal average tax rate, all countries (stylised points)
  oecd-taxing-wages-decomp-jpn-2024-2025.csv   OECD Taxing Wages decompositions, Japan, 50-250% AW in 1% steps, all measures
  oecd-taxing-wages-decomp-npatr-all-2024-2025.csv  same flow, NPATR for all countries and the OECD_REP aggregate
  oecd-revenue-jpn.csv                         OECD Revenue Statistics, Japan (corporate income tax, national + local)
  oecd-sna-jpn-income.csv                      OECD national accounts, Japan (wages and salaries, compensation of employees)
Outputs:
  public/data/tax-burden-consumption-2024.json(.gz)   十分位別の税込消費支出（課税区分別）・直接税・社会保険料
  public/data/tax-burden-age-2024.json(.gz)           世帯主年齢階級別（勤労者世帯・無職世帯）の同項目。年間収入は非公表のため実収入を分母にする
  public/data/tax-burden-oecd-2025.json(.gz)          OECD 定点比較と日本の参照値（R8）
  public/data/tax-burden-incidence.json(.gz)          法人所得課税と賃金総額（転嫁の仮定を率に直すための分母）
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


def resolve_leaves(rows):
    """Bind map leaves to a sheet: use published sub-items when available, skip optional leaves that the table lacks."""
    leaves = []
    for leaf in MAP['leaves']:
        subs = leaf.get('subLeaves')
        if subs:
            try:
                leaves.extend((sub, find_row(rows, sub['label'], sub['level'], sub['parent'])) for sub in subs)
                continue
            except KeyError:
                pass
        try:
            leaves.append((leaf, find_row(rows, leaf['label'], leaf['level'], leaf['parent'])))
        except KeyError:
            if not leaf.get('optional'):
                raise
    return leaves


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
    leaves = resolve_leaves(rows)
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


def classify_spending(rows, leaves, col):
    """Sum tax-inclusive monthly spending by VAT class for one column, checking the leaves cover 消費支出."""
    classes = {'standard': 0.0, 'reduced': 0.0, 'exempt': 0.0}
    leaf_total = 0.0
    for leaf, vals in leaves:
        monthly = float(vals[col] or 0)
        leaf_total += monthly
        for cls, share in leaf['shares'].items():
            classes[cls] += monthly * share
    monthly_consumption = float(value_row(rows, '消費支出', 3)[col])
    if abs(leaf_total - monthly_consumption) > max(50.0, monthly_consumption * 0.002):
        raise SystemExit(f'column {col}: leaves {leaf_total:.0f} != 消費支出 {monthly_consumption:.0f}')
    return classes, monthly_consumption


AGE_SHEETS = [
    ('勤労', '二人以上の世帯のうち勤労者世帯', ['～34歳', '35～39歳', '40～44歳', '45～49歳', '50～54歳', '55～59歳', '60～64歳', '65～69歳', '70歳～']),
    ('無職', '二人以上の世帯のうち無職世帯', ['～59歳', '60～64歳', '65～69歳', '70～74歳', '75～79歳', '80～84歳', '85歳～']),
]


def build_age(retrieved: str) -> dict:
    wb = openpyxl.load_workbook(RAW / 'kakei-2024-table3-2-age.xlsx', data_only=True)
    groups = []
    for sheet, population, labels in AGE_SHEETS:
        header, rows = read_sheet(wb[sheet])
        leaves = resolve_leaves(rows)
        classes_out = []
        for i, label in enumerate(labels):
            col = 1 + i  # values[0] = 平均, then the published age classes in order
            assert header[13 + col].strip() == label, f'{sheet}: expected {label} at column {13 + col}, got {header[13 + col]}'
            classes, monthly_consumption = classify_spending(rows, leaves, col)
            annual = lambda lbl, level=None: round(float(value_row(rows, lbl, level)[col]) * 12)
            classes_out.append({
                'label': label,
                'headAge': float(value_row(rows, '世帯主の年齢', 1)[col]),
                'householdSize': float(value_row(rows, '世帯人員', 1)[col]),
                'earners': float(value_row(rows, '有業人員', 1)[col]),
                'realIncomeAnnual': annual('実収入', 2),
                'salaryAnnual': annual('勤め先収入', 4),
                'pensionBenefitAnnual': annual('公的年金給付', 6),
                'disposableAnnual': annual('可処分所得', 1),
                'consumptionAnnual': round(monthly_consumption * 12),
                'standardGross': round(classes['standard'] * 12),
                'reducedGross': round(classes['reduced'] * 12),
                'exemptGross': round(classes['exempt'] * 12),
                'directTaxes': {'incomeTax': annual('勤労所得税', 5), 'residentTax': annual('個人住民税', 5), 'other': annual('他の税', 5)},
                'socialInsurance': {'pension': annual('公的年金保険料', 5), 'health': annual('健康保険料', 5), 'care': annual('介護保険料', 5), 'other': annual('他の社会保険料', 5)},
            })
        groups.append({'population': population, 'classes': classes_out})
    return {
        'metadata': {
            'survey': '家計調査 家計収支編 2024年 第3-2表 世帯主の年齢階級別',
            'statInfId': '000040247076',
            'sourceUrl': 'https://www.e-stat.go.jp/stat-search/files?stat_infid=000040247076',
            'unit': '年額・円（公表月額×12）。支出は税込。年間収入は年齢階級別には非公表のため、負担率の分母は実収入（勤め先収入・公的年金給付等の月額×12）',
            'retrievedOn': retrieved,
            'mapVersion': MAP['version'],
            'notes': MAP['notes'] + [
                '無職世帯は世帯主が無職の世帯（年金受給者を多く含む）。直接税・社会保険料は年金からの徴収分を含む。',
                '二人以上の世帯のみ。単身世帯は対象外。',
            ],
        },
        'groups': groups,
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
    curves = build_oecd_curves()
    return {
        'curves': curves,
        'vat': OECD_VAT,
        'metadata': {
            'source': 'OECD Taxing Wages – country tables (DSD_TAX_WAGES_COU@DF_TW_COU 2.1) と tax wedge decompositions (DF_TW_DECOMP 2.1)。NPATR = 所得税＋本人社会保険料−現金給付 ÷ 総給与',
            'sourceUrl': 'https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_WAGES_COU@DF_TW_COU,2.1/',
            'retrievedOn': retrieved,
            'notes': [
                '定点（years.points）のOECD平均は加盟38か国の単純平均。連続カーブ（curves）のOECD平均は OECD 公表の集計系列 OECD_REP（各カーブの averageSource に記載。無い場合は加盟国の単純平均）。',
                '連続カーブは平均賃金比50〜250%（1%刻み）、4類型（単身・子なし、単身・子2人、片働き夫婦・子なし、片働き夫婦・子2人）。共働きの連続系列は公開されていない。',
                '日本の平均賃金（AW）はOECD推計の給与所得者平均で、本試作の最低賃金・標準報酬とは別系列。',
                'japanDetail は R8（受入照合用）。GEBT=総給与, CGITFP=国の所得税, SLT=地方税, EECSSC=本人社会保険料, CTGG=現金給付, THP=手取り。',
            ],
        },
        'years': out_years,
    }


def build_oecd_incidence() -> dict:
    """Corporate income tax over wages and salaries for every OECD member, so the incidence assumption can be
    applied to the OECD comparison lines as well. XDC values in the comparative revenue table are billions
    regardless of UNIT_MULT (checked against Japan, Germany and the United States), the national accounts carry
    their own multiplier."""
    rev = [r for r in csv.DictReader(open(RAW / 'oecd-revenue-comparative.csv', encoding='utf-8'))
           if r['OBS_VALUE'] and r['STANDARD_REVENUE'] == 'T_1200' and r['CTRY_SPECIFIC_REVENUE'] == '_T'
           and r['SECTOR'] == 'S13' and r['UNIT_MEASURE'] == 'XDC']
    sna = [r for r in csv.DictReader(open(RAW / 'oecd-sna-income-all.csv', encoding='utf-8'))
           if r['OBS_VALUE'] and r['SECTOR'] == 'S1' and r['ACTIVITY'] == '_T' and r['TRANSACTION'] == 'D11']
    for year in sorted({r['TIME_PERIOD'] for r in rev}, reverse=True):
        wages = {r['REF_AREA']: float(r['OBS_VALUE']) * 10 ** int(r['UNIT_MULT']) for r in sna if r['TIME_PERIOD'] == year}
        corporate = {r['REF_AREA']: float(r['OBS_VALUE']) * 1e9 for r in rev if r['TIME_PERIOD'] == year}
        ratios = {c: corporate[c] / wages[c] for c in sorted(set(wages) & set(corporate) & set(OECD_MEMBERS)) if wages[c] > 0}
        if len(ratios) >= 30:
            lo = min(ratios, key=ratios.get)
            hi = max(ratios, key=ratios.get)
            return {'year': year, 'countries': len(ratios),
                    'averageRatio': round(statistics.fmean(ratios.values()), 5),
                    'medianRatio': round(statistics.median(ratios.values()), 5),
                    'japanRatio': round(ratios['JPN'], 5),
                    'minRatio': round(ratios[lo], 5), 'minCountry': lo,
                    'maxRatio': round(ratios[hi], 5), 'maxCountry': hi}
    raise SystemExit('no year has corporate tax and wages for at least 30 OECD members')


def build_incidence(retrieved: str) -> dict:
    """Totals needed to turn a corporate-tax incidence assumption into a rate on wages. No incidence share is chosen here."""
    rev = [r for r in csv.DictReader(open(RAW / 'oecd-revenue-jpn.csv', encoding='utf-8'))
           if r['STANDARD_REVENUE'] == 'T_1200' and r['CTRY_SPECIFIC_REVENUE'] == '_T' and r['SECTOR'] == 'S13' and r['OBS_VALUE']]
    sna = [r for r in csv.DictReader(open(RAW / 'oecd-sna-jpn-income.csv', encoding='utf-8'))
           if r['UNIT_MEASURE'] == 'XDC' and r['ACTIVITY'] == '_T' and r['PRICE_BASE'] == 'V' and r['OBS_VALUE']]
    years = sorted({r['TIME_PERIOD'] for r in rev} & {r['TIME_PERIOD'] for r in sna})
    if not years:
        raise SystemExit('no year has both corporate tax revenue and national accounts')
    year = years[-1]
    amount = lambda rows, pick: next(round(float(r['OBS_VALUE']) * 10 ** int(r['UNIT_MULT']))
                                     for r in rows if r['TIME_PERIOD'] == year and pick(r))
    return {
        'metadata': {
            'year': year,
            'sources': [
                'OECD Revenue Statistics（DSD_REV_OECD@DF_REVJPN 2.0）区分1200＝法人の所得・利潤・キャピタルゲイン課税。国税と地方税（法人住民税・法人事業税）の合計。',
                'OECD National Accounts（DSD_NAMAIN10@DF_TABLE1_INCOME 2.0）D11＝賃金・俸給、D1＝雇用者報酬。暦年・名目。',
            ],
            'retrievedOn': retrieved,
            'notes': [
                '法人税は法律上は企業が納めるが、その一部は賃金の抑制を通じて労働者が負担しているという実証研究がある（税の帰着）。',
                '労働への帰着シェアは確立した値が無く、公的機関の分配分析では米国CBO・JCTが25%、米国財務省が18%を置いている。学術研究には50%前後の推計も、ほぼ0とする推計もある。',
                '本画面はシェアを利用者が選ぶ仮定として扱い、既定は0%（表示しない）。賃金に比例して配分するため、給与のある年齢・世帯にのみ現れる。',
                'OECD比較の線にも同じ仮定を当てられるよう、加盟国の法人所得課税÷賃金・俸給を oecd に入れている（Revenue Statistics 比較表と国民経済計算。日本の年度とは年が違う場合がある）。',
                '日本を対象にした帰着研究に基づく値ではない。分母は日本全体の賃金・俸給で、世帯の給与に一律の率として当てている。',
            ],
        },
        'oecd': build_oecd_incidence(),
        'corporateTaxTotal': amount(rev, lambda r: True),
        'wagesAndSalaries': amount(sna, lambda r: r['TRANSACTION'] == 'D11'),
        'compensationOfEmployees': amount(sna, lambda r: r['TRANSACTION'] == 'D1'),
        'referenceShares': [
            {'label': '米国CBO・JCT', 'share': 0.25},
            {'label': '米国財務省', 'share': 0.18},
        ],
    }


# 付加価値税の標準税率（2024年1月1日時点）。SDMX には税率の系列が無く、OECD Consumption Tax Trends 2024 の
# 表2.A.1（各国の標準税率と加盟38か国の単純平均）から転記した固定値。軽減税率は国ごとに対象も税率も違うため、
# 日本の8/10と同じ比率（標準税率の0.8倍）を当てる仮定を置く。
OECD_VAT = {
    'asOf': '2024-01-01',
    'source': 'OECD (2024), Consumption Tax Trends 2024, Table 2.A.1 – VAT/GST rates in OECD member countries',
    'sourceUrl': 'https://www.oecd.org/en/publications/consumption-tax-trends-2024_dcd4dd36-en.html',
    'averageStandard': 0.193,
    'minStandard': 0.05,
    'minCountry': 'CAN',
    'maxStandard': 0.27,
    'maxCountry': 'HUN',
    'japanStandard': 0.10,
    'reducedFactor': 0.8,
    'notes': [
        'カナダの5%は連邦GSTのみで、州の売上税・HSTを含まない（OECDの表も連邦分で記載）。',
        '軽減税率・非課税の範囲は国ごとに大きく違う。ここでは日本の家計調査から取った支出構成をそのまま使い、税率だけを置き換えている。',
    ],
}


CURVE_TYPES = [('S_C0', 'single'), ('S_C2', 'single-children'), ('C_C0', 'one-earner'), ('C_C2', 'one-earner-children')]


def build_oecd_curves() -> dict:
    """Continuous 50-250% AW curves: Japan (OECD calculation), OECD aggregate, min/max across members, Japan detail (R8)."""
    rows = [r for r in csv.DictReader(open(RAW / 'oecd-taxing-wages-decomp-npatr-all-2024-2025.csv', encoding='utf-8')) if r['OBS_VALUE'] != '']
    jpn = [r for r in csv.DictReader(open(RAW / 'oecd-taxing-wages-decomp-jpn-2024-2025.csv', encoding='utf-8')) if r['OBS_VALUE'] != '']
    year = max(r['TIME_PERIOD'] for r in rows)
    rows = [r for r in rows if r['TIME_PERIOD'] == year]
    jpn = [r for r in jpn if r['TIME_PERIOD'] == year]
    aggregate = next((code for code in ('OECD_REP', 'OECD') if any(r['REF_AREA'] == code for r in rows)), None)
    aw = next(float(r['OBS_VALUE']) for r in jpn if r['MEASURE'] == 'GWE' and r['UNIT_MEASURE'] == 'XDC' and r['HOUSEHOLD_TYPE'] == 'S_C0' and r['INCOME_PRINCIPAL'] == 'AW100')
    out = {}
    for ht, household in CURVE_TYPES:
        by_ratio: dict[int, dict[str, float]] = {}
        for r in rows:
            if r['HOUSEHOLD_TYPE'] == ht and r['INCOME_PRINCIPAL'].startswith('AW'):
                by_ratio.setdefault(int(r['INCOME_PRINCIPAL'][2:]), {})[r['REF_AREA']] = float(r['OBS_VALUE'])
        ratios = sorted(k for k in by_ratio if 50 <= k <= 250)
        detail = {m: [] for m in ('GWE', 'IT_CG', 'IT_LG', 'EESSC', 'CB')}
        jd = {(r['MEASURE'], r['INCOME_PRINCIPAL']): float(r['OBS_VALUE']) for r in jpn if r['HOUSEHOLD_TYPE'] == ht and r['UNIT_MEASURE'] == 'XDC'}
        series = {'awRatio': [], 'japan': [], 'oecdAverage': [], 'min': [], 'minCountry': [], 'max': [], 'maxCountry': [], 'countries': []}
        for k in ratios:
            members = {c: v for c, v in by_ratio[k].items() if c in OECD_MEMBERS}
            if len(members) < 30:
                continue
            lo = min(members, key=members.get); hi = max(members, key=members.get)
            series['awRatio'].append(k / 100)
            series['japan'].append(members.get('JPN'))
            avg = by_ratio[k].get(aggregate) if aggregate else None
            series['oecdAverage'].append(round(avg if avg is not None else statistics.fmean(members.values()), 3))
            series['min'].append(members[lo]); series['minCountry'].append(lo)
            series['max'].append(members[hi]); series['maxCountry'].append(hi)
            series['countries'].append(len(members))
            for m in detail:
                v = jd.get((m, f'AW{k}'))
                detail[m].append(None if v is None else abs(v))  # taxes and SSC are published as negatives in this flow
        out[household] = {'oecdHouseholdType': ht, 'year': year, 'averageWageJpy': aw,
                          'averageSource': f'OECD aggregate series {aggregate}' if aggregate else 'simple mean of member countries',
                          **series, 'japanDetail': detail}
    return out


def main() -> None:
    retrieved = date.today().isoformat()
    for f in ('kakei-2024-table3-quintile-decile.xlsx', 'kakei-2024-table3-2-age.xlsx', 'oecd-taxing-wages-jpn-2024-2025.csv', 'oecd-taxing-wages-npatr-all-2023-2025.csv',
              'oecd-taxing-wages-decomp-jpn-2024-2025.csv', 'oecd-taxing-wages-decomp-npatr-all-2024-2025.csv',
              'oecd-revenue-jpn.csv', 'oecd-sna-jpn-income.csv'):
        if not (RAW / f).exists():
            sys.exit(f'missing {RAW / f}; run `node scripts/fetch-tax-burden-sources.mjs` first')
    consumption = build_consumption(retrieved)
    write_json(OUT / 'tax-burden-consumption-2024.json', consumption)
    age = build_age(retrieved)
    write_json(OUT / 'tax-burden-age-2024.json', age)
    incidence = build_incidence(retrieved)
    write_json(OUT / 'tax-burden-incidence.json', incidence)
    print(f"incidence {incidence['metadata']['year']}: 法人所得課税 {incidence['corporateTaxTotal'] / 1e12:.1f}兆円 / 賃金・俸給 {incidence['wagesAndSalaries'] / 1e12:.1f}兆円 "
          f"→ 25%帰着なら賃金の {incidence['corporateTaxTotal'] * 0.25 / incidence['wagesAndSalaries'] * 100:.2f}%")
    oecd = build_oecd(retrieved)
    write_json(OUT / 'tax-burden-oecd-2025.json', oecd)
    print(f"age: { {g['population']: len(g['classes']) for g in age['groups']} }")
    print(f"consumption: {len(consumption['deciles'])} deciles; oecd years: {list(oecd['years'])}, points: {[len(v['points']) for v in oecd['years'].values()]}; "
          f"curves: { {k: len(v['awRatio']) for k, v in oecd['curves'].items()} } ({next(iter(oecd['curves'].values()))['averageSource']})")


if __name__ == '__main__':
    main()
