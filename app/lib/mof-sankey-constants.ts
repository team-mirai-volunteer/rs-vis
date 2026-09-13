/**
 * MOF 予算全体ビューの配色とレイアウト定数。
 *
 * 色は `/sankey-svg` の `sankey-svg-constants.ts` と同じ5色を使う。
 * サイト内で図ごとに色相が変わると、同じ緑が別の意味に見えて読み手が混乱するため。
 *
 * | 色 | /sankey-svg での意味 | ここでの意味 |
 * |---|---|---|
 * | 濃緑 `#2d7d46` | 予算総計 | 会計（一般会計・特別会計・政府関係機関） |
 * | 緑 `#4db870` | 事業（予算側） | 財源 |
 * | 橙 `#e07040` | 事業（支出側） | 実支出 |
 * | 赤 `#d94545` | 支出先 | 他会計へ繰入（純計では控除する分） |
 * | 灰 `#999` | 集約ノード | 歳入超過 |
 */

import type { MOFBudgetNodeType } from '@/types/mof-budget-overview';

export const MOF_NODE_COLORS: Record<MOFBudgetNodeType, string> = {
  source: '#4db870',
  account: '#2d7d46',
  transfer: '#d94545',
  'net-expenditure': '#e07040',
  surplus: '#999999',
};

export const MOF_NODE_LABELS: Record<MOFBudgetNodeType, string> = {
  source: '財源',
  account: '会計',
  transfer: '他会計へ繰入（控除対象）',
  'net-expenditure': '実支出',
  surplus: '歳入超過',
};



/**
 * ノードの色。
 *
 * **控除対象は種別より優先して赤にする。**財源内訳ビューでは他会計から回ってきた分も
 * 種別が `source` のため、種別だけで塗ると自前財源と同じ緑になり区別がつかない。
 */
export function mofNodeColor(node: {
  nodeType?: MOFBudgetNodeType;
  isDeduction?: boolean;
}): string {
  if (node.isDeduction) return MOF_NODE_COLORS.transfer;
  return node.nodeType ? MOF_NODE_COLORS[node.nodeType] : '#999999';
}

/**
 * 帯の色は受け手側に合わせる。
 * 「どこへ向かう金か」を色で追えるようにするため（/sankey-svg と同じ考え方）。
 */
export function mofLinkColor(target: {
  nodeType?: MOFBudgetNodeType;
  isDeduction?: boolean;
}): string {
  return mofNodeColor(target);
}

/** 凡例に出す区分。控除対象は種別と別枠にする */
export type MOFLegendKey = MOFBudgetNodeType | 'deduction';

export const MOF_LEGEND_LABELS: Record<MOFLegendKey, string> = {
  ...MOF_NODE_LABELS,
  transfer: '他会計へ繰入（控除対象）',
  deduction: '会計間の振替（控除対象）',
};

/** 凡例に出す順番 */
export const MOF_LEGEND_ORDER: MOFLegendKey[] = [
  'source',
  'account',
  'deduction',
  'transfer',
  'net-expenditure',
  'surplus',
];

export function mofLegendColor(key: MOFLegendKey): string {
  return key === 'deduction'
    ? MOF_NODE_COLORS.transfer
    : MOF_NODE_COLORS[key];
}

export const MOF_SANKEY_LAYOUT = {
  margin: { top: 24, right: 260, bottom: 24, left: 260 },
  nodeWidth: 18,
  nodePadding: 8,
} as const;
