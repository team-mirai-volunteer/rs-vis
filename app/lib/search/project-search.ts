/**
 * 事業名検索（Pure関数）。
 * quality-scores のアイテム配列を入力に、正規化済み部分一致でフィルタする。
 */
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';

/** 検索用正規化: NFKC + 小文字化 + 空白除去 */
export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export interface ProjectSearchOptions {
  limit: number;
  offset: number;
  sortBy: 'budget' | 'spending';
}

export interface ProjectSearchResult {
  totalHits: number;
  items: QualityScoreItem[];
}

export function searchProjects(
  allItems: QualityScoreItem[],
  query: string,
  opts: ProjectSearchOptions,
): ProjectSearchResult {
  const q = normalizeQuery(query);
  if (!q) return { totalHits: 0, items: [] };

  const hits = allItems.filter(i => normalizeQuery(i.name).includes(q));

  hits.sort((a, b) =>
    opts.sortBy === 'spending'
      ? b.spendTotal - a.spendTotal
      : b.budgetAmount - a.budgetAmount,
  );

  return {
    totalHits: hits.length,
    items: hits.slice(opts.offset, opts.offset + opts.limit),
  };
}
