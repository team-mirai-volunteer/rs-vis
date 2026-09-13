/**
 * MOF科目別内訳CSVの原本から、項名「医療保険給付諸費」の行だけを2017〜2026年度分
 * 抜き出し、元の列は一切落とさず「年度」「予算種別」列だけを追加した拡張CSVを作る。
 *
 * 予算（当初予算＋補正予算）と決算は列構成が別物（決算は金額列が9本、目別分類コードの
 * 代わりに目番号を持つ）ため、別々のCSVに出力する。
 *
 * 実行: npx tsx scripts/extract-mof-iryo-hoken-csv.ts
 * 出力: data/result/mof-iryo-hoken-予算.csv, data/result/mof-iryo-hoken-決算.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { readBudgetTables, zipPath, type CsvRow } from '@/scripts/mof-budget-csv';
import { MOF_REVISION_NUMBERS, revisedBudgetType } from '@/types/mof-jikou';

const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const SECTION_NAME = '医療保険給付諸費';
const RESULT_DIR = path.join(process.cwd(), 'data', 'result');

interface ExtractedRow {
  年度: number;
  予算種別: string;
  row: CsvRow;
}

function collectBudget(): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  for (const year of YEARS) {
    if (fs.existsSync(zipPath(year, '11001'))) {
      const { expenditure } = readBudgetTables(year, '11001');
      for (const row of expenditure) {
        if (row['項名'] === SECTION_NAME) out.push({ 年度: year, 予算種別: '当初予算', row });
      }
    }
    for (const revision of MOF_REVISION_NUMBERS) {
      const suffix = `21${String(revision).padStart(3, '0')}`;
      if (!fs.existsSync(zipPath(year, suffix))) continue;
      const { expenditure } = readBudgetTables(year, suffix);
      for (const row of expenditure) {
        if (row['項名'] === SECTION_NAME) out.push({ 年度: year, 予算種別: revisedBudgetType(revision), row });
      }
    }
  }
  return out;
}

function collectSettlement(): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  for (const year of YEARS) {
    if (!fs.existsSync(zipPath(year, '77001'))) continue;
    const { expenditure } = readBudgetTables(year, '77001');
    for (const row of expenditure) {
      if (row['項名'] === SECTION_NAME) out.push({ 年度: year, 予算種別: '決算', row });
    }
  }
  return out;
}

/** 元の列名の和集合を、初出順を保って求める（年度・予算種別ごとに列名が揺れるため） */
function unionHeaders(rows: ExtractedRow[]): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const r of rows) {
    for (const h of Object.keys(r.row)) {
      if (!seen.has(h)) {
        seen.add(h);
        headers.push(h);
      }
    }
  }
  return headers;
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeCsv(rows: ExtractedRow[], outPath: string) {
  const headers = unionHeaders(rows);
  const lines = [['年度', '予算種別', ...headers].join(',')];
  for (const r of rows) {
    const cells = [String(r.年度), r.予算種別, ...headers.map(h => r.row[h] ?? '')];
    lines.push(cells.map(csvEscape).join(','));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`${path.relative(process.cwd(), outPath)}: ${rows.length}行, 列=${headers.length + 2}`);
}

function main() {
  writeCsv(collectBudget(), path.join(RESULT_DIR, 'mof-iryo-hoken-予算.csv'));
  writeCsv(collectSettlement(), path.join(RESULT_DIR, 'mof-iryo-hoken-決算.csv'));
}

main();
