import type { BurdenResult, ConsumptionBasket, FiscalImpact, TaxState } from '@/types/tax-burden';
import { consumptionTax } from './consumption-tax';

/** Positive receipts improve the balance; positive benefit spending reduces it. No population extrapolation. */
export function fiscalImpact(before: BurdenResult, after: BurdenResult, state: TaxState,
  basket?: ConsumptionBasket): FiscalImpact {
  const incomeTax = after.incomeTax - before.incomeTax;
  const residentTax = after.residentTax - before.residentTax;
  const insurance = (after.pension + after.health + after.care + after.employment) -
    (before.pension + before.health + before.care + before.employment);
  const benefitSpending = after.benefits - before.benefits;
  const directBalance = incomeTax + residentTax + insurance - benefitSpending;
  let consumption: FiscalImpact['consumption'] = { status: 'uncomputed' };
  if (basket) {
    const base = consumptionTax(basket, 0.1, 0.08, state.consumptionAssumption);
    const reform = consumptionTax(basket, state.reform.standardVat, state.reform.reducedVat, state.consumptionAssumption);
    const delta = reform.tax - base.tax;
    // Scenario assumption: preserve the current 78:22 split for both rates, including reforms.
    const national = Math.round(delta * 0.78);
    consumption = { status: 'computed', national, local: delta - national };
  }
  return { incomeTax, residentTax, insurance, benefitSpending, directBalance, consumption,
    totalBalance: consumption.status === 'computed' ? directBalance + consumption.national + consumption.local : null,
    outOfScope: before.outOfScope || after.outOfScope };
}
