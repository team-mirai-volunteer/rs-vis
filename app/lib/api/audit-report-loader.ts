/** audit-report.json（会計検査院 決算検査報告）の読み込み。生成は scripts/generate-audit-report.py */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { AuditReportFile, AuditReportItem } from '@/types/audit-report';

let cache: AuditReportFile | null | undefined;
export function loadAuditReport(): AuditReportFile | null {
  if (cache === undefined) cache = tryReadDataJson<AuditReportFile>('audit-report.json');
  return cache;
}

/** その事業に対応づけた指摘。新しい検査報告から */
export function auditItemsOfProject(data: AuditReportFile, pid: string): AuditReportItem[] {
  const ids = new Set(data.byPid[pid] ?? []);
  return data.items.filter(i => ids.has(i.id)).sort((a, b) => b.fiscalYear - a.fiscalYear || a.id.localeCompare(b.id));
}
