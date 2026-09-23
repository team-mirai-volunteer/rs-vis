import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, TRILLION } from '../app/lib/fiscal-space/assumptions';
import { educationProductivity, OECD_EDUCATION_SETTINGS } from '../app/lib/fiscal-space/education-response';
import { SUPPLY_CASES, supplyInputs, supplyResponse, supplyTotal, supplyRecords } from '../app/lib/fiscal-space/supply';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { defaults } from '../client/lib/fiscal-space-form';
import { createOptimizationEvaluator } from '../client/lib/fiscal-optimizer';
import { decodeScenarioDetailed, encodeScenario } from '../client/lib/fiscal-space-url';
import type { Policy } from '../types/fiscal-space';

const initial = initialEconomy();
const price = initial.macro.nominalGdp / initial.macro.realGdp;
const fixedPrices = () => price;
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const policy = (extra: Partial<Policy> = {}): Policy => ({ ...POLICIES.find(p => p.id === 'education')!, kind: 'permanent', annualCost: TRILLION,
  supply: { ...SUPPLY_CASES.education.settings }, ...extra });
const targeted = () => policy({ supply: { ...SUPPLY_CASES.education.settings, educationPisaGain: 8, additionality: 1, depreciation: 0 } });

test('Japanese generic additional spending has no automatic schooling return but retains demand and fiscal effects', () => {
  const education = policy();
  for (const year of [5, 15, 30, 60]) {
    near(educationProductivity(initial, [education], year, fixedPrices), 0);
    near(supplyResponse(initial, education, year, PARAMETERS), 0);
    assert.deepEqual(supplyInputs(initial, [education], year, PARAMETERS), supplyInputs(initial, [], year, PARAMETERS));
  }
  const neutralSupply = { ...education, supply: undefined };
  const withEducation = simulate(initial, [education], 15, PARAMETERS);
  assert.deepEqual(withEducation, simulate(initial, [neutralSupply], 15, PARAMETERS));
  const baseline = simulate(initial, [], 15, PARAMETERS);
  assert.notEqual(withEducation.steps[0].state.macro.realGdp, baseline.steps[0].state.macro.realGdp);
  assert.notEqual(withEducation.steps[0].state.fiscal.primaryExpenditure, baseline.steps[0].state.fiscal.primaryExpenditure);
});

test('targeted education arrives gradually and reaches the OECD reference only after cohort replacement', () => {
  const education = targeted();
  const gain = (year: number) => educationProductivity(initial, [education], year, fixedPrices);
  near(gain(5), 0);
  near(gain(6), .01 / 9 / 40);
  assert(gain(15) > gain(6) && gain(15) < .01 / 3);
  near(gain(60), .01);
  const once = { ...education, kind: 'temporary' as const, duration: 1 };
  near(educationProductivity(initial, [once], 14, fixedPrices), .01 / 40);
  near(educationProductivity(initial, [once], 54, fixedPrices), 0);
  const inputs = supplyInputs(initial, [education], 15, PARAMETERS, false, fixedPrices);
  near(inputs.labour, 1);
  near(inputs.tfp, 1 + gain(15));
  near(supplyTotal(initial, [education], 15, PARAMETERS, false, fixedPrices), initial.macro.potentialGdp * gain(15));
  assert.deepEqual(supplyInputs(initial, [education], 15, PARAMETERS, true, fixedPrices), inputs);
});

test('funding saturates, split policies cannot bypass the cap and inflation reduces new programme coverage', () => {
  const education = targeted();
  const value = (policies: Policy[], prices = fixedPrices) => educationProductivity(initial, policies, 15, prices);
  near(value([{ ...education, annualCost: TRILLION * 20 }]), value([education]));
  near(value([{ ...education, annualCost: TRILLION * .5 }]), value([education]) / 2);
  near(value([education, education]), value([education]));
  near(value([{ ...education, annualCost: TRILLION * .5 }, { ...education, annualCost: TRILLION * .5 }]), value([education]));
  assert(value([education], () => price * 2) < value([education]));
  assert(value([{ ...education, supply: { ...education.supply!, depreciation: .1 } }]) < value([education]));
});

test('OECD assumptions are shared, validated and distinguished from legacy schooling links', () => {
  const form = defaults();
  form.supply.education.educationPisaGain = 4;
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(form)).form, form);
  for (const patch of [{ educationSchoolYears: 1.5 }, { educationPisaGain: 101 }, { educationAnnualBudget: 0 }]) {
    const bad = structuredClone(form); Object.assign(bad.supply.education, patch);
    assert.throws(() => encodeScenario(bad));
    assert.throws(() => educationProductivity(initial, [policy({ supply: bad.supply.education })], 15, fixedPrices));
  }
  const payload = JSON.parse(decodeURIComponent(encodeScenario(form).slice(10)));
  payload.version = '2026-09-24.2';
  payload.form.supply.education = { kind: 'education', additionality: .5, lag: 4, depreciation: .02, lifetime: 35, yield: .09, unitCost: 1.5e6, employment: .8 };
  const old = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify(payload)));
  assert.deepEqual(old.form.supply.education, payload.form.supply.education);
  assert(old.filled.some(x => x.includes('旧就学年数方式')));
  assert(supplyResponse(initial, policy({ supply: old.form.supply.education }), 15, PARAMETERS) > 0);
  const records = supplyRecords({ education: old.form.supply.education });
  assert(records.every(r => r.sourceUrl?.includes('worldbank')));
  assert(supplyRecords({ education: form.supply.education }).every(r => r.sourceUrl?.includes('oecd')));
  assert.equal(OECD_EDUCATION_SETTINGS.educationPisaGain, 0);
});

test('optimizer uses the same OECD education pathway for year 15', () => {
  const form = defaults(); form.horizon = 15; form.amounts.education = 1;
  const base = createOptimizationEvaluator(form).evaluate(form.amounts);
  form.supply.education.educationPisaGain = 8;
  const improved = createOptimizationEvaluator(form).evaluate(form.amounts);
  assert(improved.values.gdp! > base.values.gdp!);
});
