/** Publish only validated data through a dedicated PR branch. Never pushes or force-pushes main. */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const UPDATE_BRANCH = 'automation/official-budget-requests';
const DATA_FILE = 'public/data/budget-requests-2027.json.gz';
type CommandResult = { status: number; stdout: string };
export type CommandRunner = (command: string, args: string[]) => CommandResult;
interface PublishOptions { run?: CommandRunner; checks?: () => void; }
function systemRun(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}
function commands(run: CommandRunner) {
  function checked(command: string, args: string[]) {
    const result = run(command, args);
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}`);
    return result.stdout.trim();
  }
  const git = (...args: string[]) => checked('git', args);
  function remoteBranch() {
    const result = run('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${UPDATE_BRANCH}`]);
    if (result.status === 2) return false;
    if (result.status !== 0 || !result.stdout.trim()) throw new Error('Cannot determine the remote update branch state');
    return true;
  }
  function fetchRefs() {
    git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    const exists = remoteBranch();
    if (exists) {
      git('fetch', '--no-tags', 'origin', `refs/heads/${UPDATE_BRANCH}:refs/remotes/origin/${UPDATE_BRANCH}`);
      const unexpected = git('diff', '--name-only', `origin/main...origin/${UPDATE_BRANCH}`).split('\n').filter(path => path && path !== DATA_FILE);
      if (unexpected.length) throw new Error(`The update branch contains non-data changes; refusing to publish: ${unexpected.join(', ')}`);
    }
    return exists;
  }
  function merge(ref: string) {
    const result = run('git', ['merge', '--no-edit', ref]);
    if (result.status !== 0) {
      run('git', ['merge', '--abort']);
      throw new Error(`Concurrent changes conflict with ${ref}; remote data was not overwritten. Resolve the update branch manually.`);
    }
  }
  return { checked, git, fetchRefs, merge };
}
export function prepareBudgetUpdate({ run = systemRun }: PublishOptions = {}) {
  const { git, fetchRefs, merge } = commands(run);
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Refusing to prepare an update in a dirty checkout');
  const exists = fetchRefs();
  git('checkout', '-B', UPDATE_BRANCH, exists ? `origin/${UPDATE_BRANCH}` : 'origin/main');
  merge('origin/main');
}
export function publishBudgetUpdate({ run = systemRun, checks }: PublishOptions = {}): { published: boolean; sha?: string } {
  const { checked, git, fetchRefs, merge } = commands(run);
  if (git('branch', '--show-current') !== UPDATE_BRANCH) throw new Error(`Expected dedicated branch ${UPDATE_BRANCH}`);
  const changed = git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean);
  if (changed.some(path => path !== DATA_FILE)) throw new Error('Refusing to publish changes outside the budget dataset');
  git('add', '--', DATA_FILE);
  if (git('diff', '--cached', '--name-only')) git('commit', '-m', 'data: refresh official FY2027 budget requests');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const exists = fetchRefs();
    merge('origin/main');
    if (exists) merge(`origin/${UPDATE_BRANCH}`);
    if (!git('diff', '--name-only', 'origin/main', 'HEAD', '--', DATA_FILE)) return { published: false };
    // Run gates on the exact candidate, including every remotely merged change. GITHUB_TOKEN-created
    // PRs/pushes do not trigger ordinary pull_request workflows; these gates must not be skipped.
    if (checks) checks();
    else {
      for (const args of [['ci'], ['run', 'typecheck'], ['test'], ['run', 'validate:budget-requests']]) {
        const output = checked('npm', args); if (output) console.log(output);
      }
    }
    if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Validation changed tracked files; refusing to publish an untested candidate');
    const sha = git('rev-parse', 'HEAD');
    const mainNow = git('ls-remote', '--heads', 'origin', 'refs/heads/main').split(/\s/)[0];
    if (mainNow !== git('rev-parse', 'origin/main')) {
      if (attempt < 3) continue;
      throw new Error('Main changed during all 3 validation attempts; retry on a stable base');
    }
    const pushed = run('git', ['push', 'origin', `HEAD:refs/heads/${UPDATE_BRANCH}`]);
    if (pushed.status !== 0) {
      if (attempt < 3) continue; // Refetch, merge (never overwrite), and re-run gates on the new SHA.
      throw new Error('Update branch push failed after 3 attempts; no force-push was used');
    }
    const actual = git('ls-remote', '--heads', 'origin', `refs/heads/${UPDATE_BRANCH}`).split(/\s/)[0];
    if (actual !== sha) throw new Error('Remote update branch moved after push; refusing to claim this candidate is published');
    const pr = checked('gh', ['pr', 'list', '--state', 'open', '--base', 'main', '--head', UPDATE_BRANCH, '--json', 'number', '--jq', '.[0].number // empty']);
    if (!pr) {
      const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'the Refresh official budget requests workflow';
      checked('gh', ['pr', 'create', '--draft', '--base', 'main', '--head', UPDATE_BRANCH, '--title', 'data: refresh official FY2027 budget requests', '--body',
        `Official-source data update. Review before merging.\n\nPublication runs npm ci, typecheck, all unit tests, and budget-data validation on the exact candidate (and again after any concurrent merge): ${runUrl}.\n\nThis PR uses GITHUB_TOKEN, so ordinary pull_request workflows are not automatically triggered. These publication gates do not replace required branch-protection checks or browser/security jobs. A maintainer must arrange the normal checks if required; this workflow does not auto-merge.`]);
    }
    console.log(`Published validated data ${sha} to ${UPDATE_BRANCH}`);
    return { published: true, sha };
  }
  throw new Error('Unreachable publication state');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'prepare') prepareBudgetUpdate();
    else if (process.argv[2] === 'publish') publishBudgetUpdate();
    else throw new Error('Usage: publish-budget-requests.ts prepare|publish');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
