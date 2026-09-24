// Public issuer reports, linked from each company's official IR library.
// node scripts/fetch-wage-company-pilot.mjs
// Raw PDFs stay in ignored data/; curated observations are in docs/ai-review/.
import { request } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sources = JSON.parse(await readFile('docs/ai-review/wage-company-sources.json', 'utf8'));
const dir = 'data/tax-expenditures/company-pilot';
await mkdir(dir, { recursive: true });
const client = await request.newContext();
const manifest = [];
try {
  for (const source of sources) {
    const response = await client.get(source.url, { timeout: 45000 });
    if (!response.ok()) throw new Error(`${source.file}: HTTP ${response.status()}`);
    const bytes = await response.body();
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error(`${source.file}: not PDF`);
    await writeFile(`${dir}/${source.file}`, bytes);
    manifest.push({ ...source, fetchedAt: new Date().toISOString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    console.log(`Saved ${source.file} (${bytes.length} bytes)`);
  }
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
} finally {
  await client.dispose();
}
