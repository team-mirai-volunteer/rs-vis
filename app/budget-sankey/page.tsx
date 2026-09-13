'use client';

/**
 * 統合ビュー（メニュー名「統合ビュー」）。
 *
 * 国の歳出予算（一般会計＋特別会計）を 会計 → 所管 → 組織/勘定 → 項 → 目 → 事業区分（RS事業／非事業／未突合）
 * → 事業(支出) → 支出先 の1本のグラフで見る。列は畳み込めるので、プリセットで
 * 「RSのみ」（/sankey-svg 相当）「予算書のみ」（/mof-sankey 相当）「完全統合」「項→目→事業」を切り替える。
 *
 * セレクタは予算年度のみ（RSシート年度は生成時に内部で解決済み。metadata.rsSheetYear）。
 * データは事前生成の `public/data/unified-budget-{予算年度}-graph.json` をブラウザが直接読む（/sankey-svg と同じ）。
 * 変換（絞り込み → 列の畳み込み → TopN）は app/lib/unified-budget/transform.ts の純関数。
 *
 * 追加ビューとして実装しており、既存ページ（/sankey-svg・/mof-sankey 等）のコードには触れていない
 * （設計 5.2）。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { UnifiedColumn, UnifiedGraph } from '@/types/unified-budget';
import { UNIFIED_COLUMNS } from '@/types/unified-budget';
import {
  UNIFIED_PRESET_COLUMNS,
  type UnifiedOffset,
  type UnifiedTopN,
  type UnifiedViewFilter,
} from '@/types/unified-budget-view';
import type { LabelDensity } from '@/types/mof-hierarchy';
import { applyFilter, applyTopN, collapseColumns, countByColumn, sortForDisplay, toViewGraph } from '@/app/lib/unified-budget/transform';
import { AppHeader } from '@/components/navigation/AppHeader';
import { YearSelect } from '@/components/navigation/YearSelect';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { UnifiedSankeyChart, LABEL_FONT_PX_DEFAULT } from '@/client/components/unified-budget/UnifiedSankeyChart';
import { UnifiedControls } from '@/client/components/unified-budget/UnifiedControls';
import { UnifiedViewSelect } from '@/client/components/unified-budget/UnifiedViewSelect';
import { UnifiedSettings } from '@/client/components/unified-budget/UnifiedSettings';

/** 生成済みの予算年度（新しい順）。生成物が増えたらここに足す（decompress-data.sh も） */
const AVAILABLE_YEARS = [2026, 2025, 2024] as const;
const DEFAULT_YEAR = 2024;

/** 列 → URL パラメータ名の短縮（t=TopN, o=表示位置） */
const COL_KEY: Record<UnifiedColumn, string> = {
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

function parseFilter(params: URLSearchParams): UnifiedViewFilter {
  return {
    includeCollapsedAccounts: params.get('fbig') === '1',
    showNonRs: params.get('fnrs') !== '0',
    ministries: params.getAll('fmi'),
    accountTypes: params.getAll('fac').filter((v): v is 'general' | 'special' => v === 'general' || v === 'special'),
    nameQuery: params.get('fq') ?? '',
  };
}

export default function UnifiedBudgetSankeyPage() {
  return (
    <Suspense fallback={<CenterMessage text="読み込み中…" />}>
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
  const [visibleColumns, setVisibleColumns] = useState<UnifiedColumn[]>(() => parseColumns(searchParams.get('cols')) ?? UNIFIED_PRESET_COLUMNS.full);
  const [topN, setTopN] = useState<UnifiedTopN>(() => parsePerColumn(searchParams, 't'));
  const [offset, setOffset] = useState<UnifiedOffset>(() => parsePerColumn(searchParams, 'o'));
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('sel'));
  const [focusRelated, setFocusRelated] = useState(searchParams.get('fr') === '1');
  const [fontPx, setFontPx] = useState(() => Number(searchParams.get('fs')) || LABEL_FONT_PX_DEFAULT);
  const [labelDensity, setLabelDensity] = useState<LabelDensity>(() => (searchParams.get('ld') === 'major' ? 'major' : 'all'));
  const [filterOpen, setFilterOpen] = useState(searchParams.get('ffp') === '1');
  const [filter, setFilter] = useState<UnifiedViewFilter>(() => {
    const f = parseFilter(searchParams);
    // URL に絞り込みの指定が無く「RSのみ」の列構成で開いたときは、非事業ノードを出さない（/sankey-svg と同じ見え方）
    if (searchParams.get('fnrs') === null && searchParams.get('cols') === serializeColumns(UNIFIED_PRESET_COLUMNS.rs)) f.showNonRs = false;
    return f;
  });

  const [graphs, setGraphs] = useState<Map<number, UnifiedGraph>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (graphs.has(year)) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/data/unified-budget-${year}-graph.json`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`統合グラフ（${year}年度）を取得できませんでした: ${res.status}`))))
      .then((g: UnifiedGraph) => {
        if (cancelled) return;
        setGraphs(prev => new Map(prev).set(year, g));
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, graphs]);

  const graph = graphs.get(year) ?? null;

  /** この年度に存在する列（支出の無い年度は事業(支出)・支出先が無い） */
  const availableColumns = useMemo<UnifiedColumn[]>(() => (graph ? UNIFIED_COLUMNS.filter(c => (graph.metadata.counts[c] ?? 0) > 0) : [...UNIFIED_COLUMNS]), [graph]);
  const effectiveColumns = useMemo(() => {
    const cols = visibleColumns.filter(c => availableColumns.includes(c));
    return cols.length > 0 ? cols : availableColumns.filter(c => c === 'ministry' || c === 'section' || c === 'program');
  }, [visibleColumns, availableColumns]);

  // 変換パイプライン。絞り込み・畳み込みまでは browse（サイドパネル用・全件）、TopN 後が図用
  const base = useMemo(() => (graph ? toViewGraph(graph) : null), [graph]);
  const filtered = useMemo(() => (base ? applyFilter(base, filter) : null), [base, filter]);
  const collapsed = useMemo(() => (filtered ? collapseColumns(filtered, effectiveColumns) : null), [filtered, effectiveColumns]);
  const columnCounts = useMemo(() => (collapsed ? countByColumn(collapsed) : {}), [collapsed]);
  const display = useMemo(() => (collapsed ? sortForDisplay(applyTopN(collapsed, topN, offset)) : null), [collapsed, topN, offset]);
  const ministries = useMemo(() => (base ? [...new Set(base.nodes.filter(n => n.details.column === 'ministry').map(n => n.name))] : []), [base]);

  // URL 同期
  useEffect(() => {
    if (!graph) return;
    const params = new URLSearchParams();
    params.set('year', String(year));
    params.set('cols', serializeColumns(effectiveColumns));
    for (const c of UNIFIED_COLUMNS) {
      if (topN[c] !== undefined) params.set(`t${COL_KEY[c]}`, String(topN[c]));
      if (offset[c]) params.set(`o${COL_KEY[c]}`, String(offset[c]));
    }
    if (selectedId) params.set('sel', selectedId);
    if (focusRelated) params.set('fr', '1');
    if (fontPx !== LABEL_FONT_PX_DEFAULT) params.set('fs', String(fontPx));
    if (labelDensity !== 'all') params.set('ld', labelDensity);
    if (filter.includeCollapsedAccounts) params.set('fbig', '1');
    if (!filter.showNonRs) params.set('fnrs', '0');
    for (const m of filter.ministries) params.append('fmi', m);
    for (const a of filter.accountTypes) params.append('fac', a);
    if (filter.nameQuery.trim()) params.set('fq', filter.nameQuery.trim());
    if (filterOpen) params.set('ffp', '1');
    const next = `?${params.toString()}`;
    if (next !== window.location.search) window.history.replaceState(null, '', next);
  }, [graph, year, effectiveColumns, topN, offset, selectedId, focusRelated, fontPx, labelDensity, filter, filterOpen]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const y = Number(params.get('year'));
      if ((AVAILABLE_YEARS as readonly number[]).includes(y)) setYear(y);
      setVisibleColumns(parseColumns(params.get('cols')) ?? UNIFIED_PRESET_COLUMNS.full);
      setTopN(parsePerColumn(params, 't'));
      setOffset(parsePerColumn(params, 'o'));
      setSelectedId(params.get('sel'));
      setFocusRelated(params.get('fr') === '1');
      setFontPx(Number(params.get('fs')) || LABEL_FONT_PX_DEFAULT);
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

  if (loading && !graph) return <CenterMessage text="読み込み中…" />;
  if (error && !graph) return <CenterMessage text={error} error />;
  if (!graph || !display || !collapsed) return <CenterMessage text="データを取得できませんでした" error />;

  const { metadata } = graph;
  const summary = `${metadata.budgetYear}年度 ${metadata.basisBudgetType} / 純計 ${formatBudgetFromYen(metadata.totals.net)}（総計 ${formatBudgetFromYen(metadata.totals.gross)}・繰入 ${formatBudgetFromYen(metadata.totals.transfer)}） / RS事業 ${formatBudgetFromYen(metadata.totals.rsProgram)}${
    metadata.rsAmountKind === 'request' ? '（翌年度要求額）' : ''
  } / 未突合 ${formatBudgetFromYen(metadata.totals.byKind.unmatched)} / RSシート${metadata.rsSheetYear}`;

  return (
    <>
    <AppHeader position="fixed" current="/budget-sankey">
      <UnifiedViewSelect
        visibleColumns={effectiveColumns}
        availableColumns={availableColumns}
        onChange={(preset, columns) => {
          setVisibleColumns(columns);
          setFilter(f => ({ ...f, showNonRs: preset !== 'rs' }));
        }}
      />
      <YearSelect value={String(year)} onChange={y => setYear(Number(y))} years={AVAILABLE_YEARS} />
    </AppHeader>
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
        fontPx={fontPx}
        labelDensity={labelDensity}
        budgetYear={metadata.budgetYear}
        rsSheetYear={metadata.rsSheetYear}
        rsAmountKind={metadata.rsAmountKind}
        bottomLeftExtra={
          <UnifiedSettings
            fontPx={fontPx}
            onFontPxChange={setFontPx}
            defaultFontPx={LABEL_FONT_PX_DEFAULT}
            labelDensity={labelDensity}
            onLabelDensityChange={setLabelDensity}
            focusRelated={focusRelated}
            onFocusRelatedChange={setFocusRelated}
            visibleColumns={effectiveColumns}
            availableColumns={availableColumns}
            onVisibleColumnsChange={setVisibleColumns}
            summary={summary}
          />
        }
      />

      <div className="absolute right-3 top-3 z-30 flex items-start gap-2">
        <UnifiedControls visibleColumns={effectiveColumns} topN={topN} offset={offset} columnCounts={columnCounts} onTopNChange={setTopN} onOffsetChange={setOffset} />
      </div>

      {loading && <div className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded bg-card px-3 py-1 text-xs text-mirai-text-muted shadow-xs">読み込み中…</div>}
      {metadata.rsAmountKind === 'request' && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded bg-stance-neutral-badge-bg px-3 py-1 text-[11px] text-stance-neutral shadow-xs">
          {metadata.budgetYear}年度は「要求→査定」ビュー: RS事業の値は前年度シートの翌年度要求額、目の値はMOF当初予算（査定後）です
        </div>
      )}
    </div>
    </>
  );
}
