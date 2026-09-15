import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS as P, POLICIES, THRESHOLDS, TRILLION as T, NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { calibratedResponse, consumptionTaxLimit, CONSUMPTION_TAX_CUT } from '../app/lib/fiscal-space/calibration';
import { peakConstraints, evaluateConstraints } from '../app/lib/fiscal-space/constraints';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { policyLoads } from '../app/lib/fiscal-space/policy-load';
import { LONG_RUN, longRunScenario } from '../app/lib/fiscal-space/long-run';
import { SUPPLY_CASES, supplyTotal, effectiveSupplyStock } from '../app/lib/fiscal-space/supply';
import { auditFiscalSpace } from '../app/lib/fiscal-space/risk-audit';
import { powerCase } from '../app/lib/fiscal-space/policy-trade';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import type { Policy } from '../types/fiscal-space';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenario, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { policyProduction } from '../app/lib/fiscal-space/policy-production';
import { productionCapacity } from '../app/lib/fiscal-space/production';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';

const policy = (id: string, overrides: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(x => x.id === id)!, ...overrides });
const near = (a: number, b: number) => assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
// Published-response checks explicitly disable the separate congestion scenario.
const flat = { ...P, capacityPriceSensitivity: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0, electricity: { ...P.electricity, demandGrowth: 0, peakGrowth: 0 } };
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
  const flat = { ...P, productionModel: 'cobbDouglas' as const, capacityPriceSensitivity: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0, electricity: { ...P.electricity, demandGrowth: 0, peakGrowth: 0 } };
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

test('energy +20% with no policy raises CPI but reduces nominal value added and real income, without improving debt/GDP', () => {
  const s = initialEconomy('latest');
  const base = simulate(s, [], 5, P);
  const shock = simulate(s, [], 5, P, { ...NO_SHOCK, energyPriceChange: .2 });
  shock.steps.forEach((step, i) => {
    near(step.state.macro.realGdp, base.steps[i].state.macro.realGdp);
    assert(step.state.macro.nominalGdp < base.steps[i].state.macro.nominalGdp);
    assert(step.state.fiscal.taxRevenue < base.steps[i].state.fiscal.taxRevenue);
    assert(step.state.fiscal.primaryExpenditure > base.steps[i].state.fiscal.primaryExpenditure);
    assert(step.importPriceEffects!.tradingIncomeChange < 0);
    assert(step.metrics.grossDebtGdp > base.steps[i].metrics.grossDebtGdp);
  });
  assert(shock.steps[0].state.macro.inflation > base.steps[0].state.macro.inflation);
});

test('import price level, CPI passthrough and expenditure indexation are independent channels', () => {
  const s = initial(), energy = { ...NO_SHOCK, energyPriceChange: .2 };
  const p = { ...flat, energyPricePassThrough: 0, energyDomesticPricePassThrough: 0 };
  const base = simulate(s, [], 5, p), shocked = simulate(s, [], 5, p, energy);
  for (const step of shocked.steps) {
    // A permanent price level shock is not repeatedly deducted each year.
    near(step.state.macro.nominalGdp, base.steps[0].state.macro.nominalGdp - s.energy.importBill * .2);
    near(step.state.macro.inflation, 0);
  }
  const recovered = simulate(s, [], 1, { ...p, energyDomesticPricePassThrough: 1 }, energy).steps[0];
  near(recovered.state.macro.nominalGdp, base.steps[0].state.macro.nominalGdp);
  assert(recovered.importPriceEffects!.tradingIncomeChange < 0);
  const run = (indexation: number) => simulate(s, [], 1, { ...flat, expenditurePriceIndexation: indexation }, energy).steps[0];
  const fixed = run(0), indexed = run(1), half = run(.5);
  near(fixed.state.macro.nominalGdp, indexed.state.macro.nominalGdp);
  near(fixed.state.fiscal.primaryExpenditure, s.fiscal.primaryExpenditure);
  near(indexed.state.fiscal.primaryExpenditure, s.fiscal.primaryExpenditure * (1 + indexed.state.macro.inflation));
  assert(half.state.fiscal.primaryExpenditure > fixed.state.fiscal.primaryExpenditure);
  assert(half.state.fiscal.primaryExpenditure < indexed.state.fiscal.primaryExpenditure);
  const cheaper = simulate(s, [], 1, p, { ...energy, energyPriceChange: -.2 }).steps[0];
  assert(cheaper.state.macro.nominalGdp > base.steps[0].state.macro.nominalGdp);
  assert(cheaper.importPriceEffects!.tradingIncomeChange > 0);
  for (const key of ['energyDomesticPricePassThrough', 'expenditurePriceIndexation'] as const) {
    for (const value of [-.1, 1.1, NaN]) assert.throws(() => simulate(s, [], 1, { ...P, [key]: value }));
  }
});

test('long-run payment prices reduce permanent R&D, grid and power quantities, without repricing past vintages', () => {
  const flat = { ...P, productionModel: 'ces' as const, capacityPriceSensitivity: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0, electricity: { ...P.electricity, demandGrowth: 0, peakGrowth: 0 } };
  const s = initial(), base = simulate(s, [], 5, flat);
  const cases = [
    policy('rd', { supply: SUPPLY_CASES.rd.settings }),
    policy('grid', { supply: SUPPLY_CASES.grid.settings }),
    policy('generation', { trade: { kind: 'power', assumptions: powerCase('solar') } }),
  ];
  for (const candidate of cases) {
    const cost = candidate.id === 'rd' ? T : .1 * T;
    const q = { ...candidate, annualCost: cost, kind: 'permanent' as const };
    const short = simulate(s, [q], 5, flat);
    const rows = [0, .02, .05].map(inflation => longRunScenario(s, [q], short, base, flat, { ...LONG_RUN, inflation }));
    assert(rows[0].at(-1)!.supplyBenefit > rows[1].at(-1)!.supplyBenefit, candidate.id);
    assert(rows[1].at(-1)!.supplyBenefit > rows[2].at(-1)!.supplyBenefit, candidate.id);
    near(rows[0][0].supplyBenefit, rows[2][0].supplyBenefit); // Year 6 uses the terminal short-run price.
    rows.forEach(path => path.forEach(row => near(row.policyCost, cost)));
    const past = { ...q, kind: 'temporary' as const, duration: 3 };
    const pastShort = simulate(s, [past], 5, flat);
    const low = longRunScenario(s, [past], pastShort, base, flat, { ...LONG_RUN, inflation: 0 });
    const high = longRunScenario(s, [past], pastShort, base, flat, { ...LONG_RUN, inflation: .05 });
    low.forEach((row, i) => near(row.supplyBenefit, high[i].supplyBenefit));
  }
});

test('next-trillion public capital pools residual stocks across spending durations before decreasing returns', () => {
  const s = initialEconomy('latest');
  const q = policy('public-investment', { annualCost: 100 * T, duration: 3, supply: SUPPLY_CASES['public-investment'].settings });
  const extra = { ...q, annualCost: T, duration: 1 };
  const c = q.supply!;
  const output = (stock: number) => s.macro.potentialGdp * Math.expm1(c.yield * Math.log1p(stock / (s.macro.realGdp * c.unitCost)));
  for (const year of [3, 4, 5, 10, 41, 42, 43, 45]) {
    const before = effectiveSupplyStock(s, q, year, P), addition = effectiveSupplyStock(s, extra, year, P);
    near(supplyTotal(s, [q, extra], year, P), output(before + addition));
    near(supplyTotal(s, [extra, q], year, P), output(before + addition));
  }
  const delta = supplyTotal(s, [q, extra], 3, P) - supplyTotal(s, [q], 3, P);
  assert(delta < supplyTotal(s, [extra], 3, P));
  // The old .122 output elasticity is the Cobb reference conversion only.
  // Leontief has no gain from extra nonbinding capital in this initial state.
  near(compareNextTrillion(s, [q], P, NO_SHOCK, THRESHOLDS, [extra])[0].investment!.supply!, 0);
  const comparison = compareNextTrillion(s, [q], { ...P, productionModel: 'cobbDouglas', baselineRealGrowth: 0 }, NO_SHOCK, THRESHOLDS, [extra])[0];
  near(comparison.investment!.supply!, delta);
});

test('CPI sensitivity reports freshly solved pre-reserve amounts alongside retained amounts', () => {
  const s = initialEconomy('latest'), mix = [{ policy: policy('public-investment'), weight: 1 }];
  const estimate = estimateFiscalSpace(s, mix, THRESHOLDS, 5, P);
  const audit = auditFiscalSpace(s, mix, estimate, THRESHOLDS, 5, P, NO_SHOCK);
  for (const row of audit.sensitivity) {
    const solved = estimateFiscalSpace(s, mix, { ...THRESHOLDS, inflation: row.limit }, 5, P);
    near(row.beforeReserve, solved.theoreticalMaximum);
    near(row.amount, solved.recommendedEnvelope);
    near(row.amount, row.beforeReserve * (1 - P.reserveShare));
  }
});

test('shared scenarios preserve new price sensitivities and migrate previous input schemas', () => {
  const form = defaults();
  form.calibration.energyDomesticPricePassThrough = .8;
  form.calibration.expenditurePriceIndexation = .4;
  assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  const legacy = JSON.parse(JSON.stringify(form));
  delete legacy.calibration.energyDomesticPricePassThrough;
  delete legacy.calibration.expenditurePriceIndexation;
  delete legacy.calibration.capacityPriceSensitivity;
  delete legacy.calibration.capacityPressureStart;
  delete legacy.calibration.referenceCapacityRatio;
  const encode = (version: string) => '#scenario=' + encodeURIComponent(JSON.stringify({ version, form: legacy }));
  for (const version of ['2026-09-15.2', '2026-09-15.3', '2026-09-15.4']) {
    const restored = decodeScenario(encode(version));
    near(restored.calibration.energyDomesticPricePassThrough, P.energyDomesticPricePassThrough);
    near(restored.calibration.expenditurePriceIndexation, P.expenditurePriceIndexation);
    near(restored.calibration.capacityPriceSensitivity, P.capacityPriceSensitivity);
  }
  assert.throws(() => decodeScenario(encode(FISCAL_MODEL_VERSION)));
  form.calibration.expenditurePriceIndexation = 1.1;
  assert.throws(() => encodeScenario(form));
});

test('selected production function governs labour, capital and productivity, including Leontief bottleneck switching', () => {
  const s = initial(); s.production.inputs = { capital: 1.02, labour: 1.08, energy: 1.12, materials: 1.2 };
  const tax = policy('income-tax', { annualCost: 20 * T });
  const capital = policy('public-investment', { annualCost: s.macro.realGdp * .2, duration: 1, capitalEffect: 1 });
  const p = { ...flat, hoursElasticity: 1 };
  const base = policyProduction(s, [], 1, p), labour = policyProduction(s, [tax], 1, p);
  near(labour.potential, base.potential); near(labour.maximum, base.maximum);
  const expanded = policyProduction(s, [capital], 1, p);
  near(expanded.potential / base.potential, 1.08 / 1.02);
  assert.equal(expanded.binding, 'labour');
  for (const productionModel of ['ces', 'cobbDouglas'] as const) {
    const q = { ...p, productionModel };
    assert(policyProduction(s, [tax], 1, q).potential > policyProduction(s, [], 1, q).potential);
    assert(policyProduction(s, [capital], 1, q).potential > policyProduction(s, [], 1, q).potential);
  }
  const technology = policy('rd', { annualCost: s.macro.realGdp * .1, duration: 1, tfpEffect: 1 });
  for (const productionModel of ['leontief', 'ces', 'cobbDouglas'] as const) {
    const q = { ...flat, productionModel };
    near(policyProduction(s, [], 1, q).potential, s.macro.potentialGdp);
    near(policyProduction(s, [technology], 1, q).potential / s.macro.potentialGdp, 1.1);
  }
  assert.throws(() => policyProduction(s, [{ ...capital, supply: SUPPLY_CASES['public-investment'].settings }], 3, p));
  assert.throws(() => policyProduction(s, [policy('generation', { capitalEffect: 1, trade: { kind: 'power', assumptions: powerCase('solar') } })], 3, p));
});

test('normal potential and maximum capacity share one function without multiplying the supply gain twice', () => {
  const s = initial();
  const rd = policy('rd', { annualCost: T, supply: SUPPLY_CASES.rd.settings });
  for (const productionModel of ['leontief', 'ces', 'cobbDouglas'] as const) {
    const p = { ...flat, productionModel };
    const base = simulate(s, [], 10, p), path = simulate(s, [rd], 10, p);
    path.steps.forEach((step, i) => {
      const direct = policyProduction(s, [rd], i + 1, p);
      near(step.state.macro.potentialGdp, direct.potential);
      near(step.production.maximum, direct.maximum);
      near(productionCapacity(step.state, p, i + 1).potential, direct.potential);
      near(step.production.maximum / base.steps[i].production.maximum,
        step.state.macro.potentialGdp / base.steps[i].state.macro.potentialGdp);
    });
  }
  s.production.tfp = 1.05;
  const p = { ...flat, productionModel: 'cobbDouglas' as const, cobbWeights: { capital: .3, labour: .4, energy: .2 } };
  const normalized = policyProduction(s, [], 1, p);
  near(normalized.potential, s.macro.potentialGdp);
  near(normalized.maximum, productionCapacity(s, p, 1).maximum);
});

test('energy investment helps a binding energy input, while extra nonbinding labour cannot bypass it', () => {
  const s = initial(); s.production.inputs = { capital: 1.18, labour: 1.08, energy: 1.01, materials: 1.2 };
  const p = { ...flat, hoursElasticity: 1 };
  const tax = policy('income-tax', { annualCost: 20 * T });
  const power = policy('generation', { annualCost: T, duration: 1, trade: { kind: 'power', assumptions: powerCase('solar') } });
  const base = policyProduction(s, [], 3, p);
  near(policyProduction(s, [tax], 3, p).potential, base.potential);
  assert(policyProduction(s, [power], 3, p).potential > base.potential);
  near(policyProduction(s, [power], 2, p).potential, base.potential); // Not commissioned yet.
  const noFirm = { ...power, trade: { kind: 'power' as const, assumptions: { ...powerCase('solar'), firmShare: 0 } } };
  near(policyProduction(s, [noFirm], 3, p).potential, base.potential);
  const firm = { ...power, trade: { kind: 'power' as const, assumptions: { ...powerCase('solar'), firmShare: .2 } } };
  assert(policyProduction(s, [firm], 3, p).potential > base.potential);
});

test('congestion changes CPI below the hard ceiling, is zero without policy, and cancels at the reference capacity', () => {
  const s = initial(), spending = policy('public-investment', { annualCost: 15 * T, duration: 3 });
  const p = { ...flat, capacityPriceSensitivity: P.capacityPriceSensitivity };
  const results = (['leontief', 'ces', 'cobbDouglas'] as const).map(productionModel => {
    const q = { ...p, productionModel };
    const base = simulate(s, [], 3, q), path = simulate(s, [spending], 3, q);
    base.steps.forEach(step => near(step.demand.capacityPriceAdjustment, 0));
    path.steps.forEach(step => near(step.demand.details[0].capacityFactor, 1));
    return path;
  });
  assert(results[0].steps[0].state.macro.inflation > results[1].steps[0].state.macro.inflation);
  // Demand volume stays at the published response while congestion changes prices.
  near(results[0].steps[0].state.macro.realGdp, results[1].steps[0].state.macro.realGdp);
  s.production.inputs = { capital: p.referenceCapacityRatio, labour: p.referenceCapacityRatio, energy: p.referenceCapacityRatio, materials: p.referenceCapacityRatio };
  const anchored = simulate(s, [spending], 3, p), off = simulate(s, [spending], 3, { ...p, capacityPriceSensitivity: 0 });
  anchored.steps.forEach((step, i) => {
    near(step.demand.capacityPriceAdjustment, 0);
    near(step.state.macro.inflation, off.steps[i].state.macro.inflation);
  });
  const strong = simulate(initial(), [spending], 3, { ...p, capacityPriceSensitivity: p.capacityPriceSensitivity * 2 });
  strong.steps.forEach((step, i) => near(step.demand.capacityPriceAdjustment, results[0].steps[i].demand.capacityPriceAdjustment * 2));
});

test('long-run public investment and commissioning use the selected production function', () => {
  const s = initial(), capital = policy('public-investment', { kind: 'permanent', annualCost: T, supply: SUPPLY_CASES['public-investment'].settings });
  const run = (productionModel: typeof P.productionModel) => {
    const p = { ...flat, productionModel };
    return longRunScenario(s, [capital], simulate(s, [capital], 5, p), simulate(s, [], 5, p), p, { ...LONG_RUN, realGrowth: 0 });
  };
  near(run('leontief').at(-1)!.supplyBenefit, 0);
  assert(run('ces').at(-1)!.supplyBenefit > 0);
  assert(run('cobbDouglas').at(-1)!.supplyBenefit > 0);
});

test('displayed 15-trillion model comparison exposes supply and CPI differences and keeps the current row consistent', () => {
  const form = defaults();
  Object.assign(form.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
  const result = createFiscalEngine()(form);
  const [leontief, ces] = result.modelSensitivity;
  assert.notEqual(leontief.cpiPeak, ces.cpiPeak);
  // At year five only R&D's common TFP channel remains in this particular mix.
  near(leontief.potentialEffect, ces.potentialEffect);
  near(leontief.space.theoreticalMaximum, result.estimate.theoreticalMaximum);
  near(leontief.gdpEffect, result.projection.steps[4].state.macro.realGdp - result.baseline.steps[4].state.macro.realGdp);
  form.amounts['public-investment'] = 1;
  const invested = createFiscalEngine()(form).modelSensitivity;
  assert(invested[1].potentialEffect > invested[0].potentialEffect);
});
