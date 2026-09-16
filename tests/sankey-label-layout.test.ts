import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMOFSankeyLayout } from '../app/lib/mof-sankey-layout';

test('dense graphs reserve height for amounts independently of labels and scale ribbons linearly', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, value: i + 1 }));
  const total = rows.reduce((sum, n) => sum + n.value, 0);
  const input = { nodes: [...rows, { id: 'total', value: total }],
    links: rows.map(n => ({ source: n.id, target: 'total', value: n.value })) };
  const options = { width: 800, height: 500, margin: { top: 50, bottom: 20, left: 20, right: 20 }, nodeWidth: 14, nodePadding: 4, minNodeSlot: 15, flowScale: 1.25 };
  const normal = computeMOFSankeyLayout(input, options);
  const thick = computeMOFSankeyLayout(input, { ...options, flowScale: 2.5 });
  const largeLabels = computeMOFSankeyLayout(input, { ...options, minNodeSlot: 32 });
  assert.equal(normal.nodes.find(n => n.id === 'total')!.height, 430 * 1.25);
  assert.ok(normal.contentHeight > options.height);
  assert.deepEqual(largeLabels.nodes.map(n => n.height), normal.nodes.map(n => n.height));
  for (let i = 0; i < normal.links.length; i++) {
    assert.equal(thick.links[i].width, normal.links[i].width * 2);
    assert.ok(Math.abs(normal.links[i].width / normal.links[0].width - (i + 1)) < 1e-10);
    assert.ok(thick.links[i].width <= thick.links[i].source.height);
  }
});

test('larger label slots move rows without changing amounts, node thickness or ribbon thickness', () => {
  const input = { nodes: [{ id: 'a', value: 100 }, { id: 'b', value: 1 }, { id: 'c', value: 1 }, { id: 'd', value: 102 }],
    links: [{ source: 'a', target: 'd', value: 100 }, { source: 'b', target: 'd', value: 1 }, { source: 'c', target: 'd', value: 1 }] };
  const options = { width: 800, height: 500, margin: { top: 50, bottom: 20, left: 20, right: 20 }, nodeWidth: 14, nodePadding: 4, scaleNodeSlot: 15 };
  const normal = computeMOFSankeyLayout(input, { ...options, minNodeSlot: 15 });
  const large = computeMOFSankeyLayout(input, { ...options, width: 1200, minNodeSlot: 32 });
  assert.deepEqual(large.nodes.map(n => n.height), normal.nodes.map(n => n.height));
  assert.deepEqual(large.links.map(l => l.width), normal.links.map(l => l.width));
  const b = large.nodes.find(n => n.id === 'b')!, c = large.nodes.find(n => n.id === 'c')!;
  assert.ok(c.y + c.height / 2 - b.y - b.height / 2 >= 32);
  assert.ok(large.nodes.find(n => n.id === 'd')!.x > normal.nodes.find(n => n.id === 'd')!.x);
});
