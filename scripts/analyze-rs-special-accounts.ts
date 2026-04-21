/**
 * RSシステムの特別会計内訳分析
 * どの特別会計がRSシステムに含まれているかを明確化
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';

interface RSAccountData {
  year: number;
  accountCategory: string; // 会計区分
  account: string;         // 会計
  kanjou: string;          // 勘定
  amount: number;          // 金額
}

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

  console.log('=== RSシステム 特別会計内訳分析 ===\n');
  console.log(`データソース: ${csvPath}\n`);

  const rows = readShiftJISCSV(csvPath);

  // 2023年度の当初予算のみを対象
  const data2023: RSAccountData[] = [];
  const data2024: RSAccountData[] = [];

  for (const row of rows) {
    const year = parseInt(row['予算年度'] || '0');
    const budgetType = row['予算種別'] || '';
    const accountCategory = row['会計区分'] || '';
    const account = row['会計'] || '';
    const kanjou = row['勘定'] || '';
    const amountStr = row['予算額(歳出予算項目ごと)'] || '0';
    const amount = parseAmount(amountStr);

    // 当初予算のみを対象
    if (budgetType !== '当初予算') continue;
    if (amount === 0) continue;

    if (year === 2023) {
      data2023.push({ year, accountCategory, account, kanjou, amount });
    } else if (year === 2024) {
      data2024.push({ year, accountCategory, account, kanjou, amount });
    }
  }

  // 2023年度分析
  console.log('【2023年度（令和5年度）当初予算】\n');
  analyzeYear(data2023);

  // 2024年度分析
  console.log('\n\n【2024年度（令和6年度）当初予算】\n');
  analyzeYear(data2024);

  // 比較分析
  console.log('\n\n=== 年度比較（特別会計のみ） ===\n');
  compareYears(data2023, data2024);
}

/**
 * 年度ごとの分析
 */
function analyzeYear(data: RSAccountData[]) {
  // 会計区分別集計
  const categorySum = new Map<string, number>();
  for (const d of data) {
    const current = categorySum.get(d.accountCategory) || 0;
    categorySum.set(d.accountCategory, current + d.amount);
  }

  console.log('■ 会計区分別集計:\n');
  for (const [category, amount] of categorySum.entries()) {
    console.log(`  ${category}: ${toTrillionYen(amount)}`);
  }

  // 特別会計のみを抽出
  const specialAccountData = data.filter(d => d.accountCategory === '特別会計');

  // 特別会計別集計
  const accountSum = new Map<string, number>();
  const accountKanjouSum = new Map<string, Map<string, number>>();

  for (const d of specialAccountData) {
    // 会計別集計
    const current = accountSum.get(d.account) || 0;
    accountSum.set(d.account, current + d.amount);

    // 勘定別集計
    if (!accountKanjouSum.has(d.account)) {
      accountKanjouSum.set(d.account, new Map());
    }
    const kanjouMap = accountKanjouSum.get(d.account)!;
    const kanjouCurrent = kanjouMap.get(d.kanjou) || 0;
    kanjouMap.set(d.kanjou, kanjouCurrent + d.amount);
  }

  const specialTotal = Array.from(accountSum.values()).reduce((sum, v) => sum + v, 0);
  console.log(`\n■ 特別会計総額: ${toTrillionYen(specialTotal)}\n`);

  console.log('■ 特別会計別集計（金額順）:\n');
  const sortedAccounts = Array.from(accountSum.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [account, amount] of sortedAccounts) {
    console.log(`  ${account}: ${toTrillionYen(amount)}`);

    // 勘定の内訳も表示（主要なもののみ）
    const kanjouMap = accountKanjouSum.get(account);
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
}

/**
 * 年度間比較
 */
function compareYears(data2023: RSAccountData[], data2024: RSAccountData[]) {
  const specialAccount2023 = data2023.filter(d => d.accountCategory === '特別会計');
  const specialAccount2024 = data2024.filter(d => d.accountCategory === '特別会計');

  const accountSum2023 = new Map<string, number>();
  const accountSum2024 = new Map<string, number>();

  for (const d of specialAccount2023) {
    const current = accountSum2023.get(d.account) || 0;
    accountSum2023.set(d.account, current + d.amount);
  }

  for (const d of specialAccount2024) {
    const current = accountSum2024.get(d.account) || 0;
    accountSum2024.set(d.account, current + d.amount);
  }

  // 全ての特別会計を取得
  const allAccounts = new Set([
    ...accountSum2023.keys(),
    ...accountSum2024.keys(),
  ]);

  const comparison: Array<{
    account: string;
    amount2023: number;
    amount2024: number;
    diff: number;
  }> = [];

  for (const account of allAccounts) {
    const amount2023 = accountSum2023.get(account) || 0;
    const amount2024 = accountSum2024.get(account) || 0;
    const diff = amount2024 - amount2023;

    comparison.push({ account, amount2023, amount2024, diff });
  }

  // 2024年度金額順にソート
  comparison.sort((a, b) => b.amount2024 - a.amount2024);

  console.log('| 特別会計名 | 2023年度 | 2024年度 | 増減 |');
  console.log('|-----------|----------|----------|------|');

  for (const c of comparison) {
    const diff = c.diff >= 0
      ? `+${toTrillionYen(c.diff)}`
      : toTrillionYen(c.diff);

    console.log(
      `| ${c.account} | ${toTrillionYen(c.amount2023)} | ${toTrillionYen(c.amount2024)} | ${diff} |`
    );
  }

  const total2023 = Array.from(accountSum2023.values()).reduce((sum, v) => sum + v, 0);
  const total2024 = Array.from(accountSum2024.values()).reduce((sum, v) => sum + v, 0);

  console.log(
    `| **合計** | **${toTrillionYen(total2023)}** | **${toTrillionYen(total2024)}** | **${toTrillionYen(total2024 - total2023)}** |`
  );
}

main();
