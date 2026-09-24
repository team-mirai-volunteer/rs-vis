import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { defaults } from '../client/lib/fiscal-space-form';
import { encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { encodeSharedScenario, decodeSharedScenario } from '../client/lib/fiscal-space-share';

const packed = (value: unknown) => '#scenario=s1.' + gzipSync(JSON.stringify(value)).toString('base64url');

test('compact sharing keeps all settings and stays short for custom optimization preferences', async () => {
  for (const dataset of ['latest', '2024'] as const) {
    const form = defaults(dataset);
    form.horizon = 15; form.amounts['social-insurance'] = 15;
    form.optimization.aggregation = 'average';
    form.optimization.minBudget = 3; form.optimization.maxBudget = 25;
    for (const [i, objective] of Object.values(form.optimization.objectives).entries()) objective.weight = i * 3;
    form.calibration.insurance!.wagePassThrough = .25;
    const hash = await encodeSharedScenario(form);
    assert(hash.length < 1500, `Unexpectedly long URL: ${hash.length}`);
    assert(hash.length < encodeScenario(form).length / 5);
    assert.match(hash, /^#scenario=s1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual((await decodeSharedScenario(hash)).form, form);
    assert.deepEqual((await decodeSharedScenario(encodeScenario(form))).form, form);
  }
  assert((await encodeSharedScenario(defaults())).length < 150);
});

test('zero, null and removal of optional settings are distinct from frozen defaults', async () => {
  const form = defaults();
  form.trade.power.firmShare = null;
  form.supply.education.educationPisaGain = 0;
  delete form.supply['public-investment'].realizationRate;
  form.calibration.insurance!.enabled = false;
  form.optimization.objectives.gdp.weight = 0;
  assert.deepEqual((await decodeSharedScenario(await encodeSharedScenario(form))).form, form);
});

test('compressed changes still undergo model migration and full input validation', async () => {
  const old = await decodeSharedScenario(packed(['2026-09-24.4', [
    [['calibration', 'insurance']], [['calibration', 'macroTailYears']],
  ]]));
  assert.equal(old.form.calibration.insurance!.enabled, false);
  assert.equal(old.form.calibration.macroTailYears, 0);
  for (const payload of [
    ['unknown', []], [FISCAL_MODEL_VERSION, [[['horizon'], 999]]],
    [FISCAL_MODEL_VERSION, [[['__proto__', 'polluted'], true]]],
    [FISCAL_MODEL_VERSION, [[['constructor', 'prototype'], {}]]],
    [FISCAL_MODEL_VERSION, [[['no-such-parent', 'key'], 1]]],
    [FISCAL_MODEL_VERSION, [[[], {}]]], [FISCAL_MODEL_VERSION, 'invalid'],
    [FISCAL_MODEL_VERSION, [[['dataset'], 'x'.repeat(60_000)]]],
  ]) await assert.rejects(decodeSharedScenario(packed(payload)));
  for (const hash of ['#scenario=s1.bad!', '#scenario=s1.A', '#scenario=s2.abc', '#scenario=invalid'])
    await assert.rejects(decodeSharedScenario(hash));
  const valid = await encodeSharedScenario(defaults());
  await assert.rejects(decodeSharedScenario(valid.slice(0, -5)));
  const bad = defaults(); bad.optimization.objectives.gdp.weight = 101;
  await assert.rejects(encodeSharedScenario(bad));
});
