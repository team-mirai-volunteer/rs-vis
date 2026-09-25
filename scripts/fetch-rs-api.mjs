/** Public RS snapshot, isolated from official CSVs. Resume cached responses by default.
 * node scripts/fetch-rs-api.mjs [2026] [--refresh] [--limit N]
 * Failed endpoints remain missing, never represented as empty/zero data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const year = Number(process.argv[2] || 2026);
if (!Number.isInteger(year) || year < 2024 || year > 2100) throw Error('Invalid sheet year');
const refresh = process.argv.includes('--refresh');
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt < 0 ? Infinity : Number(process.argv[limitAt + 1]);
if (!(limit > 0)) throw Error('Invalid limit');
const root = path.resolve(`data/rs-api/${year}`);
fs.mkdirSync(root, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}
async function get(relative, file) {
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://rssystem.go.jp/api/${relative}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const data = await res.json();
      const envelope = { url, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data };
      save(file, envelope);
      await delay(100);
      return envelope;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}
const projects = [];
let expected = 0;
for (let page = 1; ; page++) {
  const { data } = await get(`projects/?sheet_type=RS&page=${page}&page_size=100&fiscal_year=${year}`, path.join(root, `list-${page}.json`));
  if (!Array.isArray(data.results)) throw Error('Unexpected project list');
  expected = data.count;
  projects.push(...data.results);
  console.log(`List ${projects.length}/${expected}`);
  if (!data.next) break;
}
if (new Set(projects.map(p => p.id)).size !== projects.length) throw Error('Duplicate project UUIDs; refresh the list');
if (projects.length !== expected) throw Error('Incomplete project list');
save(path.join(root, 'projects.json'), projects);
// Highest execution first makes interrupted runs useful, without replacing missing detail with zero.
const targets = [...projects].sort((a, b) => (b.previous_year_execution_amount ?? 0) - (a.previous_year_execution_amount ?? 0)).slice(0, limit);
let cursor = 0;
let complete = 0;
const failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < targets.length) {
    const p = targets[cursor++];
    try {
      for (const endpoint of ['payment-groups', 'payment-edges']) {
        const result = await get(`projects/${p.id}/${endpoint}/`, path.join(root, p.id, `${endpoint}.json`));
        if (!Array.isArray(result.data)) throw Error(`Unexpected ${endpoint}`);
      }
      complete++;
    } catch (error) {
      failures.push({ id: p.id, projectNumber: p.project_number, error: String(error) });
    }
    if ((complete + failures.length) % 100 === 0) console.log(`Payments ${complete + failures.length}/${targets.length}; failed ${failures.length}`);
  }
}));
const manifest = { source: 'rs-api', provisional: true, sheetYear: year, fiscalYear: year - 1, completedAt: new Date().toISOString(), listed: projects.length, attempted: targets.length, complete, failures };
save(path.join(root, 'manifest.json'), manifest);
console.log(JSON.stringify(manifest));
