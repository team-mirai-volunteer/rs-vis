import type { DebtBucket, SourceValue } from '@/types/fiscal-space';
import jgb from './data/jgb-maturity.json';

/** Ordinary JGBs follow the published redemption schedule (scaled to outstanding) with the
 * published weighted-average coupon. The rest of general government debt (FILP bonds, financing
 * bills, borrowings, local government, consolidation differences) is a residual on a ten-year
 * ladder, its coupon set so total interest matches the observed general-government payment. */
export interface DebtPortfolioBuild {
  buckets: DebtBucket[];
  jgbPrincipal: number; residualPrincipal: number; residualCoupon: number; couponScale: number;
  jgbCoupon: number; scheduleScale: number;
}
const SCHEDULE = jgb.redemptionSchedule.buckets as { remainingYears: number; principalYen: number }[];
const JGB_OUTSTANDING = jgb.ordinaryJgb.outstandingTrillionYen * 1e12;
const JGB_COUPON = jgb.ordinaryJgb.weightedAverageCouponPercent / 100;
const SCHEDULE_TOTAL = jgb.redemptionSchedule.totalYen as number;
export const JGB_SOURCE = { name: jgb.source as string, url: jgb.sourcePage as string, asOf: jgb.asOf.outstanding as string, retrievedOn: jgb.retrievedOn as string };

export function buildDebtPortfolio(grossDebt: number, interestPayments: number, year0 = 0, residualLadder = 10): DebtPortfolioBuild {
  if (!(grossDebt > 0) || !(interestPayments >= 0) || !Number.isInteger(residualLadder) || residualLadder < 1) throw new RangeError('Invalid debt totals');
  const scheduleScale = Math.min(1, grossDebt / JGB_OUTSTANDING) * JGB_OUTSTANDING / SCHEDULE_TOTAL;
  const jgbBuckets: DebtBucket[] = SCHEDULE.map(b => ({ principal: b.principalYen * scheduleScale, coupon: JGB_COUPON, maturityYear: year0 + b.remainingYears }));
  const jgbPrincipal = jgbBuckets.reduce((s, b) => s + b.principal, 0);
  const residualPrincipal = Math.max(0, grossDebt - jgbPrincipal);
  const jgbInterest = jgbPrincipal * JGB_COUPON;
  const residualCoupon = residualPrincipal > 0 ? Math.max(0, (interestPayments - jgbInterest) / residualPrincipal) : 0;
  const residual: DebtBucket[] = residualPrincipal > 0
    ? Array.from({ length: residualLadder }, (_, i) => ({ principal: residualPrincipal / residualLadder, coupon: residualCoupon, maturityYear: year0 + i + 1 })) : [];
  let buckets = [...jgbBuckets, ...residual];
  // Match total interest exactly: when the JGB coupon alone exceeds the observed payment, scale all coupons.
  const interest = buckets.reduce((s, b) => s + b.principal * b.coupon, 0);
  const couponScale = interest > 0 ? interestPayments / interest : 1;
  buckets = buckets.map(b => ({ ...b, coupon: b.coupon * couponScale }));
  // Merge same-maturity buckets and absorb float rounding into the last one so the total reconciles to the yen.
  const merged = new Map<number, DebtBucket>();
  for (const b of buckets) {
    const old = merged.get(b.maturityYear);
    if (!old) merged.set(b.maturityYear, { ...b });
    else { const principal = old.principal + b.principal; merged.set(b.maturityYear, { principal, coupon: (old.principal * old.coupon + b.principal * b.coupon) / principal, maturityYear: b.maturityYear }); }
  }
  const out = [...merged.values()].sort((a, b) => a.maturityYear - b.maturityYear);
  const diff = grossDebt - out.reduce((s, b) => s + b.principal, 0);
  out[out.length - 1].principal += diff;
  return { buckets: out, jgbPrincipal, residualPrincipal, residualCoupon: residualCoupon * couponScale, couponScale, jgbCoupon: JGB_COUPON * couponScale, scheduleScale };
}

export function debtPortfolioRecords(build: DebtPortfolioBuild): SourceValue[] {
  const base = { referenceYear: JGB_SOURCE.asOf, sourceName: JGB_SOURCE.name, sourceUrl: JGB_SOURCE.url, publishedAt: JGB_SOURCE.retrievedOn };
  return [
    { ...base, key: 'debtPortfolio.jgbPrincipal', value: build.jgbPrincipal, unit: '円', status: 'derived',
      uncertaintyNote: `普通国債の残存期間別残高。公表の償還年次表（予算ベース、合計${(SCHEDULE_TOTAL / 1e12).toFixed(1)}兆円）を発行残高${(JGB_OUTSTANDING / 1e12).toFixed(1)}兆円に比例縮小。表面利率は加重平均${(JGB_COUPON * 100).toFixed(2)}%を一律に適用し、銘柄別の利率差・変動利付債・物価連動債は区別しない。` },
    { ...base, key: 'debtPortfolio.residualPrincipal', value: build.residualPrincipal, unit: '円', status: 'derived',
      uncertaintyNote: '一般政府総債務（IMF・連結額面）−普通国債。財投債・国庫短期証券・借入金・地方債・連結差を含む残差で、満期は1〜10年に均等配分する仮定。' },
    { ...base, key: 'debtPortfolio.residualCoupon', value: build.residualCoupon, unit: '比率（1 = 100%）', status: 'derived',
      uncertaintyNote: `残差債務の表面利率。一般政府の支払利子と普通国債の利払いの差から逆算${build.couponScale !== 1 ? `し、合計が公表の支払利子に一致するよう全体を${build.couponScale.toFixed(3)}倍に調整` : ''}。` },
  ];
}
