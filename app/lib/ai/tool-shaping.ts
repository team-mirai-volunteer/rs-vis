/**
 * AIチャットツール応答の整形・クランプ（実行環境非依存の Pure 層）。
 *
 * サーバ実装（tool-executor-server.ts）とクライアント実装
 * （client/lib/ai/client-tool-executor.ts）が共有し、両モードのツール応答
 * （LLM に渡る JSON）の形を揃える。ここに整形を寄せることが応答同一性の担保。
 * fs・fetch・React は import しない。
 */
import type { GraphData } from '@/types/sankey-svg';
import type { SankeyQuery } from '@/types/sankey-query';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';
import type { SubcontractGraph } from '@/types/subcontract';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import {
  resolveSankeyQuery,
  buildFilterExcludedIds,
  summarizeFilteredGraph,
  compareYearsSummary,
} from '@/app/lib/sankey-query';
import type { SankeyQuerySummary } from '@/app/lib/sankey-query';
import { HIGHLIGHT_METRIC_NAMES, type HighlightMetricName, type HighlightsResult } from '@/app/lib/highlights';

// ── 共有定数 ──

/** 検索ツールが返す最大件数 */
export const SEARCH_LIMIT = 10;
/** get_quality_scores に渡せる pid の上限件数 */
export const QUALITY_SCORES_PID_LIMIT = 10;
/** get_recipient_detail / get_subcontract_chain が返す上位件数 */
export const DETAIL_TOP_LIMIT = 10;
/** ツール応答の目安上限文字数（JSON.stringify後）。超過時は配列を段階的に間引く */
const RESPONSE_CHAR_LIMIT = 4000;
/** テキストフィールド（目的・概要等）の切り詰め文字数 */
const TEXT_FIELD_LIMIT = 600;
/** get_highlights の metric 省略時（ダイジェスト）に各指標から見せる件数 */
const HIGHLIGHTS_DIGEST_TOP = 3;
/** compare_years の diff リスト（increased/decreased/added/removed）の上位件数 */
const COMPARE_DIFF_TOP_LIMIT = 5;

/** run_sankey_query / submit_result の実行結果 */
export interface QueryExecution {
  errors?: string[];
  result?: SankeyChatResult;
}

// ── 汎用クランプ ──

/** 長文フィールドを既定文字数で切り詰める（末尾に「…」） */
export function clampText(s: string | null | undefined, limit: number = TEXT_FIELD_LIMIT): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return t.length <= limit ? t : `${t.slice(0, limit)}…`;
}

/**
 * JSON.stringify後の文字数が目安上限を超える場合、指定した配列フィールドを
 * 半分ずつ間引いて再試行する安全策（テキスト側は既に clampText 済みの前提）。
 */
export function clampPayload<T extends Record<string, unknown>>(payload: T, arrayKeys: (keyof T)[]): T {
  let current = payload;
  for (let i = 0; i < 5; i++) {
    if (JSON.stringify(current).length <= RESPONSE_CHAR_LIMIT) return current;
    let shrunk = false;
    for (const key of arrayKeys) {
      const arr = current[key];
      if (Array.isArray(arr) && arr.length > 1) {
        current = { ...current, [key]: arr.slice(0, Math.max(1, Math.ceil(arr.length / 2))) };
        shrunk = true;
        break;
      }
    }
    if (!shrunk) break;
  }
  return current;
}

/** get_quality_scores の pids 引数を検証・切り詰める（両実装共通） */
export function validateQualityScorePids(pidsRaw: unknown): { error: string } | { pids: string[]; notice?: string } {
  if (!Array.isArray(pidsRaw) || pidsRaw.length === 0) {
    return { error: 'pids（事業IDの配列）を指定してください' };
  }
  const pids = pidsRaw.filter((p): p is string => typeof p === 'string');
  if (pids.length > QUALITY_SCORES_PID_LIMIT) {
    return {
      pids: pids.slice(0, QUALITY_SCORES_PID_LIMIT),
      notice: `pidsは最大${QUALITY_SCORES_PID_LIMIT}件です。先頭${QUALITY_SCORES_PID_LIMIT}件のみ処理しました`,
    };
  }
  return { pids };
}

/** get_highlights の metric 引数を検証する（両実装共通）。undefined/null はダイジェスト指定 */
export function validateHighlightMetric(metricRaw: unknown): { error: string } | { metric: HighlightMetricName | undefined } {
  if (metricRaw === undefined || metricRaw === null) return { metric: undefined };
  if (typeof metricRaw !== 'string' || !(HIGHLIGHT_METRIC_NAMES as readonly string[]).includes(metricRaw)) {
    return { error: `metric は次のいずれかを指定してください: ${HIGHLIGHT_METRIC_NAMES.join(' | ')}` };
  }
  return { metric: metricRaw as HighlightMetricName };
}

// ── グラフ由来ツール（run_sankey_query / compare_years / 府省庁一覧） ──
// graph の取得だけが環境依存（サーバ=ローダ、クライアント=ページ状態 or fetch）のため、
// getGraph を注入して実装全体を共有する。

export type GraphSource = (year: SupportedYear) => Promise<GraphData> | GraphData;

/** システムプロンプト用の府省庁名一覧（集約ノード除外・重複排除・ソート） */
export function ministryNamesFromGraph(graph: GraphData): string[] {
  return [...new Set(
    graph.nodes.filter(n => n.type === 'ministry' && !n.aggregated).map(n => n.name),
  )].sort();
}

/** クエリを検証・実行してサマリを返す。errors があれば summary は付かない */
export async function executeQueryWithGraph(
  getGraph: GraphSource,
  input: SankeyQuery,
  defaultYear: SupportedYear,
): Promise<QueryExecution> {
  const withYear: SankeyQuery = { ...input, year: input.year ?? defaultYear };
  const { query, errors } = resolveSankeyQuery(withYear);
  if (errors.length > 0) return { errors };
  const graph = await getGraph(query.year);
  const excludedIds = buildFilterExcludedIds(graph.nodes, graph.edges, query.filter, [query.view.pin.projectId]);
  const summary = summarizeFilteredGraph(graph.nodes, graph.edges, excludedIds);
  return { result: { query, summary } };
}

function clampDiffList<T>(list: T[]): T[] {
  return list.slice(0, COMPARE_DIFF_TOP_LIMIT);
}

/** compare_years の年度summaryを要約（count・budgetTotal・spendingTotalのみ。topリストやtopShareは省く） */
function clampYearSummary(s: SankeyQuerySummary) {
  return {
    projects: { count: s.projects.count, budgetTotal: s.projects.budgetTotal, spendingTotal: s.projects.spendingTotal },
    recipients: { count: s.recipients.count },
  };
}

export async function executeCompareYearsWithGraph(
  getGraph: GraphSource,
  queryInput: SankeyQuery | undefined,
  baseYear: SupportedYear,
  compareYear: SupportedYear,
): Promise<unknown> {
  if (baseYear === compareYear) {
    return { error: 'baseYear と compareYear には異なる年度を指定してください' };
  }
  const withYear: SankeyQuery = { ...(queryInput ?? {}), year: baseYear };
  const { query, errors } = resolveSankeyQuery(withYear);
  if (errors.length > 0) return { errors };

  const baseGraph = await getGraph(baseYear);
  const compareGraph = await getGraph(compareYear);
  const baseExcludedIds = buildFilterExcludedIds(baseGraph.nodes, baseGraph.edges, query.filter, [query.view.pin.projectId]);
  const compareExcludedIds = buildFilterExcludedIds(compareGraph.nodes, compareGraph.edges, query.filter, [query.view.pin.projectId]);
  const result = compareYearsSummary(
    { nodes: baseGraph.nodes, edges: baseGraph.edges, excludedIds: baseExcludedIds },
    { nodes: compareGraph.nodes, edges: compareGraph.edges, excludedIds: compareExcludedIds },
  );

  const payload = {
    baseYear,
    compareYear,
    appliedFilter: query.filter,
    base: clampYearSummary(result.base),
    compare: clampYearSummary(result.compare),
    diff: {
      projects: {
        increased: clampDiffList(result.diff.projects.increased),
        decreased: clampDiffList(result.diff.projects.decreased),
        added: clampDiffList(result.diff.projects.added),
        removed: clampDiffList(result.diff.projects.removed),
      },
      recipients: {
        increased: clampDiffList(result.diff.recipients.increased),
        decreased: clampDiffList(result.diff.recipients.decreased),
        added: clampDiffList(result.diff.recipients.added),
        removed: clampDiffList(result.diff.recipients.removed),
      },
    },
  };
  return clampPayload(payload, []);
}

// ── データ構造を受け取る整形（データ取得は呼び出し側の責務） ──

/** get_subcontract_chain: SubcontractGraph → 要約 payload */
export function shapeSubcontractChain(pid: string, graph: SubcontractGraph): unknown {
  const blockMap = new Map(graph.blocks.map(b => [b.blockId, b]));
  // 再委託総額: 同一支出先が複数ブロックに出現しうるため（既知の注意事項）find ではなく filter+reduce で合算する
  const subcontractTotal = graph.blocks
    .filter(b => b.originKind === 'subcontract')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const topChains = graph.flows
    .map(flow => {
      const sourceBlock = flow.sourceBlock ? blockMap.get(flow.sourceBlock) : null;
      const targetBlock = blockMap.get(flow.targetBlock);
      return {
        from: sourceBlock?.blockName ?? '(事業本体)',
        to: targetBlock?.blockName ?? flow.targetBlock,
        amount: targetBlock?.totalAmount ?? 0,
        origin: flow.origin,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, DETAIL_TOP_LIMIT);
  return clampPayload(
    {
      pid,
      projectName: graph.projectName,
      totalBlockCount: graph.totalBlockCount,
      directBlockCount: graph.directBlockCount,
      maxDepth: graph.maxDepth,
      totalRecipientCount: graph.totalRecipientCount,
      subcontractTotal,
      hasSeparateOrigin: graph.hasSeparateOrigin,
      topChains,
    },
    ['topChains'],
  );
}

/** spendingChange のサブリスト（increased/decreased/added/removed）を指定件数に切る */
function digestSpendingChange(sc: HighlightsResult['metrics']['spendingChange'], limit: number) {
  return {
    priorYear: sc.priorYear,
    increased: sc.increased.slice(0, limit),
    decreased: sc.decreased.slice(0, limit),
    added: sc.added.slice(0, limit),
    removed: sc.removed.slice(0, limit),
  };
}

/**
 * get_highlights: HighlightsResult（と同形のデータ）→ payload。
 * metric は validateHighlightMetric 済みを渡すこと。
 */
export function shapeHighlights(result: HighlightsResult, metric: HighlightMetricName | undefined): unknown {
  if (metric !== undefined) {
    if (metric === 'spendingChange') {
      return clampPayload(
        { metric, ...digestSpendingChange(result.metrics.spendingChange, DETAIL_TOP_LIMIT) },
        ['increased', 'decreased', 'added', 'removed'],
      );
    }
    return clampPayload({ metric, entries: result.metrics[metric] }, ['entries']);
  }

  return clampPayload(
    {
      multiSignal: result.multiSignal,
      metrics: {
        spendingChange: digestSpendingChange(result.metrics.spendingChange, HIGHLIGHTS_DIGEST_TOP),
        otherRatio: result.metrics.otherRatio.slice(0, HIGHLIGHTS_DIGEST_TOP),
        concentration: result.metrics.concentration.slice(0, HIGHLIGHTS_DIGEST_TOP),
        lowScoreHighBudget: result.metrics.lowScoreHighBudget.slice(0, HIGHLIGHTS_DIGEST_TOP),
        execBudgetGap: result.metrics.execBudgetGap.slice(0, HIGHLIGHTS_DIGEST_TOP),
        subcontractDepth: result.metrics.subcontractDepth.slice(0, HIGHLIGHTS_DIGEST_TOP),
      },
    },
    ['multiSignal'],
  );
}
