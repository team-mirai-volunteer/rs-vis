import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMETERS } from '@/app/lib/fiscal-space/assumptions';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import { amountToInstrument, instrumentsFor, instrumentToAmount } from '@/client/lib/fiscal-space-instruments';
import { defaults } from '@/client/lib/fiscal-space-form';
import { decodeScenarioDetailed } from '@/client/lib/fiscal-space-url';
import { decodeSharedScenario, encodeSharedScenario } from '@/client/lib/fiscal-space-share';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const one = (id: string) => instrumentsFor(id, PARAMETERS)[0];

test('消費税は標準税率・軽減税率を別々に下げられ、税率ゼロがそれぞれの入力上限', () => {
  near(instrumentToAmount(one('consumption-tax-reduced'), 1), 4.2); // 食料品8%→1%は年4.2兆円
  near(amountToInstrument(one('consumption-tax-reduced'), 4.2), 1);
  near(instrumentToAmount(one('consumption-tax'), 8), 5.8); // 標準10%→8%
  near(consumptionTaxLimit(PARAMETERS, 'consumption-tax-reduced') / 1e12, 4.8);
  near(consumptionTaxLimit(PARAMETERS, 'consumption-tax') / 1e12, 29);
});

test('所得税は基礎控除の引上げ幅、住民税は所得割の税率、社会保険料は健保・厚生年金の料率で換算する', () => {
  near(instrumentToAmount(one('income-tax'), 75), 3.3); // 大和総研の178万円案（所得税分）
  near(amountToInstrument(one('resident-tax'), 0), 10);
  near(instrumentToAmount(one('resident-tax'), 0) * 1e12, PARAMETERS && 4_452_998_483e3 + 8_187_266e6, 1);
  const [health, pension] = instrumentsFor('social-insurance', PARAMETERS);
  assert.equal(health.key, 'health-rate');
  assert.equal(pension.key, 'pension-rate');
  near(instrumentToAmount(health, 1) + instrumentToAmount(pension, 1), 4.146);
  assert.deepEqual(instrumentsFor('cash', PARAMETERS), []);
});

/** 2026-10-06.1 より前のリンク：消費税は1政策で、食料品のみは基準税率8%の換算で表していた */
function legacy(consumptionTax: Partial<typeof PARAMETERS.consumptionTax>, amount: number) {
  const form = structuredClone(defaults()) as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['amounts', 'policySettings', 'calibration'] as const) delete form[key]['consumption-tax-reduced'];
  delete (form.trade.industry as Record<string, unknown>)['consumption-tax-reduced'];
  delete ((form.optimization as Record<string, unknown>).eligible as Record<string, unknown>)['consumption-tax-reduced'];
  delete form.calibration.reducedConsumptionTax;
  delete (form as Record<string, unknown>).insuranceHealthShare;
  form.calibration.consumptionTax = { ...PARAMETERS.consumptionTax, revenuePerPoint: 3.5e12, cpiShare: .85, passThrough: 1, ...consumptionTax };
  (form.amounts as Record<string, number>)['consumption-tax'] = amount;
  return decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-24.5', form })));
}

test('旧リンクの全品目の消費税減税は、年額を変えずに標準税率・軽減税率へ按分する', () => {
  const { form, filled } = legacy({}, 3.5);
  near(form.amounts['consumption-tax'], 2.9);
  near(form.amounts['consumption-tax-reduced'], .6);
  near(form.calibration.consumptionTax.revenuePerPoint, 2.9e12, 1);
  near(form.calibration.consumptionTax.cpiShare, .63);
  assert.deepEqual(form.calibration.reducedConsumptionTax, PARAMETERS.reducedConsumptionTax);
  assert.equal(form.calibration.consumptionTax.passThrough, 1);
  assert.equal(form.optimization.eligible['consumption-tax-reduced'], true);
  assert.equal(form.insuranceHealthShare, .5);
  assert.ok(filled.some(x => x.includes('按分')));
});

test('旧リンクの「食料品のみ」は軽減税率の減税へ移る', () => {
  const { form, filled } = legacy({ revenuePerPoint: .6e12, cpiShare: .22, baseRate: .08 }, 4.2);
  near(form.amounts['consumption-tax'], 0);
  near(form.amounts['consumption-tax-reduced'], 4.2);
  assert.deepEqual(form.calibration.consumptionTax, { ...PARAMETERS.consumptionTax, passThrough: 1 });
  assert.deepEqual(form.calibration.reducedConsumptionTax, { revenuePerPoint: .6e12, cpiShare: .22, baseRate: .08, passThrough: PARAMETERS.reducedConsumptionTax.passThrough });
  assert.ok(filled.some(x => x.includes('食料品のみ')));
});

test('標準税率・軽減税率と健保の割合を共有URLで復元できる', async () => {
  const form = defaults();
  Object.assign(form.amounts, { 'consumption-tax': 2.9, 'consumption-tax-reduced': 4.2, 'social-insurance': 3 });
  form.insuranceHealthShare = .7;
  assert.deepEqual((await decodeSharedScenario(await encodeSharedScenario(form))).form, form);
});
