'use client';

/**
 * 事業の詳細に出す「2027年度概算要求（原資料）」。
 * 事業が使う歳出予算項目（項・目）ごとに、歳出概算要求額明細表に記載された 目 全体の要求額と前年度額を並べ、
 * 原資料の PDF（ページ指定）へリンクする。目 は複数の事業で共有されるため、事業への按分はしない。
 * 対応づけは scripts/generate-budget-request-links.ts（RS 2-2 と明細表の 項・目 の名前で突き合わせ）。
 */
import { useState } from 'react';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { Button } from '@/components/ui/button';
import type { BudgetRequestProjectLinks } from '@/types/budget-request-links';
import { useCached } from './policy-summary-cache';

type Payload = BudgetRequestProjectLinks & { requestedFY: number; sheetYear: number };
const cache = new Map<string, Payload | null>();
const extract = (d: unknown) => d as Payload;
const COLLAPSED = 3;

const change = (request: number | null, previous: number | null): string => {
  if (request === null || previous === null) return '';
  if (previous === 0) return request === 0 ? '±0' : '新規';
  const ratio = (request - previous) / previous;
  return `${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%`;
};

export function ProjectBudgetRequest({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const data = useCached(cache, String(pid), `/api/budget-request-links/${pid}`, extract);
  const [open, setOpen] = useState(false);
  if (data === undefined || data === null) return null;
  const fy = data.requestedFY;
  const title = `${fy}年度概算要求`;
  const label = <span className="font-bold text-mirai-text-subtle">{title}</span>;
  const common = `border-b border-border ${padding}`;
  if (data.coverage === 'no-line-items') return null;
  if (data.coverage === 'not-crawled') {
    return <section aria-label={title} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${common}`} style={{ fontSize: scaleFont(11) }}>
      {label}<span className="text-mirai-text-muted">原資料（歳出概算要求額明細表）が未取得の府省です</span>
      <a href="/budget-requests?view=documents" className="text-primary underline underline-offset-4 hover:text-primary-accent">取得状況を見る</a>
    </section>;
  }
  if (data.coverage === 'no-match') {
    return <section aria-label={title} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${common}`} style={{ fontSize: scaleFont(11) }}>
      {label}<span className="text-mirai-text-muted">この事業の歳出予算項目（{data.unmatched.length}件）に対応する明細表の行が見つかりません</span>
      <a href="/budget-requests" className="text-primary underline underline-offset-4 hover:text-primary-accent">概算要求を探す</a>
    </section>;
  }
  const items = open ? data.items : data.items.slice(0, COLLAPSED);
  const rest = data.items.length - COLLAPSED;
  return <section aria-label={title} className={common} style={{ fontSize: scaleFont(11) }}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {label}
      <span className="text-mirai-text-muted">事業が使う歳出予算項目（目）ごとの、明細表に記載された要求額。目は他の事業と共有されることがあります</span>
    </div>
    <ul className="mt-1 space-y-0.5">
      {items.map(item => {
        const href = item.page ? `${item.url}#page=${item.page}` : item.url;
        return <li key={`${item.organization}|${item.kou}|${item.moku}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 text-mirai-text-secondary" title={`${item.ministry}／${item.organization}／項「${item.kou}」／目「${item.moku}」。この事業の${data.sheetYear}年度当初予算 ${formatBudgetFromYen(item.rsBudgetYen)}、${data.sheetYear + 1}年度要求 ${formatBudgetFromYen(item.rsNextRequestYen)}（RS記載）`}>
            {item.moku}<span className="ml-1 text-mirai-text-muted">（{item.kou}）</span>
          </span>
          <span className="tabular-nums text-mirai-text">{item.requestYen === null ? '—' : formatBudgetFromYen(item.requestYen)}</span>
          {item.previousYen !== null && <span className="tabular-nums text-mirai-text-muted">前年度 {formatBudgetFromYen(item.previousYen)}{change(item.requestYen, item.previousYen) && `・${change(item.requestYen, item.previousYen)}`}</span>}
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent" title={item.documentTitle}>原資料{item.page ? `（p.${item.page}）` : ''} ↗</a>
        </li>;
      })}
    </ul>
    {(rest > 0 || data.unmatched.length > 0) && <div className="mt-1 flex flex-wrap items-center gap-x-3">
      {rest > 0 && <Button variant="link" size="xs" className="h-auto px-0 text-primary-accent" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? '折りたたむ' : `ほか${rest}件を見る`}</Button>}
      {data.unmatched.length > 0 && <span className="text-mirai-text-muted">対応する行が見つからない歳出予算項目 {data.unmatched.length}件</span>}
    </div>}
  </section>;
}
