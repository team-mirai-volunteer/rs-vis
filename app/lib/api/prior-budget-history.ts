import { loadQualityScores } from './quality-scores-loader';

/** Keep execution and unused ratios separate, without rounding before classification. */
export function priorBudgetHistory(year: string) {
  const priorYear = String(Number(year) - 1);
  const priorExecutionRates: Record<string, number> = {};
  const priorUnusedRatios: Record<string, number> = {};
  if (priorYear !== '2024' && priorYear !== '2025') return { priorYear: null, priorExecutionRates, priorUnusedRatios };
  for (const row of loadQualityScores(priorYear).items) {
    if (!(row.budgetAmount > 0 && row.execAmount != null && row.execAmount > 0)) continue;
    priorExecutionRates[row.pid] = row.execAmount / row.budgetAmount;
    if (row.carryoverToNext != null && Number.isFinite(row.carryoverToNext) && row.carryoverToNext >= 0)
      priorUnusedRatios[row.pid] = Math.max(0, row.budgetAmount - row.execAmount - row.carryoverToNext) / row.budgetAmount;
  }
  return { priorYear, priorExecutionRates, priorUnusedRatios };
}
