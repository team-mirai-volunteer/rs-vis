import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { twinConnectorPath, twinConnectors } from '../app/lib/unified-budget/twin-connectors';
import { toRsMinistryGraph, toViewGraph } from '../app/lib/unified-budget/transform';
import type { UnifiedViewDetails } from '../types/unified-budget-view';
import type { UnifiedGraph } from '../types/unified-budget';

type N = { id: string; value: number; details: UnifiedViewDetails };
const node = (id: string, column: 'program' | 'program-spending', value: number, extra: Partial<UnifiedViewDetails> = {}): N =>
  ({ id, value, details: { column, kind: 'rs', projectId: Number(id.slice(1)), ...extra } as UnifiedViewDetails });

test('帯の無い 事業 → 事業(支出) の組だけを点線にし、理由を付ける', () => {
  const nodes = [
    node('p1', 'program', 100), node('s1', 'program-spending', 80), // 帯あり
    node('p2', 'program', 0), node('s2', 'program-spending', 50), // 予算の記載なし
    node('p3', 'program', 70), node('s3', 'program-spending', 0), // 支出の記載なし
    node('p4', 'program', 0), node('s4', 'program-spending', 0), // どちらも無し
    node('s5', 'program-spending', 10), // 事業列に双子が無い
  ];
  const links = [{ source: { id: 'p1' }, target: { id: 's1' } }];
  const out = twinConnectors(nodes, links).map(t => [t.program.id, t.spending.id, t.reason]);
  assert.deepEqual(out, [['p2', 's2', 'no-budget'], ['p3', 's3', 'no-spending'], ['p4', 's4', 'both-empty']]);
});

test('非RSの事業区分は点線を引かない。集約ノードどうしはつなぐ', () => {
  const nodes = [
    node('p1', 'program', 0, { kind: 'transfer' }), node('s1', 'program-spending', 5),
    { id: 'pa', value: 0, details: { column: 'program', aggregated: true } as UnifiedViewDetails },
    { id: 'sa', value: 9, details: { column: 'program-spending', aggregated: true } as UnifiedViewDetails },
  ];
  assert.deepEqual(twinConnectors(nodes, []).map(t => [t.program.id, t.spending.id]), [['pa', 'sa']]);
});

test('点線は事業の右端中央から事業(支出)の左端中央へ', () => {
  assert.equal(twinConnectorPath({ x: 0, y: 0, width: 10, height: 20 }, { x: 110, y: 40, height: 10 }), 'M10,10 C60,10 60,45 110,45');
});

test('2024: デジタル庁の一括計上事業（予算0・支出あり）は点線でつながる', () => {
  const graph: UnifiedGraph = JSON.parse(gunzipSync(readFileSync(
    new URL('../public/data/unified-budget-2024-initial-graph.json.gz', import.meta.url),
  )).toString());
  const view = toRsMinistryGraph(toViewGraph(graph, { keepZeroPrograms: true }));
  const twins = twinConnectors(view.nodes, view.links.map(l => ({ source: { id: l.source }, target: { id: l.target } })));
  assert.ok(twins.length > 0);
  assert.ok(twins.some(t => t.reason === 'no-budget' && t.spending.name.includes('情報通信技術調達等適正・効率化推進費')));
  const linked = new Set(view.links.map(l => `${l.source}>${l.target}`));
  assert.ok(twins.every(t => !linked.has(`${t.program.id}>${t.spending.id}`)));
});
