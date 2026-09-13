/**
 * 統合ビューの配色とレイアウト定数。
 *
 * 会計〜目は /mof-hierarchy・/mof-sankey と同じ緑〜橙の階層配色（同じ「予算の階層」を表す図で
 * 色相が変わると別の意味に見えるため）。事業列は /sankey-svg の緑（予算）→橙（支出）に揃え、
 * 非事業区分は灰系で明度差、未突合は警告色、繰入は薄い青灰（会計間の重複を示す）。
 */

import type { UnifiedColumn, UnifiedProgramKind } from '@/types/unified-budget';
import type { UnifiedViewDetails } from '@/types/unified-budget-view';

export const UNIFIED_COLUMN_COLORS: Record<UnifiedColumn, string> = {
  account: '#2d7d46',
  ministry: '#3a9a5c',
  organization: '#4db870',
  section: '#e0a040',
  koumoku: '#e8b968',
  program: '#4db870',
  'program-spending': '#e07040',
  recipient: '#d9534f',
};

export const UNIFIED_KIND_COLORS: Record<UnifiedProgramKind, string> = {
  rs: '#4db870',
  transfer: '#94a3b8',
  debt: '#6b7280',
  'local-transfer': '#78716c',
  reserve: '#a8a29e',
  personnel: '#9ca3af',
  unmatched: '#eab308',
  outside: '#cbd5e1',
};

export const AGGREGATED_COLOR = '#999999';

export function unifiedNodeColor(details: UnifiedViewDetails | undefined): string {
  if (!details) return AGGREGATED_COLOR;
  if (details.aggregated) return AGGREGATED_COLOR;
  if (details.kind && details.kind !== 'rs') return UNIFIED_KIND_COLORS[details.kind];
  return UNIFIED_COLUMN_COLORS[details.column];
}

export const UNIFIED_LAYOUT = {
  margin: { top: 96, right: 320, bottom: 24, left: 24 },
  nodeWidth: 14,
  nodePadding: 4,
  align: 'top',
} as const;

/** 主要経費別分類コード → 名称（非事業区分の説明に使う最小限） */
export const MAJOR_EXPENSE_NAMES: Record<string, string> = {
  '20': '国債費',
  '31': '地方交付税交付金',
  '32': '地方特例交付金',
  '33': '地方譲与税譲与金',
  '98': '予備費',
};

/** 使途別分類コード → 名称 */
export const PURPOSE_NAMES: Record<string, string> = {
  '1': '人件費',
  '2': '旅費',
  '3': '物件費',
  '4': '施設費',
  '5': '補助費・委託費',
  '6': '他会計へ繰入',
  '9': 'その他',
};
