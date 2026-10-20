'use client';

/**
 * 統合ビュー（メニュー名「統合ビュー」）。
 *
 * 国の歳出予算（一般会計＋特別会計）を 会計 → 所管 → 組織/勘定 → 項 → 目 → 事業区分（RS事業／非事業／未突合）
 * → 事業(支出) → 支出先 の1本のグラフで見る。列は畳み込めるので、プリセットで
 * 「RSのみ」（/sankey-svg 相当）「予算書のみ」（/mof-sankey 相当）「統合」「項→目→事業」を切り替える。
 *
 * セレクタは予算年度のみ（RSシート年度は生成時に内部で解決済み。metadata.rsSheetYear）。
 * データは事前生成の `public/data/unified-budget-{予算年度}-graph.json` をブラウザが直接読む（/sankey-svg と同じ）。
 * 変換（絞り込み → 列の畳み込み → TopN）は app/lib/unified-budget/transform.ts の純関数。
 *
 * 追加ビューとして実装しており、既存ページ（/sankey-svg・/mof-sankey 等）のコードには触れていない
 * （設計 5.2）。
 */

import LoadingSpinner from '@/client/components/LoadingSpinner';
import { useDeferredValue, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { UNIFIED_BASES_BY_YEAR, UNIFIED_BASIS_LABELS, UNIFIED_BASIS_MOF_MEASURE, UNIFIED_RS_MINISTRY_COLUMN_LABELS, UNIFIED_RS_MINISTRY_MEASURE, isRsMinistryBasis, unifiedFileBasis, unifiedGraphFileName, type UnifiedBasis, type UnifiedColumn, type UnifiedGraph } from '@/types/unified-budget';
import { UNIFIED_COLUMNS } from '@/types/unified-budget';
import {
  UNIFIED_PRESET_COLUMNS,
  UNIFIED_PROGRAM_SORT_SHORT,
  hasScoreRange,
  type UnifiedOffset,
  type UnifiedPolicyScores,
  UNIFIED_SCORE_FIELDS,
  type UnifiedProgramSort,
  type UnifiedTopN,
  type UnifiedViewFilter,
} from '@/types/unified-budget-view';
import { usePolicySummary } from '@/client/components/unified-budget/policy-summary-cache';
import { useProjectSortMetrics } from '@/client/hooks/useProjectSortMetrics';
import { buildProgramRanking, programSortNeedsMetrics, programSortNeedsScore } from '@/app/lib/unified-budget/program-sort';
import type { LabelDensity } from '@/types/mof-hierarchy';
import { applyFilter, applyTopN, collapseColumns, countByColumn, offsetToReveal, sortForDisplay, toRsMinistryGraph, toViewGraph } from '@/app/lib/unified-budget/transform';
import { withProvisionalSpending } from '@/app/lib/unified-budget/provisional';
import { AppHeader } from '@/components/navigation/AppHeader';
import { YearSelect } from '@/components/navigation/YearSelect';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { UnifiedSankeyChart } from '@/client/components/unified-budget/UnifiedSankeyChart';
import { autoLabelFontPx, LABEL_FONT_PX_FULL_HD } from '@/app/lib/unified-budget/label-font';
import { UnifiedControls } from '@/client/components/unified-budget/UnifiedControls';
import { UnifiedHelp } from '@/client/components/unified-budget/UnifiedHelp';
import { UnifiedViewSelect } from '@/client/components/unified-budget/UnifiedViewSelect';
import { UnifiedBasisSelect } from '@/client/components/unified-budget/UnifiedBasisSelect';
import { UnifiedSettings } from '@/client/components/unified-budget/UnifiedSettings';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';
import { useMediaQuery } from '@/client/hooks/useMediaQuery';
import { applySankeyQueryToUnifiedFilter } from '@/client/lib/unified-ai-filter';
import { parseFilter, serializeFilter } from '@/app/lib/unified-budget/filter-url';
import { atomicMinistryOptions } from '@/app/lib/unified-budget/ministry-names';
import { useAiResultHandler } from '@/client/lib/ai/result-handler';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';
import { cn } from '@/lib/utils';
import { FLOW_SCALE_BASE, FLOW_SCALE_DEFAULT, parseFlowScale } from '@/client/lib/unified-flow-scale';

/** 生成済みの予算年度（新しい順）。生成物が増えたらここに足す（decompress-data.sh も） */
const AVAILABLE_YEARS = [2026, 2025, 2024, 2023] as const;
const DEFAULT_YEAR = 2024;
const DEFAULT_BASIS: UnifiedBasis = 'settlement';
const basesOf = (year: number): readonly UnifiedBasis[] => UNIFIED_BASES_BY_YEAR[year] ?? ['initial'];
/** 実績を追える決算を優先。決算未収録の年度は当初予算に戻す。 */
const coerceBasis = (year: number, basis: UnifiedBasis | null | undefined): UnifiedBasis =>
  basis && basesOf(year).includes(basis) ? basis : basesOf(year).includes(DEFAULT_BASIS) ? DEFAULT_BASIS : 'initial';
/** 読み込んだグラフのキー。府省庁基準は当初予算ファイルを共有する */
const graphKey = (year: number, basis: UnifiedBasis, provisional = false) => `${year}-${unifiedFileBasis(basis)}${provisional ? '-provisional' : ''}`;

/** 列 → URL パラメータ名の短縮（t=TopN, o=表示位置） */
const COL_KEY: Record<UnifiedColumn, string> = {
  revenue: 'rv',
  account: 'ac',
  ministry: 'mi',
  organization: 'or',
  section: 'se',
  koumoku: 'ko',
  program: 'pr',
  'program-spending': 'ps',
  recipient: 're',
};
const KEY_COL = Object.fromEntries(Object.entries(COL_KEY).map(([c, k]) => [k, c])) as Record<string, UnifiedColumn>;

/** 事業列の並べ替え → URL の sort（金額＝既定は省く） */
const SORT_KEY: Record<UnifiedProgramSort, string> = { amount: '', 'score-asc': 'sa', 'score-desc': 'sd', years: 'yr', diff: 'df', ratio: 'dr' };
const parseProgramSort = (v: string | null): UnifiedProgramSort =>
  (Object.keys(SORT_KEY) as UnifiedProgramSort[]).find(k => k !== 'amount' && SORT_KEY[k] === v) ?? 'amount';

/** 事業詳細パネルの上端と左上カード行の下端の間隔(px) */
const SIDE_PANEL_GAP_PX = 8;

function parseColumns(raw: string | null): UnifiedColumn[] | null {
  if (!raw) return null;
  const cols = raw
    .split(',')
    .map(k => KEY_COL[k])
    .filter((c): c is UnifiedColumn => !!c);
  return cols.length > 0 ? UNIFIED_COLUMNS.filter(c => cols.includes(c)) : null;
}
const serializeColumns = (cols: UnifiedColumn[]) => UNIFIED_COLUMNS.filter(c => cols.includes(c)).map(c => COL_KEY[c]).join(',');

function parsePerColumn(params: URLSearchParams, prefix: 't' | 'o'): Partial<Record<UnifiedColumn, number>> {
  const out: Partial<Record<UnifiedColumn, number>> = {};
  for (const c of UNIFIED_COLUMNS) {
    const v = params.get(`${prefix}${COL_KEY[c]}`);
    if (v !== null && v !== '' && !Number.isNaN(Number(v))) out[c] = Number(v);
  }
  return out;
}


export default function UnifiedBudgetSankeyPage() {
  return (
    <Suspense fallback={<LoadingSpinner fullscreen />}>
      <UnifiedBudgetSankeyContent />
    </Suspense>
  );
}

function CenterMessage({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <p className={error ? 'text-sm text-destructive' : 'text-sm text-mirai-text-muted'}>{text}</p>
    </div>
  );
}

function UnifiedBudgetSankeyContent() {
  const searchParams = useSearchParams();
  const [year, setYear] = useState<number>(() => {
    const y = Number(searchParams.get('year'));
    return (AVAILABLE_YEARS as readonly number[]).includes(y) ? y : DEFAULT_YEAR;
  });
  const [basis, setBasis] = useState<UnifiedBasis>(() => {
    const y = Number(searchParams.get('year'));
    const year0 = (AVAILABLE_YEARS as readonly number[]).includes(y) ? y : DEFAULT_YEAR;
    return coerceBasis(year0, searchParams.get('b') as UnifiedBasis | null);
  });
  const [visibleColumns, setVisibleColumns] = useState<UnifiedColumn[]>(() => parseColumns(searchParams.get('cols')) ?? UNIFIED_PRESET_COLUMNS.full);
  const [provisionalView, setProvisionalView] = useState(() => searchParams.get('view') === 'provisional' || searchParams.get('b') === 'execution');
  const effectiveProvisional = year === 2025 && provisionalView;
  const [topN, setTopN] = useState<UnifiedTopN>(() => parsePerColumn(searchParams, 't'));
  const [offset, setOffset] = useState<UnifiedOffset>(() => parsePerColumn(searchParams, 'o'));
  const [programSort, setProgramSort] = useState<UnifiedProgramSort>(() => parseProgramSort(searchParams.get('sort')));
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('sel'));
  const [focusRelated, setFocusRelated] = useState(searchParams.get('fr') === '1');
  /** 利用者が明示した文字サイズ（URL の fs）。null は自動（画面の大きさから決める） */
  const [fontPxOverride, setFontPxOverride] = useState<number | null>(() => Number(searchParams.get('fs')) || null);
  const [autoFontPx, setAutoFontPx] = useState(LABEL_FONT_PX_FULL_HD);
  useEffect(() => {
    const update = () => setAutoFontPx(autoLabelFontPx(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const fontPx = fontPxOverride ?? autoFontPx;
  // 自動の値に戻したときは明示をやめる（URL にも載せない）
  const setFontPx = useCallback((value: number) => setFontPxOverride(value === autoFontPx ? null : value), [autoFontPx]);
  const [flowScale, setFlowScale] = useState(() => parseFlowScale(searchParams.get('th')));
  const [labelDensity, setLabelDensity] = useState<LabelDensity>(() => (searchParams.get('ld') === 'major' ? 'major' : 'all'));
  const [filterOpen, setFilterOpen] = useState(searchParams.get('ffp') === '1');
  // AI ナビ（ヘッダーの AI ボタン）の結果をこのページで受け取り、絞り込みに写す。
  // 手動の絞り込み条件そのものは保持し、AI が設定した条件も同じ状態として既存の × で消す
  useAiResultHandler(useCallback((result: SankeyChatResult) => {
    setFilter(f => applySankeyQueryToUnifiedFilter(f, result.query).filter);
    setFilterOpen(false);
  }, []));
  // sm 以上: 表示数カードは左上、設定は右上の検索クラスタ内。sm 未満: 右上の 1 ボタンに両方を畳む。
  // CSS で隠すだけだと同じボタンが DOM に二重に存在するので、メディアクエリで出し分ける
  const wideControls = useMediaQuery('(min-width: 640px)');
  // 左上のカード行は列数・データで折り返して高さが変わる。詳細パネルの上端をこの行の実下端（図コンテナ基準）に合わせて被らないようにする。
  // ResizeObserver だけだと行の中身が後から増えたときに取りこぼすため、毎レンダーでも測り直す
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const [controlsBottom, setControlsBottom] = useState(0);
  const measureControls = useCallback(() => {
    const el = controlsRowRef.current;
    setControlsBottom(el ? el.offsetTop + el.offsetHeight : 0);
  }, []);
  // 中身が後から増える分は毎レンダーの測り直しで、ウィンドウ幅などの変化は ResizeObserver で拾う
  useLayoutEffect(measureControls);
  useEffect(() => {
    const el = controlsRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureControls);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureControls, wideControls]);
  /** sm 未満で表示数・設定を開いているか */
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [filter, setFilter] = useState<UnifiedViewFilter>(() => {
    const f = parseFilter(searchParams);
    // URL に絞り込みの指定が無く「RSのみ」の列構成で開いたときは、非事業ノードを出さない（/sankey-svg と同じ見え方）
    if (searchParams.get('fnrs') === null && searchParams.get('cols') === serializeColumns(UNIFIED_PRESET_COLUMNS.rs)) f.showNonRs = false;
    return f;
  });

  const [graphs, setGraphs] = useState<Map<string, UnifiedGraph>>(new Map());
  // 年度を変えたとき、その年度に無い基準（2026 の決算など）は当初予算へ戻す
  const effectiveBasis = coerceBasis(year, basis);
  useEffect(() => {
    if (effectiveBasis !== basis) setBasis(effectiveBasis);
  }, [effectiveBasis, basis]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = graphKey(year, effectiveBasis, effectiveProvisional);
    if (graphs.has(key)) return;
    let cancelled = false;
    setLoading(true);
    const budget = fetch(`/data/${unifiedGraphFileName(year, effectiveBasis)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`統合グラフ（${year}年度・${UNIFIED_BASIS_LABELS[effectiveBasis]}）を取得できませんでした: ${res.status}`))));
    const data: Promise<UnifiedGraph> = effectiveProvisional
      ? Promise.all([budget, fetch('/data/unified-budget-2025-execution-graph.json').then(r => {
        if (!r.ok) throw new Error(`暫定支出データを取得できませんでした: ${r.status}`);
        return r.json();
      })]).then(([b, e]) => withProvisionalSpending(b, e)) : budget;
    data.then((g: UnifiedGraph) => {
        if (cancelled) return;
        setGraphs(prev => new Map(prev).set(key, g));
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, effectiveBasis, effectiveProvisional, graphs]);

  const graph = graphs.get(graphKey(year, effectiveBasis, effectiveProvisional)) ?? null;
  const rsMinistryMode = isRsMinistryBasis(effectiveBasis);

  // 変換パイプライン。絞り込み・畳み込みまでは browse（サイドパネル用・全件）、TopN 後が図用。
  // 府省庁基準は MOF 側を捨てて RS府省庁 → 事業 に組み替える（旧 /sankey-svg 相当）
  const base = useMemo(() => {
    if (!graph) return null;
    const view = toViewGraph(graph, { keepZeroPrograms: rsMinistryMode });
    return rsMinistryMode ? toRsMinistryGraph(view) : view;
  }, [graph, rsMinistryMode]);

  /** この基準・年度に存在する列（支出の無い年度は事業(支出)・支出先が無い。府省庁基準は 予算総計(会計列)・府省庁・事業〜支出先） */
  const availableColumns = useMemo<UnifiedColumn[]>(() => {
    if (!base) return [...UNIFIED_COLUMNS];
    const present = new Set(base.nodes.map(n => n.details.column));
    return UNIFIED_COLUMNS.filter(c => present.has(c));
  }, [base]);
  const effectiveColumns = useMemo(() => {
    const cols = visibleColumns.filter(c => availableColumns.includes(c));
    // 税目から事業への架空の直接充当を作らないよう、歳入の接続先の会計は残す。
    if (cols.includes('revenue') && !cols.includes('account')) return UNIFIED_COLUMNS.filter(c => c === 'account' || cols.includes(c));
    return cols.length > 0 ? cols : availableColumns.filter(c => c === 'ministry' || c === 'section' || c === 'program');
  }, [visibleColumns, availableColumns]);
  // 政策評価スコアの絞り込みは /api/policy-summary（RSシート年度）が要る。範囲を指定したときだけ読む。
  // 取得前（undefined）・取得失敗（null）のときは ctx.policy を渡さず、スコアの絞り込みは効かせない
  const scoreFilterActive = UNIFIED_SCORE_FIELDS.some(s => hasScoreRange(filter[s.field])) || hasScoreRange(filter.years);
  // 並べ替えの値（総合点・継続年数・差額）も、その並べ替えを選んだときだけ読む。暫定（API）ビューには無い
  const sheetYear = graph && !graph.metadata.apiCoverage ? graph.metadata.rsSheetYear : null;
  const policySummary = usePolicySummary((scoreFilterActive || programSortNeedsScore(programSort)) && sheetYear !== null ? sheetYear : null);
  const sortMetrics = useProjectSortMetrics(programSortNeedsMetrics(programSort) && sheetYear !== null ? sheetYear : null);
  const programRanking = useMemo(
    () => buildProgramRanking(programSort, { policy: policySummary?.items, metrics: sortMetrics }),
    [programSort, policySummary, sortMetrics]
  );
  const programSortStatus = programSort === 'amount' ? 'ready'
    : sheetYear === null ? 'unavailable'
    : (programSortNeedsScore(programSort) ? policySummary : sortMetrics) === undefined ? 'loading'
    : programRanking ? 'ready' : 'unavailable';
  const policyScores = useMemo<UnifiedPolicyScores | undefined>(() => {
    if (!policySummary) return undefined;
    const out: UnifiedPolicyScores = {};
    for (const [pid, e] of Object.entries(policySummary.items)) out[pid] = { o: e.o, d: e.d, e: e.e, t: e.t, x: e.x, n: e.n, y: e.y ?? null };
    return out;
  }, [policySummary]);
  const filterCtx = useMemo(() => ({ policy: policyScores }), [policyScores]);
  // 絞り込みの反映は入力より遅らせる（1 文字ごとに全ノードの絞り込みと再配置が走り、入力が引っかかるため）。
  // 入力欄は filter に直結したまま即座に反応し、図の計算は途中の値を飛ばして最新だけ行う
  const deferredFilter = useDeferredValue(filter);
  const filtered = useMemo(() => (base ? applyFilter(base, deferredFilter, filterCtx) : null), [base, deferredFilter, filterCtx]);
  const collapsed = useMemo(() => (filtered ? collapseColumns(filtered, effectiveColumns) : null), [filtered, effectiveColumns]);
  const columnCounts = useMemo(() => (collapsed ? countByColumn(collapsed) : {}), [collapsed]);
  const display = useMemo(
    () => (collapsed ? sortForDisplay(applyTopN(collapsed, topN, offset, programRanking), programRanking) : null),
    [collapsed, topN, offset, programRanking]
  );
  // 選択ノード（一覧のリンク・検索・URL から来る）が TopN の窓から溢れて図に無いときは、
  // その列の表示位置をノードが窓に入るところまで動かす。「図には出ていません」で止まらないようにする
  useEffect(() => {
    if (!selectedId || !collapsed || !display) return;
    if (display.nodes.some(n => n.id === selectedId)) return;
    const patch = offsetToReveal(collapsed, topN, offset, selectedId, programRanking);
    if (patch) setOffset(o => ({ ...o, ...patch }));
  }, [selectedId, collapsed, display, topN, offset, programRanking]);
  // 絞り込みの選択肢は共管（「内閣府及び厚生労働省」など）を分解した単独の省庁だけ。判定側（applyFilter）が共管を含めて残す
  const ministries = useMemo(() => (base ? atomicMinistryOptions(base.nodes.filter(n => n.details.column === 'ministry').map(n => n.name)) : []), [base]);

  // URL 同期
  useEffect(() => {
    if (!graph) return;
    const params = new URLSearchParams();
    params.set('year', String(year));
    params.set('b', effectiveBasis);
    if (effectiveProvisional) params.set('view', 'provisional');
    // 年度による一時的な非表示を、ユーザーが列を隠した設定として保存しない。
    params.set('cols', serializeColumns(visibleColumns));
    for (const c of UNIFIED_COLUMNS) {
      if (topN[c] !== undefined) params.set(`t${COL_KEY[c]}`, String(topN[c]));
      if (offset[c]) params.set(`o${COL_KEY[c]}`, String(offset[c]));
    }
    if (programSort !== 'amount') params.set('sort', SORT_KEY[programSort]);
    if (selectedId) params.set('sel', selectedId);
    if (focusRelated) params.set('fr', '1');
    if (fontPxOverride !== null) params.set('fs', String(fontPxOverride));
    if (flowScale !== FLOW_SCALE_DEFAULT) params.set('th', String(Number((flowScale * FLOW_SCALE_BASE).toFixed(8))));
    params.set('ld', labelDensity);
    serializeFilter(params, filter);
    if (filterOpen) params.set('ffp', '1');
    const next = `?${params.toString()}`;
    if (next !== window.location.search) window.history.replaceState(null, '', next);
  }, [graph, year, effectiveBasis, effectiveProvisional, visibleColumns, topN, offset, programSort, selectedId, focusRelated, fontPxOverride, flowScale, labelDensity, filter, filterOpen]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const y = Number(params.get('year'));
      const restoredYear = (AVAILABLE_YEARS as readonly number[]).includes(y) ? y : DEFAULT_YEAR;
      setYear(restoredYear);
      setBasis(coerceBasis(restoredYear, params.get('b') as UnifiedBasis | null));
      setProvisionalView(params.get('view') === 'provisional' || params.get('b') === 'execution');
      setVisibleColumns(parseColumns(params.get('cols')) ?? UNIFIED_PRESET_COLUMNS.full);
      setTopN(parsePerColumn(params, 't'));
      setOffset(parsePerColumn(params, 'o'));
      setProgramSort(parseProgramSort(params.get('sort')));
      setSelectedId(params.get('sel'));
      setFocusRelated(params.get('fr') === '1');
      setFontPxOverride(Number(params.get('fs')) || null);
      setFlowScale(parseFlowScale(params.get('th')));
      setLabelDensity(params.get('ld') === 'major' ? 'major' : 'all');
      setFilter(parseFilter(params));
      setFilterOpen(params.get('ffp') === '1');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectNode = useCallback(
    (id: string | null) => {
      if (id === selectedId) return;
      const params = new URLSearchParams(window.location.search);
      if (id) params.set('sel', id);
      else params.delete('sel');
      window.history.pushState(null, '', `?${params.toString()}`);
      setSelectedId(id);
    },
    [selectedId]
  );

  if (loading && !graph) return <LoadingSpinner fullscreen />;
  if (error && !graph) return <CenterMessage text={error} error />;
  if (!graph || !display || !collapsed) return <CenterMessage text="データを取得できませんでした" error />;

  const { metadata } = graph;
  // 暫定（API）ビューの取得状況は設定パネルに出さない（長い注記で図の操作を妨げるため）
  const summary = metadata.apiCoverage
    ? undefined
    : rsMinistryMode
    ? `${metadata.budgetYear}年度 府省庁基準（RSシステムの府省庁 → 事業。予算書の会計〜目は使わない）。事業の値は${
        metadata.rsAmountKind === 'request' ? '翌年度要求額' : UNIFIED_RS_MINISTRY_MEASURE
      } / RSシート${metadata.rsSheetYear}`
    : `${metadata.budgetYear}年度 ${metadata.basisBudgetType} / 純計 ${formatBudgetFromYen(metadata.totals.net)}（総計 ${formatBudgetFromYen(metadata.totals.gross)}・繰入 ${formatBudgetFromYen(metadata.totals.transfer)}） / RS事業 ${formatBudgetFromYen(metadata.totals.rsProgram)}${
    metadata.rsAmountKind === 'request' ? '（翌年度要求額）' : ''
  } / 給付・金融取引など ${formatBudgetFromYen(metadata.totals.byKind['non-program'] ?? 0)} / 未突合 ${formatBudgetFromYen(metadata.totals.byKind.unmatched)} / RSシート${metadata.rsSheetYear}`;

  const settingsPanel = (placement: 'top-right' | 'top-auto') => (
    <UnifiedSettings
      placement={placement}
      fontPx={fontPx}
      onFontPxChange={setFontPx}
      defaultFontPx={autoFontPx}
      flowScale={flowScale}
      onFlowScaleChange={setFlowScale}
      labelDensity={labelDensity}
      onLabelDensityChange={setLabelDensity}
      focusRelated={focusRelated}
      onFocusRelatedChange={setFocusRelated}
      showNonRs={filter.showNonRs}
      onShowNonRsChange={showNonRs => setFilter(f => ({ ...f, showNonRs }))}
      includeCollapsedAccounts={filter.includeCollapsedAccounts}
      onIncludeCollapsedAccountsChange={includeCollapsedAccounts => setFilter(f => ({ ...f, includeCollapsedAccounts }))}
      visibleColumns={effectiveColumns}
      availableColumns={availableColumns}
      onVisibleColumnsChange={columns => setVisibleColumns(previous => UNIFIED_COLUMNS.filter(c =>
        availableColumns.includes(c) ? columns.includes(c) : previous.includes(c)))}
      programSort={programSort}
      onProgramSortChange={next => {
        setProgramSort(next);
        // 並びが変わると表示位置の意味も変わるので先頭へ戻す
        setOffset(o => ({ ...o, program: undefined, 'program-spending': undefined }));
      }}
      programSortStatus={programSortStatus}
      summary={summary}
    />
  );
  return (
    <>
    <AppHeader fiscalYear={year} position="fixed" current="/budget-sankey">
      <UnifiedHelp sheetYear={graph?.metadata.rsSheetYear ?? year + 1} />
      <UnifiedBasisSelect value={effectiveBasis} available={basesOf(year)} onChange={setBasis} />
      <UnifiedViewSelect
        provisional={effectiveProvisional}
        provisionalAvailable={year === 2025}
        onProvisionalChange={enabled => {
          setProvisionalView(enabled);
          if (enabled) setVisibleColumns(UNIFIED_PRESET_COLUMNS.full);
        }}
        visibleColumns={effectiveColumns}
        availableColumns={availableColumns}
        onChange={(preset, columns) => {
          setVisibleColumns(columns);
          setFilter(f => ({ ...f, showNonRs: preset !== 'rs' }));
        }}
      />
      <YearSelect value={String(year)} onChange={y => setYear(Number(y))} years={AVAILABLE_YEARS} />
    </AppHeader>
    <h1 className="sr-only">国の予算と支出の流れ</h1>
    <div className="fixed inset-x-0 bottom-0 top-[var(--app-header-h)] overflow-hidden bg-background">
      <UnifiedSankeyChart
        nodes={display.nodes}
        links={display.links}
        browseNodes={collapsed.nodes}
        browseLinks={collapsed.links}
        visibleColumns={effectiveColumns}
        ministries={ministries}
        selectedId={selectedId}
        onSelect={selectNode}
        focusRelated={focusRelated}
        filter={filter}
        onFilterChange={setFilter}
        filterOpen={filterOpen}
        onToggleFilterOpen={() => setFilterOpen(v => !v)}
        searchTrailing={wideControls ? settingsPanel('top-right') : undefined}
        sidePanelTopOffset={wideControls && controlsBottom > 0 ? controlsBottom + SIDE_PANEL_GAP_PX : undefined}
        fontPx={fontPx}
        flowScale={flowScale}
        labelDensity={labelDensity}
        budgetYear={metadata.budgetYear}
        basisMeasureLabel={UNIFIED_BASIS_MOF_MEASURE[effectiveBasis]}
        rsMeasureLabel={rsMinistryMode ? UNIFIED_RS_MINISTRY_MEASURE : metadata.rsMeasureLabel}
        columnLabels={rsMinistryMode ? UNIFIED_RS_MINISTRY_COLUMN_LABELS : undefined}
        provisional={!!metadata.apiCoverage}
        rsSheetYear={metadata.rsSheetYear}
        programSortLabel={programRanking ? UNIFIED_PROGRAM_SORT_SHORT[programSort] : undefined}
        rsAmountKind={metadata.rsAmountKind}
        hasSpending={metadata.hasSpending}
        scoreStatus={metadata.apiCoverage ? 'unavailable' : !scoreFilterActive ? 'idle' : policySummary === undefined ? 'loading' : policySummary === null ? 'unavailable' : 'ready'}
      />
      {/* 表示数のコントロールパネル。sm 以上は左上（検索・AI・表示設定は右上）。
          sm 未満では右上の 1 ボタンに表示設定と一緒に畳み、押すと下に縦に開く */}
      {!wideControls && <div className="absolute right-3 top-3 z-30">
        <Button
          variant="outline"
          size="icon"
          aria-label="表示数と表示設定"
          aria-expanded={mobileControlsOpen}
          onClick={() => setMobileControlsOpen(v => !v)}
          className={cn('border-mirai-border', mobileControlsOpen ? 'bg-mirai-surface text-mirai-text' : 'text-mirai-text-subtle')}
        >
          <SlidersHorizontal className="size-[18px]" aria-hidden="true" />
        </Button>
      </div>}
      <div ref={controlsRowRef} className={cn('pointer-events-none absolute right-3 top-14 z-30 flex-col items-end gap-2 sm:left-3 sm:right-auto sm:top-[2px] sm:flex sm:max-w-[calc(100%-372px)] xl:max-w-[calc(100%-356px)] 2xl:max-w-[calc(100%-372px)] sm:flex-row sm:items-start xl:w-[calc(100%-356px)] 2xl:w-[calc(100%-372px)]', mobileControlsOpen ? 'flex' : 'hidden')}>
        <UnifiedControls visibleColumns={effectiveColumns} topN={topN} offset={offset} columnCounts={columnCounts} onTopNChange={setTopN} onOffsetChange={setOffset} />
        {!wideControls && settingsPanel('top-right')}
      </div>

      {loading && <div className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded bg-card px-3 py-1 text-xs text-mirai-text-muted shadow-xs">読み込み中…</div>}
      {metadata.rsAmountKind === 'request' && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded bg-stance-neutral-badge-bg px-3 py-1 text-[11px] text-stance-neutral shadow-xs">
          {metadata.budgetYear}年度は「要求→査定」ビュー: RS事業の値は前年度シートの翌年度要求額、目の値はMOF{UNIFIED_BASIS_MOF_MEASURE[effectiveBasis]}{effectiveBasis === 'initial' ? '（査定後）' : ''}です
        </div>
      )}
    </div>
    </>
  );
}
