'use client';

/**
 * 事業の詳細に出す「2027年度概算要求（原資料）」。閉じた状態では見出しと件数だけの 1 行（みんなの意見と同じアコーディオン）。
 * 原資料が未取得の府省や、一致する行が無い事業では何も出さない（行が無いことは要求が無いことを意味しないので、注記より非表示を選ぶ）。
 * 開くと、事業が使う歳出予算項目（項・目）ごとに、歳出概算要求額明細表に記載された 目 全体の要求額と前年度額を並べ、
 * 原資料の PDF（ページ指定）へリンクする。目 は複数の事業で共有されるため、事業への按分はしない。
 * 対応づけは scripts/generate-budget-request-links.ts（RS 2-2 と明細表の 項・目 の名前で突き合わせ）。
 */
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { Button } from '@/components/ui/button';
import type { BudgetRequestProjectLinks } from '@/types/budget-request-links';
import { useCached } from './policy-summary-cache';

type Payload = BudgetRequestProjectLinks & { requestedFY: number; sheetYear: number };
const cache = new Map<string, Payload | null>();
const extract = (d: unknown) => d as Payload;

const change = (request: number | null, previous: number | null): string => {
  if (request === null || previous === null) return '';
  if (previous === 0) return request === 0 ? '±0' : '新規';
  const ratio = (request - previous) / previous;
  return `${ratio >= 0 ? '+' : ''}${Math.round(ratio * 100)}%`;
};

export function ProjectBudgetRequest({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const data = useCached(cache, String(pid), `/api/budget-request-links/${pid}`, extract);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (data === undefined || data === null || data.coverage !== 'linked') return null;
  const title = `${data.requestedFY}年度概算要求`;
  const metaPx = scaleFont(10);
  const common = padding;
  const summary = `歳出予算項目${data.items.length}件が明細表と一致${data.unmatched.length ? `・${data.unmatched.length}件は一致なし` : ''}`;
  const explanation = `事業が使う歳出予算項目（目）ごとの、歳出概算要求額明細表に記載された 目 全体の${data.requestedFY}年度要求額。目は他の事業と共有されることがあり、この事業だけの額ではありません`;
  return <section aria-label={title} title={explanation} className={common} style={{ fontSize: scaleFont(11) }}>
    <Button variant="ghost" size="xs" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(v => !v)} title={`${open ? '概算要求の内訳を閉じる' : '概算要求の内訳を開く'}。${explanation}`}
      className="h-auto justify-start gap-[5px] rounded-md p-0 font-normal hover:bg-transparent hover:text-mirai-text has-[>svg]:px-0">
      <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>{title}</span>
      <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{summary}</span>
      {open
        ? <ChevronDown aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />
        : <ChevronRight aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />}
    </Button>
    {open && <div id={listId} className="mt-1.5">
      <ul className="space-y-0.5">
        {data.items.map(item => {
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
      {data.unmatched.length > 0 && <p className="mt-1 text-mirai-text-muted" style={{ fontSize: metaPx }}>対応する行が見つからない歳出予算項目: {data.unmatched.map(item => item.moku).join('、')}</p>}
    </div>}
  </section>;
}
