import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTopN, offsetToReveal, sortForDisplay } from '../app/lib/unified-budget/transform';
import { buildProgramRanking } from '../app/lib/unified-budget/program-sort';
import { projectBlockDifference } from '../app/lib/subcontracts/block-balance';
import { buildProjectSortMetrics } from '../app/lib/project-sort-metrics';
import type { UnifiedProgramRanking, UnifiedViewGraph, UnifiedViewNode } from '../types/unified-budget-view';
import type { BlockEdge, BlockNode, SubcontractGraph } from '../types/subcontract';

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode => ({
  id, name: id, value, type: column, details: { column, ...details },
});
const program = (pid: number, value: number) => node(`p-${pid}`, 'program', value, { kind: 'rs', projectId: pid });
const ranking = (entries: [number, number][], order: 'asc' | 'desc' = 'asc'): UnifiedProgramRanking => ({ values: new Map(entries), order });

test('sortForDisplay: 並べ替えキー順、値の無い事業は後ろ（金額順）、区分・集約ノードはさらに後ろ', () => {
  const view: UnifiedViewGraph = {
    nodes: [
      program(1, 100), program(2, 300), program(3, 200), program(4, 50), program(5, 10),
      node('np-debt', 'program', 999, { kind: 'debt' }),
      node('__others__program', 'program', 999, { aggregated: true }),
      node('s-3', 'program-spending', 1, { kind: 'rs', projectId: 3 }),
      node('s-2', 'program-spending', 9, { kind: 'rs', projectId: 2 }),
    ],
    links: [],
  };
  // 低い順。4 と 1 は同点 → 金額順（1 が先）。2・5 は値無し → 金額順
  const r = ranking([[3, 20], [1, 50], [4, 50]]);
  assert.deepEqual(sortForDisplay(view, r).nodes.map(n => n.id), ['p-3', 'p-1', 'p-4', 'p-2', 'p-5', 'np-debt', '__others__program', 's-3', 's-2']);
  // 高い順
  assert.deepEqual(sortForDisplay(view, ranking([[3, 20], [5, 90]], 'desc')).nodes.slice(0, 3).map(n => n.id), ['p-5', 'p-3', 'p-2']);
  // ranking 無しは従来どおり金額順
  assert.deepEqual(sortForDisplay(view).nodes.slice(0, 2).map(n => n.id), ['p-2', 'p-3']);
});

test('applyTopN: 並べ替えキーの上位N件を残し、事業(支出) も同じ事業に揃える', () => {
  const nodes = [program(1, 100), program(2, 300), program(3, 200), program(4, 50)];
  const spending = nodes.map(n => node(`s-${n.details.projectId}`, 'program-spending', n.value, { kind: 'rs', projectId: n.details.projectId }));
  const view: UnifiedViewGraph = {
    nodes: [...nodes, ...spending],
    links: nodes.map(n => ({ source: n.id, target: `s-${n.details.projectId}`, value: n.value })),
  };
  const kept = (g: UnifiedViewGraph, col: string) => g.nodes.filter(n => n.details.column === col && !n.details.aggregated).map(n => n.id).sort();
  const r = ranking([[4, 10], [1, 20], [2, 80]]);
  const shown = applyTopN(view, { program: 2, 'program-spending': 2 }, {}, r);
  assert.deepEqual(kept(shown, 'program'), ['p-1', 'p-4']);
  assert.deepEqual(kept(shown, 'program-spending'), ['s-1', 's-4']);
  // offset もキー順で数える（3 番目＝p-2 から）
  assert.deepEqual(kept(applyTopN(view, { program: 2 }, { program: 2 }, r), 'program'), ['p-2', 'p-3']);
  // 金額順なら 2・3
  assert.deepEqual(kept(applyTopN(view, { program: 2 }, {}), 'program'), ['p-2', 'p-3']);
});

test('offsetToReveal: 事業列はキー順の順位で窓を動かす', () => {
  const programs = Array.from({ length: 60 }, (_, i) => program(i, 600 - i));
  const view: UnifiedViewGraph = { nodes: programs, links: [] };
  // キーは金額と逆順 → 事業 0 はキー順で 59 位
  const r = ranking(programs.map((_, i) => [i, 60 - i] as [number, number]));
  assert.equal(offsetToReveal(view, { program: 20 }, {}, 'p-59', r), null);
  assert.deepEqual(offsetToReveal(view, { program: 20 }, {}, 'p-0', r), { program: 40 });
});

test('buildProgramRanking: 総合点・指標から値を作り、未取得・金額順は undefined', () => {
  assert.equal(buildProgramRanking('amount', {}), undefined);
  assert.equal(buildProgramRanking('score-asc', { policy: undefined }), undefined);
  const s = buildProgramRanking('score-desc', { policy: { '1': { o: 40 }, '2': { o: null } } })!;
  assert.equal(s.order, 'desc');
  assert.deepEqual([...s.values], [[1, 40]]);
  const d = buildProgramRanking('ratio', { metrics: { '1': { y: 3 }, '7': { d: 10, r: 0.5 } } })!;
  assert.deepEqual([...d.values], [[7, 0.5]]);
  assert.deepEqual([...buildProgramRanking('years', { metrics: { '1': { y: 3 } } })!.values], [[1, 3]]);
});

const block = (blockId: string, totalAmount: number): BlockNode => ({
  blockId, blockName: blockId, totalAmount, recipientCount: 1, recipients: [], isDirect: blockId === 'A',
  originKind: blockId === 'A' ? 'direct' : 'subcontract', isTerminal: false, hasExpenses: false,
});
const flow = (sourceBlock: string | null, targetBlock: string): BlockEdge => ({
  sourceBlock, targetBlock, origin: 'subcontract', isReference: false, targetIncomingBlockCount: 1,
});

test('projectBlockDifference: 差額を算出できるブロックだけを合計し、無ければ null', () => {
  // A(100)→B(60)→C(20)、D(50) は再委託なし、E(30)→F(40) は下流の方が大きく算出不可
  const graph = {
    blocks: [block('A', 100), block('B', 60), block('C', 20), block('D', 50), block('E', 30), block('F', 40)],
    flows: [flow(null, 'A'), flow('A', 'B'), flow('B', 'C'), flow(null, 'D'), flow(null, 'E'), flow('E', 'F')],
  };
  const result = projectBlockDifference(graph)!;
  assert.equal(result.difference, 40 + 40);
  assert.equal(result.recorded, 160);
  assert.equal(result.ratio, 0.5);
  assert.equal(projectBlockDifference({ blocks: [block('A', 100)], flows: [flow(null, 'A')] }), null);
});

test('buildProjectSortMetrics: 継続年数と差額を pid ごとに短いキーでまとめる', () => {
  const graph = { blocks: [block('A', 300), block('B', 100)], flows: [flow(null, 'A'), flow('A', 'B')] } as unknown as SubcontractGraph;
  const items = buildProjectSortMetrics(
    [{ pid: '1', yearsRunning: 5 }, { pid: '2', yearsRunning: null }],
    { '1': graph, '3': graph, '4': { blocks: [], flows: [] } as unknown as SubcontractGraph },
  );
  assert.deepEqual(items, { '1': { y: 5, d: 200, r: 0.6667 }, '3': { d: 200, r: 0.6667 } });
});
