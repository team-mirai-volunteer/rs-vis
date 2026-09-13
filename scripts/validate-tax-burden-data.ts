import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readDataJson } from '@/app/lib/api/data-file';
import { MODEL_VERSION, HOUSEHOLDS, initialTaxState } from '@/app/lib/tax-burden/households';
import { simulate } from '@/app/lib/tax-burden/simulate';
import { taxRevenueFromOverview } from '@/app/lib/tax-burden/revenue';
import type { TaxParameters, TaxRevenue } from '@/types/tax-burden';
import type { MOFBudgetOverview } from '@/types/mof-budget-overview';

const p = readDataJson<TaxParameters>('tax-burden-params-2025.json', 'npm run generate-tax-burden-data');
assert.equal(p.metadata.status, 'prototype');
assert.equal(p.metadata.modelVersion, MODEL_VERSION);
assert.equal(p.monthlyRemuneration.length, p.monthlyBoundaries.length + 1);
for (const values of [p.monthlyRemuneration, p.monthlyBoundaries]) {
  assert(values.every((n, i) => Number.isFinite(n) && n > 0 && (i === 0 || n > values[i - 1])));
}
let count = 0;
for (const household of HOUSEHOLDS) {
  for (const age of [20, 39, 40, 64]) {
    for (let income = 0; income <= 20000000; income += 10000) {
      const result = simulate({ ...initialTaxState(), household: household.id, income, age }, p);
      for (const key of ['incomeTax', 'residentTax', 'pension', 'health', 'care', 'employment', 'benefits'] as const) {
        assert(Number.isSafeInteger(result[key]) && result[key] >= 0, `${household.id}/${income}/${key}`);
      }
      assert.equal(result.netBurden, result.grossBurden - result.benefits);
      assert.equal(result.outOfScope, result.salaries.some(s => s < p.minimumAnnualWage));
      assert(income === 0 ? result.netRate === null : Number.isFinite(result.netRate));
      count++;
    }
  }
}
for (let year = 2017; year <= 2026; year++) {
  const overview = JSON.parse(gunzipSync(readFileSync(`public/data/mof-budget-overview-${year}.json.gz`)).toString('utf8')) as MOFBudgetOverview;
  const data = taxRevenueFromOverview(overview);
  assert.deepEqual(readDataJson<TaxRevenue>(`tax-revenue-${year}.json`, 'npm run generate-tax-burden-data'), data);
  assert(data.total > 0);
}
console.log(`PASS: ${count} household points; revenue totals for 2017–2026. OECD acceptance comparison NOT performed (reference data unavailable).`);
