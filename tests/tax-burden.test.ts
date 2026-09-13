import test from 'node:test';
import assert from 'node:assert/strict';
import raw from '../scripts/data/tax-burden-params-2025.json';
import type { TaxParameters } from '../types/tax-burden';
import { initialTaxState, MODEL_VERSION } from '../app/lib/tax-burden/households';
import { simulate, incomeTaxFromBase, standardMonthlyRemuneration } from '../app/lib/tax-burden/simulate';
import { consumptionTax } from '../app/lib/tax-burden/consumption-tax';
import { fiscalImpact } from '../app/lib/tax-burden/fiscal-impact';
import { encodeTaxState, decodeTaxState } from '../app/lib/tax-burden/reform-url';

const p = raw as TaxParameters;

test('zero-income rate stays undefined while cash amounts remain available', () => {
  const result = simulate({ ...initialTaxState(), income: 0 }, p);
  assert.equal(result.netRate, null);
  assert.equal(result.childBenefit, 240000);
  assert.equal(result.outOfScope, true);
});
test('coverage follows each worker, not household income; non-working spouse excluded', () => {
  const base = { ...initialTaxState(), income: 5000000 };
  assert.equal(simulate({ ...base, household: 'two-earners-children', share: 67 }, p).outOfScope, true);
  assert.equal(simulate({ ...base, household: 'two-earners-children', share: 50 }, p).outOfScope, false);
  assert.equal(simulate({ ...base, household: 'one-earner-children' }, p).outOfScope, false);
  assert.equal(simulate({ ...base, income: p.minimumAnnualWage }, p).outOfScope, false);
  assert.equal(simulate({ ...base, income: p.minimumAnnualWage - 1 }, p).outOfScope, true);
});
test('care contribution switches at age 40 and the spouse income split is symmetric', () => {
  const state = initialTaxState();
  assert.equal(simulate({ ...state, age: 39 }, p).care, 0);
  assert(simulate({ ...state, age: 40 }, p).care > 0);
  assert.equal(simulate({ ...state, household: 'two-earners', share: 33 }, p).netBurden,
    simulate({ ...state, household: 'two-earners', share: 67 }, p).netBurden);
});
test('standard monthly remuneration changes exactly at a bracket boundary', () => {
  assert.equal(standardMonthlyRemuneration(269999, p), 260000);
  assert.equal(standardMonthlyRemuneration(270000, p), 280000);
});
test('income tax example: seven-million taxable income, reconstruction tax and rounding', () => {
  assert.equal(incomeTaxFromBase(7000000, p), 994400);
  assert.equal(incomeTaxFromBase(7000999, p), 994400);
});
test('bonus allocation respects pension cap per payment and alters contribution', () => {
  const state = { ...initialTaxState(), household: 'single' as const, income: 20000000 };
  assert.equal(simulate(state, p).pension, 713700);
  assert(simulate({ ...state, bonus: true }, p).pension > simulate(state, p).pension);
});
test('cash benefits can exceed burdens; rates are not clamped', () => {
  const state = { ...initialTaxState(), income: 100000, household: 'single-children' as const };
  assert(simulate(state, p).netRate! < 0);
  assert(simulate({ ...state, household: 'single', income: 10000 }, p).netRate! > 1);
});
test('no reform means zero fiscal delta, while missing VAT remains uncomputed', () => {
  const state = initialTaxState();
  const before = simulate(state, p);
  const result = fiscalImpact(before, simulate(state, p, state.reform), state);
  assert.equal(result.directBalance, 0);
  assert.equal(result.totalBalance, null);
  assert.equal(result.consumption.status, 'uncomputed');
});
test('extra child benefit increases spending and reduces balance, not tax receipts', () => {
  const state = initialTaxState();
  state.reform.childMonthly += 1000;
  const result = fiscalImpact(simulate(state, p), simulate(state, p, state.reform), state);
  assert.equal(result.benefitSpending, 24000);
  assert.equal(result.incomeTax, 0);
  assert.equal(result.directBalance, -24000);
});
test('refundable household credit phases out and stops at zero', () => {
  const state = initialTaxState();
  state.reform.creditAnnual = 300000;
  assert.equal(simulate({ ...state, income: 3000000 }, p, state.reform).reformCredit, 300000);
  assert.equal(simulate({ ...state, income: 5000000 }, p, state.reform).reformCredit, 100000);
  assert.equal(simulate({ ...state, income: 7000000 }, p, state.reform).reformCredit, 0);
});
test('VAT uses tax-inclusive spending, and rates above 10% are valid', () => {
  const basket = { standardGross: 2200000, reducedGross: 0, exemptGross: 100000 };
  assert.equal(consumptionTax(basket, 0.1, 0.08, 'net-fixed').tax, 200000);
  assert.equal(consumptionTax(basket, 0.2, 0.08, 'net-fixed').tax, 400000);
  assert.equal(consumptionTax(basket, 0.2, 0.08, 'gross-fixed').tax, 366667);
  assert.equal(consumptionTax({ standardGross: 0, reducedGross: 0, exemptGross: 1 }, 0.1, 0.08, 'net-fixed').spendingRate, null);
});
test('VAT fiscal delta follows the same fixed assumption and national-local sums reconcile', () => {
  const state = initialTaxState();
  state.reform.standardVat = 0.2;
  const basket = { standardGross: 2200000, reducedGross: 0, exemptGross: 0 };
  const before = simulate(state, p);
  const fixed = fiscalImpact(before, before, state, basket);
  const gross = fiscalImpact(before, before, { ...state, consumptionAssumption: 'gross-fixed' }, basket);
  assert.equal(fixed.totalBalance, 200000);
  assert.equal(gross.totalBalance, 166667);
  assert.deepEqual(fixed.consumption, { status: 'computed', national: 156000, local: 44000 });
});
test('URL round trips every calculation and display condition', () => {
  const state = { ...initialTaxState(), age: 55, share: 45, bonus: true, showAll: false, consumptionAssumption: 'gross-fixed' as const };
  state.reform.creditAnnual = 250000;
  assert.deepEqual(decodeTaxState(encodeTaxState(state)), { state, warning: null });
});
test('unknown model and invalid numbers fail safely with a visible warning', () => {
  assert(decodeTaxState('?v=future&fy=2025').warning);
  const decoded = decodeTaxState(`?v=${MODEL_VERSION}&fy=2025&income=Infinity&age=NaN&share=-1&creditAnnual=999999999&household=unknown`);
  assert(decoded.warning);
  assert.deepEqual(decoded.state, initialTaxState());
});
