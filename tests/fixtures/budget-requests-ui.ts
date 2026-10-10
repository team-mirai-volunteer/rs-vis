/** UI/domain test fixtures only. Never part of the published acquisition dataset. */
import type { BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord, RequestAmount } from '../../types/budget-requests';

const blank = (): RequestAmount => ({ valueYen: null, status: 'blank', raw: '' });
export const requestDocument = (overrides: Partial<BudgetRequestDocument> = {}): BudgetRequestDocument => ({
  id: 'doc-test', url: 'https://example.go.jp/test.pdf', title: 'テスト用概算要求概要', ministry: 'テスト省', account: '一般会計',
  documentType: 'overview', parentUrl: 'https://example.go.jp/index.html', requestedFY: 2027, status: 'extracted',
  retrievedAt: '2026-10-01T00:00:00Z', lastAttemptAt: '2026-10-01T00:00:00Z', hash: 'test-hash', revision: 1,
  revisions: [{ hash: 'test-hash', retrievedAt: '2026-10-01T00:00:00Z', revision: 1 }], contentType: 'application/pdf', recordCount: 1, error: null, validation: [], ...overrides,
});
export const requestRecord = (overrides: Partial<BudgetRequestRecord> = {}): BudgetRequestRecord => ({
  id: 'row-test', documentId: 'doc-test', requestedFY: 2027, publicationFY: 2026, sheetFY: null, ministry: 'テスト省', department: 'テスト局', account: '一般会計', subaccount: null,
  itemCodes: ['A001'], requestNumber: 'R-1', projectName: 'テスト研究推進事業', amounts: { request: { valueYen: 0, status: 'numeric', raw: '0' }, demand: { valueYen: null, status: '事項要求', raw: '事項要求' }, specialInvestment: blank() },
  originalUnit: '百万円', previousYear: blank(), previousYearComparisonBasis: null, documentType: 'overview', parentId: null, aggregationFlag: 'detail',
  provenance: { url: 'https://example.go.jp/test.pdf', page: 3, cell: null, rawQuote: 'テスト研究推進事業 0 事項要求', hash: 'test-hash', retrievedAt: '2026-10-01T00:00:00Z', extractionMethod: 'test-fixture', validation: [] },
  rsLink: { status: 'unmatched', projectIds: [], sheetFY: null, evidence: null }, ...overrides,
});
export const requestDataset = (): BudgetRequestDataset => ({
  schemaVersion: 1, requestedFY: 2027, generatedAt: '2026-10-02T00:00:00Z', indexUrl: 'https://example.go.jp/index.html',
  coverage: { ministries: 2, discoveredDocuments: 3, fetchedDocuments: 2, extractedDocuments: 1, records: 3, warnings: ['テスト用の部分収録データ'] },
  documents: [requestDocument({ recordCount: 2 }), requestDocument({ id: 'doc-fail', title: '別省の未取得資料', ministry: '別省', status: 'fetch_failed', recordCount: 0, retrievedAt: null, hash: null, revision: 0, revisions: [], error: 'テスト用取得失敗', documentType: 'demand_list' }), requestDocument({ id: 'doc-unsupported', title: '未対応の画像資料', status: 'unsupported', recordCount: 0 })],
  records: [
    requestRecord(),
    requestRecord({ id: 'row-test-2', projectName: 'テスト整備事業', amounts: { request: { valueYen: 120000000, status: 'numeric', raw: '120' }, demand: blank(), specialInvestment: blank() }, previousYear: { valueYen: 100000000, status: 'numeric', raw: '100' } }),
    // 要求額を読み取れていない行。一覧には出さない
    requestRecord({ id: 'row-test-3', projectName: 'テスト読取不能事業', amounts: { request: { valueYen: null, status: 'extraction_failed', raw: '読取不能' }, demand: blank(), specialInvestment: blank() } }),
  ],
});
