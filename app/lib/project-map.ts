/**
 * 事業マップの結合ロジック（Pure）。
 *
 * 座標ファイル（project-map-{year}.json）と品質スコアを pid で突き合わせ、
 * バブル描画に必要な最小限のフィールドだけを持つ点列にする。
 *
 * 総合点・推奨判断はここで buildPolicyEvaluations を通して確定させる。
 * /quality と同じ関数を使うので、両ページで同じ事業が同じ点数になる。
 * 判定の閾値が母集団の分位点で決まるため、フィルタ前の全件を渡す必要がある。
 */
import { buildPolicyEvaluations, type PolicyQualityInput } from '@/app/lib/policy-evaluation';
import type { ProjectMapFile, ProjectMapPoint, ProjectMapResponse } from '@/types/project-map';

/** 品質スコア側から使うフィールド。project-quality-scores-{year}.json の一部 */
export type MapQualityRow = PolicyQualityInput & {
  name: string;
  ministry: string;
};

export interface JoinInput {
  map: ProjectMapFile;
  quality: MapQualityRow[];
  /** pid → 前年度の執行率。縮小判定に使う。無ければ判定不能扱い */
  priorExecutionRates?: Record<string, number>;
  /** pid → 継続年数。事業詳細の開始年度から算出済みのもの */
  yearsRunning?: Record<string, number>;
}

export function joinProjectMap({
  map,
  quality,
  priorExecutionRates,
  yearsRunning,
}: JoinInput): ProjectMapResponse {
  const withPrior = priorExecutionRates
    ? quality.map(q => ({ ...q, priorExecutionRate: priorExecutionRates[q.pid] ?? null }))
    : quality;

  const policyByPid = new Map(buildPolicyEvaluations(withPrior).map(p => [p.pid, p]));
  const qualityByPid = new Map(quality.map(q => [q.pid, q]));

  const points: ProjectMapPoint[] = [];
  for (const p of map.points) {
    const q = qualityByPid.get(p.pid);
    if (!q) continue;   // スコアが無い事業は色も大きさも決まらないので出さない
    const policy = policyByPid.get(p.pid);
    points.push({
      pid: p.pid,
      name: q.name,
      ministry: q.ministry,
      x: p.x,
      y: p.y,
      c: p.c,
      budget: q.budgetAmount,
      exec: q.execAmount,
      score: policy?.overallScore ?? null,
      prop: policy?.proportionalityScore ?? null,
      nec: policy?.necessityScore ?? null,
      years: yearsRunning?.[p.pid] ?? null,
      cat: policy?.policyCategory ?? q.policyCategory ?? null,
      rec: policy?.recommendation ?? null,
    });
  }

  // 色スロットは事業数の多い順に固定で割り当てる。
  // 絞り込みで件数が変わっても色が入れ替わらないよう、順序は常に全件から決める
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.ministry, (counts.get(p.ministry) ?? 0) + 1);
  const ministries = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));

  return {
    year: map.year,
    model: map.model,
    generatedAt: map.generatedAt,
    quality: map.quality,
    bounds: map.bounds,
    clusters: map.clusters,
    points,
    summary: {
      total: points.length,
      ministries,
      scored: points.filter(p => p.score !== null).length,
    },
  };
}
