'use client';

/**
 * 項・目・所管など「自身は評価を持たないノード」向けの政策評価ブロック。
 * 配下の RS事業の点数を、選択ノードから各事業へ流れた額で加重平均して 6 軸で見せる。
 * 何件の事業・どれだけの金額が評価に裏づけられているかを添え、評価の無い事業が多いときに
 * 数字だけが独り歩きしないようにする。
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { aggregatePolicy, POLICY_AXES, type WeightedProgram } from '@/app/lib/unified-budget/policy-aggregate';
import { scoreColor } from '@/client/components/quality/score-format';
import { usePolicySummary } from './policy-summary-cache';

export function UnifiedAggregateEvaluation({
  programs,
  rsSheetYear,
  fontPx,
}: {
  /** 配下の RS事業（選択ノードからの寄与額つき） */
  programs: WeightedProgram[];
  rsSheetYear: number;
  fontPx: number;
}) {
  const policy = usePolicySummary(rsSheetYear);
  const scale = (px: number) => Math.round((px * fontPx) / 11);
  const agg = useMemo(() => (policy ? aggregatePolicy(programs, policy.items, policy.recommendations) : null), [policy, programs]);

  if (policy === undefined) return null; // 取得中はちらつかせない
  if (!agg || agg.evaluatedCount === 0) return null; // 評価のある配下事業が無い（区分ノードのみ等）

  return (
    <div className="shrink-0 border-b border-border px-3.5 py-2">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scale(11) }}>政策評価</span>
        <span className="text-mirai-text-muted" style={{ fontSize: scale(10) }}>配下の RS事業の金額加重平均</span>
        <span className="ml-auto whitespace-nowrap text-mirai-text-muted" style={{ fontSize: scale(10) }}>
          評価あり {agg.evaluatedCount.toLocaleString()}/{agg.programCount.toLocaleString()} 事業・金額の {Math.round(agg.coverage * 100)}%
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {POLICY_AXES.map(axis => {
          const v = agg.scores[axis.key];
          const rounded = v === null ? null : Math.round(v);
          return (
            <div key={axis.key} className="text-center">
              <div className={cn('font-mono font-bold leading-none', scoreColor(rounded))} style={{ fontSize: scale(15) }} title={v === null ? undefined : `${v}`}>
                {rounded ?? '—'}
              </div>
              <div className="mt-[3px] text-mirai-text-muted" style={{ fontSize: scale(10) }}>{axis.label}</div>
            </div>
          );
        })}
        {agg.recommendationShare.length > 0 && (
          <div className="flex basis-full flex-wrap gap-1">
            {agg.recommendationShare.slice(0, 4).map(r => (
              <span
                key={r.label}
                className="whitespace-nowrap rounded-full bg-mirai-surface-light px-[7px] py-0.5 font-bold text-mirai-text-subtle"
                style={{ fontSize: scale(10) }}
                title="推奨判断の分布（金額加重）"
              >
                {r.label} {Math.round(r.share * 100)}%
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
