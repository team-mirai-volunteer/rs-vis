import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from './fixtures/ef2026/manifest.json';
import rows from './fixtures/ef2026/rows.json';
import { REFERENCES, GOVERNMENT_ONE_YEAR, CONSUMPTION_TAX_CUT, type ResponseProfile } from '../app/lib/fiscal-space/calibration';

test('EF2026 coefficients match frozen official tables, including signs and own-variable denominators', () => {
  for (const [name, sha] of Object.entries(manifest.files))
    assert.equal(createHash('sha256').update(readFileSync(new URL(`./fixtures/ef2026/${name}`, import.meta.url))).digest('hex'), sha);
  assert.equal(REFERENCES.ef2026.url, manifest.url);
  const profiles = { governmentOneYear: GOVERNMENT_ONE_YEAR, government: REFERENCES.ef2026.government,
    household: REFERENCES.ef2026.household, corporate: REFERENCES.ef2026.corporate, consumptionTax: CONSUMPTION_TAX_CUT };
  for (const [name, profile] of Object.entries(profiles)) {
    const source = rows.tables[name as keyof typeof rows.tables];
    for (const [columns, table] of [[rows.activityColumns, source.activityRows], [rows.priceLabourColumns, source.priceLabourRows]] as const)
      columns.forEach((key, col) => {
        if (!(key in profile)) return;
        assert.deepEqual(profile[key as keyof ResponseProfile], table.map(row => row[col] * source.sign || 0), `${name}.${key}, PDF p${source.page}`);
      });
    assert.deepEqual(profile.labourForce, [0, 0, 0, 0, 0], 'explicit unestimated assumption');
    assert.deepEqual(profile.hours, [0, 0, 0, 0, 0], 'explicit unestimated assumption');
  }
});
