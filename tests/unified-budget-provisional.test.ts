import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { withProvisionalSpending } from '../app/lib/unified-budget/provisional';
import { applyFilter, toViewGraph } from '../app/lib/unified-budget/transform';
import { UNIFIED_FILTER_DEFAULT } from '../types/unified-budget-view';
import type { UnifiedGraph } from '../types/unified-budget';

const read = (name: string): UnifiedGraph => JSON.parse(gunzipSync(fs.readFileSync(`public/data/${name}.json.gz`)).toString());
const execution = read('unified-budget-2025-execution-graph');
for (const basis of ['initial', 'supplementary']) test(`${basis}: provisional view preserves every MOF node, edge and budget amount`, () => {
  const budget = read(`unified-budget-2025-${basis}-graph`);
  const before = JSON.stringify(budget);
  const merged = withProvisionalSpending(budget, execution);
  assert.equal(JSON.stringify(budget), before);
  assert.deepEqual(merged.edges.slice(0, budget.edges.length), budget.edges);
  assert.deepEqual(merged.metadata.totals, budget.metadata.totals);
  assert.equal(merged.metadata.basis, basis);
  const byId = new Map(merged.nodes.map(n => [n.id, n]));
  for (const n of budget.nodes) {
    assert.equal(byId.get(n.id)?.value, n.value);
    if (n.col !== 'program') assert.deepEqual(byId.get(n.id), n);
  }
  assert.equal(byId.get('project-spending-14')?.value, 2150768000);
  assert.equal(byId.get('project-budget-14')?.budgetUnmatched, true);
  assert.equal(merged.edges.some(e => e.target === 'project-budget-14'), false);
  const view = applyFilter(toViewGraph(merged), UNIFIED_FILTER_DEFAULT);
  assert.equal(view.nodes.find(n => n.id === 'project-budget-14')?.details.budgetUnmatched, true);
  assert.equal(view.nodes.find(n => n.id === 'project-spending-14')?.value, 2150768000);
  const filtered = applyFilter(toViewGraph(merged), { ...UNIFIED_FILTER_DEFAULT, budgetMax: '100億' });
  assert.equal(filtered.nodes.some(n => n.id === 'project-budget-14'), false);
});
test('provisional data cannot attach to a different budget year', () => {
  const budget = read('unified-budget-2024-initial-graph');
  assert.throws(() => withProvisionalSpending(budget, execution), /年度/);
});
