import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceDocument, sha256 } from '../scripts/budget-requests-discover';
import { currentCycleSnapshot } from '../scripts/budget-requests-scope';
import type { BudgetRequestDataset } from '../types/budget-requests';

test('cached parent sections remove historical edges and descendants without treating absent links as removed', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'request-scope-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const now = '2026-10-09T00:00:00.000Z';
  const root = sourceDocument('https://www.maff.go.jp/budget/index.html', '予算', '農林水産省', 2027, now, null, null, 'index');
  const html = '<h1>予算</h1><h2>令和9年度概算要求</h2><h3>非公共事業</h3><a href="current.pdf">要求書</a><h2>令和8年度概算要求</h2><h3>非公共事業</h3><a href="old.html">要求書</a>';
  root.hash = sha256(html); root.contentType = 'text/html'; await writeFile(join(cacheDir, root.hash), html);
  const current = sourceDocument('https://www.maff.go.jp/budget/current.pdf', '要求書', root.ministry, 2027, now, root.url, null, 'accounting_table');
  const old = sourceDocument('https://www.maff.go.jp/budget/old.html', '要求書', root.ministry, 2027, now, root.url, null, 'index');
  const descendant = sourceDocument('https://www.maff.go.jp/budget/detail.pdf', '明細', root.ministry, 2027, now, old.url, null, 'accounting_table');
  const absent = sourceDocument('https://www.maff.go.jp/budget/gone.pdf', '要求書', root.ministry, 2027, now, root.url, null, 'accounting_table');
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: now, indexUrl: root.url, documents: [root, current, old, descendant, absent], records: [], coverage: { ministries: 1, discoveredDocuments: 5, fetchedDocuments: 1, extractedDocuments: 0, records: 0, warnings: [] } };
  const before = structuredClone(data);
  const scoped = await currentCycleSnapshot(data, cacheDir);
  assert.deepEqual(scoped.dataset.documents.map(doc => doc.id), [root.id, current.id, absent.id]);
  assert.deepEqual(new Set(scoped.excluded), new Set([old.id, descendant.id]));
  assert.deepEqual(data, before);
});

test('missing cached HTML is not evidence to exclude its current-cycle children', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'request-scope-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const doc = sourceDocument('https://www.maff.go.jp/j/budget/pdf/r9yokyu.pdf', '令和9年度概算要求', '農林水産省', 2027, '2026-10-09T00:00:00.000Z', 'https://www.maff.go.jp/index.html', null, 'overview');
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: doc.lastAttemptAt, indexUrl: doc.parentUrl!, documents: [doc], records: [], coverage: { ministries: 1, discoveredDocuments: 1, fetchedDocuments: 0, extractedDocuments: 0, records: 0, warnings: [] } };
  const scoped = await currentCycleSnapshot(data, cacheDir);
  assert.deepEqual(scoped.dataset, data); assert.equal(scoped.excluded.length, 0);
});

test('an authoritative MOF root is not removed because it also appears in an excluded ministry footer', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'request-scope-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const now = '2026-10-09T00:00:00.000Z';
  const root = sourceDocument('https://www.maff.go.jp/j/budget/r9yokyu.html', '農林水産省 概算要求の概要等', '農林水産省', 2027, now, 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2027/overview.html', null, 'index');
  const other = sourceDocument('https://www.maff.go.jp/other.html', '予算', root.ministry, 2027, now, root.url, null, 'index');
  const html = `<main><h1>予算</h1></main><footer><a href="${root.url}">概算要求</a></footer>`;
  other.hash = sha256(html); other.contentType = 'text/html'; await writeFile(join(cacheDir, other.hash), html);
  const data: BudgetRequestDataset = { schemaVersion: 1, requestedFY: 2027, generatedAt: now, indexUrl: root.parentUrl!, documents: [root, other], records: [], coverage: { ministries: 1, discoveredDocuments: 2, fetchedDocuments: 1, extractedDocuments: 0, records: 0, warnings: [] } };
  const scoped = await currentCycleSnapshot(data, cacheDir);
  assert.deepEqual(scoped.dataset.documents.map(doc => doc.id), [root.id, other.id]);
});
