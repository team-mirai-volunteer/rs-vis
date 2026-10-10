'use client';

/**
 * 事業の詳細パネルに出す「財務省 予算執行調査」。政府自身が行った調査なので、AI評価（独自基準・試行）とは別の枠で出す。
 * 事案と予算事業IDの対応は scripts/data/budget-execution-audit-matches.json（項・目と事案名の候補を確認して作成）
 */
import type { BudgetExecutionAuditCase } from '@/types/budget-execution-audit';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useCached } from './policy-summary-cache';

export const budgetExecutionAuditCache = new Map<string, BudgetExecutionAuditCase[] | null>();
const cache = budgetExecutionAuditCache;
export const extractBudgetExecutionAuditCases = (d: unknown) => (d as { cases: BudgetExecutionAuditCase[] }).cases;
const extract = extractBudgetExecutionAuditCases;

/** 調査年度の翌年度予算案に反映される（令和7年度調査 → 令和8年度予算案） */
const nextBudgetLabel = (surveyYear: number) => `令和${surveyYear - 2018 + 1}年度予算案`;

function reflection(c: BudgetExecutionAuditCase): string {
  if (!c.reflectionUrl) return '予算への反映状況は未公表';
  if (c.reflectionAmount === null) return `${nextBudgetLabel(c.surveyYear)}への反映額なし`;
  return `${nextBudgetLabel(c.surveyYear)}に反映 ${c.reflectionAmount < 0 ? '▲' : ''}${formatBudgetFromYen(Math.abs(c.reflectionAmount))}`;
}

/** 事案の一覧（本文）。詳細パネルの「外部の検査」のアコーディオンでも同じものを出す */
export function BudgetExecutionAuditList({ cases, scaleFont }: { cases: BudgetExecutionAuditCase[]; scaleFont: (px: number) => number }) {
  return <>
    <ul className="m-0 list-none space-y-1.5 p-0" style={{ fontSize: scaleFont(11) }}>
      {cases.map(c => <li key={c.id}>
        <a href={c.resultUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent"
          title="総括調査票（財務省のPDF）を開く">{c.era}・{c.title} ↗</a>
        <div className="text-mirai-text-muted">
          {c.reflectionUrl
            ? <a href={c.reflectionUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" title="反映状況票（財務省のPDF）を開く">{reflection(c)} ↗</a>
            : reflection(c)}
          {c.scope === 'part' && <span>・この事業の一部{c.matchNote && !c.title.includes(c.matchNote) ? `（${c.matchNote}）` : ''}が対象</span>}
        </div>
      </li>)}
    </ul>
    <p className="mt-1.5 text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>出典：財務省「予算執行調査」。事業との対応づけは本サイトで作成</p>
  </>;
}

/** padding は置き場所（サイドパネル px-3.5 / 評価一覧のダイアログ px-6）に合わせて渡す */
export function ProjectBudgetExecutionAudit({ pid, scaleFont, padding = 'px-3.5 py-2.5' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const cases = useCached(cache, String(pid), `/api/budget-execution-audit?pid=${pid}`, extract);
  if (!cases || cases.length === 0) return null;
  return <section aria-label="財務省の予算執行調査" className={`border-b border-border ${padding}`}>
    <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>
      予算執行調査<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: scaleFont(11) }}>財務省による調査・{cases.length}件</span>
    </div>
    <BudgetExecutionAuditList cases={cases} scaleFont={scaleFont} />
  </section>;
}
