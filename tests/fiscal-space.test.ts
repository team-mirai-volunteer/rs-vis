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
import { JAPAN_RECORDS, JAPAN_LATEST_RECORDS, JAPAN_DATA_CHECKED } from '../app/lib/fiscal-space/japan-data';
import { REFERENCES, referenceRecords, taxLabourSupply } from '../app/lib/fiscal-space/calibration';
import { inputLabel } from '../client/components/fiscal-space/labels';
import type { Policy } from '../types/fiscal-space';
import { auditFiscalSpace } from '../app/lib/fiscal-space/risk-audit';
import { japanContext, OECD_DEBT_RECORDS } from '../app/lib/fiscal-space/japan-context';
import { AGE_BURDEN, NATIONAL_BURDEN, extendedHouseholdBurden, burdenRecords } from '../app/lib/fiscal-space/burden-data';
import { externalStress, externalStressRecords, STRESS_ASSUMPTIONS } from '../app/lib/fiscal-space/external-stress';
import { industryTrade, powerTrade, powerCase, INDUSTRY_CASE, POLICY_TRADE_CHANNELS, policyTradeRecords } from '../app/lib/fiscal-space/policy-trade';
import { calibratedResponse } from '../app/lib/fiscal-space/calibration';
import { fiscalExternal } from '../app/lib/fiscal-space/fiscal-external';
import { BURDEN_INCIDENCE } from '../app/lib/fiscal-space/burden-data';

const preset = (id: string, overrides: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(p => p.id === id)!, ...overrides });
const near = (a: number, b: number, tolerance = 1e-10) => assert(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≈ ${b}`);
const last = (policies: Policy[]) => simulate(initialEconomy(), policies).steps[9];

test('corporate wage incidence adds allocated foregone wages to burden and income consistently', () => {
  const row = AGE_BURDEN[0].classes[3];
  const zero = extendedHouseholdBurden(row, .16, 0);
  const quarter = extendedHouseholdBurden(row, .16, .25);
  const all = extendedHouseholdBurden(row, .16, 1);
  near(quarter.corporate, Math.round(row.salaryAnnual * BURDEN_INCIDENCE.corporateTaxTotal * .25 / BURDEN_INCIDENCE.wagesAndSalaries));
  near(quarter.income, zero.income + quarter.corporate);
  near(quarter.rate, (zero.rate * zero.income + quarter.corporate) / quarter.income);
  assert(zero.rate < quarter.rate && quarter.rate < all.rate);
  assert.throws(() => extendedHouseholdBurden(row, .16, 1.01));
  assert.throws(() => extendedHouseholdBurden(row, .16, NaN));
});

test('fiscal FX uses source signs, GDP scale, withdrawal timing and no duplicate CPI', () => {
  const initial = initialEconomy();
  initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const policy = preset('public-investment', { kind: 'permanent', annualCost: initial.macro.nominalGdp * .01 });
  for (const model of ['ef2026', 'esri2022'] as const) {
    for (let year = 1; year <= REFERENCES[model].years; year++) {
      near(calibratedResponse(initial, policy, year, { ...p, referenceModel: model }).exchangeRate, REFERENCES[model].government.exchangeRate[year - 1] / 100);
    }
  }
  const temporary = { ...policy, kind: 'temporary' as const, duration: 1 };
  near(calibratedResponse(initial, temporary, 2, p).exchangeRate, (.11 - .01) / 100);
  const baseline = simulate(initial, [], 5, p);
  const path = simulate(initial, [policy], 5, p);
  const rows = fiscalExternal(initial, [policy], path, baseline, p);
  const zero = fiscalExternal(initial, [], baseline, baseline, p);
  assert(zero.every(r => r.fx === 0 && r.importPrice === 0 && r.imports === 0 && r.exports === 0));
  assert(rows[0].fx > 0 && rows[4].fx < 0);
  rows.forEach((r, i) => {
    near(r.importPriceBill, path.steps[i].state.external.imports * r.fx);
    near(r.trade, r.exports - r.imports);
    near(r.cpi, path.steps[i].state.macro.inflation);
  });
  near(rows[1].importInflation, (1 + rows[1].importPrice) / (1 + rows[0].importPrice) - 1);
});

test('energy CPI and fertilizer reference retain distinct periods and definitions', () => {
  near(japanContext('2024')['context.energyCpi'].value, .038);
  near(japanContext('latest')['context.energyCpi'].value, .006);
  const fertilizer = japanContext('latest')['context.ureaDomesticShare'];
  near(fertilizer.value, .03);
  assert(fertilizer.referenceYear.includes('2024年7月'));
});

test('GDP gaps consistently use actual minus reference, including positive excess demand', () => {
  for (const gap of [-.04, 0, .02]) {
    const initial = initialEconomy();
    initial.macro.potentialGdp = initial.macro.realGdp / (1 + gap);
    const simulation = simulate(initial, []);
    near(simulation.initial.outputGap, gap);
    for (const s of [simulation.initial, ...simulation.steps]) {
      near(s.outputGap, s.state.macro.realGdp / s.state.macro.potentialGdp - 1);
      near(s.maximumGap, s.state.macro.realGdp / s.production.maximum - 1);
    }
  }
  near(simulate(initialEconomy('latest'), []).initial.outputGap, .007);
});

test('export response uses export denominator without adding net exports to GDP twice', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const policy = preset('public-investment', { annualCost: initial.macro.nominalGdp * .01, kind: 'permanent' });
  const result = simulate(initial, [policy], 5, p);
  for (let i = 0; i < 5; i++) {
    near(result.steps[i].demand.exports, initial.external.exports * REFERENCES.ef2026.government.exports[i] / 100);
    near(result.steps[i].state.macro.realGdp - initial.macro.realGdp, initial.macro.realGdp * REFERENCES.ef2026.government.gdp[i] / 100);
    near(result.steps[i].state.external.tradeBalance, result.steps[i].state.external.exports - result.steps[i].state.external.imports);
  }
  const row = compareNextTrillion(initial, [], p).find(r => r.policy.id === 'public-investment')!;
  assert(row.exports < 0);
  near(row.tradeBalanceEffect, row.exports - row.imports);
  assert.notEqual(row.tradeBalanceEffect, -row.imports);
});

test('extended household burden includes employer cost on both sides and VAT only on taxable gross spending', () => {
  const row = { ...AGE_BURDEN[0].classes[0], realIncomeAnnual: 6e6, salaryAnnual: 5e6,
    standardGross: 1.1e6, reducedGross: 1.08e6, exemptGross: 9e6,
    directTaxes: { incomeTax: 200000, residentTax: 100000, other: 0 }, socialInsurance: { pension: 300000, health: 100000, care: 0, other: 0 } };
  const r = extendedHouseholdBurden(row, .16);
  assert.equal(r.employer, 800000); assert.equal(r.vat, 180000);
  near(r.rate, 1680000 / 6800000);
  near(extendedHouseholdBurden({ ...row, exemptGross: 0 }, .16).rate, r.rate);
  assert(extendedHouseholdBurden(row, .18).rate > r.rate);
  assert.equal(extendedHouseholdBurden({ ...row, salaryAnnual: 0 }).employer, 0);
  assert.equal(NATIONAL_BURDEN[0].rate, .467);
  assert(!burdenRecords(false).some(r => r.key === 'burden.national.2025'));
  assert.equal(burdenRecords(true).find(r => r.key === 'burden.national.2025')!.status, 'estimated');
  assert.throws(() => extendedHouseholdBurden(row, NaN));
});

test('external stress compounds FX and world prices and raises inflation only once', () => {
  const path = simulate(initialEconomy('latest'), [preset('public-investment')]);
  const original = structuredClone(path);
  const r = externalStress(path, .1, .1, .04);
  near(r.importPrice, .21);
  near(r.priceLevel, .21 * .13);
  near(r.tradeBalance, r.exportReceipts - r.importBill);
  for (const step of r.years) {
    const before = path.steps.find(s => s.state.year === step.year)!.state.macro.inflation;
    near(step.inflation, step.year === r.year ? (1 + before) * (1 + r.priceLevel) - 1 : before);
  }
  const zero = externalStress(path, 0, 0, .04);
  near(zero.cpiPeak, Math.max(path.initial.state.macro.inflation, ...path.steps.map(s => s.state.macro.inflation)));
  assert.equal(zero.tradeBalance, 0);
  assert(externalStress(path, .1, 0, .04, { ...STRESS_ASSUMPTIONS, cpiPass: .2 }).cpiPeak > externalStress(path, .1, 0, .04).cpiPeak);
  assert.deepEqual(path, original);
  assert.throws(() => externalStress(path, NaN, 0, .04));
});

test('recommended envelope can breach 4% under conditional yen depreciation', () => {
  const initial = initialEconomy('latest');
  const weights: Record<string, number> = { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 };
  const mix = POLICIES.map(policy => ({ policy, weight: weights[policy.id] ?? 0 }));
  const estimate = estimateFiscalSpace(initial, mix, THRESHOLDS, 10, P, NO_SHOCK);
  const audit = auditFiscalSpace(initial, mix, estimate, THRESHOLDS, 10, P, NO_SHOCK);
  assert(audit.cpi.peak < .04);
  assert(audit.externalStress[2].cpiPeak > .04);
  assert(audit.externalStress[2].exceeds);
});

test('industry trade separates export sales, domestic substitution, capex and operating imports across cohorts', () => {
  const policy = preset('semiconductors', { annualCost: T, duration: 1 });
  const c = { ...INDUSTRY_CASE, annualSalesPerInvestment: 1, capexImportShare: .3, lag: 2, lifetime: 3 };
  assert.equal(industryTrade(policy, 1, c).tradeBalance, -.3 * T);
  const mature = industryTrade(policy, 3, c);
  assert.equal(mature.exports, .5 * T);
  assert.equal(mature.substitution, .25 * T);
  assert.equal(mature.operatingImports, .25 * T);
  assert.equal(mature.tradeBalance, .5 * T);
  assert.equal(industryTrade(policy, 6, c).sales, 0);
  assert.equal(industryTrade(policy, 3, INDUSTRY_CASE).tradeBalance, null);
  assert.equal(industryTrade(policy, 3, { ...c, exportShare: 1 }).substitution, 0);
  assert.throws(() => industryTrade(policy, 3, { ...c, exportShare: 1.1 }));
});

test('power options distinguish capacity, generation, lag, fuel imports and firm capacity', () => {
  const policy = preset('generation', { annualCost: T, duration: 1 });
  const solar = powerCase('solar');
  const operating = powerTrade(policy, 5, solar);
  near(operating.capacityGw, T / 176000 / 1e6);
  near(operating.generationTwh, T / 176000 * 8760 * .183 / 1e9);
  assert.equal(operating.firmGw, null);
  assert.equal(operating.tradeBalance, null);
  near(powerTrade(policy, 5, { ...solar, curtailment: .5 }).substitution, operating.substitution / 2);
  assert.equal(powerTrade(policy, 5, { ...solar, thermalReplacement: 0 }).substitution, 0);
  assert.equal(powerTrade(policy, 10, powerCase('nuclear')).capacityGw, 0);
  assert(powerTrade(policy, 11, powerCase('nuclear')).capacityGw > 0);
  assert.equal(powerTrade(policy, 11, powerCase('nuclear')).operatingImports, null);
  assert(powerTrade(policy, 6, powerCase('hydro')).generationTwh > 0);
  assert.equal(powerTrade(policy, 28, solar).generationTwh, 0);
  assert.throws(() => powerTrade(policy, 5, { ...solar, capexPerKw: 0 }));
});

test('burden, stress and policy project assumptions have provenance and complete Japanese labels', () => {
  for (const p of POLICIES) assert(POLICY_TRADE_CHANNELS[p.id]);
  const records = [...burdenRecords(true), ...externalStressRecords(), ...policyTradeRecords({ industry: { semiconductors: INDUSTRY_CASE }, power: powerCase('nuclear') })];
  for (const r of records) {
    assert(Number.isFinite(r.value)); assert(r.sourceUrl?.startsWith('https://') || r.status === 'assumption');
    assert(!inputLabel(r.key, POLICIES).includes('未分類'), r.key);
  }
});

test('context observations keep periods and definitions separate from forecasts', () => {
  const annual = japanContext('2024'), latest = japanContext('latest');
  assert.equal(annual['context.coreCoreCpi'].value, .024);
  assert.equal(annual['context.foodCpi'].value, .043);
  assert.equal(latest['context.coreCoreCpi'].value, .019);
  assert.equal(latest['context.foodCpi'].value, .035);
  assert.equal(annual['context.calorieSelfSufficiency'].value, .38);
  assert.equal(latest['context.calorieSelfSufficiency'].value, .37);
  assert.equal(annual['context.valueSelfSufficiency'].value, .64);
  assert.equal(latest['context.valueSelfSufficiency'].value, .66);
  assert.match(latest['context.valueSelfSufficiency'].referenceYear, /2025/);
  assert.equal(latest['context.valueSelfSufficiency'].status, 'estimated');
  for (const record of [...Object.values(annual), ...Object.values(latest), ...OECD_DEBT_RECORDS]) {
    assert(record.sourceUrl?.startsWith('https://'));
    assert(!inputLabel(record.key, POLICIES).includes('未分類'));
  }
  assert(!('foodCpi' in simulate(initialEconomy('latest'), []).steps[0].state.macro));
});

test('envelope audit evaluates retained amount, estimates reference FX, and compares CPI thresholds', () => {
  const initial = initialEconomy('latest');
  const weights: Record<string, number> = { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 };
  const mix = POLICIES.map(policy => ({ policy, weight: weights[policy.id] ?? 0 }));
  const estimate = estimateFiscalSpace(initial, mix, THRESHOLDS, 10, P, NO_SHOCK);
  const audit = auditFiscalSpace(initial, mix, estimate, THRESHOLDS, 10, P, NO_SHOCK);
  const path = simulate(initial, allocateMix(mix, estimate.recommendedEnvelope), 10, P, NO_SHOCK);
  const inputPath = simulate(initial, allocateMix(mix, 10 * T), 10, P, NO_SHOCK);
  near(audit.cpi.peak, Math.max(initial.macro.inflation, ...path.steps.map(s => s.state.macro.inflation)));
  assert(audit.cpi.peak > Math.max(...inputPath.steps.map(s => s.state.macro.inflation)));
  assert.equal(audit.safety, 'unassessed');
  assert.equal(audit.fiscalExternal.length, 10);
  assert(audit.fiscalExternal.every(r => Number.isFinite(r.fx) && Number.isFinite(r.importPrice)));
  assert.equal(audit.extrapolatedYears, 5);
  for (let i = 1; i < audit.sensitivity.length; i++) assert(audit.sensitivity[i - 1].amount >= audit.sensitivity[i].amount);
  near(audit.sensitivity.find(r => r.limit === .03)!.amount, estimateFiscalSpace(initial, mix, { ...THRESHOLDS, inflation: .03 }, 10, P, NO_SHOCK).recommendedEnvelope);
  assert.equal(THRESHOLDS.inflation, .035);
});

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
test('net GDP multipliers are not discounted again by the import share', () => {
  const s = initialEconomy(), moreImports = structuredClone(s);
  moreImports.external.imports *= 2;
  const a = allocateDemand(s, [preset('income-tax')], P), b = allocateDemand(moreImports, [preset('income-tax')], P);
  near(a.realOutput, .64 * T);
  near(a.realOutput, b.realOutput);
  near(b.imports, a.imports * 2);
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
  // Isolate the response to policy from the historical year-0 CPI observation.
  const state = initialEconomy(); state.macro.inflation = P.baselineInflation;
  const mix = [{ policy: preset('public-investment'), weight: 1 }];
  const base = estimateFiscalSpace(state, mix, { ...THRESHOLDS, inflation: .04 }, 10);
  const tight = estimateFiscalSpace(state, mix, { ...THRESHOLDS, inflation: .02001 }, 10);
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
    near(s.metrics.grossFinancingNeeds, s.maturingDebt + s.state.fiscal.interestPayments - s.state.fiscal.interestRevenue - s.state.fiscal.primaryBalance);
    near(s.state.fiscal.netDebt, s.state.fiscal.grossDebt - s.state.fiscal.financialAssets);
    near(s.state.external.tradeBalance, s.state.external.goodsBalance + s.state.external.servicesBalance);
    near(s.state.external.currentAccount, s.state.external.tradeBalance + s.state.external.primaryIncomeBalance + s.state.external.secondaryIncomeBalance);
    near(s.demand.additionalDemand, s.demand.realOutput + s.demand.imports - s.demand.exports + s.demand.prices);
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
  const rows = compareNextTrillion(initialEconomy(), current, P, NO_SHOCK, THRESHOLDS, [temporary, preset('rd', { potentialGdpEffect: .5, implementationLag: 3 })]);
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

test('temporary cost ends while withdrawal effects remain, then decay out of the finite response window', () => {
  const baseline = simulate(initialEconomy(), []), oneYear = simulate(initialEconomy(), [preset('cash', { duration: 1 })]);
  assert(oneYear.steps[0].demand.realOutput > 0);
  assert.equal(oneYear.steps[1].policyCost, 0);
  near(oneYear.steps[1].demand.realOutput, -.08 * T);
  assert.equal(oneYear.steps[5].demand.realOutput, 0);
  near(oneYear.steps[5].state.macro.realGdp, baseline.steps[5].state.macro.realGdp);
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
  assert.equal(unit('initial.energy.primaryDemand'), '指数（基準年需要 = 100）');
  assert(rows.filter(r => r.key.startsWith('parameters.') || r.key.startsWith('thresholds.')).every(r => r.status === 'assumption' && r.sourceUrl === null));
});

test('Japan baseline preserves published 2024 values and accounting identities', () => {
  const s = initialEconomy(), gdp = s.macro.nominalGdp, f = s.fiscal;
  near(gdp, 634.2 * T);
  near(f.grossDebt / gdp, 2.145); near(f.netDebt / gdp, 1.417);
  near(f.primaryBalance / gdp, -.016);
  near(f.taxRevenue + f.otherPrimaryRevenue - f.primaryExpenditure, f.primaryBalance);
  near((f.primaryBalance - f.interestPayments + f.interestRevenue) / gdp, -.017);
  near(f.netDebt, f.grossDebt - f.financialAssets);
  near(f.liquidityAdjustedNetDebt, f.grossDebt - f.liquidFinancialAssets);
  near(s.debtPortfolio.reduce((sum, b) => sum + b.principal * b.coupon, 0), f.interestPayments);
  assert.equal(s.labour.employment, 67.81e6);
  assert.equal(s.labour.labourForce, s.labour.employment + s.labour.unemployment);
  assert.equal(s.macro.inflation, .027);
  near(s.energy.domesticSupply / s.energy.primaryDemand, .163);
  near(s.energy.primaryDemand, s.energy.domesticSupply + s.energy.importedEnergy);
  near(s.external.currentAccount, s.external.exports - s.external.imports + s.external.primaryIncomeBalance + s.external.secondaryIncomeBalance);
});

test('provenance covers adopted statistics, preserves assumptions and flags edited values', () => {
  const initial = initialEconomy();
  const rows = assumptionRecords({ initial });
  assert.equal(new Set(JAPAN_RECORDS.map(r => r.key)).size, JAPAN_RECORDS.length);
  for (const source of JAPAN_RECORDS) {
    const row = rows.find(r => r.key === source.key)!;
    assert(row, source.key);
    near(row.value, source.value);
    assert.equal(row.status, source.status);
    assert(row.sourceUrl?.startsWith('https://'));
    assert(row.referenceYear.includes('2024'));
  }
  assert(rows.filter(r => r.key.startsWith('initial.debtPortfolio.')).every(r => r.status === 'assumption'));
  initial.macro.potentialGdp *= 1.02;
  const changed = assumptionRecords({ initial }).find(r => r.key === 'initial.macro.potentialGdp')!;
  assert.equal(changed.status, 'assumption');
  assert(changed.sourceUrl);
  assert.match(changed.uncertaintyNote, /変更/);
});

test('interest receipts reduce borrowing without reducing reported interest burden or changing PB', () => {
  const withIncome = initialEconomy(), withoutIncome = structuredClone(withIncome);
  withoutIncome.fiscal.interestRevenue = 0;
  const a = simulate(withIncome, [], 1).steps[0], b = simulate(withoutIncome, [], 1).steps[0];
  near(a.state.fiscal.primaryBalance, b.state.fiscal.primaryBalance);
  near(a.metrics.interestGdp, b.metrics.interestGdp);
  near(b.state.fiscal.grossDebt - a.state.fiscal.grossDebt, a.state.fiscal.interestRevenue);
  near(b.metrics.grossFinancingNeeds - a.metrics.grossFinancingNeeds, a.state.fiscal.interestRevenue);
});

test('latest snapshot uses official gap sign and monthly prices without changing the 2024 preset', () => {
  const original = initialEconomy('2024'), latest = initialEconomy('latest');
  near(latest.macro.nominalGdp, 689.2 * T);
  near(latest.macro.realGdp / latest.macro.potentialGdp - 1, .007);
  assert(latest.macro.potentialGdp < latest.macro.realGdp, 'Positive official gap means demand exceeds potential');
  assert.equal(latest.macro.inflation, .019);
  assert.equal(latest.macro.coreInflation, .018);
  assert.equal(latest.labour.employment, 68.5e6);
  near(latest.labour.labourForce, latest.labour.employment + latest.labour.unemployment);
  near(latest.external.niip, 561087 * 1e9);
  assert.deepEqual(latest.fiscal, original.fiscal);
  assert.deepEqual(initialEconomy('2024'), original);
  const latestPath = simulate(latest, [preset('cash')]);
  const oldPath = simulate(original, [preset('cash')]);
  assert.notEqual(latestPath.steps[0].state.macro.inflation, oldPath.steps[0].state.macro.inflation);
  // A fixed reference multiplier is not re-estimated when the initial data change.
  near(latestPath.steps[0].demand.realOutput, oldPath.steps[0].demand.realOutput);
  for (const step of latestPath.steps) {
    const f = step.state.fiscal;
    near(f.netDebt, f.grossDebt - f.financialAssets);
    near(f.primaryBalance, f.taxRevenue + f.otherPrimaryRevenue - f.primaryExpenditure);
    assert(Number.isFinite(step.state.macro.nominalGdp));
  }
});

test('published annual GDP responses are reproduced at fixed baseline prices without capacity truncation', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const scenarios = [
    { model: 'ef2026' as const, id: 'public-investment', expected: [1.08, .96, .75, .54, .41] },
    { model: 'ef2026' as const, id: 'income-tax', expected: [.64, .56, .43, .32, .29] },
    { model: 'esri2022' as const, id: 'public-investment', expected: [1.05, 1.04, .95] },
    { model: 'esri2022' as const, id: 'income-tax', expected: [.21, .33, .32] },
  ];
  for (const { model, id, expected } of scenarios) {
    const params = { ...P, referenceModel: model, baselineInflation: 0, baselineRealGrowth: 0 };
    const result = simulate(initial, [preset(id, { kind: 'permanent', annualCost: initial.macro.nominalGdp * .01 })], expected.length, params);
    expected.forEach((value, i) => near((result.steps[i].state.macro.realGdp / initial.macro.realGdp - 1) * 100, value));
  }
});

test('CPI level response is differenced into inflation and is not used as the GDP deflator', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0 };
  const result = simulate(initial, [preset('public-investment', { kind: 'permanent', annualCost: initial.macro.nominalGdp * .01 })], 5, p);
  const cpi = [.0015, .0037, .0054, .0067, .0076], deflator = [.0019, .0045, .0066, .0082, .0094];
  let cpiIndex = 1;
  result.steps.forEach((step, i) => {
    cpiIndex *= 1 + step.state.macro.inflation;
    near(cpiIndex, 1 + cpi[i]);
    near(step.state.macro.nominalGdp / step.state.macro.realGdp, 1 + deflator[i]);
  });
  near(result.steps[1].state.macro.inflation, 1.0037 / 1.0015 - 1);
});

test('employment and imports use their own denominators, not GDP or the entire labour force', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0 };
  const step = simulate(initial, [preset('public-investment', { annualCost: initial.macro.nominalGdp * .01 })], 1, p).steps[0];
  near(step.state.labour.employment / initial.labour.employment - 1, .0007);
  near(step.demand.imports / initial.external.imports, .0045);
  near(step.state.labour.labourForce, initial.labour.labourForce);
});

test('social-insurance relief is split once between employee and employer; income tax goes to the employee', () => {
  const initial = initialEconomy(), policies = [preset('social-insurance', { annualCost: 4 * T }), preset('income-tax', { annualCost: 2 * T })];
  const supply = taxLabourSupply(initial, policies, 1, P);
  near(supply.employeeCut, 4 * T); near(supply.employerCut, 2 * T);
  near(supply.employeeCut + supply.employerCut, 6 * T);
  const withRelief = simulate(initial, policies, 1).steps[0];
  near(withRelief.state.fiscal.taxRevenue, initial.fiscal.taxRevenue / initial.macro.nominalGdp * withRelief.state.macro.nominalGdp - 6 * T);
  const onlyEmployer = { ...P, employeeReliefShare: 0, hoursElasticity: .3, employerDemandElasticity: .3 };
  const employer = taxLabourSupply(initial, [policies[0]], 1, onlyEmployer);
  near(employer.hours, 1); assert(employer.employerDemand > 1);
  const onlyEmployee = taxLabourSupply(initial, [policies[0]], 1, { ...onlyEmployer, employeeReliefShare: 1 });
  assert(onlyEmployee.hours > 1); near(onlyEmployee.employerDemand, 1);
});

test('labour supply sensitivity increases hours and participation without creating automatic real GDP or changing population', () => {
  const initial = initialEconomy(), policies = [preset('income-tax', { annualCost: 10 * T })];
  const a = simulate(initial, policies, 1).steps[0];
  const b = simulate(initial, policies, 1, { ...P, hoursElasticity: .2, participationElasticity: .1 }).steps[0];
  assert(b.state.labour.hoursWorked > a.state.labour.hoursWorked);
  assert(b.state.labour.labourForce > a.state.labour.labourForce);
  assert(b.state.macro.potentialGdp > a.state.macro.potentialGdp);
  near(b.state.labour.labourForce / b.state.labour.participation, initial.labour.labourForce / initial.labour.participation);
  near(b.state.macro.realGdp, a.state.macro.realGdp);
});

test('reference periods and every numeric calibration input have visible provenance and Japanese labels', () => {
  for (const model of ['ef2026', 'esri2022'] as const) {
    const rows = referenceRecords(model);
    assert.equal(rows.length, REFERENCES[model].years * 3 * 9);
    assert.equal(new Set(rows.map(r => r.key)).size, rows.length);
    assert(rows.every(r => r.sourceUrl && (r.status === 'estimated' || r.status === 'assumption')));
    for (const row of [...rows, ...assumptionRecords({ initial: initialEconomy(), parameters: P, policies: POLICIES })]) {
      assert(!inputLabel(row.key, POLICIES).includes('未分類'), row.key);
    }
  }
});

test('uncalibrated sector investment yields do not create preset-specific free supply', () => {
  const baseline = simulate(initialEconomy(), []);
  for (const policy of POLICIES) {
    const result = simulate(initialEconomy(), [policy]);
    near(result.steps[9].state.macro.potentialGdp, baseline.steps[9].state.macro.potentialGdp);
  }
});

test('latest provenance follows the selected preset, dates releases and explains retained records', () => {
  const initial = initialEconomy('latest');
  const rows = assumptionRecords({ initial }, '', 'latest');
  assert.equal(new Set(JAPAN_LATEST_RECORDS.map(r => r.key)).size, JAPAN_RECORDS.length);
  for (const source of JAPAN_LATEST_RECORDS) {
    const row = rows.find(r => r.key === source.key)!;
    near(row.value, source.value);
    assert.equal(row.status, source.status);
    assert.equal(row.referenceYear, source.referenceYear);
    assert(source.publishedAt || source.retainedReason);
    if (source.publishedAt) assert(source.publishedAt <= JAPAN_DATA_CHECKED);
  }
  initial.macro.inflation = .03;
  const edited = assumptionRecords({ initial }, '', 'latest').find(r => r.key === 'initial.macro.inflation')!;
  assert.equal(edited.status, 'assumption');
  assert.equal(edited.referenceYear, '2026年7月');
  assert.equal(edited.publishedAt, '2026-08-21');
});
