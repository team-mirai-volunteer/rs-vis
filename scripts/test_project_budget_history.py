import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('history', Path(__file__).with_name('generate-project-budget-history.py'))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


def row(year='2024', **values):
    return {'事業年度': '2025', '予算事業ID': '1', '予算年度': year,
            '当初予算（合計）': '100', '計（歳出予算現額合計）': '120', '執行額（合計）': '0', **values}


class BudgetHistoryTest(unittest.TestCase):
    def test_account_detail_is_not_double_counted(self):
        detail = row(**{'当初予算（合計）': '', '計（歳出予算現額合計）': '', '執行額（合計）': '', '歳出予算現額': '120'})
        points = history.build_projects([row(), detail])['1']
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]['totalBudget'], 120)

    def test_current_execution_is_unknown_but_past_zero_is_preserved(self):
        points = history.build_projects([row('2025'), row('2024')])['1']
        self.assertEqual([point['fiscalYear'] for point in points], [2024, 2025])
        self.assertEqual(points[0]['executedAmount'], 0)
        self.assertIsNone(points[1]['executedAmount'])

    def test_missing_is_distinct_from_zero(self):
        point = history.build_projects([row(**{'執行額（合計）': ''})])['1'][0]
        self.assertIsNone(point['executedAmount'])
        self.assertEqual(history.amount('1,234.0'), 1234)
        self.assertIsNone(history.amount('-'))
        with self.assertRaises(ValueError):
            history.amount('NaN')

    def test_duplicate_or_mixed_sheet_year_fails(self):
        with self.assertRaises(ValueError):
            history.build_projects([row(), row()])
        with self.assertRaises(ValueError):
            history.build_projects([row(**{'事業年度': '2024'})])


if __name__ == '__main__':
    unittest.main()
