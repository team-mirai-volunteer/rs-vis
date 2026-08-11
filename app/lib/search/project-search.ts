/**
 * 事業名検索（Pure関数）。
 * quality-scores のアイテム配列を入力に、正規化済み部分一致でフィルタする。
 * scope=details 指定時は project-details（purpose/overview/currentIssues）も対象に含める。
 */
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { ProjectDetailsData } from '@/types/project-details';

/** 検索用正規化: NFKC + 小文字化 + 空白除去 */
export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export type ProjectSearchScope = 'name' | 'details';

export const PROJECT_SEARCH_SCOPES: readonly ProjectSearchScope[] = ['name', 'details'];

export interface ProjectSearchOptions {
  limit: number;
  offset: number;
  sortBy: 'budget' | 'spending';
  /** 検索対象。'name'（既定）= 事業名のみ / 'details' = 事業名 + 事業詳細（purpose/overview/currentIssues） */
  scope?: ProjectSearchScope;
  /** scope='details' 時に使う事業詳細データ（app/lib/api/project-details-loader.ts の loadProjectDetails 結果） */
  projectDetails?: ProjectDetailsData;
}

export interface ProjectSearchHit {
  item: QualityScoreItem;
  /** マッチ箇所。事業名・詳細の両方にマッチした場合は 'name' を優先する */
  matchedIn: 'name' | 'details';
}

export interface ProjectSearchResult {
  totalHits: number;
  items: ProjectSearchHit[];
}

export function searchProjects(
  allItems: QualityScoreItem[],
  query: string,
  opts: ProjectSearchOptions,
): ProjectSearchResult {
  const q = normalizeQuery(query);
  if (!q) return { totalHits: 0, items: [] };

  const scope = opts.scope ?? 'name';
  const details = opts.projectDetails;

  const matchesDetails = (pid: string): boolean => {
    const d = details?.[pid];
    if (!d) return false;
    return (
      normalizeQuery(d.purpose ?? '').includes(q) ||
      normalizeQuery(d.overview ?? '').includes(q) ||
      normalizeQuery(d.currentIssues ?? '').includes(q)
    );
  };

  const hits: ProjectSearchHit[] = [];
  for (const item of allItems) {
    const nameMatch = normalizeQuery(item.name).includes(q);
    if (nameMatch) {
      hits.push({ item, matchedIn: 'name' });
      continue;
    }
    if (scope === 'details' && matchesDetails(item.pid)) {
      hits.push({ item, matchedIn: 'details' });
    }
  }

  hits.sort((a, b) =>
    opts.sortBy === 'spending'
      ? b.item.spendTotal - a.item.spendTotal
      : b.item.budgetAmount - a.item.budgetAmount,
  );

  return {
    totalHits: hits.length,
    items: hits.slice(opts.offset, opts.offset + opts.limit),
  };
}
