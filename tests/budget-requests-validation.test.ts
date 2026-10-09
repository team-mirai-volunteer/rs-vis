import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBudgetRequests } from '../scripts/validate-budget-requests';
import { requestDataset } from './fixtures/budget-requests-ui';
import { createHash } from 'node:crypto';

function validDataset() {
  const data = requestDataset();
  for (const doc of data.documents) {
    doc.hash = createHash('sha256').update(doc.id).digest('hex');
    doc.revision = 1; doc.revisions = [{ hash: doc.hash, revision: 1, retrievedAt: doc.retrievedAt! }];
    doc.recordCount = data.records.filter(r => r.documentId === doc.id).length;
  }
  for (const record of data.records) {
    const doc = data.documents.find(d => d.id === record.documentId)!;
    record.provenance.hash = doc.hash!; record.provenance.url = doc.url;
  }
  data.coverage.discoveredDocuments = data.documents.length; data.coverage.records = data.records.length;
  return data;
}
test('validates source hashes, source amounts, and coverage together', () => { assert.deepEqual(validateBudgetRequests(validDataset()), []); });
test('blocks stale values tied to an amended source and blank-to-zero coercion', () => {
  const data = validDataset();
  data.records[0].provenance.hash = 'oldhash'; data.records[0].amounts.request = { valueYen: 0, status: 'blank', raw: '' };
  const errors = validateBudgetRequests(data);
  assert.ok(errors.some(e => e.includes('digest mismatch'))); assert.ok(errors.some(e => e.includes('status/value mismatch')));
});
test('blocks fabricated exact linkage and mismatched fiscal year', () => {
  const data = validDataset(); data.records[0].requestedFY = 2026;
  data.records[0].rsLink = { status: 'exact', projectIds: [], sheetFY: null, evidence: null };
  const errors = validateBudgetRequests(data);
  assert.ok(errors.some(e => e.includes('fiscal year'))); assert.ok(errors.some(e => e.includes('exact RS')));
});
