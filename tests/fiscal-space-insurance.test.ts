import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { SOCIAL_INSURANCE_REVENUE as revenue, socialInsuranceLimit } from '../app/lib/fiscal-space/policy-limits';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { defaults } from '../client/lib/fiscal-space-form';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';

const policy = POLICIES.find(p => p.id === 'social-insurance')!;

test('insurance relief cannot exceed either contributor base, including split endpoints and duplicate policies', () => {
  assert.equal(revenue.total, 83_042_600_000_000);
  assert.equal(socialInsuranceLimit(PARAMETERS), 78_732_200_000_000);
  assert.equal(socialInsuranceLimit({ ...PARAMETERS, employeeReliefShare: 1 }), 43_676_500_000_000);
  assert.equal(socialInsuranceLimit({ ...PARAMETERS, employeeReliefShare: 0 }), 39_366_100_000_000);
  const proportional = socialInsuranceLimit({ ...PARAMETERS, employeeReliefShare: revenue.insured / revenue.total });
  assert(Math.abs(proportional - revenue.total) < 1);
  assert.throws(() => simulate(initialEconomy('latest'), [{ ...policy, annualCost: 100e12 }], 5), /revenue base/);
  assert.throws(() => simulate(initialEconomy('latest'), [{ ...policy, annualCost: 40e12 }, { ...policy, annualCost: 40e12 }], 5), /revenue base/);
  assert.doesNotThrow(() => simulate(initialEconomy('latest'), [{ ...policy, annualCost: 78_732_200_000_000 }], 5));
});

test('loose macro constraints still stop the fixed-share search at the insurance revenue base', () => {
  const thresholds = Object.fromEntries(Object.keys(THRESHOLDS).map(key => [key, 100])) as typeof THRESHOLDS;
  const r = estimateFiscalSpace(initialEconomy('latest'), [{ policy, weight: 1 }], thresholds, 5);
  assert.equal(r.status, 'revenue-cap');
  assert.equal(r.limitingPolicy, 'social-insurance');
  assert.equal(r.theoreticalMaximum, 78_732_200_000_000);
  assert.equal(r.recommendedEnvelope, 62_985_760_000_000);
});

test('worker clamps over-limit input and omits an impossible extra trillion; shared URLs reject it', () => {
  const form = defaults();
  form.amounts['social-insurance'] = 100;
  assert.throws(() => decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version: FISCAL_MODEL_VERSION, form }))));
  const r = createFiscalEngine()(form);
  assert.equal(r.totalYen, 78_700_000_000_000);
  assert.equal(r.allocated[0].annualCost, 78_700_000_000_000);
  assert(r.comparison.every(row => row.policy.id !== 'social-insurance'));
  assert(r.sensitivity.every(row => row.delta === null));
  assert(r.records.some(row => row.key === 'insuranceRevenue.total' && row.status === 'verified'));
});
