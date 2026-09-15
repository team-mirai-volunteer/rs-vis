import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES } from '../app/lib/fiscal-space/assumptions';
import { SUPPLY_CASES, effectiveSupplyStock } from '../app/lib/fiscal-space/supply';
import { policyProduction } from '../app/lib/fiscal-space/policy-production';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { longRunScenario, LONG_RUN } from '../app/lib/fiscal-space/long-run';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, encodeScenario } from '../client/lib/fiscal-space-url';

const s = initialEconomy('latest'); s.macro.inflation = 0; s.macro.potentialGdp = s.macro.realGdp;
const p = { ...PARAMETERS, baselineInflation: 0, baselineRealGrowth: 0, inflationPersistence: 0, capacityPriceSensitivity: 0 };
const capital = { ...POLICIES.find(x => x.id === 'public-investment')!, annualCost: 1e12, duration: 1,
  supply: { ...SUPPLY_CASES['public-investment'].settings, additionality: 1, depreciation: 0, lifetime: 4, realizationRate: .6 } };
const near = (a: number, b: number) => assert(Math.abs(a - b) < 2, `${a} != ${b}`);

test('public assets start at commissioning, ramp by vintage and expire after their service life', () => {
  const path = simulate(s, [capital], 8, p);
  for (const year of [1, 2, 7, 8]) assert.equal(path.steps[year - 1].publicCapital!.realizedBenefit, 0);
  for (const [year, utilization] of [[3, .2], [4, .4], [5, .6]]) {
    near(effectiveSupplyStock(s, capital, year, p, true), 1e12 * utilization);
    const expected = s.macro.potentialGdp * Math.expm1(capital.supply.yield * Math.log1p(1e12 * utilization / (s.macro.realGdp * capital.supply.unitCost))) * .5;
    near(path.steps[year - 1].publicCapital!.realizedBenefit, expected);
  }
  assert(path.steps[4].publicCapital!.realizedBenefit > 0, 'benefits survive the end of budget spending');
  const late = { ...capital, kind: 'permanent' as const };
  near(effectiveSupplyStock(s, late, 4, p, true), 1e12 * (.2 + .4));
});

test('productivity services help Leontief without pretending private equipment substitutes for labour', () => {
  const services = policyProduction(s, [capital], 3, p);
  const equipment = policyProduction(s, [{ ...capital, supply: { ...capital.supply, serviceShare: 0 } }], 3, p);
  assert(services.potential > s.macro.potentialGdp);
  near(equipment.potential, s.macro.potentialGdp);
  for (const productionModel of ['leontief', 'ces', 'cobbDouglas'] as const) {
    const q = { ...p, productionModel };
    near(policyProduction(s, [capital], 3, q).potential, services.potential);
    const noOverlap = { ...capital, supply: { ...capital.supply, referenceOverlap: 0 } };
    const x = simulate(s, [noOverlap], 5, q), without = simulate(s, [{ ...noOverlap, supply: { ...noOverlap.supply, realizationRate: 0 } }], 5, q);
    x.steps.forEach((step, i) => near(step.state.macro.realGdp - without.steps[i].state.macro.realGdp, step.publicCapital!.realizedBenefit));
  }
});

test('zero additionality, zero utilization and full overlap never manufacture an extra GDP benefit', () => {
  for (const change of [{ additionality: 0 }, { realizationRate: 0 }, { referenceOverlap: 1 }, { lag: 10 }]) {
    assert(simulate(s, [{ ...capital, supply: { ...capital.supply, ...change } }], 5, p).steps.every(step => step.publicCapital!.realizedBenefit === 0));
  }
  const full = { ...capital, supply: { ...capital.supply, referenceOverlap: 1, lifetime: 20 } };
  assert(simulate(s, [full], 10, p).steps[9].publicCapital!.realizedBenefit > 0, 'overlap is phased out after the published horizon');
});

test('public capital pools different spending durations before diminishing returns, including realized GDP', () => {
  const existing = { ...capital, duration: 3, annualCost: 100e12 };
  const more = policyProduction(s, [existing, capital], 5, p, undefined, undefined, true).publicCapitalBenefit
    - policyProduction(s, [existing], 5, p, undefined, undefined, true).publicCapitalBenefit;
  const alone = policyProduction(s, [capital], 5, p, undefined, undefined, true).publicCapitalBenefit;
  assert(more > 0 && more < alone);
  const half = { ...capital, annualCost: capital.annualCost / 2 };
  near(policyProduction(s, [half, half], 5, p, undefined, undefined, true).potential, policyProduction(s, [capital], 5, p, undefined, undefined, true).potential);
});

test('default ten-trillion scenario exposes a modest benefit without forcing total GDP positive', () => {
  const f = defaults(); f.amounts['public-investment'] = 10;
  const r = createFiscalEngine()(f), end = r.projection.steps[4];
  assert(Math.abs(end.publicCapital!.potentialBenefit / 1e12 - 1.50262033) < 1e-6);
  assert(Math.abs(end.publicCapital!.realizedBenefit / 1e12 - .252543542) < 1e-6);
  assert(Math.abs((end.state.macro.realGdp - r.baseline.steps[4].state.macro.realGdp) / 1e12 + 5.014088977) < 1e-6);
  near(end.state.macro.realGdp - r.baseline.steps[4].state.macro.realGdp, end.publicCapital!.realizedBenefit + end.publicCapital!.demandEffect);
  assert.equal(r.publicCapitalSensitivity.at(-1)!.benefit, 0);
  assert(r.publicCapitalSensitivity[0].benefit > r.publicCapitalSensitivity[1].benefit);
  const f0 = end.state.fiscal;
  near(f0.primaryBalance, f0.taxRevenue + f0.otherPrimaryRevenue - f0.primaryExpenditure);
});

test('legacy links preserve equipment-only behavior and new capital settings are bounded', () => {
  const f = defaults();
  assert.deepEqual(decodeScenario(encodeScenario(f)), f);
  const legacy = structuredClone(f);
  for (const key of ['serviceShare', 'realizationRate', 'rampYears', 'referenceOverlap'] as const) delete legacy.supply['public-investment'][key];
  const hash = '#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-15.7', form: legacy }));
  assert.deepEqual(decodeScenario(hash), legacy);
  const legacyPolicy = { ...capital, supply: legacy.supply['public-investment'] };
  assert(simulate(s, [legacyPolicy], 5, p).steps.every(step => step.publicCapital!.realizedBenefit === 0));
  for (const change of [{ realizationRate: -1 }, { serviceShare: 1.1 }, { referenceOverlap: 2 }, { rampYears: 1.5 }]) {
    const bad = { ...f, supply: { ...f.supply, 'public-investment': { ...f.supply['public-investment'], ...change } } };
    assert.throws(() => encodeScenario(bad));
    assert.throws(() => simulate(s, [{ ...capital, supply: bad.supply['public-investment'] }], 5, p));
  }
});

test('long-term public benefits use surviving capital once and vanish after retirement', () => {
  const q = { ...capital, supply: { ...capital.supply, lifetime: 10 } };
  const base = simulate(s, [], 5, p), short = simulate(s, [q], 5, p);
  const rows = longRunScenario(s, [q], short, base, p, { ...LONG_RUN, realGrowth: 0 });
  near(rows.find(x => x.year === 10)!.supplyBenefit, .5 * policyProduction(s, [q], 10, p).publicCapitalBenefit);
  assert.equal(rows.find(x => x.year === 13)!.supplyBenefit, 0);
});
