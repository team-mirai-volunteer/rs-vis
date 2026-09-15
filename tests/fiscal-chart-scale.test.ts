import test from 'node:test';
import assert from 'node:assert/strict';
import { fiscalChartScale } from '../client/lib/fiscal-chart-scale';

test('GDP chart keeps ordinary 50-trillion ticks and bounds extreme scenario rendering', () => {
  assert.deepEqual(fiscalChartScale([689.2e12, 739.2e12]).ticks, [650e12, 700e12, 750e12]);
  for (const values of [[600e12, 34000e12], [1e12, 1e25], [700e12, 700e12]]) {
    const scale = fiscalChartScale(values);
    assert(scale.ticks.length >= 2 && scale.ticks.length <= 9);
    assert(scale.low <= Math.min(...values));
    assert(scale.high >= Math.max(...values));
    assert(scale.high > scale.low);
    assert.equal(scale.ticks.at(-1), scale.high);
  }
});
