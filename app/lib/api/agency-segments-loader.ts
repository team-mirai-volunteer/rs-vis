/** agency-segments.json（独立行政法人のセグメントシート）の読み込み。生成は scripts/generate-agency-segments.ts */
import { tryReadDataJson } from '@/app/lib/api/data-file';
import type { AgencySegment, AgencySegmentsFile } from '@/types/agency-segments';

let cache: AgencySegmentsFile | null | undefined;
export function loadAgencySegments(): AgencySegmentsFile | null {
  if (cache === undefined) cache = tryReadDataJson<AgencySegmentsFile>('agency-segments.json');
  return cache;
}

/** その事業に結びつくセグメント。指定のシート年度があればその年度、無ければ最新の年度。執行額の大きい順 */
export function segmentsOfProject(data: AgencySegmentsFile, pid: string, sheetYear?: number): AgencySegment[] {
  const ids = new Set(data.byPid[pid] ?? []);
  const all = data.segments.filter(s => ids.has(s.id));
  const years = [...new Set(all.map(s => s.sheetYear))].sort((a, b) => b - a);
  const year = sheetYear !== undefined && years.includes(sheetYear) ? sheetYear : years[0];
  return all.filter(s => s.sheetYear === year).sort((a, b) => (b.execution ?? 0) - (a.execution ?? 0));
}
