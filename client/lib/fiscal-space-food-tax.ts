import { PARAMETERS, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { encodeTaxState } from '@/app/lib/tax-burden/reform-url';
import { initialTaxState } from '@/app/lib/tax-burden/households';
import type { ModelParameters } from '@/types/fiscal-space';

type ConsumptionTax = ModelParameters['consumptionTax'];
export type ConsumptionTaxTarget = 'all' | 'food';

/** 飲食料品（軽減税率8%）だけを下げる換算。税率1ポイント＝年0.6兆円は、財務省試算として報じられた
 * 「飲食料品の税率ゼロで年4.8兆円の減収」を8ポイントで割った値。
 * 対象CPI比率22%は家計調査2024（二人以上の勤労者世帯・十分位平均）の消費支出に占める軽減税率品目の割合で、
 * 税・社会保険料の負担比較と同じ品目分類。標準税率品目の85%と同じ考え方。 */
export const FOOD_TAX = { revenuePerPoint: .6 * TRILLION, cpiShare: .22, baseRate: .08,
  sourceUrl: 'https://www.dlri.co.jp/report/ld/634302.html' } as const;

export const consumptionTaxTarget = (c: ConsumptionTax): ConsumptionTaxTarget => c.baseRate < .1 ? 'food' : 'all';

/** Switches only the target-dependent fields; pass-through and the table-5 split stay as the user set them. */
export function consumptionTaxFor(target: ConsumptionTaxTarget, c: ConsumptionTax): ConsumptionTax {
  const base = target === 'food' ? FOOD_TAX : PARAMETERS.consumptionTax;
  return { ...c, revenuePerPoint: base.revenuePerPoint, cpiShare: base.cpiShare, baseRate: base.baseRate };
}

/** The engine takes annual revenue loss; the food control shows the resulting statutory rate. */
export const rateFromAmount = (amountTrillion: number, c: ConsumptionTax) =>
  Math.max(0, c.baseRate - amountTrillion * TRILLION / c.revenuePerPoint / 100);
export const amountFromRate = (rate: number, c: ConsumptionTax) =>
  Math.max(0, c.baseRate - rate) * 100 * c.revenuePerPoint / TRILLION;

/** Same reduced rate on the household-burden page, to see the effect per household. */
export const householdBurdenHref = (reducedRate: number) => {
  const state = initialTaxState();
  return `/tax-burden?${encodeTaxState({ ...state, includeConsumption: true, reform: { ...state.reform, reducedVat: Number(reducedRate.toFixed(4)) } })}`;
};
