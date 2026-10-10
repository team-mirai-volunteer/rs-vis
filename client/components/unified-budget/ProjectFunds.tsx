'use client';

/**
 * 事業の詳細パネルに出す「この事業で造成・関連する基金」の1行要約。
 * 基金シートの関連レビューシート・造成の経緯で引き当てたもの。件数と残高の合計だけを出し、中身は基金一覧（?pid= で絞り込み）に任せる。
 */
import type { Fund } from '@/types/funds';
import { latestYear } from '@/app/lib/funds';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, Fund[] | null>();
const extract = (d: unknown) => (d as { funds: Fund[] }).funds;

export function ProjectFunds({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const funds = useCached(cache, String(pid), `/api/funds?pid=${pid}`, extract);
  if (!funds || funds.length === 0) return null;
  const balance = funds.reduce((s, f) => s + (latestYear(f).balance ?? 0), 0);
  const sheetYear = Math.max(...funds.map(f => latestYear(f).sheetYear));
  const href = funds.length === 1 ? `/funds?fund=${encodeURIComponent(funds[0].key)}` : `/funds?pid=${pid}`;
  return <section aria-label="この事業に関連する基金" className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${padding}`} style={{ fontSize: scaleFont(11) }}>
    <span className="font-bold text-mirai-text-subtle">関連する基金</span>
    <span className="text-mirai-text-secondary" title={funds.map(f => `${f.name}（${f.owner}）`).join('、')}>
      {funds.length === 1 ? funds[0].name : `${funds.length}基金`}
      <span className="ml-1 tabular-nums text-mirai-text-muted" title={`${sheetYear - 1}年度末の残高の合計（基金シートの記載）`}>残高 {balance > 0 ? formatBudgetFromYen(balance) : '—'}</span>
    </span>
    <a href={href} className="text-primary underline underline-offset-4 hover:text-primary-accent">基金一覧で見る</a>
  </section>;
}
