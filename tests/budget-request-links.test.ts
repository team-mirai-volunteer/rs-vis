import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLinks, indexRequestRecords, normalizeName } from '../scripts/generate-budget-request-links';
import type { BudgetRequestDataset, BudgetRequestDocument, BudgetRequestRecord } from '../types/budget-requests';

const doc: BudgetRequestDocument = { id: 'doc-1', url: 'https://www.mext.go.jp/content/req.pdf', title: '令和9年度歳出概算要求書', ministry: '文部科学省', account: '一般会計', documentType: 'accounting_table', parentUrl: null, requestedFY: 2027, status: 'extracted', retrievedAt: '2026-10-09T00:00:00Z', lastAttemptAt: '2026-10-09T00:00:00Z', hash: 'a'.repeat(64), revision: 1, revisions: [], contentType: 'application/pdf', recordCount: 5, error: null, validation: [] };
const amount = (yen: number | null) => yen === null ? { valueYen: null, status: 'blank' as const, raw: '' } : { valueYen: yen, status: 'numeric' as const, raw: String(yen / 1000) };
function record(id: string, codes: string[], name: string, request: number | null, previous: number | null, parentId: string | null, page = 1): BudgetRequestRecord {
  return { id, documentId: doc.id, requestedFY: 2027, publicationFY: null, sheetFY: null, ministry: '文部科学省', department: '文部科学本省', account: '一般会計', subaccount: null,
    itemCodes: codes, requestNumber: null, projectName: name, amounts: { request: amount(request), demand: amount(null), specialInvestment: amount(null) },
    originalUnit: '千円', previousYear: amount(previous), previousYearComparisonBasis: null, documentType: 'accounting_table', parentId, aggregationFlag: parentId ? 'detail' : 'total',
    provenance: { url: doc.url, page, cell: null, rawQuote: name, hash: doc.hash!, retrievedAt: doc.retrievedAt!, extractionMethod: 'test', validation: [] }, rsLink: { status: 'unmatched', projectIds: [], sheetFY: null, evidence: null } };
}
// 組織(010) > 項(540) > 事項(01-14) > 目(14071-...) の階層。目「学校施設環境改善交付金」は 2 つの事項に分かれて記載される
const dataset: BudgetRequestDataset = {
  schemaVersion: 1, requestedFY: 2027, generatedAt: '2026-10-09T00:00:00Z', indexUrl: 'https://www.mof.go.jp/',
  coverage: { ministries: 1, discoveredDocuments: 1, fetchedDocuments: 1, extractedDocuments: 1, records: 7, warnings: [] },
  documents: [doc],
  records: [
    record('r-org', ['010'], '文部科学本省', 5_000_000_000_000, 4_900_000_000_000, null),
    record('r-kou', ['010', '540'], '公立文教施設整備費', 80_000_000_000, 70_000_000_000, 'r-org'),
    record('r-jiko', ['010', '540', '01-14'], '公立学校施設整備費', 80_000_000_000, 70_000_000_000, 'r-kou'),
    record('r-moku1', ['010', '540', '01-14', '14071-1825-16-7543'], '公立学校施設整備費負担金', 71_221_716_000, 62_345_886_000, 'r-jiko', 214),
    record('r-moku2a', ['010', '540', '01-14', '14071-1825-16-7712'], '学校施設環境改善交付金', 0, 2_588_709_000, 'r-jiko', 214),
    record('r-moku2b', ['010', '540', '01-14', '14071-1825-16-7712'], '学校施設環境改善交付金', 0, 2_798_456_000, 'r-jiko', 215),
    record('r-moku3', ['010', '540', '01-14', '14071-1825-16-9999'], '北方領土隣接地域振興等事業補助率差額', 50_000_000, 20_000_000, 'r-jiko', 214),
  ],
};
const lines = [
  { pid: '1527', ministry: '文部科学省', organization: '文部科学本省', kou: '公立文教施設整備費', moku: '公立学校施設整備費負担金', budgetYen: 62_890_139_000, nextRequestYen: 68_127_222_000 },
  { pid: '1527', ministry: '文部科学省', organization: '文部科学本省', kou: '公立文教施設整備費', moku: '学校施設環境改善交付金', budgetYen: 6_222_868_000, nextRequestYen: 138_365_278_000 },
  { pid: '1527', ministry: '文部科学省', organization: '文部科学本省', kou: '初等中等教育振興費', moku: '北方領土隣接地域振興等事業補助率差額', budgetYen: 11_000_000, nextRequestYen: 15_235_000 },
  { pid: '1527', ministry: '文部科学省', organization: '文部科学本省', kou: '初等中等教育振興費', moku: '情報処理業務庁費', budgetYen: 9_150_000, nextRequestYen: 9_727_000 },
  { pid: '3730', ministry: '経済産業省', organization: '経済産業本省', kou: '燃料安定供給対策費', moku: '燃料油価格激変緩和対策費補助金', budgetYen: 1, nextRequestYen: 1 },
];

test('項と目で明細表の行を引き、同じ目の複数行は合算し、目は組織内で一意なら項が違っても引ける', () => {
  const result = buildLinks(dataset, lines, 2025, '2026-10-10T00:00:00Z');
  const project = result.byPid['1527'];
  assert.equal(project.coverage, 'linked');
  const byMoku = Object.fromEntries(project.items.map(item => [item.moku, item]));
  assert.equal(byMoku['公立学校施設整備費負担金'].requestYen, 71_221_716_000);
  assert.equal(byMoku['公立学校施設整備費負担金'].previousYen, 62_345_886_000);
  assert.equal(byMoku['公立学校施設整備費負担金'].matchedBy, 'kou-moku');
  assert.equal(byMoku['公立学校施設整備費負担金'].page, 214);
  assert.equal(byMoku['学校施設環境改善交付金'].rows, 2);
  assert.equal(byMoku['学校施設環境改善交付金'].previousYen, 2_588_709_000 + 2_798_456_000);
  // RS の項「初等中等教育振興費」と明細表の項「公立文教施設整備費」が違うが、目の名前が組織内で一意なので採用する
  assert.equal(byMoku['北方領土隣接地域振興等事業補助率差額'].matchedBy, 'moku-unique');
  assert.equal(byMoku['北方領土隣接地域振興等事業補助率差額'].rsNextRequestYen, 15_235_000);
  assert.deepEqual(project.unmatched.map(item => item.moku), ['情報処理業務庁費']);
  // 事業への按分はしない: 目全体の額をそのまま持つ
  assert.notEqual(byMoku['公立学校施設整備費負担金'].requestYen, byMoku['公立学校施設整備費負担金'].rsNextRequestYen);
});

test('原資料を取得できていない府省は not-crawled になり、総計行は府省別の表に残る', () => {
  const result = buildLinks(dataset, lines, 2025, '2026-10-10T00:00:00Z');
  assert.equal(result.byPid['3730'].coverage, 'not-crawled');
  assert.deepEqual(result.crawledMinistries, ['文部科学省']);
  assert.equal(result.ministries.length, 1);
  assert.equal(result.ministries[0].organization, '文部科学本省');
  assert.equal(result.ministries[0].requestYen, 5_000_000_000_000);
  assert.deepEqual(result.stats, { projects: 2, linked: 1, noMatch: 0, notCrawled: 1, keys: 4, matchedKeys: 3 });
});

test('名前の正規化は空白・全角括弧・中黒の違いだけを吸収する', () => {
  assert.equal(normalizeName(' 国立大学改革・研究基盤強化推進補助金 '), '国立大学改革研究基盤強化推進補助金');
  assert.equal(normalizeName('公立学校施設整備費（スポーツ庁）'), '公立学校施設整備費(スポーツ庁)');
  assert.notEqual(normalizeName('職員旅費'), normalizeName('委員等旅費'));
  const index = indexRequestRecords(dataset);
  assert.equal(index.byKouMoku.size, 3);
});
