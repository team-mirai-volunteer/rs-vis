/** Read-only verification of CSV audit candidates against the current official API.
 * node scripts/audit-rs-csv-api.mjs data/audit/20261027-rs-refresh/audit.json
 * Raw responses and comparisons are saved alongside the audit; no input data is replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const file = process.argv[2];
if (!file) throw new Error('Pass the CSV audit JSON path');
const audit = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = path.dirname(file);
const projects = JSON.parse(fs.readFileSync(`data/rs-api/${audit.sheetYear}/projects.json`, 'utf8'));
const ids = new Map(projects.map(p => [String(Number(p.project_number)), p.id]));
const candidates = [...audit.zeroBudgetAndExecutionWithSpending, ...audit.spendingOverTenTimesBudget];
const results = [];
for (let offset = 0; offset < candidates.length; offset += 4) {
  const batch = await Promise.all(candidates.slice(offset, offset + 4).map(async candidate => {
    const id = ids.get(candidate.pid);
    if (!id) return { ...candidate, error: 'No cached official project UUID' };
    const url = `https://rssystem.go.jp/api/projects/${id}/payment-groups/`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text();
      const groups = JSON.parse(raw);
      if (!Array.isArray(groups)) throw new Error('Expected payment-group array');
      const contracts = groups.flatMap(g => g.payments.flatMap(p => p.contracts));
      const amounts = contracts.map(c => c.amount).filter(a => typeof a === 'number' && a >= 0);
      const apiAmount = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
      fs.writeFileSync(path.join(root, `api-${audit.sheetYear}-${candidate.pid}.json`),
        JSON.stringify({ url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), data: groups }, null, 2));
      return { ...candidate, url, apiAmount, apiContractRows: contracts.length,
        ratio: apiAmount ? candidate.contractRowsTotal / apiAmount : null,
        matches: apiAmount === candidate.contractRowsTotal };
    } catch (error) { return { ...candidate, url, error: String(error) }; }
  }));
  results.push(...batch);
  console.log(`Verified ${results.length}/${candidates.length}`);
}
fs.writeFileSync(path.join(root, 'api-comparison.json'), JSON.stringify({
  checkedAt: new Date().toISOString(), sheetYear: audit.sheetYear,
  scope: 'Only the zero-budget/zero-execution and >10x-budget candidates; not all projects.', results,
}, null, 2));
console.log(JSON.stringify({ checked: results.length, different: results.filter(r => r.matches === false).length,
  errors: results.filter(r => r.error).length }));
