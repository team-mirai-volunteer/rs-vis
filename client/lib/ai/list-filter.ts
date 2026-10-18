/**
 * AI ナビの結果（ResolvedSankeyQuery）を、一覧型のページ（評価一覧・委託構造・バブルチャート）の
 * 事業リストにその場で当てるための判定。
 *
 * 一覧の行は「事業名・府省庁・予算額・pid」しか持たないので、当てられるのは
 * 事業名（部分一致・正規表現）・府省庁・予算額の範囲・AI が選んだ事業 ID の 4 条件。
 * 支出先名・支出額・再委託・会計区分はサンキー図の行データでしか判定できないので「このページでは適用できない条件」として返し、
 * UI で「サンキー図で見る」へ誘導する。純粋関数。
 */
import type { ResolvedSankeyQuery } from '@/types/sankey-query';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';
import { applySankeyQueryToUnifiedFilter } from '@/client/lib/unified-ai-filter';
import { UNIFIED_FILTER_DEFAULT } from '@/types/unified-budget-view';

export interface AiListFilter {
  query: ResolvedSankeyQuery;
  /** チップに出す短い説明（applySankeyQueryToUnifiedFilter と同じ文言） */
  summary: string;
  /** このページでは適用できなかった条件の名前（空なら全部適用できた） */
  unsupported: string[];
  /** 事業名の判定器（正規表現が不正なら部分一致に落とす） */
  matchName: ((name: string) => boolean) | null;
}

/** 一覧の 1 行から判定に必要な値だけを取り出した形 */
export interface AiListItem {
  pid: string;
  name: string;
  ministry: string;
  /** 予算額（円）。無ければ null（金額条件があると落ちる） */
  budget: number | null;
}

function buildNameMatcher(filter: ResolvedSankeyQuery['filter']['projectName']): AiListFilter['matchName'] {
  if (!filter || !filter.query) return null;
  if (filter.regex) {
    try {
      const re = new RegExp(filter.query, 'i');
      return (name: string) => re.test(name);
    } catch {
      // 不正な正規表現は部分一致に落とす
    }
  }
  const q = filter.query.toLowerCase();
  return (name: string) => name.toLowerCase().includes(q);
}

export function aiListFilterFrom(result: SankeyChatResult): AiListFilter {
  const f = result.query.filter;
  const unsupported: string[] = [];
  if (f.recipientName) unsupported.push(`支出先「${f.recipientName.query}」`);
  if (f.spending.min !== null || f.spending.max !== null) unsupported.push('支出額の範囲');
  if (f.subcontract.hasRedelegation) unsupported.push('再委託の有無');
  // 会計区分は 4 種すべて = 条件なし
  if (f.accountCategories.length > 0 && f.accountCategories.length < 4) unsupported.push('会計区分');
  return {
    query: result.query,
    summary: applySankeyQueryToUnifiedFilter(UNIFIED_FILTER_DEFAULT, result.query).summary,
    unsupported,
    matchName: buildNameMatcher(f.projectName),
  };
}

export function matchesAiListFilter(ai: AiListFilter, item: AiListItem): boolean {
  const f = ai.query.filter;
  if (f.projectIds.length > 0 && !f.projectIds.includes(item.pid)) return false;
  if (f.ministries.length > 0 && !f.ministries.includes(item.ministry)) return false;
  if (ai.matchName && !ai.matchName(item.name)) return false;
  if (f.budget.min !== null && (item.budget === null || item.budget < f.budget.min)) return false;
  if (f.budget.max !== null && (item.budget === null || item.budget > f.budget.max)) return false;
  return true;
}
