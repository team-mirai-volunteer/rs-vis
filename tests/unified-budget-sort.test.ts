import test from 'node:test';
import assert from 'node:assert/strict';
import { sortForDisplay } from '../app/lib/unified-budget/transform';
import type { UnifiedViewGraph, UnifiedViewNode } from '../types/unified-budget-view';

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode => ({
  id,
  name: id,
  value,
  type: column,
  details: { column, ...details },
});

test('列内は金額の大きい順、集約ノードは最下段', () => {
  const view: UnifiedViewGraph = {
    nodes: [
      node('__others__section', 'section', 999, { aggregated: true }),
      node('sec-a', 'section', 10),
      node('sec-b', 'section', 30),
      node('sec-c', 'section', 20),
    ],
    links: [],
  };
  assert.deepEqual(sortForDisplay(view).nodes.map(n => n.id), ['sec-b', 'sec-c', 'sec-a', '__others__section']);
});

test('事業列は RS事業を上、事業区分ノードと擬似ノードを下に置く', () => {
  const view: UnifiedViewGraph = {
    nodes: [
      node('np-debt', 'program', 500, { kind: 'debt' }),
      node('np-outside', 'program', 400, { kind: 'outside', standalone: true }),
      node('project-1', 'program', 100, { kind: 'rs', projectId: 1 }),
      node('np-unmatched', 'program', 50, { kind: 'unmatched' }),
      node('project-2', 'program', 300, { kind: 'rs', projectId: 2 }),
      node('__others__program', 'program', 900, { aggregated: true }),
    ],
    links: [],
  };
  assert.deepEqual(sortForDisplay(view).nodes.map(n => n.id), [
    'project-2',
    'project-1',
    'np-debt',
    'np-outside',
    'np-unmatched',
    '__others__program',
  ]);
});

test('事業(支出) は事業と同じ事業IDの並びに揃える', () => {
  const view: UnifiedViewGraph = {
    nodes: [
      node('project-1', 'program', 100, { kind: 'rs', projectId: 1 }),
      node('project-2', 'program', 300, { kind: 'rs', projectId: 2 }),
      // 支出側は金額が逆転していても事業側の順に従う
      node('project-1-spending', 'program-spending', 250, { kind: 'rs', projectId: 1 }),
      node('project-2-spending', 'program-spending', 20, { kind: 'rs', projectId: 2 }),
      node('__others__program-spending', 'program-spending', 5, { aggregated: true }),
    ],
    links: [],
  };
  const ids = sortForDisplay(view).nodes.map(n => n.id);
  assert.deepEqual(ids.slice(2), ['project-2-spending', 'project-1-spending', '__others__program-spending']);
});
