import assert from 'node:assert/strict';
import test from 'node:test';
import { apiDetail, directPayments, executionGraph, knownAmount } from '../scripts/rs-api-adapter';
import type { RsApiProject, RsApiGroup, RsApiEdge } from '../types/rs-api';
import { applyFilter, collapseColumns, toViewGraph } from '../app/lib/unified-budget/transform';
import { UNIFIED_FILTER_DEFAULT } from '../types/unified-budget-view';
import type { UnifiedGraph } from '../types/unified-budget';

const project: RsApiProject = { id: 'uuid', fiscal_year: 2026, project_number: '000014', name: '事業', ministry_name: 'デジタル庁',
  overview: '', purpose: '', last_implemented_fiscal_year: 2025, previous_year_execution_amount: 1200 };
const group = (id: string, amount: number | null): RsApiGroup => ({ id, project_id: 'uuid', display_code: id, name: id, overview: null, total_amount: amount,
  payments: [{ id: `pay-${id}`, name: '受託者', corporate_number: null, type: 'payee', is_others: false, total_contract_amount: amount,
    contracts: [{ overview: null, amount, amount_breakdown: [] }] }] });
const edge = (target: string, root: boolean, label: string | null = null): RsApiEdge => ({ target_node_id: target, source_node_id: root ? null : 'A', is_connected_to_source_root: root, label });

test('API yen stays yen; null, negative sentinels and hidden components are unknown', () => {
  assert.equal(knownAmount(2150767000), 2150767000);
  for (const v of [null, undefined, -1, NaN, Infinity]) assert.equal(knownAmount(v), null);
  assert.equal(knownAmount(100, 1), null);
  assert.equal(knownAmount(0), 0);
});
test('sheet year determines execution year; external review year does not change it', () => {
  const d = apiDetail({ ...project, last_implemented_fiscal_year: 2024 }, [group('A', 800)], [edge('A', true)]);
  assert.equal(d.fiscalYear, 2025);
  assert.equal(d.paymentStatus, 'available');
  assert.equal(executionGraph([d]).nodes.some(n => n.col === 'recipient'), true);
});
test('missing payment fetch is distinct from a successful empty response', () => {
  assert.equal(apiDetail(project).paymentStatus, 'missing');
  assert.equal(apiDetail(project, [], []).paymentStatus, 'available');
  const graph = executionGraph([apiDetail(project)]);
  assert.equal(graph.nodes.find(n => n.col === 'program')?.value, 1200);
  assert.equal(graph.nodes.some(n => n.col === 'program-spending'), false);
});
test('only explicit direct flows; subcontract, orphan, reference and contractor amounts are excluded', () => {
  const contractor = group('F', 9000); contractor.payments[0].type = 'contractor';
  const d = apiDetail(project, [group('A', 800), group('B', 300), group('C', 400), group('D', 500), group('E', null), contractor],
    [edge('A', true), edge('B', false), edge('D', true, '参考'), edge('E', true), edge('F', true)]);
  assert.deepEqual(directPayments(d).map(p => p.amount), [800, null]);
  const graph = executionGraph([d]);
  assert.equal(graph.nodes.find(n => n.col === 'program')?.value, 1200);
  assert.equal(graph.nodes.find(n => n.col === 'program-spending')?.value, 800);
  assert.equal(graph.nodes.find(n => n.col === 'recipient')?.value, 800);
});
test('unknown executions cannot masquerade as zero-valued graph facts', () => {
  const d = apiDetail({ ...project, previous_year_execution_amount: null }, [group('A', 800)], [edge('A', true)]);
  assert.equal(executionGraph([d]).nodes.length, 0);
});
test('expected recipients on a zero-execution sheet are not actual spending', () => {
  const d = apiDetail({ ...project, previous_year_execution_amount: 0 }, [group('A', 800)], [edge('A', true)]);
  assert.equal(executionGraph([d]).nodes.some(n => n.col === 'recipient'), false);
});
test('Other recipients are not merged across projects; repeated recipients are aggregated once', () => {
  const a = group('A', 100); a.payments[0].is_others = true;
  const d1 = apiDetail(project, [a], [edge('A', true)]);
  const d2 = apiDetail({ ...project, id: 'uuid2', project_number: '15' }, [a], [edge('A', true)]);
  assert.equal(executionGraph([d1, d2]).nodes.filter(n => n.col === 'recipient').length, 2);
  const d = apiDetail(project, [group('A', 100), group('B', 200)], [edge('A', true), edge('B', true)]);
  const g = executionGraph([d]);
  assert.equal(g.nodes.filter(n => n.col === 'recipient').length, 1);
  assert.equal(g.edges.filter(e => e.target.startsWith('recipient-')).length, 1);
});
test('existing UI transforms preserve execution even if reported recipient sum is larger', () => {
  const d = apiDetail(project, [group('A', 1300)], [edge('A', true)]);
  const g = executionGraph([d]) as UnifiedGraph;
  const view = collapseColumns(applyFilter(toViewGraph(g), UNIFIED_FILTER_DEFAULT), ['ministry', 'program', 'program-spending', 'recipient']);
  assert.equal(view.nodes.find(n => n.id === 'project-budget-14')?.value, 1200);
  assert.equal(view.nodes.find(n => n.id === 'project-spending-14')?.value, 1300);
});
