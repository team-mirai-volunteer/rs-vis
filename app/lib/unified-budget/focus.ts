import { focusSankey, relatedNodeIds as relatedByLinks } from '@/app/lib/sankey-focus';

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

/** 金額の辺がない双子も、同じ事業として選択・強調表示する。 */
function projectSeeds(nodes: UnifiedViewNode[], links: SankeyLink[], selectedId: string): Set<string> {
  const related = relatedByLinks(links, selectedId);
  const projectIds = new Set(nodes.filter(n => related.has(n.id)
    && (n.details.column === 'program' || n.details.column === 'program-spending'))
    .map(n => n.details.projectId).filter(id => id !== undefined));
  return new Set([selectedId, ...nodes.filter(n => n.details.projectId !== undefined
    && projectIds.has(n.details.projectId)
    && (n.details.column === 'program' || n.details.column === 'program-spending')
    && !related.has(n.id)).map(n => n.id)]);
}

export function relatedNodeIds(links: SankeyLink[], selectedId: string, nodes: UnifiedViewNode[] = []): Set<string> {
  const related = new Set<string>();
  for (const seed of projectSeeds(nodes, links, selectedId)) {
    for (const id of relatedByLinks(links, seed)) related.add(id);
  }
  return related;
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
  const focusedNodes = new Map<string, UnifiedViewNode>();
  const focusedLinks = new Map<string, SankeyLink>();
  for (const seed of projectSeeds(nodes, links, selectedId)) {
    const branch = focusSankey(nodes, links, seed, { columnIndex: column => columnIndex(column as UnifiedColumn), downstream: 'all' });
    for (const n of branch.nodes) if (!focusedNodes.has(n.id)) focusedNodes.set(n.id, n);
    // 0円で孤立した選択ノードも描画対象にする。
    const selected = nodes.find(n => n.id === seed);
    if (selected && (selected.details.kind === 'rs' || selected.details.aggregated)
      && (selected.details.column === 'program' || selected.details.column === 'program-spending')
      && !focusedNodes.has(seed)) focusedNodes.set(seed, selected);
    for (const l of branch.links) {
      const key = `${l.source}→${l.target}`;
      if (!focusedLinks.has(key)) focusedLinks.set(key, l);
    }
  }
  const focused = { nodes: nodes.filter(n => focusedNodes.has(n.id)).map(n => focusedNodes.get(n.id)!), links: [...focusedLinks.values()] };
  const original = new Map(nodes.map(n => [n.id, n]));
  return { ...focused, nodes: focused.nodes.map(n => n.details.column === 'account'
    ? { ...n, value: Math.min(n.value, original.get(n.id)?.value ?? n.value) } : n) };
}
