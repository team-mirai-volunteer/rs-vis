import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { policyCostYen, totalPolicyCostYen } from '../client/lib/fiscal-space-amounts';
import { initialEconomy, PARAMETERS, THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { constraintInflation, peakConstraints } from '../app/lib/fiscal-space/constraints';
import { constraintSensitivity } from '../app/lib/fiscal-space/constraint-sensitivity';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { EMPTY_PROJECT_BASIS } from '../app/lib/fiscal-space/policy-load';
import { powerCase } from '../app/lib/fiscal-space/policy-trade';

const example = () => {
  const f = defaults();
  Object.assign(f.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 });
  return f;
};

test('15 trillion example: versioned absolute bounds and reserve amounts, not just solver identities', () => {
  const calculate = createFiscalEngine(), form = example();
  // Yen/trillion and coefficients are pinned at the displayed 0.01-trillion resolution.
  // These are reproducible outputs, not an empirical validation of the model.
  // With IO loads, research staffing binds before the higher CPI ceilings.
  for (const [limit, maximum, envelope] of [[.02, 0, 0], [.025, 17.01, 13.61], [.03, 27.45, 21.96], [.035, 27.45, 21.96]]) {
    form.thresholds.inflation = limit;
    const r = calculate(form);
    assert.equal(r.totalYen, 15_000_000_000_000);
    assert(Math.abs(r.estimate.theoreticalMaximum / 1e12 - maximum) < .005);
    assert(Math.abs(r.estimate.recommendedEnvelope / 1e12 - envelope) < .005);
    assert.equal(r.estimate.status, limit === .02 ? 'baseline-violated' : 'boundary');
    assert.equal(r.horizon, 5);
    assert.equal(r.riskAudit.extrapolatedYears, 0);
    if (limit === .025) {
      const delta = (id: string) => r.sensitivity.find(c => c.id === id)!.delta!;
      assert(Math.abs(delta('inflation') * 100 - 1.07991685) < .00001);
      assert(Math.abs(delta('labour') * 100 - .00806445) < .00001);
      assert(delta('inflation') > delta('interestGdp'));
      assert.equal(delta('debt'), 0);
      assert.equal(r.constraints.find(c => c.id === 'sector')!.coverageComplete, true);
      assert.equal(r.constraints.find(c => c.id === 'energy')!.coverageComplete, true);
    }
  }
});

test('UI and engine share yen conversion and consumption-tax cap', () => {
  assert.equal(policyCostYen('rd', 1.5, PARAMETERS), 1_500_000_000_000);
  assert.equal(policyCostYen('consumption-tax', 100, PARAMETERS), 35_000_000_000_000);
  const form = defaults();
  form.calibration.consumptionTax = { ...form.calibration.consumptionTax, revenuePerPoint: 2e12, baseRate: .08 };
  Object.assign(form.amounts, { 'consumption-tax': 100, rd: 1.5 });
  assert.equal(totalPolicyCostYen(form.amounts, form.calibration), 17_500_000_000_000);
  const r = createFiscalEngine()(form);
  assert.equal(r.totalYen, 17_500_000_000_000);
  assert(r.sensitivity.every(c => c.delta === null), 'fixed-share extra trillion exceeds the tax cap');
  assert(createFiscalEngine()(defaults()).sensitivity.every(c => c.delta === null));
});

test('CPI selector uses the stricter of headline and tax-adjusted inflation', () => {
  const step = simulate(initialEconomy('latest'), [], 1, PARAMETERS).initial;
  step.state.macro.inflation = .02;
  assert.equal(constraintInflation({ ...step, taxAdjustedInflation: undefined }), .02);
  assert.equal(constraintInflation({ ...step, taxAdjustedInflation: .03 }), .03);
  assert.equal(constraintInflation({ ...step, taxAdjustedInflation: -.01 }), .02);
});

test('coverage over all years survives an earlier violation; finite differences use actual peaks', () => {
  const current = simulate(initialEconomy('latest'), [], 3, PARAMETERS);
  current.initial.state.labour.sectorUtilization.construction = 1.1;
  current.steps[2].coverage = { sector: false, energy: false };
  const sector = peakConstraints(current, THRESHOLDS).find(c => c.id === 'sector')!;
  assert.equal(sector.status, 'violated');
  assert.equal(sector.year, 0);
  assert.equal(sector.coverageComplete, false);
  const probe = structuredClone(current);
  current.initial.metrics.grossDebtGdp = probe.initial.metrics.grossDebtGdp = 3;
  for (const s of current.steps) s.metrics.grossDebtGdp = 2;
  for (const s of probe.steps) s.metrics.grossDebtGdp = 2.5;
  assert.equal(constraintSensitivity(current, probe, THRESHOLDS).find(c => c.id === 'debt')!.delta, 0);
  probe.steps[1].metrics.grossDebtGdp = 3.28;
  assert(Math.abs(constraintSensitivity(current, probe, THRESHOLDS).find(c => c.id === 'debt')!.delta! - .1) < 1e-12);
});

test('every numeric URL input rejects extreme values, including unused load coefficients', () => {
  const form = example();
  form.trade.mix = { solar: 50, nuclear: 25, hydro: 25 };
  form.trade.powerCases = { solar: powerCase('solar'), nuclear: powerCase('nuclear'), hydro: powerCase('hydro') };
  form.loads.rd = { sectorUtilizationPerTrillion: null, peakGwPerTrillion: null, operatingPeakGwPerTrillion: null,
    lag: 0, lifetime: 10, depreciation: 0, basis: { ...EMPTY_PROJECT_BASIS } };
  assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  const visit = (obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number' || value === null) {
        for (const extreme of [-1e15, 1e15]) {
          obj[key] = extreme;
          const hash = '#scenario=' + encodeURIComponent(JSON.stringify({ version: FISCAL_MODEL_VERSION, form }));
          assert.throws(() => decodeScenario(hash), key);
        }
        obj[key] = value;
      } else if (typeof value === 'object') visit(value as Record<string, unknown>);
    }
  };
  visit(form);
});

test('shared URL rejects modest out-of-range coefficients and accepts editable boundaries', () => {
  for (const [path, bad] of [
    ['calibration.multiplierScale', 3.01], ['calibration.marketRate', -.001],
    ['calibration.gapDemandSensitivity', 10.01], ['calibration.consumptionTax.passThrough', 1.01],
    ['calibration.electricity.demandGrowth', -.101], ['supply.rd.additionality', -.01],
    ['supply.rd.unitCost', 0], ['longRun.inflation', .051], ['trade.industry.rd.lifetime', 51],
    ['trade.power.capexPerKw', 9999], ['calibration.baselineRealGrowth', .02],
  ] as const) {
    const f = defaults(), keys = path.split('.');
    let target = f as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = bad;
    assert.throws(() => encodeScenario(f), path);
  }
  const f = defaults();
  f.calibration.marketRate = .06; f.calibration.multiplierScale = 3;
  f.calibration.electricity.demandGrowth = -.1;
  f.supply.rd.additionality = 0; f.longRun.inflation = .05; f.corporateShare = 1;
  assert.deepEqual(decodeScenario(encodeScenario(f)), f);
});
