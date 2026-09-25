import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInterviewMessages, buildOpeningQuestion, INTERVIEW_KICKOFF_TEXT } from '../app/lib/comments/interview-prompt';
import { nextInterviewerTurn } from '../client/lib/comments/interview-runner';

const ctx = { pid: '2826', year: '2025', projectName: '基礎年金給付に必要な経費' };

test('opening question is rule-based and does not call any API', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('should not be called'); }) as typeof fetch;
  try {
    for (const settings of [null, { apiKey: 'test-only-key', model: 'test/model' }]) {
      const text = await nextInterviewerTurn(ctx, [], { settings: settings as never });
      assert.equal(text, buildOpeningQuestion(ctx));
    }
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
  assert.match(buildOpeningQuestion(ctx), /基礎年金給付に必要な経費/);
});

test('history starting with the opening question still begins with a user message after system', () => {
  const messages = buildInterviewMessages(ctx, [
    { role: 'assistant', content: buildOpeningQuestion(ctx) },
    { role: 'user', content: '金額が大きいと思います' },
  ]);
  assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[1].content, INTERVIEW_KICKOFF_TEXT);
});

test('empty history keeps the hidden kickoff for API callers', () => {
  assert.deepEqual(buildInterviewMessages(ctx, []).slice(1), [{ role: 'user', content: INTERVIEW_KICKOFF_TEXT }]);
});
