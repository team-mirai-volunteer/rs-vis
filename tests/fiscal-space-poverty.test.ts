import test from 'node:test';
import assert from 'node:assert/strict';
import { povertyScenario, povertyMeasures, cashTaperWeight, POVERTY_DEFAULTS, POVERTY_DATA } from '../app/lib/fiscal-space/poverty';
import { POLICIES } from '../app/lib/fiscal-space/assumptions';
import { PERSONAL_TAX_REVENUE, SOCIAL_INSURANCE_REVENUE } from '../app/lib/fiscal-space/policy-limits';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenarioDetailed, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';

const near = (a: number, b: number, tolerance = 1e-10) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const policy = (id: string, amount = 1e12) => ({ ...POLICIES.find(p => p.id === id)!, annualCost: amount });

test('no policy reproduces published poverty rates in each year and sensitivity case', () => {
  const result = povertyScenario([], 5, POVERTY_DEFAULTS, .5);
  near(result.baseline.all, POVERTY_DATA.allPovertyRate);
  near(result.baseline.child, POVERTY_DATA.childPovertyRate);
  near(result.baseline.povertyLine, POVERTY_DATA.publishedMedian / 2, .01);
  for (const r of result.rows) {
    near(r.all, .15); near(r.child, .11); near(r.range.all.min, .15); near(r.range.child.max, .11);
    near(r.allocated, 0);
  }
});

test('cash conserves the budget, targeting matters, and temporary grants do not accumulate', () => {
  const run = (cashTarget: 'universal' | 'low-income' | 'children' | 'income-tapered') => povertyScenario([policy('cash')], 5, { ...POVERTY_DEFAULTS, cashTarget }, .5);
  const universal = run('universal'), targeted = run('low-income'), kids = run('children'), tapered = run('income-tapered');
  for (const r of [universal, targeted, kids, tapered]) {
    near(r.rows[0].allocated, 1e12, 1);
    assert(r.rows[0].anchoredAll < r.baseline.all);
    near(r.rows[0].all, r.rows[2].all);
    near(r.rows[3].all, r.baseline.all);
    near(r.rows[4].child, r.baseline.child);
  }
  assert(targeted.rows[0].all < universal.rows[0].all);
  assert(kids.rows[0].child < universal.rows[0].child);
});

test('cash share and employee share gate direct effects; unsupported channels stay unestimated', () => {
  const childcare = povertyScenario([policy('childcare', 2e12)], 5, { ...POVERTY_DEFAULTS, childcareCashShare: .25 }, .5);
  near(childcare.rows[4].allocated, .5e12, 1);
  const off = povertyScenario([policy('childcare'), policy('social-insurance'), policy('consumption-tax'), policy('public-investment')], 5,
    { ...POVERTY_DEFAULTS, childcareCashShare: 0 }, 0);
  near(off.rows[0].allocated, 0);
  near(off.rows[0].all, off.baseline.all);
  near(off.rows[0].activeBudget, 4e12);
  const insurance = povertyScenario([policy('social-insurance', 2e12)], 5, POVERTY_DEFAULTS, .25);
  near(insurance.rows[0].allocated, .5e12, 1);
});

test('proportional tax cuts conserve national totals and stop at liability caps', () => {
  for (const [id, cap] of [
    ['income-tax', PERSONAL_TAX_REVENUE['income-tax'].amount],
    ['resident-tax', PERSONAL_TAX_REVENUE['resident-tax'].amount],
    ['social-insurance', SOCIAL_INSURANCE_REVENUE.insured],
  ] as const) {
    const small = povertyScenario([policy(id)], 1, POVERTY_DEFAULTS, 1).rows[0];
    near(small.allocated, 1e12, 1);
    const capped = povertyScenario([policy(id, cap * 2)], 1, POVERTY_DEFAULTS, 1).rows[0];
    near(capped.allocated, cap, 1);
    assert(capped.all >= 0 && capped.all <= 1 && capped.child >= 0 && capped.child <= 1);
  }
});

test('relative poverty recomputes its median; anchored poverty retains the baseline threshold', () => {
  const cells = [{ lower: 0, upper: 400, people: 100, children: 20 }];
  const before = povertyMeasures(cells, 100);
  near(before.povertyLine, 100);
  near(before.all, .25);
  const scaled = povertyMeasures([{ ...cells[0], upper: 800 }], 100);
  near(scaled.all, before.all);
  near(scaled.anchoredAll, .125);
  const shifted = povertyMeasures([{ ...cells[0], lower: 100, upper: 500 }], 100);
  near(shifted.povertyLine, 150); near(shifted.all, .125); near(shifted.anchoredAll, 0);
});

test('poverty choices round-trip, migrate with a notice and reject invalid input', () => {
  const form = defaults();
  form.poverty = { cashTarget: 'low-income', childcareCashShare: .4 };
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(form)).form.poverty, form.poverty);
  const legacy = JSON.parse(JSON.stringify(form)); delete legacy.poverty;
  const hash = (version: string, value = legacy) => '#scenario=' + encodeURIComponent(JSON.stringify({ version, form: value }));
  const restored = decodeScenarioDetailed(hash('2026-09-20.1'));
  assert.deepEqual(restored.form.poverty, POVERTY_DEFAULTS);
  assert(restored.filled.some(s => s.startsWith('poverty')));
  assert.throws(() => decodeScenarioDetailed(hash(FISCAL_MODEL_VERSION)));
  assert.throws(() => povertyScenario([], 5, { ...POVERTY_DEFAULTS, childcareCashShare: NaN }, .5));
  assert.throws(() => povertyScenario([], 5, { ...POVERTY_DEFAULTS, cashTarget: 'bad' as 'universal' }, .5));
  assert.throws(() => povertyScenario([policy('cash', -1)], 5, POVERTY_DEFAULTS, .5));
});

test('income taper is continuous at thresholds and independent of children', () => {
  const median = POVERTY_DATA.publishedMedian, line = median / 2;
  near(cashTaperWeight(0), 1);
  near(cashTaperWeight(line), 1);
  near(cashTaperWeight((line + median) / 2), .5);
  near(cashTaperWeight(median), 0);
  near(cashTaperWeight(median * 2), 0);
  for (let income = 0; income < median * 2; income += 10000) {
    assert(cashTaperWeight(income) >= cashTaperWeight(income + 10000));
  }
  for (const amount of [0, 1e12, 100e12]) {
    const r = povertyScenario([policy('cash', amount)], 1, { ...POVERTY_DEFAULTS, cashTarget: 'income-tapered' }, .5).rows[0];
    near(r.allocated, amount, 1);
    assert(r.all >= 0 && r.all <= 1 && r.child >= 0 && r.child <= 1);
  }
  for (const cashTarget of ['income-tapered', 'children'] as const) {
    const form = defaults(); form.poverty.cashTarget = cashTarget;
    assert.equal(decodeScenarioDetailed(encodeScenario(form)).form.poverty.cashTarget, cashTarget);
    if (cashTarget === 'children') {
      const old = '#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-21.2', form }));
      assert.equal(decodeScenarioDetailed(old).form.poverty.cashTarget, 'children');
    }
  }
});
