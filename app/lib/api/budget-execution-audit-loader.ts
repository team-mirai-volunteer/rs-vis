/** budget-execution-audit.json（財務省 予算執行調査）の読み込み。生成は scripts/generate-budget-execution-audit.py */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { BudgetExecutionAuditCase, BudgetExecutionAuditFile } from '@/types/budget-execution-audit';

let cache: BudgetExecutionAuditFile | null | undefined;
export function loadBudgetExecutionAudit(): BudgetExecutionAuditFile | null {
  if (cache === undefined) cache = tryReadDataJson<BudgetExecutionAuditFile>('budget-execution-audit.json');
  return cache;
}

/** その事業に対応づけた事案。新しい調査年度から */
export function auditCasesOfProject(data: BudgetExecutionAuditFile, pid: string): BudgetExecutionAuditCase[] {
  const ids = new Set(data.byPid[pid] ?? []);
  return data.cases.filter(c => ids.has(c.id)).sort((a, b) => b.surveyYear - a.surveyYear || a.no - b.no);
}
