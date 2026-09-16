import test from 'node:test';
import assert from 'node:assert/strict';
import { applySankeyQueryToUnifiedFilter, clearAiFilter } from '../client/lib/unified-ai-filter';
import { UNIFIED_FILTER_DEFAULT } from '../types/unified-budget-view';
import type { ResolvedSankeyQuery } from '../types/sankey-query';

const query = (filter: Partial<ResolvedSankeyQuery['filter']>): ResolvedSankeyQuery => ({
  year: '2025',
  filter: { projectName: null, recipientName: null, ministries: [], budget: { min: null, max: null }, spending: { min: null, max: null },
    accountCategories: [], subcontract: { hasRedelegation: false, minDepth: null }, projectIds: [], ...filter },
  view: {} as ResolvedSankeyQuery['view'],
});

test('AI query maps to unified filter fields with 億-text amounts and a readable summary', () => {
  const current = { ...UNIFIED_FILTER_DEFAULT, nameQuery: '手動の条件', showNonRs: false };
  const { filter, summary } = applySankeyQueryToUnifiedFilter(current, query({
    projectName: { query: '再エネ|再生可能', regex: true }, ministries: ['環境省', '経済産業省'],
    budget: { min: 100e8, max: null }, recipientName: { query: 'NTT', includeSubcontract: true },
    subcontract: { hasRedelegation: true, minDepth: 3 }, accountCategories: ['general'],
  }));
  assert.equal(filter.projectQuery, '再エネ|再生可能'); assert.equal(filter.projectRegex, true);
  assert.deepEqual(filter.ministries, ['環境省', '経済産業省']);
  assert.equal(filter.budgetMin, '100億'); assert.equal(filter.budgetMax, '');
  assert.equal(filter.recipientQuery, 'NTT'); assert.equal(filter.recipientIncludeSub, true);
  assert.equal(filter.subcontract, 'has'); assert.equal(filter.subcontractMinDepth, 3);
  assert.deepEqual(filter.accountTypes, ['general']);
  // Manual, non-AI fields survive.
  assert.equal(filter.nameQuery, '手動の条件'); assert.equal(filter.showNonRs, false);
  assert.match(summary, /環境省・経済産業省/); assert.match(summary, /予算 100億〜/); assert.match(summary, /再々委託/);
});

test('fractional amounts, "both" accounts and clearing behave', () => {
  const { filter, summary } = applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, query({ budget: { min: 2.5e8, max: 1e12 }, accountCategories: ['general', 'both'] }));
  assert.equal(filter.budgetMin, '2.5億'); assert.equal(filter.budgetMax, '10000億');
  assert.deepEqual(filter.accountTypes, []);
  assert.match(summary, /予算 2.5億〜10000億/);
  const cleared = clearAiFilter({ ...filter, nameQuery: 'keep' });
  assert.equal(cleared.budgetMin, ''); assert.equal(cleared.nameQuery, 'keep');
  assert.equal(applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, query({})).summary, '条件なし');
});
