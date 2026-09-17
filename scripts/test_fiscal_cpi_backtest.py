import math
import unittest

from fiscal_cpi_backtest import fit, forecast, load_data, run


class CpiBacktestTests(unittest.TestCase):
    def test_source_units_and_horizon_counts(self):
        rows = load_data()
        self.assertEqual((rows[0]['year'], rows[-1]['year']), (1994, 2025))
        self.assertEqual(next(r['cpi'] for r in rows if r['year'] == 2024), 2.7)
        result = run(rows, 2, .25, .05)
        self.assertEqual([r['count'] for r in result['summaries'] if r['method'] == 'last-cpi'], [22, 20, 18])
        self.assertEqual(result['fits'][0]['origin'], 2003)

    def test_future_observations_cannot_change_predictions(self):
        rows = load_data()
        original = run(rows, 2, .25, .05)
        changed = run([dict(r, cpi=90, gap=50) if r['year'] > 2010 else r for r in rows], 2, .25, .05)
        before = [r for r in original['cases'] if r['origin'] <= 2010]
        after = [r for r in changed['cases'] if r['origin'] <= 2010]
        self.assertEqual([(r['predicted'], r['predictedGap']) for r in before], [(r['predicted'], r['predictedGap']) for r in after])
        self.assertEqual([r for r in original['fits'] if r['origin'] <= 2010], [r for r in changed['fits'] if r['origin'] <= 2010])

    def test_fit_recovers_known_equation_and_respects_bounds(self):
        rows = [dict(year=1990, cpi=.4, gap=0)]
        for i in range(1, 25):
            gap = math.sin(i)
            rows.append(dict(year=1990 + i, gap=gap, cpi=.1 + .5 * rows[-1]['cpi'] + .2 * gap))
        params = fit(rows, 2, True)
        for key, value in [('intercept', .1), ('rho', .5), ('beta', .2)]:
            self.assertAlmostEqual(params[key], value)
        _, coefficients = forecast(load_data()[:10], 5)
        self.assertTrue(0 <= coefficients['phi'] <= 1)
        for key in ['anchored', 'freeIntercept']:
            self.assertTrue(0 <= coefficients[key]['rho'] <= .99)
            self.assertGreaterEqual(coefficients[key]['beta'], 0)

    def test_cumulative_and_linear_closure(self):
        train = load_data()[:10]
        paths, _ = forecast(train, 5)
        for path in paths.values():
            expected = (math.prod(1 + r['cpi'] / 100 for r in path) - 1) * 100
            self.assertAlmostEqual(path[-1]['cumulativePercent'], expected)
        self.assertEqual(paths['closure-3'][2]['gap'], 0)
        self.assertEqual(paths['closure-5'][4]['gap'], 0)
        self.assertEqual(paths['current-held-gap'][-1]['gap'], train[-1]['gap'])
        self.assertEqual(paths['last-cpi'][-1]['cpi'], train[-1]['cpi'])
        with self.assertRaises(ValueError):
            forecast([train[0], train[2], train[3]], 5)


if __name__ == '__main__':
    unittest.main()
