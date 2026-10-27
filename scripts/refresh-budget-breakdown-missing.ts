/** Refresh only budget breakdowns from CSV, preserving all other graph data.
 * node --import tsx scripts/refresh-budget-breakdown-missing.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readShiftJISCSV, parseOptionalAmount } from './csv-reader';
import type { BudgetBreakdownItem } from '../types/sankey-svg';

const sources = new Map<number, Map<string, BudgetBreakdownItem[]>>();
for (const year of [2024, 2025]) {
  const rows = readShiftJISCSV(`data/year_${year}/2-2_RS_${year}_予算・執行_予算種別・歳出予算項目.csv`);
  const byKey = new Map<string, BudgetBreakdownItem[]>();
  for (const row of rows) {
    const fiscalYear = Number(row['予算年度']);
    const key = `${Number(row['予算事業ID'])}:${fiscalYear}`;
    const item: BudgetBreakdownItem = {
      fiscalYear, accountCategory: row['会計区分'] || '', account: row['会計'] || '',
      subAccount: row['勘定'] || '', budgetType: row['予算種別'] || '',
      jurisdiction: row['所管'] || '', organizationAccount: row['組織・勘定'] || '',
      item: row['項'] || '', subItem: row['目'] || '',
      note: row['歳出予算項目の補足情報'] || row['備考(歳出予算項目ごと)'] || '',
      amount: parseOptionalAmount(row['予算額(歳出予算項目ごと)']),
      nextYearRequestAmount: parseOptionalAmount(row['翌年度要求額(歳出予算項目ごと)']),
    };
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  for (const items of byKey.values()) items.sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity));
  sources.set(year, byKey);
}
const pending: { file: string; text: string; changed: number }[] = [];
for (const name of fs.readdirSync('public/data').filter(n => /^(sankey-svg-\d+-graph|unified-budget-.+-graph)\.json\.gz$/.test(n))) {
  const file = path.join('public/data', name);
  const graph = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const sheet = name.startsWith('sankey-svg-') ? Number(name.split('-')[2]) : graph.metadata.rsSheetYear;
  const source = sources.get(sheet);
  if (!source) continue;
  let changed = 0;
  for (const node of graph.nodes) {
    const old: BudgetBreakdownItem[] = node.budgetBreakdown ?? [];
    if (!old.length) continue;
    const fresh = source.get(`${node.projectId}:${old[0].fiscalYear}`);
    if (!fresh || fresh.length !== old.length) throw new Error(`Budget row count changed: ${name}/${node.projectId}`);
    for (const field of ['amount', 'nextYearRequestAmount'] as const) {
      const total = (rows: BudgetBreakdownItem[]) => rows.reduce((s, r) => s + (r[field] ?? 0), 0);
      if (total(old) !== total(fresh)) throw new Error(`Budget total changed: ${name}/${node.projectId}/${field}`);
    }
    if (JSON.stringify(old) !== JSON.stringify(fresh)) { node.budgetBreakdown = fresh; changed++; }
  }
  pending.push({ file, text: JSON.stringify(graph), changed });
}
// Validate all files before writing any of them.
for (const { file, text, changed } of pending) {
  fs.writeFileSync(file.slice(0, -3), text);
  if (changed) fs.writeFileSync(file, gzipSync(text, { level: 9 }));
  console.log(`${path.basename(file)}: ${changed} project breakdowns refreshed`);
}
