/**
 * 統合ビューの「選択したノードに連なる筋」の計算（純関数）。
 *
 * `mof-section-rs-focus.ts` と同じアルゴリズムを、列の集合を UnifiedColumn に替えて持つ。
 * 集約ノード（「N項」）は複数の親から流れ込むので、祖先も按分も枝分かれ前提で書く。
 */

import type { SankeyLink } from '@/types/sankey';
import type { UnifiedColumn } from '@/types/unified-budget';
import type { UnifiedViewNode } from '@/types/unified-budget-view';
import { columnIndex } from './transform';

function buildAdjacency(links: SankeyLink[]) {
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

/**
 * 選択ノードの子孫を列ごとに、選択ノードからの寄与額（辺を按分して伝播）で並べる。
 * 事業列は複数の目から流入するので、ノードの値ではなく辺の値を使う。
 */
export function descendantsByColumn(nodes: UnifiedViewNode[], links: SankeyLink[], selectedId: string): Map<UnifiedColumn, UnifiedViewNode[]> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map<string, SankeyLink[]>();
  for (const l of links) outgoing.set(l.source, [...(outgoing.get(l.source) ?? []), l]);
  const weight = new Map<string, number>();
  weight.set(selectedId, nodeById.get(selectedId)?.value ?? 0);
  // 列順に伝播（DAG なので列の昇順で処理すれば親が先に確定する）
  const order = [...nodes].sort((a, b) => columnIndex(a.details.column) - columnIndex(b.details.column));
  for (const n of order) {
    const w = weight.get(n.id);
    if (!w) continue;
    const outs = outgoing.get(n.id) ?? [];
    const total = outs.reduce((s, l) => s + l.value, 0);
    if (total <= 0) continue;
    const ratio = Math.min(1, w / Math.max(n.value, 1e-9));
    for (const l of outs) weight.set(l.target, (weight.get(l.target) ?? 0) + l.value * ratio);
  }
  const result = new Map<UnifiedColumn, UnifiedViewNode[]>();
  for (const [id, w] of weight) {
    if (id === selectedId || w <= 0) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    const list = result.get(node.details.column) ?? [];
    list.push({ ...node, value: w });
    result.set(node.details.column, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => {
      const byAgg = (a.details.aggregated ? 1 : 0) - (b.details.aggregated ? 1 : 0);
      return byAgg !== 0 ? byAgg : b.value - a.value;
    });
  }
  return result;
}

/** 選択ノードの祖先を列ごとに、選択ノードへの寄与額（辺を按分して逆伝播）で並べる */
export function ancestorsByColumn(nodes: UnifiedViewNode[], links: SankeyLink[], selectedId: string): Map<UnifiedColumn, UnifiedViewNode[]> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map<string, SankeyLink[]>();
  for (const l of links) incoming.set(l.target, [...(incoming.get(l.target) ?? []), l]);
  const weight = new Map<string, number>();
  weight.set(selectedId, nodeById.get(selectedId)?.value ?? 0);
  const order = [...nodes].sort((a, b) => columnIndex(b.details.column) - columnIndex(a.details.column));
  for (const n of order) {
    const w = weight.get(n.id);
    if (!w) continue;
    const ins = incoming.get(n.id) ?? [];
    const total = ins.reduce((s, l) => s + l.value, 0);
    if (total <= 0) continue;
    const ratio = Math.min(1, w / Math.max(total, 1e-9));
    for (const l of ins) weight.set(l.source, (weight.get(l.source) ?? 0) + l.value * ratio);
  }
  const result = new Map<UnifiedColumn, UnifiedViewNode[]>();
  for (const [id, w] of weight) {
    if (id === selectedId || w <= 0) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    const list = result.get(node.details.column) ?? [];
    list.push({ ...node, value: w });
    result.set(node.details.column, list);
  }
  for (const list of result.values()) list.sort((a, b) => b.value - a.value);
  return result;
}

/**
 * 選択した筋だけのノードとリンクを作る。金額は2方向に付け替える（mof-section-rs-focus.focusHierarchy と同じ）。
 * 上流: 選択ノードの値を祖先へ比例配分で遡らせる。下流: 集約ノードの流出を流入に合わせて縮める。
 */
export function focusGraph(nodes: UnifiedViewNode[], links: SankeyLink[], selectedId: string): { nodes: UnifiedViewNode[]; links: SankeyLink[] } {
  const related = relatedNodeIds(links, selectedId);
  const { parentsOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const colOf = (id: string) => columnIndex(nodeById.get(id)?.details.column ?? 'account');

  const visibleLinks: SankeyLink[] = links.filter(l => related.has(l.source) && related.has(l.target)).map(l => ({ ...l }));

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
    .filter(n => related.has(n.id) && !ancestors.has(n.id) && n.id !== selectedId)
    .sort((a, b) => colOf(a.id) - colOf(b.id));
  for (const node of downstream) {
    const inflow = visibleLinks.filter(l => l.target === node.id).reduce((s, l) => s + l.value, 0);
    value.set(node.id, inflow);
    const outgoing = visibleLinks.filter(l => l.source === node.id);
    const outflow = outgoing.reduce((s, l) => s + l.value, 0);
    if (outflow <= 0) continue;
    const ratio = Math.min(1, inflow / outflow);
    for (const link of outgoing) link.value *= ratio;
  }

  const visibleNodes = nodes
    .filter(n => related.has(n.id))
    .map(n => {
      const next = value.get(n.id);
      return next === undefined ? n : { ...n, value: next };
    })
    .filter(n => n.value > 0);
  const ids = new Set(visibleNodes.map(n => n.id));
  return { nodes: visibleNodes, links: visibleLinks.filter(l => l.value > 0 && ids.has(l.source) && ids.has(l.target)) };
}
