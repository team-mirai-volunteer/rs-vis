import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS, TRILLION, permittedUnemploymentFloor } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { CONSTRAINTS, peakConstraints, unemploymentRate } from '../app/lib/fiscal-space/constraints';
import { calibratedResponse } from '../app/lib/fiscal-space/calibration';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenarioDetailed, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { THRESHOLD_BOUNDS } from '../client/lib/fiscal-space-ranges';
import { differenceChartScale } from '../client/lib/fiscal-chart-scale';

const near = (a: number, b: number, tol = 1e-9) => assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const T = TRILLION;
const find = (id: string) => POLICIES.find(p => p.id === id)!;
const example = () => { const f = defaults(); Object.assign(f.amounts, { 'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2 }); return f; };

// 1-A: labour constraint is a NAIRU-gap ratio with an interpretable unemployment floor.
test('labour constraint compares structural to actual unemployment and binds between the old all-or-nothing settings', () => {
  const initial = initialEconomy();
  const labour = CONSTRAINTS.find(c => c.id === 'labour')!;
  const base = simulate(initial, [], 1, PARAMETERS).steps[0];
  near(labour.measure(base), PARAMETERS.structuralUnemployment / unemploymentRate(base));
  near(permittedUnemploymentFloor(.025, 1.25), .02);
  const big = simulate(initial, [{ ...find('public-investment'), annualCost: 40 * T }], 5, PARAMETERS);
  const tight = peakConstraints(big, { ...THRESHOLDS, labour: 1 }).find(c => c.id === 'labour')!;
  const loose = peakConstraints(big, { ...THRESHOLDS, labour: 1.6 }).find(c => c.id === 'labour')!;
  assert.equal(tight.status, 'violated');
  assert.equal(loose.status, 'safe');
  // Structural unemployment is a parameter carried on each step, so a different u* changes the measure.
  const higher = simulate(initial, [], 1, { ...PARAMETERS, structuralUnemployment: .03 }).steps[0];
  near(labour.measure(higher) / labour.measure(base), .03 / .025);
});

test('old employment-share thresholds migrate to the equivalent unemployment floor and clip to the editable range', () => {
  const legacy = defaults();
  legacy.thresholds.labour = .98;
  const raw = '#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.4', form: legacy }));
  const restored = decodeScenarioDetailed(raw);
  near(restored.form.thresholds.labour, .025 / .02);
  assert(restored.filled.some(k => k.startsWith('thresholds.labour')));
  legacy.thresholds.labour = .995;
  const clipped = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.4', form: legacy })));
  assert.equal(clipped.form.thresholds.labour, THRESHOLD_BOUNDS.labour[1]);
  assert(clipped.clipped.includes('thresholds.labour'));
  assert.equal(clipped.sourceVersion, '2026-09-16.4');
});

// 1-B: the multiplier scale moves prices with GDP.
test('multiplier scale rescales the whole published response, so CPI and the envelope move with it', () => {
  const initial = initialEconomy();
  const policy = { ...find('public-investment'), annualCost: 10 * T };
  const full = calibratedResponse(initial, policy, 1, PARAMETERS), half = calibratedResponse(initial, policy, 1, { ...PARAMETERS, multiplierScale: .5 });
  near(half.gdp, full.gdp / 2); near(half.prices, full.prices / 2); near(half.imports, full.imports / 2); near(half.longRate, full.longRate / 2);
  const tax = { ...find('consumption-tax'), annualCost: 3.5 * T };
  const taxFull = calibratedResponse(initial, tax, 1, PARAMETERS), taxHalf = calibratedResponse(initial, tax, 1, { ...PARAMETERS, multiplierScale: .5 });
  // The mechanical direct tax price effect is not a multiplier and stays unscaled.
  near(taxHalf.directTaxPrices, taxFull.directTaxPrices);
  const engine = createFiscalEngine();
  const f = example(), g = example(); g.calibration = { ...g.calibration, multiplierScale: .5 };
  const cpi = (r: ReturnType<typeof engine>) => Math.max(...r.projection.steps.map(s => s.state.macro.inflation));
  const r1 = engine(f), r2 = engine(g);
  assert(cpi(r2) < cpi(r1) - .001);
  assert(r2.estimate.theoreticalMaximum > r1.estimate.theoreticalMaximum * 1.2);
});

// 1-D: horizon-average CPI as an alternative aggregation.
test('average inflation rule compares the horizon mean and is looser than the single-year peak', () => {
  const initial = initialEconomy();
  const path = simulate(initial, [{ ...find('public-investment'), annualCost: 15 * T }], 5, PARAMETERS);
  const peak = peakConstraints(path, THRESHOLDS, 'peak').find(c => c.id === 'inflation')!;
  const average = peakConstraints(path, THRESHOLDS, 'average').find(c => c.id === 'inflation')!;
  assert(average.currentValue < peak.currentValue);
  assert(average.explanation.includes('平均'));
  const f = example(); f.calibration = { ...f.calibration, inflationRule: 'average' };
  const r = createFiscalEngine()(f);
  assert(r.estimate.theoreticalMaximum > 16.79 * T);
});

// 1-C: realized supply inside the horizon is zero by design for non-capital cases.
test('comparison reports realized supply at the horizon: positive for public capital, zero for research and education', () => {
  // Supply cases are attached by the engine from the form; raw POLICIES carry none.
  const rows = createFiscalEngine()(example()).comparison;
  const row = (id: string) => rows.find(r => r.policy.id === id)!;
  assert(compareNextTrillion(initialEconomy(), [], PARAMETERS).every(r => Number.isFinite(r.realizedSupplyEffect)));
  assert(row('public-investment').realizedSupplyEffect > 0);
  assert(row('rd').potentialGdpEffect > 0);
  near(row('rd').realizedSupplyEffect, 0);
  near(row('education').realizedSupplyEffect, 0);
});

// P0: threshold bounds are shared by controls and links; restore info is explicit.
test('thresholds outside the editable domain are clipped with a notice, and current links restore cleanly', () => {
  const form = example();
  form.thresholds.inflation = 5;
  const restored = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: FISCAL_MODEL_VERSION, form })));
  assert.equal(restored.form.thresholds.inflation, THRESHOLD_BOUNDS.inflation[1]);
  assert.deepEqual(restored.clipped, ['thresholds.inflation']);
  const clean = decodeScenarioDetailed(encodeScenario(example()));
  assert.deepEqual([clean.filled, clean.clipped, clean.sourceVersion], [[], [], FISCAL_MODEL_VERSION]);
});

// P1: the primary chart is anchored at zero.
test('difference chart scale always includes zero and nice ticks', () => {
  const up = differenceChartScale([2e12, 5e12, 12e12]);
  assert.equal(up.low, 0); assert(up.high >= 12e12); assert(up.ticks.includes(0));
  const mixed = differenceChartScale([-3.6e12, 12.7e12]);
  assert(mixed.low <= -3.6e12 && mixed.low < 0 && mixed.high >= 12.7e12);
  assert(mixed.ticks.includes(0));
});

// Extended horizon: an explicit extrapolation that lets late commissioning enter the same evaluation.
test('15-year horizon extends the simulation, adds 10/15-year comparison periods and shows late supply', () => {
  const engine = createFiscalEngine();
  const f = defaults(); f.amounts.rd = 3; f.horizon = 15;
  const r = engine(f);
  assert.equal(r.horizon, 15);
  assert.equal(r.projection.steps.length, 15);
  assert.equal(r.riskAudit.extrapolatedYears, 10);
  const rd = r.comparison.find(row => row.policy.id === 'rd')!;
  assert.deepEqual(rd.periods.map(p => p.year), [1, 3, 5, 10, 15]);
  // Non-capital supply ramps only after the published years: zero realized at 5, positive at 15.
  const five = defaults(); five.amounts.rd = 3; five.horizon = 5;
  near(engine(five).comparison.find(row => row.policy.id === 'rd')!.realizedSupplyEffect, 0);
  assert(rd.realizedSupplyEffect > 0);
  assert.equal(r.longRun[0].year, 16);
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(f)).form.horizon, 15);
  const g = defaults(); g.horizon = 5;
  assert.equal(engine(g).projection.steps.length, 5);
});

// Stress-derived envelope replaces the arbitrary percentage haircut.
test('envelope equals the search amount with no stress selected, and the minimum surviving amount when stresses are selected', () => {
  const engine = createFiscalEngine();
  const f = example();
  const none = engine(f);
  near(none.estimate.recommendedEnvelope, none.estimate.theoreticalMaximum);
  assert.equal(none.estimate.reserveRule.method, 'stress-scenarios');
  assert.equal(none.estimate.stress!.length, 4);
  assert(none.estimate.stress!.every(s => !s.selected));
  const energy = none.estimate.stress!.find(s => s.id === 'energyPrice')!;
  assert(energy.amount > 0 && energy.amount < none.estimate.theoreticalMaximum);
  // With a 2.5% ceiling and ~2.05% no-policy CPI, +0.5pt inflation or a 10% yen fall leave no room at all.
  for (const id of ['baselineInflation', 'fx']) assert.equal(none.estimate.stress!.find(s => s.id === id)!.status, 'baseline-violated');
  f.stresses = { ...f.stresses, energyPrice: true };
  const withEnergy = engine(f);
  near(withEnergy.estimate.recommendedEnvelope, energy.amount, 1e-6);
  near(withEnergy.estimate.reserveRule.share, 1 - energy.amount / none.estimate.theoreticalMaximum, 1e-6);
  f.stresses = { ...f.stresses, fx: true };
  near(engine(f).estimate.recommendedEnvelope, 0);
});

test('old links with a percentage reserve migrate to the stress selection and report it', () => {
  const legacy = { ...defaults(), reserve: 20 } as Record<string, unknown>;
  delete legacy.stresses;
  const restored = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.5', form: legacy })));
  assert.deepEqual(restored.form.stresses, { baselineInflation: false, fx: false, energyPrice: false, rate: false });
  assert(restored.filled.some(k => k.startsWith('任意控除20%')));
  assert.equal(restored.form.calibration.reserveShare, 0);
});

// Grid fuel savings are domestic value added and must not vanish behind a Leontief labour bottleneck.
test('grid savings raise potential GDP identically under every production function', () => {
  const engine = createFiscalEngine();
  const potential = new Map<string, number>();
  for (const productionModel of ['leontief', 'ces', 'cobbDouglas'] as const) {
    const f = defaults(); f.amounts.grid = 3; f.horizon = 15; f.calibration = { ...f.calibration, productionModel };
    const r = engine(f);
    const last = r.projection.steps.at(-1)!, base = r.baseline.steps.at(-1)!;
    potential.set(productionModel, last.state.macro.potentialGdp - base.state.macro.potentialGdp);
    assert(r.comparison.find(row => row.policy.id === 'grid')!.realizedSupplyEffect > 0);
  }
  const values = [...potential.values()];
  assert(values.every(v => v > 5e10));
  near(values[0], values[1], 1e-6); near(values[0], values[2], 1e-6);
  const five = defaults(); five.amounts.grid = 3;
  near(engine(five).comparison.find(row => row.policy.id === 'grid')!.realizedSupplyEffect, 0); // Commissions in year 6.
});
