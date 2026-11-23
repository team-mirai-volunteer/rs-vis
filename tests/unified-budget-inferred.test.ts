import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopN, collapseColumns } from '../app/lib/unified-budget/transform';
import { aggregateId } from '../types/unified-budget-view';
import type { UnifiedViewGraph, UnifiedViewNode } from '../types/unified-budget-view';
import type { SankeyLink } from '../types/sankey';

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode => ({
  id,
  name: id,
  value,
  type: column,
  details: { column, ...details },
});

const program = (projectId: number, value: number) => node(`project-budget-${projectId}`, 'program', value, { kind: 'rs', projectId });

const inferredOf = (links: SankeyLink[], source: string, target: string) => {
  const link = links.find(l => l.source === source && l.target === target);
  assert.ok(link, `${source}→${target} の帯がある`);
  return link.inferred;
};

test('列を省略しても、接続の変わらない帯は推定の印を保つ', () => {
  const view: UnifiedViewGraph = {
    nodes: [node('sec-a', 'section', 100), node('moku-a', 'koumoku', 100), program(1, 60), program(2, 40)],
    links: [
      { source: 'sec-a', target: 'moku-a', value: 100 },
      { source: 'moku-a', target: 'project-budget-1', value: 60, inferred: 'note' },
      { source: 'moku-a', target: 'project-budget-2', value: 40 },
    ],
  };
  const collapsed = collapseColumns(view, ['koumoku', 'program']);
  assert.equal(inferredOf(collapsed.links, 'moku-a', 'project-budget-1'), 'note');
  assert.equal(inferredOf(collapsed.links, 'moku-a', 'project-budget-2'), undefined);
});

test('目の列を省略すると、推定の帯を通る項→事業の帯が推定の印を引き継ぐ', () => {
  const view: UnifiedViewGraph = {
    nodes: [node('sec-a', 'section', 100), node('moku-a', 'koumoku', 100), program(1, 60), program(2, 40)],
    links: [
      { source: 'sec-a', target: 'moku-a', value: 100 },
      { source: 'moku-a', target: 'project-budget-1', value: 60, inferred: 'amount+name' },
      { source: 'moku-a', target: 'project-budget-2', value: 40 },
    ],
  };
  const collapsed = collapseColumns(view, ['section', 'program']);
  assert.equal(inferredOf(collapsed.links, 'sec-a', 'project-budget-1'), 'amount+name');
  assert.equal(inferredOf(collapsed.links, 'sec-a', 'project-budget-2'), undefined);
});

test('列の省略で合流する帯は、すべて同じ推定方法のときだけ推定の印を残す', () => {
  const view: UnifiedViewGraph = {
    nodes: [
      node('sec-a', 'section', 150),
      node('moku-a', 'koumoku', 90),
      node('moku-b', 'koumoku', 60),
      program(1, 50),
      program(2, 50),
      program(3, 50),
    ],
    links: [
      { source: 'sec-a', target: 'moku-a', value: 90 },
      { source: 'sec-a', target: 'moku-b', value: 60 },
      // 事業1: どちらの目からも同じ推定方法
      { source: 'moku-a', target: 'project-budget-1', value: 30, inferred: 'note' },
      { source: 'moku-b', target: 'project-budget-1', value: 20, inferred: 'note' },
      // 事業2: 推定と確定が混ざる
      { source: 'moku-a', target: 'project-budget-2', value: 30, inferred: 'note' },
      { source: 'moku-b', target: 'project-budget-2', value: 20 },
      // 事業3: 推定方法が異なる
      { source: 'moku-a', target: 'project-budget-3', value: 30, inferred: 'note' },
      { source: 'moku-b', target: 'project-budget-3', value: 20, inferred: 'reviewed' },
    ],
  };
  const collapsed = collapseColumns(view, ['section', 'program']);
  assert.equal(inferredOf(collapsed.links, 'sec-a', 'project-budget-1'), 'note');
  assert.equal(inferredOf(collapsed.links, 'sec-a', 'project-budget-2'), undefined);
  assert.equal(inferredOf(collapsed.links, 'sec-a', 'project-budget-3'), undefined);
  assert.equal(collapsed.links.find(l => l.target === 'project-budget-1')?.value, 50);
});

test('TopN で集約しても、集約に含まれない帯は推定の印を保つ', () => {
  const view: UnifiedViewGraph = {
    nodes: [node('sec-a', 'section', 60), node('sec-b', 'section', 40), node('moku-a', 'koumoku', 100), program(1, 100)],
    links: [
      { source: 'sec-a', target: 'moku-a', value: 60 },
      { source: 'sec-b', target: 'moku-a', value: 40 },
      { source: 'moku-a', target: 'project-budget-1', value: 100, inferred: 'reviewed' },
    ],
  };
  const top = applyTopN(view, { section: 1 }, {});
  assert.ok(top.nodes.some(n => n.id === aggregateId('section')), '項が集約されている');
  assert.equal(inferredOf(top.links, 'moku-a', 'project-budget-1'), 'reviewed');
});

test('TopN の集約ノードへ合流する帯は、すべて同じ推定方法のときだけ推定の印を残す', () => {
  const links: SankeyLink[] = [
    { source: 'sec-a', target: 'moku-a', value: 100 },
    { source: 'sec-a', target: 'moku-b', value: 30 },
    { source: 'moku-a', target: 'project-budget-1', value: 100 },
    { source: 'moku-a', target: 'project-budget-2', value: 20, inferred: 'note' },
    { source: 'moku-a', target: 'project-budget-3', value: 10, inferred: 'note' },
    { source: 'moku-b', target: 'project-budget-2', value: 20, inferred: 'note' },
    { source: 'moku-b', target: 'project-budget-3', value: 10 },
  ];
  const view: UnifiedViewGraph = {
    nodes: [node('sec-a', 'section', 130), node('moku-a', 'koumoku', 130), node('moku-b', 'koumoku', 30), program(1, 100), program(2, 40), program(3, 20)],
    links,
  };
  const top = applyTopN(view, { program: 1 }, {});
  const agg = aggregateId('program');
  assert.equal(inferredOf(top.links, 'moku-a', agg), 'note');
  assert.equal(inferredOf(top.links, 'moku-b', agg), undefined);
  assert.equal(inferredOf(top.links, 'moku-a', 'project-budget-1'), undefined);
});
