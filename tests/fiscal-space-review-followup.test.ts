import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, TRILLION } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { policyLoads, loadCoverage } from '../app/lib/fiscal-space/policy-load';
import { estimatePolicyLoad, RESOURCE_DEFAULTS } from '../app/lib/fiscal-space/resource-estimate';
import { longRunScenario, LONG_RUN } from '../app/lib/fiscal-space/long-run';
import { peakConstraints } from '../app/lib/fiscal-space/constraints';
import { THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, encodeScenario } from '../client/lib/fiscal-space-url';
import type { Policy } from '../types/fiscal-space';

const near = (a: number, b: number, tol = 1e-9) => assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const T = TRILLION;
const find = (id: string) => POLICIES.find(p => p.id === id)!;
const withLoad = (id: string, cost: number, initial = initialEconomy()): Policy => {
  const policy = { ...find(id), annualCost: cost };
  return { ...policy, load: estimatePolicyLoad(policy, initial, RESOURCE_DEFAULTS) };
};

// A. Policy electricity volume -> imported fuel bill.
test('estimated loads carry annual electricity, and semiconductor operation adds fuel imports after commissioning', () => {
  const initial = initialEconomy();
  const semi = withLoad('semiconductors', 10 * T, initial);
  assert(semi.load!.annualGwhPerTrillion! > 0 && semi.load!.operatingAnnualGwhPerTrillion! > 0);
  assert.deepEqual(loadCoverage(semi.load), { sector: true, energy: true, fuel: true });
  const base = simulate(initial, [], 5, PARAMETERS), path = simulate(initial, [semi], 5, PARAMETERS);
  for (const [i, step] of path.steps.entries()) {
    const e = step.electricity!, b = base.steps[i];
    // Fuel bill = TWh x 1e9 kWh x yen/kWh x marginal thermal share, on the common price path.
    assert(e.policyDemandTwh > 0);
    assert(e.policyFuelIncrease > 0);
    near(e.policyFuelIncrease / e.policyDemandTwh / 1e9 / PARAMETERS.electricity.fuelImportYenPerKwh / (1 + PARAMETERS.baselineInflation) ** i, 1, .05);
    assert(step.state.energy.importBill > b.state.energy.importBill);
    // The distinct fuel bill flows into total imports alongside the published response.
    assert(step.state.external.imports - b.state.external.imports > e.policyFuelIncrease - 1);
  }
  // Duration 3 with lag 3: spending-year electricity for years 1-3, operating electricity from year 4.
  const twh = path.steps.map(s => s.electricity!.policyDemandTwh);
  assert(twh[3] > 0 && twh[4] > 0);
  const zeroFuel = simulate(initial, [semi], 5, { ...PARAMETERS, electricity: { ...PARAMETERS.electricity, marginalThermalShare: 0 } });
  near(zeroFuel.steps[0].electricity!.policyFuelIncrease, 0);
  near(zeroFuel.steps[0].state.energy.importBill, base.steps[0].state.energy.importBill);
});

test('public investment electricity is confined to spending years and stays out of the base fuel path', () => {
  const initial = initialEconomy();
  const pub = { ...withLoad('public-investment', 10 * T, initial), duration: 1 };
  const loads = [1, 2, 3].map(year => policyLoads(initial, [pub], year, PARAMETERS));
  assert(loads[0].annualGwh > 0);
  near(loads[1].annualGwh, 0); near(loads[2].annualGwh, 0);
  const path = simulate(initial, [pub], 3, PARAMETERS), base = simulate(initial, [], 3, PARAMETERS);
  near(path.steps[1].electricity!.policyFuelIncrease, 0);
  // Generation investment's fuel saving and policy fuel demand sit in the same import bill.
  const balance = path.steps[0].state.energy.importBill - base.steps[0].state.energy.importBill;
  near(balance, path.steps[0].electricity!.policyFuelIncrease + path.steps[0].electricity!.commonFuelIncrease - base.steps[0].electricity!.commonFuelIncrease, 1e-6);
});

test('manual loads without electricity volume leave fuel imports unevaluated and unchanged', () => {
  const initial = initialEconomy();
  const manual: Policy = { ...find('public-investment'), annualCost: 10 * T,
    load: { sectorUtilizationPerTrillion: .01, peakGwPerTrillion: .2, operatingPeakGwPerTrillion: 0, lag: 2, lifetime: 20, depreciation: .03 } };
  assert.deepEqual(loadCoverage(manual.load), { sector: true, energy: true, fuel: false });
  const path = simulate(initial, [manual], 3, PARAMETERS);
  near(path.steps[0].electricity!.policyFuelIncrease, 0);
  assert.equal(path.steps[0].coverage?.fuel, false);
  const energy = peakConstraints(path, THRESHOLDS).find(c => c.id === 'energy')!;
  assert(energy.explanation.includes('燃料輸入は一部未評価'));
});

// B. Long-run refinancing carries the published long-rate response.
test('long-run policy refinancing starts from the short-run published rate response and fades over five years', () => {
  const initial = initialEconomy();
  const pub = { ...find('public-investment'), annualCost: 10 * T };
  const short = simulate(initial, [pub], 5, PARAMETERS), base = simulate(initial, [], 5, PARAMETERS);
  const rows = longRunScenario(initial, [pub], short, base, PARAMETERS, LONG_RUN);
  const effect = short.steps[4].referenceRateEffect!;
  assert(effect > 0);
  near(rows[0].rate, LONG_RUN.rate + effect * .8);
  near(rows[3].rate, LONG_RUN.rate + effect * .2);
  for (const row of rows.slice(4)) near(row.rate, LONG_RUN.rate);
  assert(rows[0].interest > rows[0].baselineInterest);
  // A policy without a published rate response uses the long-run rate from the first year.
  const flat = { ...PARAMETERS, referenceModel: 'esri2022' as const };
  const shortFlat = simulate(initial, [pub], 3, flat), baseFlat = simulate(initial, [], 3, flat);
  near(longRunScenario(initial, [pub], shortFlat, baseFlat, flat, LONG_RUN)[0].rate, LONG_RUN.rate);
});

// D. Screen-path reproduction of the reported experiments.
test('form path: initial gap changes GDP and CPI responses, and zero sensitivities restore the linear published response', () => {
  const engine = createFiscalEngine();
  const run = (gap: number, zero = false) => {
    const form = defaults();
    form.gap = gap; form.amounts['public-investment'] = 10;
    if (zero) form.calibration = { ...form.calibration, gapDemandSensitivity: 0, gapPriceSensitivity: 0 };
    return engine(form).projection.steps[0].state.macro;
  };
  const slack = run(-5), hot = run(3);
  assert(slack.realGdp > hot.realGdp);
  assert(slack.inflation < hot.inflation);
  near(run(-5, true).realGdp, run(3, true).realGdp);
});

test('form path: consumption and income tax relief of equal size differ in CPI under both reference models', () => {
  const engine = createFiscalEngine();
  for (const model of ['ef2026', 'esri2022'] as const) {
    const cpi = (id: string) => {
      const form = defaults();
      form.amounts[id] = 5; form.calibration = { ...form.calibration, referenceModel: model };
      return engine(form).projection.steps[0].state.macro.inflation;
    };
    assert(cpi('consumption-tax') < cpi('income-tax') - .005);
  }
});

test('shared scenarios: old links gain the fuel channel defaults and new electricity fields round-trip', () => {
  const form = defaults();
  form.loads['public-investment'] = { sectorUtilizationPerTrillion: 0, peakGwPerTrillion: 0, operatingPeakGwPerTrillion: 0,
    annualGwhPerTrillion: 100, operatingAnnualGwhPerTrillion: 0, lag: 2, lifetime: 20, depreciation: .03 };
  assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  const legacy = defaults();
  const { marginalThermalShare: _omit, ...electricity } = legacy.calibration.electricity;
  const raw = { ...legacy, calibration: { ...legacy.calibration, electricity } };
  const restored = decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.3', form: raw })));
  assert.equal(restored.calibration.electricity.marginalThermalShare, PARAMETERS.electricity.marginalThermalShare);
});
