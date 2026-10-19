/**
 * AI ナビの結果（ResolvedSankeyQuery）から、各ページへのリンクを組み立てる。
 *
 * サンキー図以外のページで AI を使ったとき、結果を「サンキー図で見る」「この事業の詳細」として案内する。
 * URL の語彙はサンキー図のページ（app/lib/unified-budget/filter-url.ts）と同じものを使う。純関数。
 */
import type { ResolvedSankeyQuery } from '@/types/sankey-query';
import { UNIFIED_FILTER_DEFAULT } from '@/types/unified-budget-view';
import { serializeFilter } from '@/app/lib/unified-budget/filter-url';
import { sheetYearToBudgetYear, UNIFIED_RS_COLS, unifiedProjectUrl } from '@/app/lib/unified-budget/links';
import { rsViewUrl } from '@/app/lib/rs-fiscal-year';
import { applySankeyQueryToUnifiedFilter } from '@/client/lib/unified-ai-filter';

/** 結果の条件をそのまま絞り込みに写した状態でサンキー図（RS のみの列）を開く URL */
export function sankeyUrlForQuery(query: ResolvedSankeyQuery, sheetYear: number | string): string {
  const params = new URLSearchParams({ year: String(sheetYearToBudgetYear(sheetYear)), cols: UNIFIED_RS_COLS, fnrs: '0' });
  serializeFilter(params, applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, query).filter);
  params.set('ffp', '1');
  return `/budget-sankey?${params.toString()}`;
}

/** 事業 1 件へのリンク（評価一覧の詳細ダイアログ・委託構造・サンキー図） */
export function projectLinks(pid: number | string, sheetYear: number | string): { quality: string; subcontracts: string; sankey: string } {
  return {
    quality: rsViewUrl(`/quality?detail=${encodeURIComponent(String(pid))}`, sheetYear),
    subcontracts: rsViewUrl(`/subcontracts/${encodeURIComponent(String(pid))}`, sheetYear),
    sankey: unifiedProjectUrl(pid, sheetYear),
  };
}
