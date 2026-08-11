/**
 * highlights 異常度指標（WP4-1）— 観測可能な「注目シグナル」の全事業スキャン（Pure関数のみ）。
 *
 * 設計の正典: docs/api-guide.md の `GET /api/highlights`（語彙の規律・合成スコアを作らない原則・母集団下限）
 *
 * 語彙の規律: このファイルは「無駄」「異常」を判定しない。計算するのは観測可能な事実
 * （比率・差分・順位）のみで、重み付き合成スコアも作らない（指標別の上位リスト + 複数指標
 * 共起リストで代替する）。
 *
 * 入力（graph 1〜2年度分・品質スコア items）はすべて呼び出し側（loader）が読み込み済みのものを
 * 引数で受け取る。このファイル自体は fs・HTTP を扱わない。
 */
import type { RawNode, RawEdge } from '@/types/sankey-svg';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import {
  compareYearsSummary,
  type SankeyProjectDiffEntry,
  type SankeyProjectPresenceEntry,
} from '@/app/lib/sankey-query';

/** 各指標の上位抽出件数 */
const TOP_N = 10;
/** ノイズ抑制の支出額下限（otherRatio・concentration・subcontractDepth の母集団に適用。設計ドキュメント未決事項1の確定値） */
export const HIGHLIGHTS_MIN_SPEND_YEN = 1_000_000_000;
/** multiSignal の該当条件（該当指標数の下限。設計ドキュメント未決事項2の確定値） */
export const HIGHLIGHTS_MULTI_SIGNAL_MIN_METRICS = 2;

export type HighlightMetricName =
  | 'spendingChange'
  | 'otherRatio'
  | 'concentration'
  | 'lowScoreHighBudget'
  | 'execBudgetGap'
  | 'subcontractDepth';

export const HIGHLIGHT_METRIC_NAMES: readonly HighlightMetricName[] = [
  'spendingChange', 'otherRatio', 'concentration', 'lowScoreHighBudget', 'execBudgetGap', 'subcontractDepth',
];

export interface HighlightOtherRatioEntry {
  pid: string;
  projectId: number;
  name: string;
  ministry: string | null;
  /** 支出先名「その他」（実データ）への流入額（1円単位） */
  otherAmount: number;
  /** 事業の支出合計（graph の項目支出先ノードへの流出合計、1円単位） */
  spendTotal: number;
  /** otherAmount / spendTotal（0〜1、小数4桁） */
  otherRatio: number;
}

export interface HighlightConcentrationEntry {
  pid: string;
  projectId: number;
  name: string;
  ministry: string | null;
  topRecipientName: string;
  topRecipientAmount: number;
  spendTotal: number;
  /** topRecipientAmount / spendTotal（0〜1、小数4桁） */
  topShare1: number;
}

export interface HighlightLowScoreHighBudgetEntry {
  pid: string;
  name: string;
  ministry: string | null;
  totalScore: number;
  budgetAmount: number;
}

export interface HighlightExecBudgetGapEntry {
  pid: string;
  name: string;
  ministry: string | null;
  budgetAmount: number;
  execAmount: number;
  /** |execAmount / budgetAmount - 1|（小数4桁） */
  gapRatio: number;
}

export interface HighlightSubcontractDepthEntry {
  pid: string;
  name: string;
  ministry: string | null;
  redelegationDepth: number;
  spendTotal: number;
}

export interface HighlightMultiSignalEntry {
  pid: string;
  name: string;
  ministry: string | null;
  /** 該当した指標名（2件以上） */
  signals: HighlightMetricName[];
}

export interface HighlightsSpendingChange {
  /** 比較対象の前年度。対応する年度がない場合は null（2024指定時など） */
  priorYear: SupportedYear | null;
  increased: SankeyProjectDiffEntry[];
  decreased: SankeyProjectDiffEntry[];
  added: SankeyProjectPresenceEntry[];
  removed: SankeyProjectPresenceEntry[];
}

export interface HighlightsResult {
  metrics: {
    spendingChange: HighlightsSpendingChange;
    otherRatio: HighlightOtherRatioEntry[];
    concentration: HighlightConcentrationEntry[];
    lowScoreHighBudget: HighlightLowScoreHighBudgetEntry[];
    execBudgetGap: HighlightExecBudgetGapEntry[];
    subcontractDepth: HighlightSubcontractDepthEntry[];
  };
  multiSignal: HighlightMultiSignalEntry[];
  /** 母集団・閾値の実測値（検証・報告用） */
  meta: {
    minSpendYen: number;
    otherRatioPopulation: number;
    concentrationPopulation: number;
    subcontractDepthPopulation: number;
    /** lowScoreHighBudget の下位25%閾値として使った totalScore（この値以下を対象） */
    lowScoreThreshold: number | null;
  };
}

export interface HighlightsInput {
  year: SupportedYear;
  /** year 年度の graph（フィルタ適用前の全件） */
  currentGraph: { nodes: RawNode[]; edges: RawEdge[] };
  /** year-1 年度の graph（存在する場合のみ。spendingChange に使う） */
  priorGraph?: { year: SupportedYear; nodes: RawNode[]; edges: RawEdge[] };
  qualityItems: QualityScoreItem[];
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** 事業（project-spending ノード）単位の支出先集計 */
interface ProjectRecipientStats {
  /** 事業の支出合計（残存支出先への流出合計） */
  total: number;
  /** 支出先名「その他」への流入額合計 */
  otherAmount: number;
  /** 支出先ノードID → 流入額 */
  recipientAmounts: Map<string, number>;
}

/**
 * graph の edges から事業（projectId）ごとの支出先集計を作る。
 * 集約ノード（aggregated: true、「その他の支出先」）は対象外。raw graph（loadSankeyGraph の出力）
 * は TopN集約前のためこのフラグは基本的に立たないが、将来の入力互換のため判定は残す。
 */
function collectProjectRecipientStats(nodes: RawNode[], edges: RawEdge[]): Map<number, ProjectRecipientStats> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const statsByPid = new Map<number, ProjectRecipientStats>();

  for (const e of edges) {
    if (!e.target.startsWith('r-')) continue;
    const sourceNode = nodeById.get(e.source);
    if (!sourceNode || sourceNode.type !== 'project-spending' || sourceNode.projectId == null || sourceNode.aggregated) continue;
    const targetNode = nodeById.get(e.target);
    if (!targetNode || targetNode.aggregated) continue;

    const pid = sourceNode.projectId;
    let s = statsByPid.get(pid);
    if (!s) {
      s = { total: 0, otherAmount: 0, recipientAmounts: new Map() };
      statsByPid.set(pid, s);
    }
    s.total += e.value;
    if (targetNode.name === 'その他') s.otherAmount += e.value;
    s.recipientAmounts.set(e.target, (s.recipientAmounts.get(e.target) ?? 0) + e.value);
  }
  return statsByPid;
}

function computeOtherRatio(
  stats: Map<number, ProjectRecipientStats>,
  qualityByPid: Map<string, QualityScoreItem>,
): { entries: HighlightOtherRatioEntry[]; population: number } {
  const candidates: HighlightOtherRatioEntry[] = [];
  for (const [projectId, s] of stats) {
    if (s.total <= 0) continue;
    const pid = String(projectId);
    const q = qualityByPid.get(pid);
    if (!q || (q.spendTotal ?? 0) < HIGHLIGHTS_MIN_SPEND_YEN) continue;
    if (s.otherAmount <= 0) continue;
    candidates.push({
      pid,
      projectId,
      name: q.name,
      ministry: q.ministry ?? null,
      otherAmount: s.otherAmount,
      spendTotal: s.total,
      otherRatio: round4(s.otherAmount / s.total),
    });
  }
  const population = [...stats.entries()].filter(([pid]) => {
    const q = qualityByPid.get(String(pid));
    return q != null && (q.spendTotal ?? 0) >= HIGHLIGHTS_MIN_SPEND_YEN;
  }).length;
  candidates.sort((a, b) => b.otherRatio - a.otherRatio || b.otherAmount - a.otherAmount);
  return { entries: candidates.slice(0, TOP_N), population };
}

function computeConcentration(
  stats: Map<number, ProjectRecipientStats>,
  nodeById: Map<string, RawNode>,
  qualityByPid: Map<string, QualityScoreItem>,
): { entries: HighlightConcentrationEntry[]; population: number } {
  const candidates: HighlightConcentrationEntry[] = [];
  for (const [projectId, s] of stats) {
    if (s.total <= 0 || s.recipientAmounts.size === 0) continue;
    const pid = String(projectId);
    const q = qualityByPid.get(pid);
    if (!q || (q.spendTotal ?? 0) < HIGHLIGHTS_MIN_SPEND_YEN) continue;

    let topId: string | null = null;
    let topAmount = -1;
    for (const [rid, amount] of s.recipientAmounts) {
      if (amount > topAmount) { topAmount = amount; topId = rid; }
    }
    if (topId == null) continue;
    candidates.push({
      pid,
      projectId,
      name: q.name,
      ministry: q.ministry ?? null,
      topRecipientName: nodeById.get(topId)?.name ?? topId,
      topRecipientAmount: topAmount,
      spendTotal: s.total,
      topShare1: round4(topAmount / s.total),
    });
  }
  // 母集団は「候補が1件でもあるか」と無関係に常に数える（computeOtherRatio と同じ扱い）
  const population = [...stats.entries()].filter(([pid]) => {
    const q = qualityByPid.get(String(pid));
    return q != null && (q.spendTotal ?? 0) >= HIGHLIGHTS_MIN_SPEND_YEN;
  }).length;
  candidates.sort((a, b) => b.topShare1 - a.topShare1 || b.topRecipientAmount - a.topRecipientAmount);
  return { entries: candidates.slice(0, TOP_N), population };
}

/**
 * lowScoreHighBudget: totalScore が下位25%（下位分位点以下）かつ budgetAmount の大きい順。
 * 分位点はスコアが付いた事業（totalScore != null かつ budgetAmount > 0）の集合から
 * 最近傍ランク法（nearest-rank）で求める。閾値は meta.lowScoreThreshold として応答に含める。
 */
function computeLowScoreHighBudget(
  items: QualityScoreItem[],
): { entries: HighlightLowScoreHighBudgetEntry[]; threshold: number | null } {
  const scored = items.filter((i): i is QualityScoreItem & { totalScore: number } =>
    i.totalScore != null && i.budgetAmount > 0);
  if (scored.length === 0) return { entries: [], threshold: null };

  const sortedScores = [...scored].map(i => i.totalScore).sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sortedScores.length * 0.25) - 1);
  const threshold = sortedScores[idx];

  const candidates = scored
    .filter(i => i.totalScore <= threshold)
    .map(i => ({
      pid: i.pid,
      name: i.name,
      ministry: i.ministry ?? null,
      totalScore: i.totalScore,
      budgetAmount: i.budgetAmount,
    }))
    .sort((a, b) => b.budgetAmount - a.budgetAmount || a.totalScore - b.totalScore);

  return { entries: candidates.slice(0, TOP_N), threshold };
}

function computeExecBudgetGap(items: QualityScoreItem[]): HighlightExecBudgetGapEntry[] {
  const candidates: HighlightExecBudgetGapEntry[] = [];
  for (const i of items) {
    if (!(i.budgetAmount > 0) || i.execAmount == null) continue;
    const gapRatio = round4(Math.abs(i.execAmount / i.budgetAmount - 1));
    candidates.push({
      pid: i.pid,
      name: i.name,
      ministry: i.ministry ?? null,
      budgetAmount: i.budgetAmount,
      execAmount: i.execAmount,
      gapRatio,
    });
  }
  candidates.sort((a, b) => b.gapRatio - a.gapRatio);
  return candidates.slice(0, TOP_N);
}

function computeSubcontractDepth(items: QualityScoreItem[]): { entries: HighlightSubcontractDepthEntry[]; population: number } {
  const population = items.filter(i => (i.spendTotal ?? 0) >= HIGHLIGHTS_MIN_SPEND_YEN).length;
  const candidates = items
    .filter(i => (i.spendTotal ?? 0) >= HIGHLIGHTS_MIN_SPEND_YEN && i.redelegationDepth > 0)
    .map(i => ({
      pid: i.pid,
      name: i.name,
      ministry: i.ministry ?? null,
      redelegationDepth: i.redelegationDepth,
      spendTotal: i.spendTotal,
    }))
    .sort((a, b) => b.redelegationDepth - a.redelegationDepth || b.spendTotal - a.spendTotal);
  return { entries: candidates.slice(0, TOP_N), population };
}

function computeMultiSignal(
  metrics: HighlightsResult['metrics'],
  qualityByPid: Map<string, QualityScoreItem>,
): HighlightMultiSignalEntry[] {
  const signalsByPid = new Map<string, Set<HighlightMetricName>>();
  const add = (pid: string, metric: HighlightMetricName) => {
    let s = signalsByPid.get(pid);
    if (!s) { s = new Set(); signalsByPid.set(pid, s); }
    s.add(metric);
  };

  const addSpendingChangePid = (projectId: number | null) => {
    if (projectId == null) return;
    add(String(projectId), 'spendingChange');
  };
  for (const e of metrics.spendingChange.increased) addSpendingChangePid(e.projectId);
  for (const e of metrics.spendingChange.decreased) addSpendingChangePid(e.projectId);
  for (const e of metrics.spendingChange.added) addSpendingChangePid(e.projectId);
  for (const e of metrics.spendingChange.removed) addSpendingChangePid(e.projectId);
  for (const e of metrics.otherRatio) add(e.pid, 'otherRatio');
  for (const e of metrics.concentration) add(e.pid, 'concentration');
  for (const e of metrics.lowScoreHighBudget) add(e.pid, 'lowScoreHighBudget');
  for (const e of metrics.execBudgetGap) add(e.pid, 'execBudgetGap');
  for (const e of metrics.subcontractDepth) add(e.pid, 'subcontractDepth');

  const candidates: HighlightMultiSignalEntry[] = [];
  for (const [pid, signalSet] of signalsByPid) {
    if (signalSet.size < HIGHLIGHTS_MULTI_SIGNAL_MIN_METRICS) continue;
    const q = qualityByPid.get(pid);
    candidates.push({
      pid,
      name: q?.name ?? pid,
      ministry: q?.ministry ?? null,
      signals: HIGHLIGHT_METRIC_NAMES.filter(m => signalSet.has(m)),
    });
  }
  candidates.sort((a, b) => {
    if (b.signals.length !== a.signals.length) return b.signals.length - a.signals.length;
    const bBudget = qualityByPid.get(b.pid)?.budgetAmount ?? 0;
    const aBudget = qualityByPid.get(a.pid)?.budgetAmount ?? 0;
    return bBudget - aBudget;
  });
  return candidates.slice(0, TOP_N);
}

/** 全事業をスキャンし、6指標の上位リスト + multiSignal を計算する（Pure）。 */
export function computeHighlights(input: HighlightsInput): HighlightsResult {
  const { currentGraph, priorGraph, qualityItems } = input;
  const qualityByPid = new Map(qualityItems.map(i => [i.pid, i]));
  const nodeById = new Map(currentGraph.nodes.map(n => [n.id, n]));

  const stats = collectProjectRecipientStats(currentGraph.nodes, currentGraph.edges);
  const { entries: otherRatio, population: otherRatioPopulation } = computeOtherRatio(stats, qualityByPid);
  const { entries: concentration, population: concentrationPopulation } = computeConcentration(stats, nodeById, qualityByPid);
  const { entries: lowScoreHighBudget, threshold: lowScoreThreshold } = computeLowScoreHighBudget(qualityItems);
  const execBudgetGap = computeExecBudgetGap(qualityItems);
  const { entries: subcontractDepth, population: subcontractDepthPopulation } = computeSubcontractDepth(qualityItems);

  let spendingChange: HighlightsSpendingChange;
  if (priorGraph) {
    const result = compareYearsSummary(
      { nodes: priorGraph.nodes, edges: priorGraph.edges, excludedIds: null },
      { nodes: currentGraph.nodes, edges: currentGraph.edges, excludedIds: null },
      TOP_N,
    );
    spendingChange = {
      priorYear: priorGraph.year,
      increased: result.diff.projects.increased,
      decreased: result.diff.projects.decreased,
      added: result.diff.projects.added,
      removed: result.diff.projects.removed,
    };
  } else {
    spendingChange = { priorYear: null, increased: [], decreased: [], added: [], removed: [] };
  }

  const metrics: HighlightsResult['metrics'] = {
    spendingChange, otherRatio, concentration, lowScoreHighBudget, execBudgetGap, subcontractDepth,
  };
  const multiSignal = computeMultiSignal(metrics, qualityByPid);

  return {
    metrics,
    multiSignal,
    meta: {
      minSpendYen: HIGHLIGHTS_MIN_SPEND_YEN,
      otherRatioPopulation,
      concentrationPopulation,
      subcontractDepthPopulation,
      lowScoreThreshold,
    },
  };
}
