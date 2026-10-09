import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBudgetUpdate, publishBudgetUpdate, UPDATE_BRANCH, type CommandRunner } from '../scripts/publish-budget-requests';

const DATA = 'public/data/budget-requests-2027.json.gz';
async function repository(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'budget-publication-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remote = join(dir, 'remote.git'); const work = join(dir, 'work'); const concurrent = join(dir, 'concurrent');
  function command(cwd: string, cmd: string, args: string[]) {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: result.stdout + result.stderr };
  }
  function git(cwd: string, ...args: string[]) {
    const result = command(cwd, 'git', args); assert.equal(result.status, 0, result.stdout); return result.stdout.trim();
  }
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(dir, 'clone', remote, work);
  for (const cwd of [work]) { git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid'); }
  await mkdir(join(work, 'public/data'), { recursive: true });
  await writeFile(join(work, DATA), 'original'); await writeFile(join(work, 'README.md'), 'original');
  git(work, 'add', '.'); git(work, 'commit', '-m', 'initial'); git(work, 'push', 'origin', 'main');
  git(dir, 'clone', remote, concurrent);
  git(concurrent, 'config', 'user.name', 'Concurrent'); git(concurrent, 'config', 'user.email', 'concurrent@example.invalid');
  const calls: { command: string; args: string[] }[] = [];
  const exactRun: CommandRunner = (cmd, args) => {
    calls.push({ command: cmd, args });
    if (cmd === 'gh') return { status: 0, stdout: args[1] === 'list' ? '' : 'https://github.example/pr/1' };
    const result = spawnSync(cmd, args, { cwd: work, encoding: 'utf8' });
    return { status: result.status ?? 1, stdout: result.stdout };
  };
  return { dir, remote, work, concurrent, git, calls, run: exactRun };
}

test('publication gates the exact SHA, changes only dedicated branch and creates a PR', async t => {
  const repo = await repository(t);
  const before = repo.git(repo.work, 'rev-parse', 'origin/main');
  prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'new data');
  const gated: string[] = [];
  const result = publishBudgetUpdate({ run: repo.run, checks: () => { gated.push(repo.git(repo.work, 'rev-parse', 'HEAD')); } });
  assert.equal(result.published, true); assert.deepEqual(gated, [result.sha]);
  assert.equal(repo.git(repo.work, 'ls-remote', '--heads', 'origin', 'main').split(/\s/)[0], before);
  assert.equal(repo.git(repo.work, 'ls-remote', '--heads', 'origin', UPDATE_BRANCH).split(/\s/)[0], result.sha);
  assert.ok(repo.calls.some(call => call.command === 'gh' && call.args[1] === 'create'));
  assert.ok(repo.calls.filter(call => call.command === 'git' && call.args[0] === 'push').every(call => !call.args.some(arg => arg.includes('force')) && call.args.at(-1) === `HEAD:refs/heads/${UPDATE_BRANCH}`));
});

test('unchanged data does not commit, push or create a PR', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  const head = repo.git(repo.work, 'rev-parse', 'HEAD');
  const result = publishBudgetUpdate({ run: repo.run, checks: () => { throw new Error('No candidate needs checking'); } });
  assert.equal(result.published, false); assert.equal(repo.git(repo.work, 'rev-parse', 'HEAD'), head);
  assert.equal(repo.calls.some(call => call.command === 'gh' || call.args[0] === 'push'), false);
});

test('failed validation never pushes or creates a PR', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'new data');
  assert.throws(() => publishBudgetUpdate({ run: repo.run, checks: () => { throw new Error('Validation failed'); } }), /Validation failed/);
  assert.equal(repo.calls.some(call => call.command === 'gh' || call.args[0] === 'push'), false);
});

test('main advancing during gates is merged and the new exact candidate is rechecked', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'new data');
  let checks = 0; let concurrentSha = '';
  const result = publishBudgetUpdate({ run: repo.run, checks: () => {
    checks++;
    if (checks === 1) {
      repo.git(repo.concurrent, 'commit', '--allow-empty', '-m', 'concurrent main');
      repo.git(repo.concurrent, 'push', 'origin', 'main');
      concurrentSha = repo.git(repo.concurrent, 'rev-parse', 'HEAD');
    }
  } });
  assert.equal(checks, 2); assert.equal(result.published, true);
  assert.equal(repo.git(repo.work, 'merge-base', concurrentSha, result.sha!), concurrentSha);
});

test('non-fast-forward update-branch race merges without force and reruns gates', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  repo.git(repo.work, 'push', 'origin', `HEAD:${UPDATE_BRANCH}`);
  repo.git(repo.concurrent, 'fetch', 'origin', UPDATE_BRANCH);
  repo.git(repo.concurrent, 'checkout', '-b', UPDATE_BRANCH, `origin/${UPDATE_BRANCH}`);
  await writeFile(join(repo.work, DATA), 'new data');
  let checks = 0; let raced = false;
  const result = publishBudgetUpdate({ run: (command, args) => {
    if (command === 'git' && args[0] === 'push' && !raced) {
      raced = true;
      repo.git(repo.concurrent, 'commit', '--allow-empty', '-m', 'concurrent update branch');
      repo.git(repo.concurrent, 'push', 'origin', UPDATE_BRANCH);
    }
    return repo.run(command, args);
  }, checks: () => { checks++; } });
  assert.equal(checks, 2); assert.equal(result.published, true);
  const concurrentSha = repo.git(repo.concurrent, 'rev-parse', 'HEAD');
  assert.equal(repo.git(repo.work, 'merge-base', concurrentSha, result.sha!), concurrentSha);
});

test('a conflicting concurrent data update aborts instead of overwriting remote data', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  repo.git(repo.work, 'push', 'origin', `HEAD:${UPDATE_BRANCH}`);
  repo.git(repo.concurrent, 'fetch', 'origin', UPDATE_BRANCH);
  repo.git(repo.concurrent, 'checkout', '-b', UPDATE_BRANCH, `origin/${UPDATE_BRANCH}`);
  await writeFile(join(repo.concurrent, DATA), 'concurrent data');
  repo.git(repo.concurrent, 'add', DATA); repo.git(repo.concurrent, 'commit', '-m', 'concurrent data');
  repo.git(repo.concurrent, 'push', 'origin', UPDATE_BRANCH);
  const remote = repo.git(repo.concurrent, 'rev-parse', 'HEAD');
  await writeFile(join(repo.work, DATA), 'our data');
  assert.throws(() => publishBudgetUpdate({ run: repo.run, checks: () => {} }), /Concurrent changes conflict/);
  assert.equal(repo.git(repo.work, 'ls-remote', '--heads', 'origin', UPDATE_BRANCH).split(/\s/)[0], remote);
  assert.equal(repo.git(repo.work, 'status', '--porcelain'), '');
});

test('push retry is bounded to three attempts', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'new data'); let pushes = 0; let checks = 0;
  assert.throws(() => publishBudgetUpdate({ run: (command, args) => {
    if (command === 'git' && args[0] === 'push') { pushes++; return { status: 1, stdout: 'rejected' }; }
    return repo.run(command, args);
  }, checks: () => { checks++; } }), /after 3 attempts/);
  assert.equal(pushes, 3); assert.equal(checks, 3);
});

test('prepare preserves prior unmerged data and rejects non-data changes on the dedicated branch', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'previous unmerged batch');
  publishBudgetUpdate({ run: repo.run, checks: () => {} });
  repo.git(repo.work, 'checkout', 'main');
  prepareBudgetUpdate({ run: repo.run });
  assert.equal(await readFile(join(repo.work, DATA), 'utf8'), 'previous unmerged batch');
  await writeFile(join(repo.work, 'README.md'), 'unexpected'); repo.git(repo.work, 'add', '.'); repo.git(repo.work, 'commit', '-m', 'unexpected');
  repo.git(repo.work, 'push', 'origin', UPDATE_BRANCH); repo.git(repo.work, 'checkout', 'main');
  assert.throws(() => prepareBudgetUpdate({ run: repo.run }), /non-data changes/);
});

test('rechecking an unchanged open update PR creates no new data commit or PR', async t => {
  const repo = await repository(t); prepareBudgetUpdate({ run: repo.run });
  await writeFile(join(repo.work, DATA), 'previous unmerged batch');
  publishBudgetUpdate({ run: repo.run, checks: () => {} });
  const before = repo.git(repo.work, 'rev-parse', 'HEAD');
  const calls: string[][] = [];
  const result = publishBudgetUpdate({ run: (command, args) => {
    if (command === 'gh') { calls.push(args); return { status: 0, stdout: '25' }; }
    return repo.run(command, args);
  }, checks: () => {} });
  assert.equal(result.sha, before);
  assert.equal(repo.git(repo.work, 'rev-parse', 'HEAD'), before);
  assert.equal(calls.some(args => args[1] === 'create'), false);
});
