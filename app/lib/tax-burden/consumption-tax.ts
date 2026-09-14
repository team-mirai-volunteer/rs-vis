import type { ConsumptionAssumption, ConsumptionBasket, ConsumptionDataset } from '@/types/tax-burden';

export function consumptionTax(basket: ConsumptionBasket, standardRate: number, reducedRate: number,
  assumption: ConsumptionAssumption, baselineStandard = 0.1, baselineReduced = 0.08) {
  const values = [basket.standardGross, basket.reducedGross, basket.exemptGross];
  if (values.some(v => !Number.isFinite(v) || v < 0) ||
      [standardRate, reducedRate, baselineStandard, baselineReduced].some(r => !Number.isFinite(r) || r < 0 || r > 1)) {
    throw new Error('消費支出・税率が有効な範囲にありません');
  }
  const part = (gross: number, rate: number, base: number) => {
    const spending = assumption === 'net-fixed' ? gross / (1 + base) * (1 + rate) : gross;
    return { spending, tax: spending * rate / (1 + rate) };
  };
  const standard = part(basket.standardGross, standardRate, baselineStandard);
  const reduced = part(basket.reducedGross, reducedRate, baselineReduced);
  const tax = standard.tax + reduced.tax;
  const taxableSpending = standard.spending + reduced.spending;
  const maxRate = Math.max(standardRate, reducedRate);
  if (tax > taxableSpending * maxRate / (1 + maxRate) + 0.01) throw new Error('消費税の支出比検証に失敗しました');
  return { tax: Math.round(tax), spending: Math.round(taxableSpending + basket.exemptGross),
    spendingRate: taxableSpending > 0 ? tax / taxableSpending : null };
}

/**
 * Tax-inclusive spending basket for a household with the given annual income, interpolated linearly
 * between the survey deciles by their average annual income (ratios to income, not absolute yen, are interpolated
 * so that the basket scales with income inside a decile). Outside the surveyed range the nearest decile's ratios apply.
 */
export function basketForIncome(dataset: ConsumptionDataset, income: number): ConsumptionBasket & { decile: number; propensity: number } {
  const d = dataset.deciles;
  if (!d.length || !Number.isFinite(income) || income < 0) throw new Error('消費支出データが無いか年収が不正です');
  if (income === 0) return { standardGross: 0, reducedGross: 0, exemptGross: 0, decile: d[0].decile, propensity: d[0].propensity };
  const ratio = (x: typeof d[number]) => ({ s: x.standardGross / x.annualIncome, r: x.reducedGross / x.annualIncome, e: x.exemptGross / x.annualIncome, p: x.propensity });
  let low = d[0], high = d[0];
  for (const x of d) { if (x.annualIncome <= income) low = x; }
  for (let i = d.length - 1; i >= 0; i--) { if (d[i].annualIncome >= income) high = d[i]; }
  const a = ratio(low), b = ratio(high);
  const t = high.annualIncome === low.annualIncome ? 0 : (income - low.annualIncome) / (high.annualIncome - low.annualIncome);
  const mix = (u: number, v: number) => u + (v - u) * Math.max(0, Math.min(1, t));
  const near = t < 0.5 ? low : high;
  return {
    standardGross: Math.round(mix(a.s, b.s) * income),
    reducedGross: Math.round(mix(a.r, b.r) * income),
    exemptGross: Math.round(mix(a.e, b.e) * income),
    decile: near.decile,
    propensity: mix(a.p, b.p),
  };
}

/** Estimated consumption tax for one household-year under the current (baseline) rates. */
export function estimatedConsumptionTax(dataset: ConsumptionDataset | null | undefined, income: number,
  standardRate = 0.1, reducedRate = 0.08, assumption: ConsumptionAssumption = 'net-fixed'): number {
  if (!dataset || income <= 0) return 0;
  return consumptionTax(basketForIncome(dataset, income), standardRate, reducedRate, assumption).tax;
}
