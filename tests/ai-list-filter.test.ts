/**
 * AI ナビの結果を一覧型ページの行に当てる判定（client/lib/ai/list-filter.ts）。
 * 行で判定できる条件（事業名・府省庁・予算額・事業 ID）と、サーバー評価済みの事業 ID 集合（resolvedPids）の優先。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiListFilterFrom, matchesAiListFilter } from '../client/lib/ai/list-filter';
import { resolveSankeyQuery } from '../app/lib/sankey-query';
import type { SankeyChatResult } from '../types/sankey-ai-chat';

function result(filter: Parameters<typeof resolveSankeyQuery>[0]['filter']): SankeyChatResult {
  const { query, errors } = resolveSankeyQuery({ year: '2025', filter });
  assert.deepEqual(errors, []);
  return { query, summary: { projects: { count: 0, budgetTotal: 0, spendingTotal: 0, top: [] }, recipients: { count: 0, top: [], topShare1: null, topShare3: null }, ministries: { count: 0, names: [] } } as SankeyChatResult['summary'] };
}
const item = { pid: '6498', name: '地域子ども・子育て支援に必要な経費', ministry: 'こども家庭庁', budget: 240072308000 };

test('行で判定できる条件: 事業名（部分一致・正規表現）・府省庁・予算額・事業 ID', () => {
  const byName = aiListFilterFrom(result({ projectName: { query: '子育て' } }));
  assert.equal(byName.unsupported.length, 0);
  assert.equal(matchesAiListFilter(byName, item), true);
  assert.equal(matchesAiListFilter(byName, { ...item, name: '道路事業' }), false);
  const byRegex = aiListFilterFrom(result({ projectName: { query: '子育て|保育', regex: true } }));
  assert.equal(matchesAiListFilter(byRegex, { ...item, name: '保育所の整備' }), true);
  const byMinistry = aiListFilterFrom(result({ ministries: ['こども家庭庁'], budget: { min: 10000000000 } }));
  assert.equal(matchesAiListFilter(byMinistry, item), true);
  assert.equal(matchesAiListFilter(byMinistry, { ...item, budget: 100 }), false);
  assert.equal(matchesAiListFilter(byMinistry, { ...item, ministry: '総務省' }), false);
  const byIds = aiListFilterFrom(result({ projectIds: ['1', '2'] }));
  assert.equal(matchesAiListFilter(byIds, item), false);
  assert.equal(matchesAiListFilter(byIds, { ...item, pid: '2' }), true);
});

test('支出先・支出額・再委託は行では判定できず unsupported に載る。resolvedPids があればそれだけで判定する', () => {
  const f = aiListFilterFrom(result({ recipientName: { query: 'NTTデータ' }, subcontract: { hasRedelegation: true } }));
  assert.deepEqual(f.unsupported, ['支出先「NTTデータ」', '再委託の有無']);
  // 部分適用のときは行の条件だけで判定するので通る
  assert.equal(matchesAiListFilter(f, item), true);
  // サーバー評価済みの集合があればそれが優先
  const resolved = { ...f, resolvedPids: new Set(['1', '7']), unsupported: [] };
  assert.equal(matchesAiListFilter(resolved, item), false);
  assert.equal(matchesAiListFilter(resolved, { ...item, pid: '7' }), true);
});

test('政策評価スコア・継続年数の条件も行では判定できず unsupported に載る（サーバーで事業 ID に解決する）', () => {
  const f = aiListFilterFrom(result({ scores: { overall: { max: 40 } }, yearsRunning: { min: 10 } }));
  assert.deepEqual(f.unsupported, ['政策評価スコア', '継続年数']);
  assert.equal(aiListFilterFrom(result({})).unsupported.length, 0);
});
