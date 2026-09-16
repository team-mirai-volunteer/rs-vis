import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, encodeScenario } from '../client/lib/fiscal-space-url';

test('solar short-build case supplies power in year 2, while construction and later supply remain distinct', () => {
  const form = defaults(); form.amounts.generation = 1;
  form.policySettings.generation.duration = 1;
  const engine = createFiscalEngine();
  const result = engine(form);
  assert.equal(form.trade.power.lag, 1);
  assert.equal(result.powerTimeline[0].generationSupplyGw, 0);
  assert(result.powerTimeline[0].extraDemandGw > 0);
  assert(result.powerTimeline[1].generationSupplyGw > 0);
  assert(result.powerTimeline[1].utilization < result.powerTimeline[1].baselineUtilization);
  assert(result.powerTimeline[4].generationSupplyGw > 0, 'supply survives the end of investment spending');
  form.trade.power.lag = 0;
  assert(engine(form).powerTimeline[0].generationSupplyGw > 0, 'same-year deployment is an explicit scenario');
  form.trade.power.lag = 2;
  const slow = engine(form);
  assert.equal(slow.powerTimeline[1].generationSupplyGw, 0);
  assert(slow.powerTimeline[2].generationSupplyGw > 0);
  const restored = decodeScenario(encodeScenario(form));
  assert.equal(restored.trade.power.lag, 2, 'saved project schedules are retained');
});
