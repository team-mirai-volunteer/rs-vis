/**
 * 個別支出先行（合計支出額なし）の深堀り分析
 *
 * 入力: data/result/recipients_without_total.csv
 *
 * 出力（data/result/）:
 *   no_total_stats.txt             - 統計サマリー
 *   no_total_no_cn.csv             - 法人番号なしの支出先名リスト（出現事業数・合計金額付き）
 *   no_total_other_flag.csv        - その他支出先=TRUEの支出先名リスト
 *
 * 使い方:
 *   npx tsx scripts/analyze-recipients-no-total.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';

const INPUT_CSV = path.join(__dirname, '../data/result/recipients_without_total.csv');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '../data/result');

function main() {
  const outputDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;

  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${INPUT_CSV}`);
    console.error('先に split-spending-csv.ts を実行してください');
    process.exit(1);
  }

  console.log(`入力: ${INPUT_CSV}`);
  console.log('読み込み中...');

  const rows = readShiftJISCSV(INPUT_CSV);
  console.log(`読み込み行数: ${rows.length.toLocaleString()} 行`);

  // ---- 1. 支出先名ユニーク数 ----
  const uniqueNames = new Set<string>();
  for (const r of rows) {
    const name = r['支出先名']?.trim();
    if (name) uniqueNames.add(name);
  }

  // ---- 2. 法人番号なし → 支出先名ごとに集計 ----
  // key: 支出先名, value: { projectIds: Set, totalAmount: number }
  const noCnMap = new Map<string, { projectIds: Set<string>; totalAmount: number }>();
  for (const r of rows) {
    const cn = r['法人番号']?.trim();
    if (cn) continue; // 法人番号ありはスキップ

    const name = r['支出先名']?.trim();
    if (!name) continue;

    const projectId = r['予算事業ID']?.trim() ?? '';
    const amount = parseAmount(r['金額'] ?? '');

    if (!noCnMap.has(name)) {
      noCnMap.set(name, { projectIds: new Set(), totalAmount: 0 });
    }
    const entry = noCnMap.get(name)!;
    if (projectId) entry.projectIds.add(projectId);
    entry.totalAmount += amount;
  }

  // ---- 3. その他支出先=TRUE → 支出先名ごとに集計 ----
  const otherFlagMap = new Map<string, { projectIds: Set<string>; totalAmount: number }>();
  for (const r of rows) {
    if (r['その他支出先']?.trim() !== 'TRUE') continue;

    const name = r['支出先名']?.trim();
    if (!name) continue;

    const projectId = r['予算事業ID']?.trim() ?? '';
    const amount = parseAmount(r['金額'] ?? '');

    if (!otherFlagMap.has(name)) {
      otherFlagMap.set(name, { projectIds: new Set(), totalAmount: 0 });
    }
    const entry = otherFlagMap.get(name)!;
    if (projectId) entry.projectIds.add(projectId);
    entry.totalAmount += amount;
  }

  // ---- 出力 ----
  fs.mkdirSync(outputDir, { recursive: true });

  // --- 統計サマリー ---
  const statsLines: string[] = [
    '=== 個別支出先行（合計支出額なし）分析 ===',
    '',
    `総行数             : ${rows.length.toLocaleString()} 行`,
    `支出先名ユニーク数 : ${uniqueNames.size.toLocaleString()} 件`,
    `法人番号なし       : ${noCnMap.size.toLocaleString()} 件（ユニーク支出先名）`,
    `その他支出先=TRUE  : ${otherFlagMap.size.toLocaleString()} 件（ユニーク支出先名）`,
  ];
  const statsPath = path.join(outputDir, 'no_total_stats.txt');
  fs.writeFileSync(statsPath, statsLines.join('\n'), 'utf-8');

  // --- 法人番号なしリスト（合計金額降順） ---
  const noCnSorted = [...noCnMap.entries()].sort((a, b) => b[1].totalAmount - a[1].totalAmount);
  const noCnCsvLines = ['支出先名,事業数,合計金額（円）'];
  for (const [name, { projectIds, totalAmount }] of noCnSorted) {
    const escapedName = name.includes(',') ? `"${name}"` : name;
    noCnCsvLines.push(`${escapedName},${projectIds.size},${totalAmount}`);
  }
  const noCnPath = path.join(outputDir, 'no_total_no_cn.csv');
  fs.writeFileSync(noCnPath, noCnCsvLines.join('\n'), 'utf-8');

  // --- その他支出先=TRUEリスト（合計金額降順） ---
  const otherSorted = [...otherFlagMap.entries()].sort((a, b) => b[1].totalAmount - a[1].totalAmount);
  const otherCsvLines = ['支出先名,事業数,合計金額（円）'];
  for (const [name, { projectIds, totalAmount }] of otherSorted) {
    const escapedName = name.includes(',') ? `"${name}"` : name;
    otherCsvLines.push(`${escapedName},${projectIds.size},${totalAmount}`);
  }
  const otherPath = path.join(outputDir, 'no_total_other_flag.csv');
  fs.writeFileSync(otherPath, otherCsvLines.join('\n'), 'utf-8');

  // ---- コンソール出力 ----
  console.log('');
  for (const line of statsLines) console.log(line);
  console.log('');
  console.log(`出力ファイル:`);
  console.log(`  ${statsPath}`);
  console.log(`  ${noCnPath}`);
  console.log(`  ${otherPath}`);

  // 法人番号なしTOP10
  console.log('');
  console.log('--- 法人番号なし TOP10（合計金額順）---');
  for (const [name, { projectIds, totalAmount }] of noCnSorted.slice(0, 10)) {
    const amtStr = (totalAmount / 1e8).toFixed(1) + '億円';
    console.log(`  ${name.padEnd(30)} 事業数:${String(projectIds.size).padStart(4)}  ${amtStr}`);
  }

  // その他支出先=TRUE TOP10
  console.log('');
  console.log('--- その他支出先=TRUE TOP10（合計金額順）---');
  for (const [name, { projectIds, totalAmount }] of otherSorted.slice(0, 10)) {
    const amtStr = (totalAmount / 1e8).toFixed(1) + '億円';
    console.log(`  ${name.padEnd(30)} 事業数:${String(projectIds.size).padStart(4)}  ${amtStr}`);
  }
}

main();
