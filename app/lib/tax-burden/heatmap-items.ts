import type { LifecycleYear, TaxItem } from '@/types/tax-burden';
import { TAX_ITEMS } from './households';

export type HeatmapGrid = { income: number; cells: LifecycleYear[] }[];

/** The model pays these cash benefits one by one; their total only deserves its own panel when more than one of them pays. */
export const BENEFIT_PARTS: TaxItem[] = ['childBenefit', 'singleParentBenefit', 'pensionSupport', 'reformCredit'];

/** Rates are relative to the fixed working-age income class (the row), never to pension income; money received counts as negative burden. */
export function cellRate(y: LifecycleYear, item: TaxItem): number | null {
  if (y.careerIncome <= 0) return null;
  const per = (amount: number) => amount / y.careerIncome;
  switch (item) {
    case 'net': return y.careerRate;
    case 'consumption': return per(y.consumptionTax);
    case 'benefits': return per(-y.benefits);
    case 'childBenefit': return per(-y.childBenefit);
    case 'singleParentBenefit': return per(-y.singleParentBenefit);
    case 'pensionSupport': return per(-y.pensionSupport);
    case 'reformCredit': return per(-y.reformCredit);
    case 'pensionReceipt': return per(-y.pensionIncome);
    default: return per(y[item]);
  }
}

/** Items worth offering for this grid: benefits that never pay are dropped, and so is their total when only one of them pays. */
export function availableTaxItems(grid: HeatmapGrid, hasConsumption: boolean) {
  const pays = (id: TaxItem) => grid.some(r => r.cells.some(c => (cellRate(c, id) ?? 0) !== 0));
  const parts = BENEFIT_PARTS.filter(pays);
  return TAX_ITEMS.filter(t => {
    if (!hasConsumption && t.id === 'consumption') return false;
    if (t.id === 'benefits') return parts.length > 1;
    if (BENEFIT_PARTS.includes(t.id)) return parts.includes(t.id);
    return true;
  });
}
