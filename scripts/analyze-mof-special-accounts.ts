/**
 * MOF特別会計データの分析
 * RSシステムの特別会計78.56兆円との対応関係を調査
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseAmount } from './csv-reader';

interface SpecialAccountData {
  sokan: string;           // 所管
  tokubetsuKaikei: string; // 特別会計
  kanjou: string;          // 勘定
  koumoku: string;         // 項名
  mokumei: string;         // 目名
  amount: number;          // 金額（千円）
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
 * MOF特別会計歳出CSVを読み込み
 */
function parseMOFSpecialAccount(filePath: string): SpecialAccountData[] {
  if (!fs.existsSync(filePath)) {
    console.error(`ファイルが存在しません: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseLine(lines[0]);
  const sokanIndex = headers.indexOf('所管');
  const tokubetsuKaikeiIndex = headers.indexOf('特別会計');
  const kanjouIndex = headers.indexOf('勘定');
  const koumokuIndex = headers.indexOf('項名');
  const mokumeiIndex = headers.indexOf('目名');

  // 金額カラム名のバリエーション対応
  let amountIndex = headers.indexOf('令和5年度予定額(千円)');
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和6年度予定額(千円)');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和6年度予定額');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和5年度予定額');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和5年度要求額(千円)');
  }
  if (amountIndex === -1) {
    amountIndex = headers.indexOf('令和6年度要求額');
  }

  if (sokanIndex === -1 || tokubetsuKaikeiIndex === -1 || amountIndex === -1) {
    console.error(`必要なカラムが見つかりません: ${filePath}`);
    console.error(`ヘッダー: ${headers.join(', ')}`);
    return [];
  }

  const records: SpecialAccountData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseLine(line);
    if (values.length <= Math.max(sokanIndex, tokubetsuKaikeiIndex, amountIndex)) {
      continue;
    }

    const sokan = values[sokanIndex] || '';
    const tokubetsuKaikei = values[tokubetsuKaikeiIndex] || '';
    const kanjou = kanjouIndex >= 0 ? values[kanjouIndex] || '' : '';
    const koumoku = koumokuIndex >= 0 ? values[koumokuIndex] || '' : '';
    const mokumei = mokumeiIndex >= 0 ? values[mokumeiIndex] || '' : '';
    const amountStr = values[amountIndex];
    const amount = parseAmount(amountStr);

    if (amount > 0) {
      records.push({
        sokan,
        tokubetsuKaikei,
        kanjou,
        koumoku,
        mokumei,
        amount,
      });
    }
  }

  return records;
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

  console.log('=== MOF特別会計歳出データ分析 ===\n');

  // 2023年度データ
  console.log('【2023年度（令和5年度）特別会計歳出】\n');

  const files2023 = [
    path.join(mof2023Dir, 'DL202312001b.csv'), // 特別会計（当初）
    path.join(mof2023Dir, 'DL202376001b.csv'), // 特別会計追加1
    path.join(mof2023Dir, 'DL202377001b.csv'), // 特別会計追加2
    path.join(mof2023Dir, 'DL202378001b.csv'), // 特別会計追加3
  ];

  const allRecords2023: SpecialAccountData[] = [];
  for (const file of files2023) {
    const records = parseMOFSpecialAccount(file);
    allRecords2023.push(...records);
    console.log(`  読み込み: ${path.basename(file)} - ${records.length}行`);
  }

  // 特別会計別に集計
  const accountSum2023 = new Map<string, number>();
  const accountKanjouSum2023 = new Map<string, Map<string, number>>();

  for (const record of allRecords2023) {
    // 特別会計別集計
    const current = accountSum2023.get(record.tokubetsuKaikei) || 0;
    accountSum2023.set(record.tokubetsuKaikei, current + record.amount);

    // 勘定別集計
    if (!accountKanjouSum2023.has(record.tokubetsuKaikei)) {
      accountKanjouSum2023.set(record.tokubetsuKaikei, new Map());
    }
    const kanjouMap = accountKanjouSum2023.get(record.tokubetsuKaikei)!;
    const kanjouCurrent = kanjouMap.get(record.kanjou) || 0;
    kanjouMap.set(record.kanjou, kanjouCurrent + record.amount);
  }

  // 総額
  const total2023 = Array.from(accountSum2023.values()).reduce((sum, v) => sum + v, 0);
  console.log(`\n■ 特別会計総額: ${toTrillionYen(total2023)}\n`);

  // 特別会計別（金額順）
  console.log('■ 特別会計別集計（金額順）:\n');
  const sorted2023 = Array.from(accountSum2023.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [account, amount] of sorted2023) {
    console.log(`  ${account}: ${toTrillionYen(amount)}`);

    // 勘定の内訳も表示（主要なもののみ）
    const kanjouMap = accountKanjouSum2023.get(account);
    if (kanjouMap && kanjouMap.size > 1) {
      const sortedKanjou = Array.from(kanjouMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // 上位5勘定のみ

      for (const [kanjou, kanjouAmount] of sortedKanjou) {
        if (kanjou) {
          console.log(`      └ ${kanjou}: ${toTrillionYen(kanjouAmount)}`);
        }
      }
    }
  }

  // 2024年度データ
  console.log('\n\n【2024年度（令和6年度）特別会計歳出】\n');

  const files2024 = [
    path.join(mof2024Dir, 'DL202412001b.csv'),
    path.join(mof2024Dir, 'DL202476001b.csv'),
    path.join(mof2024Dir, 'DL202477001b.csv'),
    path.join(mof2024Dir, 'DL202478001b.csv'),
  ];

  const allRecords2024: SpecialAccountData[] = [];
  for (const file of files2024) {
    const records = parseMOFSpecialAccount(file);
    allRecords2024.push(...records);
    console.log(`  読み込み: ${path.basename(file)} - ${records.length}行`);
  }

  const accountSum2024 = new Map<string, number>();
  const accountKanjouSum2024 = new Map<string, Map<string, number>>();

  for (const record of allRecords2024) {
    const current = accountSum2024.get(record.tokubetsuKaikei) || 0;
    accountSum2024.set(record.tokubetsuKaikei, current + record.amount);

    if (!accountKanjouSum2024.has(record.tokubetsuKaikei)) {
      accountKanjouSum2024.set(record.tokubetsuKaikei, new Map());
    }
    const kanjouMap = accountKanjouSum2024.get(record.tokubetsuKaikei)!;
    const kanjouCurrent = kanjouMap.get(record.kanjou) || 0;
    kanjouMap.set(record.kanjou, kanjouCurrent + record.amount);
  }

  const total2024 = Array.from(accountSum2024.values()).reduce((sum, v) => sum + v, 0);
  console.log(`\n■ 特別会計総額: ${toTrillionYen(total2024)}\n`);

  console.log('■ 特別会計別集計（金額順）:\n');
  const sorted2024 = Array.from(accountSum2024.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [account, amount] of sorted2024) {
    console.log(`  ${account}: ${toTrillionYen(amount)}`);

    const kanjouMap = accountKanjouSum2024.get(account);
    if (kanjouMap && kanjouMap.size > 1) {
      const sortedKanjou = Array.from(kanjouMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      for (const [kanjou, kanjouAmount] of sortedKanjou) {
        if (kanjou) {
          console.log(`      └ ${kanjou}: ${toTrillionYen(kanjouAmount)}`);
        }
      }
    }
  }

  // サマリー
  console.log('\n\n=== サマリー ===\n');
  console.log(`2023年度 特別会計総額: ${toTrillionYen(total2023)}`);
  console.log(`2024年度 特別会計総額: ${toTrillionYen(total2024)}`);
  console.log(`\n前年度比: ${toTrillionYen(total2024 - total2023)}`);

  console.log('\n\n=== RSシステムとの比較 ===\n');
  console.log('RSシステム特別会計（2023年度当初予算）: 78.56兆円');
  console.log(`MOF特別会計総額（2023年度）: ${toTrillionYen(total2023)}`);
  console.log(`\n差額: ${toTrillionYen(total2023 - 78_560_000_000)}`);
  console.log(`RSシステム/MOF比率: ${((78_560_000_000 / total2023) * 100).toFixed(1)}%`);
}

main();
