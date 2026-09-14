import test from 'node:test';
import assert from 'node:assert/strict';
import { RS_MINISTRY_UNKNOWN, applyFilter, toRsMinistryGraph } from '../app/lib/unified-budget/transform';
import { RS_TOTAL_ID } from '../types/unified-budget';
import { UNIFIED_FILTER_DEFAULT, type UnifiedViewGraph, type UnifiedViewNode } from '../types/unified-budget-view';

const node = (id: string, column: UnifiedViewNode['details']['column'], value: number, details: Partial<UnifiedViewNode['details']> = {}): UnifiedViewNode => ({
  id,
  name: id,
  value,
  type: column,
  details: { column, ...details },
});
const link = (source: string, target: string, value: number) => ({ source, target, value });

/**
 * MOF 所管「内閣府及び厚生労働省」の目から、RS 府省庁が「厚生労働省」「内閣府」の事業へ流れる小さな統合グラフ。
 * 事業3 は目に対応せず outside からだけ流入。国債費（非事業）も混ぜる
 */
function sample(): UnifiedViewGraph {
  const nodes = [
    node('acc-general', 'account', 1450, { accountType: 'general' }),
    node('min-内閣府及び厚生労働省', 'ministry', 1450, { ministry: '内閣府及び厚生労働省' }),
    node('sec-A', 'section', 1450, { ministry: '内閣府及び厚生労働省', accountType: 'general' }),
    node('kou-A', 'koumoku', 1450, { ministry: '内閣府及び厚生労働省', accountType: 'general' }),
    node('outside', 'koumoku', 50, { kind: 'outside', standalone: true }),
    node('project-budget-1', 'program', 100, { kind: 'rs', projectId: 1, rsMinistry: '厚生労働省' }),
    node('project-budget-2', 'program', 300, { kind: 'rs', projectId: 2, rsMinistry: '内閣府' }),
    node('project-budget-3', 'program', 50, { kind: 'rs', projectId: 3, rsMinistry: '厚生労働省' }),
    node('project-budget-4', 'program', 20, { kind: 'rs', projectId: 4 }),
    node('np-debt', 'program', 1000, { kind: 'debt' }),
    node('project-spending-1', 'program-spending', 80, { kind: 'rs', projectId: 1 }),
    node('r-X', 'recipient', 80),
  ];
  const links = [
    link('acc-general', 'min-内閣府及び厚生労働省', 1450),
    link('min-内閣府及び厚生労働省', 'sec-A', 1450),
    link('sec-A', 'kou-A', 1450),
    link('kou-A', 'project-budget-1', 100),
    link('kou-A', 'project-budget-2', 300),
    link('kou-A', 'project-budget-4', 20),
    link('kou-A', 'np-debt', 1000),
    link('outside', 'project-budget-3', 50),
    link('project-budget-1', 'project-spending-1', 80),
    link('project-spending-1', 'r-X', 80),
  ];
  return { nodes, links };
}

test('府省庁基準: MOF 側を捨てて RS府省庁 → 事業 に組み替える', () => {
  const g = toRsMinistryGraph(sample());
  const cols = new Set(g.nodes.map(n => n.details.column));
  assert.deepEqual([...cols].sort(), ['account', 'ministry', 'program', 'program-spending', 'recipient']);
  assert.ok(!g.nodes.some(n => n.id === 'min-内閣府及び厚生労働省' || n.id === 'acc-general'));
  assert.ok(!g.nodes.some(n => n.id === 'np-debt' || n.id === 'outside'));

  const byId = new Map(g.nodes.map(n => [n.id, n]));
  // 府省庁の値は配下事業の合計。outside からしか流入の無い事業3 も RS 値で入る
  assert.equal(byId.get('min-rs-厚生労働省')?.value, 150);
  assert.equal(byId.get('min-rs-内閣府')?.value, 300);
  assert.equal(byId.get(`min-rs-${RS_MINISTRY_UNKNOWN}`)?.value, 20);
  assert.equal(byId.get('min-rs-厚生労働省')?.details.ministry, '厚生労働省');
  // 予算総計（旧サンキー図の total）は会計列に置き、府省庁の合計
  assert.equal(byId.get(RS_TOTAL_ID)?.value, 470);
  assert.equal(byId.get(RS_TOTAL_ID)?.details.column, 'account');
  assert.ok(g.links.some(l => l.source === RS_TOTAL_ID && l.target === 'min-rs-内閣府' && l.value === 300));
  // 事業 → 支出 → 支出先は残る
  assert.ok(g.links.some(l => l.source === 'project-budget-1' && l.target === 'project-spending-1' && l.value === 80));
  assert.equal(byId.get('r-X')?.value, 80);
  assert.ok(g.links.some(l => l.source === 'min-rs-厚生労働省' && l.target === 'project-budget-1' && l.value === 100));
});

test('府省庁基準でも所管の絞り込みは RS の府省庁名で効く', () => {
  const g = applyFilter(toRsMinistryGraph(sample()), { ...UNIFIED_FILTER_DEFAULT, ministries: ['厚生労働省'] });
  const ids = new Set(g.nodes.map(n => n.id));
  assert.ok(ids.has('project-budget-1') && ids.has('project-budget-3') && ids.has('r-X'));
  assert.ok(!ids.has('project-budget-2') && !ids.has('min-rs-内閣府'));
  assert.equal(g.nodes.find(n => n.id === RS_TOTAL_ID)?.value, 150); // 総計も絞り込み後の合計に縮む
});
