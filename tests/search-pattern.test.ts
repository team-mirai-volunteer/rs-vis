import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSearchPattern, SearchPatternError } from '../app/lib/search-pattern';
import { GET as hierarchy } from '../app/api/mof-hierarchy/route';
import { GET as section } from '../app/api/mof-sankey/route';
import { resolveSankeyQuery } from '../app/lib/sankey-query';

test('search supports Japanese, alternation, anchors and case-insensitive matching', () => {
  const match = compileSearchPattern('^(防災|giga).*事業$');
  assert.equal(match('GIGAスクール事業'), true);
  assert.equal(match('防災事業'), true);
  assert.equal(match('学校の防災事業'), false);
  assert.equal(compileSearchPattern('giga', false)('GIGA'), false);
});

test('adversarial matching does not backtrack exponentially', { timeout: 5000 }, () => {
  const text = 'a'.repeat(50000) + '!';
  for (const pattern of ['^(a+)+$', '^(a|aa)+$', '^([a-z]+)*$']) assert.equal(compileSearchPattern(pattern)(text), false);
  for (const pattern of ['a'.repeat(129), '(?=a)a', '(a)\\1', '(', '(a{1000}){1000}']) assert.throws(() => compileSearchPattern(pattern), SearchPatternError);
});

test('public filter APIs return 400 for oversized or unsupported regex, never a full-data success', async () => {
  for (const [get, path, key] of [[hierarchy, 'mof-hierarchy', 'filterSection'], [hierarchy, 'mof-hierarchy', 'filterItem'], [section, 'mof-sankey', 'filterSection']] as const) {
    for (const pattern of ['a'.repeat(129), '(?=a)a', '(a{1000}){1000}']) {
      const params = new URLSearchParams({ [key]: pattern, [`${key}Regex`]: '1' });
      const response = await get(new Request(`http://localhost/api/${path}?${params}`));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /正規表現/);
    }
  }
  assert.ok(resolveSankeyQuery({ filter: { projectName: { query: '(a)\\1', regex: true } } }).errors.length > 0);
});
