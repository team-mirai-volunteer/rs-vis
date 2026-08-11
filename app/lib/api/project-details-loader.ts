/**
 * rs{YEAR}-project-details.json の読み込み・メモリキャッシュ。
 * /api/project-details/[projectId] と app/lib/ai/sankey-chat-agent.ts（深掘りツール）が共用する。
 */
import type { ProjectDetailsData, ProjectDetail } from '@/types/project-details';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { readDataJson } from '@/app/lib/api/data-file';

const cache = new Map<SupportedYear, ProjectDetailsData>();

/** 事業詳細データを取得（年度別キャッシュ付き） */
export function loadProjectDetails(year: SupportedYear): ProjectDetailsData {
  if (cache.has(year)) return cache.get(year)!;

  const data = readDataJson<ProjectDetailsData>(
    `rs${year}-project-details.json`,
    'npm run generate-project-details を実行してください。'
  );
  cache.set(year, data);
  console.log(`[API] Project details data loaded into cache (year=${year})`);
  return data;
}

/** projectId 単体の詳細を取得。見つからなければ undefined */
export function getProjectDetail(year: SupportedYear, projectId: string): ProjectDetail | undefined {
  return loadProjectDetails(year)[projectId];
}
