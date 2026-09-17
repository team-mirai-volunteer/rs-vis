import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fixture from './fixtures/fiscal-backtest/jsna-2024-fiscal-years-full.json';
import revenueFixture from './fixtures/fiscal-backtest/jsna-2024-fiscal-years.json';
import { backtestMacro, componentElasticities, conditionalRates, historicalState, linearTrend, type MacroObservation } from '../scripts/lib/fiscal-macro-backtest';
import { initialEconomy, PARAMETERS } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';

const near = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert(Math.abs(actual - expected) <= tolerance, message ?? `${actual} is not within ${tolerance} of ${expected}`);

test('full fixture matches its recorded sources and stays consistent with the revenue-only fixture', () => {
  assert.equal(fixture.period, 'fiscal-year');
  assert.equal(fixture.rows.length, 31);
  assert.deepEqual(fixture.sources.map(s => s.file), ['2024s6_2_jp.xlsx', '2024ffm1n_jp.xlsx', '2024ss3_jp.xlsx', 'estat-cpi-2020-monthly-japan.csv']);
  for (const source of fixture.sources) {
    const hash = createHash('sha256').update(readFileSync(`tests/fixtures/fiscal-backtest/${source.file}`)).digest('hex');
    assert.equal(hash, source.sha256, source.file);
  }
  for (const row of fixture.rows) {
    const revenueRow = revenueFixture.rows.find(r => r.year === row.year)!;
    assert.equal(row.gdpTrillion, revenueRow.gdpTrillion);
    assert.equal(row.taxTrillion + row.finesTrillion + row.socialTrillion, revenueRow.taxTrillion + revenueRow.finesTrillion + revenueRow.socialTrillion);
    // PB identity: taxes + fines + social + other primary revenue − primary expenditure.
    near(row.taxTrillion + row.finesTrillion + row.socialTrillion + row.otherPrimaryRevenueTrillion - row.primaryExpenditureTrillion, row.primaryBalanceTrillion, 1e-3);
    // Net lending identity with gross interest on both sides.
    near(row.netLendingTrillion + row.interestPaidTrillion - row.interestReceivedTrillion, row.primaryBalanceTrillion, 1e-9);
    assert(row.grossDebtTrillion > 0 && row.cpiFiscalYear > 0);
  }
  const last = fixture.rows.at(-1)!;
  assert.equal(last.year, 2024);
  near(last.grossDebtTrillion, 1441.5693, 1e-3);
  near(last.cpiFiscalYear, 109.49, .01);
  near(fixture.rows.find(r => r.year === 2020)!.cpiCalendarYear, 100, .05);
});

test('historical state keeps the 2024 method: gap zero, reconciled ten-bucket portfolio, split revenue', () => {
  const row = fixture.rows.find(r => r.year === 2010)!;
  const state = historicalState(row, initialEconomy('2024'), fixture.rows.find(r => r.year === 2009));
  assert.equal(state.year, 2010);
  assert.equal(state.macro.nominalGdp, row.gdpTrillion * 1e12);
  assert.equal(state.macro.realGdp, state.macro.potentialGdp);
  assert.equal(state.macro.inflation, row.cpiInflation);
  near(state.macro.nominalGrowth, 509.2 / 500.8 - 1, .01);
  assert.equal(state.debtPortfolio.length, 10);
  near(state.debtPortfolio.reduce((s, b) => s + b.principal, 0), state.fiscal.grossDebt, 1e-3);
  near(state.debtPortfolio.reduce((s, b) => s + b.principal * b.coupon, 0), state.fiscal.interestPayments, 1e-3);
  assert.deepEqual(state.debtPortfolio.map(b => b.maturityYear), Array.from({ length: 10 }, (_, i) => 2011 + i));
  assert.equal(state.fiscal.taxes + state.fiscal.socialContributions, state.fiscal.taxRevenue);
  assert.equal(state.fiscal.socialContributions, row.socialTrillion * 1e12);
  near(state.fiscal.grossDebt / state.macro.nominalGdp, 2.072, .001);
  // The simulator accepts the state as-is.
  assert.equal(simulate(state, [], 1).steps.length, 1);
});

test('sanity: a stationary economy with matching market rate is reproduced exactly by the no-policy path', () => {
  const stationary = (year: number): MacroObservation => ({ year, gdpTrillion: 500, taxTrillion: 80, finesTrillion: 0, socialTrillion: 50,
    otherPrimaryRevenueTrillion: 20, interestReceivedTrillion: 5, primaryExpenditureTrillion: 145, interestPaidTrillion: 10, primaryBalanceTrillion: 5,
    grossDebtTrillion: 400, cpiFiscalYear: 100, cpiInflation: 0 });
  const rows = [2000, 2001, 2002, 2003].map(stationary);
  const parameters = { ...PARAMETERS, marketRate: 10 / 400 };
  const result = backtestMacro(rows, { horizons: [1, 3], parameters });
  // Unconditional mode grows at the default 1%/2% by design, so only conditional and naive paths are stationary.
  for (const c of result.cases.filter(x => x.method !== 'unconditional' && (x.method !== 'linear-trend' || x.origin > 2000))) {
    near(c.error, 0, c.series === 'debtRatio' ? 1e-4 : c.series === 'cpi' ? .05 : c.series === 'nominalGdp' ? .3 : .2, `${c.series} ${c.method} ${c.origin}->${c.target}: ${c.error}`);
  }
  assert(result.cases.filter(c => c.method === 'unchanged').every(c => c.error === 0));
  assert.deepEqual(conditionalRates(rows[0], rows[3], 3), { nominalGrowth: 0, inflation: 0, realGrowth: 0 });
});

test('naive benchmarks and validation behave as documented', () => {
  assert.equal(linearTrend([1, 2, 3, 4, 5], 2), 7);
  assert.equal(linearTrend([10, 12, 14, 16, 18, 20], 1, 5), 22);
  assert.equal(linearTrend([3], 1), null);
  assert.throws(() => backtestMacro([fixture.rows[0], fixture.rows[2]]), RangeError);
  assert.throws(() => backtestMacro(fixture.rows, { horizons: [0] }), RangeError);
  assert.throws(() => backtestMacro([{ ...fixture.rows[0], gdpTrillion: 0 }, fixture.rows[1]]), RangeError);
});

test('deterministic summary values on the frozen fixture (default parameters)', () => {
  const result = backtestMacro(fixture.rows);
  const count = (method: string) => result.summaries.filter(s => s.series === 'revenue' && s.method === method).map(s => [s.horizon, s.count]);
  assert.deepEqual(count('conditional'), [[1, 30], [3, 28], [5, 26]]);
  assert.deepEqual(count('linear-trend'), [[1, 29], [3, 27], [5, 25]]);
  assert.equal(result.runs.length, 30);
  assert.equal(result.runs.find(r => r.origin === 2022)!.horizon, 2);
  const s = (series: string, horizon: number, method: string) => result.summaries.find(x => x.series === series && x.horizon === horizon && x.method === method)!;
  // Conditional nominal GDP is matched at the end of the horizon up to the inflation-persistence transient.
  near(s('nominalGdp', 5, 'conditional').mae, 1.376, .01);
  assert(s('nominalGdp', 5, 'unconditional').mae > 50);
  near(s('cpi', 5, 'conditional').mae, .243, .01);
  // Interest is over-predicted by the default 2% refinancing rate in both modes.
  assert(s('interestPayments', 5, 'conditional').bias > 5 && s('interestPayments', 5, 'unchanged').mae < s('interestPayments', 5, 'conditional').mae);
  assert(s('debtRatio', 5, 'conditional').mae < s('debtRatio', 5, 'unchanged').mae);
  // No fitting: a change in a later observation never alters earlier-origin cases at shorter horizons.
  const altered = fixture.rows.map(r => r.year === 2024 ? { ...r, taxTrillion: r.taxTrillion + 50 } : r);
  assert.deepEqual(result.cases.filter(c => c.target <= 2018), backtestMacro(altered).cases.filter(c => c.target <= 2018));
});

test('component elasticities are reproducible and separate taxes from social contributions', () => {
  const estimates = componentElasticities(fixture.rows);
  assert.equal(estimates.length, 9);
  const e = (component: string, window: string) => estimates.find(x => x.component === component && x.window === window)!;
  near(e('taxes', '1995-2024').elasticity, 1.707, .005);
  near(e('taxes', '1995-2024').standardError, .259, .005);
  near(e('socialContributions', '1995-2024').elasticity, .817, .005);
  near(e('socialContributions', '2015-2024').elasticity, .865, .005);
  near(e('taxes', '2015-2024').elasticity, 1.026, .005);
  near(e('total', '1995-2024').elasticity, 1.352, .005);
  assert.equal(e('taxes', '1995-2024').count, 30);
  assert.equal(e('taxes', '2015-2024').count, 10);
  for (const x of estimates) assert(x.bootstrap.percentile5 < x.elasticity && x.elasticity < x.bootstrap.percentile95, x.window);
  assert(estimates.every(x => x.component !== 'socialContributions' || x.bootstrap.percentile95 < 1.2));
  assert.deepEqual(componentElasticities(fixture.rows), estimates);
  assert.throws(() => componentElasticities(fixture.rows, [[2023, 2024]]), RangeError);
});
