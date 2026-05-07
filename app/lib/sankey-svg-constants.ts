import type { LayoutLink } from '@/types/sankey-svg';

// ── Column mapping ──

export const COL_MAP: Record<string, number> = {
  'total': 0,
  'ministry': 1,
  'project-budget': 2,
  'project-spending': 3,
  'recipient': 4,
};

export const COL_LABELS = ['総計', '省庁', '事業', '支出先'];

export function getColumn(node: { type: string }): number {
  return COL_MAP[node.type] ?? 0;
}

export function sortPriority(node: { id: string; name: string; aggregated?: boolean }): number {
  if (node.aggregated) return 2;
  if (node.name === 'その他') return 1;
  return 0;
}

// ── Layout constants ──

export const SVG_H_MIN = 400;
export const MARGIN = { top: 30, right: 20, bottom: 10, left: 20 };
export const NODE_W = 18;
export const NODE_PAD = 2;
// 列間隔の画面ピクセル上限（ズームインしても超えない）
export const MAX_RECIPIENT_GAP_PX = 650;
export const MAX_MINISTRY_GAP_PX  = 450;

// ── Colors & Labels ──

export const TYPE_COLORS: Record<string, string> = {
  'total': '#2d7d46',
  'ministry': '#3a9a5c',
  'project-budget': '#4db870',
  'project-spending': '#e07040',
  'recipient': '#d94545',
};

export const TYPE_LABELS: Record<string, string> = {
  'total': '予算総計',
  'ministry': '府省庁',
  'project-budget': '事業（予算）',
  'project-spending': '事業（支出）',
  'recipient': '支出先',
};

export function getNodeColor(node: { type: string; aggregated?: boolean }): string {
  if (node.aggregated) return '#999';
  return TYPE_COLORS[node.type] || '#999';
}

export function getLinkColor(link: { target: { type: string } }): string {
  const tgtType = link.target.type;
  if (tgtType === 'project-spending' || tgtType === 'recipient') return '#e07040';
  return '#4db870';
}

// ── SVG helpers ──

export function ribbonPath(link: LayoutLink): string {
  const sx = link.source.x1;
  const tx = link.target.x0;
  const sTop = link.y0;
  const sBot = sTop + link.sourceWidth;
  const tTop = link.y1;
  const tBot = tTop + link.targetWidth;
  const mx = (sx + tx) / 2;
  return `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}`
    + `L${tx},${tBot}`
    + `C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`;
}

// ── Formatting ──

export function formatYen(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}兆円`;
  if (value >= 1e10) return `${Math.round(value / 1e8).toLocaleString()}億円`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}億円`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}万円`;
  return `${Math.round(value).toLocaleString()}円`;
}
