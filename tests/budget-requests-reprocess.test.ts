import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reprocessBudgetRequests } from '../scripts/reprocess-budget-requests';
import { sourceDocument } from '../scripts/budget-requests-discover';
import { withSuccessfulFetch } from '../scripts/fetch-budget-requests';
import type { BudgetRequestDataset } from '../types/budget-requests';

test('offline replay uses verified original bytes and preserves acquisition/revision history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'budget-replay-'));
  const retrievedAt = '2026-10-08T18:00:00Z';
  const url = 'https://www.cao.go.jp/yosan/soshiki/r09/pdf/12.pdf';
  const bytes = await readFile('tests/fixtures/budget-requests/cao-r09-12.pdf');
  const doc = withSuccessfulFetch(sourceDocument(url, '政府広報室', '内閣府', 2027, retrievedAt, null, '一般会計', 'accounting_table'), { bytes, contentType: 'application/pdf', url }, retrievedAt);
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: retrievedAt, indexUrl: 'https://www.mof.go.jp/', documents: [doc], records: [], coverage: { ministries: 1, discoveredDocuments: 1, fetchedDocuments: 1, extractedDocuments: 0, records: 0, warnings: [] } };
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Offline replay must never request the network'); };
  try {
    await writeFile(join(directory, doc.hash!), bytes);
    const result = await reprocessBudgetRequests(data, directory);
    assert.equal(result.records.length, 37);
    assert.equal(result.documents[0].retrievedAt, retrievedAt);
    assert.deepEqual(result.documents[0].revisions, doc.revisions);
    assert.equal(result.records[0].provenance.retrievedAt, retrievedAt);
    assert.equal(result.records[0].amounts.request.valueYen, 7_884_742_000);
    assert.equal(data.records.length, 0);
  } finally { globalThis.fetch = fetch; await rm(directory, { recursive: true, force: true }); }
});
