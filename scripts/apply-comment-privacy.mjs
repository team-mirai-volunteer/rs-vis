import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const migrationUrl = new URL('../supabase/migrations/20260915_comments_column_privileges.sql', import.meta.url);
const verificationUrl = new URL('../supabase/tests/comments_privileges.sql', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function privacyFiles() {
  const migration = readFileSync(migrationUrl);
  const verification = readFileSync(verificationUrl);
  return {
    migration, verification,
    migrationHash: hash(migration), verificationHash: hash(verification),
    runnerHash: hash(readFileSync(new URL(import.meta.url))),
  };
}

function transactionBody(sql, end) {
  // These are fixed, versioned files, not arbitrary SQL from an API caller.
  const begin = /^begin;\s*$/gim;
  const finish = new RegExp(`^${end};\\s*$`, 'gim');
  if ([...sql.matchAll(begin)].length !== 1 || [...sql.matchAll(finish)].length !== 1) {
    throw new Error('Expected one transaction in each privacy SQL file');
  }
  return sql.replace(begin, '').replace(finish, '');
}

export function privacyQuery(files = privacyFiles()) {
  const migration = transactionBody(files.migration.toString('utf8'), 'commit');
  const verification = transactionBody(files.verification.toString('utf8'), 'rollback');
  // Assertions must succeed BEFORE commit. A failure rolls back the grants/view.
  return `BEGIN;\n${migration}\n${verification}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;`;
}

export async function applyCommentPrivacy(config, request = fetch) {
  const { projectRef, token, migrationHash, verificationHash, runnerHash } = config;
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('A valid Supabase project reference is required');
  if (!token?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is required');
  const files = privacyFiles();
  if (migrationHash !== files.migrationHash || verificationHash !== files.verificationHash || runnerHash !== files.runnerHash) {
    throw new Error('Privacy files changed after planning; create a new Terraform plan');
  }
  let response;
  try {
    response = await request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: privacyQuery(files) }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    // Do not log request headers, the access token, or an arbitrary error body.
    throw new Error('Supabase request failed; verify access and rerun this idempotent repair');
  }
  if (!response.ok) throw new Error(`Supabase rejected the permission repair (HTTP ${response.status})`);
  await response.text();
  return { projectRef, migrationHash: files.migrationHash };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.includes('--check')) {
      privacyQuery();
      console.log('Privacy SQL files are ready; no database request was sent.');
    } else {
      const result = await applyCommentPrivacy({
        projectRef: process.env.COMMENT_PRIVACY_PROJECT_REF,
        token: process.env.SUPABASE_ACCESS_TOKEN,
        migrationHash: process.env.COMMENT_PRIVACY_MIGRATION_SHA256,
        verificationHash: process.env.COMMENT_PRIVACY_VERIFICATION_SHA256,
        runnerHash: process.env.COMMENT_PRIVACY_RUNNER_SHA256,
      });
      console.log(`Comment column privileges applied and verified: ${result.projectRef}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Permission repair failed');
    process.exitCode = 1;
  }
}
