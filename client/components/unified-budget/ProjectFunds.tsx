'use client';

/**
 * 事業の詳細パネルに出す「この事業で造成・関連する基金」。基金シートの関連レビューシート・造成の経緯で引き当てたもの。
 * 閉じた状態は 1 行（基金が 1 つなら名前と残高、複数なら件数と残高の合計）。概算要求・外部の検査と同じアコーディオンで、
 * 開くと基金ごとに名前（基金一覧のその基金へのリンク）・保有法人・残高を出す。
 */
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Fund } from '@/types/funds';
import { latestYear } from '@/app/lib/funds';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { Button } from '@/components/ui/button';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, Fund[] | null>();
const extract = (d: unknown) => (d as { funds: Fund[] }).funds;

const fundLabel = (fund: Fund) => fund.sheetTitle && fund.sheetTitle !== fund.name ? `${fund.name}（${fund.sheetTitle}）` : fund.name;
const balanceOf = (fund: Fund) => latestYear(fund).balance;

export function ProjectFunds({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const funds = useCached(cache, String(pid), `/api/funds?pid=${pid}`, extract);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!funds || funds.length === 0) return null;
  const balance = funds.reduce((s, f) => s + (balanceOf(f) ?? 0), 0);
  const sheetYear = Math.max(...funds.map(f => latestYear(f).sheetYear));
  const metaPx = scaleFont(10);
  const summary = `${funds.length === 1 ? fundLabel(funds[0]) : `${funds.length}基金`}・残高 ${balance > 0 ? formatBudgetFromYen(balance) : '—'}`;
  const balanceTitle = funds.length === 1 ? `残高は${sheetYear - 1}年度末の値（基金シートの記載）` : `残高は${sheetYear - 1}年度末の値の合計（基金シートの記載）`;
  return <section aria-label="この事業に関連する基金" className={padding} style={{ fontSize: scaleFont(11) }}>
    <Button variant="ghost" size="xs" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(v => !v)}
      title={`${open ? '基金の内訳を閉じる' : '基金の内訳を開く'}。${balanceTitle}`}
      className="h-auto justify-start gap-[5px] rounded-md p-0 text-left font-normal hover:bg-transparent hover:text-mirai-text has-[>svg]:px-0">
      <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>関連する基金</span>
      <span className="min-w-0 text-mirai-text-muted" style={{ fontSize: metaPx }}>{summary}</span>
      {open
        ? <ChevronDown aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />
        : <ChevronRight aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />}
    </Button>
    {open && <ul id={listId} className="mt-1.5 space-y-1">
      {funds.map(fund => {
        const value = balanceOf(fund);
        return <li key={fund.key} className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0">
            <a href={`/funds?fund=${encodeURIComponent(fund.key)}`} className="text-primary underline underline-offset-4 hover:text-primary-accent" title={`基金一覧でこの基金を見る（${fund.ministry}／保有法人 ${fund.owner}）`}>{fundLabel(fund)}</a>
            <span className="ml-1 text-mirai-text-muted">（{fund.owner}）</span>
          </span>
          <span className="tabular-nums text-mirai-text" title={`${latestYear(fund).sheetYear - 1}年度末の残高（基金シートの記載）`}>{value === null ? '—' : formatBudgetFromYen(value)}</span>
        </li>;
      })}
    </ul>}
  </section>;
}
