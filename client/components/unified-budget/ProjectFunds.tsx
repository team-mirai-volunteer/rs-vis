'use client';

/**
 * 事業の詳細パネルに出す「この事業で造成・関連する基金」。基金シートの関連レビューシート・造成の経緯で引き当てたもの。
 * 基金ごとに 1 行（名前＝基金一覧のその基金へのリンク、保有法人、残高）で、件数にまとめず全部並べる（複数でもスクロールで見せる）。
 * 基金名は長いものが多いので 1 行に収めてはみ出す分は … にし、全文はホバーで出す。開閉はしない（1 行ずつなので畳む必要がない）。
 */
import type { Fund } from '@/types/funds';
import { latestYear } from '@/app/lib/funds';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, Fund[] | null>();
const extract = (d: unknown) => (d as { funds: Fund[] }).funds;

const fundLabel = (fund: Fund) => fund.sheetTitle && fund.sheetTitle !== fund.name ? `${fund.name}（${fund.sheetTitle}）` : fund.name;

export function ProjectFunds({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const funds = useCached(cache, String(pid), `/api/funds?pid=${pid}`, extract);
  if (!funds || funds.length === 0) return null;
  const metaPx = scaleFont(10);
  return <section aria-label="この事業に関連する基金" className={`flex items-baseline gap-[5px] ${padding}`} style={{ fontSize: scaleFont(11) }}>
    <span className="shrink-0 font-bold text-mirai-text-subtle">関連する基金</span>
    <ul className="min-w-0 flex-1 space-y-0.5" style={{ fontSize: metaPx }}>
      {funds.map(fund => {
        const year = latestYear(fund);
        return <li key={fund.key} className="flex items-baseline gap-x-2">
          <span className="min-w-0 flex-1 truncate" title={`${fundLabel(fund)}（${fund.ministry}／保有法人 ${fund.owner}）`}>
            <a href={`/funds?fund=${encodeURIComponent(fund.key)}`} className="text-primary underline underline-offset-4 hover:text-primary-accent">{fundLabel(fund)}</a>
            <span className="ml-1 text-mirai-text-muted">（{fund.owner}）</span>
          </span>
          <span className="shrink-0 tabular-nums text-mirai-text-muted" title={`${year.sheetYear - 1}年度末の残高（基金シートの記載）`}>残高 {year.balance === null ? '—' : formatBudgetFromYen(year.balance)}</span>
        </li>;
      })}
    </ul>
  </section>;
}
