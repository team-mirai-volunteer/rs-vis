/** Package curated parameters; this does not manufacture OECD reference outputs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { taxRevenueFromOverview } from '@/app/lib/tax-burden/revenue';
import type { MOFBudgetOverview } from '@/types/mof-budget-overview';

const data = JSON.parse(readFileSync(resolve('scripts/data/tax-burden-params-2025.json'), 'utf8'));
const content = JSON.stringify(data, null, 2) + '\n';
const output = resolve('public/data/tax-burden-params-2025.json');
writeFileSync(output, content);
writeFileSync(`${output}.gz`, gzipSync(content, { level: 9 }));
console.log('Generated tax-burden-params-2025.json(.gz). Status: prototype; OECD reference outputs unavailable.');
// The version-controlled .gz is canonical; an old local raw JSON may have a different schema.
for (let year = 2017; year <= 2026; year++) {
  const overview = JSON.parse(gunzipSync(readFileSync(resolve(`public/data/mof-budget-overview-${year}.json.gz`))).toString('utf8')) as MOFBudgetOverview;
  const revenue = JSON.stringify(taxRevenueFromOverview(overview), null, 2) + '\n';
  const file = resolve(`public/data/tax-revenue-${year}.json`);
  writeFileSync(file, revenue);
  writeFileSync(`${file}.gz`, gzipSync(revenue, { level: 9 }));
}
console.log('Generated tax-revenue-{2017..2026}.json(.gz) from canonical MOF compressed datasets.');
