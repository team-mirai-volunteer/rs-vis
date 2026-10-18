/**
 * 統合ビュー（/budget-sankey）の絞り込み ⇄ URL パラメータ。
 *
 * ページ（app/budget-sankey/page.tsx）の URL 同期と、AI ナビの「サンキー図で見る」リンク
 * （client/lib/ai/result-links.ts）が同じ語彙を使うようにここへ置く。純関数。
 *
 *   fbig=1 巨大特会を含める / fnrs=0 非事業ノードを隠す / fmi 所管（複数）/ fac 会計区分（複数）/ fq 名前
 *   fbmin・fbmax 予算額の下限・上限 / fsmin・fsmax 支出額の下限・上限
 *   fpq 事業名・fpr=1 正規表現 / frq 支出先名・frr=1 正規表現・frs=1 再委託先を含む / fpid AI が選んだ事業 ID（カンマ区切り）
 *   fsub=has|none 再委託の有無・fsd 階層の下限 / fso・fsx・fsn スコア範囲 "lo-hi"
 */
import { UNIFIED_FILTER_DEFAULT, UNIFIED_SCORE_RANGE_EMPTY, type UnifiedScoreRange, type UnifiedViewFilter } from '@/types/unified-budget-view';

/** スコア範囲の URL 表現 "min-max"（片方だけなら "60-" / "-40"） */
export function parseScoreRange(v: string | null): UnifiedScoreRange {
  if (!v) return UNIFIED_SCORE_RANGE_EMPTY;
  const i = v.indexOf('-');
  return i < 0 ? { min: v, max: '' } : { min: v.slice(0, i), max: v.slice(i + 1) };
}
export const serializeScoreRange = (r: UnifiedScoreRange): string | null => (r.min || r.max ? `${r.min}-${r.max}` : null);

export function parseFilter(params: URLSearchParams): UnifiedViewFilter {
  const fsub = params.get('fsub');
  const fsd = Number(params.get('fsd'));
  return {
    includeCollapsedAccounts: params.get('fbig') === '1',
    showNonRs: params.get('fnrs') !== '0',
    ministries: params.getAll('fmi'),
    accountTypes: params.getAll('fac').filter((v): v is 'general' | 'special' => v === 'general' || v === 'special'),
    nameQuery: params.get('fq') ?? '',
    budgetMin: params.get('fbmin') ?? '',
    budgetMax: params.get('fbmax') ?? '',
    spendingMin: params.get('fsmin') ?? '',
    spendingMax: params.get('fsmax') ?? '',
    projectIds: (params.get('fpid') ?? '').split(',').map(v => v.trim()).filter(Boolean),
    projectQuery: params.get('fpq') ?? '',
    projectRegex: params.get('fpr') === '1',
    recipientQuery: params.get('frq') ?? '',
    recipientRegex: params.get('frr') === '1',
    recipientIncludeSub: params.get('frs') === '1',
    subcontract: fsub === 'has' || fsub === 'none' ? fsub : 'any',
    subcontractMinDepth: Number.isInteger(fsd) && fsd >= 2 ? fsd : UNIFIED_FILTER_DEFAULT.subcontractMinDepth,
    scoreO: parseScoreRange(params.get('fso')),
    scoreX: parseScoreRange(params.get('fsx')),
    scoreN: parseScoreRange(params.get('fsn')),
  };
}

export function serializeFilter(params: URLSearchParams, filter: UnifiedViewFilter): void {
  if (filter.includeCollapsedAccounts) params.set('fbig', '1');
  if (!filter.showNonRs) params.set('fnrs', '0');
  for (const m of filter.ministries) params.append('fmi', m);
  for (const a of filter.accountTypes) params.append('fac', a);
  if (filter.nameQuery.trim()) params.set('fq', filter.nameQuery.trim());
  if (filter.budgetMin.trim()) params.set('fbmin', filter.budgetMin.trim());
  if (filter.budgetMax.trim()) params.set('fbmax', filter.budgetMax.trim());
  if (filter.spendingMin.trim()) params.set('fsmin', filter.spendingMin.trim());
  if (filter.spendingMax.trim()) params.set('fsmax', filter.spendingMax.trim());
  if (filter.projectQuery.trim()) {
    params.set('fpq', filter.projectQuery.trim());
    if (filter.projectRegex) params.set('fpr', '1');
  }
  if (filter.projectIds.length > 0) {
    params.set('fpid', filter.projectIds.join(','));
  }
  if (filter.recipientQuery.trim()) {
    params.set('frq', filter.recipientQuery.trim());
    if (filter.recipientRegex) params.set('frr', '1');
    if (filter.recipientIncludeSub) params.set('frs', '1');
  }
  if (filter.subcontract !== 'any') {
    params.set('fsub', filter.subcontract);
    if (filter.subcontract === 'has' && filter.subcontractMinDepth !== UNIFIED_FILTER_DEFAULT.subcontractMinDepth) params.set('fsd', String(filter.subcontractMinDepth));
  }
  const fso = serializeScoreRange(filter.scoreO);
  const fsx = serializeScoreRange(filter.scoreX);
  const fsn = serializeScoreRange(filter.scoreN);
  if (fso) params.set('fso', fso);
  if (fsx) params.set('fsx', fsx);
  if (fsn) params.set('fsn', fsn);
}
