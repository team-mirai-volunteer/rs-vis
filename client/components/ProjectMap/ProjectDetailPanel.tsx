'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import Link from 'next/link';
import type { ProjectMapPoint } from '@/types/project-map';
import { unifiedProjectUrl } from '@/app/lib/unified-budget/links';
import { Button } from '@/components/ui/button';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { UnifiedProjectSections } from '@/client/components/unified-budget/UnifiedProjectSections';
import { UnifiedProjectBlocks, UnifiedBlockRecipients, useProjectBlocks } from '@/client/components/unified-budget/UnifiedProjectBlocks';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

const tabs = ['予算', '事業(支出)', 'ブロック', '支出先'] as const;

/** 図を操作したまま比較できる、サンキー図と共通の詳細パネル。 */
export function ProjectDetailPanel({ point, year, onClose }: { point: ProjectMapPoint; year: string; onClose: () => void }) {
  const graph = useProjectBlocks(Number(point.pid), Number(year));
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [tab, setTab] = useState<typeof tabs[number]>('予算');
  const [blockId, setBlockId] = useState<string | null>(null);
  const block = graph?.blocks.find(item => item.blockId === blockId);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
    ref.current?.focus({ preventScroll: true });
  }, []);

  return <section ref={ref} tabIndex={-1} aria-label={`${point.name} の詳細`}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-mirai-border bg-card shadow-soft outline-none xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100dvh-var(--app-header-h)-48px)] xl:overflow-y-auto">
    <div className="flex items-start justify-between gap-2 border-b border-border p-4">
      <div className="min-w-0">
        <div className="text-[11px] text-mirai-text-muted">{point.ministry} · PID {point.pid}</div>
        <h2 className="mt-1 text-sm font-bold text-mirai-text">{point.name}</h2>
        <div className="mt-1 text-lg font-bold text-mirai-text">{formatBudgetFromYen(point.budget)}</div>
        <div className="text-[11px] text-mirai-text-muted">歳出予算現額</div>
        <Link className="mt-1 inline-block text-[11px] text-primary hover:underline" href={unifiedProjectUrl(point.pid, year)}>サンキー図で見る</Link>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="選択を解除" onClick={onClose}><X /></Button>
    </div>
    <Button variant="ghost" className="h-auto min-h-10 w-full shrink-0 justify-start rounded-none border-b border-border px-4 text-left text-xs font-bold text-primary-accent hover:bg-mirai-surface-teal sm:hidden" aria-expanded={overviewOpen} onClick={() => setOverviewOpen(value => !value)}>事業概要・評価 {overviewOpen ? 'を閉じる' : 'を見る'}</Button>
    <div className={`px-4 ${overviewOpen ? '' : 'max-sm:hidden'}`}>
      <UnifiedProjectSections pid={Number(point.pid)} projectName={point.name} rsSheetYear={Number(year)} fontPx={11} />
    </div>
    <div role="tablist" aria-label="事業の内訳" className="flex overflow-x-auto border-y border-border px-2">
      {tabs.map(label => <Button key={label} role="tab" variant="ghost" aria-selected={tab === label} onClick={() => setTab(label)}
        className={`h-auto min-h-10 flex-1 whitespace-nowrap rounded-none border-b-2 px-1 py-1.5 text-[11px] font-bold ${tab === label ? 'border-primary text-primary-accent' : 'border-transparent text-mirai-text-muted'}`}>{label}</Button>)}
    </div>
    <div role="tabpanel" className="max-h-80 overflow-y-auto p-4 pt-1">
      {tab === '事業(支出)' ? <div className="flex justify-between gap-3 border-b border-border py-2 text-xs">
        <span>{point.name}</span><span className="shrink-0 tabular-nums">{formatBudgetFromYen(point.exec)}</span>
      </div> : graph === undefined ? <p role="status" className="py-2 text-xs text-mirai-text-muted">内訳を読み込み中…</p>
        : graph === null ? <p className="py-2 text-xs text-mirai-text-muted">この年度の内訳を取得できませんでした。</p>
        : tab === '予算' ? (graph.budgetSummary || graph.budgetBreakdown?.length ? <BudgetExecutionSection budgetSummary={graph.budgetSummary} budgetBreakdown={graph.budgetBreakdown ?? []} scaleFont={px => px} presentation="tab" /> : <p className="py-2 text-xs text-mirai-text-muted">予算内訳の記載はありません。</p>)
        : tab === 'ブロック' ? <UnifiedProjectBlocks graph={graph} year={Number(year)} onSelect={item => { setBlockId(item.blockId); setTab('支出先'); }} />
        : block ? <UnifiedBlockRecipients graph={graph} block={block} onClear={() => setBlockId(null)} />
        : <>
          {graph.blocks.every(item => item.recipients.length === 0) && <p className="py-2 text-xs text-mirai-text-muted">支出先の記載はありません。</p>}
          {graph.blocks.filter(item => item.recipients.length > 0).map(item => <div key={item.blockId}>
            <Button variant="ghost" className="h-auto w-full justify-start px-1 py-2 text-[11px] font-bold" onClick={() => setBlockId(item.blockId)}>ブロック {item.blockId} {item.blockName}</Button>
            {item.recipients.map((recipient, index) => <div key={index} className="flex justify-between gap-3 border-b border-border px-1 py-1.5 text-xs">
              <span>{recipient.name}</span><span className="shrink-0 text-[11px] tabular-nums">{formatBudgetFromYen(recipient.amount)}</span>
            </div>)}
          </div>)}
        </>}
    </div>
  </section>;
}
