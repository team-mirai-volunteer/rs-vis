import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { requestDataset } from './fixtures/budget-requests-ui';

// Separate process/cwd isolates loader cache and keeps fixtures out of public/data.
const repository = process.cwd();
function loadIn(root: string) {
  const loader = pathToFileURL(resolve(repository, 'app/lib/api/budget-requests-loader.ts')).href;
  // --import needs a file:// URL on Windows (a bare drive path is rejected by the ESM loader)
  return JSON.parse(execFileSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, '--input-type=module', '-e',
    `const module = await import(${JSON.stringify(loader)}); const {loadBudgetRequests} = module.default ?? module; console.log(JSON.stringify(loadBudgetRequests()));`], {
    cwd: root, env: { ...process.env, TSX_TSCONFIG_PATH: resolve(repository, 'tsconfig.json') }, encoding: 'utf8',
  }));
}

test('loader returns null for ungenerated data and reads compressed server bundle data', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-request-loader-'));
  try {
    assert.equal(loadIn(root), null);
    mkdirSync(join(root, 'data', 'server'), { recursive: true });
    writeFileSync(join(root, 'data', 'server', 'budget-requests-2027.json.gz'), gzipSync(JSON.stringify(requestDataset())));
    const dataset = loadIn(root);
    assert.equal(dataset.requestedFY, 2027);
    assert.equal(dataset.records.length, 3);
    assert.equal(dataset.records[0].amounts.request.valueYen, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
