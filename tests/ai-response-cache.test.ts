/**
 * サイト提供 AI の応答キャッシュの鍵。同じ会話・年度・文脈なら同じ鍵、どれかが違えば別の鍵。
 * 保存の本体（unstable_cache）は Next の実行環境が要るのでここでは扱わない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseCacheKey } from '../app/api/ai/_lib/response-cache';
import { isGiveUpMessage } from '../app/lib/ai/chat-core';

const messages = [{ role: 'user' as const, content: '再エネ関連で予算100億円以上の事業' }];

test('responseCacheKey: 同じ入力は同じ鍵、前後の空白は無視、会話・年度・ページが違えば別の鍵', () => {
  const a = responseCacheKey(messages, { year: '2025' });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(responseCacheKey([{ role: 'user', content: '  再エネ関連で予算100億円以上の事業 ' }], { year: '2025' }), a);
  assert.notEqual(responseCacheKey(messages, { year: '2024' }), a);
  assert.notEqual(responseCacheKey(messages, { year: '2025', page: '評価一覧' }), a);
  assert.notEqual(responseCacheKey([...messages, { role: 'assistant', content: 'x' }, { role: 'user', content: 'もっと絞って' }], { year: '2025' }), a);
  // 年度省略は既定年度（2024）と同じ鍵
  assert.equal(responseCacheKey(messages, {}), responseCacheKey(messages, { year: '2024' }));
});

test('isGiveUpMessage: 解釈できなかった定型文だけ true', () => {
  assert.equal(isGiveUpMessage('3事業がマッチしました。'), false);
  assert.equal(isGiveUpMessage('ご要望をフィルタ条件として解釈できませんでした。「再エネ関連で予算100億円以上」「経済産業省の事業だけ」のように、事業名・支出先名・府省庁・金額範囲を含めて具体的にお試しください。'), true);
});
