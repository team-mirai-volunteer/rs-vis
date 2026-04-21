/**
 * 特別会計の財源構成を調査するスクリプト
 *
 * 特別会計には「一般会計からの繰入」が含まれる可能性があるため、
 * その金額と割合を調査する
 *
 * 実行方法:
 *   npx tsx scripts/analyze-special-account-funding.ts
 */

import fs from 'fs';
import path from 'path';
import type { RS2024StructuredData } from '@/types/structured';

const DATA_PATH = path.join(process.cwd(), 'public/data/rs2024-structured.json');

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000_000) {
    return `${(amount / 1_000_000_000_000).toFixed(2)}兆円`;
  } else if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)}億円`;
  } else if (amount >= 10_000) {
    return `${(amount / 10_000).toFixed(2)}万円`;
  }
  return `${amount}円`;
}

function analyzeSpecialAccountFunding() {
  console.log('\n========================================');
  console.log('特別会計の財源構成調査');
  console.log('========================================\n');

  // データ読み込み
  console.log('📖 データ読み込み中...');
  const data: RS2024StructuredData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`✅ ${data.budgets.length}件の事業を読み込みました\n`);

  // 特別会計の事業のみを抽出
  const specialAccountProjects = data.budgets.filter(b =>
    b.accountCategory === '特別会計' ||
    b.accountCategory?.includes('特別会計')
  );

  console.log(`🔍 特別会計の事業: ${specialAccountProjects.length}件\n`);

  // 予算の内訳を調査
  console.log('========================================');
  console.log('特別会計の予算内訳（Top 20事業）');
  console.log('========================================\n');

  // 予算規模順にソート
  const topProjects = [...specialAccountProjects]
    .sort((a, b) => b.totalBudget - a.totalBudget)
    .slice(0, 20);

  for (const project of topProjects) {
    console.log(`📊 ${project.projectName}`);
    console.log(`   府省庁: ${project.ministry}`);
    console.log(`   会計: ${project.account || '(未記載)'}`);
    console.log(`   会計区分: ${project.accountCategory}`);
    console.log(`   予算内訳:`);
    console.log(`     - 当初予算: ${formatCurrency(project.initialBudget)}`);
    console.log(`     - 補正予算: ${formatCurrency(project.supplementaryBudget)}`);
    console.log(`     - 繰越予算: ${formatCurrency(project.carryoverBudget)}`);
    console.log(`     - 予備費等: ${formatCurrency(project.reserveFund)}`);
    console.log(`     - 合計: ${formatCurrency(project.totalBudget)}\n`);
  }

  // 特別会計の種類別の集計
  console.log('========================================');
  console.log('特別会計の種類別予算内訳');
  console.log('========================================\n');

  const accountBreakdown = new Map<string, {
    projectCount: number;
    initialBudget: number;
    supplementaryBudget: number;
    carryoverBudget: number;
    reserveFund: number;
    totalBudget: number;
  }>();

  for (const project of specialAccountProjects) {
    const accountName = project.account || '(未分類)';

    if (!accountBreakdown.has(accountName)) {
      accountBreakdown.set(accountName, {
        projectCount: 0,
        initialBudget: 0,
        supplementaryBudget: 0,
        carryoverBudget: 0,
        reserveFund: 0,
        totalBudget: 0,
      });
    }

    const breakdown = accountBreakdown.get(accountName)!;
    breakdown.projectCount++;
    breakdown.initialBudget += project.initialBudget;
    breakdown.supplementaryBudget += project.supplementaryBudget;
    breakdown.carryoverBudget += project.carryoverBudget;
    breakdown.reserveFund += project.reserveFund;
    breakdown.totalBudget += project.totalBudget;
  }

  // 予算規模順にソート
  const sortedAccounts = Array.from(accountBreakdown.entries())
    .sort((a, b) => b[1].totalBudget - a[1].totalBudget)
    .slice(0, 10);

  for (const [accountName, breakdown] of sortedAccounts) {
    const initialRatio = (breakdown.initialBudget / breakdown.totalBudget * 100).toFixed(1);
    const supplementaryRatio = (breakdown.supplementaryBudget / breakdown.totalBudget * 100).toFixed(1);
    const carryoverRatio = (breakdown.carryoverBudget / breakdown.totalBudget * 100).toFixed(1);
    const reserveRatio = (breakdown.reserveFund / breakdown.totalBudget * 100).toFixed(1);

    console.log(`📘 ${accountName} (${breakdown.projectCount}事業)`);
    console.log(`   総予算: ${formatCurrency(breakdown.totalBudget)}`);
    console.log(`   内訳:`);
    console.log(`     - 当初予算: ${formatCurrency(breakdown.initialBudget)} (${initialRatio}%)`);
    console.log(`     - 補正予算: ${formatCurrency(breakdown.supplementaryBudget)} (${supplementaryRatio}%)`);
    console.log(`     - 繰越予算: ${formatCurrency(breakdown.carryoverBudget)} (${carryoverRatio}%)`);
    console.log(`     - 予備費等: ${formatCurrency(breakdown.reserveFund)} (${reserveRatio}%)\n`);
  }

  // 全体の傾向分析
  console.log('========================================');
  console.log('特別会計全体の予算構成比率');
  console.log('========================================\n');

  let totalInitial = 0;
  let totalSupplementary = 0;
  let totalCarryover = 0;
  let totalReserve = 0;
  let totalBudget = 0;

  for (const project of specialAccountProjects) {
    totalInitial += project.initialBudget;
    totalSupplementary += project.supplementaryBudget;
    totalCarryover += project.carryoverBudget;
    totalReserve += project.reserveFund;
    totalBudget += project.totalBudget;
  }

  console.log(`📊 特別会計の予算総額: ${formatCurrency(totalBudget)}`);
  console.log(`\n   内訳:`);
  console.log(`   - 当初予算: ${formatCurrency(totalInitial)} (${(totalInitial / totalBudget * 100).toFixed(1)}%)`);
  console.log(`   - 補正予算: ${formatCurrency(totalSupplementary)} (${(totalSupplementary / totalBudget * 100).toFixed(1)}%)`);
  console.log(`   - 繰越予算: ${formatCurrency(totalCarryover)} (${(totalCarryover / totalBudget * 100).toFixed(1)}%)`);
  console.log(`   - 予備費等: ${formatCurrency(totalReserve)} (${(totalReserve / totalBudget * 100).toFixed(1)}%)\n`);

  // 一般会計との比較
  console.log('========================================');
  console.log('一般会計との予算構成比率の比較');
  console.log('========================================\n');

  const generalAccountProjects = data.budgets.filter(b =>
    b.accountCategory === '一般会計'
  );

  let generalInitial = 0;
  let generalSupplementary = 0;
  let generalCarryover = 0;
  let generalReserve = 0;
  let generalTotal = 0;

  for (const project of generalAccountProjects) {
    generalInitial += project.initialBudget;
    generalSupplementary += project.supplementaryBudget;
    generalCarryover += project.carryoverBudget;
    generalReserve += project.reserveFund;
    generalTotal += project.totalBudget;
  }

  console.log('| 予算項目 | 一般会計 | 特別会計 |');
  console.log('|---------|---------|---------|');
  console.log(`| 当初予算 | ${(generalInitial / generalTotal * 100).toFixed(1)}% | ${(totalInitial / totalBudget * 100).toFixed(1)}% |`);
  console.log(`| 補正予算 | ${(generalSupplementary / generalTotal * 100).toFixed(1)}% | ${(totalSupplementary / totalBudget * 100).toFixed(1)}% |`);
  console.log(`| 繰越予算 | ${(generalCarryover / generalTotal * 100).toFixed(1)}% | ${(totalCarryover / totalBudget * 100).toFixed(1)}% |`);
  console.log(`| 予備費等 | ${(generalReserve / generalTotal * 100).toFixed(1)}% | ${(totalReserve / totalBudget * 100).toFixed(1)}% |\n`);

  console.log('========================================\n');
}

// 実行
try {
  analyzeSpecialAccountFunding();
} catch (error) {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
}
