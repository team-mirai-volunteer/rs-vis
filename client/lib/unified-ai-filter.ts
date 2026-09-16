/**
 * AI チャットの結果（ResolvedSankeyQuery）を統合ビューのフィルター状態へ写す。
 *
 * 統合ビューの絞り込み UI で表現できる条件だけを写し、それ以外（TopN・ピン等の表示条件）は
 * 無視する。金額は 1 円単位の数値を「億円」テキストへ変換する（UI の入力欄と同じ表現）。
 * 純粋関数。React・HTTP を含めない。
 */
import type { ResolvedSankeyQuery } from '@/types/sankey-query';
import { UNIFIED_FILTER_DEFAULT, type UnifiedViewFilter } from '@/types/unified-budget-view';

/** AI が触るフィールドだけを既定へ戻す（利用者の手動条件は残す） */
export const AI_FILTER_FIELDS = [
  'ministries', 'accountTypes', 'projectQuery', 'projectRegex', 'recipientQuery', 'recipientRegex', 'recipientIncludeSub',
  'budgetMin', 'budgetMax', 'spendingMin', 'spendingMax', 'subcontract', 'subcontractMinDepth', 'projectIds',
] as const satisfies readonly (keyof UnifiedViewFilter)[];

type AiFilterField = (typeof AI_FILTER_FIELDS)[number];
const aiDefaults = (): Pick<UnifiedViewFilter, AiFilterField> =>
  Object.fromEntries(AI_FILTER_FIELDS.map(key => [key, UNIFIED_FILTER_DEFAULT[key]])) as Pick<UnifiedViewFilter, AiFilterField>;

const yenToOkuText = (yen: number | null) => {
  if (yen === null || !Number.isFinite(yen)) return '';
  const oku = yen / 1e8;
  return `${Number.isInteger(oku) ? oku : Number(oku.toFixed(2))}億`;
};

/** 結果を写した新しいフィルターと、チップ用の短い説明を返す */
export function applySankeyQueryToUnifiedFilter(current: UnifiedViewFilter, query: ResolvedSankeyQuery): { filter: UnifiedViewFilter; summary: string } {
  const f = query.filter;
  const parts: string[] = [];
  const next: UnifiedViewFilter = { ...current, ...aiDefaults() };

  if (f.ministries.length) { next.ministries = [...f.ministries]; parts.push(f.ministries.join('・')); }
  const accounts = f.accountCategories.filter((c): c is 'general' | 'special' => c === 'general' || c === 'special');
  if (accounts.length && accounts.length < 2 && !f.accountCategories.includes('both')) {
    next.accountTypes = accounts; parts.push(accounts[0] === 'general' ? '一般会計' : '特別会計');
  }
  if (f.projectName) {
    next.projectQuery = f.projectName.query; next.projectRegex = !!f.projectName.regex;
    parts.push(`事業名「${f.projectName.query}」`);
  }
  if (f.recipientName) {
    next.recipientQuery = f.recipientName.query; next.recipientRegex = !!f.recipientName.regex;
    next.recipientIncludeSub = !!f.recipientName.includeSubcontract;
    parts.push(`支出先「${f.recipientName.query}」`);
  }
  if (f.budget.min !== null || f.budget.max !== null) {
    next.budgetMin = yenToOkuText(f.budget.min); next.budgetMax = yenToOkuText(f.budget.max);
    parts.push(`予算 ${next.budgetMin || '0'}〜${next.budgetMax || ''}`);
  }
  if (f.spending.min !== null || f.spending.max !== null) {
    next.spendingMin = yenToOkuText(f.spending.min); next.spendingMax = yenToOkuText(f.spending.max);
    parts.push(`支出 ${next.spendingMin || '0'}〜${next.spendingMax || ''}`);
  }
  if ((f.projectIds ?? []).length > 0) {
    next.projectIds = [...f.projectIds];
    parts.push(`AIが選んだ${f.projectIds.length}事業`);
  }
  if (f.subcontract.hasRedelegation) {
    next.subcontract = 'has';
    next.subcontractMinDepth = f.subcontract.minDepth ?? UNIFIED_FILTER_DEFAULT.subcontractMinDepth;
    parts.push(next.subcontractMinDepth > 2 ? `再々委託以深` : '再委託あり');
  }
  return { filter: next, summary: parts.join(' / ') || '条件なし' };
}

/** AI が写したフィールドだけ既定へ戻す */
export function clearAiFilter(current: UnifiedViewFilter): UnifiedViewFilter {
  return { ...current, ...aiDefaults() };
}
