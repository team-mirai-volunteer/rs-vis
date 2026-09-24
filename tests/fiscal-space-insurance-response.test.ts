import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, TRILLION, NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { INSURANCE_DEFAULTS, insuranceIncidence, insuranceLabour } from '../app/lib/fiscal-space/insurance-response';
import { calibratedResponse } from '../app/lib/fiscal-space/calibration';
import { povertyScenario, POVERTY_DEFAULTS } from '../app/lib/fiscal-space/poverty';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenarioDetailed, encodeScenario } from '../client/lib/fiscal-space-url';
import { createOptimizationEvaluator, projectionObjectiveValues } from '../client/lib/fiscal-optimizer';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';

const initial = initialEconomy();
const policy = { ...POLICIES.find(p => p.id === 'social-insurance')!, annualCost: 10 * TRILLION, kind: 'permanent' as const };
const near = (a: number, b: number) => assert(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('employer relief is partitioned once, wages ramp and all direct flows stop at expiry', () => {
  const first = insuranceIncidence([policy], 1, .5, INSURANCE_DEFAULTS);
  const last = insuranceIncidence([policy], 15, .5, INSURANCE_DEFAULTS);
  near(first.wage, .5 * TRILLION); near(last.wage, 2.5 * TRILLION); near(last.netWage, 1.75 * TRILLION);
  near(last.employee + last.remainingCostRelief + last.wage, policy.annualCost);
  assert.deepEqual(last, insuranceIncidence([{ ...policy, annualCost: 5 * TRILLION }, { ...policy, annualCost: 5 * TRILLION }], 15, .5, INSURANCE_DEFAULTS));
  const expired = insuranceIncidence([{ ...policy, kind: 'temporary', duration: 1 }], 2, .5, INSURANCE_DEFAULTS);
  assert(Object.values(expired).every(v => v === 0));
  near(insuranceIncidence([policy], 15, 1, INSURANCE_DEFAULTS).wage, 0);
  near(insuranceIncidence([policy], 15, 0, { ...INSURANCE_DEFAULTS, wagePassThrough: 1 }).remainingCostRelief, 0);
});

test('household wage incidence conserves net allocated income and does not accumulate annual cuts', () => {
  const old = povertyScenario([policy], 15, POVERTY_DEFAULTS, .5);
  const next = povertyScenario([policy], 15, POVERTY_DEFAULTS, .5, INSURANCE_DEFAULTS);
  near(next.rows[14].allocated - old.rows[14].allocated, 1.75 * TRILLION);
  near(next.rows[14].allocated, next.rows[14].requested);
  assert(next.rows[14].medianDisposableIncome > old.rows[14].medianDisposableIncome);
  near(next.rows[14].medianDisposableIncome, next.rows[4].medianDisposableIncome);
  const once = povertyScenario([{ ...policy, kind: 'temporary', duration: 1 }], 15, POVERTY_DEFAULTS, .5, INSURANCE_DEFAULTS);
  near(once.rows[1].allocated, 0);
  near(once.rows[14].medianDisposableIncome, once.baseline.medianDisposableIncome);
});

test('new labour response starts after published years, matches demand and expires without a stock', () => {
  const at = (year: number) => insuranceLabour(initial, [policy], year, PARAMETERS, 5);
  near(at(5).productiveLabour, 1);
  assert(at(15).productiveLabour > 1 && at(15).employment > 1);
  assert(at(15).employment <= at(15).participation);
  const wagesOnly = insuranceLabour(initial, [policy], 15, { ...PARAMETERS, insurance: { ...INSURANCE_DEFAULTS, wagePassThrough: 1 } }, 5);
  near(wagesOnly.employment, 1); // No simultaneous full cost relief and wage transfer.
  const once = insuranceLabour(initial, [{ ...policy, kind: 'temporary', duration: 1 }], 15, PARAMETERS, 5);
  near(once.productiveLabour, 1);
  const overrides = insuranceLabour(initial, [policy], 15, { ...PARAMETERS, hoursElasticity: .2, participationElasticity: .1, employerDemandElasticity: .1 }, 5);
  near(overrides.productiveLabour, 1);
});

test('macro closure preserves published years and fades all proxy responses, not only interest', () => {
  for (const id of ['social-insurance', 'income-tax', 'public-investment']) {
    const p = { ...POLICIES.find(x => x.id === id)!, kind: 'permanent' as const, annualCost: TRILLION };
    for (let year = 1; year <= 5; year++) assert.deepEqual(calibratedResponse(initial, p, year, PARAMETERS), calibratedResponse(initial, p, year, { ...PARAMETERS, macroTailYears: 0 }));
    const tail = calibratedResponse(initial, p, 15, PARAMETERS);
    for (const key of ['gdp', 'exports', 'imports', 'prices', 'deflator', 'employment', 'longRate'] as const) near(tail[key], 0);
    assert(calibratedResponse(initial, p, 15, { ...PARAMETERS, macroTailYears: 0 }).gdp !== 0);
  }
  const vat = { ...POLICIES.find(x => x.id === 'consumption-tax')!, kind: 'permanent' as const, annualCost: TRILLION };
  assert(calibratedResponse(initial, vat, 15, PARAMETERS).directTaxPrices < 0);
  near(calibratedResponse(initial, { ...vat, kind: 'temporary', duration: 1 }, 15, PARAMETERS).directTaxPrices, 0);
});

test('rate normalization preserves inherited coupons, debt costs, baseline rates and external shocks', () => {
  const base = simulate(initial, [], 15, PARAMETERS);
  const next = simulate(initial, [policy], 15, PARAMETERS);
  const old = simulate(initial, [policy], 15, { ...PARAMETERS, macroTailYears: 0 });
  near(next.steps[14].referenceRateEffect!, 0);
  near(next.steps[14].refinancingRate!, base.steps[14].refinancingRate!);
  assert(next.steps[14].state.fiscal.interestPayments < old.steps[14].state.fiscal.interestPayments);
  assert(next.steps[14].state.fiscal.interestPayments > base.steps[14].state.fiscal.interestPayments);
  for (const row of next.steps) near(row.state.fiscal.taxRevenue, row.state.fiscal.taxes + row.state.fiscal.socialContributions);
  const shock = simulate(initial, [policy], 15, PARAMETERS, { ...NO_SHOCK, marketRateDelta: .01 });
  near(shock.steps[14].refinancingRate! - next.steps[14].refinancingRate!, .01);
});

test('shared links preserve the legacy plateau and reject invalid new assumptions', () => {
  const form = defaults();
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(form)).form, form);
  const payload = JSON.parse(decodeURIComponent(encodeScenario(form).slice(10)));
  payload.version = '2026-09-24.4'; delete payload.form.calibration.insurance; delete payload.form.calibration.macroTailYears;
  const restored = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify(payload)));
  assert.equal(restored.form.calibration.insurance?.enabled, false);
  assert.equal(restored.form.calibration.macroTailYears, 0);
  assert(restored.filled.some(s => s.includes('据置')));
  assert.deepEqual(simulate(initial, [policy], 15, restored.form.calibration), simulate(initial, [policy], 15, { ...PARAMETERS, insurance: undefined, macroTailYears: undefined }));
  for (const patch of [{ adjustmentYears: 1.5 }, { wagePassThrough: -1 }, { demandElasticity: 2 }]) {
    const bad = structuredClone(form); Object.assign(bad.calibration.insurance!, patch);
    assert.throws(() => encodeScenario(bad));
    assert.throws(() => simulate(initial, [policy], 15, bad.calibration));
  }
  form.calibration.macroTailYears = 1.5; assert.throws(() => encodeScenario(form));
});

test('year-15 optimizer and displayed household and macro results use the same insurance settings', () => {
  const form = defaults(); form.horizon = 15; form.amounts['social-insurance'] = 2;
  const shown = createFiscalEngine()(form);
  const evaluator = createOptimizationEvaluator(form);
  assert.deepEqual(evaluator.evaluate(form.amounts).values, projectionObjectiveValues(shown.projection, shown.poverty, form.optimization));
  const legacy = structuredClone(form); legacy.calibration.insurance!.enabled = false;
  assert(evaluator.evaluate(form.amounts).values.disposableIncome! > createOptimizationEvaluator(legacy).evaluate(legacy.amounts).values.disposableIncome!);
});
