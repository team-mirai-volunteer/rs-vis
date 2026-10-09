import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetRequestResponse, DEFAULT_REQUEST_FILTERS, filterBudgetRequests, formatRequestAmount, parseBudgetRequestFilters, recordLocation, requestSourceUrl } from '../app/lib/budget-requests';
import { requestDataset, requestDocument, requestRecord } from './fixtures/budget-requests-ui';
import { PRIMARY_PAGES } from '../components/navigation/pages';

const filters = (overrides: Partial<typeof DEFAULT_REQUEST_FILTERS> = {}) => ({ ...DEFAULT_REQUEST_FILTERS, ...overrides });

test('概算要求の試作ナビは既存の主要ページの後に並ぶ', () => {
  assert.equal(PRIMARY_PAGES[0].href, '/budget-sankey');
  assert.ok(PRIMARY_PAGES.findIndex(page => page.href === '/budget-requests') > PRIMARY_PAGES.findIndex(page => page.href === '/tax-expenditures'));
  assert.equal(PRIMARY_PAGES.find(page => page.href === '/budget-requests')?.prototype, true);
});

test('無変更の再確認を公開データの更新や最新取得と誤表示しない', () => {
  const source = readFileSync(new URL('../app/budget-requests/view.tsx', import.meta.url), 'utf8');
  assert.match(source, /内容・状態の更新/);
  assert.match(source, /内容・状態が変わらない再確認では更新日時を変更しません/);
  assert.match(source, /記録時の最終試行/);
});

test('絞り込みの選択肢とは独立したアクセシブル名を付ける', () => {
  const source = readFileSync(new URL('../app/budget-requests/view.tsx', import.meta.url), 'utf8');
  const filter = source.slice(source.indexOf('function Filter('), source.indexOf('function RecordCard('));
  const select = filter.match(/<select\b[^>]*>/)?.[0];
  assert.ok(select, '共通Filterにselectがある');
  assert.match(select, /\baria-label=\{label\}/, '選択中の値や選択肢をラベルに混ぜない');
});

test('要求額は金額0・事項要求・空欄・抽出失敗を分けて表示する', () => {
  assert.equal(formatRequestAmount({ valueYen: 0, status: 'numeric', raw: '0' }), '0円');
  assert.equal(formatRequestAmount({ valueYen: 120000000, status: 'numeric', raw: '120' }), '120,000,000円');
  assert.equal(formatRequestAmount({ valueYen: null, status: '事項要求', raw: '事項要求' }), '事項要求（金額未定）');
  assert.equal(formatRequestAmount({ valueYen: null, status: 'blank', raw: '' }), '記載なし');
  assert.equal(formatRequestAmount({ valueYen: null, status: 'extraction_failed', raw: '?' }), '抽出できず');
  assert.equal(formatRequestAmount({ valueYen: null, status: 'numeric', raw: '?' }), '抽出できず');
  assert.equal(formatRequestAmount({ valueYen: NaN, status: 'numeric', raw: '?' }), '抽出できず');
});

test('府省庁・資料種別・取得状況を組み合わせ、未抽出の資料も残す', () => {
  const result = filterBudgetRequests(requestDataset(), filters({ ministry: '別省', status: 'fetch_failed', documentType: 'demand_list' }));
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.documents.map(document => document.id), ['doc-fail']);
  assert.equal(filterBudgetRequests(requestDataset(), filters({ status: 'unsupported' })).documents.length, 1);
});

test('事業名・資料名・科目コード検索は全角英数/大小文字を正規化する', () => {
  const data = requestDataset();
  assert.deepEqual(filterBudgetRequests(data, filters({ query: '研究' })).records.map(record => record.id), ['row-test']);
  assert.equal(filterBudgetRequests(data, filters({ query: '概算要求概要' })).records.length, 2);
  assert.equal(filterBudgetRequests(data, filters({ query: 'ａ００１' })).records.length, 2);
  assert.equal(filterBudgetRequests(data, filters({ query: '別省の未取得資料' })).documents.length, 1);
});

test('金額区分ではゼロや事項要求・抽出失敗を消さず、空欄だけを除く', () => {
  const data = requestDataset();
  assert.equal(filterBudgetRequests(data, filters({ amountType: 'request' })).records.length, 2);
  assert.deepEqual(filterBudgetRequests(data, filters({ amountType: 'demand' })).records.map(record => record.id), ['row-test']);
  assert.deepEqual(filterBudgetRequests(data, filters({ amountType: 'specialInvestment' })).records.map(record => record.id), ['row-test-2']);
});

test('ページングは全体の取得範囲と一致件数を保持し、合計額を捏造しない', () => {
  const data = requestDataset();
  const response = budgetRequestResponse(data, filters({ pageSize: 1, page: 2 }));
  assert.equal(response.records.length, 1);
  assert.equal(response.records[0].id, 'row-test-2');
  assert.equal(response.pagination.matchingRecords, 2);
  assert.equal(response.pagination.matchingDocuments, 3);
  assert.deepEqual(response.coverage, data.coverage);
  assert.equal(response.recordDocuments[0].id, 'doc-test', '別ページの資料も行の取得状況を説明できる');
  assert.equal(response.statusCounts.fetch_failed, 1);
  assert.equal(response.metadata.stage, 'request');
  assert.equal('totalAmount' in response, false);
  assert.equal('score' in response.records[0], false);
  assert.equal(budgetRequestResponse(data, filters({ page: 99 })).records.length, 0);
});

test('失敗後に保持した過去の行は、その資料の失敗状況を一緒に返す', () => {
  const data = requestDataset();
  data.documents[0] = requestDocument({ status: 'fetch_failed', lastAttemptAt: '2026-10-02T00:00:00Z' });
  const response = budgetRequestResponse(data, filters());
  assert.equal(response.recordDocuments[0].status, 'fetch_failed');
  assert.equal(response.records[0].provenance.retrievedAt, '2026-10-01T00:00:00Z');
});

test('対象年度・列挙値・ページ指定を厳密に検証する', () => {
  assert.deepEqual(parseBudgetRequestFilters(new URLSearchParams()), filters());
  assert.equal(parseBudgetRequestFilters(new URLSearchParams('fy=2027&q=%20test%20&limit=100')).query, 'test');
  for (const query of ['fy=2026', 'fy=2027x', 'page=0', 'page=-1', 'page=1.5', 'page=1e2', 'limit=101', 'limit=0', 'status=toString', 'type=__proto__', 'amount=other', `q=${'a'.repeat(201)}`]) {
    assert.throws(() => parseBudgetRequestFilters(new URLSearchParams(query)), query);
  }
});

test('出典は安全なURLだけにリンクし、PDFページとセルを明示する', () => {
  assert.equal(requestSourceUrl('https://example.go.jp/test.pdf', 3), 'https://example.go.jp/test.pdf#page=3');
  assert.equal(requestSourceUrl('https://example.go.jp/test.html', 3), 'https://example.go.jp/test.html');
  assert.equal(requestSourceUrl('javascript:alert(1)'), null);
  assert.equal(requestSourceUrl('not a url'), null);
  assert.equal(recordLocation(requestRecord()), 'PDF 3ページ');
  const record = requestRecord(); record.provenance.page = null; record.provenance.cell = 'Sheet1!B4';
  assert.equal(recordLocation(record), 'Sheet1!B4');
});
