/**
 * 事業列の並べ替えキーを組み立てる（純関数）。
 * 総合点は /api/policy-summary、継続年数・差額は /api/project-sort-metrics の値から作る。
 */
import type { ProjectSortMetric } from '@/app/lib/project-sort-metrics';
import type { UnifiedProgramRanking, UnifiedProgramSort } from '@/types/unified-budget-view';

/** 並べ替えに総合点（政策評価サマリ）が要るか */
export const programSortNeedsScore = (sort: UnifiedProgramSort) => sort === 'score-asc' || sort === 'score-desc';
/** 並べ替えに継続年数・差額（/api/project-sort-metrics）が要るか */
export const programSortNeedsMetrics = (sort: UnifiedProgramSort) => sort === 'years' || sort === 'diff' || sort === 'ratio';

/**
 * 並べ替えキー。金額順・データ未取得なら undefined（金額順のまま）。
 * policy は pid → 総合点、metrics は pid → 継続年数・差額。キーは事業ID の文字列
 */
export function buildProgramRanking(
  sort: UnifiedProgramSort,
  data: { policy?: Record<string, { o: number | null }> | null; metrics?: Record<string, ProjectSortMetric> | null },
): UnifiedProgramRanking | undefined {
  if (sort === 'amount') return undefined;
  const values = new Map<number, number>();
  const put = (pid: string, v: number | null | undefined) => {
    const id = Number(pid);
    if (v != null && Number.isFinite(v) && Number.isFinite(id)) values.set(id, v);
  };
  if (programSortNeedsScore(sort)) {
    if (!data.policy) return undefined;
    for (const [pid, e] of Object.entries(data.policy)) put(pid, e.o);
  } else {
    if (!data.metrics) return undefined;
    const key = sort === 'years' ? 'y' : sort === 'diff' ? 'd' : 'r';
    for (const [pid, m] of Object.entries(data.metrics)) put(pid, m[key]);
  }
  return { values, order: sort === 'score-asc' ? 'asc' : 'desc' };
}
