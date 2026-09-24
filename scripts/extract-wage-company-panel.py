"""Extract the reviewed employee-table layout from the public-report pilot.

Requires PyMuPDF. Fetch PDFs with fetch-wage-company-pilot.mjs first.
Stops on missing/ambiguous tables; never imputes legal eligibility or tax credits.
"""
import csv
import io
import json
import re
import unicodedata
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/tax-expenditures/company-pilot'
DOCS = ROOT / 'docs/ai-review'
NAMES = {
    'daihen': 'ダイヘン', 'hochiki': 'ホーチキ', 'nito': '日東工業',
    'ts': 'テイ・エス テック', 'press': 'プレス工業', 'nichicon': 'ニチコン',
    'aichi': '愛知製鋼', 'seiki': '日本精機', 'iko': '日本トムソン', 'topy': 'トピー工業',
    'daidan': 'ダイダン', 'takasago': '高砂熱学工業', 'tktk': '東光高岳',
}


def extract_table(text):
    # Remove horizontal spaces introduced inside Japanese PDF numerals, but keep
    # row breaks: flattening all whitespace would join employee/age/salary values.
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'[^\S\n]+', '', text)
    pattern = (r'平均年間給与\((千円|円)\)\n+'
               r'([\d,]+)(?:\n*[\[(]([\d,]+)[\])])?\n+'
               r'(\d+\.\d+)\n+(\d+\.\d+)\n+([\d,]+)(?=\n)')
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError(f'Expected one employee table, found {len(matches)}')
    unit, employees, temporary, age, tenure, salary = matches[0].groups()
    return {
        'employees_nonconsolidated': int(employees.replace(',', '')),
        'temporary_employees_separately_reported': int(temporary.replace(',', '')) if temporary else None,
        'average_annual_salary_jpy': int(salary.replace(',', '')) * (1000 if unit == '千円' else 1),
        'average_age': float(age), 'average_tenure_years': float(tenure),
        'source_salary_unit': unit,
    }


def main():
    sources = json.loads((DOCS / 'wage-company-sources.json').read_text(encoding='utf-8'))
    rows = []
    for source in sources:
        if source.get('correction'):
            continue  # Corrections separately reviewed; none alter employee tables.
        with fitz.open(RAW / source['file']) as pdf:
            pages = [unicodedata.normalize('NFKC', page.get_text()) for page in pdf]
        candidates = [(i, text) for i, text in enumerate(pages)
                      if '平均年間給与' in re.sub(r'\s+', '', text)]
        if len(candidates) != 1:
            raise ValueError(f"{source['file']}: ambiguous employee page")
        i, text = candidates[0]
        if '提出会社の状況' not in re.sub(r'\s+', '', text):
            raise ValueError(f"{source['file']}: nonconsolidated context missing")
        try:
            values = extract_table(text)
        except ValueError as error:
            raise ValueError(f"{source['file']}: {error}") from error
        if not (0 < values['employees_nonconsolidated'] < 1000000
                and 1000000 <= values['average_annual_salary_jpy'] <= 100000000):
            raise ValueError(f"{source['file']}: implausible unit/value")
        year = source['year']
        # This collection is restricted to March-year-end issuers; verify dates
        # in the cover rather than assigning a generic calendar-year treatment.
        cover = re.sub(r'\s+', '', ''.join(pages[:5]))
        if not (f'{year-1}年4月1日' in cover and f'{year}年3月31日' in cover):
            raise ValueError(f"{source['file']}: fiscal dates need review")
        rows.append({
            'company': NAMES[source['company_key']], 'company_key': source['company_key'],
            'fiscal_start': f'{year-1}-04-01', 'fiscal_end': f'{year}-03-31',
            **values, 'pdf_page': i + 1, 'source_url': source['url'],
            'employee_definition_changed': source['company_key'] == 'daidan' and year == 2025,
            'tax_legal_employee_count': None, 'wage_tax_credit_jpy': None,
        })
    rows.sort(key=lambda row: (row['company_key'], row['fiscal_end']))
    keys = {(r['company_key'], r['fiscal_end']) for r in rows}
    if len(keys) != len(rows):
        raise ValueError('Duplicate company/year')
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    (DOCS / 'wage-company-panel.csv').write_text(stream.getvalue(), encoding='utf-8', newline='\n')
    public = ROOT / 'public/tax-expenditures'
    public.mkdir(parents=True, exist_ok=True)
    (public / 'company-panel.csv').write_text(stream.getvalue(), encoding='utf-8', newline='\n')
    output = ROOT / 'app/lib/tax-expenditures/company-panel.json'
    output.write_text(json.dumps({'checkedAt': '2026-09-24', 'rows': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'Extracted {len(rows)} observations for {len({r["company_key"] for r in rows})} companies')
    for row in rows:
        print(row['company'], row['fiscal_end'], row['employees_nonconsolidated'], row['average_annual_salary_jpy'])


if __name__ == '__main__':
    main()
