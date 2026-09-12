/**
 * 「一括計上予算」（決算段階で初めて所管に出現する項＝予算移替の受け皿）を
 * 年度横断で洗い出し、data/result/mof-lump-sum-budget-{年度}.csv に出力する。
 *
 * 手法: 一般会計 歳出について「当初(11001)＋補正(21001〜21004)」に存在する
 * (所管,項コード,項名) の集合と、決算(77001)に存在する集合を突合し、
 * 決算にのみ存在する項を「決算で初めて計上された項」として抽出する。
 * 詳細は docs/tasks/20260901_2308_予算移替は一括計上予算という標準的な仕組み.md 参照。
 *
 * 実行: npx tsx scripts/analyze-mof-lump-sum-budget.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';

type Row = Record<string, string>;

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const RESULT_DIR = path.join(process.cwd(), 'data', 'result');

function zipPath(year: number, suffix: string): string {
  return path.join(process.cwd(), 'data', 'download', `mof_${year}`, `DL${year}${suffix}.zip`);
}

function parseCsv(content: string): Row[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: Row = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

/** 歳出側(b想定)のCSVを読む。無ければ null */
function readExpenditure(year: number, suffix: string): Row[] | null {
  const zp = zipPath(year, suffix);
  if (!fs.existsSync(zp)) return null;
  const entries = listZipEntries(zp).filter(e => e.toLowerCase().endsWith('.csv'));
  for (const entry of entries) {
    const rows = parseCsv(readZipEntryText(zp, entry, 'utf-8'));
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    if (headers.some(h => h.includes('主要経費別分類'))) return rows;
  }
  return null;
}

/** 予算額の列名を解決する（年度・帳票で表記揺れがある） */
function findAmountColumn(row: Row, candidates: RegExp[]): string {
  const keys = Object.keys(row);
  for (const re of candidates) {
    const found = keys.find(k => re.test(k));
    if (found) return found;
  }
  throw new Error(`金額列が見つかりません: ${keys.join(', ')}`);
}

function key(row: Row): string {
  return `${row['所管']}|${row['項コード']}|${row['項名']}`;
}

interface LumpSumRow {
  年度: number;
  所管: string;
  組織: string;
  項コード: string;
  項名: string;
  主要経費別分類コード: string;
  決算歳出予算額円: number;
  支出済歳出額円: number;
  目数: number;
  一括計上元所管: string;
  一括計上元項コード: string;
}

function analyzeYear(year: number): LumpSumRow[] {
  const touki = readExpenditure(year, '11001');
  if (!touki) throw new Error(`${year}: 当初予算(11001)が読めません`);

  const hoseiRowsList: Row[][] = [];
  for (const n of [1, 2, 3, 4]) {
    const suffix = `2100${n}`;
    const rows = readExpenditure(year, suffix);
    if (rows) hoseiRowsList.push(rows);
  }

  const kessan = readExpenditure(year, '77001');
  if (!kessan) throw new Error(`${year}: 決算(77001)が読めません`);

  // 予算段階(当初+補正)の集合と、代表金額(最終補正 or 当初)を保持
  const preDecision = new Map<string, { 所管: string; 項コード: string; 金額: number }>();

  const toukiAmountCol = findAmountColumn(touki[0], [/^(令和|平成).*年度要求額/]);
  for (const row of touki) {
    const k = key(row);
    const raw = row[toukiAmountCol]?.replace(/,/g, '');
    const amount = raw ? parseInt(raw, 10) * 1000 : 0;
    preDecision.set(k, { 所管: row['所管'], 項コード: row['項コード'], 金額: amount });
  }
  for (const hoseiRows of hoseiRowsList) {
    const col = findAmountColumn(hoseiRows[0], [/^改(令和|平成).*年度予算額/]);
    for (const row of hoseiRows) {
      const k = key(row);
      const raw = row[col]?.replace(/,/g, '');
      const amount = raw ? parseInt(raw, 10) * 1000 : 0;
      preDecision.set(k, { 所管: row['所管'], 項コード: row['項コード'], 金額: amount });
    }
  }

  // 項名だけで引ける索引（一括計上元の特定用）。予算段階で保持していた所管を項名で引けるようにする。
  const nameToSyokan = new Map<string, Set<string>>();
  for (const row of touki) {
    const name = row['項名'];
    if (!nameToSyokan.has(name)) nameToSyokan.set(name, new Set());
    nameToSyokan.get(name)!.add(`${row['所管']}|${row['項コード']}`);
  }
  for (const hoseiRows of hoseiRowsList) {
    for (const row of hoseiRows) {
      const name = row['項名'];
      if (!nameToSyokan.has(name)) nameToSyokan.set(name, new Set());
      nameToSyokan.get(name)!.add(`${row['所管']}|${row['項コード']}`);
    }
  }

  // 決算を (所管,項コード,項名,組織) 単位で集計
  const kessanAmountCol = '歳出予算額(円)';
  const spentCol = '支出済歳出額(円)';
  const grouped = new Map<
    string,
    { 所管: string; 組織: string; 項コード: string; 項名: string; 主要経費別分類コード: string; amount: number; spent: number; count: number }
  >();
  for (const row of kessan) {
    const k = key(row);
    if (preDecision.has(k)) continue; // 予算段階から存在＝一括計上の受け皿ではない
    if (!grouped.has(k)) {
      grouped.set(k, {
        所管: row['所管'],
        組織: row['組織'],
        項コード: row['項コード'],
        項名: row['項名'],
        主要経費別分類コード: row['主要経費別分類コード'],
        amount: 0,
        spent: 0,
        count: 0,
      });
    }
    const g = grouped.get(k)!;
    g.amount += parseInt(row[kessanAmountCol] || '0', 10) || 0;
    g.spent += parseInt(row[spentCol] || '0', 10) || 0;
    g.count += 1;
  }

  const result: LumpSumRow[] = [];
  for (const g of grouped.values()) {
    const candidates = nameToSyokan.get(g.項名);
    let origin所管 = '';
    let origin項コード = '';
    if (candidates && candidates.size >= 1) {
      // 予算段階で保持していた所管群のうち、決算で受け皿になった当の所管自身は除く
      const others = [...candidates].filter(c => !c.startsWith(`${g.所管}|`));
      if (others.length >= 1) {
        const [syokan, koCode] = others[0].split('|');
        origin所管 = syokan;
        origin項コード = koCode;
      }
    }
    result.push({
      年度: year,
      所管: g.所管,
      組織: g.組織,
      項コード: g.項コード,
      項名: g.項名,
      主要経費別分類コード: g.主要経費別分類コード,
      決算歳出予算額円: g.amount,
      支出済歳出額円: g.spent,
      目数: g.count,
      一括計上元所管: origin所管,
      一括計上元項コード: origin項コード,
    });
  }
  result.sort((a, b) => b.決算歳出予算額円 - a.決算歳出予算額円);
  return result;
}

function toCsv(rows: LumpSumRow[]): string {
  const headers: (keyof LumpSumRow)[] = [
    '年度',
    '所管',
    '組織',
    '項コード',
    '項名',
    '主要経費別分類コード',
    '決算歳出予算額円',
    '支出済歳出額円',
    '目数',
    '一括計上元所管',
    '一括計上元項コード',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => String(r[h] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const allRows: LumpSumRow[] = [];
  for (const year of YEARS) {
    console.log(`--- ${year} ---`);
    const rows = analyzeYear(year);
    allRows.push(...rows);
    const outPath = path.join(RESULT_DIR, `mof-lump-sum-budget-${year}.csv`);
    fs.writeFileSync(outPath, toCsv(rows));
    const total = rows.reduce((s, r) => s + r.決算歳出予算額円, 0);
    const syokanCount = new Set(rows.map(r => r.所管)).size;
    console.log(
      `件数=${rows.length} 所管数=${syokanCount} 合計歳出予算額=${total.toLocaleString()}円 -> ${outPath}`
    );
  }
  const combinedPath = path.join(RESULT_DIR, 'mof-lump-sum-budget-all-years.csv');
  fs.writeFileSync(combinedPath, toCsv(allRows));
  console.log(`\n全年度統合: ${combinedPath}（${allRows.length}行）`);
}

main();
