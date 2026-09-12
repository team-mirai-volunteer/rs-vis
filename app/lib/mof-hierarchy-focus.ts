/**
 * 階層サンキーの絞り込み（選択したノードに連なる筋だけを取り出す）。
 *
 * 薄暗くするだけでは選んだ枝が細い線のままで、深い階層を追うという目的を果たせない。
 * 関連だけを取り出して配置を計算し直すために、ここで金額の付け替えまで済ませる。
 * 純粋関数で React にも DOM にも依存しない（描画は client/components/mof-hierarchy/）。
 *
 * **親は1つとは限らない。**「その他」は複数の親から流れ込む集約なので、
 * 祖先をたどる処理も金額の按分も、枝が分かれる前提で書く必要がある。
 */

import type { MOFHierarchyColumn, MOFHierarchyNode } from '@/types/mof-hierarchy';
import { MOF_HIERARCHY_COLUMNS } from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';

const COLUMN_INDEX = new Map(MOF_HIERARCHY_COLUMNS.map((c, i) => [c, i]));

/** 親→子・子→親の対応。集約ノードは親を複数持つ */
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
 * 選択したノードの子孫を、列ごとに金額の大きい順でまとめる。
 *
 * サイドパネルのタブ（/sankey-svg の「省庁／事業／支出先」タブと同じ考え方）に使う。
 * 選ぶたびに絞り込まなくても、パネルの中だけで下の階層を辿れるようにする。
 * 通過ノードは実体が無いので飛ばし、その子をこの列の子孫として直接数える。
 */
export function descendantsByColumn(
  nodes: MOFHierarchyNode[],
  links: SankeyLink[],
  selectedId: string
): Map<MOFHierarchyColumn, MOFHierarchyNode[]> {
  const { childrenOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const result = new Map<MOFHierarchyColumn, MOFHierarchyNode[]>();

  const visited = new Set<string>([selectedId]);
  const queue = [...(childrenOf.get(selectedId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeById.get(id);
    if (node && !node.details.passThrough) {
      const list = result.get(node.details.column) ?? [];
      list.push(node);
      result.set(node.details.column, list);
    }
    for (const child of childrenOf.get(id) ?? []) queue.push(child);
  }

  // 図（mof-hierarchy-sankey.ts の alive.sort）は集約ノードを列の末尾に固定して描く。
  // ここも同じ並びにしないと、金額次第で集約が一覧の中段に埋もれ、
  // 図で見た「末尾にある」という手がかりと食い違って探しにくくなる
  for (const list of result.values()) {
    list.sort((a, b) => {
      const byAggregated = (a.details.aggregated ? 1 : 0) - (b.details.aggregated ? 1 : 0);
      if (byAggregated !== 0) return byAggregated;
      return (b.value ?? 0) - (a.value ?? 0);
    });
  }
  return result;
}

/**
 * 選択した筋だけのノードとリンクを作る。
 *
 * 金額は2方向に付け替える。付け替えないと図の数字が破綻する。
 *
 * - **選択より上（祖先）**: その枝ぶんしか流れていない。全体の金額のままだと
 *   根が巨大なままで、選んだ枝が細い線に潰れる。親が複数ある集約を選んだときは、
 *   各親の実際の寄与（例: 35 と 40）をそのまま残す
 * - **選択より下の「その他」**: 複数の親で共有しているので、この枝から来た分だけに直す。
 *   さらに集約は次の列の集約へも流れるため、下流のリンクも同じ割合で縮める。
 *   これをしないと下流ほど金額が膨らみ、事項列の合計が根を超える
 */
export function focusHierarchy(
  nodes: MOFHierarchyNode[],
  links: SankeyLink[],
  selectedId: string
): { nodes: MOFHierarchyNode[]; links: SankeyLink[] } {
  const related = relatedNodeIds(links, selectedId);
  const { parentsOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const columnOf = (id: string) =>
    COLUMN_INDEX.get(nodeById.get(id)?.details.column ?? 'total') ?? 0;

  const visibleLinks: SankeyLink[] = links
    .filter(l => related.has(l.source) && related.has(l.target))
    .map(l => ({ ...l }));

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

  // --- 上流: 選択へ向かって流れている分だけを残す ---
  //
  // 選択に近い側から順に、下流の寄与を足し上げる。
  // 単一の親をたどるだけだと、複数の親を持つ集約を選んだときに片方の枝が消える。
  value.set(selectedId, nodeById.get(selectedId)?.value ?? 0);
  const upstream = [...ancestors].sort((a, b) => columnOf(b) - columnOf(a));
  for (const id of upstream) {
    let total = 0;
    for (const link of visibleLinks) {
      if (link.source !== id) continue;
      const child = link.target;
      if (child !== selectedId && !ancestors.has(child)) continue;
      const original = nodeById.get(child)?.value ?? 0;
      // 子の一部しか選択へ向かっていない場合は、その割合だけを遡らせる
      const ratio = original > 0 ? (value.get(child) ?? 0) / original : 0;
      total += link.value * ratio;
    }
    value.set(id, total);
  }
  for (const link of visibleLinks) {
    if (!ancestors.has(link.source)) continue;
    const child = link.target;
    if (child !== selectedId && !ancestors.has(child)) continue;
    const original = nodeById.get(child)?.value ?? 0;
    const ratio = original > 0 ? (value.get(child) ?? 0) / original : 0;
    link.value *= ratio;
  }

  // --- 下流: 共有している集約をこの枝から来た分だけに直す ---
  const aggregates = nodes
    .filter(n => n.details.aggregated && related.has(n.id) && !ancestors.has(n.id))
    .filter(n => n.id !== selectedId)
    .sort((a, b) => columnOf(a.id) - columnOf(b.id));
  for (const aggregate of aggregates) {
    const inflow = visibleLinks
      .filter(l => l.target === aggregate.id)
      .reduce((sum, l) => sum + l.value, 0);
    value.set(aggregate.id, inflow);
    const outgoing = visibleLinks.filter(l => l.source === aggregate.id);
    const outflow = outgoing.reduce((sum, l) => sum + l.value, 0);
    if (outflow <= 0) continue;
    const ratio = inflow / outflow;
    for (const link of outgoing) link.value *= ratio;
  }

  const visibleNodes = nodes
    .filter(n => related.has(n.id))
    .map(n => {
      const next = value.get(n.id);
      return next === undefined ? n : { ...n, value: next };
    });

  return { nodes: visibleNodes, links: visibleLinks };
}
