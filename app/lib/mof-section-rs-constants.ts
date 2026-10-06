/**
 * 予算→項→RS紐づけサンキーの配色とレイアウト定数。
 *
 * 所管〜項の配色は /mof-hierarchy（`mof-hierarchy-constants.ts`）と同じ緑〜橙の
 * グラデーションに揃える。同じ「予算の階層」を表す図で色相が変わると、
 * 読み手が別の意味だと誤解するため。RS対象/RS対象外の2ノードだけは
 * 階層の一部ではなく判定結果なので、階層の配色とは別の意味の色を当てる。
 */

import { MOF_SECTION_RS_COLUMNS, type MOFSectionRsColumn, type MOFSectionRsStatus } from '@/types/mof-section-rs-sankey';

export const MOF_SECTION_RS_COLORS: Record<Exclude<MOFSectionRsColumn, 'rsStatus'>, string> = {
  total: '#2d7d46',
  ministry: '#3a9a5c',
  organization: '#4db870',
  subAccount: '#7cc98f',
  section: '#e0a040',
};

/** 集約ノードの色。/mof-hierarchy と同じ */
export const AGGREGATED_COLOR = '#999999';

/** RS対象/RS対象外の色。/sankey-svg 系の配色とは独立（判定結果を示す色なので） */
export const MOF_SECTION_RS_STATUS_COLORS: Record<MOFSectionRsStatus, string> = {
  linked: '#0d9488',
  unlinked: '#94a3b8',
};

export const MOF_SECTION_RS_STATUS_LABELS: Record<MOFSectionRsStatus, string> = {
  linked: 'RS対象',
  unlinked: 'RS対象外',
};

export function sectionRsNodeColor(node: {
  column?: MOFSectionRsColumn;
  aggregated?: boolean;
  rsStatus?: MOFSectionRsStatus;
}): string {
  if (node.rsStatus) return MOF_SECTION_RS_STATUS_COLORS[node.rsStatus];
  if (node.aggregated) return AGGREGATED_COLOR;
  return node.column && node.column !== 'rsStatus' ? MOF_SECTION_RS_COLORS[node.column] : AGGREGATED_COLOR;
}

/** 列の番号。配置計算に渡す */
export const SECTION_RS_COLUMN_INDEX: Record<MOFSectionRsColumn, number> = Object.fromEntries(
  MOF_SECTION_RS_COLUMNS.map((c, i) => [c, i])
) as Record<MOFSectionRsColumn, number>;

export const MOF_SECTION_RS_LAYOUT = {
  margin: { top: 108, right: 320, bottom: 24, left: 160 },
  nodeWidth: 14,
  nodePadding: 4,
  align: 'top',
} as const;
