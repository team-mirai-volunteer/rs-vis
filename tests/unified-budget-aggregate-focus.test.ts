import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopN } from '../app/lib/unified-budget/transform';
import { focusGraph, relatedThroughAggregates } from '../app/lib/unified-budget/focus';
import type { UnifiedViewGraph, UnifiedViewNode } from '../types/unified-budget-view';
import type { UnifiedColumn } from '../types/unified-budget';

const node = (id: string, column: UnifiedColumn, value: number, projectId?: number): UnifiedViewNode =>
  ({ id, name: id, value, type: column, details: { column, kind: 'rs', ...(projectId === undefined ? {} : { projectId }) } } as UnifiedViewNode);

// 府省A・Bの小さな事業は「N事業」に集約される。支出先Xは府省Aの小事業からだけ受け取る。
const full: UnifiedViewGraph = {
  nodes: [node('m-a', 'ministry', 30), node('m-b', 'ministry', 120),
    node('p-big', 'program', 100, 1), node('p-a', 'program', 30, 2), node('p-b', 'program', 20, 3),
    node('r-x', 'recipient', 30), node('r-y', 'recipient', 120)],
  links: [{ source: 'm-a', target: 'p-a', value: 30 }, { source: 'm-b', target: 'p-big', value: 100 }, { source: 'm-b', target: 'p-b', value: 20 },
    { source: 'p-a', target: 'r-x', value: 30 }, { source: 'p-big', target: 'r-y', value: 100 }, { source: 'p-b', target: 'r-y', value: 20 }],
};
const display = applyTopN(full, { program: 1 }, {});

test('集約ノードを経由しても、実際に流れていない府省は関連にしない', () => {
  assert.ok(display.nodes.some(n => n.id === '__others__program'));
  const related = relatedThroughAggregates(display, full, 'r-x');
  assert.ok(related.has('m-a'));
  assert.ok(related.has('__others__program'));
  assert.ok(!related.has('m-b'), '府省Bは支出先Xへ流れていない');
  const focused = focusGraph(display.nodes, display.links, 'r-x', related);
  assert.deepEqual(focused.nodes.map(n => n.id).sort(), ['__others__program', 'm-a', 'r-x']);
});

test('集約ノード自体を選ぶと、中身の事業に連なるノードを関連にする', () => {
  const related = relatedThroughAggregates(display, full, '__others__program');
  assert.ok(related.has('m-a') && related.has('m-b') && related.has('r-x') && related.has('r-y'));
  assert.ok(!related.has('p-big'));
});
