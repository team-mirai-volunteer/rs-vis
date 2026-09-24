import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditAmount, creditSeries } from '../app/lib/tax-expenditures/credits';

test('credit totals preserve units and exclude subset corporations and mixed depreciation', () => {
  const series = creditSeries('2024');
  assert.equal(series.length, 7);
  assert.equal(series[0].id, 'mof-2024-r24');
  assert.equal(series[0].total, 958609243 + 25363958 + 22257361 + 658888);
  assert.equal(series.find(s => s.id === 'mof-2024-r196')!.total, 2899075);
  assert.equal(creditAmount(2899075), '28.99 億円');
  assert.ok(!series.some(s => s.id === 'mof-2024-r64'));
});

test('2022 adds separate consolidated corporations; missing sections stay missing', () => {
  const donation = creditSeries('2022').find(s => s.id === 'mof-2024-r196')!;
  assert.equal(donation.total, 1272063 + 58949); // do not add subset 130533
  const wages = creditSeries('2022').find(s => s.id === 'mof-2024-r217')!;
  assert.equal(wages.segments[1].amount, null);
  assert.equal(wages.segments[3].amount, null);
  assert.equal(wages.hasMissing, true);
  assert.deepEqual(creditSeries('2024', new Set(['mof-2024-r64'])), []);
  assert.equal(creditSeries('2024', new Set(['mof-2024-r196'])).length, 1);
});
