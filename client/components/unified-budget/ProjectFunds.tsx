'use client';

/** 事業の詳細パネルに出す「この事業で造成・関連する基金」。基金シートの関連レビューシート・造成の経緯で引き当てたもの */
import type { Fund } from '@/types/funds';
import { latestYear } from '@/app/lib/funds';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, Fund[] | null>();
const extract = (d: unknown) => (d as { funds: Fund[] }).funds;

export function ProjectFunds({ pid, scaleFont }: { pid: number; scaleFont: (px: number) => number }) {
  const funds = useCached(cache, String(pid), `/api/funds?pid=${pid}`, extract);
  if (!funds || funds.length === 0) return null;
  return <section aria-label="この事業に関連する基金" className="border-b border-border px-3.5 py-2.5">
    <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>関連する基金<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: scaleFont(11) }}>{funds.length}基金</span></div>
    <ul className="m-0 list-none space-y-0.5 p-0" style={{ fontSize: scaleFont(11) }}>
      {funds.map(f => { const y = latestYear(f); return <li key={f.key} className="flex justify-between gap-3">
        <a href={`/funds?fund=${encodeURIComponent(f.key)}`} className="min-w-0 truncate text-primary underline underline-offset-4 hover:text-primary-accent" title={`${f.name}（${f.owner}）`}>{f.name}</a>
        <span className="shrink-0 tabular-nums text-mirai-text-muted" title={`${y.sheetYear - 1}年度末の残高（基金シートの記載）`}>残高 {y.balance === null ? '—' : formatBudgetFromYen(y.balance)}</span>
      </li>; })}
    </ul>
  </section>;
}
