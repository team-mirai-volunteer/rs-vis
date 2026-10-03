import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMETERS } from '@/app/lib/fiscal-space/assumptions';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import { amountFromRate, consumptionTaxFor, consumptionTaxTarget, rateFromAmount } from '@/client/lib/fiscal-space-food-tax';
import { defaults } from '@/client/lib/fiscal-space-form';
import { decodeSharedScenario, encodeSharedScenario } from '@/client/lib/fiscal-space-share';

const food = consumptionTaxFor('food', { ...PARAMETERS.consumptionTax, passThrough: .5 });

test('食料品のみに切り替えると8%基準・1ポイント0.6兆円になり、転嫁率などは保つ', () => {
  assert.equal(consumptionTaxTarget(PARAMETERS.consumptionTax), 'all');
  assert.equal(consumptionTaxTarget(food), 'food');
  assert.equal(food.baseRate, .08);
  assert.equal(food.passThrough, .5);
  assert.deepEqual(consumptionTaxFor('all', food), { ...PARAMETERS.consumptionTax, passThrough: .5 });
});

test('食料品8%→1%は年4.2兆円、税率ゼロが入力上限4.8兆円', () => {
  assert.ok(Math.abs(amountFromRate(.01, food) - 4.2) < 1e-9);
  assert.ok(Math.abs(rateFromAmount(4.2, food) - .01) < 1e-12);
  assert.ok(Math.abs(consumptionTaxLimit({ ...PARAMETERS, consumptionTax: food }) / 1e12 - 4.8) < 1e-9);
});

test('食料品のみの条件を共有URLで復元できる', async () => {
  const base = defaults();
  const form = { ...base, calibration: { ...base.calibration, consumptionTax: food }, amounts: { ...base.amounts, 'consumption-tax': 4.2 } };
  assert.deepEqual((await decodeSharedScenario(await encodeSharedScenario(form))).form, form);
});
