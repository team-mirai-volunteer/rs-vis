/**
 * 概算要求（原資料の明細表）と RS 事業の対応を作る。
 *
 * 入力:
 *   - public/data/budget-requests-{FY}.json(.gz): 自動取得した概算要求の明細行（scripts/fetch-budget-requests.ts）
 *   - data/year_{SHEET}/2-2_RS_{SHEET}_予算・執行_予算種別・歳出予算項目.csv: 事業ごとの 所管・組織・項・目・予算額・翌年度要求額
 * 出力:
 *   - public/data/budget-request-links-{FY}.json.gz（types/budget-request-links.ts）
 *
 * 突き合わせの鍵は (所管, 組織・勘定, 項, 目)。明細表側の 項 は、組織（3桁コード）直下の 3 桁コードの行、
 * 目 は 5-4-2-4 桁の科目コードを持つ行とする。同じ 項・目 の複数行（事項ごとの内訳）は合算する。
 * 項 で一致しない場合だけ、組織内で 目 の名前が一意なら採用する（matchedBy: 'moku-unique'）。
 *
 * 使い方: npx tsx scripts/generate-budget-request-links.ts [--fy 2027] [--sheet 2025]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import type { BudgetRequestDataset, BudgetRequestRecord } from '../types/budget-requests';
import type { BudgetRequestLinkItem, BudgetRequestLinksFile, BudgetRequestMinistryTotal, BudgetRequestProjectLinks, BudgetRequestUnmatchedItem } from '../types/budget-request-links';

const FULL_CODE = /^\d{5}-\d{1,4}-\d{2}-\d{4}$/;
const KOU_CODE = /^\d{3}$/;

/** 表記ゆれを吸収する: 空白・全角括弧・中黒の違いだけを無視する */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/[\s　]/g, '').replace(/[・･]/g, '');
}

interface PdfMoku { requestYen: number; previousYen: number | null; rows: number; url: string; page: number | null; documentTitle: string }
/** byKouMoku: (所管,組織,項,目) → 合算。byMoku: (所管,組織,目) → 項ごとの合算（項が1つだけなら 目 の名前で引ける） */
/** bySubKouMoku / bySubMoku: 特別会計の (勘定, 項, 目)。共管の特会は複数府省の掲載から同じ資料が入るので、行は出典（URL・ページ・コード・名前）で重複排除する */
interface PdfIndex { byKouMoku: Map<string, PdfMoku>; byMoku: Map<string, Map<string, PdfMoku>>; bySubKouMoku: Map<string, PdfMoku>; bySubMoku: Map<string, Map<string, PdfMoku>>; ministries: Set<string>; subaccounts: Set<string> }

const key4 = (ministry: string, organization: string, kou: string, moku: string) => [ministry, organization, kou, moku].map(normalizeName).join('|');
const key3 = (ministry: string, organization: string, moku: string) => [ministry, organization, moku].map(normalizeName).join('|');

function accumulate(map: Map<string, PdfMoku>, key: string, record: BudgetRequestRecord, documentTitle: string) {
  const previous = record.previousYear.status === 'numeric' ? record.previousYear.valueYen : null;
  const existing = map.get(key);
  if (!existing) { map.set(key, { requestYen: record.amounts.request.valueYen!, previousYen: previous, rows: 1, url: record.provenance.url, page: record.provenance.page, documentTitle }); return; }
  existing.requestYen += record.amounts.request.valueYen!;
  existing.previousYen = existing.previousYen === null ? previous : previous === null ? existing.previousYen : existing.previousYen + previous;
  existing.rows += 1;
}

/** 明細表の行から (所管, 組織, 項, 目) ごとの要求額を集める */
export function indexRequestRecords(data: BudgetRequestDataset): PdfIndex {
  const byId = new Map(data.records.map(record => [record.id, record]));
  const docs = new Map(data.documents.map(document => [document.id, document]));
  const kouOf = (record: BudgetRequestRecord): string | null => {
    if (record.itemCodes.length < 2 || !KOU_CODE.test(record.itemCodes[1])) return null;
    let current = record.parentId ? byId.get(record.parentId) : undefined;
    while (current) {
      if (current.itemCodes.length === 2) return current.projectName;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return null;
  };
  const byKouMoku = new Map<string, PdfMoku>();
  const byMoku = new Map<string, Map<string, PdfMoku>>();
  const bySubKouMoku = new Map<string, PdfMoku>();
  const bySubMoku = new Map<string, Map<string, PdfMoku>>();
  const ministries = new Set<string>();
  const subaccounts = new Set<string>();
  const seenSubRows = new Set<string>();
  for (const record of data.records) {
    const code = record.itemCodes.at(-1);
    if (!code || !FULL_CODE.test(code) || record.amounts.request.status !== 'numeric' || record.amounts.request.valueYen === null) continue;
    ministries.add(record.ministry);
    const documentTitle = docs.get(record.documentId)?.title ?? '';
    const kou = kouOf(record) ?? '';
    if (record.subaccount) {
      const rowKey = `${record.provenance.url}|${record.provenance.page}|${record.itemCodes.join('/')}|${record.projectName}|${record.amounts.request.valueYen}`;
      if (!seenSubRows.has(rowKey)) {
        seenSubRows.add(rowKey);
        subaccounts.add(normalizeName(record.subaccount));
        if (kou) accumulate(bySubKouMoku, [record.subaccount, kou, record.projectName].map(normalizeName).join('|'), record, documentTitle);
        const subKey = [record.subaccount, record.projectName].map(normalizeName).join('|');
        const perKou = bySubMoku.get(subKey) ?? new Map<string, PdfMoku>();
        accumulate(perKou, normalizeName(kou), record, documentTitle);
        bySubMoku.set(subKey, perKou);
      }
    }
    const department = record.department || record.ministry;
    if (kou) accumulate(byKouMoku, key4(record.ministry, department, kou, record.projectName), record, documentTitle);
    const k3 = key3(record.ministry, department, record.projectName);
    const perKou = byMoku.get(k3) ?? new Map<string, PdfMoku>();
    accumulate(perKou, normalizeName(kou), record, documentTitle);
    byMoku.set(k3, perKou);
  }
  return { byKouMoku, byMoku, bySubKouMoku, bySubMoku, ministries, subaccounts };
}

interface RsLine { pid: string; ministry: string; organization: string; kou: string; moku: string; budgetYen: number; nextRequestYen: number }

/** RS 2-2 の当初予算行（シート年度の予算年度）を (事業, 所管, 組織, 項, 目) で合算する */
export function readRsLineItems(csvPath: string, sheetYear: number): RsLine[] {
  const rows = readShiftJISCSV(csvPath);
  const grouped = new Map<string, RsLine>();
  for (const row of rows) {
    if (row['予算種別'] !== '当初予算' || row['予算年度'] !== String(sheetYear)) continue;
    const pid = row['予算事業ID']; const moku = (row['目'] ?? '').trim();
    if (!pid || !moku) continue;
    const line: RsLine = { pid, ministry: row['所管'] ?? '', organization: row['組織・勘定'] ?? '', kou: row['項'] ?? '', moku,
      budgetYen: parseAmount(row['予算額(歳出予算項目ごと)'] ?? '0'), nextRequestYen: parseAmount(row['翌年度要求額(歳出予算項目ごと)'] ?? '0') };
    const key = `${pid}|${key4(line.ministry, line.organization, line.kou, line.moku)}`;
    const existing = grouped.get(key);
    if (existing) { existing.budgetYen += line.budgetYen; existing.nextRequestYen += line.nextRequestYen; }
    else grouped.set(key, line);
  }
  return [...grouped.values()];
}

export function buildLinks(data: BudgetRequestDataset, lines: RsLine[], sheetYear: number, now = new Date().toISOString()): BudgetRequestLinksFile {
  const index = indexRequestRecords(data);
  const crawled = new Set([...index.ministries].map(normalizeName));
  const byPid: Record<string, BudgetRequestProjectLinks> = {};
  let keys = 0, matchedKeys = 0;
  for (const line of lines) {
    const entry = byPid[line.pid] ??= { coverage: 'no-line-items', items: [], unmatched: [] };
    // 明細表側の「府省」は財務省の索引の行名。RS の 所管（内閣・内閣府・国会）の下にある 組織（内閣官房・こども家庭庁・
    // 警察庁・衆議院など）が索引では独立した行になっているので、所管 と 組織 の両方で引く
    // 共管（「内閣府及び厚生労働省」「内閣府、文部科学省、経済産業省及び環境省」）は府省ごとに分けて引く
    const ministryNames = line.ministry.split(/及び|、/).map(name => name.trim()).filter(Boolean);
    const ministryKeys = [...new Set([...ministryNames, line.organization])].filter(name => crawled.has(normalizeName(name)));
    // 特別会計: RS の 組織・勘定 は勘定名。明細表側は勘定名（subaccount）で引く（掲載府省は法的所管と一致しないことがある）
    const subaccount = index.subaccounts.has(normalizeName(line.organization)) ? line.organization : null;
    if (!ministryKeys.length && !subaccount) { if (entry.coverage === 'no-line-items') entry.coverage = 'not-crawled'; continue; }
    keys += 1;
    let match: PdfMoku | undefined;
    let matchedBy: BudgetRequestLinkItem['matchedBy'] = 'kou-moku';
    for (const ministry of ministryKeys) {
      match = index.byKouMoku.get(key4(ministry, line.organization, line.kou, line.moku));
      if (match) break;
    }
    if (!match && subaccount) match = index.bySubKouMoku.get([subaccount, line.kou, line.moku].map(normalizeName).join('|'));
    if (!match) for (const ministry of ministryKeys) {
      const candidates = index.byMoku.get(key3(ministry, line.organization, line.moku));
      if (candidates && candidates.size === 1) { match = [...candidates.values()][0]; matchedBy = 'moku-unique'; break; }
    }
    if (!match && subaccount) {
      const candidates = index.bySubMoku.get([subaccount, line.moku].map(normalizeName).join('|'));
      if (candidates && candidates.size === 1) { match = [...candidates.values()][0]; matchedBy = 'moku-unique'; }
    }
    if (match) {
      matchedKeys += 1;
      entry.items.push({ ministry: line.ministry, organization: line.organization, kou: line.kou, moku: line.moku, rsBudgetYen: line.budgetYen, rsNextRequestYen: line.nextRequestYen,
        requestYen: match.requestYen, previousYen: match.previousYen, rows: match.rows, url: match.url, page: match.page, documentTitle: match.documentTitle, matchedBy });
    } else {
      const unmatched: BudgetRequestUnmatchedItem = { ministry: line.ministry, organization: line.organization, kou: line.kou, moku: line.moku, rsBudgetYen: line.budgetYen, rsNextRequestYen: line.nextRequestYen };
      entry.unmatched.push(unmatched);
    }
  }
  let linked = 0, noMatch = 0, notCrawled = 0;
  for (const entry of Object.values(byPid)) {
    if (entry.items.length) { entry.coverage = 'linked'; linked += 1; }
    else if (entry.unmatched.length) { entry.coverage = 'no-match'; noMatch += 1; }
    else if (entry.coverage === 'not-crawled') notCrawled += 1;
    entry.items.sort((a, b) => (b.rsBudgetYen - a.rsBudgetYen) || a.moku.localeCompare(b.moku, 'ja'));
  }
  const docs = new Map(data.documents.map(document => [document.id, document]));
  const ministries: BudgetRequestMinistryTotal[] = data.records.filter(record => record.aggregationFlag === 'total').map(record => ({
    ministry: record.ministry, organization: record.projectName, account: record.account,
    requestYen: record.amounts.request.status === 'numeric' ? record.amounts.request.valueYen : null,
    previousYen: record.previousYear.status === 'numeric' ? record.previousYear.valueYen : null,
    url: record.provenance.url, page: record.provenance.page, documentTitle: docs.get(record.documentId)?.title ?? '',
  })).sort((a, b) => a.ministry.localeCompare(b.ministry, 'ja') || (b.requestYen ?? 0) - (a.requestYen ?? 0));
  return { schemaVersion: 1, requestedFY: data.requestedFY, sheetYear, generatedAt: now, crawledMinistries: [...index.ministries].sort((a, b) => a.localeCompare(b, 'ja')),
    byPid, ministries, stats: { projects: Object.keys(byPid).length, linked, noMatch, notCrawled, keys, matchedKeys } };
}

function readDataset(fy: number): BudgetRequestDataset {
  const base = path.join(process.cwd(), 'public', 'data', `budget-requests-${fy}.json`);
  if (existsSync(base)) return JSON.parse(readFileSync(base, 'utf8'));
  return JSON.parse(gunzipSync(readFileSync(`${base}.gz`)).toString('utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: number) => { const i = args.indexOf(name); return i < 0 ? fallback : Number(args[i + 1]); };
  const fy = option('--fy', 2027); const sheetYear = option('--sheet', 2025);
  const csv = path.join(process.cwd(), 'data', `year_${sheetYear}`, `2-2_RS_${sheetYear}_予算・執行_予算種別・歳出予算項目.csv`);
  const result = buildLinks(readDataset(fy), readRsLineItems(csv, sheetYear), sheetYear);
  const output = path.join(process.cwd(), 'public', 'data', `budget-request-links-${fy}.json`);
  const json = JSON.stringify(result);
  writeFileSync(output, json);
  writeFileSync(`${output}.gz`, gzipSync(json, { level: 9 }));
  console.log(JSON.stringify({ ...result.stats, crawledMinistries: result.crawledMinistries.length, ministryTotals: result.ministries.length, output }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
