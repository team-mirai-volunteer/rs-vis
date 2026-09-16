import type { SankeyLink } from '@/types/sankey';

type FocusNode = { id: string; value?: number; details: { column: string; aggregated?: boolean } };

export function buildAdjacency(links: SankeyLink[]) {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    parentsOf.set(link.target, [...(parentsOf.get(link.target) ?? []), link.source]);
    childrenOf.set(link.source, [...(childrenOf.get(link.source) ?? []), link.target]);
  }
  return { parentsOf, childrenOf };
}

/** 選択したノードに連なる集合（自分・すべての祖先・すべての子孫） */
export function relatedNodeIds(links: SankeyLink[], selectedId: string): Set<string> {
  const { parentsOf, childrenOf } = buildAdjacency(links);
  const set = new Set<string>([selectedId]);
  const up = [selectedId];
  while (up.length > 0) {
    const id = up.pop() as string;
    for (const parent of parentsOf.get(id) ?? []) {
      if (set.has(parent)) continue;
      set.add(parent);
      up.push(parent);
    }
  }
  const down = [selectedId];
  while (down.length > 0) {
    const id = down.pop() as string;
    for (const child of childrenOf.get(id) ?? []) {
      if (set.has(child)) continue;
      set.add(child);
      down.push(child);
    }
  }
  return set;
}

/** Focus a column-ordered DAG without changing the input graph. */
export function focusSankey<N extends FocusNode>(nodes: N[], links: SankeyLink[], selectedId: string,
  options: { columnIndex: (column: string) => number; downstream: 'aggregates' | 'all' }): { nodes: N[]; links: SankeyLink[] } {
  if (!nodes.some(n => n.id === selectedId)) return { nodes: [], links: [] };
  const related = relatedNodeIds(links, selectedId);
  const { parentsOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const colOf = (id: string) => options.columnIndex(nodeById.get(id)?.details.column ?? '');


  const ancestors = new Set<string>();
  {
    const stack = [selectedId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      for (const parent of parentsOf.get(id) ?? []) {
        if (ancestors.has(parent)) continue;
        ancestors.add(parent);
        stack.push(parent);
      }
    }
  }

  // Exclude ancestor-to-descendant shortcuts that bypass the selected node.
  const visibleLinks = links.filter(l => related.has(l.source) && related.has(l.target)
    && (!ancestors.has(l.source) || ancestors.has(l.target) || l.target === selectedId)).map(l => ({ ...l }));
  const value = new Map<string, number>();
  value.set(selectedId, nodeById.get(selectedId)?.value ?? 0);
  const upstream = [...ancestors].sort((a, b) => colOf(b) - colOf(a));
  for (const id of upstream) {
    let sum = 0;
    for (const link of visibleLinks) {
      if (link.source !== id) continue;
      const child = link.target;
      if (child !== selectedId && !ancestors.has(child)) continue;
      const original = nodeById.get(child)?.value ?? 0;
      const ratio = original > 0 ? (value.get(child) ?? 0) / original : 0;
      sum += link.value * ratio;
    }
    value.set(id, sum);
  }
  for (const link of visibleLinks) {
    if (!ancestors.has(link.source)) continue;
    const child = link.target;
    if (child !== selectedId && !ancestors.has(child)) continue;
    const original = nodeById.get(child)?.value ?? 0;
    const ratio = original > 0 ? (value.get(child) ?? 0) / original : 0;
    link.value *= ratio;
  }

  // 下流: 選択ノード以外の子孫は、流入に合わせて値と流出を縮める（列順に）
  const downstream = nodes
    .filter(n => related.has(n.id) && !ancestors.has(n.id) && n.id !== selectedId && (options.downstream === 'all' || n.details.aggregated))
    .sort((a, b) => colOf(a.id) - colOf(b.id));
  for (const node of downstream) {
    const inflow = visibleLinks.filter(l => l.target === node.id).reduce((s, l) => s + l.value, 0);
    value.set(node.id, inflow);
    const outgoing = visibleLinks.filter(l => l.source === node.id);
    const outflow = outgoing.reduce((s, l) => s + l.value, 0);
    if (outflow <= 0) continue;
    const ratio = options.downstream === 'all' ? Math.min(1, inflow / outflow) : inflow / outflow;
    for (const link of outgoing) link.value *= ratio;
  }

  const visibleNodes = nodes
    .filter(n => related.has(n.id))
    .map(n => {
      const next = value.get(n.id);
      return next === undefined ? n : { ...n, value: next };
    })
    .filter(n => options.downstream !== 'all' || (n.value ?? 0) > 0);
  const ids = new Set(visibleNodes.map(n => n.id));
  return { nodes: visibleNodes, links: visibleLinks.filter(l => (options.downstream !== 'all' || l.value > 0) && ids.has(l.source) && ids.has(l.target)) };
}
