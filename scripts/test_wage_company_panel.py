import unittest
import importlib.util
import csv
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('wage_panel', Path(__file__).with_name('extract-wage-company-panel.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
extract_table = module.extract_table


class EmployeeTableTest(unittest.TestCase):
    def test_yen_and_separate_temporary_workers(self):
        row = extract_table('平均年間給与（円）\n1, 645\n[ 313]\n41. 9\n17. 1\n8, 983, 532\n')
        self.assertEqual(row['employees_nonconsolidated'], 1645)
        self.assertEqual(row['temporary_employees_separately_reported'], 313)
        self.assertEqual(row['average_annual_salary_jpy'], 8983532)

    def test_thousand_yen_and_missing_temporary_not_zero(self):
        row = extract_table('平均年間給与(千円)\n2,166\n42.2\n15.5\n9,448\n')
        self.assertEqual(row['average_annual_salary_jpy'], 9448000)
        self.assertIsNone(row['temporary_employees_separately_reported'])

    def test_missing_salary_or_duplicate_table_fails(self):
        with self.assertRaises(ValueError):
            extract_table('平均年間給与(円)\n1000\n40.0\n10.0\n―\n')
        table = '平均年間給与(円)\n1000\n40.0\n10.0\n7000000\n'
        with self.assertRaises(ValueError):
            extract_table(table + table)

    def test_generated_panel_matches_independently_checked_pilot_and_keeps_unknowns(self):
        root = Path(__file__).resolve().parents[1]
        panel = json.loads((root / 'app/lib/tax-expenditures/company-panel.json').read_text(encoding='utf-8'))['rows']
        indexed = {(r['company'], r['fiscal_end']): r for r in panel}
        self.assertEqual(len(indexed), 39)
        with (root / 'docs/ai-review/wage-company-pilot.csv').open(encoding='utf-8', newline='') as file:
            for expected in csv.DictReader(file):
                actual = indexed[(expected['company'], expected['fiscal_end'])]
                for field in ['employees_nonconsolidated', 'average_annual_salary_jpy', 'pdf_page']:
                    self.assertEqual(actual[field], int(expected[field]))
        for row in panel:
            self.assertIsNone(row['tax_legal_employee_count'])
            self.assertIsNone(row['wage_tax_credit_jpy'])
        self.assertTrue(indexed[('ダイダン', '2025-03-31')]['employee_definition_changed'])
        self.assertEqual((root / 'docs/ai-review/wage-company-panel.csv').read_bytes(),
                         (root / 'public/tax-expenditures/company-panel.csv').read_bytes())


if __name__ == '__main__':
    unittest.main()
