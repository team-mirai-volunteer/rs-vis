/**
 * filter.scores（政策評価スコアの範囲）: 検証・URL 往復・事業の除外判定・サンキー図の絞り込みへの写し。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveFilter, hasScoreFilter, resolveSankeyQuery, sankeyQueryFromUrlParams, sankeyQueryToUrlParams, scoreExcluder } from '../app/lib/sankey-query';
import { applySankeyQueryToUnifiedFilter, clearAiFilter } from '../client/lib/unified-ai-filter';
import { UNIFIED_FILTER_DEFAULT, hasActiveUnifiedFilter } from '../types/unified-budget-view';
import { parseFilter, serializeFilter } from '../app/lib/unified-budget/filter-url';

test('resolveSankeyQuery: scores は 0〜100・min <= max・既知の項目だけ', () => {
  const ok = resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { max: 40 }, evidence: { min: 60, max: 80 } } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.query.filter.scores.overall, { min: null, max: 40 });
  assert.deepEqual(ok.query.filter.scores.evidence, { min: 60, max: 80 });
  assert.deepEqual(ok.query.filter.scores.design, { min: null, max: null });
  assert.ok(hasScoreFilter(ok.query.filter));
  assert.ok(hasActiveFilter(ok.query.filter));
  assert.ok(resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { max: 150 } } } }).errors.length > 0);
  assert.ok(resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { min: 80, max: 40 } } } }).errors.length > 0);
  assert.ok(resolveSankeyQuery({ year: '2025', filter: { scores: { bogus: { max: 1 } } as never } }).errors.length > 0);
  assert.equal(hasScoreFilter(resolveSankeyQuery({ year: '2025' }).query.filter), false);
});

test('URL: fsc_<項目>=min-max で往復する', () => {
  const { query } = resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { max: 40 }, necessity: { min: 70 } } } });
  const params = sankeyQueryToUrlParams(query);
  assert.equal(params.get('fsc_overall'), '-40');
  assert.equal(params.get('fsc_necessity'), '70-');
  assert.deepEqual(sankeyQueryFromUrlParams(params).filter?.scores, { overall: { min: null, max: 40 }, necessity: { min: 70, max: null } });
});

test('scoreExcluder: 範囲外と評価なしを落とす。条件が無ければ null', () => {
  const { query } = resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { max: 40 }, proportionality: { min: 50 } } } });
  const scores = new Map([
    ['1', { overall: 30, proportionality: 60 }],
    ['2', { overall: 30, proportionality: 10 }],
    ['3', { overall: 90, proportionality: 90 }],
    ['4', { overall: null, proportionality: 90 }],
  ]);
  const exclude = scoreExcluder(query.filter, scores)!;
  assert.equal(exclude(1), false);
  assert.equal(exclude(2), true, '費用対内容が下限未満');
  assert.equal(exclude(3), true, '総合点が上限超え');
  assert.equal(exclude(4), true, '評価なし');
  assert.equal(exclude(99), true, 'データに無い事業');
  assert.equal(scoreExcluder(resolveSankeyQuery({ year: '2025' }).query.filter, scores), null);
});

test('AI の scores はサンキー図の 6 項目の絞り込みに写り、URL でも往復し、解除で消える', () => {
  const { query } = resolveSankeyQuery({ year: '2025', filter: { scores: { overall: { max: 40 }, design: { min: 20, max: 60 } } } });
  const { filter, summary } = applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, query);
  assert.deepEqual(filter.scoreO, { min: '', max: '40' });
  assert.deepEqual(filter.scoreD, { min: '20', max: '60' });
  assert.deepEqual(filter.scoreX, { min: '', max: '' });
  assert.match(summary, /総合点 0〜40点/);
  assert.match(summary, /成果設計 20〜60点/);
  assert.ok(hasActiveUnifiedFilter(filter));
  const params = new URLSearchParams();
  serializeFilter(params, filter);
  assert.equal(params.get('fso'), '-40');
  assert.equal(params.get('fsdg'), '20-60');
  assert.deepEqual(parseFilter(params).scoreD, { min: '20', max: '60' });
  const cleared = clearAiFilter(filter);
  assert.deepEqual(cleared.scoreO, { min: '', max: '' });
  assert.deepEqual(cleared.scoreD, { min: '', max: '' });
});
