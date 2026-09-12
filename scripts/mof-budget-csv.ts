/**
 * 予算書 ZIP 内の科目別内訳 CSV を読むための共通処理。
 *
 * 配布 CSV は年度で列名が揺れ、a/b の役割が入れ替わっている帳票もある。
 * 決め打ちを1箇所に閉じ込めるため、ここで解決してから呼び出し側に渡す。
 * 列構造の詳細は docs/mof-budget-data-guide.md 2節。
 */

import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';

/** 1行を列名で引ける形にしたもの */
export type CsvRow = Record<string, string>;

/**
 * 本年度額の列。見出しに元号年が入る（`令和8年度要求額(千円)` / `平成29年度予定額(千円)`）。
 * 令和6年度だけ `(千円)` が付かず、令和元年度は「令和1年度」ではなく「令和元年度」表記。
 */
const ERA_YEAR_PREFIX = /^(令和|平成)(元|\d+)年度/;

/** 予算書 CSV は千円単位。リポジトリ全体の規約に合わせて円へ揃える */
export const THOUSAND_YEN = 1000;

/** 会計年度（西暦）を元号表記に直す。2019年度は改元年で「令和元年度」 */
export function toEraLabel(fiscalYear: number): string {
  if (fiscalYear <= 2018) return `平成${fiscalYear - 1988}年度`;
  if (fiscalYear === 2019) return '令和元年度';
  return `令和${fiscalYear - 2018}年度`;
}

/** 予算書 ZIP の置き場 */
export function zipPath(fiscalYear: number, suffix: string): string {
  return path.join(
    process.cwd(),
    'data',
    'download',
    `mof_${fiscalYear}`,
    `DL${fiscalYear}${suffix}.zip`
  );
}

/**
 * CSV を列名付きの行にする。
 *
 * 配布物は値にカンマを含まないため分割で足りる。
 * 末尾に空カラムが付く帳票があるので、見出しが空の列は捨てる。
 */
function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: CsvRow = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

/** 歳出側の表かどうか。分類コードの有無で判定する（ファイル名では決めない） */
function isExpenditureTable(headers: string[]): boolean {
  return headers.some(h => h.includes('主要経費別分類') || h.includes('使途別分類'));
}

/** 歳入側の表かどうか */
function isRevenueTable(headers: string[]): boolean {
  return !isExpenditureTable(headers) && headers.some(h => h.includes('款コード'));
}

/**
 * 帳票の歳入・歳出を読む。
 *
 * `a` が歳入・`b` が歳出とは限らない（令和7年度 補正・特別会計は逆）ため、
 * ZIP 内の CSV を順に見てヘッダの列で判定する。
 */
export function readBudgetTables(
  fiscalYear: number,
  suffix: string
): { revenue: CsvRow[]; expenditure: CsvRow[] } {
  const zip = zipPath(fiscalYear, suffix);
  const entries = listZipEntries(zip).filter(e => e.toLowerCase().endsWith('.csv'));
  let revenue: CsvRow[] = [];
  let expenditure: CsvRow[] = [];
  for (const entry of entries) {
    const rows = parseCsv(readZipEntryText(zip, entry));
    if (rows.length === 0) continue;
    const headers = Object.keys(rows[0]);
    if (isExpenditureTable(headers)) expenditure = rows;
    else if (isRevenueTable(headers)) revenue = rows;
  }
  if (revenue.length === 0 || expenditure.length === 0) {
    throw new Error(
      `歳入・歳出のどちらかが読めません: ${zip}（収録: ${entries.join(', ') || 'なし'}）`
    );
  }
  return { revenue, expenditure };
}

/** 本年度額の列名を解決する。見つからなければ例外にする（静かに0になるのを防ぐ） */
export function amountColumn(rows: CsvRow[]): string {
  const header = Object.keys(rows[0] ?? {}).find(h => ERA_YEAR_PREFIX.test(h));
  if (!header) {
    throw new Error(
      `本年度額の列が見つかりません（列: ${Object.keys(rows[0] ?? {}).join(', ')}）`
    );
  }
  return header;
}

/** 金額セルを円に直す。空欄・非数値は 0 */
export function yen(row: CsvRow, column: string): number {
  const raw = row[column];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n * THOUSAND_YEN;
}

/** 名前ごとに金額を積み上げ、大きい順に並べる */
export function groupByName(
  rows: CsvRow[],
  column: string,
  nameOf: (row: CsvRow) => string
): Array<{ name: string; amount: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = nameOf(row);
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + yen(row, column));
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}
