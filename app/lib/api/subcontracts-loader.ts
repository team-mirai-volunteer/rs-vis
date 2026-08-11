/**
 * subcontracts-{YEAR}.json の読み込み・メモリキャッシュ。
 * /api/subcontracts/[projectId] と app/lib/ai/sankey-chat-agent.ts（深掘りツール）が共用する。
 */
import type { SubcontractIndex } from '@/types/subcontract';
import type { BudgetSummary, BudgetBreakdownItem } from '@/types/sankey-svg';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { tryReadDataJson } from '@/app/lib/api/data-file';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';

const cache = new Map<SupportedYear, SubcontractIndex>();

/** 再委託構造インデックスを取得（年度別キャッシュ付き）。ファイルが無ければ null */
export function loadSubcontracts(year: SupportedYear): SubcontractIndex | null {
  if (cache.has(year)) return cache.get(year)!;
  const data = tryReadDataJson<SubcontractIndex>(`subcontracts-${year}.json`);
  if (data === null) return null;
  cache.set(year, data);
  return data;
}

export interface ProjectBudgetComposition {
  budgetSummary: BudgetSummary | null;
  budgetBreakdown: BudgetBreakdownItem[];
}

/**
 * 事業の予算・執行内訳を取得する。再委託データ側には持たないため、
 * サンキーグラフ（loadSankeyGraph・年度キャッシュ付き）の project-budget ノードから合成する。
 * 再委託ページの「予算・執行」タブ表示に使う。該当ノードが無ければ空を返す。
 */
export function loadProjectBudgetComposition(year: SupportedYear, projectId: string): ProjectBudgetComposition {
  const budgetNode = loadSankeyGraph(year).nodes.find(
    n => n.type === 'project-budget' && String(n.projectId) === String(projectId)
  );
  return {
    budgetSummary: budgetNode?.budgetSummary ?? null,
    budgetBreakdown: budgetNode?.budgetBreakdown ?? [],
  };
}
