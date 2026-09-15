import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommentPrivacy, privacyFiles, privacyQuery } from '../scripts/apply-comment-privacy.mjs';

const config = () => ({ projectRef: 'abcdefghijklmnopqrst', token: 'test-only-token', ...privacyFiles() });

test('Terraform privacy repair verifies privileges before committing in one request', async () => {
  const calls = [];
  const result = await applyCommentPrivacy(config(), async (url, options) => {
    calls.push({ url, options });
    return new Response('[]', { status: 201 });
  });
  assert.equal(result.projectRef, config().projectRef);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${config().projectRef}/database/query`);
  const query = JSON.parse(calls[0].options.body).query;
  assert.equal((query.match(/^BEGIN;/gm) ?? []).length, 1);
  assert.equal((query.match(/^COMMIT;/gm) ?? []).length, 1);
  assert(!/^rollback;/im.test(query));
  assert(query.indexOf('has_column_privilege') > query.indexOf('revoke all'));
  assert(query.indexOf('has_column_privilege') < query.indexOf('COMMIT;'));
  assert(!query.includes(config().token));
});

test('missing credentials, changed plan files and invalid targets fail without contacting Supabase', async () => {
  let called = false;
  const request = async () => { called = true; return new Response('[]'); };
  await assert.rejects(applyCommentPrivacy({ ...config(), token: '' }, request), /SUPABASE_ACCESS_TOKEN/);
  await assert.rejects(applyCommentPrivacy({ ...config(), migrationHash: 'changed' }, request), /changed after planning/);
  await assert.rejects(applyCommentPrivacy({ ...config(), runnerHash: 'changed' }, request), /changed after planning/);
  await assert.rejects(applyCommentPrivacy({ ...config(), projectRef: '../wrong' }, request), /project reference/);
  assert.equal(called, false);
});

test('API and connection failures do not log tokens or arbitrary response bodies', async () => {
  await assert.rejects(applyCommentPrivacy(config(), async () => new Response(config().token, { status: 403 })),
    { message: 'Supabase rejected the permission repair (HTTP 403)' });
  await assert.rejects(applyCommentPrivacy(config(), async () => { throw new Error(config().token); }),
    { message: 'Supabase request failed; verify access and rerun this idempotent repair' });
  assert.throws(() => privacyQuery({ migration: Buffer.from('select 1;'), verification: Buffer.from('select 1;') }),
    /Expected one transaction/);
});
