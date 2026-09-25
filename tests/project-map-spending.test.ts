import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectMapSpending, isPlaceholderRecipient } from '../app/lib/project-map-spending';
import { SPENDING_COLORS, spendingRadius, spendingStep, spendingStepLabel } from '../app/lib/project-map-view';
import type { GraphData } from '../types/sankey-svg';

const node = (id: string, type: GraphData['nodes'][number]['type'], extra: object = {}) =>
  ({ id, name: id, type, value: 0, ...extra });

test('placeholder recipient names are excluded, real names are kept', () => {
  for (const n of ['その他', 'その他の支出先', '個人A', '個人(B)', '個人事業主A', 'A社', 'Ｂ社', '支出先なし']) {
    assert.equal(isPlaceholderRecipient(n), true, n);
  }
  for (const n of ['東京都', '株式会社三菱総合研究所', '日本電気株式会社', '年金受給者等']) {
    assert.equal(isPlaceholderRecipient(n), false, n);
  }
});

test('recipients shared by 2+ map projects are kept, amounts summed per project and sorted', () => {
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
  assert.equal(res.recipients.length, 1);
  const r = res.recipients[0];
  assert.equal(r.id, 'r-shared');
  assert.equal(r.amount, 450);
  assert.deepEqual(r.pids, ['2', '1']);
  assert.deepEqual(r.amounts, [300, 150]);
  assert.deepEqual(res.summary, { recipients: 1, links: 2, excludedPlaceholders: 1 });
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
