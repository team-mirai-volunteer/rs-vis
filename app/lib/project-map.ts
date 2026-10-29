/**
 * 事業マップの結合ロジック（Pure）。
 *
 * 座標ファイル（project-map-{year}.json）と品質スコアを pid で突き合わせ、
 * バブル描画に必要な最小限のフィールドだけを持つ点列にする。
 *
 * 総合点・推奨判断は呼び出し側が渡す評価（loadPolicyEvaluations の結果）をそのまま使う。
 * ここで buildPolicyEvaluations を呼び直すと、翌年度繰越や前年度の不用率など入力が欠けて
 * /quality・事業詳細と判定がずれる（2026-10-29 に 2025年版で 370 事業のずれを確認）。
 */
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';
import type { ProjectMapFile, ProjectMapPoint, ProjectMapResponse } from '@/types/project-map';

/** 品質スコア側から使うフィールド。project-quality-scores-{year}.json の一部 */
export type MapQualityRow = {
  pid: string;
  name: string;
  ministry: string;
  budgetAmount: number;
  execAmount: number;
  policyCategory?: string | null;
};

export interface JoinInput {
  map: ProjectMapFile;
  quality: MapQualityRow[];
  /** pid → 政策評価。/quality・事業詳細と同じもの（全件から閾値を決めた結果） */
  policies: ReadonlyMap<string, PolicyEvaluation>;
  /** pid → 継続年数。事業詳細の開始年度から算出済みのもの */
  yearsRunning?: Record<string, number>;
}

export function joinProjectMap({
  map,
  quality,
  policies,
  yearsRunning,
}: JoinInput): ProjectMapResponse {
  const qualityByPid = new Map(quality.map(q => [q.pid, q]));

  const points: ProjectMapPoint[] = [];
  for (const p of map.points) {
    const q = qualityByPid.get(p.pid);
    if (!q) continue;   // スコアが無い事業は色も大きさも決まらないので出さない
    const policy = policies.get(p.pid);
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
