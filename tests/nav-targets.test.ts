import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TARGETS, findNavTarget } from '../app/lib/ai/nav-targets';
import { PAGES } from '../components/navigation/pages';

test('AI ナビの移動先はすべて実在するページ（href が pages.ts と一致）', () => {
  const hrefs = new Set<string>(['/', ...PAGES.map(p => p.href)]);
  for (const t of NAV_TARGETS) assert.ok(hrefs.has(t.href), `${t.key} の href ${t.href} が pages.ts に無い`);
  // 主なビュー・補助ビューは全部移動先にある
  for (const p of PAGES.filter(p => p.primary || p.secondary)) {
    assert.ok(NAV_TARGETS.some(t => t.href === p.href), `${p.navLabel}（${p.href}）が移動先に無い`);
  }
  assert.equal(new Set(NAV_TARGETS.map(t => t.key)).size, NAV_TARGETS.length);
});

test('findNavTarget: 既知のキーだけ', () => {
  assert.equal(findNavTarget('sankey')?.href, '/budget-sankey');
  assert.equal(findNavTarget('nope'), null);
  assert.equal(findNavTarget(undefined), null);
});
