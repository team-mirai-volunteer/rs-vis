import test from 'node:test';
import assert from 'node:assert/strict';
import { focusHierarchy as hierarchy } from '../app/lib/mof-hierarchy-focus';
import { focusHierarchy as section } from '../app/lib/mof-section-rs-focus';
import { focusGraph as unified } from '../app/lib/unified-budget/focus';
import { relatedNodeIds } from '../app/lib/sankey-focus';
import type { SankeyLink } from '../types/sankey';

type Node = { id: string; value: number; details: { column: string; aggregated?: boolean; passThrough?: boolean } };
const adapters = [
  { name: 'hierarchy', columns: ['total', 'ministry', 'organization', 'subAccount'], run: (n: Node[], l: SankeyLink[], id: string) => hierarchy(n as Parameters<typeof hierarchy>[0], l, id) },
  { name: 'section', columns: ['total', 'ministry', 'organization', 'subAccount'], run: (n: Node[], l: SankeyLink[], id: string) => section(n as Parameters<typeof section>[0], l, id) },
  { name: 'unified', columns: ['account', 'ministry', 'organization', 'section'], run: (n: Node[], l: SankeyLink[], id: string) => unified(n as Parameters<typeof unified>[0], l, id) },
];
const amounts = (nodes: { id: string; value?: number }[]) => Object.fromEntries(nodes.map(n => [n.id, n.value]));

for (const adapter of adapters) {
  const n = (id: string, value: number, col: number, aggregated = false): Node => ({ id, value, details: { column: adapter.columns[col], aggregated } });
  test(`${adapter.name}: shared descendants receive only the selected branch and inputs stay unchanged`, () => {
    const nodes = [n('root', 100, 0), n('a', 40, 1), n('b', 60, 1), n('shared', 100, 2, true), n('leaf', 100, 3, true)];
    const links = [{ source: 'root', target: 'a', value: 40 }, { source: 'root', target: 'b', value: 60 },
      { source: 'a', target: 'shared', value: 40 }, { source: 'b', target: 'shared', value: 60 }, { source: 'shared', target: 'leaf', value: 100 }];
    const before = JSON.stringify({ nodes, links });
    const result = adapter.run(nodes, links, 'a');
    assert.deepEqual(amounts(result.nodes), { root: 40, a: 40, shared: 40, leaf: 40 });
    assert.deepEqual(result.links.map(l => l.value), [40, 40, 40]);
    assert.equal(JSON.stringify({ nodes, links }), before);
    const aggregate = adapter.run(nodes, links, 'shared');
    assert.deepEqual(amounts(aggregate.nodes), { root: 100, a: 40, b: 60, shared: 100, leaf: 100 });
    assert.deepEqual(adapter.run(nodes, links, 'missing'), { nodes: [], links: [] });
    assert.deepEqual(adapter.run(nodes, links, 'root').links, links);
  });

  test(`${adapter.name}: multiple parents contribute proportionally, without unrelated siblings`, () => {
    const nodes = [n('root', 100, 0), n('a', 60, 1), n('b', 40, 1), n('selected', 50, 2), n('sibling', 50, 2)];
    const links = [{ source: 'root', target: 'a', value: 60 }, { source: 'root', target: 'b', value: 40 },
      { source: 'a', target: 'selected', value: 30 }, { source: 'a', target: 'sibling', value: 30 },
      { source: 'b', target: 'selected', value: 20 }, { source: 'b', target: 'sibling', value: 20 }];
    const result = adapter.run(nodes, links, 'selected');
    assert.deepEqual(amounts(result.nodes), { root: 50, a: 30, b: 20, selected: 50 });
    assert.deepEqual(result.links.map(l => l.value), [30, 20, 30, 20]);
  });

  test(`${adapter.name}: ancestor shortcuts cannot inflate selected-branch totals`, () => {
    const nodes = [n('root', 100, 0), n('selected', 40, 1), n('shared', 100, 2, true), n('leaf', 100, 3, true)];
    nodes[2].details.passThrough = true;
    const links = [{ source: 'root', target: 'selected', value: 40 }, { source: 'root', target: 'shared', value: 60 },
      { source: 'selected', target: 'shared', value: 40 }, { source: 'shared', target: 'leaf', value: 100 }];
    const result = adapter.run(nodes, links, 'selected');
    assert.deepEqual(amounts(result.nodes), { root: 40, selected: 40, shared: 40, leaf: 40 });
    assert.equal(result.links.some(l => l.source === 'root' && l.target === 'shared'), false);
    assert.equal((result.nodes.find(n => n.id === 'shared')?.details as { passThrough?: boolean }).passThrough, true);
    const zero = adapter.run([n('zero', 0, 0)], [], 'zero');
    assert.equal(zero.nodes.length, adapter.name === 'unified' ? 0 : 1);
    assert.equal(zero.links.length, 0);
  });
}

test('related traversal does not include siblings and terminates on a cycle', () => {
  assert.deepEqual([...relatedNodeIds([{ source: 'root', target: 'a', value: 1 }, { source: 'root', target: 'b', value: 1 }], 'a')].sort(), ['a', 'root']);
  assert.deepEqual([...relatedNodeIds([{ source: 'a', target: 'b', value: 1 }, { source: 'b', target: 'a', value: 1 }], 'a')].sort(), ['a', 'b']);
});
