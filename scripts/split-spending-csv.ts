/**
 * 支出先CSVを「ブロック行」と「支出先行」に分割するスクリプト
 *
 * 入力: data/year_2024/5-1_RS_2024_支出先_支出情報.csv
 *
 * 出力（デフォルト: data/result/）:
 *   blocks.csv                  - 支出先ブロック行（支出先名が空、ブロック集計行）
 *   recipients_with_total.csv   - 個別支出先行（支出先の合計支出額 あり）
 *   recipients_without_total.csv- 個別支出先行（支出先の合計支出額 なし）
 *   skipped.txt                 - スキップ行（カラム数不一致・両フィールド空）
 *
 * 使い方:
 *   npx tsx scripts/split-spending-csv.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';

const INPUT_CSV = path.join(__dirname, '../data/year_2024/5-1_RS_2024_支出先_支出情報.csv');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '../data/result');

/**
 * CSV行を解析してフィールド配列に分割（ダブルクォート対応）
 */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentField += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField.trim());
  return fields;
}

function main() {
  const outputDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;

  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`エラー: 入力ファイルが見つかりません: ${INPUT_CSV}`);
    process.exit(1);
  }

  console.log(`入力: ${INPUT_CSV}`);
  console.log(`出力先: ${outputDir}`);
  console.log('読み込み中...');

  const content = fs.readFileSync(INPUT_CSV, 'utf-8');
  const allLines = content.split(/\r?\n/);

  // 空行除去（末尾など）
  const lines = allLines.filter((l, i) => i === 0 || l.trim() !== '');

  if (lines.length === 0) {
    console.error('エラー: ファイルが空です');
    process.exit(1);
  }

  // ヘッダー解析
  const headerLine = lines[0];
  const headers = parseLine(headerLine);
  const spendingNameIdx = headers.indexOf('支出先名');
  const blockNameIdx = headers.indexOf('支出先ブロック名');
  const totalAmountIdx = headers.indexOf('支出先の合計支出額');

  if (spendingNameIdx === -1) {
    console.error(`エラー: カラム「支出先名」が見つかりません。カラム一覧: ${headers.join(', ')}`);
    process.exit(1);
  }
  if (blockNameIdx === -1) {
    console.error(`エラー: カラム「支出先ブロック名」が見つかりません`);
    process.exit(1);
  }
  if (totalAmountIdx === -1) {
    console.error(`エラー: カラム「支出先の合計支出額」が見つかりません`);
    process.exit(1);
  }

  // 分割処理
  const blockLines: string[] = [headerLine];
  const recipientsWithTotalLines: string[] = [headerLine];
  const recipientsWithoutTotalLines: string[] = [headerLine];
  const skippedRawLines: string[] = [];

  let blockCount = 0;
  let recipientsWithTotalCount = 0;
  let recipientsWithoutTotalCount = 0;
  let skippedColumnError = 0;
  let skippedBothEmpty = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseLine(line);

    if (values.length !== headers.length) {
      skippedRawLines.push(`[L${i + 1}] カラム数不一致 (期待:${headers.length} 実際:${values.length})\t${line}`);
      skippedColumnError++;
      continue;
    }

    const spendingName = values[spendingNameIdx].trim();
    const blockName = values[blockNameIdx].trim();
    const totalAmount = values[totalAmountIdx].trim();

    if (!spendingName && blockName) {
      // ブロック集計行: 支出先名が空 かつ ブロック名あり
      blockLines.push(line);
      blockCount++;
    } else if (spendingName) {
      // 個別支出先行: 支出先の合計支出額 の有無でさらに分割
      if (totalAmount) {
        recipientsWithTotalLines.push(line);
        recipientsWithTotalCount++;
      } else {
        recipientsWithoutTotalLines.push(line);
        recipientsWithoutTotalCount++;
      }
    } else {
      // 支出先名・ブロック名が両方空
      skippedRawLines.push(`[L${i + 1}] 支出先名・ブロック名が両方空\t${line}`);
      skippedBothEmpty++;
    }
  }

  // 出力
  fs.mkdirSync(outputDir, { recursive: true });

  const blocksPath = path.join(outputDir, 'blocks.csv');
  const withTotalPath = path.join(outputDir, 'recipients_with_total.csv');
  const withoutTotalPath = path.join(outputDir, 'recipients_without_total.csv');
  const skippedPath = path.join(outputDir, 'skipped.txt');

  fs.writeFileSync(blocksPath, blockLines.join('\n'), 'utf-8');
  fs.writeFileSync(withTotalPath, recipientsWithTotalLines.join('\n'), 'utf-8');
  fs.writeFileSync(withoutTotalPath, recipientsWithoutTotalLines.join('\n'), 'utf-8');
  fs.writeFileSync(skippedPath, skippedRawLines.join('\n'), 'utf-8');

  const skippedTotal = skippedColumnError + skippedBothEmpty;
  const recipientTotal = recipientsWithTotalCount + recipientsWithoutTotalCount;

  console.log('');
  console.log('=== 完了 ===');
  console.log(`ブロック行                       : ${blockCount.toLocaleString()} 行  → ${blocksPath}`);
  console.log(`個別支出先行（合計支出額 あり）  : ${recipientsWithTotalCount.toLocaleString()} 行  → ${withTotalPath}`);
  console.log(`個別支出先行（合計支出額 なし）  : ${recipientsWithoutTotalCount.toLocaleString()} 行  → ${withoutTotalPath}`);
  console.log(`  └ 個別支出先行 計             : ${recipientTotal.toLocaleString()} 行`);
  if (skippedTotal > 0) {
    console.log(`スキップ                         : ${skippedTotal.toLocaleString()} 行  → ${skippedPath}`);
    if (skippedColumnError > 0) console.log(`  └ カラム数不一致              : ${skippedColumnError.toLocaleString()} 行`);
    if (skippedBothEmpty > 0)   console.log(`  └ 両フィールド空              : ${skippedBothEmpty.toLocaleString()} 行`);
  }
  console.log(`合計データ行                     : ${(blockCount + recipientTotal + skippedTotal).toLocaleString()} 行`);
}

main();
