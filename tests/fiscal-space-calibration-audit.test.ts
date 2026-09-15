import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS as P, POLICIES, TRILLION as T } from '../app/lib/fiscal-space/assumptions';
import { calibratedResponse } from '../app/lib/fiscal-space/calibration';
import { simulate } from '../app/lib/fiscal-space/simulate';
import type { ModelParameters } from '../types/fiscal-space';

const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const policy = (id: string) => ({ ...POLICIES.find(p => p.id === id)!, annualCost: T });

test('elasticity scenarios apply to nominal GDP with collection lag, before subtracting active tax cuts', () => {
  const initial = initialEconomy();
  for (const taxRevenueElasticity of [0, 1.1, 1.2, 1.3, 1.7, 2]) for (const taxCollectionLag of [0, 1, 3]) {
    const path = simulate(initial, [policy('income-tax')], 5, { ...P, taxRevenueElasticity, taxCollectionLag });
    path.steps.forEach((step, i) => {
      const revenueGdp = i < taxCollectionLag ? initial.macro.nominalGdp : path.steps[i - taxCollectionLag].state.macro.nominalGdp;
      near(step.state.fiscal.taxRevenue, initial.fiscal.taxRevenue * (revenueGdp / initial.macro.nominalGdp) ** taxRevenueElasticity - T);
    });
  }
});

test('VAT direct prices match tax-inclusive arithmetic at 0, 50, 70 and 100 percent and expire on restoration', () => {
  const initial = initialEconomy();
  initial.macro.inflation = 0;
  for (const baseRate of [.08, .10]) for (const cpiShare of [0, .85, 1]) for (const passThrough of [0, .5, .7, 1]) {
    const p = { ...P, baselineInflation: 0, inflationPersistence: 0, consumptionTax: { ...P.consumptionTax, baseRate, cpiShare, passThrough } };
    const q = { ...policy('consumption-tax'), annualCost: p.consumptionTax.revenuePerPoint, kind: 'temporary' as const, duration: 1 };
    const response = calibratedResponse(initial, q, 1, p);
    near(response.directTaxPrices, ((1 + baseRate - .01) / (1 + baseRate) - 1) * cpiShare * passThrough);
    near(response.directTaxDeflator, -.005 * passThrough);
    near(calibratedResponse(initial, q, 2, p).directTaxPrices, 0);
    const full = calibratedResponse(initial, q, 1, { ...p, consumptionTax: { ...p.consumptionTax, passThrough: 1 } });
    near(response.gdp, full.gdp); // This control is a direct-price scenario, not a re-estimated demand response.
  }
});

test('every numeric calibration control stays finite at its UI boundaries for five-year policy and energy-shock paths', () => {
  const ranges: [keyof ModelParameters, number, number][] = [
    ['taxRevenueElasticity', 0, 2], ['taxCollectionLag', 0, 3],
    ['gapDemandSensitivity', 0, 10], ['gapPriceSensitivity', 0, 10], ['gapInflationSlope', 0, .2], ['marketRate', 0, .06],
    ['energyPricePassThrough', 0, 1], ['energyDomesticPricePassThrough', 0, 1], ['expenditurePriceIndexation', 0, 1],
    ['multiplierScale', 0, 3], ['employeeReliefShare', 0, 1], ['hoursElasticity', 0, 1], ['participationElasticity', 0, 1],
    ['employerDemandElasticity', 0, 1], ['netLabourIncomeShare', .2, .7], ['employerLabourCostShare', .3, .9],
  ];
  const taxRanges: [keyof ModelParameters['consumptionTax'], number, number][] = [
    ['revenuePerPoint', T, 5 * T], ['cpiShare', 0, 1], ['baseRate', .08, .1], ['passThrough', 0, 1], ['referenceDirectCpi', 0, 1],
  ];
  const cases = ranges.flatMap(([key, low, high]) => [low, high].map(value => ({ ...P, [key]: value })));
  cases.push(...taxRanges.flatMap(([key, low, high]) => [low, high].map(value => ({ ...P, consumptionTax: { ...P.consumptionTax, [key]: value } }))));
  function finite(value: unknown, path: string) {
    if (typeof value === 'number') assert(Number.isFinite(value), path);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`);
  }
  for (const referenceModel of ['ef2026', 'esri2022'] as const) for (const [index, p] of cases.entries()) {
    const result = simulate(initialEconomy(), ['public-investment', 'income-tax', 'social-insurance', 'consumption-tax'].map(policy), 5,
      { ...p, referenceModel }, { marketRateDelta: .01, energyPriceChange: .3, realGrowthDelta: 0 });
    for (const step of result.steps) {
      finite(step.state, `${referenceModel}.${index}.year${step.state.year}`);
      assert(step.state.macro.nominalGdp > 0);
      assert(step.state.labour.participation <= 1);
      near(step.state.fiscal.primaryBalance, step.state.fiscal.taxRevenue + step.state.fiscal.otherPrimaryRevenue - step.state.fiscal.primaryExpenditure);
    }
  }
});
