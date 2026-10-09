import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractRequestDocument, parseRequestAmount, validateRequestSubtotals, validateRequestYearComparison } from '../scripts/budget-requests-extract';
import type { BudgetRequestDocument, BudgetRequestRecord } from '../types/budget-requests';

const doc: BudgetRequestDocument = {
  id: 'cao-r09-12', url: 'https://www.cao.go.jp/yosan/soshiki/r09/pdf/12.pdf',
  title: '政府広報室 概算要求額明細表', ministry: '内閣府', account: '一般会計',
  documentType: 'accounting_table', parentUrl: 'https://www.cao.go.jp/yosan/soshiki/r09/yosangaisan_r9.html',
  requestedFY: 2027, status: 'fetched', retrievedAt: '2026-10-08T18:00:00Z', lastAttemptAt: '2026-10-08T18:00:00Z',
  hash: null, revision: 1, revisions: [], contentType: 'application/pdf', recordCount: 0, error: null, validation: [],
};
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/budget-requests/${name}`, import.meta.url)));
const structured = (text: string, overrides: Partial<BudgetRequestDocument> = {}) => extractRequestDocument(new TextEncoder().encode(text), {
  ...doc, url: 'https://www.cao.go.jp/request.csv', contentType: 'text/csv', ...overrides,
});
const actual = extractRequestDocument(fixture('cao-r09-12.pdf'), doc);

test('source amount units and precision: no unknown-to-zero coercion', () => {
  assert.deepEqual(parseRequestAmount('７，８８４，７４２', '千円'), { valueYen: 7_884_742_000, status: 'numeric', raw: '７，８８４，７４２' });
  assert.equal(parseRequestAmount('78.84742', '億円').valueYen, 7_884_742_000);
  assert.equal(parseRequestAmount('△81,187', '千円').valueYen, -81_187_000);
  assert.equal(parseRequestAmount('0', '千円').valueYen, 0);
  for (const input of ['', ' ', '―', '-']) assert.equal(parseRequestAmount(input, '千円').status, 'blank');
  assert.equal(parseRequestAmount('事項要求', '千円').status, '事項要求');
  for (const input of ['12,34', '123abc', '1.0001', '9007199254740992']) assert.equal(parseRequestAmount(input, '千円').status, 'extraction_failed');
  assert.equal(parseRequestAmount('123', null).status, 'extraction_failed');
  assert.equal(parseRequestAmount('1.5億円', null).valueYen, 150_000_000);
});

test('real CAO PDF preserves normal-request total, hierarchy and evidence', async () => {
  const result = await actual;
  assert.equal(result.status, 'extracted');
  assert.deepEqual(result.validation, []);
  assert.equal(result.records.length, 37);
  const total = result.records.find(record => record.aggregationFlag === 'total')!;
  assert.equal(total.projectName, '内閣本府');
  assert.equal(total.amounts.request.valueYen, 7_884_742_000); // 78.84742億, not the 280.49億 overview.
  assert.equal(total.previousYear.valueYen, 7_884_956_000);
  assert.equal(total.originalUnit, '千円');
  assert.equal(total.provenance.url, doc.url);
  assert.equal(total.provenance.page, 1);
  assert.equal(total.provenance.hash, createHash('sha256').update(fixture('cao-r09-12.pdf')).digest('hex'));
  assert.match(total.provenance.rawQuote, /884,/);
  assert.equal(total.requestedFY, 2027);
  assert.equal(total.publicationFY, null);
  assert.equal(total.sheetFY, null);
  assert.deepEqual(new Set(result.records.map(record => record.provenance.page)), new Set([1, 2, 3]));
  assert.equal(result.records.filter(record => record.aggregationFlag === 'detail').reduce((sum, record) => sum + record.amounts.request.valueYen!, 0), total.amounts.request.valueYen);
  assert.ok(result.records.every(record => record.amounts.demand.status === 'blank' && record.amounts.specialInvestment.status === 'blank'));
  assert.ok(result.records.every(record => record.rsLink.status === 'unmatched'));
  assert.ok(result.records.some(record => record.requestNumber === '2' && record.parentId));
  assert.ok(!result.records.some(record => record.amounts.request.valueYen === 2_215_166_000)); // Future-year commitments in 備考 are not request rows.
});

test('blank hierarchy totals are retained as blank, never calculated into source values', async () => {
  const result = await actual;
  const row = result.records.find(record => record.projectName === '内閣本府共通費')!;
  assert.equal(row.aggregationFlag, 'subtotal');
  assert.equal(row.amounts.request.valueYen, null);
  assert.equal(row.amounts.request.status, 'blank');
});

test('real PDF regression: merged negative sign and request number 100', async () => {
  const result = await extractRequestDocument(fixture('mext-r09-regressions.pdf'), { ...doc, id: 'mext-regression', ministry: '文部科学省' });
  const negative = result.records.find(record => record.projectName === '人件費' && record.itemCodes.includes('003'))!;
  assert.equal(negative.amounts.request.valueYen, -81_187_000);
  assert.equal(negative.previousYear.valueYen, 0);
  const request = result.records.find(record => record.requestNumber === '100' && record.projectName === '審議会に必要な経費')!;
  assert.ok(request);
  assert.equal(request.itemCodes.at(-1), '10-95');
  assert.equal(request.amounts.request.status, 'blank');
  assert.ok(result.records.some(record => record.requestNumber === '100' && record.projectName === 'スポーツ審議会' && record.amounts.request.valueYen === 8_038_000));
});

test('summary category columns are explicitly unsupported rather than concatenated or duplicated', async () => {
  const result = await extractRequestDocument(fixture('mof-r09-summary-5.pdf'), doc);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.records.length, 0);
  assert.match(result.validation.join(' '), /未対応レイアウト/);
});

test('explicit PDF fiscal year mismatch prevents cross-year ingestion', async () => {
  const result = await extractRequestDocument(fixture('cao-r09-12.pdf'), { ...doc, requestedFY: 2026, url: 'https://www.cao.go.jp/request.pdf' });
  assert.equal(result.status, 'extraction_failed');
  assert.equal(result.records.length, 0);
  assert.match(result.validation.join(' '), /要求年度不一致/);
});

test('subtotal mismatch is flagged locally without throwing or discarding records', async () => {
  const records: BudgetRequestRecord[] = structuredClone((await actual).records);
  records[0].amounts.request.valueYen! += 1_000;
  const warnings = validateRequestSubtotals(records);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /小計不一致/);
  assert.equal(records.length, 37);
  assert.equal(records[0].provenance.validation.length, 1);
});

test('CSV handles quoted commas, newlines, all three frames and explicit source account', async () => {
  const result = await structured('事業名,要求番号,要求年度,会計名,勘定名,概算要求額(千円),要望額(億円),特別投資額(百万円),前年度予算額(千円)\r\n"事業, A\n第二行",21,2027,エネルギー対策特別会計,電源開発促進勘定,"1,234",1.5,事項要求,0\r\n空欄事業,22,2027,一般会計,,,,,\r\n');
  assert.equal(result.status, 'extracted');
  assert.equal(result.records.length, 2);
  const record = result.records[0];
  assert.equal(record.projectName, '事業, A\n第二行');
  assert.equal(record.account, 'エネルギー対策特別会計');
  assert.equal(record.subaccount, '電源開発促進勘定');
  assert.equal(record.amounts.request.valueYen, 1_234_000);
  assert.equal(record.amounts.demand.valueYen, 150_000_000);
  assert.equal(record.amounts.specialInvestment.status, '事項要求');
  assert.equal(record.previousYear.valueYen, 0);
  assert.match(record.provenance.rawQuote, /要望額\(億円\)/);
  assert.equal(result.records[1].amounts.request.status, 'blank');
  assert.equal(result.records[1].provenance.cell, 'row:4');
});

test('unrecognized or ambiguous CSV amounts remain visible with validation', async () => {
  const result = await structured('事業名,概算要求額\n単位なし,123\n');
  assert.equal(result.status, 'partial');
  assert.equal(result.records[0].amounts.request.status, 'extraction_failed');
  const duplicate = await structured('事業名,要求額(千円),要求額(億円)\n不明,1,2\n');
  assert.equal(duplicate.status, 'unsupported');
  const wrongYear = await structured('事業名,令和8年度概算要求額(千円)\n前年要求,123\n');
  assert.equal(wrongYear.status, 'extraction_failed');
});

test('dedicated demand/investment list retains separate monetary frame', async () => {
  for (const documentType of ['demand_list', 'investment_list'] as const) {
    const result = await structured('事業名,要求額(千円)\n事業A,123\n', { documentType });
    assert.equal(result.records[0].amounts.request.status, 'blank');
    assert.equal(result.records[0].amounts[documentType === 'demand_list' ? 'demand' : 'specialInvestment'].valueYen, 123_000);
  }
});

test('TSV and Shift-JIS input use the same safe structured extraction', async () => {
  const result = await structured('事業名\t要求額(千円)\n試験\t12\n', { url: 'https://www.cao.go.jp/request.tsv', contentType: 'text/tab-separated-values' });
  assert.equal(result.records[0].amounts.request.valueYen, 12_000);
  const iconv = await import('iconv-lite');
  const shifted = await extractRequestDocument(iconv.default.encode('事業名,要求額(千円)\n試験,12\n', 'shift_jis'), { ...doc, url: 'https://www.cao.go.jp/request.csv', contentType: 'text/csv' });
  assert.equal(shifted.records[0].projectName, '試験');
});

test('MOF XML clm coordinates retain cell provenance and never resolve DTDs', async () => {
  const xml = '<doc><header><clm id="p1-1.1-1.1"><![CDATA[事項]]></clm><clm id="p1-1.1-2.1"><![CDATA[概算要求額(千円)]]></clm></header><body><clm id="p1-2.1-1.1"><![CDATA[試験事業]]></clm><clm id="p1-2.1-2.1"><![CDATA[1,234]]></clm></body></doc>';
  const result = await structured(xml, { url: 'https://www.cao.go.jp/request.xml', contentType: 'application/xml' });
  assert.equal(result.status, 'extracted');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].amounts.request.valueYen, 1_234_000);
  assert.equal(result.records[0].provenance.cell, 'p1-r2');
  assert.equal(result.records[0].provenance.page, 1);
  const blocked = await structured('<!DOCTYPE foo SYSTEM "file:///etc/passwd">' + xml, { url: 'https://www.cao.go.jp/request.xml', contentType: 'application/xml' });
  assert.equal(blocked.status, 'unsupported');
});

test('corrupt PDF and unsupported workbook fail independently and explicitly', async () => {
  const corrupt = await extractRequestDocument(new TextEncoder().encode('%PDF-corrupt'), doc);
  assert.equal(corrupt.status, 'extraction_failed');
  const unsupported = await structured('PKnotaworkbook', { url: 'https://www.cao.go.jp/request.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.equal(unsupported.status, 'unsupported');
});


test('misclassified sibling context cannot move standard PDF normal requests into other frames', async () => {
  for (const documentType of ['demand_list', 'investment_list'] as const) {
    const result = await extractRequestDocument(fixture('cao-r09-12.pdf'), { ...doc, documentType });
    assert.equal(result.records[0].amounts.request.valueYen, 7_884_742_000);
    assert.equal(result.records[0].amounts.demand.status, 'blank');
    assert.equal(result.records[0].amounts.specialInvestment.status, 'blank');
    assert.equal(result.records[0].documentType, 'accounting_table');
    assert.match(result.validation.join(' '), /リンク分類と原表見出し/);
  }
  const csv = await structured('事業名,概算要求額(千円)\n事業A,123\n', { documentType: 'demand_list' });
  assert.equal(csv.records[0].amounts.request.valueYen, 123_000);
  assert.equal(csv.records[0].amounts.demand.status, 'blank');
});


test('real source regressions: previous-year minus sign merged into the project-name glyph', async () => {
  for (const [name, previous, current] of [
    ['clb', -5_077_000, 0],
    ['kunaicho', -19_659_000, -16_401_000],
    ['jcrc', -7_021_000, -6_136_000],
  ] as const) {
    const result = await extractRequestDocument(fixture(`${name}-r09-negative-signs.pdf`), { ...doc, id: name });
    const record = result.records.find(row => row.provenance.page === 2 && row.projectName === '職員基本給')!;
    assert.ok(record, name);
    assert.equal(record.previousYear.valueYen, previous, name);
    assert.equal(record.amounts.request.valueYen, current, name);
    assert.equal(record.previousYear.status, 'numeric');
    assert.match(record.previousYear.raw, /△/);
    assert.ok(!result.records.some(row => /△/.test(row.projectName)), name);
    assert.ok(!result.records.some(row => row.provenance.validation.some(warning => warning.startsWith('対前年度比較不一致'))), name);
  }
});

test('unresolved year-comparison conflict cannot retain known-invalid numeric values', async () => {
  const record = structuredClone((await actual).records[0]);
  const before = { request: record.amounts.request.raw, previous: record.previousYear.raw, quote: record.provenance.rawQuote };
  validateRequestYearComparison(record, { status: 'numeric', valueYen: 999_000, raw: '999' });
  assert.equal(record.amounts.request.status, 'extraction_failed');
  assert.equal(record.amounts.request.valueYen, null);
  assert.equal(record.previousYear.status, 'extraction_failed');
  assert.equal(record.previousYear.valueYen, null);
  assert.equal(record.amounts.request.raw, before.request);
  assert.equal(record.previousYear.raw, before.previous);
  assert.equal(record.provenance.rawQuote, before.quote);
  assert.match(record.provenance.validation.join(' '), /対前年度比較不一致/);
});

test('XLSX openxml MIME is unsupported binary, never misread as XML text', async () => {
  const result = await extractRequestDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]), { ...doc, url: 'https://www.cao.go.jp/request.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.equal(result.status, 'unsupported'); assert.equal(result.records.length, 0);
  assert.match(result.validation.join(' '), /Excel/);
});

test('adjacent PDF code glyphs retain full observed special-account codes', async () => {
  const { findPdfItemCode } = await import('../scripts/budget-requests-extract');
  const glyph = (text: string, x: number, width: number) => ({ text, x, width, y: 100, height: 7 });
  for (const middle of ['9', '306', '2129']) {
    const left = [glyph('95016-', 86, 21), glyph(`${middle}-`, 115, 10), glyph('02-', 126, 10), glyph('0000', 137, 14), glyph('職員基本給', 154, 45)];
    const code = findPdfItemCode(left, 207, 7)!;
    assert.equal(code.text, `95016-${middle}-02-0000`);
    assert.equal(code.x, 86); assert.equal(code.x + code.width, 151);
  }
  assert.equal(findPdfItemCode([glyph('1', 40, 4), glyph('10-95', 66, 19), glyph('事業', 90, 14)], 207, 7)?.text, '10-95');
  assert.equal(findPdfItemCode([glyph('95016-12-02-0000', 86, 63)], 207, 7), null); // Unobserved grammar is not inferred.
});

test('real special-account PDFs recover full codes, names, amounts and one-digit account hierarchy', async () => {
  const reconstruction = await extractRequestDocument(fixture('mof-r09-reconstruction.pdf'), { ...doc, id: 'mof-reconstruction' });
  const record = reconstruction.records.find(row => row.previousYear.valueYen === 47_658_341_000)!;
  assert.ok(record);
  assert.equal(record.projectName, '復興債償還財源等国債整理基金特別会計へ繰入');
  assert.equal(record.itemCodes.at(-1), '20100-306-22-1430');
  assert.equal(record.amounts.request.valueYen, 63_923_795_000);
  assert.equal(record.parentId, reconstruction.records.find(row => row.requestNumber === '2' && row.itemCodes.at(-1) === '11-20')?.id);
  assert.equal(record.provenance.page, 4);
  assert.ok(!reconstruction.validation.some(note => note.includes('未解決の明細行')));
  const reinsurance = await extractRequestDocument(fixture('mof-r09-reinsurance.pdf'), { ...doc, id: 'mof-reinsurance' });
  const insurance = reinsurance.records.find(row => row.itemCodes.at(-1) === '95199-9-21-6020')!;
  assert.equal(insurance.projectName, '再保険金');
  assert.equal(insurance.amounts.request.valueYen, 133_127_738_000);
  assert.ok(!reinsurance.validation.some(note => note.includes('未解決の明細行')));
  const accounts = await extractRequestDocument(fixture('mof-r09-account-heading.pdf'), { ...doc, id: 'mof-accounts' });
  const account = accounts.records.find(row => row.itemCodes.at(-1) === '3' && row.projectName === '特定国有財産整備勘定')!;
  assert.ok(account);
  assert.equal(account.amounts.request.valueYen, 4_023_592_000);
  assert.equal(account.subaccount, '特定国有財産整備勘定');
  assert.ok(accounts.records.some(row => row.parentId === account.id && row.subaccount === account.subaccount));
  assert.ok(!accounts.validation.some(note => note.includes('未解決の明細行')));
});

test('whole amount runs crossing a header midpoint cannot silently lose digits, including nonnumeric comparison', async () => {
  const { readPdfAmountColumns } = await import('../scripts/budget-requests-extract');
  const glyph = (text: string, x: number, width: number) => ({ text, x, width, y: 100, height: 10 });
  const layout = { previous: { start: 200, end: 245 }, request: { start: 260, end: 300 }, comparison: { start: 410, end: 455 }, fontHeight: 10 };
  for (const comparison of [[], [glyph('事項要求', 420, 40)]]) {
    for (const amount of [[glyph('123,456,789', 245, 60)], [glyph('123,', 245, 20), glyph('456,', 265, 20), glyph('789', 285, 20)]]) {
      const result = readPdfAmountColumns([...amount, ...comparison], layout, '千円');
      assert.equal(result.request.valueYen, 123_456_789_000);
      assert.equal(result.previousYear.status, 'blank');
      assert.equal(result.change.status, comparison.length ? '事項要求' : 'blank');
    }
    const previous = readPdfAmountColumns([glyph('123,456,789', 180, 70), ...comparison], layout, '千円');
    assert.equal(previous.previousYear.valueYen, 123_456_789_000);
    // A sign belongs to its adjacent complete amount, including when both the
    // sign and the leading digits overflow the old column boundary.
    for (const sign of ['△', '▲', '-']) {
      for (const negative of [[glyph(sign, 174, 6), glyph('123,456,789', 180, 70)], [glyph(`${sign}123,456,789`, 174, 76)],
        [glyph(sign, 174, 6), glyph('123,', 180, 15), glyph('456,', 195, 30), glyph('789', 225, 25)]]) {
        const result = readPdfAmountColumns([...negative, ...comparison], layout, '千円');
        assert.equal(result.previousYear.valueYen, -123_456_789_000);
        assert.equal(result.request.status, 'blank');
      }
      for (const negative of [[glyph(sign, 239, 6), glyph('123,456,789', 245, 60)], [glyph(`${sign}123,456,789`, 239, 66)]]) {
        const result = readPdfAmountColumns([...negative, ...comparison], layout, '千円');
        assert.equal(result.request.valueYen, -123_456_789_000);
        assert.equal(result.previousYear.status, 'blank');
      }
    }

    const digitStream = readPdfAmountColumns([...Array.from('123456789012', (digit, index) => glyph(digit, 245 + index * 5, 5)), ...comparison], layout, '千円');
    assert.equal(digitStream.previousYear.status, 'extraction_failed');
    assert.equal(digitStream.request.status, 'extraction_failed');
    assert.equal(digitStream.request.valueYen, null);
    const overlap = readPdfAmountColumns([glyph('80', 240, 10), glyph('123,456,789', 245, 60), ...comparison], layout, '千円');
    assert.equal(overlap.request.status, 'extraction_failed');
    assert.equal(overlap.request.valueYen, null);
    assert.equal(overlap.request.raw, '123,456,789');
    assert.equal(overlap.previousYear.status, 'extraction_failed');
  }
  const verifiedTouching = readPdfAmountColumns([glyph('80', 240, 10), glyph('100', 250, 55), glyph('20', 450, 10)], layout, '千円');
  assert.equal(verifiedTouching.previousYear.valueYen, 80_000);
  assert.equal(verifiedTouching.request.valueYen, 100_000);
  const separatedSign = readPdfAmountColumns([glyph('△', 204, 6), glyph('80', 240, 10), glyph('100', 290, 15)], layout, '千円');
  assert.equal(separatedSign.previousYear.valueYen, -80_000);
  assert.equal(separatedSign.request.valueYen, 100_000);
  const mergedCells = readPdfAmountColumns([glyph('100 200', 230, 75)], layout, '千円');
  assert.equal(mergedCells.request.status, 'extraction_failed');
  assert.equal(mergedCells.request.valueYen, null);
  assert.equal(mergedCells.request.raw, '100 200');
  const kerning = readPdfAmountColumns([glyph('123, 456, 789', 245, 60)], layout, '千円');
  assert.equal(kerning.request.valueYen, 123_456_789_000);
  const separated = readPdfAmountColumns([glyph('12', 265, 10), glyph('34', 295, 10)], layout, '千円');
  assert.equal(separated.request.status, 'extraction_failed'); // Never concatenate separate possible values.
});

test('structured year-on-year deltas never become previous-year amounts or inferred source figures', async () => {
  const deltaOnly = await structured('事業名,要求額(千円),対前年度増減額(千円)\n事業A,100,30\n');
  assert.equal(deltaOnly.records[0].amounts.request.valueYen, 100_000);
  assert.equal(deltaOnly.records[0].previousYear.status, 'blank');
  assert.equal(deltaOnly.records[0].previousYear.valueYen, null);
  assert.equal(deltaOnly.records[0].previousYearComparisonBasis, null);
  const explicit = await structured('事業名,要求額(千円),前年度予算額(千円),対前年度増減額(千円)\n事業A,100,70,30\n');
  assert.equal(explicit.status, 'extracted');
  assert.equal(explicit.records[0].previousYear.valueYen, 70_000);
  const conflict = await structured('事業名,要求額(千円),前年度予算額(千円),対前年度増減額(千円)\n事業A,100,70,31\n');
  assert.equal(conflict.records[0].amounts.request.status, 'extraction_failed');
  assert.equal(conflict.records[0].previousYear.status, 'extraction_failed');
});

test('explicit source-URL year and archive rejection precede extraction even for matching table text', async () => {
  for (const url of ['https://www.mof.go.jp/about_mof/mof_budget/budget/fy2021/request.csv', 'https://warp.ndl.go.jp/collections/content/info:ndljp/pid/123/https://www.cao.go.jp/request.csv']) {
    const result = await structured('事業名,要求額(千円)\n事業A,100\n', { url });
    assert.equal(result.status, 'extraction_failed'); assert.equal(result.records.length, 0);
  }
});

test('archiving revenue originals never makes them expenditure rows during replay', async () => {
  for (const metadata of [{ title: '令和9年度歳入概算見積書' }, { validation: ['歳入資料は歳出概算要求の抽出対象外'] }]) {
    const result = await structured('事業名,要求額(千円)\n歳入項目,100\n', metadata);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.records.length, 0);
    assert.deepEqual(result.validation, ['歳入資料は歳出概算要求の抽出対象外']);
  }
});
