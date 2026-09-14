import type { DebtBucket, EconomyState, FiscalMetrics } from '@/types/fiscal-space';
import { positive } from './production';

export function debtRatioNext(debtRatio: number, r: number, g: number, pb: number, sfa = 0) {
  positive(1 + g, '1 + nominal growth');
  return (1 + r) / (1 + g) * debtRatio - pb + sfa;
}
export const stabilizingPb = (debtRatio: number, r: number, g: number, sfa = 0) => (r - g) / (1 + g) * debtRatio + sfa;

/** At the start of the year only maturing principal reprices. Net issuance pays next year. */
export function rollover(portfolio: DebtBucket[], year: number, marketRate: number, maturity: number) {
  positive(maturity, 'maturity');
  if (!Number.isInteger(maturity) || !Number.isFinite(marketRate) || marketRate < 0) throw new RangeError('Invalid debt parameters');
  let maturingDebt = 0;
  const buckets = portfolio.map(b => {
    if (!Number.isFinite(b.principal) || b.principal < 0 || !Number.isFinite(b.coupon) || b.coupon < 0) throw new RangeError('Invalid debt bucket');
    if (b.maturityYear <= year) { maturingDebt += b.principal; return { ...b, coupon: marketRate, maturityYear: year + maturity }; }
    return { ...b };
  });
  return { buckets, maturingDebt, interestPayments: buckets.reduce((s, b) => s + b.principal * b.coupon, 0) };
}
export function financeDebt(buckets: DebtBucket[], netBorrowing: number, year: number, rate: number, maturity: number) {
  const total = buckets.reduce((s, b) => s + b.principal, 0);
  if (netBorrowing >= 0) return { buckets: [...buckets, ...(netBorrowing ? [{ principal: netBorrowing, coupon: rate, maturityYear: year + maturity }] : [])], assetAccumulation: 0 };
  const scale = total > 0 ? Math.max(0, (total + netBorrowing) / total) : 0;
  return { buckets: buckets.map(b => ({ ...b, principal: b.principal * scale })).filter(b => b.principal > 0), assetAccumulation: Math.max(0, -netBorrowing - total) };
}
export function fiscalMetrics(state: EconomyState, maturingDebt: number, previousDebt: number, previousGdp: number, sfa = 0): FiscalMetrics {
  const f = state.fiscal, gdp = state.macro.nominalGdp;
  const effectiveRate = previousDebt > 0 ? f.interestPayments / previousDebt : 0;
  const grossFinancingNeeds = -f.primaryBalance + f.interestPayments + maturingDebt;
  return { grossDebtGdp: f.grossDebt / gdp, netDebtGdp: f.netDebt / gdp,
    liquidityAdjustedNetDebtGdp: f.liquidityAdjustedNetDebt / gdp, primaryBalanceGdp: f.primaryBalance / gdp,
    interestGdp: f.interestPayments / gdp, interestTax: f.taxRevenue > 0 ? f.interestPayments / f.taxRevenue : Infinity,
    grossFinancingNeeds, gfnGdp: grossFinancingNeeds / gdp, effectiveRate, stockFlowAdjustmentGdp: sfa,
    stabilizingPrimaryBalance: stabilizingPb(previousDebt / previousGdp, effectiveRate, state.macro.nominalGrowth, sfa) };
}
