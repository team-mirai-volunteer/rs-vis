import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { acquireDocument, ingestBudgetRequests, semanticSnapshot, type SourceFetcher } from '../scripts/fetch-budget-requests';
import { sourceDocument } from '../scripts/budget-requests-discover';
import type { BudgetRequestDataset } from '../types/budget-requests';

const NOW = '2026-10-09T23:59:59.000Z';
const NEXT = '2026-10-10T00:00:01.000Z';
const INDEX = 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2027/index.html';
const ROOT = 'https://www.cao.go.jp/requests.html';
const file = (n: number) => `https://www.cao.go.jp/request-${n}.csv`;
function fixture(count = 3, nested = false) {
  const sources = new Map<string, string>([
    [INDEX, '<html><a href="overview.html">概算要求の概要等</a><a href="general.html">一般会計</a><a href="special.html">特別会計</a></html>'],
    [new URL('overview.html', INDEX).href, '<html></html>'],
    [new URL('general.html', INDEX).href, `<table><tr><td>内閣府</td><td><a href="${ROOT}">一般会計概算要求書</a></td></tr></table>`],
    [new URL('special.html', INDEX).href, '<html></html>'],
    [ROOT, `<html><h1>令和9年度概算要求書</h1>${nested ? '<a href="nested.html">概算要求書一覧</a>' : Array.from({ length: count }, (_, i) => `<a href="${file(i)}">要求書 ${i}</a>`).join('')}</html>`],
  ]);
  if (nested) sources.set('https://www.cao.go.jp/nested.html', `<html><h1>令和9年度概算要求書</h1>${Array.from({ length: count }, (_, i) => `<a href="${file(i)}">要求書 ${i}</a>`).join('')}</html>`);
  for (let i = 0; i < count; i++) sources.set(file(i), `事業名,要求年度,概算要求額(千円)\n事業${i},2027,${i + 1}\n`);
  const calls: string[] = [];
  const fetcher: SourceFetcher = async url => {
    calls.push(url);
    const text = sources.get(url);
    if (!text) throw new Error('HTTP 404');
    return { bytes: Buffer.from(text), contentType: url.endsWith('.csv') ? 'text/csv' : 'text/html', url };
  };
  return { sources, calls, fetcher };
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'budget-ingestion-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { cacheDir: join(dir, 'sources'), output: join(dir, 'requests.json.gz'), year: 2027, maxPages: 10, maxFiles: 10, depth: 2, concurrency: 3, now: NOW };
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) frozen(child); }
  return value;
}

test('identical official bytes preserve exact gzip, all provenance timestamps and immutable input across days', async t => {
  const options = await setup(t); const server = fixture();
  const first = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  const before = gzipSync(JSON.stringify(first), { level: 1 });
  before.writeUInt32LE(1_700_000_000, 4); // Preserve pre-existing gzip metadata/compression too.
  await writeFile(options.output, before);
  const original = structuredClone(first);
  frozen(first);
  const second = await ingestBudgetRequests({ ...options, now: NEXT, previous: first, fetcher: server.fetcher });
  assert.deepEqual(second, original);
  assert.deepEqual(await readFile(options.output), before);
  assert.deepEqual(first, original);
  assert.equal(second.generatedAt, NOW);
  assert.ok(second.documents.every(doc => doc.retrievedAt === NOW && doc.lastAttemptAt === NOW));
  assert.ok(second.records.every(record => record.provenance.retrievedAt === NOW));
  const report = JSON.parse(await readFile(join(options.cacheDir, 'last-run-2027.json'), 'utf8'));
  assert.equal(report.startedAt, NEXT); assert.equal(report.complete, true);
  assert.ok(report.attempts.every((attempt: { checkedAt: string }) => attempt.checkedAt === NEXT));
  assert.equal(report.attempts.length, server.sources.size);
});

test('semantic comparison ignores asynchronous array order and timestamps but not changed amounts', async t => {
  const options = await setup(t); const server = fixture();
  const first = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  const reordered = structuredClone(first);
  reordered.documents.reverse(); reordered.records.reverse(); reordered.generatedAt = NEXT;
  reordered.records[0].provenance.retrievedAt = NEXT;
  assert.equal(semanticSnapshot(first), semanticSnapshot(reordered));
  reordered.records[0].amounts.request.valueYen = 99_000;
  assert.notEqual(semanticSnapshot(first), semanticSnapshot(reordered));
});

test('changed source replaces hash and records while unchanged source provenance stays stable', async t => {
  const options = await setup(t); const server = fixture();
  const first = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  server.sources.set(file(1), '事業名,要求年度,概算要求額(千円)\n変更後,2027,99\n');
  const second = await ingestBudgetRequests({ ...options, now: NEXT, previous: first, fetcher: server.fetcher });
  assert.equal(second.generatedAt, NEXT);
  assert.equal(second.records.find(record => record.provenance.url === file(1))!.amounts.request.valueYen, 99_000);
  assert.equal(second.documents.find(doc => doc.url === file(1))!.revision, 2);
  assert.equal(second.records.find(record => record.provenance.url === file(1))!.provenance.retrievedAt, NEXT);
  assert.equal(second.records.find(record => record.provenance.url === file(0))!.provenance.retrievedAt, NOW);
  const third = await ingestBudgetRequests({ ...options, now: '2026-10-11T00:00:00.000Z', previous: second, fetcher: server.fetcher });
  assert.deepEqual(third, second);
});

test('bounded resumes cross UTC days, skip completed extraction, and progress with only cached checkpoint state', async t => {
  const options = await setup(t); const server = fixture();
  const first = await ingestBudgetRequests({ ...options, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(first.records.length, 1);
  const second = await ingestBudgetRequests({ ...options, now: NEXT, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(second.records.length, 2);
  const third = await ingestBudgetRequests({ ...options, now: '2026-10-11T00:00:00.000Z', maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(third.records.length, 3);
  assert.equal(server.calls.length, server.sources.size);
  assert.ok([...server.sources.keys()].every(url => server.calls.filter(called => called === url).length === 1));
  assert.ok(third.documents.every(doc => !doc.validation.some(note => /今回未取得|再発見/.test(note))));
  const checkpoint = JSON.parse(gunzipSync(await readFile(join(options.cacheDir, 'checkpoint-2027.json.gz'))).toString());
  assert.equal(checkpoint.complete, true);
  assert.equal(checkpoint.startedAt, NOW);
  assert.equal(checkpoint.completedFiles.length, 3);
  const fourth = await ingestBudgetRequests({ ...options, now: '2026-10-12T00:00:00.000Z', maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(fourth.records.length, 3); // Latest completed cache remains a fallback when publication was interrupted.
  assert.equal(server.calls.filter(url => url === INDEX).length, 2); // Complete cycles revalidate, not cache forever.
});

test('page caps advance across resumed discovery without consuming limits on cached replay', async t => {
  const options = await setup(t); const server = fixture(1, true);
  const first = await ingestBudgetRequests({ ...options, maxPages: 1, resume: true, fetcher: server.fetcher });
  assert.equal(first.records.length, 0);
  const second = await ingestBudgetRequests({ ...options, now: NEXT, maxPages: 1, resume: true, fetcher: server.fetcher });
  assert.equal(second.records.length, 1);
  assert.equal(server.calls.filter(url => url === ROOT).length, 1);
  assert.equal(server.calls.filter(url => url.endsWith('nested.html')).length, 1);
});

test('missing raw cache is refetched safely and resumes still advance', async t => {
  const options = await setup(t); const server = fixture(2);
  const first = await ingestBudgetRequests({ ...options, maxFiles: 1, resume: true, fetcher: server.fetcher });
  const root = first.documents.find(doc => doc.url === ROOT)!;
  await writeFile(join(options.cacheDir, root.hash!), 'corrupt');
  const second = await ingestBudgetRequests({ ...options, now: NEXT, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(second.records.length, 2);
  assert.equal(server.calls.filter(url => url === ROOT).length, 2);
});

test('transient notes neither mutate prior objects nor accumulate, and clear after recovery', async t => {
  const options = await setup(t); const server = fixture(1);
  let previous = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  const orphan = sourceDocument('https://www.cao.go.jp/gone.csv', '要求書', '内閣府', 2027, NOW, ROOT, '一般会計', 'accounting_table');
  previous.documents.push(orphan);
  for (let i = 0; i < 3; i++) {
    const before = structuredClone(previous); frozen(previous);
    const next = await ingestBudgetRequests({ ...options, now: NEXT, maxFiles: 0, previous, fetcher: server.fetcher });
    assert.deepEqual(previous, before);
    assert.equal(next.documents.find(doc => doc.url === orphan.url)!.validation.filter(note => /再発見/.test(note)).length, 1);
    assert.equal(next.documents.find(doc => doc.url === file(0))!.validation.filter(note => /取得件数上限/.test(note)).length, 0);
    const report = JSON.parse(await readFile(join(options.cacheDir, 'last-run-2027.json'), 'utf8'));
    assert.equal(report.deferredSources.filter((item: { url: string }) => item.url === file(0)).length, 1);
    previous = next;
  }
  const recovered = await ingestBudgetRequests({ ...options, now: NEXT, previous, fetcher: server.fetcher });
  assert.ok(!recovered.documents.find(doc => doc.url === file(0))!.validation.some(note => /取得件数上限/.test(note)));
});

test('failed sources do not starve later files across bounded resumes and retry in a new cycle', async t => {
  const options = await setup(t); const server = fixture(2);
  server.sources.delete(file(0));
  const first = await ingestBudgetRequests({ ...options, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(first.documents.find(doc => doc.url === file(0))!.status, 'fetch_failed');
  const second = await ingestBudgetRequests({ ...options, maxFiles: 1, now: NEXT, resume: true, fetcher: server.fetcher });
  assert.equal(second.records.length, 1);
  assert.equal(server.calls.filter(url => url === file(0)).length, 1);
  await ingestBudgetRequests({ ...options, maxFiles: 1, now: NEXT, resume: true, fetcher: server.fetcher });
  assert.equal(server.calls.filter(url => url === file(0)).length, 2);
});

test('a failed landing page retains failure while verified cached current links still advance', async t => {
  const options = await setup(t); const server = fixture(2);
  const first = await ingestBudgetRequests({ ...options, maxFiles: 0, fetcher: server.fetcher });
  server.sources.delete(ROOT);
  const second = await ingestBudgetRequests({ ...options, now: NEXT, previous: first, fetcher: server.fetcher });
  assert.equal(second.records.length, 2);
  const root = second.documents.find(doc => doc.url === ROOT)!;
  assert.equal(root.status, 'fetch_failed');
  assert.equal(root.retrievedAt, NOW);
  assert.ok(root.validation.some(note => note.includes('保存済みHTML')));
  assert.ok(second.records.every(record => record.provenance.retrievedAt === NEXT));
});

test('one invocation timestamp is shared even when fetches finish at different times', async t => {
  const options = await setup(t); const server = fixture(1);
  const result = await ingestBudgetRequests({ ...options, now: undefined, fetcher: async url => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return server.fetcher(url);
  } });
  assert.ok(result.documents.every(doc => doc.retrievedAt === result.generatedAt && doc.lastAttemptAt === result.generatedAt));
  assert.ok(result.records.every(record => record.provenance.retrievedAt === result.generatedAt));
});

test('historical and archived previous sources cannot be restored when current index fails', async t => {
  const options = await setup(t); const server = fixture(1);
  const previous = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  const oldUrls = ['https://warp.ndl.go.jp/info:ndljp/pid/1/www.cao.go.jp/x.csv', 'https://www.cao.go.jp/fy2026/request.csv'];
  for (const url of oldUrls) {
    const doc = sourceDocument(url, '過年度要求書', '内閣府', 2027, NOW, ROOT, null, 'accounting_table');
    previous.documents.push(doc);
    previous.records.push({ ...structuredClone(previous.records[0]), id: doc.id, documentId: doc.id });
  }
  const result = await ingestBudgetRequests({ ...options, now: NEXT, previous, fetcher: async () => { throw new Error('HTTP 404'); } });
  assert.ok(result.documents.every(doc => !oldUrls.includes(doc.url)));
  assert.equal(result.records.length, 1);
});

test('an official-domain redirect to a conflicting fiscal year fails acquisition', async () => {
  const doc = sourceDocument(file(0), '要求書', '内閣府', 2027, NOW, ROOT, null, 'accounting_table');
  const result = await acquireDocument(doc, async () => ({ bytes: Buffer.from('past year'), contentType: 'text/csv', url: 'https://www.cao.go.jp/fy2026/request.csv' }), NEXT, 0);
  assert.equal(result.source, null); assert.equal(result.doc.status, 'fetch_failed');
  assert.match(result.doc.error!, /要求年度/);
});

test('cached HTML replay preserves accounting-table discovery context for unlabeled files', async t => {
  const options = await setup(t); const server = fixture(2);
  server.sources.set(ROOT, `<html><h1>令和9年度</h1><a href="${file(0)}">CSV</a><a href="${file(1)}">CSV</a></html>`);
  const first = await ingestBudgetRequests({ ...options, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(first.records.length, 1);
  const second = await ingestBudgetRequests({ ...options, now: NEXT, maxFiles: 1, resume: true, fetcher: server.fetcher });
  assert.equal(second.records.length, 2);
  assert.ok(second.documents.every(doc => !doc.validation.some(note => /再発見|自動検出できません/.test(note))));
});

test('repeated identical acquisition failures preserve gzip while run reports retain failure freshness', async t => {
  const options = await setup(t); const server = fixture(1);
  const first = await ingestBudgetRequests({ ...options, fetcher: server.fetcher });
  server.sources.delete(file(0));
  const failed = await ingestBudgetRequests({ ...options, now: NEXT, previous: first, fetcher: server.fetcher });
  const before = await readFile(options.output);
  const again = await ingestBudgetRequests({ ...options, now: '2026-10-11T00:00:00.000Z', previous: failed, fetcher: server.fetcher });
  assert.deepEqual(again, failed); assert.deepEqual(await readFile(options.output), before);
  assert.equal(again.records.length, 1);
  assert.equal(again.documents.find(doc => doc.url === file(0))!.validation.filter(note => /最終成功/.test(note)).length, 1);
  const report = JSON.parse(await readFile(join(options.cacheDir, 'last-run-2027.json'), 'utf8'));
  assert.equal(report.attempts.find((attempt: { url: string }) => attempt.url === file(0)).checkedAt, '2026-10-11T00:00:00.000Z');
});

test('bounded unchanged refresh cycles do not change gzip for per-run file or page caps', async t => {
  const options = await setup(t); const server = fixture(3, true);
  const first = await ingestBudgetRequests({ ...options, resume: true, fetcher: server.fetcher });
  const before = await readFile(options.output);
  let previous: BudgetRequestDataset = first;
  for (let i = 0; i < 4; i++) {
    previous = await ingestBudgetRequests({ ...options, now: `2026-10-${10 + i}T00:00:00.000Z`, maxPages: 1, maxFiles: 1, resume: true, previous, fetcher: server.fetcher });
    assert.deepEqual(previous, first);
    assert.deepEqual(await readFile(options.output), before);
  }
  const report = JSON.parse(await readFile(join(options.cacheDir, 'last-run-2027.json'), 'utf8'));
  assert.equal(report.complete, true);
});

test('new discovered sources and genuine missing links remain semantic changes during bounded refresh', async t => {
  const options = await setup(t); const server = fixture(1);
  const first = await ingestBudgetRequests({ ...options, resume: true, fetcher: server.fetcher });
  server.sources.set(ROOT, '<html><h1>令和9年度概算要求書</h1><a href="new.csv">新しい要求書</a></html>');
  const next = await ingestBudgetRequests({ ...options, now: NEXT, maxFiles: 0, resume: true, previous: first, fetcher: server.fetcher });
  assert.equal(next.generatedAt, NEXT);
  assert.equal(next.documents.find(doc => doc.url.endsWith('/new.csv'))!.status, 'discovered');
  assert.ok(next.documents.find(doc => doc.url === file(0))!.validation.some(note => /再発見/.test(note)));
});
