import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS as P, POLICIES, THRESHOLDS, TRILLION as T } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { calibratedResponse, consumptionTaxLimit, CONSUMPTION_TAX_CUT } from '../app/lib/fiscal-space/calibration';
import { peakConstraints, evaluateConstraints } from '../app/lib/fiscal-space/constraints';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { policyLoads } from '../app/lib/fiscal-space/policy-load';
import { LONG_RUN, longRunScenario } from '../app/lib/fiscal-space/long-run';
import { SUPPLY_CASES } from '../app/lib/fiscal-space/supply';
import { powerCase } from '../app/lib/fiscal-space/policy-trade';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import type { Policy } from '../types/fiscal-space';

const policy = (id: string, overrides: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(x => x.id === id)!, ...overrides });
const near = (a: number, b: number) => assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const flat = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0, electricity: { ...P.electricity, demandGrowth: 0, peakGrowth: 0 } };
const initial = () => { const s = initialEconomy(); s.macro.inflation = 0; s.macro.potentialGdp = s.macro.realGdp; return s; };

test('review reproduction: -5 and +3 gaps change baseline CPI and marginal policy prices before maximum capacity', () => {
  const run = (gap: number) => {
    const s = initial(); s.macro.potentialGdp = s.macro.realGdp / (1 + gap);
    const base = simulate(s, [], 1, flat).steps[0];
    const step = simulate(s, [policy('public-investment', { annualCost: 10 * T })], 1, flat).steps[0];
    near(step.demand.details[0].capacityFactor, 1);
    return { base, step, marginal: step.state.macro.inflation - base.state.macro.inflation };
  };
  const slack = run(-.05), hot = run(.03);
  assert(slack.base.state.macro.inflation < hot.base.state.macro.inflation);
  assert(slack.marginal < hot.marginal);
  assert(slack.step.demand.realOutput > hot.step.demand.realOutput);
  const zero = run(0);
  near(zero.step.demand.priceLevelEffect, 10 * T / initial().macro.realGdp * .15);
});

test('zero gap and disabled sensitivities preserve published responses without duplicate Phillips-curve inflation', () => {
  const s = initial(), q = policy('public-investment', { annualCost: s.macro.nominalGdp * .01, kind: 'permanent' });
  const path = simulate(s, [q], 5, flat);
  let index = 1;
  path.steps.forEach((step, i) => { index *= 1 + step.state.macro.inflation; near(index, 1 + [.0015, .0037, .0054, .0067, .0076][i]); });
  const off = { ...flat, gapDemandSensitivity: 0, gapPriceSensitivity: 0, gapInflationSlope: 0 };
  s.macro.potentialGdp = s.macro.realGdp / .95;
  near(simulate(s, [q], 1, off).steps[0].demand.realOutput, path.steps[0].demand.realOutput);
});

test('published long rates use the same scale and duration in both rollover and new debt', () => {
  const s = initial(), q = policy('public-investment', { annualCost: s.macro.nominalGdp * .01, kind: 'permanent' });
  const path = simulate(s, [q], 5, flat);
  near(path.steps[4].referenceRateEffect!, .0057);
  near(path.steps[4].refinancingRate!, .0257);
  near(path.steps[0].state.fiscal.interestPayments - simulate(s, [], 1, flat).steps[0].state.fiscal.interestPayments, s.fiscal.grossDebt / 10 * .0008);
  for (const step of path.steps) for (const bucket of step.state.debtPortfolio.filter(x => x.maturityYear === step.state.year + flat.newDebtMaturity)) near(bucket.coupon, step.refinancingRate!);
  const one = simulate(s, [{ ...q, kind: 'temporary', duration: 1 }], 5, flat);
  near(one.steps[4].referenceRateEffect!, .0008);
  const double = simulate(s, [{ ...q, annualCost: q.annualCost * 2 }], 5, flat);
  near(double.steps[4].referenceRateEffect!, .0114);
});

test('fixed production scenarios never manufacture unused capacity with time', () => {
  for (const productionModel of ['leontief', 'ces', 'cobbDouglas'] as const) {
    const path = simulate(initial(), [], 15, { ...P, productionModel });
    const ratio = path.steps[0].production.maximum / path.steps[0].state.macro.potentialGdp;
    for (const step of path.steps) near(step.production.maximum / step.state.macro.potentialGdp, ratio);
  }
});

test('unknown loads stay unevaluated even when year-zero utilization is the peak', () => {
  const s = initial(), q = policy('public-investment', { annualCost: 10 * T });
  const peaks = peakConstraints(simulate(s, [q], 5, flat), THRESHOLDS);
  assert.equal(peaks.find(x => x.id === 'sector')!.status, 'unevaluated');
  assert.equal(peaks.find(x => x.id === 'energy')!.status, 'unevaluated');
  s.labour.sectorUtilization.construction = 1.1;
  assert.equal(peakConstraints(simulate(s, [q], 1, flat), THRESHOLDS).find(x => x.id === 'sector')!.status, 'violated');
});

test('load coefficients constrain construction, while operating power survives spending and decays after commissioning', () => {
  const s = initial();
  const q = policy('public-investment', { annualCost: 10 * T, duration: 1, load: { sectorUtilizationPerTrillion: .01, peakGwPerTrillion: .1, operatingPeakGwPerTrillion: .2, lag: 2, lifetime: 2, depreciation: .5 } });
  const path = simulate(s, [q], 5, flat);
  near(path.steps[0].state.labour.sectorUtilization.construction, 1.04);
  assert.equal(evaluateConstraints(path.steps[0], THRESHOLDS).find(x => x.id === 'sector')!.status, 'violated');
  near(policyLoads(s, [q], 1, flat).peakGw, 1);
  near(policyLoads(s, [q], 2, flat).peakGw, 0);
  near(policyLoads(s, [q], 3, flat).peakGw, 2);
  near(policyLoads(s, [q], 4, flat).peakGw, 1);
  near(policyLoads(s, [q], 5, flat).peakGw, 0);
  const a = policyLoads(s, [q], 3, flat), b = policyLoads(s, [{ ...q, annualCost: 5 * T }, { ...q, annualCost: 5 * T }], 3, flat);
  near(a.peakGw, b.peakGw);
});

test('consumption-tax table uses percentage points, direct CPI is counted once and restoration raises headline inflation', () => {
  const s = initial();
  const p = { ...flat, consumptionTax: { ...flat.consumptionTax, cpiShare: .78 * 1.1 } };
  const q = policy('consumption-tax', { annualCost: p.consumptionTax.revenuePerPoint });
  const path = simulate(s, [q], 5, p);
  let index = 1;
  path.steps.forEach((step, i) => {
    index *= 1 + step.state.macro.inflation;
    near(index, 1 + CONSUMPTION_TAX_CUT.prices[i] / 100);
    near(step.demand.realOutput / s.macro.realGdp, CONSUMPTION_TAX_CUT.gdp[i] / 100);
    near(step.referenceRateEffect!, CONSUMPTION_TAX_CUT.longRate[i] / 100);
  });
  const temporary = simulate(s, [{ ...q, kind: 'temporary', duration: 1 }], 3, p);
  assert(temporary.steps[0].state.macro.inflation < temporary.steps[0].taxAdjustedInflation!);
  assert(temporary.steps[1].state.macro.inflation > temporary.steps[1].taxAdjustedInflation!);
  const inflation = evaluateConstraints(path.steps[0], { ...THRESHOLDS, inflation: .0001 }).find(x => x.id === 'inflation')!;
  assert.equal(inflation.status, 'violated');
  near(inflation.currentValue, path.steps[0].taxAdjustedInflation!);
  const income = calibratedResponse(s, policy('income-tax', { annualCost: q.annualCost }), 1, p);
  assert.notEqual(income.gdp, path.steps[0].demand.realOutput);
});

test('tax target coverage and pass-through change only the separately modelled direct price effect', () => {
  const s = initial(), q = policy('consumption-tax', { annualCost: T });
  const a = simulate(s, [q], 2, flat), b = simulate(s, [q], 2, { ...flat, consumptionTax: { ...flat.consumptionTax, passThrough: 0 } });
  near(a.steps[0].taxAdjustedInflation!, b.steps[0].taxAdjustedInflation!);
  near(a.steps[0].demand.realOutput, b.steps[0].demand.realOutput);
  assert(a.steps[0].state.macro.inflation < b.steps[0].state.macro.inflation);
  assert.throws(() => simulate(s, [{ ...q, annualCost: consumptionTaxLimit(P) + T }], 1, P));
  assert.equal(compareNextTrillion(s, [{ ...q, annualCost: consumptionTaxLimit(P) }], P, undefined, THRESHOLDS, [q]).length, 0);
});

test('long-run scenarios carry permanent costs and commissioning benefits without multiplier extrapolation', () => {
  const s = initial();
  const grid = policy('grid', { annualCost: T, duration: 1, supply: SUPPLY_CASES.grid.settings });
  const nuclear = policy('generation', { annualCost: T, duration: 1, trade: { kind: 'power', assumptions: powerCase('nuclear') } });
  const tax = policy('income-tax', { annualCost: T });
  const policies = [grid, nuclear, tax], short = simulate(s, policies, 5, flat), base = simulate(s, [], 5, flat);
  const a = longRunScenario(s, policies, short, base, flat, LONG_RUN);
  assert(a[0].supplyBenefit > 0, 'Grid starts in year six');
  assert(a.find(x => x.year === 11)!.supplyBenefit > a.find(x => x.year === 10)!.supplyBenefit, 'New nuclear starts in year eleven');
  near(a.at(-1)!.policyCost, T);
  const none = longRunScenario(s, policies, short, base, flat, { ...LONG_RUN, realization: 0 });
  assert(none.every(x => x.supplyBenefit === 0));
  const high = longRunScenario(s, policies, short, base, flat, { ...LONG_RUN, rate: .06 });
  assert(high.at(-1)!.debtGdp > a.at(-1)!.debtGdp);
  const noPolicy = longRunScenario(s, [], base, base, flat, LONG_RUN);
  for (const row of noPolicy) near(row.debtGdp, row.baselineDebtGdp);
});

test('model selection changes reference envelopes when capacity binds', () => {
  const s = initial(); s.production.inputs = { capital: 1.18, labour: 1.01, energy: 1.12, materials: 1.2 };
  const limits = { ...THRESHOLDS, inflation: .5, labour: 2 };
  const mix = [{ policy: policy('public-investment'), weight: 1 }];
  const a = estimateFiscalSpace(s, mix, limits, 5, { ...flat, productionModel: 'leontief' });
  const b = estimateFiscalSpace(s, mix, limits, 5, { ...flat, productionModel: 'ces' });
  assert(a.theoreticalMaximum < b.theoreticalMaximum);
});
