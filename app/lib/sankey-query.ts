/**
 * SankeyQuery のドメインロジック（Pure関数のみ。HTTP・React禁止）。
 *
 * - resolveSankeyQuery: 既定値補完・クランプ・検証
 * - buildFilterExcludedIds: プレフィルタ条件から除外ノード集合を構築
 *   （/sankey-svg page.tsx の filterExcludedIds useMemo から移設。挙動は同一）
 * - summarizeFilteredGraph: フィルタ適用後グラフの件数・金額サマリ
 * - sankeyQueryToUrlParams / sankeyQueryFromUrlParams: /sankey-svg URLパラメータとの相互変換
 *   （page.tsx parseSearchParams / URL同期エフェクトの短縮キーと1対1。キーを変更する場合は両方を更新すること）
 */
import type { RawNode, RawEdge } from '@/types/sankey-svg';
import type {
  SankeyQuery,
  SankeyQueryFilter,
  ResolvedSankeyQuery,
  AccountCategoryKey,
} from '@/types/sankey-query';
import { parseAmountToYen } from '@/app/lib/format/yen';

// /sankey-svg の初期状態と一致させる（page.tsx の useState 初期値・URLクランプと同値）
export const SANKEY_QUERY_DEFAULTS = {
  year: '2024' as const, // API既定年度（api-notes の DEFAULT_YEAR と一致）
  topMinistry: 37,
  topProject: 50,
  topRecipient: 50,
  offsetTarget: 'project' as const,
  projectSortBy: 'budget' as const,
} as const;

export const TOP_MINISTRY_MAX = 37;
export const TOP_PROJECT_MAX = 300;
export const TOP_RECIPIENT_MAX = 300;
/** 正規表現パターン長の上限（ReDoS 最小対策） */
export const MAX_REGEX_PATTERN_LENGTH = 128;

const ACCOUNT_CATEGORY_KEYS: readonly AccountCategoryKey[] = ['general', 'special', 'both', 'none'];

// ── クエリの正規化・検証 ──

/**
 * SankeyQuery に既定値を補完し、範囲をクランプして確定形にする。
 * 機械可読なエラー（AIが自己修正できる文言）を errors に集める。errors が空でない場合、query は使用しないこと。
 */
export function resolveSankeyQuery(input: SankeyQuery): { query: ResolvedSankeyQuery; errors: string[] } {
  const errors: string[] = [];

  const year = input.year ?? SANKEY_QUERY_DEFAULTS.year;
  if (year !== '2024' && year !== '2025') {
    errors.push(`year は "2024" または "2025" を指定してください（受領値: ${JSON.stringify(input.year)}）`);
  }

  const normalizeName = (
    label: string,
    nf: SankeyQueryFilter['projectName'],
  ): { query: string; regex: boolean } | null => {
    if (!nf || typeof nf.query !== 'string') return null;
    const q = nf.query.trim();
    if (q.length === 0) return null;
    const regex = nf.regex === true;
    if (regex) {
      if (q.length > MAX_REGEX_PATTERN_LENGTH) {
        errors.push(`${label}.query が長すぎます（正規表現は${MAX_REGEX_PATTERN_LENGTH}文字以内）`);
        return null;
      }
      try {
        new RegExp(q, 'i');
      } catch (e) {
        errors.push(`${label}.query が正規表現として不正です: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
    return { query: q, regex };
  };

  const normalizeRange = (
    label: string,
    r: SankeyQueryFilter['budget'],
  ): { min: number | null; max: number | null } => {
    const toNum = (v: number | null | undefined, field: string): number | null => {
      if (v == null) return null;
      if (typeof v !== 'number' || !isFinite(v)) {
        errors.push(`${label}.${field} は1円単位の数値で指定してください（受領値: ${JSON.stringify(v)}）`);
        return null;
      }
      return v;
    };
    const min = toNum(r?.min, 'min');
    const max = toNum(r?.max, 'max');
    if (min != null && max != null && min > max) {
      errors.push(`${label} の min（${min}）が max（${max}）を超えています`);
    }
    return { min, max };
  };

  const accountCategories = (() => {
    const input_ = input.filter?.accountCategories;
    if (input_ == null) return [...ACCOUNT_CATEGORY_KEYS];
    const unknown = input_.filter(c => !ACCOUNT_CATEGORY_KEYS.includes(c));
    if (unknown.length > 0) {
      errors.push(`filter.accountCategories に未知の値があります: ${unknown.join(', ')}（有効値: ${ACCOUNT_CATEGORY_KEYS.join(' | ')}）`);
    }
    return [...new Set(input_.filter(c => ACCOUNT_CATEGORY_KEYS.includes(c)))];
  })();

  const clampInt = (v: number | undefined, def: number, min: number, max: number): number => {
    if (v == null) return def;
    if (typeof v !== 'number' || !isFinite(v)) return def;
    return Math.max(min, Math.min(max, Math.floor(v)));
  };

  const subcontract = (() => {
    const s = input.filter?.subcontract;
    const hasRedelegation = s?.hasRedelegation === true;
    let minDepth: number | null = null;
    if (s?.minDepth != null) {
      if (typeof s.minDepth !== 'number' || !isFinite(s.minDepth) || Math.floor(s.minDepth) < 2) {
        errors.push(`filter.subcontract.minDepth は2以上の整数で指定してください（2=再委託あり、3=再々委託以深。受領値: ${JSON.stringify(s.minDepth)}）`);
      } else {
        minDepth = Math.floor(s.minDepth);
      }
    }
    return { hasRedelegation, minDepth };
  })();

  const v = input.view;
  const query: ResolvedSankeyQuery = {
    year: year === '2025' ? '2025' : '2024',
    filter: {
      projectName: normalizeName('filter.projectName', input.filter?.projectName),
      recipientName: (() => {
        const nf = normalizeName('filter.recipientName', input.filter?.recipientName);
        if (nf === null) return null;
        return input.filter?.recipientName?.includeSubcontract === true ? { ...nf, includeSubcontract: true } : nf;
      })(),
      ministries: [...new Set((input.filter?.ministries ?? []).map(m => String(m).trim()).filter(Boolean))],
      budget: normalizeRange('filter.budget', input.filter?.budget),
      spending: normalizeRange('filter.spending', input.filter?.spending),
      accountCategories,
      subcontract,
    },
    view: {
      topMinistry: clampInt(v?.topMinistry, SANKEY_QUERY_DEFAULTS.topMinistry, 1, TOP_MINISTRY_MAX),
      topProject: clampInt(v?.topProject, SANKEY_QUERY_DEFAULTS.topProject, 1, TOP_PROJECT_MAX),
      topRecipient: clampInt(v?.topRecipient, SANKEY_QUERY_DEFAULTS.topRecipient, 1, TOP_RECIPIENT_MAX),
      pin: {
        projectId: v?.pin?.projectId ?? null,
        recipientId: v?.pin?.recipientId ?? null,
        ministryName: v?.pin?.ministryName ?? null,
      },
      focusRelated: v?.focusRelated === true,
      offset: {
        target: v?.offset?.target === 'recipient' ? 'recipient' : SANKEY_QUERY_DEFAULTS.offsetTarget,
        recipient: clampInt(v?.offset?.recipient, 0, 0, Number.MAX_SAFE_INTEGER),
        project: clampInt(v?.offset?.project, 0, 0, Number.MAX_SAFE_INTEGER),
      },
      projectSortBy: v?.projectSortBy === 'spending' ? 'spending' : SANKEY_QUERY_DEFAULTS.projectSortBy,
      showAggProject: v?.showAggProject !== false,
      showAggRecipient: v?.showAggRecipient !== false,
      scaleBudgetToVisible: v?.scaleBudgetToVisible !== false,
    },
  };

  return { query, errors };
}

/** フィルタ条件が1つでも指定されているか */
export function hasActiveFilter(filter: ResolvedSankeyQuery['filter']): boolean {
  return (
    filter.projectName != null ||
    filter.recipientName != null ||
    filter.ministries.length > 0 ||
    filter.budget.min != null || filter.budget.max != null ||
    filter.spending.min != null || filter.spending.max != null ||
    filter.accountCategories.length < ACCOUNT_CATEGORY_KEYS.length ||
    filter.subcontract.hasRedelegation ||
    filter.subcontract.minDepth != null
  );
}

// ── プレフィルタ: 除外ノード集合の構築 ──

/**
 * フィルタ条件から除外ノードID集合を構築する。条件が無効（すべて未指定）なら null。
 *
 * /sankey-svg page.tsx の filterExcludedIds useMemo からの移設。Pass 構成:
 * - Pass 1: 事業（予算・事業名・府省庁・会計区分）と支出先（受領額・支出先名）の単体判定
 * - Pass 2: 支出先系フィルタ有効時、残存支出先が1つもない事業をカスケード除外
 * - Pass 3: 残存事業が1つもない省庁をカスケード除外（ゼロ予算事業は spending ノード経由で保護）
 *
 * @param protectedNodeIds 除外から保護するノードID（選択中・ピン中の事業）。
 *   project-budget/-spending のペアは自動展開される。
 */
export function buildFilterExcludedIds(
  nodes: RawNode[],
  edges: RawEdge[],
  filter: ResolvedSankeyQuery['filter'],
  protectedNodeIds: readonly (string | null)[] = [],
  /**
   * 事業単位の追加除外。true を返した事業は予算・執行ノードごと落ちる。
   * 政策評価スコアの足きりのように、クエリスキーマに載せず画面側でしか
   * 材料を持てない条件を差し込むための口。
   */
  excludeProject?: ((projectId: number) => boolean) | null,
): Set<string> | null {
  const protectedProjectIds = new Set<string>();
  for (const nodeId of protectedNodeIds) {
    if (!nodeId) continue;
    if (nodeId.startsWith('project-spending-')) {
      protectedProjectIds.add(nodeId);
      protectedProjectIds.add(nodeId.replace('project-spending-', 'project-budget-'));
    } else if (nodeId.startsWith('project-budget-')) {
      protectedProjectIds.add(nodeId);
      protectedProjectIds.add(nodeId.replace('project-budget-', 'project-spending-'));
    }
  }

  const minBudgetYen = filter.budget.min;
  const maxBudgetYen = filter.budget.max;
  const minSpendingYen = filter.spending.min;
  const maxSpendingYen = filter.spending.max;
  const hasBudget = minBudgetYen !== null || maxBudgetYen !== null;
  const hasSpending = minSpendingYen !== null || maxSpendingYen !== null;
  const hasProjectName = filter.projectName != null;
  const hasRecipientName = filter.recipientName != null;
  const hasMinistry = filter.ministries.length > 0;
  const accountSet = new Set(filter.accountCategories);
  const hasAccountFilter = accountSet.size < ACCOUNT_CATEGORY_KEYS.length;
  // 再委託フィルタ: 実効下限（hasRedelegation=2、minDepth 指定時はそちらを優先）
  const subMinDepth = filter.subcontract.minDepth ?? (filter.subcontract.hasRedelegation ? 2 : null);
  const hasSubcontract = subMinDepth != null;
  const hasExtraProject = excludeProject != null;
  if (!hasBudget && !hasSpending && !hasProjectName && !hasRecipientName && !hasMinistry && !hasAccountFilter && !hasSubcontract && !hasExtraProject) return null;

  const selectedMinistrySet = new Set(filter.ministries);
  const minBudget = minBudgetYen ?? -Infinity;
  const maxBudget = maxBudgetYen ?? Infinity;
  const minSpending = minSpendingYen ?? 0;
  const maxSpending = maxSpendingYen ?? Infinity;
  const buildMatcher = (query: string, useRegex: boolean): ((name: string) => boolean) => {
    if (useRegex) {
      try { const re = new RegExp(query, 'i'); return name => re.test(name); }
      catch { return () => false; }
    }
    const qLower = query.toLocaleLowerCase();
    return name => name.toLocaleLowerCase().includes(qLower);
  };
  const matchesProject = filter.projectName ? buildMatcher(filter.projectName.query, filter.projectName.regex === true) : null;
  const matchesRecipient = filter.recipientName ? buildMatcher(filter.recipientName.query, filter.recipientName.regex === true) : null;
  // 支出先名フィルタの「再委託先を含む」モード（OR判定・事業単位。支出先ノードは隠さない）
  const recipientIncludeSub = filter.recipientName?.includeSubcontract === true;
  let projectsWithDirectNameMatch: Set<string> | null = null;
  if (matchesRecipient !== null && recipientIncludeSub) {
    const recipientNameById = new Map(nodes.filter(n => n.type === 'recipient' && !n.aggregated).map(n => [n.id, n.name] as const));
    projectsWithDirectNameMatch = new Set<string>();
    for (const e of edges) {
      const name = recipientNameById.get(e.target);
      if (name !== undefined && matchesRecipient(name)) projectsWithDirectNameMatch.add(e.source);
    }
  }

  const excluded = new Set<string>();
  const spendingByPid = new Map(
    nodes.filter(n => n.type === 'project-spending' && n.projectId != null).map(n => [n.projectId!, n])
  );
  const budgetNodeByPid = new Map(
    nodes.filter(n => n.type === 'project-budget' && n.projectId != null).map(n => [n.projectId!, n])
  );
  for (const n of nodes) {
    if (n.aggregated) continue;
    if (n.type === 'project-budget' && n.projectId != null) {
      const sn = spendingByPid.get(n.projectId);
      const failBudget = hasBudget && (n.value < minBudget || n.value > maxBudget);
      const failProjectName = matchesProject !== null && !matchesProject(n.name);
      const failMinistry = hasMinistry && !selectedMinistrySet.has(n.ministry ?? '');
      const failAccount = hasAccountFilter && !accountSet.has((n.accountCategory ?? 'none') as AccountCategoryKey);
      // subcontractDepth 未設定 = 再委託の記載なし（階層1相当）
      const failSubcontract = hasSubcontract && (n.subcontractDepth ?? 1) < subMinDepth!;
      // 「再委託先を含む」モード: 直接支出先 OR 再委託先のどちらかに名前マッチすれば残す
      const failAnyRecipient = projectsWithDirectNameMatch !== null && !(
        (sn != null && projectsWithDirectNameMatch.has(sn.id)) ||
        (n.subcontractRecipients ?? []).some(matchesRecipient!)
      );
      const failExtra = hasExtraProject && excludeProject!(n.projectId);
      if (failBudget || failProjectName || failMinistry || failAccount || failSubcontract || failAnyRecipient || failExtra) { excluded.add(n.id); if (sn) excluded.add(sn.id); }
    } else if (n.type === 'recipient') {
      const failSpending = hasSpending && (n.value < minSpending || n.value > maxSpending);
      // includeSubcontract モードでは支出先ノードを名前で隠さない（事業単位判定のみ）
      const failRecipientName = matchesRecipient !== null && !recipientIncludeSub && !matchesRecipient(n.name);
      if (failSpending || failRecipientName) excluded.add(n.id);
    }
  }
  // Pass 2: 支出先・予算フィルタが有効な場合、残存支出先のない事業／孤立支出先を除外
  if (hasSpending || hasBudget || hasMinistry || hasRecipientName || hasSubcontract || hasExtraProject) {
    const projectsWithSurvivingRecipients = new Set(
      edges
        .filter(e => e.target.startsWith('r-') && !excluded.has(e.target))
        .map(e => e.source)
    );
    for (const [pid, sn] of spendingByPid) {
      const bn = budgetNodeByPid.get(pid);
      if (protectedProjectIds.has(sn.id) || (bn != null && protectedProjectIds.has(bn.id))) continue;
      if (!excluded.has(sn.id) && !projectsWithSurvivingRecipients.has(sn.id)) {
        excluded.add(sn.id);
        if (bn) excluded.add(bn.id);
      }
    }
  }
  // ゼロ予算事業は graph 生成時に ministry→project-budget エッジを持たないため Pass 3 で
  // 省庁保護ロジックを切り替える必要がある。minBudget > 0 の場合は failBudget が除外済み。
  const excludeZeroBudget = hasBudget && minBudget > 0;
  // Pass 3: 残存事業のない省庁を除外（project → ministry のカスケード）
  const ministriesWithSurvivingProjects = new Set(
    edges
      .filter(e => !excluded.has(e.source) && !excluded.has(e.target) && e.target.startsWith('project-budget-'))
      .map(e => e.source)
  );
  // ゼロ予算事業がいる可能性がある場合（excludeZeroBudget=false）は、
  // ministry→project-budgetエッジが存在しないため、生き残ったproject-spendingノードから省庁を保護する。
  if (!excludeZeroBudget) {
    for (const n of nodes) {
      if (n.type === 'project-spending' && !excluded.has(n.id) && n.value > 0 && n.ministry) {
        ministriesWithSurvivingProjects.add(`ministry-${n.ministry}`);
      }
    }
  }
  for (const n of nodes) {
    if (n.type === 'ministry' && !n.aggregated && !excluded.has(n.id)) {
      if (!ministriesWithSurvivingProjects.has(n.id)) excluded.add(n.id);
    }
  }
  return excluded.size > 0 ? excluded : null;
}

// ── フィルタ適用後グラフのサマリ ──

export interface SankeyQuerySummary {
  projects: {
    count: number;
    /** 残存事業の予算合計（1円単位、未スケール） */
    budgetTotal: number;
    /** 残存事業 → 残存支出先 への支出合計（1円単位） */
    spendingTotal: number;
    top: { id: string; projectId: number | null; name: string; ministry: string | null; budget: number; spending: number }[];
  };
  recipients: {
    /** 残存事業から1円以上の流入がある残存支出先の数 */
    count: number;
    top: { id: string; name: string; inflow: number }[];
    /**
     * 上位1件の受領額 ÷ 非集約支出先の受領額合計（0〜1、小数4桁）。
     * 「その他の支出先」（表示件数制限からの集計ノード）は分母・分子から除外するが、
     * 支出先名「その他」（報告書にそのまま記載された実データ）は1支出先として含む。
     * 非集約支出先の合計が0の場合は null。
     */
    topShare1: number | null;
    /** 上位3件合計 ÷ 非集約支出先の受領額合計（topShare1 と同じ対象・丸め・null条件） */
    topShare3: number | null;
  };
  ministries: {
    count: number;
    names: string[];
  };
}

/** summarizeFilteredGraph / compareYearsSummary が共有する中間集計結果 */
interface CollectedFilteredGraph {
  budgetTotal: number;
  spendingTotal: number;
  survivingProjects: RawNode[];
  budgetByPid: Map<number, number>;
  spendingByProject: Map<string, number>;
  inflowByRecipient: Map<string, number>;
  nodeById: Map<string, RawNode>;
}

/** フィルタ適用後グラフの中間集計（TopN集約前）。summarizeFilteredGraph / compareYearsSummary の共通処理 */
function collectFilteredGraph(
  nodes: RawNode[],
  edges: RawEdge[],
  excludedIds: Set<string> | null,
): CollectedFilteredGraph {
  const isExcluded = (id: string) => excludedIds?.has(id) ?? false;

  const budgetByPid = new Map<number, number>();
  const survivingProjects: RawNode[] = [];
  let budgetTotal = 0;
  for (const n of nodes) {
    if (n.aggregated || isExcluded(n.id)) continue;
    if (n.type === 'project-budget' && n.projectId != null) {
      budgetByPid.set(n.projectId, n.value);
      budgetTotal += n.value;
    } else if (n.type === 'project-spending') {
      survivingProjects.push(n);
    }
  }

  // 残存エッジ（事業 → 支出先）から支出と流入を集計
  const spendingByProject = new Map<string, number>();
  const inflowByRecipient = new Map<string, number>();
  let spendingTotal = 0;
  for (const e of edges) {
    if (!e.target.startsWith('r-')) continue;
    if (isExcluded(e.source) || isExcluded(e.target)) continue;
    spendingByProject.set(e.source, (spendingByProject.get(e.source) || 0) + e.value);
    inflowByRecipient.set(e.target, (inflowByRecipient.get(e.target) || 0) + e.value);
    spendingTotal += e.value;
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  return { budgetTotal, spendingTotal, survivingProjects, budgetByPid, spendingByProject, inflowByRecipient, nodeById };
}

/**
 * プレフィルタ適用後のグラフを集計する（TopN集約前の「マッチ全体」のサマリ）。
 * AIエージェントが条件の絞り込み過不足を検証するための情報。
 */
export function summarizeFilteredGraph(
  nodes: RawNode[],
  edges: RawEdge[],
  excludedIds: Set<string> | null,
  topN: number = 10,
): SankeyQuerySummary {
  const {
    budgetTotal, spendingTotal, survivingProjects, budgetByPid, spendingByProject, inflowByRecipient, nodeById,
  } = collectFilteredGraph(nodes, edges, excludedIds);

  const topProjects = [...survivingProjects]
    .map(n => ({
      id: n.id,
      projectId: n.projectId ?? null,
      name: n.name,
      ministry: n.ministry ?? null,
      budget: n.projectId != null ? (budgetByPid.get(n.projectId) ?? 0) : 0,
      spending: spendingByProject.get(n.id) || 0,
    }))
    .sort((a, b) => b.spending - a.spending || b.budget - a.budget)
    .slice(0, topN);

  const topRecipients = [...inflowByRecipient.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, inflow]) => ({ id, name: nodeById.get(id)?.name ?? id, inflow }));

  // topShare1/3: 「その他の支出先」（aggregated 集計ノード）を除いた非集約支出先のみを対象にする。
  // 支出先名「その他」（実データ）は非集約ノードなので対象に含まれる。
  const nonAggregatedInflows = [...inflowByRecipient.entries()]
    .filter(([id]) => !(nodeById.get(id)?.aggregated))
    .map(([, inflow]) => inflow)
    .sort((a, b) => b - a);
  const nonAggregatedTotal = nonAggregatedInflows.reduce((sum, v) => sum + v, 0);
  const round4 = (v: number): number => Math.round(v * 10000) / 10000;
  const topShare1 = nonAggregatedTotal > 0 ? round4((nonAggregatedInflows[0] ?? 0) / nonAggregatedTotal) : null;
  const topShare3 = nonAggregatedTotal > 0
    ? round4(nonAggregatedInflows.slice(0, 3).reduce((sum, v) => sum + v, 0) / nonAggregatedTotal)
    : null;

  const ministryNames = [...new Set(survivingProjects.map(n => n.ministry).filter((m): m is string => !!m))].sort();

  return {
    projects: {
      count: survivingProjects.length,
      budgetTotal,
      spendingTotal,
      top: topProjects,
    },
    recipients: {
      count: inflowByRecipient.size,
      top: topRecipients,
      topShare1,
      topShare3,
    },
    ministries: {
      count: ministryNames.length,
      names: ministryNames,
    },
  };
}

// ── 年度間比較 ──

const COMPARE_TOP_N = 10;

/**
 * 両年度に存在する事業の予算・支出比較。
 *
 * increased/decreased のランキングは spendingDiff（残存支出先への実支出の差分）で行う。
 * budgetDiff も同梱するが、デジタル庁一括計上（例: 各府省庁のシステムがデジタル庁予算に計上される）
 * のように事業単体の project-budget ノードが0円のまま執行額だけ変動するケースがあるため、
 * budgetDiff だけでは「事業年度Nのデータ内でこの事業が実際にどう動いたか」を見誤る
 * （20260705_1544 の KSKシステム発見はこのパターン）。
 */
export interface SankeyProjectDiffEntry {
  projectId: number | null;
  name: string;
  ministry: string | null;
  budgetBase: number;
  budgetCompare: number;
  budgetDiff: number;
  /** (budgetCompare - budgetBase) / budgetBase（小数4桁）。budgetBase が0の場合は null */
  budgetDiffRate: number | null;
  spendingBase: number;
  spendingCompare: number;
  spendingDiff: number;
  /** (spendingCompare - spendingBase) / spendingBase（小数4桁）。spendingBase が0の場合は null */
  spendingDiffRate: number | null;
}

/** 片年度のみに存在する事業（新規/消滅） */
export interface SankeyProjectPresenceEntry {
  projectId: number | null;
  name: string;
  ministry: string | null;
  /** 存在した年度の予算額 */
  budget: number;
  /** 存在した年度の残存支出先への支出額 */
  spending: number;
}

/** 両年度に存在する支出先の受領額比較（増減上位） */
export interface SankeyRecipientInflowDiffEntry {
  id: string;
  name: string;
  inflowBase: number;
  inflowCompare: number;
  diff: number;
  /** (inflowCompare - inflowBase) / inflowBase（小数4桁）。inflowBase が0の場合は null */
  diffRate: number | null;
}

/** 片年度のみに存在する支出先（新規/消滅） */
export interface SankeyRecipientPresenceEntry {
  id: string;
  name: string;
  /** 存在した年度の受領額 */
  inflow: number;
}

export interface SankeyYearsCompareDiff {
  projects: {
    /** 支出増加額（spendingDiff）の上位（最大10件） */
    increased: SankeyProjectDiffEntry[];
    /** 支出減少額（spendingDiff）の上位（最大10件） */
    decreased: SankeyProjectDiffEntry[];
    /** compare 年度のみに存在（支出額降順、最大10件） */
    added: SankeyProjectPresenceEntry[];
    /** base 年度のみに存在（支出額降順、最大10件） */
    removed: SankeyProjectPresenceEntry[];
  };
  recipients: {
    /** 受領額増加の上位（最大10件） */
    increased: SankeyRecipientInflowDiffEntry[];
    /** 受領額減少の上位（最大10件） */
    decreased: SankeyRecipientInflowDiffEntry[];
    /** compare 年度のみに存在（受領額降順、最大10件） */
    added: SankeyRecipientPresenceEntry[];
    /** base 年度のみに存在（受領額降順、最大10件） */
    removed: SankeyRecipientPresenceEntry[];
  };
}

/** compareYearsSummary への入力（1年度分。既に loadSankeyGraph + buildFilterExcludedIds を適用済みのもの） */
export interface SankeyYearGraphInput {
  nodes: RawNode[];
  edges: RawEdge[];
  excludedIds: Set<string> | null;
}

export interface SankeyCompareYearsResult {
  /** base 年度の summary（summarizeFilteredGraph と同一の計算） */
  base: SankeyQuerySummary;
  /** compare 年度の summary（summarizeFilteredGraph と同一の計算） */
  compare: SankeyQuerySummary;
  diff: SankeyYearsCompareDiff;
}

function calcDiffRate(base: number, compare: number): number | null {
  if (base === 0) return null;
  return Math.round(((compare - base) / base) * 10000) / 10000;
}

/**
 * 同一フィルタ条件を2年度に適用した summary + 差分をまとめて返す。
 * 突き合わせ（pid・支出先IDでのマッチング）はここで行い、呼び出し側（AIエージェント含む）に
 * 手動突合をさせない（20260705_1544 §3-1・§5-1 の推奨案）。
 *
 * - 事業差分は projectId でマッチング。budget（project-budget ノードの value）を比較する
 * - 支出先差分は recipient ノードIDでマッチング。「その他の支出先」等の集計ノード（aggregated）は除外する
 * - increased/decreased は差分額の絶対値降順で最大 topN 件、added/removed は存在年度の金額降順で最大 topN 件
 */
export function compareYearsSummary(
  base: SankeyYearGraphInput,
  compare: SankeyYearGraphInput,
  topN: number = COMPARE_TOP_N,
): SankeyCompareYearsResult {
  const baseSummary = summarizeFilteredGraph(base.nodes, base.edges, base.excludedIds, topN);
  const compareSummary = summarizeFilteredGraph(compare.nodes, compare.edges, compare.excludedIds, topN);

  const baseData = collectFilteredGraph(base.nodes, base.edges, base.excludedIds);
  const compareData = collectFilteredGraph(compare.nodes, compare.edges, compare.excludedIds);

  // ── 事業差分（projectId マッチング） ──
  const baseProjectByPid = new Map(
    baseData.survivingProjects.filter((n): n is RawNode & { projectId: number } => n.projectId != null)
      .map(n => [n.projectId, n]),
  );
  const compareProjectByPid = new Map(
    compareData.survivingProjects.filter((n): n is RawNode & { projectId: number } => n.projectId != null)
      .map(n => [n.projectId, n]),
  );
  const allPids = new Set([...baseProjectByPid.keys(), ...compareProjectByPid.keys()]);

  const matchedProjects: SankeyProjectDiffEntry[] = [];
  const addedProjects: SankeyProjectPresenceEntry[] = [];
  const removedProjects: SankeyProjectPresenceEntry[] = [];
  for (const pid of allPids) {
    const bn = baseProjectByPid.get(pid);
    const cn = compareProjectByPid.get(pid);
    if (bn && cn) {
      const budgetBase = baseData.budgetByPid.get(pid) ?? 0;
      const budgetCompare = compareData.budgetByPid.get(pid) ?? 0;
      const spendingBase = baseData.spendingByProject.get(bn.id) ?? 0;
      const spendingCompare = compareData.spendingByProject.get(cn.id) ?? 0;
      matchedProjects.push({
        projectId: pid,
        name: cn.name,
        ministry: cn.ministry ?? bn.ministry ?? null,
        budgetBase,
        budgetCompare,
        budgetDiff: budgetCompare - budgetBase,
        budgetDiffRate: calcDiffRate(budgetBase, budgetCompare),
        spendingBase,
        spendingCompare,
        spendingDiff: spendingCompare - spendingBase,
        spendingDiffRate: calcDiffRate(spendingBase, spendingCompare),
      });
    } else if (cn) {
      addedProjects.push({
        projectId: pid,
        name: cn.name,
        ministry: cn.ministry ?? null,
        budget: compareData.budgetByPid.get(pid) ?? 0,
        spending: compareData.spendingByProject.get(cn.id) ?? 0,
      });
    } else if (bn) {
      removedProjects.push({
        projectId: pid,
        name: bn.name,
        ministry: bn.ministry ?? null,
        budget: baseData.budgetByPid.get(pid) ?? 0,
        spending: baseData.spendingByProject.get(bn.id) ?? 0,
      });
    }
  }
  const projectsIncreased = matchedProjects.filter(m => m.spendingDiff > 0).sort((a, b) => b.spendingDiff - a.spendingDiff).slice(0, topN);
  const projectsDecreased = matchedProjects.filter(m => m.spendingDiff < 0).sort((a, b) => a.spendingDiff - b.spendingDiff).slice(0, topN);
  const projectsAdded = [...addedProjects].sort((a, b) => b.spending - a.spending).slice(0, topN);
  const projectsRemoved = [...removedProjects].sort((a, b) => b.spending - a.spending).slice(0, topN);

  // ── 支出先差分（受領額ベース、集約ノードは除外） ──
  const baseRecipientMap = new Map(
    [...baseData.inflowByRecipient.entries()].filter(([id]) => !baseData.nodeById.get(id)?.aggregated),
  );
  const compareRecipientMap = new Map(
    [...compareData.inflowByRecipient.entries()].filter(([id]) => !compareData.nodeById.get(id)?.aggregated),
  );
  const allRecipientIds = new Set([...baseRecipientMap.keys(), ...compareRecipientMap.keys()]);

  const matchedRecipients: SankeyRecipientInflowDiffEntry[] = [];
  const addedRecipients: SankeyRecipientPresenceEntry[] = [];
  const removedRecipients: SankeyRecipientPresenceEntry[] = [];
  for (const id of allRecipientIds) {
    const inBase = baseRecipientMap.has(id);
    const inCompare = compareRecipientMap.has(id);
    if (inBase && inCompare) {
      const inflowBase = baseRecipientMap.get(id)!;
      const inflowCompare = compareRecipientMap.get(id)!;
      matchedRecipients.push({
        id,
        name: compareData.nodeById.get(id)?.name ?? baseData.nodeById.get(id)?.name ?? id,
        inflowBase,
        inflowCompare,
        diff: inflowCompare - inflowBase,
        diffRate: calcDiffRate(inflowBase, inflowCompare),
      });
    } else if (inCompare) {
      addedRecipients.push({ id, name: compareData.nodeById.get(id)?.name ?? id, inflow: compareRecipientMap.get(id)! });
    } else if (inBase) {
      removedRecipients.push({ id, name: baseData.nodeById.get(id)?.name ?? id, inflow: baseRecipientMap.get(id)! });
    }
  }
  const recipientsIncreased = matchedRecipients.filter(m => m.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, topN);
  const recipientsDecreased = matchedRecipients.filter(m => m.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, topN);
  const recipientsAdded = [...addedRecipients].sort((a, b) => b.inflow - a.inflow).slice(0, topN);
  const recipientsRemoved = [...removedRecipients].sort((a, b) => b.inflow - a.inflow).slice(0, topN);

  return {
    base: baseSummary,
    compare: compareSummary,
    diff: {
      projects: { increased: projectsIncreased, decreased: projectsDecreased, added: projectsAdded, removed: projectsRemoved },
      recipients: { increased: recipientsIncreased, decreased: recipientsDecreased, added: recipientsAdded, removed: recipientsRemoved },
    },
  };
}

// ── URLパラメータとの相互変換 ──

/** 1円単位の金額をURLパラメータ用テキストに変換（parseAmountToYen で往復可能な表記） */
function formatYenForUrlParam(yen: number): string {
  if (yen > 0 && Number.isInteger(yen)) {
    if (yen % 1e12 === 0) return `${yen / 1e12}兆`;
    if (yen % 1e8 === 0) return `${yen / 1e8}億`;
    if (yen % 1e4 === 0) return `${yen / 1e4}万`;
  }
  return String(yen);
}

/**
 * ResolvedSankeyQuery を /sankey-svg のURLパラメータに変換する。
 * 短縮キーと省略規則は page.tsx のURL同期エフェクトと1対1（既定値は省略。yr のみ常に明示）。
 */
export function sankeyQueryToUrlParams(query: ResolvedSankeyQuery): URLSearchParams {
  const p = new URLSearchParams();
  const { filter, view } = query;

  if (view.pin.projectId) p.set('pp', view.pin.projectId);
  if (view.pin.recipientId) p.set('pr', view.pin.recipientId);
  if (view.pin.ministryName) p.set('pm', view.pin.ministryName);
  if (view.offset.recipient !== 0) p.set('ro', String(view.offset.recipient));
  if (view.offset.target === 'recipient') p.set('ot', 'r');
  if (view.offset.project !== 0) p.set('po', String(view.offset.project));
  if (view.topMinistry !== SANKEY_QUERY_DEFAULTS.topMinistry) p.set('tm', String(view.topMinistry));
  if (view.topProject !== SANKEY_QUERY_DEFAULTS.topProject) p.set('tp', String(view.topProject));
  if (view.topRecipient !== SANKEY_QUERY_DEFAULTS.topRecipient) p.set('tr', String(view.topRecipient));
  if (!view.showAggRecipient) p.set('ar', '0');
  if (!view.showAggProject) p.set('ap', '0');
  if (view.projectSortBy === 'spending') p.set('ps', 's');
  if (!view.scaleBudgetToVisible) p.set('sb', '0');
  if (view.focusRelated) p.set('fr', '1');
  // 年度はリンクの曖昧さを避けるため常に明示（page.tsx は既定 2025 を省略するが、明示指定も受理する）
  p.set('yr', query.year);

  if (hasActiveFilter(filter)) p.set('fp', '1'); // フィルタパネルを開いて条件を可視化
  if (filter.projectName) {
    p.set('fnp', filter.projectName.query);
    if (filter.projectName.regex) p.set('fnpr', '1');
  }
  if (filter.recipientName) {
    p.set('fnr', filter.recipientName.query);
    if (filter.recipientName.regex) p.set('fnrr', '1');
    if (filter.recipientName.includeSubcontract) p.set('fnrs', '1');
  }
  for (const name of filter.ministries) p.append('fm', name);
  if (filter.budget.min != null) p.set('fmb', formatYenForUrlParam(filter.budget.min));
  if (filter.budget.max != null) p.set('fxb', formatYenForUrlParam(filter.budget.max));
  if (filter.spending.min != null) p.set('fms', formatYenForUrlParam(filter.spending.min));
  if (filter.spending.max != null) p.set('fxs', formatYenForUrlParam(filter.spending.max));
  const acSet = new Set(filter.accountCategories);
  if (acSet.size < ACCOUNT_CATEGORY_KEYS.length) {
    p.set('ac', `${acSet.has('general') ? 'g' : ''}${acSet.has('special') ? 's' : ''}${acSet.has('both') ? 'b' : ''}${acSet.has('none') ? 'n' : ''}`);
  }
  // 再委託条件: 深さ下限指定は fsd、有無のみは fsr
  if (filter.subcontract.minDepth != null) p.set('fsd', String(filter.subcontract.minDepth));
  else if (filter.subcontract.hasRedelegation) p.set('fsr', '1');
  return p;
}

/**
 * /sankey-svg のURLパラメータ（短縮キー）から SankeyQuery を構築する。
 * 金額テキスト（fmb 等）は parseAmountToYen で1円単位に変換する。
 */
export function sankeyQueryFromUrlParams(p: URLSearchParams): SankeyQuery {
  const query: SankeyQuery = {};

  const yr = p.get('yr');
  if (yr === '2024' || yr === '2025') query.year = yr;

  const filter: SankeyQuery['filter'] = {};
  const fnp = p.get('fnp');
  if (fnp) filter.projectName = { query: fnp, regex: p.get('fnpr') === '1' };
  const fnr = p.get('fnr');
  if (fnr) {
    filter.recipientName = { query: fnr, regex: p.get('fnrr') === '1' };
    if (p.get('fnrs') === '1') filter.recipientName.includeSubcontract = true;
  }
  const fm = p.getAll('fm').map(v => v.trim()).filter(Boolean);
  if (fm.length > 0) filter.ministries = [...new Set(fm)];
  const amount = (key: string): number | null => {
    const text = p.get(key);
    return text ? parseAmountToYen(text) : null;
  };
  const fmb = amount('fmb'), fxb = amount('fxb');
  if (fmb != null || fxb != null) filter.budget = { min: fmb, max: fxb };
  const fms = amount('fms'), fxs = amount('fxs');
  if (fms != null || fxs != null) filter.spending = { min: fms, max: fxs };
  const ac = p.get('ac');
  if (ac !== null) {
    const cats: AccountCategoryKey[] = [];
    if (ac.includes('g')) cats.push('general');
    if (ac.includes('s')) cats.push('special');
    if (ac.includes('b')) cats.push('both');
    if (ac.includes('n')) cats.push('none');
    filter.accountCategories = cats;
  }
  const fsd = p.get('fsd');
  const fsdNum = fsd !== null ? parseInt(fsd, 10) : NaN;
  if (!isNaN(fsdNum)) filter.subcontract = { minDepth: fsdNum };
  else if (p.get('fsr') === '1') filter.subcontract = { hasRedelegation: true };
  if (Object.keys(filter).length > 0) query.filter = filter;

  const view: SankeyQuery['view'] = {};
  const num = (key: string): number | undefined => {
    const v = p.get(key);
    if (v === null) return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
  };
  const tm = num('tm'); if (tm != null) view.topMinistry = tm;
  const tp = num('tp'); if (tp != null) view.topProject = tp;
  const tr = num('tr'); if (tr != null) view.topRecipient = tr;
  const pp = p.get('pp'); const pr = p.get('pr'); const pm = p.get('pm');
  if (pp || pr || pm) view.pin = { projectId: pp, recipientId: pr, ministryName: pm };
  if (p.get('fr') === '1') view.focusRelated = true;
  const ro = num('ro'); const po = num('po'); const ot = p.get('ot');
  if (ro != null || po != null || ot !== null) {
    view.offset = {};
    if (ot === 'r') view.offset.target = 'recipient';
    else if (ot === 'p') view.offset.target = 'project';
    if (ro != null) view.offset.recipient = ro;
    if (po != null) view.offset.project = po;
  }
  if (p.get('ps') === 's') view.projectSortBy = 'spending';
  if (p.get('ar') === '0') view.showAggRecipient = false;
  if (p.get('ap') === '0') view.showAggProject = false;
  if (p.get('sb') === '0') view.scaleBudgetToVisible = false;
  if (Object.keys(view).length > 0) query.view = view;

  return query;
}
