/** Weekly refresh; daily schedules only drain a known unfinished cycle. Never starts a daily full crawl. */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ingestionFingerprint } from './fetch-budget-requests';

export const WEEKLY_REFRESH = '10 20 * * 0';
export const BACKLOG_CONTINUATION = '10 20 * * 1-6';
export function shouldAcquireBudgetRequests(event: string, schedule: string, checkpoint: unknown, fingerprint: string): boolean {
  if (event === 'workflow_dispatch') return true;
  if (event !== 'schedule') return false;
  if (schedule === WEEKLY_REFRESH) return true;
  if (schedule !== BACKLOG_CONTINUATION || !checkpoint || typeof checkpoint !== 'object') return false;
  const saved = checkpoint as { version?: number; year?: number; depth?: number; fingerprint?: string; complete?: boolean; dataset?: { requestedFY?: number; documents?: unknown[]; records?: unknown[] }; completedFiles?: unknown[]; completedPages?: unknown[] };
  return saved.version === 1 && saved.year === 2027 && saved.depth === 2 && saved.fingerprint === fingerprint && saved.complete === false
    && saved.dataset?.requestedFY === 2027 && Array.isArray(saved.dataset.documents) && Array.isArray(saved.dataset.records)
    && Array.isArray(saved.completedFiles) && Array.isArray(saved.completedPages);
}
async function main() {
  let checkpoint: unknown;
  try { checkpoint = JSON.parse(gunzipSync(await readFile(join(process.cwd(), 'data/budget-requests/sources/checkpoint-2027.json.gz'))).toString('utf8')); } catch { /* No usable backlog. Weekly/manual acquisition still works. */ }
  const run = shouldAcquireBudgetRequests(process.env.BUDGET_EVENT_NAME ?? '', process.env.BUDGET_SCHEDULE ?? '', checkpoint, await ingestionFingerprint());
  console.log(run ? 'Proceeding with bounded weekly refresh or unfinished-cycle continuation' : 'No compatible unfinished cycle; daily continuation does not acquire or publish data');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
