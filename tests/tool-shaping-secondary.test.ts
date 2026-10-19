/**
 * 補助ビュー向けツール（概算要求の検索・租税特別措置・国民負担）の整形と、navigate_page の params → URL。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaxBurdenInput, searchTaxExpenditures, shapeBudgetRequestSearch } from '../app/lib/ai/tool-shaping-secondary';
import { FISCAL_POLICIES, NAV_TARGETS, fiscalScenarioAmounts, findNavTarget, navTargetHref, taxBurdenSearch } from '../app/lib/ai/nav-targets';
import { POLICIES } from '../app/lib/fiscal-space/assumptions';
import { TOOLS, DATA_TOOL_NAMES } from '../app/lib/ai/chat-core';
import { MCP_TOOLS } from '../app/lib/ai/mcp-tools';
import type { BudgetRequestRecord } from '../types/budget-requests';

test('FISCAL_POLICIES は assumptions の POLICIES と同じ id・名前', () => {
  assert.deepEqual(FISCAL_POLICIES.map(p => [p.id, p.name]), POLICIES.map(p => [p.id, p.name]));
});

test('新しいデータツールはチャットと MCP の両方に載る', () => {
  for (const name of ['search_budget_requests', 'search_tax_expenditures', 'estimate_tax_burden']) {
    assert.ok(DATA_TOOL_NAMES.includes(name), `${name} が DATA_TOOL_NAMES に無い`);
    assert.ok(MCP_TOOLS.some(t => t.name === name), `${name} が MCP に無い`);
  }
  const nav = TOOLS.find(t => t.function.name === 'navigate_page')!;
  const params = (nav.function.parameters.properties as Record<string, { properties?: Record<string, unknown> }>).params;
  assert.deepEqual(Object.keys(params.properties!), ['q', 'ministry', 'year', 'linkedOnly', 'view', 'income', 'household', 'age', 'includeConsumption', 'policies']);
});

test('navTargetHref: 補助ビューの params を URL に写し、無効な値は warnings に残す', () => {
  const br = navTargetHref(findNavTarget('budget-requests')!, { q: '道路', ministry: '国土交通省' });
  assert.equal(br.href, '/budget-requests?q=%E9%81%93%E8%B7%AF&ministry=%E5%9B%BD%E5%9C%9F%E4%BA%A4%E9%80%9A%E7%9C%81');
  const te = navTargetHref(findNavTarget('tax-expenditures')!, { q: '研究開発', year: '2023', linkedOnly: true, view: 'nope' });
  assert.equal(te.href, '/tax-expenditures?q=%E7%A0%94%E7%A9%B6%E9%96%8B%E7%99%BA&year=2023&linked=1');
  assert.equal(te.warnings.length, 1);
  const tb = navTargetHref(findNavTarget('tax-burden')!, { income: 6000000, household: 'two-earners', age: 99 });
  const q = new URLSearchParams(tb.href.split('?')[1]);
  assert.equal(q.get('income'), '6000000');
  assert.equal(q.get('household'), 'two-earners');
  assert.equal(q.get('age'), '40', '無効な age は既定のまま');
  assert.deepEqual(tb.warnings, ['age は 20〜64']);
  const fs = navTargetHref(findNavTarget('fiscal-space')!, { policies: [{ id: 'consumption-tax', amountYen: 5e12 }, { id: 'bogus', amountYen: 1 }] });
  assert.equal(fs.href, '/fiscal-space');
  assert.deepEqual(fs.scenario, { amounts: { 'consumption-tax': 5e12 } });
  assert.equal(fs.warnings.length, 1);
  // params が無い・関係ないページでは素の href
  assert.equal(navTargetHref(findNavTarget('quality')!, { q: 'x' }).href, '/quality');
  for (const t of NAV_TARGETS) assert.equal(navTargetHref(t, undefined).href, t.href);
});

test('taxBurdenSearch / fiscalScenarioAmounts の境界', () => {
  assert.equal(taxBurdenSearch({ income: '5000000' }).warnings.length, 0);
  assert.equal(taxBurdenSearch({ income: -1 }).warnings.length, 1);
  assert.deepEqual(fiscalScenarioAmounts(undefined), { amounts: {}, warnings: [] });
  assert.equal(fiscalScenarioAmounts('x').warnings.length, 1);
  assert.equal(fiscalScenarioAmounts([{ id: 'cash', amountYen: 1e15 }]).warnings.length, 1, '上限超え');
});

test('parseTaxBurdenInput: 必須と範囲', () => {
  assert.ok('error' in parseTaxBurdenInput({}));
  assert.ok('error' in parseTaxBurdenInput({ income: 5000000, household: 'family' }));
  const ok = parseTaxBurdenInput({ income: 5000000 });
  assert.ok('input' in ok);
  assert.deepEqual(ok.input, { income: 5000000, household: 'one-earner-children', age: 40, share: 67, includeConsumption: false });
});

test('searchTaxExpenditures: 名前・条文で絞り、単体法人の合計と評価を付ける', () => {
  const measures = [
    { id: 'a', article: '42の4', name: '研究開発税制', overview: '試験研究費', deadline: null, rsProjectId: 127, rows: [
      { entity: '単体法人', years: { '2024': [10, 9, 1000], '2023': [null, null, null] } },
      { entity: 'うち通算法人（内数）', years: { '2024': [1, 1, 100], '2023': [null, null, null] } },
      { entity: '単体法人', years: { '2024': [5, 5, 500], '2023': [null, null, null] } },
    ] },
    { id: 'b', article: '42の12の5', name: '賃上げ促進税制', overview: '給与', deadline: '2027-03-31', rsProjectId: null, rows: [] },
  ];
  const assessments = { a: { scores: [{ score: 3, reason: '', sources: [] }], action: '継続', next: '', verification: [] } } as never;
  const r = searchTaxExpenditures(measures, assessments, '研究', '2024');
  assert.equal(r.count, 1);
  assert.equal(r.measures[0].amountThousandYen, 1500, '内数の行は足さない');
  assert.equal(r.measures[0].cases, 15);
  assert.equal(r.measures[0].rsProjectId, '127');
  assert.equal(r.measures[0].assessment?.scores['政策の必要性'], 3);
  assert.equal(searchTaxExpenditures(measures, assessments, '', '2023').count, 2);
  assert.equal(searchTaxExpenditures(measures, assessments, '', '2023').measures[0].amountThousandYen, null);
  assert.ok(r.url.startsWith('/tax-expenditures?q='));
});

test('shapeBudgetRequestSearch: 上位 10 件と件数、ページへの URL', () => {
  const rec = (i: number): BudgetRequestRecord => ({
    id: String(i), documentId: 'd', requestedFY: 2027, publicationFY: null, sheetFY: null, ministry: 'デジタル庁', department: null, account: '一般会計', subaccount: null,
    itemCodes: [], requestNumber: null, projectName: `事業${i}`,
    amounts: { request: { valueYen: i * 1000, status: 'ok' as never, raw: '' }, demand: { valueYen: null, status: 'blank' as never, raw: '' }, specialInvestment: { valueYen: null, status: 'blank' as never, raw: '' } },
    originalUnit: null, previousYear: { valueYen: 1, status: 'ok' as never, raw: '' }, previousYearComparisonBasis: null, documentType: 'accounting_table', parentId: null, aggregationFlag: 'detail',
    provenance: { url: 'https://example.invalid/x.xlsx', page: null, cell: null, rawQuote: '', hash: '', retrievedAt: '', extractionMethod: '', validation: [] },
    rsLink: { status: 'unmatched', projectIds: [], sheetFY: null, evidence: null },
  });
  const r = shapeBudgetRequestSearch(Array.from({ length: 12 }, (_, i) => rec(i)), 12, 2027, 'x', 'デジタル庁');
  assert.equal(r.count, 12);
  assert.equal(r.records.length, 10);
  assert.equal(r.records[0].requestYen, 11000, '要求額の大きい順');
  assert.equal(r.records[9].requestYen, 2000);
  assert.equal(r.url, '/budget-requests?q=x&ministry=%E3%83%87%E3%82%B8%E3%82%BF%E3%83%AB%E5%BA%81');
});
