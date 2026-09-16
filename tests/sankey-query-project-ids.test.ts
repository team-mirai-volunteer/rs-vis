import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSankeyQuery, sankeyQueryToUrlParams, sankeyQueryFromUrlParams, hasActiveFilter } from '../app/lib/sankey-query';
import { applySankeyQueryToUnifiedFilter } from '../client/lib/unified-ai-filter';
import { UNIFIED_FILTER_DEFAULT } from '../types/unified-budget-view';

test('projectIds normalize node ids to pids, count as an active filter and round-trip through the URL', () => {
  const { query, errors } = resolveSankeyQuery({ year: '2025', filter: { projectIds: ['2826', 'project-budget-5297', ' project-spending-2826 ', 'abc'] } });
  assert.deepEqual(errors, []);
  assert.deepEqual(query.filter.projectIds, ['2826', '5297']);
  assert.equal(hasActiveFilter(query.filter), true);
  const params = sankeyQueryToUrlParams(query);
  assert.equal(params.get('fpid'), '2826,5297');
  assert.deepEqual(sankeyQueryFromUrlParams(params).filter?.projectIds, ['2826', '5297']);
  assert.equal(hasActiveFilter(resolveSankeyQuery({ year: '2025', filter: { projectIds: [] } }).query.filter), false);
});

test('AI-selected project ids map onto the unified filter and clear with the other AI fields', () => {
  const { query } = resolveSankeyQuery({ year: '2025', filter: { projectIds: ['2826', '5297'], budget: { min: 100e8 } } });
  const { filter, summary } = applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, query);
  assert.deepEqual(filter.projectIds, ['2826', '5297']);
  assert.match(summary, /AIが選んだ2事業/);
});
