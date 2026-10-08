'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ProjectMapSpendingRecipient } from '@/types/project-map';
import { Button } from '@/components/ui/button';
import { UnifiedRecipientProfile } from '@/client/components/unified-budget/UnifiedRecipientProfile';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

/**
 * 支出つながりで支出先（菱形）をクリックして固定している間に出す詳細パネル。
 * 事業の詳細パネルと同じ枠に、サンキー図と共通の「支出先そのものの説明」を出す。
 */
export function RecipientDetailPanel({ recipient, year, onClose }: { recipient: ProjectMapSpendingRecipient; year: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return <section ref={ref} tabIndex={-1} aria-label={`${recipient.name} の詳細`}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-mirai-border bg-card shadow-soft outline-none xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100dvh-var(--app-header-h)-48px)] xl:overflow-y-auto">
    <div className="flex items-start justify-between gap-2 border-b border-border p-4">
      <div className="min-w-0">
        <div className="text-[11px] text-mirai-text-muted">支出先</div>
        <h2 className="mt-1 text-sm font-bold text-mirai-text">{recipient.name}</h2>
        <div className="mt-1 text-lg font-bold text-mirai-text">{formatBudgetFromYen(recipient.amount)}</div>
        <div className="text-[11px] text-mirai-text-muted">マップ上の{recipient.pids.length.toLocaleString('ja-JP')}事業からの支出</div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="支出先の固定を解除" onClick={onClose}><X /></Button>
    </div>
    <div className="px-4 pt-3">
      <UnifiedRecipientProfile name={recipient.name} sheetYear={Number(year)} scaleFont={px => px} />
    </div>
  </section>;
}
