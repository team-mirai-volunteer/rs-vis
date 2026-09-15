import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS } from '../app/lib/fiscal-space/assumptions';
import { PERSONAL_TAX_REVENUE, policyReliefLimit } from '../app/lib/fiscal-space/policy-limits';
import { estimateFiscalSpace } from '../app/lib/fiscal-space/search';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { compareNextTrillion } from '../app/lib/fiscal-space/compare';
import { defaults } from '../client/lib/fiscal-space-form';
import { policyCostYen, policyInputLimitYen, totalPolicyCostYen } from '../client/lib/fiscal-space-amounts';
import { createFiscalEngine } from '../client/lib/fiscal-space-engine';
import { decodeScenario, encodeScenario, FISCAL_MODEL_VERSION } from '../client/lib/fiscal-space-url';

const ids = ['income-tax', 'resident-tax'] as const;
const noLoad = { sectorUtilizationPerTrillion: 0, peakGwPerTrillion: 0, operatingPeakGwPerTrillion: 0, lag: 0, lifetime: 1, depreciation: 0 };
const policy = (id: string, annualCost = 1e12) => ({ ...POLICIES.find(p => p.id === id)!, annualCost, load: noLoad });

test('personal tax caps reconcile to frozen official revenue extracts, excluding other resident-tax items', () => {
  const root = new URL('./fixtures/personal-tax/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  for (const [name, hash] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), hash);
  }
  const { rows } = JSON.parse(readFileSync(new URL('prefecture-income.json', root), 'utf8'));
  const prefectures = rows.filter((r: Record<string, string>) => r['団体コード '] !== '合計(全国)');
  assert.equal(prefectures.length, 47);
  const sum = prefectures.reduce((s: number, r: Record<string, string>) => s + Number(r['010:収入済額・合計']), 0);
  assert.equal(sum, Number(rows.find((r: Record<string, string>) => r['団体コード '] === '合計(全国)')['010:収入済額・合計']));
  // PDF38, table13(4), FY2024 income-based municipal receipts (million yen).
  assert.equal(PERSONAL_TAX_REVENUE['resident-tax'].amount, sum * 1000 + 8_187_266 * 1e6);
  // MOF FY2024 final settlement, income-tax total (100 million yen).
  assert.equal(PERSONAL_TAX_REVENUE['income-tax'].amount, 212_086 * 1e8);
  assert.equal(policyInputLimitYen('income-tax', PARAMETERS), 21.2e12);
  assert.equal(policyInputLimitYen('resident-tax', PARAMETERS), 12.6e12);
});

for (const id of ids) {
  test(`${id}: simulation aggregates duplicates; fixed-share search stops at revenue even with loose constraints`, () => {
    const cap = policyReliefLimit(id, PARAMETERS);
    for (const dataset of ['latest', '2024'] as const) {
      const state = initialEconomy(dataset);
      assert.throws(() => simulate(state, [policy(id, 100e12)], 5), /revenue base/);
      assert.throws(() => simulate(state, [policy(id, cap / 2), policy(id, cap / 2 + 2)], 5), /revenue base/);
      assert.doesNotThrow(() => simulate(state, [policy(id, cap)], 5));
      const loose = Object.fromEntries(Object.keys(THRESHOLDS).map(key => [key, 100])) as typeof THRESHOLDS;
      const result = estimateFiscalSpace(state, [
        { policy: policy(id), weight: 1 }, { policy: policy(id), weight: 1 }, { policy: policy('cash'), weight: 2 },
      ], loose, 5);
      assert.equal(result.status, 'revenue-cap');
      assert.equal(result.limitingPolicy, id);
      assert.equal(result.theoreticalMaximum, cap * 2);
    }
  });

  test(`${id}: form, engine and shared URLs use the same cap; extra trillion requires enough remaining tax`, () => {
    const form = defaults(); form.amounts[id] = 100;
    for (const version of [FISCAL_MODEL_VERSION, '2026-09-16.1', '2026-09-15.8']) {
      assert.throws(() => decodeScenario('#scenario=' + encodeURIComponent(JSON.stringify({ version, form }))));
    }
    assert.throws(() => encodeScenario(form));
    const result = createFiscalEngine()(form);
    const inputCap = policyInputLimitYen(id, form.calibration);
    assert.equal(result.totalYen, inputCap);
    assert.equal(totalPolicyCostYen(form.amounts, form.calibration), inputCap);
    assert.equal(policyCostYen(id, 100, form.calibration), inputCap);
    assert(result.comparison.every(row => row.policy.id !== id));
    assert(result.sensitivity.every(row => row.delta === null));
    form.amounts[id] = inputCap / 1e12;
    assert.deepEqual(decodeScenario(encodeScenario(form)), form);
    const cap = policyReliefLimit(id, PARAMETERS);
    const compare = (cost: number) => compareNextTrillion(initialEconomy(), [policy(id, cost)], PARAMETERS, undefined, THRESHOLDS, [policy(id)]);
    assert.equal(compare(cap - 1e12).length, 1);
    assert.equal(compare(cap - 1e12 + 2).length, 0);
    assert.equal(policyReliefLimit('cash', PARAMETERS), Infinity, 'a cash transfer has a separate policy channel');
  });
}
