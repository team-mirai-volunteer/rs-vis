/**
 * rs{YEAR}-project-indicators.json（成果目標・実績）の読み込み・メモリキャッシュ。
 * /api/project-indicators/[projectId] が使う。生成は scripts/generate-project-outcomes.py
 */
import type { ProjectIndicatorsData, ProjectIndicators } from '@/types/project-indicators';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { tryReadDataJson } from '@/app/lib/api/data-file';

const cache = new Map<SupportedYear, ProjectIndicatorsData | null>();

/** 年度ぶんの成果目標・実績。ファイルが無ければ null（未生成の年度） */
export function loadProjectIndicators(year: SupportedYear): ProjectIndicatorsData | null {
  if (cache.has(year)) return cache.get(year)!;
  const data = tryReadDataJson<ProjectIndicatorsData>(`rs${year}-project-indicators.json`);
  cache.set(year, data);
  return data;
}

/** 1 事業の成果目標・実績。データ未生成・指標なしはどちらも undefined */
export function getProjectIndicators(year: SupportedYear, pid: string): ProjectIndicators | undefined {
  return loadProjectIndicators(year)?.[pid];
}
