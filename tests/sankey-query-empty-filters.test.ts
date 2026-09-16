import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSankeyQuery } from '../app/lib/sankey-query';

// Models that fill every schema field send empty arrays / empty strings. Those must mean "no filter",
// not "match nothing" (an empty accountCategories once filtered out every project).
test('empty accountCategories, empty name queries and null ranges resolve to no filter', () => {
  const { query, errors } = resolveSankeyQuery({
    year: '2025',
    filter: {
      projectName: { query: '再エネ', regex: false },
      recipientName: { query: '', regex: false, includeSubcontract: false },
      ministries: [], accountCategories: [],
      budget: { min: 100e8, max: null }, spending: { min: null, max: null },
      subcontract: { hasRedelegation: false, minDepth: null },
    },
  });
  assert.deepEqual(errors, []);
  assert.equal(query.filter.accountCategories.length, 4);
  assert.equal(query.filter.recipientName, null);
  assert.deepEqual(query.filter.ministries, []);
  assert.equal(query.filter.budget.min, 100e8);
});
