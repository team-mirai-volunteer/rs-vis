/**
 * Deterministic, source-bound request extraction. No LLM, OCR, credential, or network calls.
 * The standard 歳出概算要求額明細表 is read by PDF coordinates, never by the order in
 * a PDF content stream (Japanese PDFs often emit comma-separated digits backwards).
 * Other layouts remain explicitly unsupported; an overview is not a detail-table total.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseTable } from './mof-budget-xml';
import { isCurrentRequestSource } from './budget-requests-discover';
import type { AcquisitionStatus, BudgetRequestDocument, BudgetRequestRecord, RequestAmount } from '../types/budget-requests';

type Result = { records: BudgetRequestRecord[]; status: AcquisitionStatus; validation: string[] };
type AmountField = 'request' | 'demand' | 'specialInvestment';
const FIELDS: AmountField[] = ['request', 'demand', 'specialInvestment'];
const UNITS: Record<string, number> = { 円: 1, 千円: 1_000, 万円: 10_000, 百万円: 1_000_000, 億円: 100_000_000, 兆円: 1_000_000_000_000 };
const compact = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').replace(/[‐‑‒–−]/g, '-');
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const blank = (): RequestAmount => ({ valueYen: null, status: 'blank', raw: '' });
function explicitAccount(text: string): string | null {
  const value = compact(text);
  if (value.includes('特別会計')) {
    const name = value.match(/(交付税及び譲与税配付金|地震再保険|国債整理基金|外国為替資金|財政投融資|エネルギー対策|労働保険|年金|食料安定供給|国有林野事業債務管理|特許|自動車安全|東日本大震災復興)特別会計/);
    return name?.[0] ?? '特別会計';
  }
  return value.includes('一般会計') ? '一般会計' : null;
}
function fiscalYear(text: string): number | null {
  const value = compact(text);
  const era = value.match(/(令和|平成)(元|\d+)年度/);
  if (era) return (era[1] === '令和' ? 2018 : 1988) + (era[2] === '元' ? 1 : Number(era[2]));
  return Number(value.match(/(20\d{2})年度/)?.[1]) || null;
}
const findUnit = (text: string): string | null => compact(text).match(/(兆円|億円|百万円|万円|千円|円)/)?.[1] ?? null;

/** Unknown amounts are never converted to zero, and integer yen must be lossless. */
export function parseRequestAmount(raw: string, unit: string | null): RequestAmount {
  let value = compact(raw);
  if (!value || /^[-―—ー]+$/.test(value)) return { ...blank(), raw };
  if (value.includes('事項要求')) return { valueYen: null, status: '事項要求', raw };
  const inlineUnit = value.match(/(兆円|億円|百万円|万円|千円|円)$/)?.[1];
  if (inlineUnit) value = value.slice(0, -inlineUnit.length);
  const scale = UNITS[inlineUnit ?? unit ?? ''];
  const failed: RequestAmount = { valueYen: null, status: 'extraction_failed', raw };
  if (!scale || !/^[△▲+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return failed;
  const negative = /^[△▲-]/.test(value);
  const [integer, fraction = ''] = value.replace(/^[△▲+-]/, '').replace(/,/g, '').split('.');
  const numerator = BigInt(integer + fraction) * BigInt(scale);
  const denominator = BigInt(10) ** BigInt(fraction.length);
  if (numerator % denominator !== BigInt(0)) return failed;
  const yen = Number(numerator / denominator) * (negative ? -1 : 1);
  return Number.isSafeInteger(yen) ? { valueYen: yen, status: 'numeric', raw } : failed;
}

function makeRecord(doc: BudgetRequestDocument, key: string, name: string, unit: string | null,
  source: { page: number | null; cell: string | null; rawQuote: string; method: string }, hash: string): BudgetRequestRecord {
  return {
    id: `br-${digest(`${doc.id}:${key}`).slice(0, 24)}`, documentId: doc.id,
    requestedFY: doc.requestedFY, publicationFY: null, sheetFY: null, ministry: doc.ministry,
    department: null, account: doc.account, subaccount: null, itemCodes: [], requestNumber: null,
    projectName: name, amounts: { request: blank(), demand: blank(), specialInvestment: blank() },
    originalUnit: unit, previousYear: blank(), previousYearComparisonBasis: null,
    documentType: doc.documentType, parentId: null, aggregationFlag: 'unknown',
    provenance: { url: doc.url, page: source.page, cell: source.cell, rawQuote: source.rawQuote, hash,
      retrievedAt: doc.retrievedAt ?? doc.lastAttemptAt, extractionMethod: source.method, validation: [] },
    rsLink: { status: 'unmatched', projectIds: [], sheetFY: null, evidence: null },
  };
}

/** An inconsistent arithmetic triple is not trustworthy numeric source data. */
export function validateRequestYearComparison(record: BudgetRequestRecord, change: RequestAmount): void {
  const request = record.amounts.request;
  const previous = record.previousYear;
  if (change.status === 'numeric' && request.status === 'numeric' && previous.status === 'numeric' &&
      request.valueYen! - previous.valueYen! !== change.valueYen) {
    record.provenance.validation.push(`対前年度比較不一致: ${request.raw} - ${previous.raw} != ${change.raw}`);
    record.amounts.request = { valueYen: null, status: 'extraction_failed', raw: request.raw };
    record.previousYear = { valueYen: null, status: 'extraction_failed', raw: previous.raw };
  }
}

function validateRecord(record: BudgetRequestRecord) {
  for (const field of FIELDS) {
    if (record.amounts[field].status === 'extraction_failed') record.provenance.validation.push(`金額を確定できません: ${field}=${record.amounts[field].raw}`);
  }
  if (record.previousYear.status === 'extraction_failed') record.provenance.validation.push(`前年額を確定できません: ${record.previousYear.raw}`);
  if (/[\uE000-\uF8FF\uFFFD]/.test(record.projectName)) record.provenance.validation.push('名称に未解決のフォント文字があります');
}

/** Compare only a parent and its disjoint immediate numeric descendants, skipping blank wrappers. */
export function validateRequestSubtotals(records: BudgetRequestRecord[]): string[] {
  const children = new Map<string, BudgetRequestRecord[]>();
  for (const record of records) if (record.parentId) {
    const siblings = children.get(record.parentId) ?? [];
    siblings.push(record); children.set(record.parentId, siblings);
  }
  function frontier(record: BudgetRequestRecord, field: AmountField, seen: Set<string>): number | null {
    if (seen.has(record.id)) return null;
    if (record.amounts[field].status === 'numeric') return record.amounts[field].valueYen;
    if (record.amounts[field].status !== 'blank') return null;
    const descendants = children.get(record.id);
    if (!descendants?.length) return null;
    const next = new Set(seen).add(record.id);
    const amounts = descendants.map(child => frontier(child, field, next));
    return amounts.every((amount): amount is number => amount !== null) ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  }
  const validation: string[] = [];
  for (const parent of records) {
    const descendants = children.get(parent.id);
    if (!descendants?.length) continue;
    for (const field of FIELDS) {
      const expected = parent.amounts[field];
      if (expected.status !== 'numeric') continue;
      const amounts = descendants.map(child => frontier(child, field, new Set([parent.id])));
      if (!amounts.every((amount): amount is number => amount !== null)) continue;
      const actual = amounts.reduce((sum, amount) => sum + amount, 0);
      if (actual !== expected.valueYen) {
        const warning = `小計不一致: ${parent.projectName} (${field}) 原文=${expected.valueYen}円 / 子項目=${actual}円`;
        parent.provenance.validation.push(warning); validation.push(warning);
      }
    }
  }
  return validation;
}

export interface PdfGlyph { text: string; x: number; y: number; width: number; height: number }
type Glyph = PdfGlyph;
interface Line { y: number; glyphs: Glyph[] }
/** PDF.js may combine a name/previous cell and the following minus sign into one
 * text item. The sign is the final painted glyph, so anchor it to the item's right
 * edge rather than distributing Japanese letters and synthetic spaces uniformly. */
function splitTrailingSign(glyph: Glyph): Glyph[] {
  const match = glyph.text.match(/^(.*?)([△▲])\s*$/u);
  if (!match || !match[1].trim()) return [glyph];
  const signWidth = Math.min(glyph.width, glyph.height * 0.6);
  const signX = glyph.x + glyph.width - signWidth;
  return [
    { ...glyph, text: match[1].trimEnd(), width: signX - glyph.x },
    { ...glyph, text: match[2], x: signX, width: signWidth },
  ];
}
function linesOf(glyphs: Glyph[]): Line[] {
  const lines: Line[] = [];
  for (const glyph of glyphs.flatMap(splitTrailingSign).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - glyph.y) <= Math.max(1, glyph.height * 0.22)) last.glyphs.push(glyph);
    else lines.push({ y: glyph.y, glyphs: [glyph] });
  }
  for (const line of lines) line.glyphs.sort((a, b) => a.x - b.x);
  return lines;
}
function lineText(line: Line) { return line.glyphs.map(glyph => glyph.text).join(' '); }
function inColumn(line: Line, start: number, end: number): string {
  // Used for names/continuations only. Monetary cells are never cropped into characters.
  return line.glyphs.filter(glyph => glyph.x >= start && glyph.x < end).map(glyph => glyph.text).join('').trim();
}

/** Standard special-account item codes have a 1-, 3-, or 4-digit central segment.
 * Reconstruct the entire adjacent digit/hyphen run before matching, rather than
 * accidentally accepting a suffix or interpreting a request number as a code. */
export function findPdfItemCode(left: Glyph[], previousStart: number, fontHeight: number): Glyph | null {
  const runs: Glyph[] = [];
  for (const glyph of [...left].sort((a, b) => a.x - b.x)) {
    const text = compact(glyph.text);
    if (!/^[\d-]+$/.test(text)) { runs.push({ ...glyph, text }); continue; }
    const prior = runs.at(-1);
    const gap = prior ? glyph.x - (prior.x + prior.width) : Infinity;
    // Missing central digits are visibly padded in the source; up to two ems
    // occur between "95199-" and "9-21-6020". Never bridge the request-number gap.
    if (prior && /^[\d-]+$/.test(prior.text) && gap >= -fontHeight * 0.5 &&
        gap <= fontHeight * (prior.text.includes('-') || text.includes('-') ? 2 : 0.55)) {
      prior.text += text;
      prior.width = glyph.x + glyph.width - prior.x;
    } else runs.push({ ...glyph, text });
  }
  return runs.find(glyph => /^(?:\d{2}-\d{2}|\d{5}-(?:\d|\d{3,4})-\d{2}-\d{4}|\d{2}-\d{4})$/.test(glyph.text))
    ?? runs.find(glyph => /^\d{1,3}$/.test(glyph.text) && glyph.x > previousStart - fontHeight * 23)
    ?? null;
}

type HeaderPosition = { start: number; end: number };
export interface PdfAmountLayout {
  previous: HeaderPosition; request: HeaderPosition; comparison: HeaderPosition; fontHeight: number;
}
/** Read whole positioned amount runs. An item's characters must never be divided
 * at a guessed midpoint: a long right-aligned amount can legitimately cross it.
 * Overlapping/ambiguous cells fail closed even when comparison is nonnumeric. */
export function readPdfAmountColumns(glyphs: Glyph[], layout: PdfAmountLayout, unit: string | null): {
  previousYear: RequestAmount; request: RequestAmount; change: RequestAmount;
} {
  const { previous, request, comparison, fontHeight: em } = layout;
  const anchors = [previous.end, request.end, comparison.end].map(end => end + em / 2);
  const left = previous.start - em / 2;
  const right = anchors[2];
  const tolerance = em / 2;
  const candidates = glyphs.flatMap(splitTrailingSign).filter(glyph => {
    const text = compact(glyph.text);
    // Assemble monetary fragments before applying the left boundary, so a
    // leading sign or digit fragment cannot be discarded from an overflowing run.
    return glyph.x < right && (glyph.x >= left || /^[△▲+-]?[\d,.]+$|^[△▲+-]$/.test(text));
  }).sort((a, b) => a.x - b.x);
  const runs: (Glyph & { numeric: boolean; ambiguousText: boolean })[] = [];
  for (const glyph of candidates) {
    const text = compact(glyph.text);
    const numeric = /^[△▲+-]?[\d,.]+$/.test(text);
    // One PDF text item may span two cells. A bare digit-space-digit sequence
    // cannot establish a single number; comma-space-digit kerning is unambiguous.
    const ambiguousText = /\d\s+\d/u.test(glyph.text.normalize('NFKC'));
    const prior = runs.at(-1);
    const priorEnd = prior ? prior.x + prior.width : -Infinity;
    // Stop at an already complete right-aligned cell. Digit fragments in the
    // same amount end in commas; PDF item order itself is irrelevant.
    const completedCell = prior && /\d$/.test(prior.text) && anchors.slice(0, 2).some(anchor =>
      Math.abs(priorEnd - anchor) <= tolerance && glyph.x + glyph.width > anchor + tolerance);
    const contiguousSign = prior && /^[△▲+-]$/.test(prior.text) && glyph.x >= priorEnd - em * 0.1;
    if (numeric && prior && (prior.numeric || contiguousSign) && !completedCell && glyph.x - priorEnd <= em * 0.55) {
      prior.text += ambiguousText ? glyph.text : text; prior.width = Math.max(priorEnd, glyph.x + glyph.width) - prior.x;
      prior.numeric = true;
      prior.ambiguousText ||= ambiguousText;
    } else runs.push({ ...glyph, text: ambiguousText ? glyph.text : text, numeric, ambiguousText });
  }
  const cells: typeof runs[] = [[], [], []];
  const ambiguous = new Set<number>();
  const touching = new Set<number>();
  for (const run of runs.filter(run => run.x + run.width > left)) {
    const end = run.x + run.width;
    // Signs sit on the left edge of their own cells, unlike right-aligned digits.
    const sign = /^[△▲+-]$/.test(run.text);
    const index = sign
      ? run.x < (previous.end + request.start) / 2 ? 0 : run.x < comparison.start - em ? 1 : 2
      : anchors.findIndex(anchor => end <= anchor + tolerance);
    const column = index < 0 ? 2 : index;
    if (index < 0 || run.ambiguousText) ambiguous.add(column);
    cells[column].push(run);
  }
  // Two distinct values in one cell or physically overlapping monetary runs
  // are not recoverable by concatenation. Preserve all raw digits and fail.
  for (let index = 0; index < cells.length; index++) {
    if (cells[index].filter(run => !/^[△▲+-]$/.test(run.text)).length > 1) ambiguous.add(index);
    for (let other = index + 1; other < cells.length; other++) {
      const a = cells[index].filter(run => run.numeric), b = cells[other].filter(run => run.numeric);
      if (a.some(first => b.some(second => first.x < second.x + second.width && second.x < first.x + first.width - em * 0.1))) {
        ambiguous.add(index); ambiguous.add(other);
      }
      if (a.some(first => b.some(second => {
        const gap = second.x - first.x - first.width;
        return gap >= -em * 0.1 && gap <= em * 0.55;
      }))) { touching.add(index); touching.add(other); }
    }
  }
  const values = cells.map((cell, index) => {
    const raw = cell.map(run => run.text).join('');
    return ambiguous.has(index) ? { valueYen: null, status: 'extraction_failed' as const, raw } : parseRequestAmount(raw, unit);
  });
  // Touching runs at a cell's right anchor can be either two actual values or
  // one overflowing number emitted digit by digit. Only an explicit, consistent
  // three-column comparison disambiguates that split; blank/事項要求 cannot.
  const verifiedTriple = values.every(value => value.status === 'numeric') && values[1].valueYen! - values[0].valueYen! === values[2].valueYen;
  if (!verifiedTriple) for (const index of touching) values[index] = { valueYen: null, status: 'extraction_failed', raw: values[index].raw };
  return { previousYear: values[0], request: values[1], change: values[2] };
}
function labelPosition(line: Line, label: string): { start: number; end: number } | null {
  const chars = line.glyphs.flatMap(glyph => Array.from(glyph.text).map((text, index, array) => ({ text: compact(text), x: glyph.x + glyph.width * index / array.length, end: glyph.x + glyph.width * (index + 1) / array.length }))).filter(char => char.text);
  const index = chars.map(char => char.text).join('').indexOf(label);
  return index < 0 ? null : { start: chars[index].x, end: chars[index + label.length - 1].end };
}

async function extractPdf(bytes: Uint8Array, doc: BudgetRequestDocument, hash: string): Promise<Result> {
  // pdfjs-dist and its CMaps are bundled by the existing pdf-parse dependency.
  const require = createRequire(import.meta.url);
  const pdfBase = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(bytes), cMapUrl: `${pdfBase}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${pdfBase}/standard_fonts/`, useSystemFonts: true, disableFontFace: true,
    isEvalSupported: false, verbosity: 0 }).promise;
  const records: BudgetRequestRecord[] = [];
  const validation: string[] = [];
  const skipped: number[] = [];
  const scanned: number[] = [];
  const stack: { record: BudgetRequestRecord; x: number }[] = [];
  let inheritedUnit: string | null = null;
  let department: string | null = null;
  let account = doc.account;
  let sourceFrame: AmountField = 'request';
  let lastRecord: BudgetRequestRecord | null = null;
  let lastNameX = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = linesOf(content.items.flatMap(item => 'str' in item && item.str.trim() ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }] : []));
      if (!lines.length) { scanned.push(pageNumber); continue; }
      const text = lines.map(lineText).join('\n');
      const titleFY = compact(text).match(/令和(元|\d+)年度歳出概算要求/);
      if (titleFY && 2018 + (titleFY[1] === '元' ? 1 : Number(titleFY[1])) !== doc.requestedFY) {
        return { records: [], status: 'extraction_failed', validation: [`要求年度不一致: 原文=${titleFY[0]} / 対象=${doc.requestedFY}`] };
      }
      const header = lines.find(line => /予算額概算要求額/.test(compact(lineText(line))) && compact(lineText(line)).includes('比較増'));
      if (!header) { skipped.push(pageNumber); lastRecord = null; continue; }
      const previous = labelPosition(header, '予算額')!;
      const request = labelPosition(header, '概算要求額')!;
      const comparison = labelPosition(header, '比較増')!;
      // Accept only the standard narrow previous/request columns and a separate
      // comparison column. A summary's category subtotals must not be concatenated.
      const fontHeight = Math.max(...header.glyphs.map(glyph => glyph.height));
      if (request.start - previous.start > fontHeight * 12 || comparison.start <= request.end) {
        skipped.push(pageNumber); continue;
      }
      const previousBoundary = previous.start - fontHeight / 2;
      const pageHeader = lines.filter(line => line.y > header.y).map(lineText).join(' ');
      account = explicitAccount(pageHeader) ?? account;
      // A discovered link's surrounding text can mention sibling demand/investment
      // PDFs. Only the actual PDF header may move an amount out of normal requests.
      if (/投資枠/.test(compact(pageHeader))) sourceFrame = 'specialInvestment';
      else if (/要望/.test(compact(pageHeader))) sourceFrame = 'demand';
      else if (/歳出概算要求額明細表/.test(compact(pageHeader))) sourceFrame = 'request';
      if ((doc.documentType === 'demand_list' || doc.documentType === 'investment_list') && sourceFrame === 'request') {
        const warning = 'リンク分類と原表見出しが異なります。標準概算要求明細は通常要求として抽出しました';
        if (!validation.includes(warning)) validation.push(warning);
      }
      const declaredUnit = lines.filter(line => line.y > header.y).map(lineText).join(' ').match(/単\s*位\s*[:：]?\s*(兆円|億円|百万円|万円|千円|円)/)?.[1];
      if (declaredUnit) inheritedUnit = declaredUnit;
      if (!inheritedUnit) validation.push(`PDF ${pageNumber}ページ: 金額単位を確認できません`);
      for (const line of lines.filter(line => line.y < header.y - fontHeight)) {
        const left = line.glyphs.filter(glyph => glyph.x < previousBoundary);
        if (!left.length) continue; // Never ingest amounts or future-year commitments in 備考.
        const codeGlyph = findPdfItemCode(left, previous.start, fontHeight);
        if (!codeGlyph) {
          // A continuation has no code or amount and stays at the prior name's indent.
          const continuation = compact(inColumn(line, lastNameX - 1, previousBoundary));
          if (lastRecord && left[0].x >= lastNameX - 1 && continuation &&
              !inColumn(line, previousBoundary, comparison.start - fontHeight)) {
            lastRecord.projectName += continuation;
            lastRecord.provenance.rawQuote += `\n${lineText(line)}`;
          } else if (inColumn(line, previousBoundary, comparison.start - fontHeight)) {
            validation.push(`PDF ${pageNumber}ページ y=${line.y.toFixed(2)}: 未解決の明細行 (${lineText(line).slice(0, 160)})`);
          }
          continue;
        }
        const code = compact(codeGlyph.text);
        const nameGlyphs = left.filter(glyph => glyph.x > codeGlyph.x + codeGlyph.width - 1);
        const name = compact(nameGlyphs.map(glyph => glyph.text).join(''));
        if (!name || !/[\p{L}]/u.test(name)) continue;
        const ownRequest = left.filter(glyph => glyph.x < codeGlyph.x - 1).map(glyph => compact(glyph.text)).find(value => /^\d+$/.test(value)) ?? null;
        while (stack.length && stack[stack.length - 1].x >= codeGlyph.x - 1) stack.pop();
        const parent = stack[stack.length - 1]?.record;
        const record = makeRecord(doc, `pdf:${pageNumber}:${line.y.toFixed(2)}:${code}:${name}`, name, inheritedUnit,
          { page: pageNumber, cell: `y=${line.y.toFixed(2)};x=${codeGlyph.x.toFixed(2)}`, rawQuote: lineText(line), method: 'pdfjs-coordinate-standard-request-table-v1' }, hash);
        record.itemCodes = [...(parent?.itemCodes ?? []), code];
        record.parentId = parent?.id ?? null;
        record.requestNumber = /^\d{2}-\d{2}$/.test(code) ? ownRequest : parent?.requestNumber ?? null;
        if (!parent && /^\d{3}$/.test(code)) department = name;
        record.department = department;
        record.account = account;
        record.subaccount = /^\d$/.test(code) && name.endsWith('勘定') ? name : parent?.subaccount ?? null;
        const changeHeader = labelPosition(header, '比較増△減') ?? comparison;
        const amounts = readPdfAmountColumns(line.glyphs, { previous, request, comparison: changeHeader, fontHeight }, inheritedUnit);
        record.amounts.request = amounts.request;
        record.previousYear = amounts.previousYear;
        validateRequestYearComparison(record, amounts.change);
        record.previousYearComparisonBasis = `${doc.requestedFY - 1}年度予算額（原表の前年度予算額）`;
        record.documentType = sourceFrame === 'demand' ? 'demand_list' : sourceFrame === 'specialInvestment' ? 'investment_list' : 'accounting_table';
        if (sourceFrame !== 'request') { record.amounts[sourceFrame] = record.amounts.request; record.amounts.request = blank(); }
        record.aggregationFlag = parent ? 'detail' : /^\d{3}$/.test(code) && codeGlyph.x < previous.start - fontHeight * 21.5 ? 'total' : 'unknown';
        if (parent && parent.aggregationFlag !== 'total') parent.aggregationFlag = 'subtotal';
        records.push(record); stack.push({ record, x: codeGlyph.x });
        lastRecord = record; lastNameX = nameGlyphs[0]?.x ?? codeGlyph.x + codeGlyph.width;
      }
      page.cleanup();
    }
  } finally { await pdf.destroy(); }
  for (const record of records) validateRecord(record);
  validation.push(...validateRequestSubtotals(records));
  if (skipped.length) validation.push(`未対応レイアウトのページ（表紙・目次・総表等を含む）: ${skipped.join(', ')}`);
  // Empty pages may be intentional separators; report without claiming OCR succeeded.
  if (scanned.length) validation.push(`テキストのないページ（空白または画像。OCR未実施）: ${scanned.join(', ')}`);
  if (!records.length) return { records, status: 'unsupported', validation: [...validation, '対応する歳出概算要求額明細表がありません。概要・要望・投資枠の金額は推測しません'] };
  if (records.some(record => record.provenance.validation.length)) validation.push('一部のレコードに金額・名称・小計の検証警告があります');
  return { records, status: validation.length ? 'partial' : 'extracted', validation };
}

interface StructuredRow { cells: string[]; raw: string; page: number | null; location: string }
function parseCsv(text: string, separator = ','): StructuredRow[] {
  const rows: StructuredRow[] = [];
  let cells: string[] = [], cell = '', quoted = false, start = 0, line = 1, startLine = 1;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if ((char === separator || char === '\n' || char === undefined) && !quoted) {
      cells.push(cell); cell = '';
      if (char !== separator) {
        if (cells.some(value => value.trim())) rows.push({ cells, raw: text.slice(start, i), page: null, location: `row:${startLine}` });
        cells = []; start = i + 1; startLine = line + 1;
      }
    } else if (char !== undefined && char !== '\r') cell += char;
    if (char === '\n') line++;
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません');
  return rows;
}

function fieldForHeader(label: string): AmountField | 'previousYear' | 'change' | null {
  const value = compact(label);
  if (/増減|比較|増加|減少/.test(value)) return /(?:前年度|前年).*(?:増減|比較|増加|減少).*額|(?:対前年度)?比較増△減/.test(value) ? 'change' : null;
  if (/前年度.*(?:予算|要求)|前年.*額/.test(value)) return 'previousYear';
  if (/投資.*(?:額|要求|枠)|(?:特別|特別な)投資/.test(value)) return 'specialInvestment';
  if (/要望.*(?:額|枠)|要望額/.test(value)) return 'demand';
  if (/(?:概算)?要求額/.test(value) && !/増減|比較/.test(value)) return 'request';
  return null;
}
function extractStructured(rows: StructuredRow[], doc: BudgetRequestDocument, hash: string, method: string): Result {
  const headerIndex = rows.findIndex(row => row.cells.some(cell => fieldForHeader(cell)) && row.cells.some(cell => /^(?:事業名|事業名称|事項|事項名|項目名|名称|目名)$/.test(compact(cell))));
  if (headerIndex < 0) return { records: [], status: 'unsupported', validation: ['事項・事業名と要求枠を明示した表ヘッダーがありません'] };
  const headers = rows[headerIndex].cells;
  const normalized = headers.map(compact);
  const nameIndex = normalized.findIndex(value => /^(?:事業名|事業名称|事項|事項名|項目名|名称|目名)$/.test(value));
  const unitIndex = normalized.findIndex(value => value === '単位');
  const requestNumberIndex = normalized.findIndex(value => value === '要求番号');
  const aggregationIndex = normalized.findIndex(value => /^(?:集計区分|行区分)$/.test(value));
  const accountIndex = normalized.findIndex(value => /^(?:会計|会計名)$/.test(value));
  const departmentIndex = normalized.findIndex(value => /^(?:組織|組織名|部局|部局名)$/.test(value));
  const subaccountIndex = normalized.findIndex(value => /^(?:勘定|勘定名)$/.test(value));
  const yearIndex = normalized.findIndex(value => /^(?:要求年度|対象年度)$/.test(value));
  const columns = headers.map((label, index) => ({ field: fieldForHeader(label), index, unit: findUnit(label) })).filter(column => column.field);
  const wrongYear = columns.find(column => column.field !== 'previousYear' && column.field !== 'change' && fiscalYear(headers[column.index]) !== null && fiscalYear(headers[column.index]) !== doc.requestedFY);
  if (wrongYear) return { records: [], status: 'extraction_failed', validation: [`要求年度不一致: ${headers[wrongYear.index]} / 対象=${doc.requestedFY}`] };
  const duplicateField = columns.find((column, index) => columns.slice(index + 1).some(other => other.field === column.field));
  if (duplicateField) return { records: [], status: 'unsupported', validation: [`同じ要求枠の金額列が複数あり選択できません: ${duplicateField.field}`] };
  const records: BudgetRequestRecord[] = [], validation: string[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.cells.every((value, index) => compact(value) === normalized[index])) continue;
    if (row.cells.length !== headers.length) { validation.push(`${row.location}: 列数が一致しません`); continue; }
    const name = row.cells[nameIndex]?.trim();
    if (!name) continue;
    const year = compact(row.cells[yearIndex] ?? '');
    if (year && year !== String(doc.requestedFY) && year !== `令和${doc.requestedFY - 2018}年度`) { validation.push(`${row.location}: 要求年度不一致 (${year})`); continue; }
    const unit = findUnit(row.cells[unitIndex] ?? '') ?? columns.find(column => column.unit)?.unit ?? null;
    const record = makeRecord(doc, `${method}:${row.location}:${name}`, name, unit, { page: row.page, cell: row.location, rawQuote: `${headers.join(' | ')}\n${row.raw}`, method }, hash);
    record.account = row.cells[accountIndex]?.trim() || doc.account;
    record.department = row.cells[departmentIndex]?.trim() || null;
    record.subaccount = row.cells[subaccountIndex]?.trim() || null;
    record.requestNumber = row.cells[requestNumberIndex]?.trim() || null;
    record.itemCodes = row.cells.filter((_, index) => /コード$/.test(normalized[index])).filter(Boolean);
    let change = blank();
    for (const column of columns) {
      const value = parseRequestAmount(row.cells[column.index] ?? '', column.unit ?? unit);
      if (column.field === 'previousYear') { record.previousYear = value; record.previousYearComparisonBasis = headers[column.index]; }
      else if (column.field === 'change') change = value;
      else record.amounts[column.field!] = value;
    }
    validateRequestYearComparison(record, change);
    const explicitlyNormal = columns.some(column => column.field === 'request' && /概算要求/.test(compact(headers[column.index])));
    if (doc.documentType === 'demand_list' && !explicitlyNormal && !columns.some(column => column.field === 'demand')) { record.amounts.demand = record.amounts.request; record.amounts.request = blank(); }
    if (doc.documentType === 'investment_list' && !explicitlyNormal && !columns.some(column => column.field === 'specialInvestment')) { record.amounts.specialInvestment = record.amounts.request; record.amounts.request = blank(); }
    const aggregation = compact(row.cells[aggregationIndex] ?? name);
    record.aggregationFlag = /^(?:総計|合計|総額|total)$/.test(aggregation) ? 'total' : /^(?:小計|subtotal)$/.test(aggregation) ? 'subtotal' : 'detail';
    validateRecord(record); records.push(record);
  }
  if (records.some(record => record.provenance.validation.length)) validation.push('一部のレコードの金額または名称を確定できません');
  return { records, status: !records.length ? 'extraction_failed' : validation.length ? 'partial' : 'extracted', validation };
}

function extractXml(text: string, doc: BudgetRequestDocument, hash: string): Result {
  // Reuse the existing MOF clm-coordinate reader; never resolve XML entities/DTDs.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { records: [], status: 'unsupported', validation: ['DTD・実体宣言を含むXMLには対応していません'] };
  const table = parseTable(text);
  if (!table.headerCols.size) return { records: [], status: 'unsupported', validation: ['対応する財務省clm形式のXML表ヘッダーがありません'] };
  const indices = [...new Set(table.headerCols.values())].sort((a, b) => a - b);
  const headers = indices.map(index => [...table.headerCols.entries()].filter(([, col]) => col === index).map(([label]) => label).join(''));
  const validation: string[] = [];
  const rows: StructuredRow[] = [{ cells: headers, raw: headers.join(' | '), page: null, location: 'header' }, ...table.rows.map(row => {
    const cells = indices.map(index => {
      const cell = row.cols.get(index) ?? [];
      if (fieldForHeader(headers[indices.indexOf(index)])) {
        if (cell.filter(value => value.text.trim()).length > 1) { validation.push(`p${row.page}-r${row.row}-c${index}: 複数金額セルを確定できません`); return '[複数金額セル]'; }
        return cell[0]?.text ?? '';
      }
      return cell.map(value => value.text).join('');
    });
    return { cells, raw: cells.join(' | '), page: row.page, location: `p${row.page}-r${row.row}` };
  })];
  const result = extractStructured(rows, doc, hash, 'mof-xml-clm-v1');
  result.validation.push(...validation);
  if (validation.length && result.status === 'extracted') result.status = 'partial';
  return result;
}

export async function extractRequestDocument(bytes: Uint8Array, doc: BudgetRequestDocument): Promise<Result> {
  const hash = digest(bytes);
  if (!isCurrentRequestSource(doc.url, doc.requestedFY)) return { records: [], status: 'extraction_failed', validation: ['公式の対象年度資料として確認できないURLです'] };
  try {
    if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-') return await extractPdf(bytes, doc, hash);
    const contentType = doc.contentType ?? '';
    // XLSX MIME contains the string 'openxmlformats' but its bytes are a ZIP, not XML.
    if (/\.(?:xlsx?|zip)(?:[?#]|$)/i.test(doc.url) || /spreadsheetml|ms-excel|application\/zip/i.test(contentType) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      return { records: [], status: 'unsupported', validation: ['Excel・ZIP内包表の数値抽出は未対応です'] };
    }
    if (!/csv|tab-separated|xml/i.test(contentType) && !/\.(?:csv|tsv|xml)(?:[?#]|$)/i.test(doc.url)) {
      return { records: [], status: 'unsupported', validation: ['対応形式は標準明細PDF・ヘッダー付きCSV/TSV・財務省clm形式XMLです'] };
    }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
    text = text.replace(/^\uFEFF/, '');
    if (/xml/i.test(contentType) || /\.xml(?:[?#]|$)/i.test(doc.url)) return extractXml(text, doc, hash);
    if (/tab-separated/i.test(contentType) || /\.tsv(?:[?#]|$)/i.test(doc.url)) return extractStructured(parseCsv(text, '\t'), doc, hash, 'tsv-header-v1');
    if (/csv/i.test(contentType) || /\.csv(?:[?#]|$)/i.test(doc.url)) return extractStructured(parseCsv(text), doc, hash, 'csv-header-v1');
    return { records: [], status: 'unsupported', validation: ['対応形式は標準明細PDF・ヘッダー付きCSV・財務省clm形式XMLです'] };
  } catch (error) {
    return { records: [], status: 'extraction_failed', validation: [`抽出失敗: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
