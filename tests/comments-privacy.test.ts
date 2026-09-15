import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { insertComment } from '../app/lib/comments/comments-store';

test('posting a summary never persists the private interview conversation', async () => {
  const requests: Record<string, unknown>[] = [];
  const db = createClient('https://example.supabase.co', 'test-service-role', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'comment-id' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const id = await insertComment(db, { pid: 'test', year: 2025, body: '公開する意見',
    transcript: [{ role: 'user', content: '個人の連絡先を含む会話' }], status: 'published', ipHash: 'hash' });
  assert.equal(id, 'comment-id');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, '公開する意見');
  assert.equal(requests[0].transcript, null);
  assert(!JSON.stringify(requests).includes('個人の連絡先'));
});
