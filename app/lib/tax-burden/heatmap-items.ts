import type { Denominator, LifecycleYear, TaxItem } from '@/types/tax-burden';
import { TAX_ITEMS } from './households';

export type HeatmapGrid = { income: number; cells: LifecycleYear[] }[];

/** The model pays these cash benefits one by one; their total only deserves its own panel when more than one of them pays. */
export const BENEFIT_PARTS: TaxItem[] = ['childBenefit', 'singleParentBenefit', 'pensionSupport', 'reformCredit'];
/** Items that only exist under an assumption the user switched on; hidden while they are zero everywhere. */
const CONDITIONAL: TaxItem[] = [...BENEFIT_PARTS, 'corporateTax'];

export const DENOMINATOR_LABEL: Record<Denominator, string> = { career: '現役期年収比', income: '総収入比' };

/**
 * Net burden rate for one year. With 'career' the pension counts as a negative burden and the denominator stays the
 * working-age income class; with 'income' the pension sits in the denominator instead and the rate is the ordinary
 * burden ÷ money received.
 */
export function yearRate(y: LifecycleYear, denominator: Denominator, includeConsumption = true): number | null {
  if (denominator === 'income') return includeConsumption ? y.netRateWithConsumption : y.netRate;
  if (y.careerIncome <= 0) return null;
  return (y.pensionAdjustedBurden - (includeConsumption ? 0 : y.consumptionTax)) / y.careerIncome;
}

/** Rates are relative to the chosen denominator; money received counts as negative. */
export function cellRate(y: LifecycleYear, item: TaxItem, denominator: Denominator = 'career'): number | null {
  const base = denominator === 'career' ? y.careerIncome : y.income;
  if (base <= 0) return null;
  const per = (amount: number) => amount / base;
  switch (item) {
    case 'net': return yearRate(y, denominator);
    case 'consumption': return per(y.consumptionTax);
    case 'benefits': return per(-y.benefits);
    case 'childBenefit': return per(-y.childBenefit);
    case 'singleParentBenefit': return per(-y.singleParentBenefit);
    case 'pensionSupport': return per(-y.pensionSupport);
    case 'reformCredit': return per(-y.reformCredit);
    case 'corporateTax': return per(y.corporateTax);
    case 'pensionReceipt': return per(-y.pensionIncome);
    default: return per(y[item]);
  }
}

/** Items worth offering for this grid: benefits that never pay are dropped, and so is their total when only one of them pays. */
export function availableTaxItems(grid: HeatmapGrid, hasConsumption: boolean, denominator: Denominator = 'career') {
  const pays = (id: TaxItem) => grid.some(r => r.cells.some(c => (cellRate(c, id, denominator) ?? 0) !== 0));
  const parts = BENEFIT_PARTS.filter(pays);
  return TAX_ITEMS.filter(t => {
    if (!hasConsumption && t.id === 'consumption') return false;
    if (t.id === 'benefits') return parts.length > 1;
    if (BENEFIT_PARTS.includes(t.id)) return parts.includes(t.id);
    if (CONDITIONAL.includes(t.id)) return pays(t.id);
    return true;
  });
}
