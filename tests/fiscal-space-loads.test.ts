import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_PROJECT_BASIS, loadFromProject, loadCoverage, policyLoads } from '../app/lib/fiscal-space/policy-load';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { peakConstraints } from '../app/lib/fiscal-space/constraints';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenario, encodeScenario } from '../client/lib/fiscal-space-url';
import type { PolicyLoad } from '../types/fiscal-space';

const unknown: PolicyLoad = {
  sectorUtilizationPerTrillion: null, peakGwPerTrillion: null,
  operatingPeakGwPerTrillion: null, lag: 2, lifetime: 20, depreciation: .03,
};
const policy = POLICIES.find(p => p.id === 'public-investment');
assert(policy);

test('load coverage distinguishes missing, partial and explicitly zero assumptions', () => {
  assert.deepEqual(loadCoverage(undefined), { sector: false, energy: false });
  assert.deepEqual(loadCoverage(unknown), { sector: false, energy: false });
  assert.deepEqual(loadCoverage({ ...unknown, sectorUtilizationPerTrillion: 0 }), { sector: true, energy: false });
  assert.deepEqual(loadCoverage({ ...unknown, peakGwPerTrillion: 0 }), { sector: false, energy: false });
  assert.deepEqual(loadCoverage({ ...unknown, peakGwPerTrillion: 0, operatingPeakGwPerTrillion: 0 }), { sector: false, energy: true });
});

test('the marginal comparison also labels unknown loads instead of ranking them as zero', () => {
  const candidate = { ...policy, annualCost: 1e12, load: { ...unknown, sectorUtilizationPerTrillion: .01 } };
  const [row] = compareNextTrillion(initialEconomy('latest'), [], PARAMETERS, undefined, THRESHOLDS, [candidate]);
  assert(row.mainCapacity.includes('電力の追加負荷は未評価'));
  assert(!row.mainCapacity.includes('産業・電力の追加負荷は未評価'));
  assert(row.mainCapacity.includes('ポイント'));
});

test('project units convert to pure additional per-trillion loads without double counting peak demand', () => {
  const basis = { ...EMPTY_PROJECT_BASIS, budgetTrillion: 2, workerYears: 10000,
    sectorWorkerCapacity: 500000, constructionPeakMw: 1000, annualOperatingGwh: 8760 };
  assert.deepEqual(loadFromProject(basis), {
    sectorUtilizationPerTrillion: .01, peakGwPerTrillion: .5, operatingPeakGwPerTrillion: null,
  });
  const complete = { ...basis, annualLoadFactor: .5, peakCoincidence: .75 };
  assert.equal(loadFromProject(complete).operatingPeakGwPerTrillion, .75);
  assert.equal(loadFromProject({ ...complete, operatingPeakMw: 400 }).operatingPeakGwPerTrillion, .2);
  for (const invalid of [{ budgetTrillion: 0 }, { annualLoadFactor: 0 }, { peakCoincidence: 2 }, { sectorWorkerCapacity: 0 }]) {
    assert.throws(() => loadFromProject({ ...basis, ...invalid }));
  }
});

test('known partial loads affect constraints while unknown remaining loads stay unevaluated', () => {
  const initial = initialEconomy('latest');
  const p = { ...policy, annualCost: 1e12, load: { ...unknown, peakGwPerTrillion: 1000 } };
  const loads = policyLoads(initial, [p], 1, PARAMETERS);
  assert(loads.peakGw > 900);
  assert.deepEqual(loads.coverage, { sector: false, energy: false });
  const constraints = peakConstraints(simulate(initial, [p], 5, PARAMETERS), THRESHOLDS);
  assert(constraints.some(c => c.id === 'energy' && c.status === 'violated'));
  assert(constraints.some(c => c.id === 'sector' && c.status === 'unevaluated'));
});

test('project vintages enter after the stated lag and are identical to equivalent explicit coefficients', () => {
  const initial = initialEconomy('latest');
  const basis = { ...EMPTY_PROJECT_BASIS, budgetTrillion: 2, workerYears: 10000,
    sectorWorkerCapacity: 500000, constructionPeakMw: 1000, operatingPeakMw: 400 };
  const project = { ...policy, duration: 1, annualCost: 2e12, load: { ...unknown, basis } };
  const direct = { ...project, load: { ...unknown, ...loadFromProject(basis) } };
  for (const year of [1, 2, 3, 4, 25]) {
    assert.deepEqual(policyLoads(initial, [project], year, PARAMETERS), policyLoads(initial, [direct], year, PARAMETERS));
  }
  assert.equal(policyLoads(initial, [project], 2, PARAMETERS).peakGw, 0);
  assert(policyLoads(initial, [project], 3, PARAMETERS).peakGw > 0);
  assert.equal(policyLoads(initial, [project], 25, PARAMETERS).peakGw, 0);
});

test('shared scenarios preserve unknowns and project basis, accept old coefficients and reject invalid conversions', () => {
  const form = defaults();
  form.loads['public-investment'] = { ...unknown, basis: { ...EMPTY_PROJECT_BASIS, annualOperatingGwh: 8760 } };
  assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  const legacy = defaults();
  legacy.loads['public-investment'] = { ...unknown, sectorUtilizationPerTrillion: .01, peakGwPerTrillion: .2, operatingPeakGwPerTrillion: .3 };
  const raw = '#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-15.2', form: legacy }));
  assert.deepEqual(decodeScenario(raw), legacy);
  form.loads['public-investment'].basis = { ...EMPTY_PROJECT_BASIS, annualLoadFactor: 0 };
  assert.throws(() => encodeScenario(form));
});
