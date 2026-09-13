import type { MOFBudgetOverview } from '@/types/mof-budget-overview';
import type { TaxRevenue } from '@/types/tax-burden';

export function taxRevenueFromOverview(data: MOFBudgetOverview): TaxRevenue {
  const revenue = data.generalAccount.revenue;
  const taxTotal = revenue.byCategory.find(c => c.name === '租税')?.amount;
  const stamp = revenue.byCategory.find(c => c.name === '印紙収入')?.amount;
  if (taxTotal === undefined || stamp === undefined || !revenue.taxes?.length) throw new Error('税目別歳入が収録されていません');
  const sum = revenue.taxes.reduce((total, row) => total + row.amount, 0);
  if (sum !== taxTotal || revenue.taxes.some(row => !Number.isSafeInteger(row.amount) || row.amount < 0)) throw new Error('税目別歳入と租税合計が一致しません');
  return { metadata: { fiscalYear: data.metadata.fiscalYear, budgetType: data.metadata.budgetType,
    source: '財務省予算書（既存のMOF集計データ）', scope: '一般会計の租税・印紙収入。地方税・社会保険料を含まない。' },
    taxes: [...revenue.taxes].sort((a, b) => b.amount - a.amount), stamp, total: sum + stamp };
}
