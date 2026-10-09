import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverCatalogues, discoverMinistries, discoverChildren, officialUrl, sourceDocument, fiscalYears, isCurrentRequestSource } from '../scripts/budget-requests-discover';
import { acquireDocument, withSuccessfulFetch } from '../scripts/fetch-budget-requests';

const NOW = '2026-10-08T18:00:00Z';
const BASE = 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2027/index.html';
const fixture = (name: string) => readFileSync(`tests/fixtures/budget-requests-discovery/${name}`, 'utf8');
const makeDoc = () => sourceDocument('https://www.cao.go.jp/yosan/soshiki/r09/pdf/12.pdf', '政府広報室', '内閣府', 2027, NOW, BASE, '一般会計', 'accounting_table');

test('discovers all three real MOF catalogues, including whitespace-bearing hrefs', () => {
  const links = discoverCatalogues(fixture('mof-index.html'), BASE);
  assert.deepEqual(links.map(l => l.text), ['概算要求の概要等', '一般会計', '特別会計']);
  assert.equal(links[1].url, 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy2027/20260904185021.html');
  assert.deepEqual(discoverCatalogues('<a href="../fy2026/old.html">一般会計</a>', BASE), []);
});
test('official URL policy rejects arbitrary hosts, userinfo, ports, scripts and suffix tricks', () => {
  for (const bad of ['https://mof.go.jp.evil.example/x', 'http://127.0.0.1/', 'https://user@www.mof.go.jp/', 'https://www.mof.go.jp:444/', 'javascript:alert(1)', 'data:text/html,x', 'https://warp.ndl.go.jp/web/20230412203351/https://www.ndl.go.jp/jp/aboutus/outline/finances.html', 'https://warp.ndl.go.jp/info:ndljp/pid/11575230/www.cas.go.jp/archive.html', 'https://sub.warp.ndl.go.jp/2027.pdf']) assert.equal(officialUrl(bad), null);
  assert.equal(officialUrl('../a.pdf#page=1', BASE), 'https://www.mof.go.jp/policy/budget/budger_workflow/budget/a.pdf');
});
test('explicit fiscal-year URL provenance cannot be overridden by a current-year label', () => {
  const parent = { ...makeDoc(), url: 'https://www.cao.go.jp/requests.html' };
  const html = '<h1>令和9年度</h1><a href="/yosan/soshiki/r08/old.csv">令和9年度要求書</a><a href="/budget/fy2026/old.pdf">要求書</a><a href="/yosan/soshiki/r09/new.csv">要求書</a><a href="/20260901/current.pdf">要求書</a>';
  assert.deepEqual(discoverChildren(html, parent, NOW).map(doc => doc.url), ['https://www.cao.go.jp/yosan/soshiki/r09/new.csv', 'https://www.cao.go.jp/20260901/current.pdf']);
  assert.equal(isCurrentRequestSource('https://www.mod.go.jp/j/budget/gaisan/r5/gaisanyoukyu.pdf', 2027), false);
  assert.equal(isCurrentRequestSource('https://www.cao.go.jp/20260901/current.pdf', 2027), true, 'publication year is not fiscal year');
  assert.equal(discoverChildren('<a href="new.pdf">要求書</a>', { ...parent, url: 'https://www.cao.go.jp/budget/fy2026/index.html' }, NOW).length, 0);
});
test('national catalogues do not import stale fiscal-year landing pages or archived snapshots', () => {
  const catalogue = discoverCatalogues(fixture('mof-index.html'), BASE)[1];
  const html = '<table><tr><td>経済産業省</td><td><a href="https://www.meti.go.jp/main/yosangaisan/fy2021/index.html">令和9年度</a></td></tr><tr><td>国立国会図書館</td><td><a href="https://warp.ndl.go.jp/web/2023/https://www.ndl.go.jp/a.html">歳出予算</a></td></tr></table>';
  assert.deepEqual(discoverMinistries(html, catalogue, 2027, NOW), []);
});
test('special-account names never become ministries, and no unobserved URL is synthesized', () => {
  const catalogue = discoverCatalogues(fixture('mof-index.html'), BASE)[2];
  const known = [sourceDocument('https://www.mof.go.jp/about_mof/mof_budget/budget/fy2027/20260911.html', '財務省', '財務省', 2027, NOW, BASE, '一般会計', 'accounting_table')];
  const docs = discoverMinistries(fixture('mof-special.html'), catalogue, 2027, NOW, known);
  assert.ok(docs.some(d => d.ministry === '財務省' && d.account === '特別会計（地震再保険）'));
  assert.equal(docs.some(d => d.ministry === '国債整理基金'), false);
  assert.equal(docs.filter(d => d.ministry === '財務省').length, 1);
  assert.ok(docs.every(d => d.parentUrl === catalogue.url));
});
test('fiscal-year detection normalizes fullwidth and era labels', () => {
  assert.deepEqual(fiscalYears('令和９年度／2027年度／平成元年度'), [2027, 1989]);
});
test('child discovery retains source row labels and isolates prior years, navigation and revenue', () => {
  const doc = { ...makeDoc(), url: 'https://www.cao.go.jp/yosan/r09.html' };
  const html = '<main><h1>令和９年度歳出概算要求書</h1><table><tr><td>政府広報室</td><td><a href="pdf/12.pdf">PDF</a></td></tr></table><h2>令和８年度</h2><a href="old.pdf">概算要求書</a><h2>令和９年度一般会計</h2><a href="revenue.pdf">歳入</a><a href="/index.html">トップ</a></main>';
  const docs = discoverChildren(html, doc, NOW);
  assert.equal(docs.length, 2);
  assert.match(docs[0].title, /政府広報室/);
  assert.equal(docs[1].status, 'unsupported');
});
test('same URL amendments create a new revision; unchanged bytes do not', () => {
  const source = { bytes: Buffer.from('first'), contentType: 'application/pdf', url: makeDoc().url };
  const first = withSuccessfulFetch(makeDoc(), source, NOW);
  const again = withSuccessfulFetch(first, source, '2026-10-09T18:00:00Z');
  assert.equal(again.revision, 1); assert.equal(again.revisions.length, 1);
  const amendment = withSuccessfulFetch(again, { ...source, bytes: Buffer.from('changed') }, '2026-10-10T18:00:00Z');
  assert.equal(amendment.revision, 2); assert.equal(amendment.revisions.length, 2);
  assert.notEqual(amendment.hash, first.hash); assert.match(amendment.validation.join(), /内容変更/);
});
test('failed re-fetch preserves last successful provenance without claiming fresh data', async () => {
  const first = withSuccessfulFetch(makeDoc(), { bytes: Buffer.from('ok'), contentType: 'application/pdf', url: makeDoc().url }, NOW);
  const result = await acquireDocument(first, async () => { throw new Error('HTTP 404'); }, '2026-10-09T18:00:00Z', 0);
  assert.equal(result.doc.status, 'fetch_failed'); assert.equal(result.doc.retrievedAt, NOW);
  assert.equal(result.doc.lastAttemptAt, '2026-10-09T18:00:00Z'); assert.equal(result.doc.hash, first.hash);
  assert.equal(result.source, null); assert.match(result.doc.validation.join(), /今回の取得は失敗/);
});

test('sibling frames never relabel normal requests as demand or investment', () => {
  const parent = { ...makeDoc(), url: 'https://www.cao.go.jp/requests.html' };
  const html = '<h1>令和9年度</h1><ul><li><a href="normal.pdf">概算要求書</a><a href="demand.pdf">要望一覧</a><a href="investment.pdf">投資枠一覧</a></li></ul>';
  assert.deepEqual(discoverChildren(html, parent, NOW).map(doc => doc.documentType), ['accounting_table', 'demand_list', 'investment_list']);
});
test('an explicit old-year anchor is not made current by its sibling or heading', () => {
  const parent = { ...makeDoc(), url: 'https://www.cao.go.jp/requests.html' };
  const html = '<h1>令和9年度</h1><li><a href="current.csv">令和9年度要求書</a><a href="old.csv">令和8年度要求書</a></li>';
  assert.deepEqual(discoverChildren(html, parent, NOW).map(doc => doc.url), ['https://www.cao.go.jp/current.csv']);
});
test('resuming a source cache preserves actual original retrieval time', () => {
  const doc = withSuccessfulFetch(makeDoc(), { bytes: Buffer.from('unchanged'), contentType: 'application/pdf', url: makeDoc().url, retrievedAt: NOW }, '2026-10-09T18:00:00Z');
  assert.equal(doc.retrievedAt, NOW); assert.equal(doc.revisions[0].retrievedAt, NOW); assert.equal(doc.lastAttemptAt, NOW);
});
test('account labels are anchor-first and ambiguous combined labels remain unknown', () => {
  const parent = { ...makeDoc(), url: 'https://www.cao.go.jp/requests.html' };
  const html = '<h1>令和9年度</h1><li><a href="general.pdf">一般会計概算要求書</a><a href="special.pdf">エネルギー対策特別会計概算要求書</a></li><li>一般会計・特別会計 <a href="combined.pdf">PDF</a></li>';
  assert.deepEqual(discoverChildren(html, parent, NOW).map(doc => doc.account), ['一般会計', 'エネルギー対策特別会計', null]);
});
test('combined request/demand overview stays an overview', () => {
  const parent = { ...makeDoc(), url: 'https://www.cao.go.jp/requests.html' };
  const docs = discoverChildren('<h1>令和9年度</h1><a href="overview.pdf">令和9年度予算概算要求・要望の概要</a>', parent, NOW);
  assert.equal(docs[0].documentType, 'overview');
});
