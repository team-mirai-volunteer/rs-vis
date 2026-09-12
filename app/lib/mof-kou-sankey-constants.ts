/**
 * 項単位「項→目→RS事業→支出先」サンキーの配色とレイアウト定数。
 *
 * 項・目は`/mof-sankey`と同じ緑〜橙のグラデーション（予算の階層であることを示す）、
 * RS事業・支出先は国の予算から離れて事業・支出先という別種の主体になるため、
 * 別色相（青系）に切り替える。
 */

import { MOF_KOU_SANKEY_COLUMNS, type MOFKouSankeyColumn } from '@/types/mof-kou-sankey';

export const MOF_KOU_SANKEY_COLORS: Record<MOFKouSankeyColumn, string> = {
  section: '#2d7d46',
  koumoku: '#e0a040',
  rsStatus: '#3b6fa8',
  recipient: '#6fa3d8',
};

/** 集約ノードの色。/mof-sankey と同じ */
export const AGGREGATED_COLOR = '#999999';

export function mofKouSankeyNodeColor(node: { column?: MOFKouSankeyColumn; aggregated?: boolean }): string {
  if (node.aggregated) return AGGREGATED_COLOR;
  return node.column ? MOF_KOU_SANKEY_COLORS[node.column] : AGGREGATED_COLOR;
}

/** 列の番号。配置計算に渡す */
export const MOF_KOU_SANKEY_COLUMN_INDEX: Record<MOFKouSankeyColumn, number> = Object.fromEntries(
  MOF_KOU_SANKEY_COLUMNS.map((c, i) => [c, i])
) as Record<MOFKouSankeyColumn, number>;

export const MOF_KOU_SANKEY_LAYOUT = {
  margin: { top: 72, right: 280, bottom: 24, left: 160 },
  nodeWidth: 14,
  nodePadding: 4,
  align: 'top',
} as const;
