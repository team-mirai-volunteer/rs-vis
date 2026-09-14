import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS as P, POLICIES, THRESHOLDS, TRILLION as T, NO_SHOCK, assumptionRecords } from '../app/lib/fiscal-space/assumptions';
import { debtRatioNext, rollover, financeDebt } from '../app/lib/fiscal-space/debt';
import { leontief, ces } from '../app/lib/fiscal-space/production';
import { allocateDemand } from '../app/lib/fiscal-space/demand';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { estimateFiscalSpace, allocateMix } from '../app/lib/fiscal-space/search';
import { peakConstraints } from '../app/lib/fiscal-space/constraints';
import { compareNextTrillion, rateShockComparison } from '../app/lib/fiscal-space/compare';
import type { Policy } from '../types/fiscal-space';

const preset = (id: string, overrides: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(p => p.id === id)!, ...overrides });
const near = (a: number, b: number, tolerance = 1e-10) => assert(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≈ ${b}`);
const last = (policies: Policy[]) => simulate(initialEconomy(), policies).steps[9];

test('r > g raises debt/GDP at the same PB', () => {
  assert(debtRatioNext(2, .04, .01, 0) > 2);
  assert(debtRatioNext(2, .04, .01, .01) > debtRatioNext(2, .01, .01, .01));
});
test('g > r lowers debt/GDP', () => assert(debtRatioNext(2, .01, .04, 0) < 2));
test('rate shock reprices only maturing debt, not the entire portfolio', () => {
  const b = initialEconomy().debtPortfolio;
  near(rollover(b, 1, .03, 10).interestPayments - rollover(b, 1, .02, 10).interestPayments, b[0].principal * .01);
});
test('shorter maturity transmits interest shocks sooner', () => {
  const short = [{ principal: 100, coupon: .01, maturityYear: 1 }], long = [{ ...short[0], maturityYear: 5 }];
  assert(rollover(short, 1, .04, 10).interestPayments > rollover(long, 1, .04, 10).interestPayments);
});
test('Leontief ignores extra nonbinding input', () => {
  const input = { capital: 1, labour: 2, energy: 3, materials: 4 };
  assert.equal(leontief(input).maximum, leontief({ ...input, energy: 6 }).maximum);
  assert.equal(leontief(input).binding, 'capital'); assert.equal(leontief(input).second, 'labour');
});
test('relaxing binding input raises Leontief maximum', () => {
  const input = { capital: 1, labour: 2, energy: 3, materials: 4 };
  assert(leontief({ ...input, capital: 1.5 }).maximum > leontief(input).maximum);
});
test('CES higher substitution elasticity cushions a single shortage, including sigma=1 limit', () => {
  const input = { capital: 1, labour: 1, energy: .5, materials: 1 };
  assert(ces(input, P.weights, 2) > ces(input, P.weights, .4));
  near(ces(input, P.weights, 1), ces(input, P.weights, 1 + 1e-9));
  assert(Number.isFinite(ces(input, P.weights, .001)));
});
test('larger supply slack routes more demand into real output', () => {
  const tight = initialEconomy(), loose = initialEconomy();
  tight.macro.potentialGdp = 555 * T; loose.macro.potentialGdp = 700 * T;
  assert(allocateDemand(loose, [preset('cash')], P).realOutput > allocateDemand(tight, [preset('cash')], P).realOutput);
});
test('approaching the supply ceiling raises import and price leakage shares', () => {
  const tight = initialEconomy(), loose = initialEconomy();
  tight.macro.potentialGdp = 556 * T; loose.macro.potentialGdp = 700 * T;
  const a = allocateDemand(tight, [preset('cash')], P), b = allocateDemand(loose, [preset('cash')], P);
  assert(a.prices / a.additionalDemand > b.prices / b.additionalDemand);
  assert(a.imports / a.additionalDemand > b.imports / b.additionalDemand);
});
test('higher import propensity reduces domestic real GDP effect', () => {
  const s = initialEconomy();
  assert(allocateDemand(s, [preset('cash', { importPropensity: .1 })], P).realOutput > allocateDemand(s, [preset('cash', { importPropensity: .7 })], P).realOutput);
});
test('permanent cost worsens long-run debt more than equal temporary cost', () => {
  assert(last([preset('cash', { kind: 'permanent', duration: 1 })]).metrics.grossDebtGdp > last([preset('cash', { duration: 1 })]).metrics.grossDebtGdp);
});
test('sufficient lagged growth can offset short-run investment debt', () => {
  const baseline = simulate(initialEconomy(), []);
  const growth = simulate(initialEconomy(), [preset('rd', { duration: 1, potentialGdpEffect: 10, implementationLag: 3 })]);
  assert(growth.steps[0].state.fiscal.grossDebt > baseline.steps[0].state.fiscal.grossDebt);
  assert(growth.steps[9].metrics.grossDebtGdp < baseline.steps[9].metrics.grossDebtGdp);
  assert.equal(growth.steps[0].state.macro.potentialGdp, baseline.steps[0].state.macro.potentialGdp);
});
test('stricter thresholds reduce the fiscal envelope', () => {
  const mix = [{ policy: preset('cash'), weight: 1 }];
  const broad = estimateFiscalSpace(initialEconomy(), mix, THRESHOLDS, 10);
  const strict = estimateFiscalSpace(initialEconomy(), mix, { ...THRESHOLDS, inflation: .021 }, 10);
  assert(strict.theoreticalMaximum < broad.theoreticalMaximum);
});
test('public investment and tax cuts have distinct policy-specific limits', () => {
  const a = estimateFiscalSpace(initialEconomy(), [{ policy: preset('public-investment'), weight: 1 }], THRESHOLDS, 10);
  const b = estimateFiscalSpace(initialEconomy(), [{ policy: preset('income-tax'), weight: 1 }], THRESHOLDS, 10);
  assert(a.theoreticalMaximum > 0); assert(b.theoreticalMaximum > 0);
  assert.notEqual(a.theoreticalMaximum, b.theoreticalMaximum);
});
test('the binding constraint switches when inflation tolerance tightens', () => {
  const mix = [{ policy: preset('public-investment'), weight: 1 }];
  const base = estimateFiscalSpace(initialEconomy(), mix, THRESHOLDS, 10);
  const tight = estimateFiscalSpace(initialEconomy(), mix, { ...THRESHOLDS, inflation: .02001 }, 10);
  assert.notEqual(base.constraints[0].id, tight.constraints[0].id);
  assert.equal(tight.constraints[0].id, 'inflation');
});
test('debt stocks, ratios, financing needs and external balances reconcile every year', () => {
  const initial = initialEconomy(), p = { ...P, stockFlowAdjustmentRatio: .001 };
  const result = simulate(initial, [preset('grid'), preset('income-tax')], 10, p, { ...NO_SHOCK, energyPriceChange: .3, marketRateDelta: .02 });
  let previous = initial;
  for (const s of result.steps) {
    near(s.state.fiscal.grossDebt, s.state.debtPortfolio.reduce((sum, b) => sum + b.principal, 0));
    near(s.metrics.grossDebtGdp, debtRatioNext(previous.fiscal.grossDebt / previous.macro.nominalGdp, s.metrics.effectiveRate, s.state.macro.nominalGrowth, s.metrics.primaryBalanceGdp, p.stockFlowAdjustmentRatio));
    near(s.metrics.grossFinancingNeeds, s.maturingDebt + s.state.fiscal.interestPayments - s.state.fiscal.primaryBalance);
    near(s.state.fiscal.netDebt, s.state.fiscal.grossDebt - s.state.fiscal.financialAssets);
    near(s.state.external.tradeBalance, s.state.external.goodsBalance + s.state.external.servicesBalance);
    near(s.state.external.currentAccount, s.state.external.tradeBalance + s.state.external.primaryIncomeBalance + s.state.external.secondaryIncomeBalance);
    near(s.demand.additionalDemand, s.demand.realOutput + s.demand.imports + s.demand.prices);
    previous = s.state;
  }
});
test('simulation is pure and mix order does not change results', () => {
  const s = initialEconomy(), original = structuredClone(s), policies = [preset('rd'), preset('grid')];
  const a = simulate(s, policies), b = simulate(s, [...policies].reverse());
  assert.deepEqual(s, original);
  for (let i = 0; i < 10; i++) near(a.steps[i].state.macro.realGdp, b.steps[i].state.macro.realGdp);
});
test('search distinguishes initial violations, empty mixes and search cap', () => {
  const mix = [{ policy: preset('cash'), weight: 1 }];
  assert.equal(estimateFiscalSpace(initialEconomy(), mix, { ...THRESHOLDS, debt: 1 }, 10).status, 'baseline-violated');
  assert.equal(estimateFiscalSpace(initialEconomy(), [], THRESHOLDS, 10).status, 'empty-mix');
  const cap = estimateFiscalSpace(initialEconomy(), mix, THRESHOLDS, 10, { ...P, searchCap: T / 100 });
  assert.equal(cap.status, 'search-cap'); near(cap.emergencyReserve + cap.recommendedEnvelope, cap.theoreticalMaximum);
});
test('safe endpoint and a nearby violation bracket the reported boundary', () => {
  const mix = [{ policy: preset('public-investment'), weight: 1 }];
  const r = estimateFiscalSpace(initialEconomy(), mix, THRESHOLDS, 10);
  assert.equal(r.status, 'boundary');
  assert(peakConstraints(simulate(initialEconomy(), allocateMix(mix, r.theoreticalMaximum)), THRESHOLDS).every(c => c.status === 'safe'));
  assert(peakConstraints(simulate(initialEconomy(), allocateMix(mix, r.theoreticalMaximum + P.searchTolerance * 2)), THRESHOLDS).some(c => c.status === 'violated'));
});
test('surpluses retire principal and accumulate assets only after full retirement', () => {
  const buckets = [{ principal: 100, coupon: .01, maturityYear: 5 }];
  assert.equal(financeDebt(buckets, -40, 1, .02, 10).buckets[0].principal, 60);
  assert.equal(financeDebt(buckets, -140, 1, .02, 10).assetAccumulation, 40);
});
test('invalid inputs fail explicitly', () => {
  assert.throws(() => simulate(initialEconomy(), [preset('cash', { annualCost: NaN })]));
  assert.throws(() => simulate(initialEconomy(), [], 0));
  assert.throws(() => allocateMix([{ policy: preset('cash'), weight: -1 }], T));
  assert.throws(() => ces(initialEconomy().production.inputs, P.weights, 0));
  assert.throws(() => simulate(initialEconomy(), [], 10, { ...P, investmentDepreciation: 2 }));
  const invalid = initialEconomy(); invalid.energy.importedEnergy = 0;
  assert.throws(() => simulate(invalid, []));
});

test('next trillion respects temporary/growth mode and is marginal to the current mix', () => {
  const current = [preset('cash', { annualCost: 5 * T })];
  const temporary = preset('rd', { kind: 'temporary' });
  const rows = compareNextTrillion(initialEconomy(), current, P, NO_SHOCK, THRESHOLDS, [temporary, preset('rd')]);
  assert.equal(rows[0].potentialGdpEffect, 0);
  assert(rows[1].potentialGdpEffect > 0);
  const baseline = simulate(initialEconomy(), current);
  const extra = simulate(initialEconomy(), [...current, { ...temporary, annualCost: T, duration: 1 }]);
  near(rows[0].realGdpEffect, extra.steps[0].state.macro.realGdp - baseline.steps[0].state.macro.realGdp);
});

test('energy demand propagates through imports, trade and prices while primary income does not relax capacity', () => {
  const baseline = simulate(initialEconomy(), [preset('cash', { energyDemand: 0 })]);
  const high = simulate(initialEconomy(), [preset('cash', { energyDemand: 2 })]);
  assert(high.steps[0].state.energy.importBill > baseline.steps[0].state.energy.importBill);
  assert(high.steps[0].state.external.tradeBalance < baseline.steps[0].state.external.tradeBalance);
  assert(high.steps[0].state.macro.inflation > baseline.steps[0].state.macro.inflation);
  const rich = initialEconomy(); rich.external.primaryIncomeBalance *= 10;
  const income = simulate(rich, [preset('cash', { energyDemand: 2 })]);
  near(high.steps[0].production.maximum, income.steps[0].production.maximum);
  assert(income.steps[0].state.external.currentAccount > high.steps[0].state.external.currentAccount);
});

test('longer maturity spreads rate shock effects across 1, 5 and 10 years', () => {
  const result = rateShockComparison(initialEconomy(), []);
  assert.equal(result.length, 3);
  assert(result[0].years[0].interestIncrease < result[0].years[1].interestIncrease);
  assert(result[0].years[1].interestIncrease < result[0].years[2].interestIncrease);
  assert(result[0].years[0].interestIncrease < result[2].years[0].interestIncrease);
});

test('temporary demand ends and zero-policy baseline remains explicit', () => {
  const baseline = simulate(initialEconomy(), []), oneYear = simulate(initialEconomy(), [preset('cash', { duration: 1 })]);
  assert(oneYear.steps[0].demand.realOutput > 0);
  assert.equal(oneYear.steps[1].policyCost, 0);
  assert.equal(oneYear.steps[1].demand.realOutput, 0);
  near(oneYear.steps[1].state.macro.realGdp, baseline.steps[1].state.macro.realGdp);
});

test('gross debt identity remains valid when a surplus becomes financial assets', () => {
  const initial = initialEconomy();
  initial.debtPortfolio = [{ principal: T, coupon: .01, maturityYear: 1 }];
  initial.fiscal.grossDebt = T;
  initial.fiscal.primaryExpenditure = 0;
  const s = simulate(initial, [], 1).steps[0];
  assert.equal(s.state.fiscal.grossDebt, 0);
  assert(s.state.fiscal.financialAssets > initial.fiscal.financialAssets);
  near(s.metrics.grossDebtGdp, debtRatioNext(T / initial.macro.nominalGdp, s.metrics.effectiveRate,
    s.state.macro.nominalGrowth, s.metrics.primaryBalanceGdp, s.metrics.stockFlowAdjustmentGdp));
});

test('provenance differentiates currency, maturity years, capacity and ratio thresholds', () => {
  const rows = assumptionRecords({ initial: initialEconomy(), parameters: P, thresholds: THRESHOLDS });
  const unit = (key: string) => rows.find(r => r.key === key)?.unit;
  assert.equal(unit('parameters.newDebtMaturity'), '年');
  assert.equal(unit('initial.macro.nominalGdp'), '円');
  assert.equal(unit('initial.energy.firmCapacity'), 'GW');
  assert.equal(unit('thresholds.interestGdp'), '比率（1 = 100%）');
  assert(rows.every(r => r.status === 'assumption' && r.sourceUrl === null));
});
