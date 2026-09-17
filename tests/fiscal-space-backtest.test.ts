import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestRevenue } from '../scripts/lib/fiscal-revenue-backtest';
import fixture from './fixtures/fiscal-backtest/imf-2026-table4.json';
import longSeries from './fixtures/fiscal-backtest/jsna-2024-fiscal-years.json';
import { initialEconomy, PARAMETERS } from '../app/lib/fiscal-space/assumptions';

test('historical revenue uses the same general-government scope as the 2024 simulation', () => {
  const row = fixture.rows.find(r => r.year === 2024)!;
  const initial = initialEconomy('2024');
  assert.equal(row.gdpTrillion * 1e12, initial.macro.nominalGdp);
  assert(Math.abs(row.gdpTrillion * (row.taxPercentGdp + row.socialPercentGdp) / 100 - initial.fiscal.taxRevenue / 1e12) < 1e-10);
  assert.equal(PARAMETERS.taxRevenueElasticity, 1.3);
});

test('multi-year checks never reset to intermediate observed revenue; metrics are grouped by horizon', () => {
  const rows = [
    { year: 2000, gdpTrillion: 100, taxPercentGdp: 10, socialPercentGdp: 0 },
    { year: 2001, gdpTrillion: 110, taxPercentGdp: 20, socialPercentGdp: 0 },
    { year: 2002, gdpTrillion: 121, taxPercentGdp: 10, socialPercentGdp: 0 },
  ];
  const result = backtestRevenue(rows, [1]);
  assert.equal(result.cases.find(r => r.origin === 2000 && r.target === 2002 && r.method === 'elasticity-1')!.predicted, 12.1);
  const group = result.summaries.find(r => r.horizon === 1 && r.method === 'elasticity-1')!;
  assert.equal(group.count, 2);
  assert(Math.abs(group.maeTrillion - 11.55) < 1e-10);
  assert(Math.abs(group.biasTrillion - .55) < 1e-10);
  const changed = backtestRevenue([...rows.slice(0, 2), { ...rows[2], taxPercentGdp: 90 }], [1]);
  assert.deepEqual(result.cases.filter(r => r.target === 2001), changed.cases.filter(r => r.target === 2001));
});

test('comparison includes unchanged revenue and rejects gaps and invalid observations', () => {
  const result = backtestRevenue(fixture.rows, [1, 1.3]);
  assert.equal(result.cases.length, 9);
  assert.equal(result.summaries.find(r => r.method === 'unchanged' && r.horizon === 2)!.count, 1);
  assert.throws(() => backtestRevenue([fixture.rows[0], fixture.rows[2]], [1.3]), RangeError);
  assert.throws(() => backtestRevenue(fixture.rows, [NaN]), RangeError);
  assert.throws(() => backtestRevenue([{ ...fixture.rows[0], gdpTrillion: 0 }, fixture.rows[1]], [1.3]), RangeError);
});

test('long historical series preserves fiscal-year scope and exact revenue components', () => {
  assert.equal(longSeries.period, 'fiscal-year');
  assert.equal(longSeries.rows.length, 31);
  assert.equal(longSeries.rows[0].year, 1994);
  const last = longSeries.rows.at(-1)!;
  assert.equal(last.year, 2024);
  assert(Math.abs(last.gdpTrillion - 642.4147) < 1e-10);
  assert.notEqual(last.gdpTrillion, fixture.rows.at(-1)!.gdpTrillion);
  for (const row of longSeries.rows) {
    const reconstructed = row.gdpTrillion * (row.taxPercentGdp + row.socialPercentGdp) / 100;
    assert(Math.abs(reconstructed - row.taxTrillion - row.finesTrillion - row.socialTrillion) < 1e-10);
  }
  assert(Math.abs(last.taxTrillion + last.finesTrillion + last.socialTrillion - 213.9204) < 1e-10);
});

test('extended windows yield 30, 28 and 26 observations without intermediate revenue resets', () => {
  const result = backtestRevenue(longSeries.rows, [1.3], [1, 3, 5]);
  assert.deepEqual(result.summaries.filter(r => r.method === 'elasticity-1.3').map(r => [r.horizon, r.count]), [[1, 30], [3, 28], [5, 26]]);
  assert.equal(result.cases.length, (30 + 28 + 26) * 2);
  assert(result.cases.every(r => r.target - r.origin === r.horizon && [1, 3, 5].includes(r.horizon)));
  const altered = longSeries.rows.map(r => r.year === 1995 ? { ...r, taxPercentGdp: 99 } : r);
  assert.deepEqual(result.cases.filter(r => r.origin === 1994 && r.horizon === 5),
    backtestRevenue(altered, [1.3], [5]).cases.filter(r => r.origin === 1994));
  assert.throws(() => backtestRevenue(longSeries.rows, [1.3], [0]), RangeError);
});
