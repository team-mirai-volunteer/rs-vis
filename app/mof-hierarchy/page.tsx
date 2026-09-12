'use client';

/**
 * MOF 事項別内訳の階層サンキー。
 *
 * 予算合計 → 所管 → 組織/特会 → 勘定/業務 → 項 → 事項 の6列で、
 * 国の予算がどの省庁のどの事業まで下りるかを1枚で追えるようにする。
 *
 * 画面構成は `/sankey-svg` を踏襲する。図を全画面（`fixed inset-0`）に敷き、
 * 見出し・コントロール・ズームはその上に浮かせる。ページスクロールは持たず、
 * 図の中をパン・ズームして見る。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MOF_HIERARCHY_COLUMNS,
  type LabelDensity,
  type MOFHierarchyColumn,
  type MOFHierarchyData,
  type MOFHierarchyFilterState,
  type MOFHierarchyOffset,
  type MOFHierarchyTopN,
} from '@/types/mof-hierarchy';
import type { MOFAccountType, MOFBudgetType } from '@/types/mof-jikou';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { HierarchyChart, LABEL_FONT_PX_DEFAULT } from '@/client/components/mof-hierarchy/HierarchyChart';
import { HierarchyControls } from '@/client/components/mof-hierarchy/HierarchyControls';
import { HierarchySettings } from '@/client/components/mof-hierarchy/HierarchySettings';
import { useMofBudgetData } from '@/client/components/mof-budget/useMofBudgetData';

/**
 * TopN の列と、URL・API のパラメータ名の対応。
 * 列を増やしたときに3箇所を直す必要がないよう1本にまとめる。
 */
const TOP_N_KEYS: Array<{
  column: Exclude<MOFHierarchyColumn, 'total'>;
  /** ブラウザの URL に載せる短い名前 */
  urlKey: string;
  /** API に渡す名前 */
  apiKey: string;
  /** 表示開始位置の URL 名 */
  offsetUrlKey: string;
  /** 表示開始位置の API 名 */
  offsetApiKey: string;
}> = MOF_HIERARCHY_COLUMNS.filter(c => c !== 'total').map(column => ({
  column: column as Exclude<MOFHierarchyColumn, 'total'>,
  urlKey: `t${column.slice(0, 2)}`,
  apiKey: `top${column[0].toUpperCase()}${column.slice(1)}`,
  offsetUrlKey: `o${column.slice(0, 2)}`,
  offsetApiKey: `offset${column[0].toUpperCase()}${column.slice(1)}`,
}));

export default function MOFHierarchyPage() {
  return (
    <Suspense fallback={<CenterMessage text="読み込み中…" />}>
      <MOFHierarchyContent />
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

function MOFHierarchyContent() {
  const searchParams = useSearchParams();
  const rawYear = searchParams.get('year');
  const [budgetType, setBudgetType] = useState<MOFBudgetType | null>(
    (searchParams.get('bt') as MOFBudgetType | null) ?? null
  );
  const [topN, setTopN] = useState<MOFHierarchyTopN>(() =>
    Object.fromEntries(
      TOP_N_KEYS.map(({ column, urlKey }) => [
        column,
        Number(searchParams.get(urlKey)) || undefined,
      ])
    )
  );
  const [offset, setOffset] = useState<MOFHierarchyOffset>(() =>
    Object.fromEntries(
      TOP_N_KEYS.map(({ column, offsetUrlKey }) => [
        column,
        Number(searchParams.get(offsetUrlKey)) || undefined,
      ])
    )
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get('sel')
  );
  // /sankey-svg に合わせ既定OFF。ONだと選択のたびに図が絞り込まれ、
  // 隣接の事項を見比べたい探索の邪魔になりやすい
  const [focusRelated, setFocusRelated] = useState(searchParams.get('fr') === '1');
  const [fontPx, setFontPx] = useState(
    () => Number(searchParams.get('fs')) || LABEL_FONT_PX_DEFAULT
  );
  const [labelDensity, setLabelDensity] = useState<LabelDensity>(
    () => (searchParams.get('ld') === 'major' ? 'major' : 'all')
  );
  // /sankey-svg と同じく URL に残す（fp 相当）。フィルタが効いた状態を
  // 共有されたとき、何が効いているか見えないと気付けないため
  const [filterOpen, setFilterOpen] = useState(searchParams.get('ffp') === '1');
  const [filter, setFilter] = useState<MOFHierarchyFilterState>(() => ({
    ministries: searchParams.getAll('fmi'),
    accountTypes: searchParams
      .getAll('fac')
      .filter((v): v is MOFAccountType => (['general', 'special', 'agency'] as const).includes(v as MOFAccountType)),
    sectionQuery: searchParams.get('fsn') ?? '',
    sectionRegex: searchParams.get('fsnx') === '1',
    itemQuery: searchParams.get('fin') ?? '',
    itemRegex: searchParams.get('finx') === '1',
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
        const start = offset[column];
        if (start) params.set(offsetApiKey, String(start));
      }
      for (const m of filter.ministries) params.append('filterMinistry', m);
      for (const a of filter.accountTypes) params.append('filterAccount', a);
      if (filter.sectionQuery.trim()) {
        params.set('filterSection', filter.sectionQuery.trim());
        if (filter.sectionRegex) params.set('filterSectionRegex', '1');
      }
      if (filter.itemQuery.trim()) {
        params.set('filterItem', filter.itemQuery.trim());
        if (filter.itemRegex) params.set('filterItemRegex', '1');
      }
      // 「100億」のような単位付き文字列は API に渡す前に円へ解決する。
      // 解決できない入力（変換中の途中状態）は無条件のまま無視する
      const minYen = parseAmountToYen(filter.minAmountText);
      if (minYen !== null) params.set('filterMinAmount', String(minYen));
      const maxYen = parseAmountToYen(filter.maxAmountText);
      if (maxYen !== null) params.set('filterMaxAmount', String(maxYen));
      const query = params.toString();
      return `/api/mof-hierarchy${query ? `?${query}` : ''}`;
    },
    [budgetType, topN, offset, filter]
  );

  const { data, year, loading, error, fetchData } = useMofBudgetData<MOFHierarchyData>(
    buildUrl,
    rawYear ? Number(rawYear) : null
  );

  /**
   * 表示条件を URL に残す。
   * 見ている状態を共有・再訪できないと、深い階層まで辿った意味が失われる。
   * 履歴を汚さないよう replaceState を使う（/sankey-svg と同じ方針）。
   */
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams();
    params.set('year', String(data.metadata.fiscalYear));
    params.set('bt', data.metadata.budgetType);
    // 表示数は画面で選んでいる値を正とする。
    // 応答（metadata）を待つと、選んだ直後に古い値へ戻って見える
    for (const { column, urlKey, offsetUrlKey } of TOP_N_KEYS) {
      const value = topN[column];
      if (value) params.set(urlKey, String(value));
      // 開始位置は行き過ぎを丸めた後の値（応答）を載せる。
      // 生の値だと、末尾で「次へ」を押し続けたときに URL だけが伸び続ける
      const start = data.metadata.offset[column];
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
    if (filter.itemQuery.trim()) params.set('fin', filter.itemQuery.trim());
    if (filter.itemRegex) params.set('finx', '1');
    if (filter.minAmountText.trim()) params.set('famn', filter.minAmountText.trim());
    if (filter.maxAmountText.trim()) params.set('famx', filter.maxAmountText.trim());
    if (filterOpen) params.set('ffp', '1');
    const next = `?${params.toString()}`;
    if (next !== window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [data, selectedId, focusRelated, fontPx, labelDensity, topN, filter, filterOpen]);

  // ブラウザの戻る／進むで選択を辿れるようにする
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
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
        itemQuery: params.get('fin') ?? '',
        itemRegex: params.get('finx') === '1',
        minAmountText: params.get('famn') ?? '',
        maxAmountText: params.get('famx') ?? '',
      });
      setFilterOpen(params.get('ffp') === '1');
      setTopN(
        Object.fromEntries(
          TOP_N_KEYS.map(({ column, urlKey }) => [
            column,
            Number(params.get(urlKey)) || undefined,
          ])
        )
      );
      setOffset(
        Object.fromEntries(
          TOP_N_KEYS.map(({ column, offsetUrlKey }) => [
            column,
            Number(params.get(offsetUrlKey)) || undefined,
          ])
        )
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * 選択は「辿った操作」なので履歴に積み、戻るで1つ前に戻せるようにする。
   *
   * pushState は state 更新関数の外で呼ぶこと。中に置くと React が更新関数を
   * 2回評価する場面（開発時の StrictMode など）で履歴が二重に積まれ、
   * 1回の「戻る」では戻らなくなる。
   */
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
    () =>
      data?.accounts.map(a => `${a.label} ${formatBudgetFromYen(a.amount)}`).join(' / ') ??
      '',
    [data]
  );

  if (loading && !data) return <CenterMessage text="読み込み中…" />;
  if (error || !data) {
    // data だけが無い場合もここに来る。error が null のまま埋め込むと "null" と出る
    return (
      <CenterMessage
        text={error ? `読み込みに失敗しました: ${error}` : 'データを取得できませんでした'}
        error
      />
    );
  }

  const { metadata } = data;

  return (
    <div className="fixed inset-0 overflow-hidden bg-white">
      {/* 図。全画面に敷き、その上にコントロールを浮かせる */}
      <HierarchyChart
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
      />

      {/* 右上クラスタ: ［表示数/表示位置 - 予算種別 - 表示設定 - 年度 - ページ切替］。
          /sankey-svg の並び（ツール → 表示設定 → 年度 → メニュー）に合わせる */}
      <div className="absolute right-3 top-3 z-30 flex items-start gap-2">
        <HierarchyControls
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
          summary={`${metadata.itemCount.toLocaleString()}事項 / ${accountsLabel}`}
        />

        <YearSelect
          value={String(year ?? metadata.fiscalYear)}
          onChange={y => fetchData(Number(y))}
          years={metadata.availableYears}
          theme="light"
        />
        <PageNavMenu current="/mof-hierarchy" theme="light" />
      </div>
    </div>
  );
}
