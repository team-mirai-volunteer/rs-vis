import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { restoreBudgetRequestCache } from '../scripts/restore-budget-request-cache';

const trusted = { event: 'schedule', head_branch: 'main', head_repository: { full_name: 'owner/repo' }, repository: { full_name: 'owner/repo' } };
async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const path = await mkdtemp(join(tmpdir(), 'budget-cache-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
test('weekly cache eviction restores only verified raw sources and checkpoint from its own workflow artifact', async t => {
  const destination = await directory(t); const calls: string[][] = [];
  const bytes = Buffer.from('official source'); const hash = createHash('sha256').update(bytes).digest('hex');
  const run = await restoreBudgetRequestCache('owner/repo', destination, args => {
    calls.push(args);
    if (args[1].includes('/workflows/')) return JSON.stringify({ workflow_runs: [{ id: 123, status: 'in_progress', run_attempt: 1 }, { ...trusted, id: 122, status: 'completed', run_attempt: 2 }] });
    if (args[1].includes('/artifacts')) return JSON.stringify({ artifacts: [{ name: 'budget-request-cache-122-2', expired: false }] });
    const path = args[args.indexOf('--dir') + 1];
    writeFileSync(join(path, hash), bytes);
    writeFileSync(join(path, 'checkpoint-2027.json.gz'), gzipSync(JSON.stringify({ version: 1, year: 2027, dataset: {}, completedFiles: [], completedPages: [] })));
    return '';
  });
  assert.equal(run, 122); assert.deepEqual(await readFile(join(destination, hash)), bytes);
  assert.equal(calls.length, 3);
  assert.ok(calls[0][1].includes('budget-requests.yml/runs?branch=main&per_page=10'));
  assert.deepEqual(calls[2].slice(0, 7), ['run', 'download', '122', '--repo', 'owner/repo', '--name', 'budget-request-cache-122-2']);
});
test('expired or unrelated artifacts are never downloaded', async t => {
  const destination = await directory(t); let downloads = 0;
  const result = await restoreBudgetRequestCache('owner/repo', destination, args => {
    if (args[1].includes('/workflows/')) return JSON.stringify({ workflow_runs: [{ ...trusted, id: 122, status: 'completed', run_attempt: 1 }] });
    if (args[1].includes('/artifacts')) return JSON.stringify({ artifacts: [{ name: 'other', expired: false }, { name: 'budget-request-cache-122-1', expired: true }] });
    downloads++; return '';
  });
  assert.equal(result, null); assert.equal(downloads, 0); assert.deepEqual(await readdir(destination), []);
});
test('cache restore rejects corrupt hashes and unexpected paths before copying any files', async t => {
  const destination = await directory(t);
  for (const filename of ['a'.repeat(64), 'unexpected.js']) {
    await assert.rejects(restoreBudgetRequestCache('owner/repo', destination, args => {
      if (args[1].includes('/workflows/')) return JSON.stringify({ workflow_runs: [{ ...trusted, id: 122, status: 'completed', run_attempt: 1 }] });
      if (args[1].includes('/artifacts')) return JSON.stringify({ artifacts: [{ name: 'budget-request-cache-122-1', expired: false }] });
      writeFileSync(join(args[args.indexOf('--dir') + 1], filename), 'untrusted'); return '';
    }), /Corrupt cached source|Unexpected cache artifact entry/);
    assert.deepEqual(await readdir(destination), []);
  }
});

test('cache restore rejects fork PR artifacts even when their head branch is named main', async t => {
  const destination = await directory(t); let requests = 0;
  const result = await restoreBudgetRequestCache('owner/repo', destination, args => {
    requests++;
    assert.ok(args[1].includes('/workflows/'));
    return JSON.stringify({ workflow_runs: [
      { ...trusted, id: 1, status: 'completed', run_attempt: 1, event: 'pull_request', head_repository: { full_name: 'attacker/repo' } },
      { ...trusted, id: 2, status: 'completed', run_attempt: 1, head_repository: { full_name: 'attacker/repo' } },
      { ...trusted, id: 3, status: 'completed', run_attempt: 1, head_branch: 'untrusted' },
      { ...trusted, id: 4, status: 'completed', run_attempt: 1, repository: { full_name: 'other/repo' } },
      { ...trusted, id: 5, status: 'completed', run_attempt: 1, event: 'pull_request' },
    ] });
  });
  assert.equal(result, null); assert.equal(requests, 1); assert.deepEqual(await readdir(destination), []);
});
