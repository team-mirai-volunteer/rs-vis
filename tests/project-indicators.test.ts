import test from 'node:test';
import assert from 'node:assert/strict';
import { getProjectIndicators, loadProjectIndicators } from '../app/lib/api/project-indicators-loader';
import { countOutcomes, loadOutcomeCounts } from '../app/lib/api/outcome-counts';
import { loadQualityScores } from '../app/lib/api/quality-scores-loader';
import { displayYears, formatIndicatorValue, rateClass } from '../client/components/unified-budget/ProjectOutcomeIndicators';

const data = loadProjectIndicators('2025');

test('成果目標・実績: 指標のある事業だけを載せ、各指標が段階と年度系列を持つ', { skip: !data }, () => {
  const pids = Object.keys(data!);
  assert.ok(pids.length > 5000);
  for (const pid of pids.slice(0, 200)) {
    const entry = data![pid];
    assert.ok(entry.indicators.length > 0, `${pid} に指標が無い`);
    for (const i of entry.indicators) {
      assert.ok(['アクティビティ', 'アウトプット', 'アウトカム'].includes(i.kind), `${pid}/${i.no} の種別 ${i.kind}`);
      for (const series of [i.target, i.actual, i.rate]) {
        for (const y of Object.keys(series)) assert.match(y, /^\d{4}$/);
      }
    }
  }
});

test('成果目標・実績: 国有ワクチン等の備蓄（2126）はアウトカム 2 件で達成率が入っている', { skip: !data }, () => {
  const entry = getProjectIndicators('2025', '2126');
  assert.ok(entry);
  const outcomes = entry.indicators.filter(i => i.kind === 'アウトカム');
  assert.equal(outcomes.length, 2);
  const stock = outcomes.find(i => i.indicator === '備蓄本数');
  assert.ok(stock);
  assert.equal(stock.period, '1.短期');
  assert.equal(stock.target['2024'], '1606');
  assert.equal(stock.actual['2024'], '1590');
  assert.equal(Math.round(Number(stock.rate['2024'])), 99);
  assert.equal(getProjectIndicators('2025', '0'), undefined);
  // 長期アウトカムは 2034 年度まで目標が並ぶが、表はシート年度までと最終目標年度の 1 列に絞る
  const longTerm = outcomes.find(i => i.period === '3.長期');
  assert.ok(longTerm);
  assert.deepEqual(displayYears(longTerm, 2025), ['2021', '2022', '2023', '2024', '2025', '2034']);
});

test('成果目標・実績: 値の整形と達成率の色分け', () => {
  assert.equal(formatIndicatorValue('1590'), '1,590');
  assert.equal(formatIndicatorValue('247.15447'), '247.15');
  assert.equal(formatIndicatorValue(''), '—');
  assert.equal(formatIndicatorValue(undefined), '—');
  assert.equal(formatIndicatorValue('約100'), '約100');
  assert.equal(rateClass('100'), 'text-status-good-fg');
  assert.equal(rateClass('99.00374'), 'text-mirai-text');
  assert.equal(rateClass('60'), 'text-status-warn');
  assert.equal(rateClass('10'), 'text-destructive');
  assert.equal(rateClass(undefined), 'text-mirai-text-muted');
});

test('成果指標の件数: アウトカム指標が 1 つも無い事業は 2025 年度に 900 件以上ある（LP の洞察と整合）', { skip: !data }, () => {
  const counts = loadOutcomeCounts('2025');
  assert.equal(counts.get('2126')?.outcome, 2);
  assert.equal(counts.get('2126')?.outcomeActual, 2);
  const withOutcome = [...counts.values()].filter(c => c.outcome > 0).length;
  const scored = loadQualityScores('2025').items.length;
  assert.ok(scored - withOutcome > 900 && scored - withOutcome < 1100, `指標なし ${scored - withOutcome} 件`);
  assert.deepEqual(countOutcomes([]), { outcome: 0, outcomeActual: 0 });
});
