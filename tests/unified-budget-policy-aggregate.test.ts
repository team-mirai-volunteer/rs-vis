import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePolicy } from '../app/lib/unified-budget/policy-aggregate';
import type { PolicySummaryEntry } from '../app/api/policy-summary/route';

const entry = (o: number | null, x: number | null, r = 0): PolicySummaryEntry => ({ o, d: o, e: o, t: o, x, n: o, r, a: 0, c: '' });

test('金額で加重平均し、未評価の事業は重みから除く', () => {
  const agg = aggregatePolicy(
    [
      { pid: 1, weight: 300 }, // 80点
      { pid: 2, weight: 100 }, // 40点
      { pid: 3, weight: 600 }, // 未評価
    ],
    { '1': entry(80, 90), '2': entry(40, 50) },
    { 1: '継続' }
  );
  assert.equal(agg.scores.o, 70); // (80*300 + 40*100) / 400
  assert.equal(agg.scores.x, 80); // (90*300 + 50*100) / 400
  assert.equal(agg.programCount, 3);
  assert.equal(agg.evaluatedCount, 2);
  assert.equal(agg.coverage, 0.4); // 400 / 1000
});

test('推奨判断の分布は評価あり金額に対する比率', () => {
  const agg = aggregatePolicy(
    [
      { pid: 1, weight: 300 },
      { pid: 2, weight: 100 },
    ],
    { '1': entry(80, 90, 1), '2': entry(40, 50, 2) },
    { 1: '継続', 2: '要改善' }
  );
  assert.deepEqual(agg.recommendationShare, [
    { label: '継続', share: 0.75 },
    { label: '要改善', share: 0.25 },
  ]);
});

test('軸ごとに評価の有無を扱い、全て未評価なら null', () => {
  const agg = aggregatePolicy([{ pid: 1, weight: 10 }], { '1': entry(60, null) }, {});
  assert.equal(agg.scores.o, 60);
  assert.equal(agg.scores.x, null);
});
