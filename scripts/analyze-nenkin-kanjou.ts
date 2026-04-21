/**
 * 厚生年金勘定の詳細分析
 * RSシステムとMOFの差額25.4兆円の内訳を明確化
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';

/**
 * 金額を兆円表示に変換
 */
function toTrillionYen(amountInYen: number): string {
  return (amountInYen / 1_000_000_000_000).toFixed(2) + '兆円';
}

/**
 * メイン処理
 */
function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const csvPath = path.join(
    projectRoot,
    'data',
    'year_2024',
    '2-2_RS_2024_予算・執行_予算種別・歳出予算項目.csv'
  );

  console.log('=== 厚生年金勘定 詳細分析 ===\n');

  const rows = readShiftJISCSV(csvPath);

  // 2023年度の当初予算、年金特別会計、厚生年金勘定のみを抽出
  const kousei2023: Array<{
    projectName: string;
    koumoku: string;
    mokumei: string;
    amount: number;
  }> = [];

  const kiso2023: Array<{
    projectName: string;
    koumoku: string;
    mokumei: string;
    amount: number;
  }> = [];

  for (const row of rows) {
    const year = parseInt(row['予算年度'] || '0');
    const budgetType = row['予算種別'] || '';
    const account = row['会計'] || '';
    const kanjou = row['勘定'] || '';
    const projectName = row['事業名'] || '';
    const koumoku = row['項'] || '';
    const mokumei = row['目'] || '';
    const amountStr = row['予算額(歳出予算項目ごと)'] || '0';
    const amount = parseAmount(amountStr);

    if (year !== 2023) continue;
    if (budgetType !== '当初予算') continue;
    if (account !== '年金') continue;
    if (amount === 0) continue;

    if (kanjou === '厚生年金勘定') {
      kousei2023.push({ projectName, koumoku, mokumei, amount });
    } else if (kanjou === '基礎年金勘定') {
      kiso2023.push({ projectName, koumoku, mokumei, amount });
    }
  }

  console.log('【2023年度 厚生年金勘定】\n');

  // 項別集計
  const koumokuSum = new Map<string, number>();
  for (const item of kousei2023) {
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
  for (const item of kousei2023) {
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

  // 事業別集計（上位20件）
  const projectSum = new Map<string, number>();
  for (const item of kousei2023) {
    const current = projectSum.get(item.projectName) || 0;
    projectSum.set(item.projectName, current + item.amount);
  }

  console.log('\n■ 事業別集計（金額上位20件）:\n');
  const sortedProjects = Array.from(projectSum.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [projectName, amount] of sortedProjects) {
    console.log(`  ${projectName}: ${toTrillionYen(amount)}`);
  }

  const totalKousei = kousei2023.reduce((sum, item) => sum + item.amount, 0);
  console.log(`\n■ 厚生年金勘定総額（RSシステム）: ${toTrillionYen(totalKousei)}`);
  console.log(`■ MOF厚生年金勘定: 50.41兆円`);
  console.log(`■ 差額: ${toTrillionYen(50.41e12 - totalKousei)}`);

  // 基礎年金勘定も同様に分析
  console.log('\n\n【2023年度 基礎年金勘定】\n');

  const koumokuSumKiso = new Map<string, number>();
  for (const item of kiso2023) {
    const current = koumokuSumKiso.get(item.koumoku) || 0;
    koumokuSumKiso.set(item.koumoku, current + item.amount);
  }

  console.log('■ 項別集計（金額順）:\n');
  const sortedKoumokuKiso = Array.from(koumokuSumKiso.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [koumoku, amount] of sortedKoumokuKiso) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)}`);
  }

  const mokumeiSumKiso = new Map<string, number>();
  for (const item of kiso2023) {
    const current = mokumeiSumKiso.get(item.mokumei) || 0;
    mokumeiSumKiso.set(item.mokumei, current + item.amount);
  }

  console.log('\n■ 目別集計（金額上位20件）:\n');
  const sortedMokumeiKiso = Array.from(mokumeiSumKiso.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [mokumei, amount] of sortedMokumeiKiso) {
    console.log(`  ${mokumei}: ${toTrillionYen(amount)}`);
  }

  const totalKiso = kiso2023.reduce((sum, item) => sum + item.amount, 0);
  console.log(`\n■ 基礎年金勘定総額（RSシステム）: ${toTrillionYen(totalKiso)}`);
  console.log(`■ MOF基礎年金勘定: 28.85兆円`);
  console.log(`■ 差額: ${toTrillionYen(28.85e12 - totalKiso)}`);

  // サマリー
  console.log('\n\n=== サマリー ===\n');
  console.log('【厚生年金勘定】');
  console.log(`  RSシステム: ${toTrillionYen(totalKousei)}`);
  console.log(`  MOF: 50.41兆円`);
  console.log(`  差額: ${toTrillionYen(50.41e12 - totalKousei)} (${((50.41e12 - totalKousei) / 50.41e12 * 100).toFixed(1)}%)`);

  console.log('\n【基礎年金勘定】');
  console.log(`  RSシステム: ${toTrillionYen(totalKiso)}`);
  console.log(`  MOF: 28.85兆円`);
  console.log(`  差額: ${toTrillionYen(28.85e12 - totalKiso)} (${((28.85e12 - totalKiso) / 28.85e12 * 100).toFixed(1)}%)`);
}

main();
