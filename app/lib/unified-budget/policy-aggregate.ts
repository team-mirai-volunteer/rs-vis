/**
 * 配下の RS事業の政策評価を金額で加重平均する（純関数）。
 *
 * 項・目・所管などの MOF ノードは自身の評価を持たないので、その下流に流れる RS事業の点数を
 * 「そのノードから各事業へ流れた額」で重み付けして要約する。未評価の事業は重みから除き、
 * どれだけの金額が評価に裏づけられているかを coverage として返す。
 */

import type { PolicySummaryEntry } from '@/app/api/policy-summary/route';

export type PolicyAxis = 'o' | 'd' | 'e' | 't' | 'x' | 'n';

export const POLICY_AXES: ReadonlyArray<{ key: PolicyAxis; label: string }> = [
  { key: 'o', label: '総合点' },
  { key: 'd', label: '成果設計' },
  { key: 'e', label: '検証可能性' },
  { key: 't', label: '執行透明性' },
  { key: 'x', label: '費用対内容' },
  { key: 'n', label: '必要性' },
];

export interface WeightedProgram {
  pid: number;
  /** 選択ノードから当該事業へ流れた額（円） */
  weight: number;
}

export interface PolicyAggregate {
  /** 軸ごとの加重平均（小数第1位で丸め）。評価ありの事業が無い軸は null */
  scores: Record<PolicyAxis, number | null>;
  /** 配下の RS事業数 */
  programCount: number;
  /** 総合点が評価済みの事業数 */
  evaluatedCount: number;
  /** 総合点が評価済みの事業に流れた額の比率（0〜1）。重みの合計が 0 なら 0 */
  coverage: number;
  /** 推奨判断の分布（金額加重、比率 0〜1）。ラベル → 比率 */
  recommendationShare: Array<{ label: string; share: number }>;
}

export function aggregatePolicy(
  programs: WeightedProgram[],
  entries: Record<string, PolicySummaryEntry>,
  recommendationLabels: Record<number, string>
): PolicyAggregate {
  const sum: Record<PolicyAxis, number> = { o: 0, d: 0, e: 0, t: 0, x: 0, n: 0 };
  const w: Record<PolicyAxis, number> = { o: 0, d: 0, e: 0, t: 0, x: 0, n: 0 };
  let total = 0;
  let evaluatedWeight = 0;
  let evaluatedCount = 0;
  const rec = new Map<string, number>();
  for (const p of programs) {
    if (p.weight <= 0) continue;
    total += p.weight;
    const e = entries[String(p.pid)];
    if (!e) continue;
    if (e.o !== null) {
      evaluatedWeight += p.weight;
      evaluatedCount += 1;
    }
    for (const axis of POLICY_AXES) {
      const v = e[axis.key];
      if (v === null || v === undefined) continue;
      sum[axis.key] += v * p.weight;
      w[axis.key] += p.weight;
    }
    if (e.r) {
      const label = recommendationLabels[e.r];
      if (label) rec.set(label, (rec.get(label) ?? 0) + p.weight);
    }
  }
  const scores = Object.fromEntries(
    POLICY_AXES.map(a => [a.key, w[a.key] > 0 ? Math.round((sum[a.key] / w[a.key]) * 10) / 10 : null])
  ) as Record<PolicyAxis, number | null>;
  const recommendationShare = [...rec]
    .map(([label, weight]) => ({ label, share: evaluatedWeight > 0 ? weight / evaluatedWeight : 0 }))
    .sort((a, b) => b.share - a.share);
  return {
    scores,
    programCount: programs.filter(p => p.weight > 0).length,
    evaluatedCount,
    coverage: total > 0 ? evaluatedWeight / total : 0,
    recommendationShare,
  };
}
