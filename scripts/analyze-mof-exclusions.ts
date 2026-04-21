/**
 * MOFデータから「国債費」と「地方交付税交付金等」の具体的な金額を抽出
 * RSシステムに含まれていない一般会計の主要項目を特定する
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseAmount } from './csv-reader';

interface MOFExpenditureDetail {
  sokan: string;        // 所管
  soshiki: string;      // 組織
  koumoku: string;      // 項名
  mokumei: string;      // 目名
  amount2023: number;   // 令和5年度要求額（千円）
  amount2024: number;   // 前年度予算額（千円）- 実際は2024年度データから取得
}

/**
 * 簡易CSV解析（カンマ区切り、ダブルクォート対応）
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

/**
 * MOF一般会計歳出CSVを読み込んで項目別集計
 */
function parseMOFGeneralExpenditure(filePath: string): Map<string, number> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  if (lines.length === 0) {
    return new Map();
  }

  const headers = parseLine(lines[0]);
  const koumokuIndex = headers.indexOf('項名');

  // カラム名のバリエーション対応
  let amountIndex = headers.indexOf('令和5年度要求額(千円)');
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和6年度要求額(千円)');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和6年度要求額');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和5年度要求額');
  }

  if (koumokuIndex === -1 || amountIndex === -1) {
    console.error('必要なカラムが見つかりません:', filePath);
    return new Map();
  }

  const koumokuSum = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseLine(line);
    if (values.length <= Math.max(koumokuIndex, amountIndex)) continue;

    const koumoku = values[koumokuIndex];
    const amountStr = values[amountIndex];
    const amount = parseAmount(amountStr);

    if (koumoku && amount > 0) {
      const current = koumokuSum.get(koumoku) || 0;
      koumokuSum.set(koumoku, current + amount);
    }
  }

  return koumokuSum;
}

/**
 * 特定キーワードを含む項目を抽出
 */
function filterByKeywords(
  koumokuSum: Map<string, number>,
  keywords: string[]
): Map<string, number> {
  const filtered = new Map<string, number>();

  for (const [koumoku, amount] of koumokuSum.entries()) {
    for (const keyword of keywords) {
      if (koumoku.includes(keyword)) {
        filtered.set(koumoku, amount);
        break;
      }
    }
  }

  return filtered;
}

/**
 * 金額を兆円表示に変換
 */
function toTrillionYen(amountInThousandYen: number): string {
  return (amountInThousandYen / 1_000_000_000).toFixed(2) + '兆円';
}

/**
 * メイン処理
 */
function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const mof2023Dir = path.join(projectRoot, 'data', 'download', 'mof_2023');
  const mof2024Dir = path.join(projectRoot, 'data', 'download', 'mof_2024');

  // 一般会計歳出ファイル
  const file2023 = path.join(mof2023Dir, 'DL202311001b.csv');
  const file2024 = path.join(mof2024Dir, 'DL202411001b.csv');

  console.log('=== MOF一般会計歳出データ分析 ===\n');

  // 2023年度データ
  console.log('【2023年度（令和5年度）一般会計歳出】');
  const koumoku2023 = parseMOFGeneralExpenditure(file2023);

  // 国債費を抽出
  const kokusaihi2023 = filterByKeywords(koumoku2023, ['国債費']);
  console.log('\n■ 国債費関連:');
  for (const [koumoku, amount] of kokusaihi2023.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  // 地方交付税を抽出
  const chihouKoufuzei2023 = filterByKeywords(koumoku2023, ['地方交付税', '地方特例交付金']);
  console.log('\n■ 地方交付税・地方特例交付金関連:');
  for (const [koumoku, amount] of chihouKoufuzei2023.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  // その他RSに含まれない可能性のある項目
  const others2023 = filterByKeywords(koumoku2023, ['予備費', '復旧・復興']);
  console.log('\n■ その他（予備費・復旧復興等）:');
  for (const [koumoku, amount] of others2023.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  // 全項目の一覧（上位20件）
  console.log('\n■ 全項目（金額上位20件）:');
  const sorted2023 = Array.from(koumoku2023.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [koumoku, amount] of sorted2023) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)}`);
  }

  // 2024年度データ
  console.log('\n\n【2024年度（令和6年度）一般会計歳出】');
  const koumoku2024 = parseMOFGeneralExpenditure(file2024);

  const kokusaihi2024 = filterByKeywords(koumoku2024, ['国債費']);
  console.log('\n■ 国債費関連:');
  for (const [koumoku, amount] of kokusaihi2024.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  const chihouKoufuzei2024 = filterByKeywords(koumoku2024, ['地方交付税', '地方特例交付金']);
  console.log('\n■ 地方交付税・地方特例交付金関連:');
  for (const [koumoku, amount] of chihouKoufuzei2024.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  const others2024 = filterByKeywords(koumoku2024, ['予備費', '復旧・復興']);
  console.log('\n■ その他（予備費・復旧復興等）:');
  for (const [koumoku, amount] of others2024.entries()) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)} (${amount.toLocaleString()}千円)`);
  }

  console.log('\n■ 全項目（金額上位20件）:');
  const sorted2024 = Array.from(koumoku2024.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [koumoku, amount] of sorted2024) {
    console.log(`  ${koumoku}: ${toTrillionYen(amount)}`);
  }

  // サマリー
  console.log('\n\n=== サマリー ===');

  const kokusaihi2023Total = Array.from(kokusaihi2023.values()).reduce((sum, v) => sum + v, 0);
  const kokusaihi2024Total = Array.from(kokusaihi2024.values()).reduce((sum, v) => sum + v, 0);
  const chihou2023Total = Array.from(chihouKoufuzei2023.values()).reduce((sum, v) => sum + v, 0);
  const chihou2024Total = Array.from(chihouKoufuzei2024.values()).reduce((sum, v) => sum + v, 0);

  console.log(`\n2023年度:`);
  console.log(`  国債費合計: ${toTrillionYen(kokusaihi2023Total)}`);
  console.log(`  地方交付税等合計: ${toTrillionYen(chihou2023Total)}`);
  console.log(`  両者の合計: ${toTrillionYen(kokusaihi2023Total + chihou2023Total)}`);

  console.log(`\n2024年度:`);
  console.log(`  国債費合計: ${toTrillionYen(kokusaihi2024Total)}`);
  console.log(`  地方交付税等合計: ${toTrillionYen(chihou2024Total)}`);
  console.log(`  両者の合計: ${toTrillionYen(kokusaihi2024Total + chihou2024Total)}`);
}

main();
