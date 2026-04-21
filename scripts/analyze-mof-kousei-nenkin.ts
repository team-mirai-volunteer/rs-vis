/**
 * MOFデータから厚生年金勘定の詳細を抽出
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseAmount } from './csv-reader';

/**
 * 簡易CSV解析
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

function toTrillionYen(amountInThousandYen: number): string {
  return (amountInThousandYen / 1_000_000_000).toFixed(2) + '兆円';
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const filePath = path.join(
    projectRoot,
    'data',
    'download',
    'mof_2023',
    'DL202312001b.csv'
  );

  console.log('=== MOF 厚生年金勘定 詳細分析 ===\n');

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const headers = parseLine(lines[0]);
  const sokanIndex = headers.indexOf('所管');
  const tokubetsuKaikeiIndex = headers.indexOf('特別会計');
  const kanjouIndex = headers.indexOf('勘定');
  const koumokuIndex = headers.indexOf('項名');
  const mokumeiIndex = headers.indexOf('目名');
  const amountIndex = headers.indexOf('令和5年度予定額(千円)');

  console.log('カラム構成:');
  console.log(`  所管: ${sokanIndex}`);
  console.log(`  特別会計: ${tokubetsuKaikeiIndex}`);
  console.log(`  勘定: ${kanjouIndex}`);
  console.log(`  項名: ${koumokuIndex}`);
  console.log(`  目名: ${mokumeiIndex}`);
  console.log(`  金額: ${amountIndex}\n`);

  // 厚生年金勘定と基礎年金勘定を抽出
  const kouseiData: Array<{
    koumoku: string;
    mokumei: string;
    amount: number;
  }> = [];

  const kisoData: Array<{
    koumoku: string;
    mokumei: string;
    amount: number;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseLine(line);
    const tokubetsuKaikei = values[tokubetsuKaikeiIndex] || '';
    const kanjou = values[kanjouIndex] || '';

    if (tokubetsuKaikei !== '年金') continue;

    const koumoku = values[koumokuIndex] || '';
    const mokumei = values[mokumeiIndex] || '';
    const amountStr = values[amountIndex] || '0';
    const amount = parseAmount(amountStr);

    if (amount === 0) continue;

    if (kanjou === '厚生年金勘定') {
      kouseiData.push({ koumoku, mokumei, amount });
    } else if (kanjou === '基礎年金勘定') {
      kisoData.push({ koumoku, mokumei, amount });
    }
  }

  // 厚生年金勘定の処理
  console.log(`厚生年金勘定のデータ件数: ${kouseiData.length}件\n`);
  processKanjou('厚生年金勘定', kouseiData);

  // 基礎年金勘定の処理
  console.log('\n\n【基礎年金勘定】\n');
  console.log(`基礎年金勘定のデータ件数: ${kisoData.length}件\n`);
  processKanjou('基礎年金勘定', kisoData);
}

function processKanjou(kanjouName: string, data: Array<{ koumoku: string; mokumei: string; amount: number }>) {
  if (data.length === 0) {
    console.log(`${kanjouName}のデータが見つかりません\n`);
    return;
  }

  // 項別集計
  const koumokuSum = new Map<string, number>();
  for (const item of data) {
    const current = koumokuSum.get(item.koumoku) || 0;
    koumokuSum.set(item.koumoku, current + item.amount);
  }

  console.log('■ 項別集計（金額順）:\n');
  const sortedKoumoku = Array.from(koumokuSum.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [koumoku, amount] of sortedKoumoku) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)}`);
  }

  // 目別集計（上位30件）
  const mokumeiSum = new Map<string, number>();
  for (const item of data) {
    const current = mokumeiSum.get(item.mokumei) || 0;
    mokumeiSum.set(item.mokumei, current + item.amount);
  }

  console.log('\n■ 目別集計（金額上位30件）:\n');
  const sortedMokumei = Array.from(mokumeiSum.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  for (const [mokumei, amount] of sortedMokumei) {
    console.log(`  ${mokumei}: ${toTrillionYen(amount)}`);
  }

  const total = data.reduce((sum, item) => sum + item.amount, 0);
  console.log(`\n■ ${kanjouName}総額（MOF）: ${toTrillionYen(total)}`);
}

main();
