import test from 'node:test';
import assert from 'node:assert/strict';
import low from '../app/lib/fiscal-space/data/population-projection-low.json';
import medium from '../app/lib/fiscal-space/data/population-projection.json';
import { DEMOGRAPHICS, demographicPath, extraBirths } from '../app/lib/fiscal-space/demographics';
import { initialEconomy, PARAMETERS } from '../app/lib/fiscal-space/assumptions';
import { simulate } from '../app/lib/fiscal-space/simulate';
import { longRunScenario, LONG_RUN } from '../app/lib/fiscal-space/long-run';
import { defaults } from '../client/lib/fiscal-space-form';
import { decodeScenarioDetailed, encodeScenario } from '../client/lib/fiscal-space-url';

const mid = { ...DEMOGRAPHICS, fertilityVariant: 'medium' as const };

test('official low series keeps births, TFR and population consistent across all years', () => {
  assert.equal(DEMOGRAPHICS.fertilityVariant, 'low');
  assert.deepEqual(low.years, medium.years);
  assert.deepEqual(low.ageGroups, medium.ageGroups);
  for (const year of low.years) {
    const l = demographicPath(2024, year, DEMOGRAPHICS);
    const m = demographicPath(2024, year, mid);
    assert.equal(l.baselineTfr, (low.tfr as Record<string, number>)[year]);
    if (year > 2020) {
      assert.equal(l.births, (low.births as Record<string, number>)[year]);
      assert(l.births < m.births);
    }
    const lp = (low.population as Record<string, number[]>)[year];
    const mp = (medium.population as Record<string, number[]>)[year];
    assert.equal(lp.length, 18);
    assert(lp.every(n => Number.isFinite(n) && n >= 0));
    // Fertility changes cannot alter people already aged 65 during this projection.
    assert.deepEqual(lp.slice(13), mp.slice(13));
  }
  assert.equal(demographicPath(2024, 2031, DEMOGRAPHICS).tfr, 1.1233);
  assert.equal(demographicPath(2024, 2031, mid).tfr, 1.3223);
  assert.equal(demographicPath(2024, 2024, DEMOGRAPHICS).childIndex, 1);
});

test('low fertility affects child expenditure first, and long-run labour and revenues later', () => {
  const initial = initialEconomy('2024');
  const lowP = { ...PARAMETERS, demographics: DEMOGRAPHICS };
  const midP = { ...PARAMETERS, demographics: mid };
  const l = simulate(initial, [], 5, lowP), m = simulate(initial, [], 5, midP);
  assert.equal(l.steps[4].state.labour.labourForce, m.steps[4].state.labour.labourForce);
  assert(l.steps[4].state.fiscal.primaryExpenditure < m.steps[4].state.fiscal.primaryExpenditure);
  const ll = longRunScenario(initial, [], l, l, lowP, LONG_RUN).at(-1)!;
  const ml = longRunScenario(initial, [], m, m, midP, LONG_RUN).at(-1)!;
  assert(ll.labourForceIndex < ml.labourForceIndex);
  assert(ll.taxRevenue < ml.taxRevenue);
  assert(ll.realGdp < ml.realGdp);
});

test('policy births use each variant and enter labour only after 15 years', () => {
  const driver = { calendarYear: 2027, familySpendingGdpShare: .01, netIncomeChange: 0 };
  for (const d of [DEMOGRAPHICS, mid]) {
    const path = demographicPath(2026, 2027, d, [driver]);
    assert(Math.abs(path.tfr - path.baselineTfr - .1) < 1e-12);
    assert.equal(path.extraBirths, extraBirths(driver, d));
    assert.equal(demographicPath(2026, 2041, d, [driver]).labourForceIndex, demographicPath(2026, 2041, d).labourForceIndex);
    assert(demographicPath(2026, 2042, d, [driver]).labourForceIndex > demographicPath(2026, 2042, d).labourForceIndex);
  }
});

test('shared links retain the variant and old links disclose the default change', () => {
  const form = defaults();
  assert.deepEqual(decodeScenarioDetailed(encodeScenario(form)).form, form);
  const legacy = JSON.parse(JSON.stringify(form));
  delete legacy.calibration.demographics.fertilityVariant;
  const restored = decodeScenarioDetailed('#scenario=' + encodeURIComponent(JSON.stringify({ version: '2026-09-17.1', form: legacy })));
  assert.equal(restored.form.calibration.demographics.fertilityVariant, 'low');
  assert(restored.filled.some(s => s.includes('出生中位から低位')));
  assert.throws(() => demographicPath(2024, 2029, { ...DEMOGRAPHICS, fertilityVariant: 'invalid' as 'low' }));
});
