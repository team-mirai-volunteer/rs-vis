import assert from 'node:assert/strict';
import test from 'node:test';
import { rsApiToProjectDetail, rsApiToSubcontractGraph } from '../app/lib/unified-budget/rs-api-panel-adapter';
import { buildBlockTree } from '../app/lib/subcontracts/block-tree';
import type { RsApiDetail } from '../types/rs-api';

const payment = (id: string, name: string, amount: number | null) => ({
  id, name, corporate_number: null, is_others: false, type: 'corp', total_contract_amount: amount,
  contracts: [{ overview: `${name}の契約`, amount, amount_breakdown: [] }],
});

const detail: RsApiDetail = {
  id: 'x', projectId: 99999, name: 'テスト事業', ministry: 'テスト省', sourceUrl: 'https://rssystem.go.jp/x',
  fiscalYear: 2025, overview: '概要です', purpose: '目的です', execution: 1000, paymentStatus: 'available', fetchedAt: null,
  groups: [
    { id: 'g1', project_id: 'x', display_code: 'A', name: '元請', overview: '運用', total_amount: 800, payments: [payment('p1', '株式会社元請', 800)] },
    { id: 'g2', project_id: 'x', display_code: 'B', name: '下請', overview: null, total_amount: null, payments: [payment('p2', '株式会社下請', null)] },
  ],
  edges: [
    { source_node_id: null, target_node_id: 'g1', is_connected_to_source_root: true, label: null },
    { source_node_id: 'g1', target_node_id: 'g2', is_connected_to_source_root: false, label: '再委託' },
  ],
};

test('RS API blocks map to direct / subcontract blocks and nest in the block tree', () => {
  const graph = rsApiToSubcontractGraph(detail)!;
  assert.deepEqual(graph.blocks.map(b => [b.blockId, b.originKind]), [['A', 'direct'], ['B', 'subcontract']]);
  assert.equal(graph.maxDepth, 2);
  const tree = buildBlockTree(graph);
  assert.deepEqual(tree.map(n => [n.block.blockId, n.children.map(c => c.block.blockId)]), [['A', ['B']]]);
  assert.equal(graph.blocks[0].recipients[0].contractSummaries[0], '株式会社元請の契約');
});

test('unknown RS API amounts stay unknown (NaN), never zero', () => {
  const graph = rsApiToSubcontractGraph(detail)!;
  assert.ok(Number.isNaN(graph.blocks[1].totalAmount));
  assert.ok(Number.isNaN(graph.blocks[1].recipients[0].amount));
  assert.equal(graph.totalExpense, 800);
});

test('missing payments mean "not fetched" (null), not an empty block list', () => {
  assert.equal(rsApiToSubcontractGraph({ ...detail, paymentStatus: 'missing' }), null);
});

test('overview section gets purpose and overview from the RS API', () => {
  const d = rsApiToProjectDetail(detail);
  assert.equal(d.purpose, '目的です');
  assert.equal(d.overview, '概要です');
  assert.equal(d.url, 'https://rssystem.go.jp/x');
});
