/**
 * 一般会計・特別会計の混在状況を調査するスクリプト
 *
 * 実行方法:
 *   npx tsx scripts/analyze-account-category.ts
 */

import fs from 'fs';
import path from 'path';
import type { RS2024StructuredData, BudgetRecord } from '@/types/structured';

const DATA_PATH = path.join(process.cwd(), 'public/data/rs2024-structured.json');

interface AccountCategoryStats {
  category: string;
  projectCount: number;
  totalBudget: number;
  totalSpending: number;
  ministries: Map<string, {
    projectCount: number;
    totalBudget: number;
    totalSpending: number;
  }>;
}

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

function analyzeAccountCategories() {
  console.log('\n========================================');
  console.log('一般会計・特別会計の混在状況調査');
  console.log('========================================\n');

  // データ読み込み
  console.log('📖 データ読み込み中...');
  const data: RS2024StructuredData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`✅ ${data.budgets.length}件の事業を読み込みました\n`);

  // 会計区分ごとに集計
  const categoryMap = new Map<string, AccountCategoryStats>();

  for (const budget of data.budgets) {
    const category = budget.accountCategory || '(未分類)';

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        category,
        projectCount: 0,
        totalBudget: 0,
        totalSpending: 0,
        ministries: new Map(),
      });
    }

    const stats = categoryMap.get(category)!;
    stats.projectCount++;
    stats.totalBudget += budget.totalBudget;
    stats.totalSpending += budget.totalSpendingAmount;

    // 府省庁別の集計
    if (!stats.ministries.has(budget.ministry)) {
      stats.ministries.set(budget.ministry, {
        projectCount: 0,
        totalBudget: 0,
        totalSpending: 0,
      });
    }

    const ministryStats = stats.ministries.get(budget.ministry)!;
    ministryStats.projectCount++;
    ministryStats.totalBudget += budget.totalBudget;
    ministryStats.totalSpending += budget.totalSpendingAmount;
  }

  // 結果表示
  console.log('========================================');
  console.log('会計区分別サマリ');
  console.log('========================================\n');

  const categories = Array.from(categoryMap.values()).sort((a, b) => b.totalBudget - a.totalBudget);

  for (const stats of categories) {
    const budgetRatio = (stats.totalBudget / data.metadata.totalBudgetAmount * 100).toFixed(2);
    const spendingRatio = stats.totalSpending > 0
      ? (stats.totalSpending / data.metadata.totalBudgetAmount * 100).toFixed(2)
      : '0.00';

    console.log(`📊 ${stats.category}`);
    console.log(`   事業数: ${stats.projectCount.toLocaleString()}件`);
    console.log(`   予算総額: ${formatCurrency(stats.totalBudget)} (${budgetRatio}%)`);
    console.log(`   支出総額: ${formatCurrency(stats.totalSpending)} (${spendingRatio}%)`);
    console.log(`   府省庁数: ${stats.ministries.size}省庁\n`);
  }

  // 一般会計と特別会計の詳細比較
  console.log('========================================');
  console.log('一般会計 vs 特別会計の詳細');
  console.log('========================================\n');

  const generalAccount = categoryMap.get('一般会計');
  const specialAccount = categoryMap.get('特別会計');

  if (generalAccount) {
    console.log('📘 一般会計の府省庁別内訳（Top 10）:');
    const sortedMinistries = Array.from(generalAccount.ministries.entries())
      .sort((a, b) => b[1].totalBudget - a[1].totalBudget)
      .slice(0, 10);

    for (const [ministry, mStats] of sortedMinistries) {
      console.log(`   ${ministry}: ${formatCurrency(mStats.totalBudget)} (${mStats.projectCount}事業)`);
    }
    console.log('');
  }

  if (specialAccount) {
    console.log('📕 特別会計の府省庁別内訳（Top 10）:');
    const sortedMinistries = Array.from(specialAccount.ministries.entries())
      .sort((a, b) => b[1].totalBudget - a[1].totalBudget)
      .slice(0, 10);

    for (const [ministry, mStats] of sortedMinistries) {
      console.log(`   ${ministry}: ${formatCurrency(mStats.totalBudget)} (${mStats.projectCount}事業)`);
    }
    console.log('');
  }

  // 混在している府省庁を調査
  console.log('========================================');
  console.log('一般会計と特別会計が混在している府省庁');
  console.log('========================================\n');

  const ministryAccountMix = new Map<string, {
    general: number;
    special: number;
    generalProjects: number;
    specialProjects: number;
  }>();

  for (const budget of data.budgets) {
    if (!ministryAccountMix.has(budget.ministry)) {
      ministryAccountMix.set(budget.ministry, {
        general: 0,
        special: 0,
        generalProjects: 0,
        specialProjects: 0,
      });
    }

    const mix = ministryAccountMix.get(budget.ministry)!;
    if (budget.accountCategory === '一般会計') {
      mix.general += budget.totalBudget;
      mix.generalProjects++;
    } else if (budget.accountCategory === '特別会計') {
      mix.special += budget.totalBudget;
      mix.specialProjects++;
    }
  }

  // 両方の会計を持つ府省庁のみ表示
  const mixedMinistries = Array.from(ministryAccountMix.entries())
    .filter(([_, mix]) => mix.general > 0 && mix.special > 0)
    .sort((a, b) => (b[1].general + b[1].special) - (a[1].general + a[1].special));

  console.log(`🔍 混在府省庁数: ${mixedMinistries.length}/${ministryAccountMix.size}省庁\n`);

  for (const [ministry, mix] of mixedMinistries) {
    const total = mix.general + mix.special;
    const generalRatio = (mix.general / total * 100).toFixed(1);
    const specialRatio = (mix.special / total * 100).toFixed(1);

    console.log(`📌 ${ministry}`);
    console.log(`   一般会計: ${formatCurrency(mix.general)} (${generalRatio}%) - ${mix.generalProjects}事業`);
    console.log(`   特別会計: ${formatCurrency(mix.special)} (${specialRatio}%) - ${mix.specialProjects}事業`);
    console.log(`   合計: ${formatCurrency(total)}\n`);
  }

  // 特別会計の種類を調査（account フィールド）
  console.log('========================================');
  console.log('特別会計の内訳（account フィールド）');
  console.log('========================================\n');

  const specialAccounts = new Map<string, { count: number; budget: number }>();

  for (const budget of data.budgets) {
    if (budget.accountCategory === '特別会計') {
      const accountName = budget.account || '(未分類)';
      if (!specialAccounts.has(accountName)) {
        specialAccounts.set(accountName, { count: 0, budget: 0 });
      }
      const acc = specialAccounts.get(accountName)!;
      acc.count++;
      acc.budget += budget.totalBudget;
    }
  }

  const sortedSpecialAccounts = Array.from(specialAccounts.entries())
    .sort((a, b) => b[1].budget - a[1].budget);

  console.log(`📊 特別会計の種類: ${sortedSpecialAccounts.length}種類\n`);

  for (const [accountName, stats] of sortedSpecialAccounts.slice(0, 20)) {
    console.log(`   ${accountName}`);
    console.log(`     予算: ${formatCurrency(stats.budget)} (${stats.count}事業)\n`);
  }

  console.log('========================================\n');
}

// 実行
try {
  analyzeAccountCategories();
} catch (error) {
  console.error('❌ エラーが発生しました:', error);
  process.exit(1);
}
