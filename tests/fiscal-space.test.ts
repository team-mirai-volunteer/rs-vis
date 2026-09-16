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
import { AGE_BURDEN, AGE_BURDEN_WEIGHTS, NATIONAL_BURDEN, OECD_WORKING_BURDEN, workingHouseholdBurden, extendedHouseholdBurden, burdenRecords } from '../app/lib/fiscal-space/burden-data';
import { externalStress, externalStressRecords, STRESS_ASSUMPTIONS } from '../app/lib/fiscal-space/external-stress';
import { industryTrade, powerTrade, powerCase, INDUSTRY_CASE, POLICY_TRADE_CHANNELS, policyTradeRecords } from '../app/lib/fiscal-space/policy-trade';
import { calibratedResponse } from '../app/lib/fiscal-space/calibration';
import { fiscalExternal } from '../app/lib/fiscal-space/fiscal-external';
import { BURDEN_INCIDENCE } from '../app/lib/fiscal-space/burden-data';
import { projectResponse, projectResponses } from '../app/lib/fiscal-space/project-response';
import { SUPPLY_CASES, supplyResponse, supplyTotal, supplyRecords } from '../app/lib/fiscal-space/supply';
import { SEMICONDUCTOR_CASE } from '../app/lib/fiscal-space/policy-trade';
import { electricityBaseline, ELECTRICITY_BASELINE } from '../app/lib/fiscal-space/electricity-baseline';
import { adjustEnergyCpi, JULY_2026_ENERGY_ADJUSTMENT } from '../app/lib/fiscal-space/energy-cpi';

const ZERO_LOAD = { sectorUtilizationPerTrillion: 0, peakGwPerTrillion: 0, operatingPeakGwPerTrillion: 0, lag: 0, lifetime: 1, depreciation: 0 };
const preset = (id: string, overrides: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(p => p.id === id)!, ...overrides });
const near = (a: number, b: number, tolerance = 1e-10) => assert(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≈ ${b}`);
const last = (policies: Policy[]) => simulate(initialEconomy(), policies).steps[9];

test('energy CPI adjustment converts all-items contributions and removes both periods policy effects', () => {
  const c = { observedRate: .05, energyIndex: 105, previousAllItemsIndex: 100, energyWeight: .1, currentContribution: -.01, previousContribution: -.02 };
  near(adjustEnergyCpi(c), 115 / 120 - 1);
  near(adjustEnergyCpi({ ...c, currentContribution: 0, previousContribution: 0 }), .05);
  assert(adjustEnergyCpi(c) < c.observedRate, 'Removing larger previous-year support can lower measured inflation');
  assert.throws(() => adjustEnergyCpi({ ...c, energyWeight: 0 }));
  assert.throws(() => adjustEnergyCpi({ ...c, previousContribution: 1 }));
  const adjusted = adjustEnergyCpi(JULY_2026_ENERGY_ADJUSTMENT);
  assert.equal((adjusted * 100).toFixed(1), '3.4');
  near(japanContext('latest')['context.energyPolicyAdjustedCpi'].value, adjusted);
  assert.equal(japanContext('2024')['context.energyPolicyAdjustedCpi'], undefined);
  assert.equal(japanContext('latest')['context.energyPolicyAdjustedCpi'].status, 'estimated');
});

test('common thermal demand and fuel imports enter every policy and the no-policy path once', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const flat = { ...p, electricity: { ...p.electricity, demandGrowth: 0, peakGrowth: 0 } };
  const expected = electricityBaseline(p.electricity, 1).additionalFuelBill;
  assert(expected > 0);
  for (const policies of [[], ...POLICIES.map(policy => [policy])]) {
    const actual = simulate(initial, policies, 1, p).steps[0], base = simulate(initial, policies, 1, flat).steps[0];
    near(actual.electricity!.commonFuelIncrease, expected);
    near(actual.state.energy.importBill - base.state.energy.importBill, expected);
    near(actual.state.external.imports - base.state.external.imports, expected);
    near(base.state.external.tradeBalance - actual.state.external.tradeBalance, expected);
    assert(actual.state.energy.peakDemand > base.state.energy.peakDemand);
  }
  const yearly = simulate(initial, [], 5, p).steps;
  near(yearly[4].electricity!.commonFuelIncrease, electricityBaseline(p.electricity, 5).additionalFuelBill);
  assert(yearly[4].electricity!.commonFuelIncrease > yearly[0].electricity!.commonFuelIncrease);
  near(simulate(initial, [], 1, p, { ...NO_SHOCK, energyPriceChange: .3 }).steps[0].electricity!.commonFuelIncrease, expected * 1.3);
});

test('thermal baseline balances non-fossil retirements, planned additions and declining demand', () => {
  const c = { ...ELECTRICITY_BASELINE, generationTwh: 100, thermalShare: .6, demandGrowth: .01, nonThermalDecline: .1, plannedNonThermalTwh: 2 };
  const first = electricityBaseline(c, 1);
  near(first.demandTwh, 101); near(first.nonThermalTwh, 38); near(first.thermalTwh, 63); near(first.thermalIncreaseTwh, 3);
  near(first.additionalFuelBill, 3e9 * 9);
  const overbuilt = electricityBaseline({ ...c, plannedNonThermalTwh: 200 }, 5);
  near(overbuilt.thermalTwh, 0); near(overbuilt.additionalFuelBill, -overbuilt.initialFuelBill);
  assert(electricityBaseline({ ...c, demandGrowth: -.1, nonThermalDecline: 0, plannedNonThermalTwh: 0 }, 1).additionalFuelBill < 0);
  assert.throws(() => electricityBaseline({ ...c, demandGrowth: -1 }, 1));
  assert.throws(() => electricityBaseline({ ...c, nonThermalDecline: NaN }, 1));
  const initial = initialEconomy(), p = { ...P, electricity: c };
  const power = preset('generation', { annualCost: 500 * T, trade: { kind: 'power', assumptions: { ...powerCase('solar'), lag: 0 } } });
  near(projectResponses(initial, [power], 1, p)[0].substitution, first.fuelBill / (initial.macro.nominalGdp / initial.macro.realGdp));
  near(projectResponses(initial, [power], 1, { ...p, electricity: { ...c, plannedNonThermalTwh: 200 } })[0].substitution, 0);
});

test('power fuel counterfactual charges continued thermal generation and counts avoided imports once', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, multiplierScale: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  for (const technology of ['solar', 'nuclear', 'hydro'] as const) {
    const c = powerCase(technology), year = c.lag + 1;
    const policy = preset('generation', { annualCost: T, duration: 1, energyDemand: 0, trade: { kind: 'power', assumptions: c } });
    const flow = powerTrade(policy, year, c);
    const thermalBill = flow.generationTwh * 1e9 * c.thermalReplacement * c.displacedFuelYenPerKwh;
    near(flow.substitution, thermalBill);
    // Hold construction and its macro price response fixed to isolate the
    // operating benefit. The multiplier sensitivity only scales GDP, not prices.
    const base = simulate(initial, [{ ...policy, trade: undefined }], year, p).steps[year - 1];
    const path = simulate(initial, [policy], year, p), built = path.steps[year - 1];
    const before = year === 1 ? initial : path.steps[year - 2].state;
    const initialPrice = initial.macro.nominalGdp / initial.macro.realGdp;
    const expected = (thermalBill - flow.operatingImports!) / initialPrice * before.macro.nominalGdp / before.macro.realGdp;
    assert(expected > 0);
    near(base.state.energy.importBill - built.state.energy.importBill, expected);
    near(built.state.external.tradeBalance - base.state.external.tradeBalance, expected);
    near(built.demand.domesticSubstitution, thermalBill / (initial.macro.nominalGdp / initial.macro.realGdp));
    const noReplacement = powerTrade(policy, year, { ...c, thermalReplacement: 0 });
    near(noReplacement.substitution, 0);
    near(noReplacement.operatingImports!, flow.operatingImports!);
    assert.equal(powerTrade(policy, year, { ...c, operatingImportYenPerKwh: null }).operatingImports, null);
  }
});

test('power trade breakdown uses each path previous deflator and energy shocks without changing totals', () => {
  const initial = initialEconomy();
  const policy = preset('generation', { duration: 1, trade: { kind: 'power', assumptions: powerCase('solar') } });
  const current = [preset('grid', { supply: { ...SUPPLY_CASES.grid.settings, lag: 2 } })];
  for (const energyPriceChange of [0, .3, -.2]) {
    const shock = { ...NO_SHOCK, energyPriceChange };
    const baseline = simulate(initial, current, 5, P, shock);
    const added = simulate(initial, [...current, policy], 5, P, shock);
    const row = compareNextTrillion(initial, current, P, shock, THRESHOLDS, [policy])[0];
    for (const period of row.periods) {
      const i = period.year - 1;
      const price = (path: typeof added) => { const s = i ? path.steps[i - 1].state : initial; return s.macro.nominalGdp / s.macro.realGdp; };
      const operating = -(added.steps[i].demand.projectEnergyNetImports * price(added) - baseline.steps[i].demand.projectEnergyNetImports * price(baseline)) * (1 + energyPriceChange);
      near(period.energyOperatingTradeEffect, operating);
      near(period.tradeBalanceEffect, added.steps[i].state.external.tradeBalance - baseline.steps[i].state.external.tradeBalance);
    }
    near(row.periods[0].energyOperatingTradeEffect, 0);
    assert(row.periods[1].energyOperatingTradeEffect > 0);
  }
});

test('grid fuel savings reach imports and capacity once, net of upkeep, with explicit renewable overlap', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, productionModel: 'cobbDouglas' as const, capacityPriceSensitivity: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const grid = preset('grid', { duration: 1, energyDemand: 0, supply: { ...SUPPLY_CASES.grid.settings } });
  const c = grid.supply!;
  assert.equal(projectResponse(initial, grid, 5, p).substitution, 0);
  const flow = projectResponse(initial, grid, 6, p);
  const stock = T * c.additionality;
  near(flow.substitution, stock * (c.yield + c.maintenanceRate!) * initial.energy.fossilFuelImportDependency);
  near(flow.operatingImports, stock * c.maintenanceRate! * c.maintenanceImportShare!);
  near(flow.domesticOperatingCost, stock * c.maintenanceRate! * (1 - c.maintenanceImportShare!));
  assert.equal(supplyResponse(initial, grid, 6, p), 0, 'No duplicate structural grid supply');
  const base = simulate(initial, [], 6, p).steps[5], actual = simulate(initial, [grid], 6, p).steps[5];
  const net = flow.substitution - flow.operatingImports - flow.domesticOperatingCost;
  near(actual.state.macro.potentialGdp - base.state.macro.potentialGdp, net);
  near(actual.state.macro.realGdp - base.state.macro.realGdp, net);
  near(actual.demand.imports, flow.operatingImports - flow.substitution);
  near(actual.demand.additionalDemand, actual.demand.realOutput + actual.demand.imports - actual.demand.exports + actual.demand.prices);
  const solar = preset('generation', { duration: 1, trade: { kind: 'power', assumptions: powerCase('solar') } });
  const solarOnly = projectResponse(initial, solar, 6, p);
  const together = projectResponses(initial, [grid, solar], 6, p);
  near(together.reduce((sum, f) => sum + f.substitution, 0), Math.max(flow.substitution, solarOnly.substitution));
  const distinct = projectResponses(initial, [{ ...grid, supply: { ...c, generationOverlapShare: 0 } }, solar], 6, p);
  near(distinct.reduce((sum, f) => sum + f.substitution, 0), flow.substitution + solarOnly.substitution);
  const reversed = projectResponses(initial, [solar, grid], 6, p);
  near(together[0].substitution, reversed[1].substitution);
  assert.throws(() => projectResponse(initial, { ...grid, supply: { ...c, maintenanceImportShare: 2 } }, 6, p));
});

test('power mixes preserve investment totals, commissioning lags, fuel costs and single-policy equivalence', () => {
  const initial = initialEconomy(), policy = preset('generation', { duration: 1, annualCost: 2 * T });
  const solar = powerCase('solar'), nuclear = powerCase('nuclear');
  const mixed = { ...solar, mix: [{ share: 3, assumptions: solar }, { share: 7, assumptions: nuclear }] };
  for (const year of [1, 3, 5, 11]) {
    const result = powerTrade(policy, year, mixed);
    const a = powerTrade({ ...policy, annualCost: .6 * T }, year, solar), b = powerTrade({ ...policy, annualCost: 1.4 * T }, year, nuclear);
    near(result.generationTwh, a.generationTwh + b.generationTwh);
    near(result.substitution, a.substitution + b.substitution);
    near(result.operatingImports!, a.operatingImports! + b.operatingImports!);
  }
  const combined = { ...policy, trade: { kind: 'power' as const, assumptions: mixed } };
  const split = [{ ...policy, annualCost: .6 * T, trade: { kind: 'power' as const, assumptions: solar } }, { ...policy, annualCost: 1.4 * T, trade: { kind: 'power' as const, assumptions: nuclear } }];
  const actual = simulate(initial, [combined], 5, P), separate = simulate(initial, split, 5, P);
  actual.steps.forEach((s, i) => { near(s.state.macro.realGdp, separate.steps[i].state.macro.realGdp); near(s.state.external.imports, separate.steps[i].state.external.imports); near(s.state.fiscal.primaryBalance, separate.steps[i].state.fiscal.primaryBalance); });
  const mature = compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [combined])[0].investment!;
  assert.equal(mature.startYear, 11); assert.equal(mature.timings!.length, 2); assert(mature.trade!.operatingImports > 0);
  assert.throws(() => powerTrade(policy, 5, { ...solar, mix: [{ share: 0, assumptions: solar }] }));
  for (const record of policyTradeRecords({ industry: {}, power: solar, powerCases: { solar, nuclear, hydro: powerCase('hydro') }, mix: { solar: 3, nuclear: 7, hydro: 0 } })) assert(!inputLabel(record.key, POLICIES).includes('未分類'), record.key);
});

test('one-year government spending reproduces the published five-year experiment instead of differencing sustained shocks', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, capacityPriceSensitivity: 0, electricity: { ...P.electricity, demandGrowth: 0 }, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const policy = preset('public-investment', { duration: 1, annualCost: initial.macro.realGdp * .01 });
  // EF2026 table 1: output and trade level deviations (% of each own baseline).
  const expected = [[1.08, -.01, .45, .19, .15], [-.10, 0, .45, .26, .22], [-.20, -.05, .43, .22, .17], [-.21, -.06, .36, .17, .13], [-.14, -.04, .31, .13, .10]];
  const result = simulate(initial, [policy], 5, p);
  let cpiIndex = 1;
  result.steps.forEach((step, i) => {
    const [gdp, exports, imports, deflator, cpi] = expected[i];
    near((step.state.macro.realGdp / initial.macro.realGdp - 1) * 100, gdp);
    near(step.demand.exports / initial.external.exports * 100, exports);
    near(step.demand.imports / initial.external.imports * 100, imports);
    near((step.state.macro.nominalGdp / step.state.macro.realGdp - 1) * 100, deflator);
    cpiIndex *= 1 + step.state.macro.inflation;
    near((cpiIndex - 1) * 100, cpi);
  });
});

test('research cohorts survive spending expiry, decay after commissioning and never duplicate commercial output', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const policy = preset('rd', { duration: 1, supply: { ...SUPPLY_CASES.rd.settings } });
  assert.equal(supplyResponse(initial, policy, 3, p), 0);
  near(supplyResponse(initial, policy, 4, p), .15 * T);
  near(supplyResponse(initial, policy, 10, p), .15 * T * .85 ** 6);
  const actual = simulate(initial, [policy], 10, p), base = simulate(initial, [{ ...policy, supply: undefined }], 10, p);
  near(actual.steps[3].state.macro.potentialGdp - base.steps[3].state.macro.potentialGdp, .15 * T);
  near(actual.steps[3].state.macro.realGdp, base.steps[3].state.macro.realGdp);
  assert(actual.steps[9].state.macro.realGdp > base.steps[9].state.macro.realGdp);
  const commercial = { ...policy, trade: { kind: 'industry' as const, assumptions: { ...INDUSTRY_CASE, annualSalesPerInvestment: 1 } } };
  assert.equal(supplyResponse(initial, commercial, 10, p), 0);
  assert.throws(() => simulate(initial, [{ ...policy, potentialGdpEffect: .5 }], 10, p));
});

test('public capital has diminishing returns and row splitting preserves supply', () => {
  const initial = initialEconomy(), policy = preset('public-investment', { duration: 1, supply: { ...SUPPLY_CASES['public-investment'].settings } });
  const one = supplyResponse(initial, policy, 3, P);
  const two = supplyResponse(initial, { ...policy, annualCost: 2 * T }, 3, P);
  assert(two > one && two < 2 * one);
  near(supplyTotal(initial, [policy, policy], 3, P), two);
  assert.equal(supplyResponse(initial, { ...policy, supply: { ...policy.supply!, additionality: 0 } }, 3, P), 0);
  assert.throws(() => supplyResponse(initial, { ...policy, supply: { ...policy.supply!, depreciation: 2 } }, 3, P));
});

test('late spending does not inherit an earlier cohorts long-run realization', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, inflationPersistence: 0 };
  const ref = { ...SUPPLY_CASES.rd.settings, lag: 0, depreciation: 0 };
  const one = preset('rd', { duration: 1, supply: ref });
  const permanent = { ...one, kind: 'permanent' as const };
  // At year 6 only the year-1 vintage starts the 5-to-10-year realization ramp.
  near(supplyResponse(initial, permanent, 6, p, true), supplyResponse(initial, one, 6, p, true));
  near(supplyResponse(initial, one, 6, p, true), .15 * T / 5);
  near(supplyResponse(initial, permanent, 10, p, true), .15 * T * 3);
  near(supplyResponse(initial, permanent, 10, p), .15 * T * 10);
});

test('education enters after schooling while childcare operating support expires without creating future workers', () => {
  const initial = initialEconomy();
  const education = preset('education', { duration: 1, supply: { ...SUPPLY_CASES.education.settings } });
  const childcare = preset('childcare', { duration: 1, supply: { ...SUPPLY_CASES.childcare.settings } });
  assert.equal(supplyResponse(initial, education, 3, P), 0);
  assert(supplyResponse(initial, education, 10, P) > 0);
  assert(supplyResponse(initial, childcare, 1, P) > 0);
  assert.equal(supplyResponse(initial, childcare, 2, P), 0);
  assert.equal(supplyResponse(initial, childcare, 10, P), 0);
  assert(supplyResponse(initial, { ...childcare, kind: 'permanent' }, 10, P) > 0);
});

test('semiconductor reference uses capital stock and pays for construction even when additionality is zero', () => {
  near(SEMICONDUCTOR_CASE.annualSalesPerInvestment!, 2894307699 / 3234980070);
  const c = { ...SEMICONDUCTOR_CASE, capexImportShare: .3 };
  const policy = preset('semiconductors', { duration: 1 });
  const early = industryTrade(policy, 4, c), late = industryTrade(policy, 10, c);
  near(late.sales!, early.sales! * .9 ** 6);
  const failed = industryTrade(policy, 1, { ...c, additionality: 0 });
  assert.equal(failed.sales, 0); assert.equal(failed.capexImports, .3 * T);
});

test('default substitution starts at commissioning, reports commissioning capacity and distinguishes unknown from estimated zero', () => {
  const initial = initialEconomy('latest');
  const semiconductor = preset('semiconductors', { duration: 1, trade: { kind: 'industry', assumptions: { ...SEMICONDUCTOR_CASE } } });
  const solar = preset('generation', { duration: 1, trade: { kind: 'power', assumptions: powerCase('solar') } });
  const unknown = preset('rd', { supply: { ...SUPPLY_CASES.rd.settings }, trade: { kind: 'industry', assumptions: { ...INDUSTRY_CASE } } });
  const noReplacement = { ...semiconductor, trade: { kind: 'industry' as const, assumptions: { ...SEMICONDUCTOR_CASE, domesticReplacementShare: 0 } } };
  const [semi, power, research, zero] = compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [semiconductor, solar, unknown, noReplacement]);
  const deflator = initial.macro.nominalGdp / initial.macro.realGdp;
  const expectedSemi = T / deflator * SEMICONDUCTOR_CASE.annualSalesPerInvestment! * .5 * (1 - SEMICONDUCTOR_CASE.exportShare) * SEMICONDUCTOR_CASE.domesticReplacementShare;
  assert.equal(semi.periods[0].domesticSubstitution, 0);
  assert.equal(semi.periods[1].domesticSubstitution, 0);
  assert(simulate(initial, [semiconductor], 4, P).steps[3].demand.domesticSubstitution > 0);
  near(semi.investment!.trade!.substitution, expectedSemi);
  const expectedOperating = T / deflator * SEMICONDUCTOR_CASE.annualSalesPerInvestment! * .5 * SEMICONDUCTOR_CASE.operatingImportShare;
  near(semi.investment!.trade!.operatingImports, expectedOperating);
  near(semi.investment!.trade!.imports, expectedOperating - expectedSemi);
  near(semi.investment!.trade!.tradeBalance, semi.investment!.trade!.exports - semi.investment!.trade!.imports);
  assert.equal(power.periods[0].domesticSubstitution, 0);
  assert(power.periods[1].domesticSubstitution > 0);
  near(power.investment!.trade!.substitution, powerTrade({ ...solar, annualCost: T / deflator }, 3, powerCase('solar')).substitution);
  near(power.investment!.trade!.exports, 0);
  near(power.investment!.trade!.imports, -power.investment!.trade!.substitution);
  near(power.investment!.trade!.tradeBalance, power.investment!.trade!.substitution);
  assert.equal(research.investment?.trade, undefined);
  assert.equal(zero.investment!.trade!.substitution, 0);
  const nuclear = { ...solar, trade: { kind: 'power' as const, assumptions: { ...powerCase('nuclear'), operatingImportYenPerKwh: null } } };
  assert.equal(compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [nuclear])[0].investment?.trade, undefined);
  assert.equal(compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [nuclear])[0].investment?.startYear, 11);
  const grid = preset('grid', { supply: { ...SUPPLY_CASES.grid.settings } });
  const gridRow = compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [grid])[0];
  assert.equal(gridRow.periods[2].potentialGdpEffect, 0);
  assert.equal(gridRow.investment!.startYear, 6);
  near(gridRow.investment!.supply!, 0); // Energy is not the Leontief bottleneck.
  assert(gridRow.investment!.trade!.tradeBalance > 0, 'Fuel savings remain visible at commissioning');
  const importedInputs = { ...semiconductor, trade: { kind: 'industry' as const, assumptions: { ...SEMICONDUCTOR_CASE, exportShare: .1, domesticReplacementShare: 0, operatingImportShare: .8 } } };
  const adverse = compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [importedInputs])[0].investment!.trade!;
  assert(adverse.exports > 0 && adverse.imports > adverse.exports);
  near(adverse.tradeBalance, adverse.exports - adverse.imports);
  assert(adverse.tradeBalance < 0, 'Positive exports alone must not be labelled a positive trade contribution');
});

test('long-run comparisons distinguish conditional supply, unknown policies, and publication horizons', () => {
  const initial = initialEconomy();
  const candidate = preset('rd', { supply: { ...SUPPLY_CASES.rd.settings } });
  const row = compareNextTrillion(initial, [candidate], P, NO_SHOCK, THRESHOLDS, [candidate])[0];
  assert.equal(row.publishedYears, 5);
  assert.equal(row.investment!.startYear, 4);
  assert.equal(row.investment!.lifetime, 20);
  assert(row.investment!.supply! > 0);
  assert.equal(compareNextTrillion(initial, [], P, NO_SHOCK, THRESHOLDS, [preset('defence')])[0].investment, undefined);
  for (const record of supplyRecords(Object.fromEntries(Object.entries(SUPPLY_CASES).map(([id, ref]) => [id, ref.settings])))) {
    assert.equal(record.status, 'assumption'); assert(record.sourceUrl);
    assert(!inputLabel(record.key, POLICIES).includes('未分類'));
  }
});

test('comparison reports actual marginal outcomes at 1, 3 and 5 years, including delayed potential output', () => {
  const initial = initialEconomy();
  const current = [preset('cash', { annualCost: 4 * T })];
  const candidate = preset('rd', { potentialGdpEffect: .5, implementationLag: 3 });
  for (const referenceModel of ['ef2026', 'esri2022'] as const) {
    const p = { ...P, referenceModel };
    const row = compareNextTrillion(initial, current, p, NO_SHOCK, THRESHOLDS, [candidate])[0];
    const base = simulate(initial, current, 10, p);
    const extra = simulate(initial, [...current, { ...candidate, annualCost: T, duration: 1 }], 10, p);
    assert.deepEqual(row.periods.map(period => period.year), [1, 3, 5].filter(year => year <= row.publishedYears));
    for (const period of row.periods) {
      const step = extra.steps[period.year - 1], before = base.steps[period.year - 1];
      near(period.realGdpEffect, step.state.macro.realGdp - before.state.macro.realGdp);
      near(period.inflationPressure, step.state.macro.inflation - before.state.macro.inflation);
      near(period.exports, step.state.external.exports - before.state.external.exports);
      near(period.imports, step.state.external.imports - before.state.external.imports);
      near(period.tradeBalanceEffect, period.exports - period.imports);
      near(period.debtGdpChange, step.metrics.grossDebtGdp - before.metrics.grossDebtGdp);
      near(period.potentialGdpEffect, step.state.macro.potentialGdp - before.state.macro.potentialGdp);
    }
    assert.equal(row.periods[0].potentialGdpEffect, 0);
    assert.equal(row.periods[1].potentialGdpEffect, 0);
    if (referenceModel === 'ef2026') assert(row.periods[2].potentialGdpEffect > 0);
    else assert.equal(row.periods.length, 2);
    assert(row.supplyEffectConfigured);
    assert(!compareNextTrillion(initial, [], p, NO_SHOCK, THRESHOLDS, [preset('rd')])[0].supplyEffectConfigured);
  }
});

test('project imports replace the construction anchor, and operation affects GDP, potential and debt once', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, productionModel: 'cobbDouglas' as const, capacityPriceSensitivity: 0, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const c = { ...INDUSTRY_CASE, annualSalesPerInvestment: 1, capexImportShare: .3, lag: 2 };
  const policy = preset('semiconductors', { duration: 1, trade: { kind: 'industry', assumptions: c } });
  const noSales = { ...policy, trade: { kind: 'industry' as const, assumptions: { ...c, annualSalesPerInvestment: 0 } } };
  const actual = simulate(initial, [policy], 10, p);
  const base = simulate(initial, [noSales], 10, p);
  near(actual.steps[0].demand.imports, .3 * T);
  near(actual.steps[0].state.macro.realGdp, base.steps[0].state.macro.realGdp);
  near(actual.steps[2].demand.exports - base.steps[2].demand.exports, .5 * T);
  near(actual.steps[2].demand.domesticSubstitution, .25 * T);
  near(actual.steps[2].state.macro.realGdp - base.steps[2].state.macro.realGdp, .5 * T);
  near(actual.steps[2].state.macro.potentialGdp - base.steps[2].state.macro.potentialGdp, .5 * T);
  assert(actual.steps[9].state.fiscal.grossDebt < base.steps[9].state.fiscal.grossDebt);
  for (const step of actual.steps) {
    const d = step.demand;
    near(d.additionalDemand, d.realOutput + d.imports - d.exports + d.prices);
    near(step.state.external.tradeBalance, step.state.external.exports - step.state.external.imports);
    near(step.state.external.tradeBalance, step.state.external.goodsBalance + step.state.external.servicesBalance);
  }
  const row = compareNextTrillion(initial, [], p, NO_SHOCK, THRESHOLDS, [policy])[0];
  assert(row.periods[1].potentialGdpEffect > 0 && row.periods[2].potentialGdpEffect > 0);
  assert.throws(() => simulate(initial, [{ ...policy, potentialGdpEffect: 1 }], 10, p));
});

test('project vintages deflate payments, expire, and cap overlapping substitution jointly', () => {
  const initial = initialEconomy(); initial.macro.inflation = .1;
  const p = { ...P, baselineInflation: .1, inflationPersistence: 0 };
  const c = { ...INDUSTRY_CASE, annualSalesPerInvestment: 1, lag: 1, lifetime: 2 };
  const policy = preset('semiconductors', { duration: 2, trade: { kind: 'industry', assumptions: c } });
  near(projectResponse(initial, policy, 1, p).exports, 0);
  near(projectResponse(initial, policy, 3, p).exports, .5 * T * (1 + 1 / 1.1));
  near(projectResponse(initial, policy, 4, p).exports, .5 * T / 1.1);
  near(projectResponse(initial, policy, 5, p).exports, 0);
  const huge = { ...policy, annualCost: 10000 * T };
  const combined = projectResponses(initial, [huge, huge], 3, p);
  near(combined.reduce((sum, flow) => sum + flow.substitution, 0), initial.external.imports - initial.energy.importBill);
  const doubled = projectResponses(initial, [{ ...huge, annualCost: huge.annualCost * 2 }], 3, p);
  near(doubled[0].substitution, combined[0].substitution + combined[1].substitution);
  assert.throws(() => simulate(initial, [preset('cash', { trade: policy.trade })]));
  assert.throws(() => simulate(initial, [preset('grid', { trade: policy.trade })]));
  assert.throws(() => simulate(initial, [{ ...policy, trade: { kind: 'industry', assumptions: { ...c, capexImportShare: 2 } } }]));
});

test('power savings reach trade and energy bills once, while unknown nuclear imports suppress incomplete benefits', () => {
  const initial = initialEconomy(); initial.macro.inflation = 0;
  const p = { ...P, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0 };
  const c = { ...powerCase('solar'), lag: 2 }; // Pin commissioning to year 3 for the accounting comparison.
  const policy = preset('generation', { duration: 1, trade: { kind: 'power', assumptions: c } });
  const without = { ...policy, trade: { kind: 'power' as const, assumptions: { ...c, thermalReplacement: 0 } } };
  const actual = simulate(initial, [policy], 10, p), base = simulate(initial, [without], 10, p);
  const saving = powerTrade(policy, 3, c).substitution;
  near(actual.steps[2].demand.imports - base.steps[2].demand.imports, -saving);
  near(actual.steps[2].state.external.imports - base.steps[2].state.external.imports,
    -saving * (base.steps[1].state.macro.nominalGdp / base.steps[1].state.macro.realGdp));
  near(actual.steps[2].state.energy.importBill - base.steps[2].state.energy.importBill,
    actual.steps[2].state.external.imports - base.steps[2].state.external.imports);
  const nuclear = { ...policy, trade: { kind: 'power' as const, assumptions: { ...powerCase('nuclear'), operatingImportYenPerKwh: null } } };
  assert.equal(projectResponse(initial, nuclear, 11, p).substitution, 0);
  assert.equal(projectResponse(initial, nuclear, 11, p).operatingConfigured, false);
  assert(projectResponse(initial, { ...nuclear, trade: { kind: 'power', assumptions: { ...powerCase('nuclear'), operatingImportYenPerKwh: 1 } } }, 11, p).substitution > 0);
});

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
  assert.equal(NATIONAL_BURDEN[0].rate, .329);
  assert(!burdenRecords(false).some(r => r.key === 'burden.national.2025'));
  assert.equal(burdenRecords(true).find(r => r.key === 'burden.national.2025')!.status, 'estimated');
  assert.throws(() => extendedHouseholdBurden(row, NaN));
});

test('national GDP and NI ratios retain published totals and fiscal-year status', () => {
  const national = NATIONAL_BURDEN[0];
  near(national.tax, .282 * 452 / 642.4);
  assert.deepEqual(NATIONAL_BURDEN.map(r => r.rate), [.329, .329, .327]);
  assert.deepEqual(NATIONAL_BURDEN.map(r => r.niRate), [.467, .461, .457]);
  // Published 2026 components round to 45.6%, but the official total is 45.7%.
  assert.notEqual(NATIONAL_BURDEN[2].niRate, NATIONAL_BURDEN[2].taxNi + NATIONAL_BURDEN[2].socialNi);
  const records = burdenRecords(true);
  assert.equal(records.find(r => r.key === 'burden.national.2024.ni')!.status, 'verified');
  assert.equal(records.find(r => r.key === 'burden.national.2025.ni')!.status, 'estimated');
  assert(!burdenRecords(false).some(r => r.key === 'burden.national.2025.ni'));
  assert(!records.some(r => r.key.endsWith('.gni')));
});

test('working household aggregate uses adjusted household weights and excludes older households', () => {
  assert.deepEqual(AGE_BURDEN_WEIGHTS.map(r => r.weight), [856, 1041, 1275, 1486, 1683, 1327, 1118, 703, 512]);
  const result = workingHouseholdBurden();
  assert.equal(result.totalWeight, 8786);
  // Independent sums from the seven source classes, for the default incidence.
  near(result.income, 9340501.407994537);
  near(result.burden, 3156023.220423401);
  near(result.average, result.burden / result.income);
  assert(result.average > result.min && result.average < result.max);
  const rates = AGE_BURDEN[0].classes.filter(r => r.headAge < 65).map(r => extendedHouseholdBurden(r, .16, .25).rate);
  assert(Math.abs(result.average - rates.reduce((a, b) => a + b, 0) / rates.length) > .001);
  assert(workingHouseholdBurden(0).average < result.average);
  near(burdenRecords(false, 0).find(r => r.key === 'burden.household.average')!.value!, workingHouseholdBurden(0).average);
});

test('OECD benchmarks switch observation years without using the household incidence assumption', () => {
  assert.deepEqual(OECD_WORKING_BURDEN.map(r => r.year), [2024, 2025]);
  const key = 'burden.oecd.single.oecd';
  const historical = burdenRecords(false).find(r => r.key === key)!;
  const latest = burdenRecords(true).find(r => r.key === key)!;
  assert.equal(historical.value, .349); assert.equal(latest.value, .351);
  assert.equal(burdenRecords(true, 1).find(r => r.key === key)!.value, latest.value);
  assert(latest.uncertaintyNote.includes('消費税・法人税を含まない'));
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

test('retained envelope can breach the configured CPI ceiling under conditional yen depreciation', () => {
  const initial = initialEconomy('latest');
  const weights: Record<string, number> = { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 };
  const mix = POLICIES.map(policy => ({ policy: { ...policy, load: ZERO_LOAD }, weight: weights[policy.id] ?? 0 }));
  const estimate = estimateFiscalSpace(initial, mix, THRESHOLDS, 10, P, NO_SHOCK);
  const audit = auditFiscalSpace(initial, mix, estimate, THRESHOLDS, 10, P, NO_SHOCK);
  assert(audit.cpi.peak < THRESHOLDS.inflation);
  assert(audit.externalStress[2].cpiPeak > THRESHOLDS.inflation);
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
  near(operating.firmGw!, operating.capacityGw * .1);
  assert.equal(powerTrade(policy, 5, { ...solar, firmShare: null }).firmGw, null);
  assert.equal(operating.tradeBalance, null);
  near(powerTrade(policy, 5, { ...solar, curtailment: .5 }).substitution, operating.substitution / 2);
  assert.equal(powerTrade(policy, 5, { ...solar, thermalReplacement: 0 }).substitution, 0);
  assert.equal(powerTrade(policy, 10, powerCase('nuclear')).capacityGw, 0);
  assert(powerTrade(policy, 11, powerCase('nuclear')).capacityGw > 0);
  assert(powerTrade(policy, 11, powerCase('nuclear')).operatingImports! > 0);
  assert.equal(powerTrade(policy, 11, { ...powerCase('nuclear'), operatingImportYenPerKwh: null }).operatingImports, null);
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
  const mix = POLICIES.map(policy => ({ policy: { ...policy, load: ZERO_LOAD }, weight: weights[policy.id] ?? 0 }));
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
  assert.equal(THRESHOLDS.inflation, .025);
  assert.deepEqual(audit.sensitivity.map(r => r.limit), [.035, .03, .025]);
  assert.deepEqual(audit.sensitivity.filter(r => r.current).map(r => r.limit), [.025]);
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
  const mix = [{ policy: preset('cash', { load: ZERO_LOAD }), weight: 1 }];
  const broad = estimateFiscalSpace(initialEconomy('latest'), mix, THRESHOLDS, 10);
  const strict = estimateFiscalSpace(initialEconomy('latest'), mix, { ...THRESHOLDS, inflation: .021 }, 10);
  assert(strict.theoreticalMaximum < broad.theoreticalMaximum);
});
test('public investment and tax cuts have distinct policy-specific limits', () => {
  const a = estimateFiscalSpace(initialEconomy('latest'), [{ policy: preset('public-investment', { load: ZERO_LOAD }), weight: 1 }], THRESHOLDS, 10);
  const b = estimateFiscalSpace(initialEconomy('latest'), [{ policy: preset('income-tax', { load: ZERO_LOAD }), weight: 1 }], THRESHOLDS, 10);
  assert(a.theoreticalMaximum > 0); assert(b.theoreticalMaximum > 0);
  assert.notEqual(a.theoreticalMaximum, b.theoreticalMaximum);
});
test('the binding constraint switches when inflation tolerance tightens', () => {
  // Isolate the response to policy from the historical year-0 CPI observation.
  const state = initialEconomy(); state.macro.inflation = P.baselineInflation;
  const mix = [{ policy: preset('public-investment', { load: ZERO_LOAD }), weight: 1 }];
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
  const mix = [{ policy: preset('cash', { load: ZERO_LOAD }), weight: 1 }];
  // Observed year zero stays visible but does not veto future policy years.
  const historical = estimateFiscalSpace(initialEconomy('2024'), mix, THRESHOLDS, 10);
  assert.equal(historical.status, 'boundary');
  assert(historical.recommendedEnvelope > 0);
  assert.equal(estimateFiscalSpace(initialEconomy('latest'), mix, { ...THRESHOLDS, debt: 1 }, 10).status, 'baseline-violated');
  assert.equal(estimateFiscalSpace(initialEconomy('latest'), [], THRESHOLDS, 10).status, 'empty-mix');
  const cap = estimateFiscalSpace(initialEconomy('latest'), mix, THRESHOLDS, 10, { ...P, searchCap: T / 100 });
  assert.equal(cap.status, 'search-cap'); near(cap.emergencyReserve + cap.recommendedEnvelope, cap.theoreticalMaximum);
});
test('safe endpoint and a nearby violation bracket the reported boundary', () => {
  const mix = [{ policy: preset('public-investment', { load: ZERO_LOAD }), weight: 1 }];
  const r = estimateFiscalSpace(initialEconomy('latest'), mix, THRESHOLDS, 10);
  assert.equal(r.status, 'boundary');
  assert(peakConstraints(simulate(initialEconomy('latest'), allocateMix(mix, r.theoreticalMaximum)), THRESHOLDS).every(c => c.status !== 'violated'));
  assert(peakConstraints(simulate(initialEconomy('latest'), allocateMix(mix, r.theoreticalMaximum + P.searchTolerance * 2)), THRESHOLDS).some(c => c.status === 'violated'));
});
test('surpluses retire principal and accumulate assets only after full retirement', () => {
  const buckets = [{ principal: 100, coupon: .01, maturityYear: 5 }];
  assert.equal(financeDebt(buckets, -40, 1, .02, 10).buckets[0].principal, 60);
  assert.equal(financeDebt(buckets, -140, 1, .02, 10).assetAccumulation, 40);
});
test('invalid inputs fail explicitly', () => {
  assert.throws(() => simulate(initialEconomy(), [preset('cash', { annualCost: NaN })]));
  assert.throws(() => simulate(initialEconomy(), [], 0));
  assert.throws(() => allocateMix([{ policy: preset('cash', { load: ZERO_LOAD }), weight: -1 }], T));
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

test('longer maturity spreads rate shock effects across 1, 3 and 5 years', () => {
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
  assert(rows.filter(r => (r.key.startsWith('parameters.') && !r.key.startsWith('parameters.electricity.')) || r.key.startsWith('thresholds.')).every(r => r.status === 'assumption' && r.sourceUrl === null));
  assert(rows.filter(r => r.key.startsWith('parameters.electricity.')).every(r => r.status === 'assumption' && r.sourceUrl));
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
  // Source coefficients are unchanged; explicit gap sensitivity changes application.
  assert(latestPath.steps[0].demand.realOutput < oldPath.steps[0].demand.realOutput);
  near(calibratedResponse(latest, preset('cash'), 1, P).gdp, calibratedResponse(original, preset('cash'), 1, P).gdp);
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
  const p = { ...P, capacityPriceSensitivity: 0, electricity: { ...P.electricity, demandGrowth: 0 }, baselineInflation: 0, baselineRealGrowth: 0 };
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

test('resident tax uses the income-tax proxy, aggregates personal relief and expires without employer relief', () => {
  const initial = initialEconomy(), resident = preset('resident-tax', { annualCost: 2 * T, kind: 'temporary', duration: 1 });
  const income = preset('income-tax', { annualCost: T, kind: 'temporary', duration: 1 });
  const p = { ...P, hoursElasticity: .1, participationElasticity: .05 };
  assert.equal(resident.channel, 'tax');
  assert.deepEqual(calibratedResponse(initial, resident, 1, p), calibratedResponse(initial, { ...income, annualCost: 2 * T }, 1, p));
  const supply = taxLabourSupply(initial, [resident, income], 1, p);
  near(supply.employeeCut, 3 * T); near(supply.employerCut, 0);
  assert(supply.hours > 1); assert(supply.participation > 1);
  near(taxLabourSupply(initial, [resident, income], 2, p).employeeCut, 0);
  const path = simulate(initial, [resident, income], 2, p);
  near(path.steps[0].state.fiscal.taxRevenue, initial.fiscal.taxRevenue * (path.steps[0].state.macro.nominalGdp / initial.macro.nominalGdp) ** p.taxRevenueElasticity - 3 * T);
  near(path.steps[1].state.fiscal.taxRevenue, initial.fiscal.taxRevenue * (path.steps[1].state.macro.nominalGdp / initial.macro.nominalGdp) ** p.taxRevenueElasticity);
  const row = compareNextTrillion(initial, [], p, NO_SHOCK, THRESHOLDS, [resident])[0];
  assert(row.supplyEffectConfigured);
  assert(row.periods[0].potentialGdpEffect > 0);
  assert(POLICY_TRADE_CHANNELS[resident.id]);
});

test('social-insurance relief is split once between employee and employer; income tax goes to the employee', () => {
  const initial = initialEconomy(), policies = [preset('social-insurance', { annualCost: 4 * T }), preset('income-tax', { annualCost: 2 * T })];
  const supply = taxLabourSupply(initial, policies, 1, P);
  near(supply.employeeCut, 4 * T); near(supply.employerCut, 2 * T);
  near(supply.employeeCut + supply.employerCut, 6 * T);
  const withRelief = simulate(initial, policies, 1).steps[0];
  near(withRelief.state.fiscal.taxRevenue, initial.fiscal.taxRevenue * (withRelief.state.macro.nominalGdp / initial.macro.nominalGdp) ** P.taxRevenueElasticity - 6 * T);
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
    assert.equal(rows.length, REFERENCES[model].years * (model === 'ef2026' ? 5 : 3) * 10);
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
