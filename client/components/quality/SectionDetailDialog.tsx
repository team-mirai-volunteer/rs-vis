'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useDialogFocus } from '@/client/hooks/useDialogFocus';
import { fiscalYearLabel } from '@/app/lib/rs-fiscal-year';
import { POLICY_AXES } from '@/app/lib/unified-budget/policy-aggregate';
import { formatAmount, scoreColor } from './score-format';
import type { QualitySectionItem } from '@/types/quality-sections';

export function SectionDetailDialog({ item, year, budgetYear, amountLabel, onClose, onOpenProject }: {
  item: QualitySectionItem; year: string; budgetYear: number; amountLabel: string; onClose: () => void; onOpenProject: (pid: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${item.sectionName} の項詳細`} tabIndex={-1}
      onClick={e => e.stopPropagation()} className="flex max-h-[92dvh] w-full min-w-0 max-w-3xl flex-col rounded-xl border border-mirai-border bg-card shadow-soft">
      <div className="flex items-start justify-between gap-3 border-b border-mirai-border p-4">
        <div className="min-w-0">
          <p className="text-xs text-mirai-text-muted">{fiscalYearLabel(year)} · {item.accountType === 'general' ? '一般会計' : '特別会計'} · 項 {item.sectionCode}</p>
          <h2 className="mt-1 text-base font-bold">{item.sectionName}</h2>
          <p className="mt-1 text-xs text-mirai-text-muted">{[item.ministry, item.organization, item.subAccount].filter(Boolean).join(' / ')}</p>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose} aria-label="項詳細を閉じる">閉じる</Button>
      </div>
      <div className="min-h-0 overflow-y-auto p-4 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <div><dt className="text-xs text-mirai-text-muted">{amountLabel}</dt><dd className="font-bold">{formatAmount(item.rsAmount)}</dd></div>
          <div><dt className="text-xs text-mirai-text-muted">評価あり / 事業数</dt><dd>{item.evaluatedCount} / {item.programCount}</dd></div>
          <div><dt className="text-xs text-mirai-text-muted">評価カバー率</dt><dd>{Math.round(item.coverage * 100)}%</dd></div>
        </dl>
        <h3 className="mb-2 mt-5 font-bold">評価の内訳</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{POLICY_AXES.map(a => <div key={a.key} className="rounded-md bg-mirai-surface p-2">
          <dt className="text-xs">{a.label}</dt><dd className={`text-lg font-bold ${scoreColor(item.scores[a.key])}`}>{item.scores[a.key] ?? '未評価'}</dd>
        </div>)}</dl>
        <p className="mt-2 text-xs text-mirai-text-muted">配下事業の評価を、この項に計上された金額で加重平均しています。評価カバー率は評価済み事業への金額の割合です。</p>
        <h3 className="mb-2 mt-5 font-bold">推奨の分布（全件）</h3>
        {item.recommendationShare.length === 0 && <p className="text-xs text-mirai-text-muted">推奨の記載はありません。</p>}
        {item.recommendationShare.map(s => <div key={s.label} className="mb-2">
          <div className="flex justify-between gap-2 text-xs"><span>{s.label}</span><span>{s.share > 0 && s.share < 0.001 ? '0.1%未満' : `${(s.share * 100).toFixed(1)}%`}</span></div>
          <div className="mt-1 h-1.5 rounded bg-mirai-surface"><div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, s.share * 100)}%` }} /></div>
        </div>)}
        <h3 className="mb-2 mt-5 font-bold">配下の事業</h3>
        {item.programs?.map(p => <div key={p.pid} className="border-b border-mirai-border py-2">
          <Button variant="link" onClick={() => onOpenProject(String(p.pid))} className="whitespace-normal text-left font-medium text-primary-accent no-underline hover:underline">{p.name}</Button>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-mirai-text-muted"><span>PID {p.pid}</span><span>{amountLabel} {formatAmount(p.amount)}</span><span>総合点 {p.score ?? '未評価'}</span><span>{p.recommendation}</span></div>
        </div>)}
        {!item.programs?.length && <p className="text-xs text-mirai-text-muted">事業の内訳はありません。</p>}
        <Link href={`/budget-sankey?year=${budgetYear}&sel=${encodeURIComponent(item.id)}`} className="mt-4 inline-block text-xs text-primary-accent hover:underline">サンキー図でこの項を見る ↗</Link>
      </div>
    </div>
  </div>;
}
