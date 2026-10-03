'use client';

/**
 * /api/project-sort-metrics（RSシート年度ぶんの継続年数・ブロック差額）の取得とキャッシュ。
 * /budget-sankey の並べ替えと /project-bubble のバブルの大きさで共用する。取得失敗・未対応年度は null。
 */
import { useCached } from '@/client/components/unified-budget/policy-summary-cache';
import type { ProjectSortMetric, ProjectSortMetricsResponse } from '@/app/lib/project-sort-metrics';
import { SUPPORTED_YEARS } from '@/types/rs-year';

const metricsCache = new Map<string, Record<string, ProjectSortMetric> | null>();
const extractItems = (d: unknown) => (d as ProjectSortMetricsResponse).items ?? null;
const SHEET_YEARS = new Set<string>(SUPPORTED_YEARS);

/** undefined = 取得中（または year が null）、null = 無し/失敗 */
export function useProjectSortMetrics(sheetYear: number | string | null): Record<string, ProjectSortMetric> | null | undefined {
  const year = sheetYear === null ? null : String(sheetYear);
  const supported = year !== null && SHEET_YEARS.has(year);
  const value = useCached(metricsCache, supported ? year : null, `/api/project-sort-metrics?year=${year}`, extractItems);
  return year !== null && !supported ? null : value;
}
