/**
 * 事業の並べ替え・バブルの大きさに使う指標（継続年数・ブロック差額）。Pure。
 * /api/project-sort-metrics が組み立て、/budget-sankey の並べ替えと /project-bubble の大きさで共用する。
 */
import type { SubcontractIndex } from '@/types/subcontract';
import { projectBlockDifference } from '@/app/lib/subcontracts/block-balance';

/** 1事業ぶん。y=継続年数 / d=ブロック差額（円）/ r=ブロック差額÷記載額。値の無いものは省く */
export interface ProjectSortMetric {
  y?: number;
  d?: number;
  r?: number;
}

export interface ProjectSortMetricsResponse {
  year: number;
  /** pid → 指標 */
  items: Record<string, ProjectSortMetric>;
}

export function buildProjectSortMetrics(
  yearsRunning: Iterable<{ pid: string; yearsRunning?: number | null }>,
  subcontracts: SubcontractIndex | null,
): Record<string, ProjectSortMetric> {
  const items: Record<string, ProjectSortMetric> = {};
  for (const row of yearsRunning) {
    if (row.yearsRunning != null && Number.isFinite(row.yearsRunning)) items[row.pid] = { y: row.yearsRunning };
  }
  for (const [pid, graph] of Object.entries(subcontracts ?? {})) {
    const diff = projectBlockDifference(graph);
    if (!diff) continue;
    // 比率は4桁（0.01%）で丸めて応答を軽くする
    items[pid] = { ...items[pid], d: Math.round(diff.difference), r: Math.round(diff.ratio * 1e4) / 1e4 };
  }
  return items;
}
