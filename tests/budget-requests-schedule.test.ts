import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcquireBudgetRequests, WEEKLY_REFRESH, BACKLOG_CONTINUATION } from '../scripts/plan-budget-request-run';

const fingerprint = 'current-parser';
const checkpoint = { version: 1, year: 2027, depth: 2, fingerprint, complete: false, completedPages: [], completedFiles: [], dataset: { requestedFY: 2027, documents: [], records: [] } };
test('weekly and manual runs may start a new cycle; daily schedules only continue a valid unfinished cycle', () => {
  assert.equal(shouldAcquireBudgetRequests('schedule', WEEKLY_REFRESH, undefined, fingerprint), true);
  assert.equal(shouldAcquireBudgetRequests('workflow_dispatch', '', undefined, fingerprint), true);
  assert.equal(shouldAcquireBudgetRequests('schedule', BACKLOG_CONTINUATION, checkpoint, fingerprint), true);
  for (const invalid of [undefined, null, {}, { ...checkpoint, complete: true }, { ...checkpoint, year: 2026 }, { ...checkpoint, depth: 1 }, { ...checkpoint, fingerprint: 'old-parser' }, { ...checkpoint, dataset: undefined }, { ...checkpoint, completedFiles: undefined }]) {
    assert.equal(shouldAcquireBudgetRequests('schedule', BACKLOG_CONTINUATION, invalid, fingerprint), false);
  }
  assert.equal(shouldAcquireBudgetRequests('pull_request', BACKLOG_CONTINUATION, checkpoint, fingerprint), false);
  assert.equal(shouldAcquireBudgetRequests('schedule', 'unexpected', checkpoint, fingerprint), false);
});
