/** Actions caches expire after seven idle days; weekly runs fall back to their own 30-day artifacts.
 * https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
export type CacheCommand = (args: string[]) => string;
function gh(args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
export async function restoreBudgetRequestCache(repo: string, destination: string, run: CacheCommand = gh): Promise<number | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  const result = JSON.parse(run(['api', `repos/${repo}/actions/workflows/budget-requests.yml/runs?branch=main&per_page=10`])) as { workflow_runs: { id: number; status: string; run_attempt: number; event: string; head_branch: string; head_repository: { full_name: string } | null; repository: { full_name: string } }[] };
  // Only this workflow on main, no fork/PR artifact lookup and no arbitrary archive extraction into the checkout.
  for (const workflow of result.workflow_runs.filter(item => item.status === 'completed' && ['schedule', 'workflow_dispatch'].includes(item.event) && item.head_branch === 'main' && item.head_repository?.full_name === repo && item.repository?.full_name === repo).slice(0, 10)) {
    const listing = JSON.parse(run(['api', `repos/${repo}/actions/runs/${workflow.id}/artifacts?per_page=100`])) as { artifacts: { name: string; expired: boolean }[] };
    const name = `budget-request-cache-${workflow.id}-${workflow.run_attempt}`;
    if (!listing.artifacts.some(artifact => artifact.name === name && !artifact.expired)) continue;
    const temporary = await mkdtemp(join(tmpdir(), 'budget-cache-restore-'));
    try {
      run(['run', 'download', String(workflow.id), '--repo', repo, '--name', name, '--dir', temporary]);
      const entries = await readdir(temporary, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/^(?:[a-f0-9]{64}|checkpoint-2027\.json\.gz|last-run-2027\.json)$/.test(entry.name)) throw new Error(`Unexpected cache artifact entry: ${entry.name}`);
        const bytes = await readFile(join(temporary, entry.name));
        if (/^[a-f0-9]{64}$/.test(entry.name) && createHash('sha256').update(bytes).digest('hex') !== entry.name) throw new Error(`Corrupt cached source: ${entry.name}`);
        if (entry.name === 'checkpoint-2027.json.gz') {
          const state = JSON.parse(gunzipSync(bytes).toString('utf8'));
          if (state.version !== 1 || state.year !== 2027 || !state.dataset || !Array.isArray(state.completedFiles) || !Array.isArray(state.completedPages)) throw new Error('Invalid cached checkpoint');
        }
      }
      await mkdir(destination, { recursive: true });
      for (const entry of entries) await copyFile(join(temporary, entry.name), join(destination, entry.name));
      console.log(`Restored ${entries.length} cached files from workflow run ${workflow.id}`);
      return workflow.id;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  console.log('No unexpired cache artifact in the latest 10 workflow runs; starting from the checked-out data snapshot');
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  restoreBudgetRequestCache(process.env.GITHUB_REPOSITORY ?? '', join(process.cwd(), 'data/budget-requests/sources')).catch(error => { console.error(error); process.exitCode = 1; });
}
