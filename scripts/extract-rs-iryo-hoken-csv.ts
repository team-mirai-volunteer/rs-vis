/**
 * RS `2-2_予算・執行_予算種別・歳出予算項目.csv`から項「医療保険給付諸費」の行だけを
 * 抽出したCSV。元の列は一切変更しない（年度・予算種別は元CSVに既に列として存在する）。
 *
 * 2025年度シート（`data/year_2025/`）のみを使う。年度をまたいで重複する行
 * （予算年度2021〜2024分）は2024年度シートと完全一致することを確認済み
 * （docs/tasks/20260906_0759_MOF目RS事業紐づけの仕組みおさらい.md参照）ため、
 * 最新かつ最も年度範囲が広い2025年度シート1本で全件をカバーできる。
 *
 * 実行: npx tsx scripts/extract-rs-iryo-hoken-csv.ts
 * 出力: data/result/rs-iryo-hoken-2-2.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV } from '@/scripts/csv-reader';

const SECTION_NAME = '医療保険給付諸費';
const INPUT = path.join(process.cwd(), 'data', 'year_2025', '2-2_RS_2025_予算・執行_予算種別・歳出予算項目.csv');
const OUTPUT = path.join(process.cwd(), 'data', 'result', 'rs-iryo-hoken-2-2.csv');

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function main() {
  const rows = readShiftJISCSV(INPUT);
  const target = rows.filter(r => r['項'] === SECTION_NAME);
  const headers = Object.keys(rows[0]);

  const lines = [headers.join(',')];
  for (const r of target) {
    lines.push(headers.map(h => csvEscape(r[h] ?? '')).join(','));
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf-8');
  console.log(`${path.relative(process.cwd(), OUTPUT)}: ${target.length}行, 列=${headers.length}`);
}

main();
