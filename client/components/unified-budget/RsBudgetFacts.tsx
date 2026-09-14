'use client';

/**
 * RS事業の予算・執行サマリ（当初・補正・繰越・予備費・歳出予算現額・執行額・翌年度要求）の表。
 * サイドパネルでは事業概要の下に置く（見出し直下には出さない）。
 */

import type { BudgetSummary } from '@/types/sankey-svg';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

export function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-mirai-text-muted">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}

export function RsBudgetFacts({ summary, className }: { summary: BudgetSummary; className?: string }) {
  const b = summary;
  return (
    <div className={className}>
      <div className="mb-1 text-[11px] font-bold text-mirai-text-subtle">RS 予算・執行（{b.fiscalYear}年度）</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-mirai-text-secondary">
        <FactRow k="当初予算" v={formatBudgetFromYen(b.initialBudget)} />
        <FactRow k="補正予算" v={formatBudgetFromYen(b.supplementaryBudget)} />
        <FactRow k="前年度繰越" v={formatBudgetFromYen(b.carryoverBudget)} />
        <FactRow k="予備費等" v={formatBudgetFromYen(b.reserveFund)} />
        <FactRow k="歳出予算現額" v={formatBudgetFromYen(b.totalBudget)} />
        <FactRow k="執行額" v={`${formatBudgetFromYen(b.executedAmount)}${b.executionRate !== null ? `（${b.executionRate.toFixed(1)}%）` : ''}`} />
        <FactRow k="翌年度要求" v={formatBudgetFromYen(b.nextYearRequest)} />
      </dl>
    </div>
  );
}
