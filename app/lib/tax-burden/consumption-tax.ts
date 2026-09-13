import type { ConsumptionAssumption, ConsumptionBasket } from '@/types/tax-burden';

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
