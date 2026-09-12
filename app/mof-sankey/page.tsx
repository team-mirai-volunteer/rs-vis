'use client';

/**
 * MOF 予算→項→RS紐づけサンキー。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 の5列（`/mof-hierarchy` と同じ）に、
 * 事項の代わりに「その項にRS事業が紐づく目が1件でもあるか」を示す
 * RS対象/RS対象外の2ノード列を足したもの。画面構成は `/mof-hierarchy` を踏襲する
 * （全画面に図を敷き、見出し・コントロール・ズームはその上に浮かせる）。
 *
 * RS紐づけデータ（目単位）が生成済みの年度しか意味を持たないため、
 * 年度の選択肢はその年度に絞る（API 側が返す availableYears も同じ絞り込み）。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MOFAccountType, MOFBudgetType } from '@/types/mof-jikou';
import {
  MOF_SECTION_RS_COLUMNS,
  type MOFSectionRsColumn,
  type MOFSectionRsData,
  type MOFSectionRsFilterState,
  type MOFSectionRsOffset,
  type MOFSectionRsTopN,
} from '@/types/mof-section-rs-sankey';
import type { LabelDensity } from '@/types/mof-hierarchy';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { SankeyChart, LABEL_FONT_PX_DEFAULT } from '@/client/components/mof-section-rs-sankey/SankeyChart';
import { Controls } from '@/client/components/mof-section-rs-sankey/Controls';
import { HierarchySettings } from '@/client/components/mof-hierarchy/HierarchySettings';
import { useMofBudgetData } from '@/client/components/mof-budget/useMofBudgetData';

type TopNColumn = Exclude<MOFSectionRsColumn, 'total'>;

/**
 * TopN の列と、URL・API のパラメータ名の対応。rsStatus（RS事業）は表示数のみ持ち、
 * 表示位置（オフセット）は持たない（offset[column] が常に undefined のままなので
 * offsetApiKey/offsetUrlKey は無害だが使われない）
 */
const TOP_N_KEYS: Array<{
  column: TopNColumn;
  urlKey: string;
  apiKey: string;
  offsetUrlKey: string;
  offsetApiKey: string;
}> = (MOF_SECTION_RS_COLUMNS.filter(c => c !== 'total') as TopNColumn[]).map(column => ({
  column,
  urlKey: `t${column.slice(0, 2)}`,
  apiKey: `top${column[0].toUpperCase()}${column.slice(1)}`,
  offsetUrlKey: `o${column.slice(0, 2)}`,
  offsetApiKey: `offset${column[0].toUpperCase()}${column.slice(1)}`,
}));

export default function MOFSectionRsSankeyPage() {
  return (
    <Suspense fallback={<CenterMessage text="読み込み中…" />}>
      <MOFSectionRsSankeyContent />
    </Suspense>
  );
}

function CenterMessage({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <p className={error ? 'text-sm text-red-600' : 'text-sm text-gray-500'}>{text}</p>
    </div>
  );
}

function MOFSectionRsSankeyContent() {
  const searchParams = useSearchParams();
  const rawYear = searchParams.get('year');
  const [budgetType, setBudgetType] = useState<MOFBudgetType | null>(
    (searchParams.get('bt') as MOFBudgetType | null) ?? null
  );
  const [topN, setTopN] = useState<MOFSectionRsTopN>(() =>
    Object.fromEntries(TOP_N_KEYS.map(({ column, urlKey }) => [column, Number(searchParams.get(urlKey)) || undefined]))
  );
  const [offset, setOffset] = useState<MOFSectionRsOffset>(() =>
    Object.fromEntries(
      TOP_N_KEYS.map(({ column, offsetUrlKey }) => [column, Number(searchParams.get(offsetUrlKey)) || undefined])
    )
  );
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('sel'));
  const [focusRelated, setFocusRelated] = useState(searchParams.get('fr') === '1');
  const [fontPx, setFontPx] = useState(() => Number(searchParams.get('fs')) || LABEL_FONT_PX_DEFAULT);
  const [labelDensity, setLabelDensity] = useState<LabelDensity>(() => (searchParams.get('ld') === 'major' ? 'major' : 'all'));
  const [filterOpen, setFilterOpen] = useState(searchParams.get('ffp') === '1');
  const [filter, setFilter] = useState<MOFSectionRsFilterState>(() => ({
    ministries: searchParams.getAll('fmi'),
    accountTypes: searchParams
      .getAll('fac')
      .filter((v): v is MOFAccountType => (['general', 'special', 'agency'] as const).includes(v as MOFAccountType)),
    sectionQuery: searchParams.get('fsn') ?? '',
    sectionRegex: searchParams.get('fsnx') === '1',
    minAmountText: searchParams.get('famn') ?? '',
    maxAmountText: searchParams.get('famx') ?? '',
  }));

  const buildUrl = useCallback(
    (target: number | null) => {
      const params = new URLSearchParams();
      if (target) params.set('year', String(target));
      if (budgetType) params.set('budgetType', budgetType);
      for (const { column, apiKey, offsetApiKey } of TOP_N_KEYS) {
        const value = topN[column];
        if (value) params.set(apiKey, String(value));
        const start = column === 'rsStatus' ? undefined : offset[column];
        if (start) params.set(offsetApiKey, String(start));
      }
      for (const m of filter.ministries) params.append('filterMinistry', m);
      for (const a of filter.accountTypes) params.append('filterAccount', a);
      if (filter.sectionQuery.trim()) {
        params.set('filterSection', filter.sectionQuery.trim());
        if (filter.sectionRegex) params.set('filterSectionRegex', '1');
      }
      const minYen = parseAmountToYen(filter.minAmountText);
      if (minYen !== null) params.set('filterMinAmount', String(minYen));
      const maxYen = parseAmountToYen(filter.maxAmountText);
      if (maxYen !== null) params.set('filterMaxAmount', String(maxYen));
      const query = params.toString();
      return `/api/mof-sankey${query ? `?${query}` : ''}`;
    },
    [budgetType, topN, offset, filter]
  );

  const { data, year, loading, error, fetchData } = useMofBudgetData<MOFSectionRsData>(
    buildUrl,
    rawYear ? Number(rawYear) : null
  );

  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams();
    params.set('year', String(data.metadata.fiscalYear));
    params.set('bt', data.metadata.budgetType);
    for (const { column, urlKey, offsetUrlKey } of TOP_N_KEYS) {
      const value = topN[column];
      if (value) params.set(urlKey, String(value));
      const start = column === 'rsStatus' ? undefined : data.metadata.offset[column];
      if (start) params.set(offsetUrlKey, String(start));
    }
    if (selectedId) params.set('sel', selectedId);
    if (focusRelated) params.set('fr', '1');
    if (fontPx !== LABEL_FONT_PX_DEFAULT) params.set('fs', String(fontPx));
    if (labelDensity !== 'all') params.set('ld', labelDensity);
    for (const m of filter.ministries) params.append('fmi', m);
    for (const a of filter.accountTypes) params.append('fac', a);
    if (filter.sectionQuery.trim()) params.set('fsn', filter.sectionQuery.trim());
    if (filter.sectionRegex) params.set('fsnx', '1');
    if (filter.minAmountText.trim()) params.set('famn', filter.minAmountText.trim());
    if (filter.maxAmountText.trim()) params.set('famx', filter.maxAmountText.trim());
    if (filterOpen) params.set('ffp', '1');
    const next = `?${params.toString()}`;
    if (next !== window.location.search) window.history.replaceState(null, '', next);
  }, [data, selectedId, focusRelated, fontPx, labelDensity, topN, filter, filterOpen]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setBudgetType((params.get('bt') as MOFBudgetType | null) ?? null);
      setSelectedId(params.get('sel'));
      setFocusRelated(params.get('fr') === '1');
      setFontPx(Number(params.get('fs')) || LABEL_FONT_PX_DEFAULT);
      setLabelDensity(params.get('ld') === 'major' ? 'major' : 'all');
      setFilter({
        ministries: params.getAll('fmi'),
        accountTypes: params
          .getAll('fac')
          .filter((v): v is MOFAccountType => (['general', 'special', 'agency'] as const).includes(v as MOFAccountType)),
        sectionQuery: params.get('fsn') ?? '',
        sectionRegex: params.get('fsnx') === '1',
        minAmountText: params.get('famn') ?? '',
        maxAmountText: params.get('famx') ?? '',
      });
      setFilterOpen(params.get('ffp') === '1');
      setTopN(Object.fromEntries(TOP_N_KEYS.map(({ column, urlKey }) => [column, Number(params.get(urlKey)) || undefined])));
      setOffset(
        Object.fromEntries(TOP_N_KEYS.map(({ column, offsetUrlKey }) => [column, Number(params.get(offsetUrlKey)) || undefined]))
      );
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

  const accountsLabel = useMemo(
    () => data?.accounts.map(a => `${a.label} ${formatBudgetFromYen(a.amount)}`).join(' / ') ?? '',
    [data]
  );

  if (loading && !data) return <CenterMessage text="読み込み中…" />;
  if (error || !data) {
    return <CenterMessage text={error ? `読み込みに失敗しました: ${error}` : 'データを取得できませんでした'} error />;
  }

  const { metadata } = data;

  return (
    <div className="fixed inset-0 overflow-hidden bg-white">
      <SankeyChart
        nodes={data.sankey.nodes}
        links={data.sankey.links}
        browseNodes={data.browse.nodes}
        browseLinks={data.browse.links}
        ministries={data.metadata.ministries}
        selectedId={selectedId}
        onSelect={selectNode}
        focusRelated={focusRelated}
        filter={filter}
        onFilterChange={setFilter}
        filterOpen={filterOpen}
        onToggleFilterOpen={() => setFilterOpen(v => !v)}
        fontPx={fontPx}
        labelDensity={labelDensity}
        fiscalYear={metadata.fiscalYear}
        budgetType={metadata.budgetType}
        rsYear={metadata.rsYear}
      />

      <div className="absolute right-3 top-3 z-30 flex items-start gap-2">
        <Controls
          topN={topN}
          offset={offset}
          columnCounts={metadata.columnCounts}
          onTopNChange={setTopN}
          onOffsetChange={setOffset}
        />

        <label className="flex h-8 shrink-0 items-center rounded-lg border border-black/10 bg-white/90 px-2 text-xs text-gray-600 shadow-md backdrop-blur">
          <select
            aria-label="予算種別"
            value={metadata.budgetType}
            disabled={loading}
            onChange={e => setBudgetType(e.target.value as MOFBudgetType)}
            className="h-6 cursor-pointer rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {metadata.budgetTypes.map(type => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <HierarchySettings
          fontPx={fontPx}
          onFontPxChange={setFontPx}
          labelDensity={labelDensity}
          onLabelDensityChange={setLabelDensity}
          focusRelated={focusRelated}
          onFocusRelatedChange={setFocusRelated}
          summary={`${metadata.sectionCount.toLocaleString()}項 / ${accountsLabel}${
            metadata.rsYear ? ` / RS${metadata.rsYear}年度データ` : ''
          }`}
        />

        <YearSelect
          value={String(year ?? metadata.fiscalYear)}
          onChange={y => fetchData(Number(y))}
          years={metadata.availableYears}
          theme="light"
        />
        <PageNavMenu current="/mof-sankey" theme="light" />
      </div>
    </div>
  );
}
