import auditReportMatches from '../../scripts/data/audit-report-matches.json';
import budgetExecutionMatches from '../../scripts/data/budget-execution-audit-matches.json';

// 2つの対応表を単純に足すと、両方に載る事業を二重に数えてしまう。
const auditPids = new Set(Object.values(auditReportMatches.cases).flatMap(item => item.pids));
const executionPids = new Set(Object.values(budgetExecutionMatches.cases).flatMap(item => item.pids));

export const AUDIT_PROJECT_COUNTS = {
  auditReport: auditPids.size,
  budgetExecution: executionPids.size,
  both: [...auditPids].filter(pid => executionPids.has(pid)).length,
  either: new Set([...auditPids, ...executionPids]).size,
};

// 確認状況は対応表の来歴をそのまま表示し、手動確認済みと誤認させない。
export const AUDIT_MATCH_DISCLOSURE = '事業との対応づけの確認状況：'
  + `会計検査院は「${auditReportMatches.reviewedBy}」、`
  + `予算執行調査は「${budgetExecutionMatches.reviewedBy}」。原典との突き合わせが必要です。`;
