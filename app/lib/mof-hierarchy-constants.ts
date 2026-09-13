/**
 * 階層サンキーの配色とレイアウト定数。
 *
 * 色は `/sankey-svg` の `sankey-svg-constants.ts` と同じ系統を使う。
 * 左（上流）ほど濃い緑、右（下流＝事業に近い）ほど橙にして、
 * 「上から下へ流れる」ことを色でも示す。集約ノードは灰色（`/sankey-svg` と同じ作法）。
 */

import {
  MOF_HIERARCHY_COLUMNS,
  type MOFHierarchyColumn,
} from '@/types/mof-hierarchy';

export const MOF_HIERARCHY_COLORS: Record<MOFHierarchyColumn, string> = {
  total: '#2d7d46',
  ministry: '#3a9a5c',
  organization: '#4db870',
  subAccount: '#7cc98f',
  section: '#e0a040',
  item: '#e07040',
};

/** 集約ノードの色。/sankey-svg と同じ */
export const AGGREGATED_COLOR = '#999999';

export function hierarchyNodeColor(node: {
  column?: MOFHierarchyColumn;
  aggregated?: boolean;
}): string {
  if (node.aggregated) return AGGREGATED_COLOR;
  return node.column ? MOF_HIERARCHY_COLORS[node.column] : AGGREGATED_COLOR;
}

/** 列の番号。配置計算に渡す */
export const HIERARCHY_COLUMN_INDEX: Record<MOFHierarchyColumn, number> =
  Object.fromEntries(MOF_HIERARCHY_COLUMNS.map((c, i) => [c, i])) as Record<
    MOFHierarchyColumn,
    number
  >;

export const MOF_HIERARCHY_LAYOUT = {
  // 上は「浮かせたコントロールの下に列見出しが来る」高さ。右は最終列のラベル幅を確保する
  margin: { top: 108, right: 320, bottom: 24, left: 160 },
  nodeWidth: 14,
  nodePadding: 4,
  // 列の合計が揃う図なので上詰めにする。帯が水平に流れて読みやすい（/sankey-svg と同じ）
  align: 'top',
} as const;
