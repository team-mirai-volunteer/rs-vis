import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { aggregateRevenueRows } from '../scripts/unified-budget-revenue';
import { applyFilter, applyTopN, collapseColumns, recomputeValues, toRsMinistryGraph, toViewGraph } from '../app/lib/unified-budget/transform';
import { UNIFIED_FILTER_DEFAULT, type UnifiedViewGraph, type UnifiedViewNode } from '../types/unified-budget-view';
import type { UnifiedGraph } from '../types/unified-budget';
import type { MOFBudgetOverview } from '../types/mof-budget-overview';
import { focusGraph } from '../app/lib/unified-budget/focus';

test('revenue CSV conversion separates pension transfers from insurance and preserves all receipts once', () => {
  const result = aggregateRevenueRows([
    { 特別会計: '年金', 款名: '保険収入', 目名: '保険料収入', 令和6年度予定額: '70' },
    { 特別会計: '年金', 款名: '保険収入', 目名: '一般会計より受入', 令和6年度予定額: '20' },
    { 特別会計: '年金', 款名: '他勘定より受入', 目名: '厚生年金勘定より受入', 令和6年度予定額: '10' },
  ], 'special', 'https://example.test/source.zip');
  assert.equal(result.nodes.find(n => n.revenueKind === 'insurance')?.value, 70_000);
  assert.equal(result.nodes.filter(n => n.revenueKind === 'internal-transfer').reduce((s, n) => s + n.value, 0), 30_000);
  assert.equal(result.edges.reduce((s, e) => s + e.value, 0), 100_000);
  assert.ok(result.edges.every(e => e.target === 'acct-sp-年金'));
});

test('general taxes remain separate and special-account receipts are removed from miscellaneous revenue', () => {
  const result = aggregateRevenueRows([
    { 款名: '租税', 目名: '所得税', 令和6年度予算額: '40' },
    { 款名: '租税', 目名: '消費税', 令和6年度予算額: '30' },
    { 款名: '諸収入', 目名: '雑入', 令和6年度予算額: '5' },
    { 款名: '諸収入', 目名: '外国為替資金特別会計受入金', 令和6年度予算額: '10' },
    { 款名: '公債金', 目名: '公債金', 令和6年度予算額: '15' },
  ], 'general', 'https://example.test/source.zip');
  assert.equal(result.nodes.find(n => n.name === '所得税')?.value, 40_000);
  assert.equal(result.nodes.find(n => n.name === '消費税')?.value, 30_000);
  assert.equal(result.nodes.find(n => n.name === '諸収入')?.value, 5_000);
  assert.equal(result.nodes.find(n => n.revenueKind === 'internal-transfer')?.value, 10_000);
  assert.equal(result.edges.reduce((s, e) => s + e.value, 0), 100_000);
});

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode =>
  ({ id, name: id, type: column, value, details: { column, ...details } });
function sample(): UnifiedViewGraph {
  return { nodes: [node('income', 'revenue', 150, { accountType: 'general' }), node('account', 'account', 100, { accountType: 'general' }),
    node('min', 'ministry', 100, { ministry: 'A' }), node('project', 'program', 100, { kind: 'rs', projectId: 1 })],
  links: [{ source: 'income', target: 'account', value: 150 }, { source: 'account', target: 'min', value: 100 }, { source: 'min', target: 'project', value: 100 }] };
}

test('excess revenue affects drawing thickness without overwriting spending or inventing tax-to-program links', () => {
  const source = sample();
  const view = applyTopN(collapseColumns(applyFilter(source, UNIFIED_FILTER_DEFAULT), ['revenue', 'program']), {}, {});
  assert.equal(view.nodes.find(n => n.id === 'account')?.value, 100);
  assert.equal(view.nodes.find(n => n.id === 'account')?.layoutValue, 150);
  assert.equal(view.nodes.find(n => n.id === 'project')?.value, 100);
  assert.deepEqual(view.links, [{ source: 'account', target: 'project', value: 100 }, { source: 'income', target: 'account', value: 150 }]);
  assert.equal(source.nodes.find(n => n.id === 'account')?.layoutValue, undefined);
  const focused = focusGraph(view.nodes, view.links, 'income');
  assert.equal(focused.nodes.find(n => n.id === 'account')?.value, 100);
});

test('hiding revenues preserves spending and empty filtered accounts do not leave orphan receipts', () => {
  const view = collapseColumns(sample(), ['account', 'ministry', 'program']);
  assert.ok(view.nodes.every(n => n.details.column !== 'revenue'));
  assert.equal(view.nodes.find(n => n.id === 'account')?.value, 100);
  const empty = recomputeValues({ nodes: sample().nodes.slice(0, 2), links: sample().links.slice(0, 1) });
  assert.deepEqual(empty, { nodes: [], links: [] });
  assert.ok(toRsMinistryGraph(sample()).nodes.every(n => n.details.column !== 'revenue'));
});

const readData = <T,>(name: string): T => JSON.parse(zlib.gunzipSync(fs.readFileSync(`public/data/${name}.json.gz`)).toString());
for (const year of [2023, 2024, 2025, 2026]) {
  test(`${year} published revenue agrees with the independently generated MOF overview`, () => {
    const graph = readData<UnifiedGraph>(`unified-budget-${year}-initial-graph`);
    const overview = readData<MOFBudgetOverview>(`mof-budget-overview-${year}`);
    const revenues = graph.nodes.filter(n => n.col === 'revenue');
    const sum = (type: 'general' | 'special') => revenues.filter(n => n.accountType === type).reduce((s, n) => s + n.value, 0);
    assert.equal(sum('general'), overview.generalAccount.revenue.total);
    assert.equal(sum('special'), overview.specialAccounts.revenue.total);
    for (const tax of overview.generalAccount.revenue.taxes) {
      assert.equal(revenues.find(n => n.accountType === 'general' && n.name === tax.name)?.value ?? 0, tax.amount);
    }
    assert.equal(revenues.filter(n => n.accountType === 'special' && n.revenueKind !== 'internal-transfer').reduce((s, n) => s + n.value, 0), overview.specialAccounts.revenue.own.total);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    for (const revenue of revenues) {
      const outgoing = graph.edges.filter(e => e.source === revenue.id);
      assert.equal(outgoing.length, 1);
      assert.equal(outgoing[0].value, revenue.value);
      assert.equal(byId.get(outgoing[0].target)?.col, 'account');
    }
    assert.equal(graph.metadata.revenueSources?.length, 2);
    assert.ok(graph.metadata.revenueSources?.every(s => /^[a-f0-9]{64}$/.test(s.sha256) && s.url.includes(`/${year}/csv/`)));
    const view = applyFilter(toViewGraph(graph), UNIFIED_FILTER_DEFAULT);
    assert.ok(view.nodes.some(n => n.details.column === 'revenue'));
    assert.ok(!view.nodes.some(n => n.details.column === 'revenue' && n.details.organization === '国債整理基金'));
  });
}
