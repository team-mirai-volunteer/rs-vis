'use client';

/**
 * サンキー図の詳細パネル用の1行要約。財務省の予算執行調査・会計検査院の決算検査報告が
 * この事業にあるときだけ件数を出し、中身は政策評価の詳細（ScoreDetailDialog）に任せる。
 * パネルに全文を並べると長くなりすぎるため、ここでは「ある」ことと件数だけを伝える。
 */
import type { AuditReportItem } from '@/types/audit-report';
import type { BudgetExecutionAuditCase } from '@/types/budget-execution-audit';
import { Button } from '@/components/ui/button';
import { useCached } from './policy-summary-cache';

const beaCache = new Map<string, BudgetExecutionAuditCase[] | null>();
const auditCache = new Map<string, AuditReportItem[] | null>();
const extractCases = (d: unknown) => (d as { cases: BudgetExecutionAuditCase[] }).cases;
const extractItems = (d: unknown) => (d as { items: AuditReportItem[] }).items;

export function ProjectExternalReviewNote({ pid, scaleFont, onOpen, loading, padding = 'px-3.5 py-2' }: {
  pid: number;
  scaleFont: (px: number) => number;
  /** 政策評価の詳細を開く（評価ダイアログに予算執行調査・決算検査報告の全文がある） */
  onOpen?: () => void;
  loading?: boolean;
  padding?: string;
}) {
  const cases = useCached(beaCache, String(pid), `/api/budget-execution-audit?pid=${pid}`, extractCases);
  const items = useCached(auditCache, String(pid), `/api/audit-report?pid=${pid}`, extractItems);
  const bea = cases?.length ?? 0;
  const audit = items?.length ?? 0;
  if (bea === 0 && audit === 0) return null;
  const parts = [bea > 0 && `財務省の予算執行調査 ${bea}件`, audit > 0 && `会計検査院の決算検査報告 ${audit}件`].filter(Boolean).join('・');
  // 概算要求の段（ProjectBudgetRequest）と同じ強さ: 見出し 11px、件数と操作は 10px の控えめな色
  const metaPx = scaleFont(10);
  return <section aria-label="外部の検査結果" className={`flex flex-wrap items-baseline gap-x-[5px] gap-y-1 border-b border-border ${padding}`} style={{ fontSize: scaleFont(11) }}>
    <span className="font-bold text-mirai-text-subtle">外部の検査</span>
    <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{parts}</span>
    {onOpen && <Button variant="link" size="xs" onClick={onOpen} disabled={loading} className="h-auto p-0 font-normal text-mirai-text-muted" style={{ fontSize: metaPx }}>
      {loading ? '読み込み中…' : '政策評価の詳細で見る'}
    </Button>}
  </section>;
}
