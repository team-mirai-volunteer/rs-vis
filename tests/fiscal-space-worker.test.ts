import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as tick } from 'node:timers/promises';
import { createFiscalEngine, type FiscalWorkerRequest, type FiscalWorkerResponse } from '../client/lib/fiscal-space-engine';
import { defaults, type FiscalForm } from '../client/lib/fiscal-space-form';
import { createFiscalWorkerClient, type FiscalWorkerPort } from '../client/lib/fiscal-worker-client';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';

const calculate = createFiscalEngine();
const zero = calculate(defaults());

test('worker engine preserves domain calculations, transport and published horizons', () => {
  for (const dataset of ['latest', '2024'] as const) {
    const form = defaults(dataset);
    form.amounts['public-investment'] = 10;
    const result = calculate(form);
    assert.deepEqual(result.projection, simulate(result.initial, result.allocated, 5, result.p));
    const searched = estimateFiscalSpace(result.initial,
      result.policies.map(policy => ({ policy, weight: policy.annualCost })), form.thresholds, result.horizon, result.p);
    // The engine layers stress rows on the searched estimate; the search itself is unchanged.
    assert.deepEqual({ ...result.estimate, stress: undefined, reserveRule: undefined }, { ...searched, stress: undefined, reserveRule: undefined });
    assert.equal(result.estimate.reserveRule.method, 'stress-scenarios');
    assert.deepEqual(structuredClone(result), result);
    assert(result.durationSensitivity[2].gdpEffect < 0);
    assert(result.durationSensitivity[4].gdpEffect > 0);
    assert.equal(result.durationSensitivity[2].cost, 30e12);
    form.calibration.referenceModel = 'esri2022';
    const short = calculate(form);
    assert.equal(short.horizon, 3);
    assert.equal(short.durationSensitivity.length, 3);
    assert(short.comparison.every(row => row.periods.every(period => period.year <= 3)));
  }
});

test('amount changes reuse single-policy bounds; economic assumptions invalidate them', () => {
  const engine = createFiscalEngine(), form = defaults();
  const before = engine(form);
  const after = engine({ ...form, amounts: { ...form.amounts, 'public-investment': 10 } });
  assert.equal(before.comparison[0].space, after.comparison[0].space);
  assert.notEqual(before.totalYen, after.totalYen);
  const changed = engine({ ...form, gap: -5 });
  assert.notEqual(after.comparison[0].space, changed.comparison[0].space);
});

function harness(timeout?: number) {
  const sent: FiscalWorkerRequest[] = [], results: FiscalForm[] = [], errors: string[] = [];
  let terminated = 0;
  const port: FiscalWorkerPort = {
    postMessage: request => { sent.push(request); }, terminate: () => { terminated++; },
    onmessage: null, onerror: null, onmessageerror: null,
  };
  const client = createFiscalWorkerClient(port, {
    result: form => { results.push(form); }, error: kind => { errors.push(kind); },
  }, 0, timeout);
  const receive = (data: FiscalWorkerResponse) => port.onmessage?.({ data } as MessageEvent<FiscalWorkerResponse>);
  return { port, client, sent, results, errors, receive, terminated: () => terminated };
}

test('worker queue keeps one running and one latest job, suppressing stale successes and failures', async () => {
  for (const staleOk of [true, false]) {
    const h = harness(), a = defaults(), b = defaults(), c = defaults();
    h.client.submit(a); await tick(5);
    h.client.submit(b); h.client.submit(c); await tick(5);
    assert.equal(h.sent.length, 1);
    h.receive({ id: 999, ok: true, result: zero });
    assert.equal(h.sent.length, 1);
    h.receive(staleOk ? { id: 1, ok: true, result: zero } : { id: 1, ok: false, error: 'calculation' });
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1].form, c);
    assert.deepEqual(h.results, []); assert.deepEqual(h.errors, []);
    h.receive({ id: 3, ok: true, result: zero });
    assert.deepEqual(h.results, [c]);
    h.client.dispose();
  }
});

test('calculation errors allow editing; transport errors terminate; disposal cancels queued work', async () => {
  const h = harness();
  h.client.submit(defaults()); await tick(5);
  h.receive({ id: 1, ok: false, error: 'calculation' });
  assert.deepEqual(h.errors, ['calculation']);
  h.client.submit(defaults()); await tick(5);
  h.receive({ id: 2, ok: true, result: zero });
  assert.equal(h.results.length, 1);
  h.port.onmessageerror?.({} as MessageEvent);
  assert.deepEqual(h.errors, ['calculation', 'worker']);
  assert.equal(h.terminated(), 1);
  h.client.submit(defaults()); await tick(5);
  assert.equal(h.sent.length, 2);
  const disposed = harness();
  disposed.client.submit(defaults()); disposed.client.dispose(); await tick(5);
  assert.equal(disposed.sent.length, 0);
  assert.equal(disposed.port.onmessage, null);
});

test('synchronous transport failure is reported without losing the editable form', async () => {
  const h = harness();
  h.port.postMessage = () => { throw new Error('worker unavailable'); };
  h.client.submit(defaults()); await tick(5);
  assert.deepEqual(h.errors, ['worker']);
  assert.equal(h.terminated(), 1);
});

test('unresponsive worker times out despite newer inputs; late replies cannot publish', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(1000);
  h.client.submit(defaults()); t.mock.timers.tick(1);
  const lateReply = h.port.onmessage!;
  t.mock.timers.tick(700);
  h.client.submit(defaults()); t.mock.timers.tick(301);
  assert.deepEqual(h.errors, ['timeout']);
  assert.equal(h.terminated(), 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.port.onmessage, null);
  lateReply({ data: { id: 1, ok: true, result: zero } } as MessageEvent<FiscalWorkerResponse>);
  assert.equal(h.results.length, 0);
  h.client.dispose(); t.mock.timers.tick(5000);
  assert.equal(h.terminated(), 1);
  assert.deepEqual(h.errors, ['timeout']);
});

test('watchdog clears on completion/disposal and restarts for each actual job', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(1000);
  h.client.submit(defaults()); t.mock.timers.tick(1);
  t.mock.timers.tick(800);
  h.receive({ id: 1, ok: true, result: zero });
  t.mock.timers.tick(5000);
  assert.deepEqual(h.errors, []);
  h.client.submit(defaults()); t.mock.timers.tick(1);
  t.mock.timers.tick(800);
  assert.deepEqual(h.errors, []);
  h.client.dispose(); t.mock.timers.tick(5000);
  assert.deepEqual(h.errors, []);
  assert.equal(h.terminated(), 1);
});
