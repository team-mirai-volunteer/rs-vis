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

test('unchanged offline replay preserves the entire snapshot and removes obsolete source URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'budget-replay-stable-'));
  const now = '2026-10-08T18:00:00Z';
  const url = 'https://www.cao.go.jp/yosan/soshiki/r09/pdf/12.pdf';
  const bytes = await readFile('tests/fixtures/budget-requests/cao-r09-12.pdf');
  const doc = withSuccessfulFetch(sourceDocument(url, '政府広報室', '内閣府', 2027, now, null, '一般会計', 'accounting_table'), { bytes, contentType: 'application/pdf', url }, now);
  const stale = [sourceDocument('https://warp.ndl.go.jp/collections/content/info:ndljp/pid/123/https://www.cao.go.jp/', '旧資料', '旧省', 2027, now, null, null, 'index'), sourceDocument('https://www.meti.go.jp/main/yosangaisan/fy2021/index.html', '旧資料', '旧省', 2027, now, null, null, 'index')];
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: now, indexUrl: 'https://www.mof.go.jp/', documents: [doc, ...stale], records: [], coverage: { ministries: 2, discoveredDocuments: 3, fetchedDocuments: 1, extractedDocuments: 0, records: 0, warnings: [] } };
  try {
    await writeFile(join(directory, doc.hash!), bytes);
    const first = await reprocessBudgetRequests(data, directory);
    assert.equal(first.documents.length, 1);
    assert.equal(first.coverage.ministries, 1);
    const second = await reprocessBudgetRequests(first, directory);
    assert.deepEqual(second, first);
    assert.notEqual(second, first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('confirmed table-year mismatch invalidates previous rows while successful replay clears old failure notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'budget-replay-validation-'));
  const now = '2026-10-08T18:00:00Z';
  const url = 'https://www.cao.go.jp/request.pdf';
  const bytes = await readFile('tests/fixtures/budget-requests/cao-r09-12.pdf');
  const doc = withSuccessfulFetch(sourceDocument(url, '政府広報室', '内閣府', 2027, now, null, '一般会計', 'accounting_table'), { bytes, contentType: 'application/pdf', url }, now);
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: now, indexUrl: 'https://www.mof.go.jp/', documents: [doc], records: [], coverage: { ministries: 1, discoveredDocuments: 1, fetchedDocuments: 1, extractedDocuments: 0, records: 0, warnings: [] } };
  try {
    await writeFile(join(directory, doc.hash!), bytes);
    const successful = await reprocessBudgetRequests(data, directory);
    successful.documents[0].validation.push('再抽出できません: transient failure', '最終成功時の明細を保持しました');
    const recovered = await reprocessBudgetRequests(successful, directory);
    assert.ok(!recovered.documents[0].validation.some(note => /再抽出できません|最終成功時の明細を保持/.test(note)));
    recovered.requestedFY = 2028;
    recovered.documents[0].requestedFY = 2028;
    for (const record of recovered.records) record.requestedFY = 2028;
    const rejected = await reprocessBudgetRequests(recovered, directory);
    assert.equal(rejected.records.length, 0);
    assert.equal(rejected.documents[0].recordCount, 0);
    assert.equal(rejected.documents[0].status, 'extraction_failed');
    assert.match(rejected.documents[0].validation.join(' '), /要求年度不一致/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
