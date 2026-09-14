import type { BurdenResult, ConsumptionBasket, ConsumptionDataset, FiscalImpact, TaxState } from '@/types/tax-burden';
import { basketForIncome, consumptionTax } from './consumption-tax';

/** Positive receipts improve the balance; positive benefit spending reduces it. No population extrapolation. */
export function fiscalImpact(before: BurdenResult, after: BurdenResult, state: TaxState,
  source?: ConsumptionBasket | ConsumptionDataset | null): FiscalImpact {
  const incomeTax = after.incomeTax - before.incomeTax;
  const residentTax = after.residentTax - before.residentTax;
  const insurance = (after.pension + after.health + after.care + after.employment) -
    (before.pension + before.health + before.care + before.employment);
  const benefitSpending = after.benefits - before.benefits;
  const directBalance = incomeTax + residentTax + insurance - benefitSpending;
  let consumption: FiscalImpact['consumption'] = { status: 'uncomputed' };
  const basket = !source ? null : 'deciles' in source ? (before.income > 0 ? basketForIncome(source, before.income) : null) : source;
  if (basket) {
    const base = consumptionTax(basket, 0.1, 0.08, state.consumptionAssumption);
    const reform = consumptionTax(basket, state.reform.standardVat, state.reform.reducedVat, state.consumptionAssumption);
    const delta = reform.tax - base.tax;
    // Statutory split: standard 7.8/10 national + 2.2/10 local; reduced 6.24/8 national + 1.76/8 local.
    // Both rates share the same 78:22 ratio, so the split applies to the total delta as well.
    const national = Math.round(delta * 0.78);
    consumption = { status: 'computed', national, local: delta - national };
  }
  return { incomeTax, residentTax, insurance, benefitSpending, directBalance, consumption,
    totalBalance: consumption.status === 'computed' ? directBalance + consumption.national + consumption.local : null,
    outOfScope: before.outOfScope || after.outOfScope };
}
