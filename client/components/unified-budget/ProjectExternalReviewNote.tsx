'use client';

/**
 * サンキー図の詳細パネル用の「外部の検査」。財務省の予算執行調査・会計検査院の決算検査報告が
 * この事業にあるときだけ出す。閉じた状態は見出しと件数だけの 1 行（概算要求・みんなの意見と同じアコーディオン）で、
 * 開くと政策評価の詳細（ScoreDetailDialog）と同じ一覧をそのまま出す。
 */
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuditReportList, auditReportCache, extractAuditReportItems } from './ProjectAuditReport';
import { BudgetExecutionAuditList, budgetExecutionAuditCache, extractBudgetExecutionAuditCases } from './ProjectBudgetExecutionAudit';
import { useCached } from './policy-summary-cache';

export function ProjectExternalReviewNote({ pid, scaleFont, padding = 'px-3.5 py-2' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const cases = useCached(budgetExecutionAuditCache, String(pid), `/api/budget-execution-audit?pid=${pid}`, extractBudgetExecutionAuditCases);
  const items = useCached(auditReportCache, String(pid), `/api/audit-report?pid=${pid}`, extractAuditReportItems);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const bea = cases?.length ?? 0;
  const audit = items?.length ?? 0;
  if (bea === 0 && audit === 0) return null;
  const summary = [bea > 0 && `財務省の予算執行調査 ${bea}件`, audit > 0 && `会計検査院の決算検査報告 ${audit}件`].filter(Boolean).join('・');
  const metaPx = scaleFont(10);
  return <section aria-label="外部の検査結果" className={`border-b border-border ${padding}`} style={{ fontSize: scaleFont(11) }}>
    <Button variant="ghost" size="xs" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(v => !v)} title={open ? '外部の検査を閉じる' : '外部の検査の内容を開く'}
      className="h-auto justify-start gap-[5px] rounded-md p-0 font-normal hover:bg-transparent hover:text-mirai-text has-[>svg]:px-0">
      <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>外部の検査</span>
      <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{summary}</span>
      {open
        ? <ChevronDown aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />
        : <ChevronRight aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />}
    </Button>
    {open && <div id={bodyId} className="mt-1.5 space-y-2.5">
      {cases && cases.length > 0 && <div>
        <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>予算執行調査<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: metaPx }}>財務省による調査</span></div>
        <BudgetExecutionAuditList cases={cases} scaleFont={scaleFont} />
      </div>}
      {items && items.length > 0 && <div>
        <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>決算検査報告<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: metaPx }}>会計検査院による指摘</span></div>
        <AuditReportList items={items} scaleFont={scaleFont} />
      </div>}
    </div>}
  </section>;
}
