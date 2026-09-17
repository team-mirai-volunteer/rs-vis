import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEconomy, PARAMETERS as P, POLICIES, THRESHOLDS, TRILLION as T, NO_SHOCK } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { projectRevenueComponents, reliefComponent } from '../app/lib/fiscal-space/revenue';
import { applyStressReserve, combinedStressEnvelope, DEFAULT_STRESSES } from '../app/lib/fiscal-space/stress-envelope';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { decodeScenarioDetailed, encodeScenario } from '../client/lib/fiscal-space-url';
import { defaults } from '../client/lib/fiscal-space-form';
import { estimatePolicyLoad, RESOURCE_DEFAULTS } from '../app/lib/fiscal-space/resource-estimate';

const near = (a: number, b: number, tol = 1e-9) => assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const preset = (id: string, over: Record<string, unknown> = {}) => ({ ...POLICIES.find(p => p.id === id)!, annualCost: T, ...over });

test('initial revenue components reconcile to the total in both datasets', () => {
  for (const dataset of ['2024', 'latest'] as const) {
    const s = initialEconomy(dataset);
    near(s.fiscal.taxes + s.fiscal.socialContributions, s.fiscal.taxRevenue);
    assert(s.fiscal.taxes > s.fiscal.socialContributions);
  }
  assert.equal(reliefComponent('social-insurance'), 'socialContributions');
  for (const id of ['income-tax', 'resident-tax', 'consumption-tax']) assert.equal(reliefComponent(id), 'taxes');
});

test('components grow with their own elasticity and the total is their sum along the path', () => {
  const s = initialEconomy();
  const p = { ...P, taxRevenueElasticity: 1.3, socialContributionElasticity: .8 };
  const path = simulate(s, [preset('social-insurance', { annualCost: 2 * T }), preset('consumption-tax', { annualCost: T })], 5, p);
  for (const step of path.steps) {
    const ratio = step.state.macro.nominalGdp / s.macro.nominalGdp;
    const expected = projectRevenueComponents(s.fiscal, s.macro.nominalGdp, step.state.macro.nominalGdp,
      { taxes: 1.3, socialContributions: .8 }, { taxes: T, socialContributions: 2 * T });
    near(step.state.fiscal.taxes, expected.taxes); near(step.state.fiscal.socialContributions, expected.socialContributions);
    near(step.state.fiscal.taxRevenue, expected.total);
    near(step.state.fiscal.socialContributions, s.fiscal.socialContributions * ratio ** .8 - 2 * T);
  }
  // A lower contribution elasticity lowers the total for the same nominal path.
  const higher = simulate(s, [], 5, { ...p, socialContributionElasticity: 1.3 });
  assert(higher.steps[4].state.fiscal.taxRevenue > path.steps[4].state.fiscal.taxRevenue);
  assert.throws(() => simulate(s, [], 1, { ...p, socialContributionElasticity: -1 }), RangeError);
  assert.throws(() => simulate({ ...s, fiscal: { ...s.fiscal, taxes: s.fiscal.taxes + T } }, [], 1, p), RangeError);
});

test('combined stress survives less than or equal to each selected stress and is absent below two selections', () => {
  const s = initialEconomy('latest');
  const p = { ...P, searchStep: 5 * T, searchTolerance: .5 * T, resourceModel: RESOURCE_DEFAULTS };
  const withLoad = (id: string) => { const policy = preset(id); return { ...policy, load: estimatePolicyLoad(policy, s, RESOURCE_DEFAULTS) }; };
  const mix = [{ policy: withLoad('cash'), weight: 1 }, { policy: withLoad('public-investment'), weight: 1 }];
  const loose = { ...THRESHOLDS, inflation: .03 };
  const base = estimateFiscalSpace(s, mix, loose, 3, p, NO_SHOCK);
  assert.equal(base.status, 'boundary');
  const one = applyStressReserve(s, mix, base, loose, 3, p, NO_SHOCK, { ...DEFAULT_STRESSES, energyPrice: true });
  assert.equal(one.combinedStress, undefined);
  assert(!Object.hasOwn(one, 'combinedStress'));
  const two = applyStressReserve(s, mix, base, loose, 3, p, NO_SHOCK, { ...DEFAULT_STRESSES, energyPrice: true, rate: true });
  assert(two.combinedStress);
  assert.deepEqual(two.combinedStress.scenarios, ['energyPrice', 'rate']);
  assert(two.combinedStress.amount <= two.recommendedEnvelope + 1);
  for (const row of two.stress.filter(r => r.selected)) assert(two.combinedStress!.amount <= row.amount + 1);
  // The recommended envelope stays the per-stress minimum; the joint amount is reported beside it.
  near(two.recommendedEnvelope, Math.min(base.theoreticalMaximum, ...two.stress.filter(r => r.selected).map(r => r.amount)), 1e-12);
  const direct = combinedStressEnvelope(s, mix, loose, 3, p, NO_SHOCK, { importPrice: true, energyPrice: true, rate: true }, base.theoreticalMaximum);
  assert(direct.amount <= base.theoreticalMaximum + 1);
  assert.deepEqual(direct.scenarios, ['importPrice', 'energyPrice', 'rate']);
  // Reaching the cap leaves no binding; otherwise the joint label names every stress on the path.
  if (direct.amount < base.theoreticalMaximum - 1) assert.equal(direct.binding, '輸入物価+3%＋エネルギー+20%＋金利+100bp');
});

test('shared links from 2026-09-16.6 carry the single elasticity into the contribution elasticity', () => {
  const form = defaults();
  form.calibration.taxRevenueElasticity = 1.1;
  const legacy = structuredClone(form) as unknown as { calibration: Record<string, unknown> };
  delete legacy.calibration.socialContributionElasticity;
  const hash = '#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-16.6', form: legacy }));
  const restored = decodeScenarioDetailed(hash);
  assert.equal(restored.form.calibration.socialContributionElasticity, 1.1);
  assert(restored.filled.some(f => f.startsWith('calibration.socialContributionElasticity')));
  // Current links round-trip with both values.
  form.calibration.socialContributionElasticity = .9;
  assert.equal(decodeScenarioDetailed(encodeScenario(form)).form.calibration.socialContributionElasticity, .9);
});
