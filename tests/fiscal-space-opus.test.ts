import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenario, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';
import { initialEconomy, PARAMETERS as P, POLICIES, THRESHOLDS, NO_SHOCK, TRILLION as T } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { auditFiscalSpace } from '../app/lib/fiscal-space/risk-audit';
import { powerCase } from '../app/lib/fiscal-space/policy-trade';
import { compareNextTrillion, rateShockComparison } from '../app/lib/fiscal-space/compare';
import { longRunScenario, LONG_RUN } from '../app/lib/fiscal-space/long-run';
import { money, percent, points } from '../client/components/fiscal-space/format';

test('neutral defaults and complete shared scenarios round-trip both datasets and optional project settings', () => {
  for (const dataset of ['2024', 'latest'] as const) {
    const form = defaults(dataset);
    assert(Object.values(form.amounts).every(v => v === 0));
    assert.equal(form.calibration.hoursElasticity, P.hoursElasticity);
    assert.deepEqual(decodeScenario(encodeScenario(form)), form);
    form.amounts['public-investment'] = 10;
    form.loads['public-investment'] = { sectorUtilizationPerTrillion: .01, peakGwPerTrillion: .2, operatingPeakGwPerTrillion: .3, lag: 2, lifetime: 30, depreciation: .04 };
    form.trade.mix = { solar: 2, nuclear: 1, hydro: 0 };
    form.trade.powerCases = { solar: powerCase('solar'), nuclear: powerCase('nuclear'), hydro: powerCase('hydro') };
    form.calibration.taxCollectionLag = 2;
    assert.deepEqual(decodeScenario(encodeScenario(form)), form);
  }
});

test('shared scenarios reject foreign versions, unknown keys, malformed types and unbounded search work', () => {
  const raw = (form: unknown, version = FISCAL_MODEL_VERSION) => '#scenario=' + encodeURIComponent(JSON.stringify({ version, form }));
  assert.throws(() => decodeScenario(raw(defaults(), 'old')));
  assert.throws(() => decodeScenario(raw({ ...defaults(), amounts: { nope: 1 } })));
  assert.throws(() => decodeScenario(raw({ ...defaults(), gap: 'NaN' })));
  assert.throws(() => decodeScenario(raw({ ...defaults(), inputs: { ...defaults().inputs, labour: 0 } })));
  assert.throws(() => decodeScenario(raw({ ...defaults(), calibration: { ...P, searchTolerance: 1e-50 } })));
  assert.throws(() => decodeScenario('#scenario=' + 'x'.repeat(50001)));
  const polluted = JSON.parse(JSON.stringify(defaults()).replace('"amounts":{', '"amounts":{"__proto__":{},'));
  assert.throws(() => decodeScenario(raw(polluted)));
});

test('tax revenue elasticity and collection lag alter fiscal paths while preserving the accounting identity', () => {
  const s = initialEconomy('latest');
  const policy = { ...POLICIES.find(x => x.id === 'public-investment')!, annualCost: 10 * T };
  const paths = [0, 1, 2].map(taxCollectionLag => simulate(s, [policy], 5, { ...P, taxCollectionLag }));
  assert(paths[0].steps[0].state.fiscal.taxRevenue > paths[1].steps[0].state.fiscal.taxRevenue);
  assert.equal(paths[1].steps[0].state.fiscal.taxRevenue, s.fiscal.taxRevenue);
  assert.equal(paths[2].steps[1].state.fiscal.taxRevenue, s.fiscal.taxRevenue);
  const flat = simulate(s, [policy], 5, { ...P, taxRevenueElasticity: 0 });
  assert(flat.steps.every(x => x.state.fiscal.taxRevenue === s.fiscal.taxRevenue));
  for (const path of paths) for (const step of path.steps) {
    const f = step.state.fiscal;
    assert(Math.abs(f.primaryBalance - (f.taxRevenue + f.otherPrimaryRevenue - f.primaryExpenditure)) < 1);
  }
  const p = { ...P, taxCollectionLag: 2, taxRevenueElasticity: 1.2 };
  const short = simulate(s, [policy], 5, p), base = simulate(s, [], 5, p);
  const long = longRunScenario(s, [policy], short, base, p, LONG_RUN);
  assert(long.every(x => Number.isFinite(x.debtGdp)));
  assert(longRunScenario(s, [], base, base, p, LONG_RUN).every(x => x.debtGdp === x.baselineDebtGdp));
  assert.equal(points(-1e-12), points(1e-12));
  assert.equal(percent(-1e-12), percent(1e-12));
  assert.equal(money(-1e-12), money(1e-12));
  assert.throws(() => simulate(s, [], 1, { ...P, taxCollectionLag: .5 }));
});

test('the three-year reference never returns extrapolated five-year comparison or funding results', () => {
  const p = { ...P, referenceModel: 'esri2022' as const };
  for (const row of compareNextTrillion(initialEconomy(), [], p)) {
    assert.deepEqual(row.periods.map(x => x.year), [1, 3]);
    assert.equal(row.debtGdpAtHorizon, row.periods[1].debtGdp);
  }
  assert(rateShockComparison(initialEconomy(), [], p).every(x => x.years.every(y => y.year <= 3)));
});

test('the envelope audit exposes withdrawal GDP, actual peak year and a conditional CPI approximation', () => {
  const initial = initialEconomy('latest');
  const policy = { ...POLICIES.find(x => x.id === 'public-investment')!, duration: 3, annualCost: T };
  const mix = [{ policy, weight: 1 }];
  const estimate = estimateFiscalSpace(initial, mix, THRESHOLDS, 5, P);
  const audit = auditFiscalSpace(initial, mix, estimate, THRESHOLDS, 5, P, NO_SHOCK);
  assert(audit.terminalGdpEffect < 0);
  assert.equal(audit.cpi.year, 2);
  assert(audit.cpiApproximation && audit.cpiApproximation.slope > 0);
  const blocked = estimateFiscalSpace(initialEconomy('2024'), mix, THRESHOLDS, 5, P);
  assert.equal(blocked.status, 'baseline-violated');
  assert(blocked.constraints.some(x => x.id === 'inflation' && x.year === 0 && x.status === 'violated'));
});
