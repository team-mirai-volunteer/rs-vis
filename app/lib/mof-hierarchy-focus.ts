import { buildAdjacency, focusSankey } from '@/app/lib/sankey-focus';
export { relatedNodeIds } from '@/app/lib/sankey-focus';

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
export function focusHierarchy(nodes: MOFHierarchyNode[], links: SankeyLink[], selectedId: string): { nodes: MOFHierarchyNode[]; links: SankeyLink[] } {
  return focusSankey(nodes, links, selectedId, { columnIndex: column => COLUMN_INDEX.get(column as MOFHierarchyColumn) ?? 0, downstream: 'aggregates' });
}
