/**
 * 予算→項→RS紐づけサンキーの絞り込み（選択したノードに連なる筋だけを取り出す）。
 *
 * `mof-hierarchy-focus.ts` と同じ考え方・同じアルゴリズム（列の集合が違うだけ）。
 * 純粋関数で React にも DOM にも依存しない（描画は client/components/mof-section-rs-sankey/）。
 *
 * **親は1つとは限らない。**「その他」は複数の親から流れ込む集約なので、
 * 祖先をたどる処理も金額の按分も、枝が分かれる前提で書く必要がある。
 */

import type { MOFSectionRsColumn, MOFSectionRsNode } from '@/types/mof-section-rs-sankey';
import { MOF_SECTION_RS_COLUMNS } from '@/types/mof-section-rs-sankey';
import type { SankeyLink } from '@/types/sankey';

const COLUMN_INDEX = new Map(MOF_SECTION_RS_COLUMNS.map((c, i) => [c, i]));

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
 * サイドパネルのタブに使う（/mof-hierarchy と同じ）。
 */
export function descendantsByColumn(
  nodes: MOFSectionRsNode[],
  links: SankeyLink[],
  selectedId: string
): Map<MOFSectionRsColumn, MOFSectionRsNode[]> {
  const { childrenOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const result = new Map<MOFSectionRsColumn, MOFSectionRsNode[]>();

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
 * 選択したノードの祖先を、列ごとに金額の大きい順でまとめる。descendantsByColumn の逆方向版。
 * サイドパネルのタブに使う。
 *
 * 所管→組織/特会→勘定/業務→項は親が1つの木構造なので、選択ノード自身の値を
 * そのまま祖先へ伝播すればよい（祖先ノード自身の value はその祖先配下の全件合計で、
 * 選択ノード固有の寄与額ではないため使えない）。
 *
 * 例外は rsStatus列（1つのRS事業が複数の項から計上されうる）。この列を選択した場合だけ、
 * 直上の項への伝播をノードの value ではなくエッジの value（=各項からの寄与額）で按分する。
 * それより上（組織/勘定/所管）は項が単一の親しか持たないため、按分後の重みをそのまま伝播できる。
 */
export function ancestorsByColumn(
  nodes: MOFSectionRsNode[],
  links: SankeyLink[],
  selectedId: string
): Map<MOFSectionRsColumn, MOFSectionRsNode[]> {
  const { parentsOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const selected = nodeById.get(selectedId);
  if (!selected) return new Map();

  const isRsStatus = selected.details.column === 'rsStatus';
  let frontier: Array<{ id: string; weight: number }> = (parentsOf.get(selectedId) ?? []).map(parentId => ({
    id: parentId,
    weight: isRsStatus
      ? (links.find(l => l.source === parentId && l.target === selectedId)?.value ?? 0)
      : (selected.value ?? 0),
  }));

  const weightByColumnAndId = new Map<MOFSectionRsColumn, Map<string, number>>();
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { id, weight } of frontier) {
      const node = nodeById.get(id);
      if (node && !node.details.passThrough && node.details.column !== 'total') {
        const columnMap = weightByColumnAndId.get(node.details.column) ?? new Map<string, number>();
        columnMap.set(id, (columnMap.get(id) ?? 0) + weight);
        weightByColumnAndId.set(node.details.column, columnMap);
      }
      for (const parent of parentsOf.get(id) ?? []) next.push({ id: parent, weight });
    }
    frontier = next;
  }

  const result = new Map<MOFSectionRsColumn, MOFSectionRsNode[]>();
  for (const [column, columnMap] of weightByColumnAndId) {
    const list = [...columnMap.entries()]
      .map(([id, value]) => ({ ...(nodeById.get(id) as MOFSectionRsNode), value }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    result.set(column, list);
  }
  return result;
}

/**
 * 指定した項（複数可）配下のRS事業を、事業ごとに寄与額を合算してまとめる。
 * サイドパネルの「RS事業」タブに使う。descendantsByColumn / ancestorsByColumn に
 * 任せられない理由は同じ: 1つのRS事業が複数の項から計上されうるため、
 * ノードの value ではなく項→RS事業の各エッジの value を合算する必要がある
 * （所管・組織・勘定を選んだときは、配下の項すべてを渡して合算する）。
 */
export function rsStatusBreakdown(nodes: MOFSectionRsNode[], links: SankeyLink[], sectionIds: string[]): MOFSectionRsNode[] {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const sectionIdSet = new Set(sectionIds);
  const weightById = new Map<string, number>();
  for (const link of links) {
    if (!sectionIdSet.has(link.source)) continue;
    const target = nodeById.get(link.target);
    if (!target || target.details.column !== 'rsStatus') continue;
    weightById.set(link.target, (weightById.get(link.target) ?? 0) + link.value);
  }
  return [...weightById.entries()]
    .map(([id, value]) => ({ ...(nodeById.get(id) as MOFSectionRsNode), value }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

/**
 * 選択した筋だけのノードとリンクを作る。金額は2方向に付け替える
 * （/mof-hierarchy の focusHierarchy と同じ。詳細はそちらの実装コメント参照）。
 */
export function focusHierarchy(
  nodes: MOFSectionRsNode[],
  links: SankeyLink[],
  selectedId: string
): { nodes: MOFSectionRsNode[]; links: SankeyLink[] } {
  const related = relatedNodeIds(links, selectedId);
  const { parentsOf } = buildAdjacency(links);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const columnOf = (id: string) => COLUMN_INDEX.get(nodeById.get(id)?.details.column ?? 'total') ?? 0;

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

  value.set(selectedId, nodeById.get(selectedId)?.value ?? 0);
  const upstream = [...ancestors].sort((a, b) => columnOf(b) - columnOf(a));
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

  const aggregates = nodes
    .filter(n => n.details.aggregated && related.has(n.id) && !ancestors.has(n.id))
    .filter(n => n.id !== selectedId)
    .sort((a, b) => columnOf(a.id) - columnOf(b.id));
  for (const aggregate of aggregates) {
    const inflow = visibleLinks.filter(l => l.target === aggregate.id).reduce((sum, l) => sum + l.value, 0);
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
