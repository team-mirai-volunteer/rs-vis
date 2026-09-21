import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY_DEFAULTS, CAPACITY_DATA, calibrateCapacity } from '../app/lib/fiscal-space/capacity-calibration';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { encodeScenario, decodeScenarioDetailed, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';

const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test('capacity calibration adds hours without double-counting employed people', () => {
  const form = defaults();
  const noSlack = { ...CAPACITY_DEFAULTS, mode: 'estimated' as const, unemployedRealization: 0, potentialRealization: 0, extraWeeklyHours: 0, equipmentRecovery: 0 };
  const zero = calibrateCapacity(noSlack, form.inputs);
  near(zero.inputs.labour, 1); near(zero.inputs.capital, 1);
  const hoursOnly = calibrateCapacity({ ...noSlack, extraWeeklyHours: 5 }, form.inputs);
  near(hoursOnly.inputs.labour, 1 + 190e4 * 5 / 23.72e8);
  const potentialOnly = calibrateCapacity({ ...noSlack, potentialRealization: 1 }, form.inputs);
  near(potentialOnly.inputs.labour, 1 + 33e4 * 30 / CAPACITY_DATA.weeklyHours);
  near(hoursOnly.inputs.energy, form.inputs.energy); near(hoursOnly.inputs.materials, form.inputs.materials);
});
test('equipment uses an index ratio and realization weights, not 100 minus the index', () => {
  const c = { ...CAPACITY_DEFAULTS, mode: 'estimated' as const, manufacturingWeight: 1 };
  const inputs = defaults().inputs;
  near(calibrateCapacity(c, inputs).inputs.capital, 108.1 / 101.4);
  near(calibrateCapacity({ ...c, manufacturingWeight: 0 }, inputs).inputs.capital, 1);
  near(calibrateCapacity({ ...c, equipmentRecovery: .5 }, inputs).inputs.capital, 1 + (108.1 / 101.4 - 1) / 2);
  assert.deepEqual(calibrateCapacity(CAPACITY_DEFAULTS, inputs).inputs, inputs);
  assert.throws(() => calibrateCapacity({ ...c, newWorkerHours: NaN }, inputs));
  assert.throws(() => calibrateCapacity({ ...c, potentialRealization: 1.1 }, inputs));
});
test('reference calibration reaches production and constraints with correct GDP normalization', () => {
  const form = defaults('2024');
  form.capacity.mode = 'estimated'; form.gap = -5;
  const engine = createFiscalEngine();
  const result = engine(form);
  const preview = calibrateCapacity(form.capacity, form.inputs, .95);
  assert.deepEqual(result.initial.production.inputs, preview.inputs);
  near(result.projection.initial.production.maximum / result.initial.macro.realGdp, 1 + .2 * (108.1 / 101.4 - 1));
  const manual = engine({ ...form, capacity: { ...form.capacity, mode: 'manual' } });
  assert(result.projection.steps[0].production.maximum < manual.projection.steps[0].production.maximum);
  assert.notEqual(result.constraints.find(c => c.id === 'capacity')?.currentValue, manual.constraints.find(c => c.id === 'capacity')?.currentValue);
  assert(result.records.some(r => r.key === 'capacity.capital' && r.status === 'estimated'));
});
test('calibration settings round-trip and old URLs preserve their manual indices', () => {
  const form = defaults(); form.capacity.mode = 'estimated'; form.capacity.extraWeeklyHours = 8;
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(form)).form.capacity, form.capacity);
  const legacy = JSON.parse(JSON.stringify(form)); delete legacy.capacity;
  const hash = (version: string) => '#scenario=' + encodeURIComponent(JSON.stringify({ version, form: legacy }));
  const restored = decodeScenarioDetailed(hash('2026-09-21.1'));
  assert.equal(restored.form.capacity.mode, 'manual'); assert.deepEqual(restored.form.inputs, form.inputs);
  assert(restored.filled.some(s => s.startsWith('capacity')));
  assert.throws(() => decodeScenarioDetailed(hash(FISCAL_MODEL_VERSION)));
  form.capacity.extraWeeklyHours = 21;
  assert.throws(() => decodeScenarioDetailed(encodeScenario(form)));
});
