import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectMapSpending, isPlaceholderRecipient } from '../app/lib/project-map-spending';
import { SPENDING_COLORS, spendingRadius, spendingStep, spendingStepLabel } from '../app/lib/project-map-view';
import type { GraphData } from '../types/sankey-svg';

const node = (id: string, type: GraphData['nodes'][number]['type'], extra: object = {}) =>
  ({ id, name: id, type, value: 0, ...extra });

test('placeholder recipient names are excluded, real names are kept', () => {
  for (const n of [
    'その他', 'その他の支出先', '雇用調整助成金を受給している事業主その他', '個人A', '個人(B)', '個人事業主A',
    'A社', 'Ｂ社', '某A社', '両立支援等助成金を受給している事業主A社', 'A', '支出先なし', '非公表',
    '株式会社A', '民間事業者B', '人材開発支援助成金を受給する法人C', '企業Kほか', '発信実施団体A',
  ]) {
    assert.equal(isPlaceholderRecipient(n), true, n);
  }
  for (const n of [
    '東京都', '株式会社三菱総合研究所', '日本電気株式会社', '年金受給者等', '日本赤十字社',
    '一般社団法人共同通信社', 'JTB', 'IOM', '学校法人YIC学院', '一般社団法人JHC', '国立大学法人広島大学ほか',
  ]) {
    assert.equal(isPlaceholderRecipient(n), false, n);
  }
});

test('recipients of map projects are kept (single-project ones too), amounts summed per project and sorted', () => {
  const graph = {
    nodes: [
      node('project-spending-1', 'project-spending', { projectId: 1 }),
      node('project-spending-2', 'project-spending', { projectId: 2 }),
      node('project-spending-3', 'project-spending', { projectId: 3 }),
      node('project-spending-9', 'project-spending', { projectId: 9 }),
      node('r-shared', 'recipient'),
      node('r-single', 'recipient'),
      node('r-offmap', 'recipient'),
      { ...node('r-other', 'recipient'), name: 'その他' },
    ],
    edges: [
      // 同じ事業→支出先の辺が2本（複数ブロック）あれば合算する
      { source: 'project-spending-1', target: 'r-shared', value: 100 },
      { source: 'project-spending-1', target: 'r-shared', value: 50 },
      { source: 'project-spending-2', target: 'r-shared', value: 300 },
      { source: 'project-spending-3', target: 'r-single', value: 10 },
      // マップに無い事業(9)は数えない → r-offmap は1事業のみ
      { source: 'project-spending-9', target: 'r-offmap', value: 10 },
      { source: 'project-spending-3', target: 'r-offmap', value: 10 },
      { source: 'project-spending-1', target: 'r-other', value: 1 },
      { source: 'project-spending-2', target: 'r-other', value: 1 },
    ],
  } as unknown as GraphData;

  const res = buildProjectMapSpending(graph, new Set(['1', '2', '3']), 2025);
  // 1事業だけの支出先も残る。金額の大きい順、同額は id 順
  assert.deepEqual(res.recipients.map(r => r.id), ['r-shared', 'r-offmap', 'r-single']);
  const r = res.recipients[0];
  assert.equal(r.amount, 450);
  assert.deepEqual(r.pids, ['2', '1']);
  assert.deepEqual(r.amounts, [300, 150]);
  // マップに無い事業(9)からの支出は数えない
  assert.deepEqual(res.recipients[1].pids, ['3']);
  assert.equal(res.recipients[1].amount, 10);
  assert.deepEqual(res.summary, { recipients: 3, links: 4, excludedPlaceholders: 1 });
});

test('spending steps are monotonic by amount and cut at round yen values', () => {
  const amounts = [0, 5e6, 1e7, 3e8, 1e9, 5e10, 2e11, 1e12, 3e13];
  const steps = amounts.map(spendingStep);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1]);
  assert.equal(spendingStep(9_999_999), 0);
  assert.equal(spendingStep(1e8), 2);
  assert.equal(spendingStep(3e13), SPENDING_COLORS.length - 1);
  assert.ok(spendingRadius(3e13) > spendingRadius(1e6));
  assert.deepEqual([0, 2, 6].map(spendingStepLabel), ['〜1千万', '1億〜', '1兆〜']);
});
