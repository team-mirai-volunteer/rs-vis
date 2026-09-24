import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { applyFilter, applyTopN, collapseColumns, toRsMinistryGraph, toViewGraph } from '../app/lib/unified-budget/transform';
import { descendantsByColumn, focusGraph, relatedNodeIds } from '../app/lib/unified-budget/focus';
import { computeMOFSankeyLayout } from '../app/lib/mof-sankey-layout';
import { UNIFIED_LAYOUT } from '../app/lib/unified-budget/constants';
import { UNIFIED_FILTER_DEFAULT, type UnifiedViewGraph } from '../types/unified-budget-view';
import { UNIFIED_COLUMNS, type UnifiedColumn, type UnifiedGraph } from '../types/unified-budget';

for (const year of [2023, 2024]) {
  test(`${year}: デジタル庁の接続のない事業(支出)を絞り込み・集約・選択後も表示する`, () => {
    const graph: UnifiedGraph = JSON.parse(gunzipSync(readFileSync(
      new URL(`../public/data/unified-budget-${year}-initial-graph.json.gz`, import.meta.url)
    )).toString());
    const spendingId = 'project-spending-4';
    const programId = 'project-budget-4';
    assert.ok(graph.nodes.some(n => n.id === spendingId && n.value === 0));
    assert.ok(!graph.edges.some(e => e.source === spendingId || e.target === spendingId));

    for (const ministryMode of [false, true]) {
      const raw = toViewGraph(graph, { keepZeroPrograms: ministryMode });
      const base = ministryMode ? toRsMinistryGraph(raw) : raw;
      // 2023予算書ではこの事業はoutsideのみ。所管への対応がある基準で所管も絞る。
      const filtered = applyFilter(base, { ...UNIFIED_FILTER_DEFAULT, ministries: ministryMode || year === 2024 ? ['デジタル庁'] : [], projectIds: ['4'] });
      const collapsed = collapseColumns(filtered, ['ministry', 'program', 'program-spending', 'recipient']);
      const display = applyTopN(collapsed, {}, {});
      assert.equal(display.nodes.find(n => n.id === spendingId)?.value, 0);
      assert.ok(!display.links.some(l => l.source === spendingId || l.target === spendingId));
      for (const selectedId of [programId, spendingId]) {
        const focused = focusGraph(display.nodes, display.links, selectedId);
        assert.ok(focused.nodes.some(n => n.id === programId));
        assert.ok(focused.nodes.some(n => n.id === spendingId));
        assert.ok(relatedNodeIds(display.links, selectedId, display.nodes).has(spendingId));
        const layout = computeMOFSankeyLayout(focused, {
          ...UNIFIED_LAYOUT, width: 1300, height: 900,
          columnOf: n => UNIFIED_COLUMNS.indexOf(n.type as UnifiedColumn),
        });
        const spending = layout.nodes.find(n => n.id === spendingId);
        assert.ok(spending && spending.height >= 1 && Number.isFinite(spending.y));
      }
      for (const patch of [{ ministries: ['厚生労働省'] }, { projectIds: ['1'] }, { spendingMin: '1' }]) {
        const excluded = applyFilter(base, { ...UNIFIED_FILTER_DEFAULT, ...patch });
        assert.ok(!excluded.nodes.some(n => n.id === spendingId));
      }
    }
  });
}

test('当初予算0円の除外では支出側も残さない', () => {
  const graph = { nodes: [
    { id: 'p', name: 'p', col: 'program', kind: 'rs', projectId: 1, value: 0 },
    { id: 's', name: 'p', col: 'program-spending', kind: 'rs', projectId: 1, value: 0 },
  ], edges: [] } as unknown as UnifiedGraph;
  assert.equal(toViewGraph(graph).nodes.length, 0);
  assert.equal(toViewGraph(graph, { keepZeroPrograms: true }).nodes.length, 2);
  // 補正・繰越による予算がある事業は、支出があっても当初予算の対象にはしない。
  graph.nodes[0].rsCurrentBudget = 100;
  graph.nodes[1].value = 80;
  assert.equal(toViewGraph(graph).nodes.length, 0);
  assert.equal(toViewGraph(graph, { keepZeroPrograms: true }).nodes.length, 2);
});

for (const year of [2023, 2024]) {
  for (const basis of ['initial', 'supplementary']) {
    test(`${year} ${basis}: 個別予算0円のマイキー事業を支出先とともに残す`, () => {
      const graph: UnifiedGraph = JSON.parse(gunzipSync(readFileSync(
        new URL(`../public/data/unified-budget-${year}-${basis}-graph.json.gz`, import.meta.url)
      )).toString());
      const programId = 'project-budget-56';
      const spendingId = 'project-spending-56';
      const amount = year === 2023 ? 1553699000 : 938276000;
      assert.equal(graph.nodes.find(n => n.id === programId)?.value, 0);
      assert.equal(graph.nodes.find(n => n.id === spendingId)?.value, amount);
      assert.ok(!graph.edges.some(e => e.target === programId || e.source === programId));
      for (const ministryMode of [false, true]) {
        const raw = toViewGraph(graph, { keepZeroPrograms: ministryMode });
        const base = ministryMode ? toRsMinistryGraph(raw) : raw;
        const filtered = applyFilter(base, { ...UNIFIED_FILTER_DEFAULT, ministries: ['デジタル庁'], accountTypes: ['general'], projectQuery: 'マイキー' });
        const display = applyTopN(collapseColumns(filtered, ['program', 'program-spending', 'recipient']), {}, {});
        assert.equal(display.nodes.find(n => n.id === programId)?.value, 0);
        assert.equal(display.nodes.find(n => n.id === spendingId)?.value, amount);
        const descendants = descendantsByColumn(display.nodes, display.links, programId);
        assert.equal(descendants.get('program-spending')?.[0].value, amount);
        assert.ok(descendants.get('recipient')?.length);
        for (const selectedId of [programId, spendingId]) {
          const focused = focusGraph(display.nodes, display.links, selectedId);
          assert.equal(focused.nodes.find(n => n.id === programId)?.value, 0);
          assert.equal(focused.nodes.find(n => n.id === spendingId)?.value, amount);
          assert.ok(focused.nodes.some(n => n.details.column === 'recipient'));
        }
        for (const patch of [{ ministries: ['厚生労働省'] }, { accountTypes: ['special'] as const }, { budgetMin: '1' }]) {
          const excluded = applyFilter(base, { ...UNIFIED_FILTER_DEFAULT, ...patch } as typeof UNIFIED_FILTER_DEFAULT);
          assert.ok(!excluded.nodes.some(n => n.id === programId || n.id === spendingId));
        }
      }
    });
  }
}

test('孤立した0円の支出ノードもTopNの集約件数に含め、集約を選択できる', () => {
  const view: UnifiedViewGraph = { nodes: [1, 2, 3].flatMap(projectId => [
    { id: `p${projectId}`, name: `p${projectId}`, type: 'program', value: 100 / projectId,
      details: { column: 'program' as const, kind: 'rs' as const, projectId } },
    { id: `s${projectId}`, name: `p${projectId}`, type: 'program-spending', value: 0,
      details: { column: 'program-spending' as const, kind: 'rs' as const, projectId } },
  ]), links: [] };
  const display = applyTopN(view, { program: 1, 'program-spending': 1 }, {});
  const aggregate = display.nodes.find(n => n.details.column === 'program-spending' && n.details.aggregated);
  assert.ok(aggregate);
  assert.equal(aggregate.details.aggregatedCount, 2);
  assert.equal(aggregate.value, 0);
  assert.equal(focusGraph(display.nodes, display.links, aggregate.id).nodes.length, 1);
  assert.equal(display.links.length, 0);
});
