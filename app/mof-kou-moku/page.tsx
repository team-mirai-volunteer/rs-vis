'use client';

/**
 * 財務省 予算書「科目別内訳」（項・目）の確認用ビュー。
 *
 * `/mof-jikou`（事項＝目的別の内訳）と対になる、目＝性質別の内訳。
 * データは /api/mof-kou-moku（npm run generate-mof-kou-moku で生成）。
 * 当初・暫定・補正・決算を収録する（`/mof-jikou` と同じ予算種別の粒度）。
 * ただし RS 事業との紐づけ（自動突合）は一般会計・当初予算のみ対応。
 *
 * フィルタは `/mof-kou`（項一覧）・`/mof-jikou`（事項一覧）と同じ左サイドパネル構成に揃えている。
 * 行クリックの詳細も `/mof-kou` と同じく右のサイドパネル（年度推移・RS事業タブ）に出す
 * （インライン展開はしない）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import { mofArchiveUrl } from '@/app/lib/mof-archive-url';
import {
  ECONOMIC_NATURE_ORDER,
  FISCAL_LAW_ORDER,
  MAJOR_EXPENSE_ORDER,
  MINISTRY_ORDER,
  OBJECTIVE_ORDER,
  PURPOSE_ORDER,
  sortBudgetTypes,
  sortByCodeOrder,
} from '@/app/lib/mof-classification-order';
import { pruneInvalidSelections } from '@/app/lib/filter-selection';
import type { MOFKouMokuData, MOFKouMokuHistory, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord, MofRsKouMokuLinkageResponse } from '@/types/mof-rs-kou-moku-linkage';
import { changeRate, formatYen } from '@/client/components/mof-jikou/format';
import { KouMokuTable } from '@/client/components/mof-kou-moku/KouMokuTable';
import {
  KouMokuSidePanel,
  createDefaultPanelGridStates,
  type PanelGridStates,
  type Tab,
} from '@/client/components/mof-kou-moku/KouMokuSidePanel';
import type { GridViewState } from '@/client/components/mof-kou/DataGrid';
import { FilterSidebar, type FilterDomains, type FilterSidebarState, type NumRange } from '@/client/components/mof-kou-moku/FilterSidebar';
import { textMatches } from '@/client/components/mof-kou/RegexTextFilter';
import {
  ACCOUNT_LABEL,
  COLUMNS,
  DEFAULT_WIDTHS,
  defaultDirFor,
  orgColumn,
  sortItems,
  type ColumnSpec,
  type SortDir,
  type SortKey,
} from '@/client/components/mof-kou-moku/columns';

const PAGE_SIZE = 100;
const EMPTY_RANGE: NumRange = [null, null];

const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 900;

const INITIAL_FILTERS: FilterSidebarState = {
  account: [],
  budgetType: [],
  ministry: [],
  organization: [],
  subAccount: [],
  majorExpense: [],
  purpose: [],
  objective: [],
  fiscalLaw: [],
  economicNature: [],
  sectionNameQuery: '',
  sectionNameRegex: false,
  itemNameQuery: '',
  itemNameRegex: false,
  rsCountRange: EMPTY_RANGE,
  amountRange: EMPTY_RANGE,
  previousAmountRange: EMPTY_RANGE,
  differenceRange: EMPTY_RANGE,
  rateRange: EMPTY_RANGE,
};

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256;

function inRange(value: number | null, range: NumRange): boolean {
  const [min, max] = range;
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function boundsOf(values: number[]): [number, number] {
  return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
}

export default function MOFKouMokuPage() {
  const [data, setData] = useState<MOFKouMokuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 選択中の会計年度。null は「収録済みの最新年度」をAPIに任せる */
  const [year, setYear] = useState<number | null>(null);

  const [filters, setFilters] = useState<FilterSidebarState>(INITIAL_FILTERS);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarWidth, setSidebarWidth] = usePersistedState('mof-kou-moku:sidebarWidth', SIDEBAR_DEFAULT_WIDTH);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = usePersistedState('mof-kou-moku:panelWidth', 420);
  const [panelTab, setPanelTab] = usePersistedState<Tab>('mof-kou-moku:panelTab', 'history');
  const [panelGridStates, setPanelGridStates] = usePersistedState<PanelGridStates>(
    'mof-kou-moku:panelGridStates',
    createDefaultPanelGridStates()
  );
  const [widths, setWidths] = usePersistedState<Record<string, number>>('mof-kou-moku:widths', DEFAULT_WIDTHS);
  const [history, setHistory] = useState<MOFKouMokuHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [linkageLinks, setLinkageLinks] = useState<MofRsKouMokuLinkageRecord[] | null>(null);
  const [linkageAvailable, setLinkageAvailable] = useState(false);
  const [linkageRsYear, setLinkageRsYear] = useState<number | null>(null);
  const [linkageLoading, setLinkageLoading] = useState(false);
  const [linkageError, setLinkageError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(year === null ? '/api/mof-kou-moku' : `/api/mof-kou-moku?year=${year}`)
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((json: MOFKouMokuData) => !cancelled && setData(json))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [year]);

  function changeYear(next: number) {
    setYear(next);
    setData(null);
    setPage(1);
    setSelected(null);
  }

  function setFilter<K extends keyof FilterSidebarState>(key: K, value: FilterSidebarState[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function updatePanelGridState(tab: keyof PanelGridStates, updater: (prev: GridViewState) => GridViewState) {
    setPanelGridStates(prev => ({ ...prev, [tab]: updater(prev[tab]) }));
  }

  /**
   * 選択中の目の経年推移を取る。
   * 再利用コンポーネントから直接APIを叩かないよう、取得はページ層に置く。
   */
  const selectedKey = data?.items.find(i => i.id === selected)?.key ?? null;
  useEffect(() => {
    if (!selectedKey) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    fetch(`/api/mof-kou-moku/history?key=${encodeURIComponent(selectedKey)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: MOFKouMokuHistory) => !cancelled && setHistory(json))
      .catch((e: Error) => !cancelled && setHistoryError(e.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  /**
   * その年度の RS 事業との紐づけを一括で取る（完全一致キーによる自動突合。
   * v1は一般会計・当初予算のみ対応）。一覧の列表示・詳細パネルの両方をクライアント側の
   * Map で賄う（1回のフェッチで済ませる）。
   */
  const linkageYear = data?.metadata.fiscalYear ?? null;
  useEffect(() => {
    if (linkageYear === null) {
      setLinkageLinks(null);
      setLinkageAvailable(false);
      setLinkageRsYear(null);
      setLinkageError(null);
      setLinkageLoading(false);
      return;
    }
    let cancelled = false;
    setLinkageLinks(null);
    setLinkageAvailable(false);
    setLinkageRsYear(null);
    setLinkageError(null);
    setLinkageLoading(true);
    fetch(`/api/mof-kou-moku/linkage?year=${linkageYear}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then(
        (json: MofRsKouMokuLinkageResponse) => {
          if (cancelled) return;
          setLinkageAvailable(json.available);
          setLinkageRsYear(json.rsYear);
          setLinkageLinks(json.links);
        }
      )
      .catch((e: Error) => !cancelled && setLinkageError(e.message))
      .finally(() => !cancelled && setLinkageLoading(false));
    return () => {
      cancelled = true;
    };
  }, [linkageYear]);

  /** kouMokuKey → その目に紐づくRS事業のリスト。列表示・詳細パネルの両方から引く */
  const linkageByKey = useMemo(() => {
    const map = new Map<string, MofRsKouMokuLinkageRecord[]>();
    for (const link of linkageLinks ?? []) {
      const list = map.get(link.kouMokuKey) ?? [];
      list.push(link);
      map.set(link.kouMokuKey, list);
    }
    return map;
  }, [linkageLinks]);

  const { account, budgetType, ministry, organization, subAccount, majorExpense, purpose, objective, fiscalLaw, economicNature } = filters;

  const baseRows = useMemo(() => {
    if (!data) return [];
    return data.items.filter(i => {
      if (account.length > 0 && !account.includes(ACCOUNT_LABEL[i.accountType])) return false;
      if (budgetType.length > 0 && !budgetType.includes(i.budgetType)) return false;
      return true;
    });
  }, [data, account, budgetType]);

  const ministries = useMemo(
    () => sortByCodeOrder([...new Set(baseRows.map(i => i.ministry || i.agency).filter(Boolean))], MINISTRY_ORDER),
    [baseRows]
  );

  const organizations = useMemo(
    () =>
      [
        ...new Set(
          baseRows.filter(i => ministry.length === 0 || ministry.includes(i.ministry || i.agency)).map(orgColumn).filter(Boolean)
        ),
      ].sort(),
    [baseRows, ministry]
  );

  const scopedRows = useMemo(
    () =>
      baseRows
        .filter(i => ministry.length === 0 || ministry.includes(i.ministry || i.agency))
        .filter(i => organization.length === 0 || organization.includes(orgColumn(i))),
    [baseRows, ministry, organization]
  );

  const subAccounts = useMemo(
    () => [...new Set(scopedRows.map(i => i.subAccount).filter(Boolean))].sort(),
    [scopedRows]
  );

  const majorExpenses = useMemo(
    () =>
      sortByCodeOrder(
        [...new Set(scopedRows.filter(i => subAccount.length === 0 || subAccount.includes(i.subAccount)).map(i => i.majorExpenseName).filter(Boolean))],
        MAJOR_EXPENSE_ORDER
      ),
    [scopedRows, subAccount]
  );

  const purposes = useMemo(
    () => sortByCodeOrder([...new Set(scopedRows.map(i => i.purposeName).filter(Boolean))], PURPOSE_ORDER),
    [scopedRows]
  );

  const objectives = useMemo(
    () => sortByCodeOrder([...new Set(scopedRows.map(i => i.objectiveName).filter(Boolean))], OBJECTIVE_ORDER),
    [scopedRows]
  );

  const fiscalLaws = useMemo(
    () => sortByCodeOrder([...new Set(scopedRows.map(i => i.fiscalLawName).filter(Boolean))], FISCAL_LAW_ORDER),
    [scopedRows]
  );

  const economicNatures = useMemo(
    () => sortByCodeOrder([...new Set(scopedRows.map(i => i.economicNatureName).filter(Boolean))], ECONOMIC_NATURE_ORDER),
    [scopedRows]
  );

  // 上位の絞り込みで選択肢が再計算されるたびに、無効になった選択を落とす
  // （FilterSidebar側での即時プルーンだと1テンポ古い選択肢を参照してしまうため）。
  // 年度切り替え直後はdataが一瞬nullになり選択肢が空になるため、その間はプルーンしない
  // （フィルタを年度をまたいで保持するため。空のまま実行すると全選択が誤って落ちる）
  useEffect(() => {
    if (!data) return;
    setFilters(
      prev =>
        pruneInvalidSelections(prev, [
          ['ministry', ministries],
          ['organization', organizations],
          ['subAccount', subAccounts],
          ['majorExpense', majorExpenses],
          ['purpose', purposes],
          ['objective', objectives],
          ['fiscalLaw', fiscalLaws],
          ['economicNature', economicNatures],
        ]) ?? prev
    );
  }, [data, ministries, organizations, subAccounts, majorExpenses, purposes, objectives, fiscalLaws, economicNatures]);

  /** その目に紐づくRS事業数（事業IDの重複除去件数） */
  function rsCountOf(item: MOFKouMokuItem): number {
    return new Set((linkageByKey.get(item.key) ?? []).map(l => l.projectId)).size;
  }

  /** 数値スライダーの可動域は年度全体（他の絞り込みの影響を受けない）から求める */
  const domains: FilterDomains = useMemo(() => {
    const rows = data?.items ?? [];
    const rates = rows.map(i => changeRate(i.amount, i.previousAmount)).filter((v): v is number => typeof v === 'number');
    return {
      rsCount: boundsOf(rows.map(i => rsCountOf(i))),
      amount: boundsOf(rows.map(i => i.amount)),
      previousAmount: boundsOf(rows.map(i => i.previousAmount).filter((v): v is number => v !== null)),
      difference: boundsOf(rows.map(i => i.difference).filter((v): v is number => v !== null)),
      rate: boundsOf(rates),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, linkageByKey]);

  const filtered = useMemo(() => {
    function rateOf(item: MOFKouMokuItem): number | null {
      const r = changeRate(item.amount, item.previousAmount);
      return typeof r === 'number' ? r : null;
    }
    const rows = scopedRows.filter(item => {
      if (filters.subAccount.length > 0 && !filters.subAccount.includes(item.subAccount)) return false;
      if (filters.majorExpense.length > 0 && !filters.majorExpense.includes(item.majorExpenseName)) return false;
      if (filters.purpose.length > 0 && !filters.purpose.includes(item.purposeName)) return false;
      if (filters.objective.length > 0 && !filters.objective.includes(item.objectiveName)) return false;
      if (filters.fiscalLaw.length > 0 && !filters.fiscalLaw.includes(item.fiscalLawName)) return false;
      if (filters.economicNature.length > 0 && !filters.economicNature.includes(item.economicNatureName)) return false;
      if (!textMatches(item.sectionName, filters.sectionNameQuery.trim(), filters.sectionNameRegex)) return false;
      if (!textMatches(item.subItemName, filters.itemNameQuery.trim(), filters.itemNameRegex)) return false;
      if (!inRange(rsCountOf(item), filters.rsCountRange)) return false;
      if (!inRange(item.amount, filters.amountRange)) return false;
      if (!inRange(item.previousAmount, filters.previousAmountRange)) return false;
      if (!inRange(item.difference, filters.differenceRange)) return false;
      if (!inRange(rateOf(item), filters.rateRange)) return false;
      return true;
    });
    if (sortKey === 'rs') {
      const factor = sortDir === 'asc' ? 1 : -1;
      return rows.sort((a, b) => (rsCountOf(a) - rsCountOf(b)) * factor);
    }
    return sortItems(rows, sortKey, sortDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows, filters, sortKey, sortDir, linkageByKey]);

  /** 絞り込み結果の合計 */
  const filteredTotal = useMemo(() => {
    if (filtered.length === 0) return null;
    return filtered.reduce((sum, i) => sum + i.amount, 0);
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const widthsChanged = COLUMNS.some(c => (widths[c.key] ?? c.width) !== c.width);
  const activeFilterCount = [
    account.length > 0,
    budgetType.length > 0,
    ministry.length > 0,
    organization.length > 0,
    subAccount.length > 0,
    majorExpense.length > 0,
    purpose.length > 0,
    objective.length > 0,
    fiscalLaw.length > 0,
    economicNature.length > 0,
    filters.sectionNameQuery !== '',
    filters.itemNameQuery !== '',
    filters.rsCountRange[0] !== null || filters.rsCountRange[1] !== null,
    filters.amountRange[0] !== null || filters.amountRange[1] !== null,
    filters.previousAmountRange[0] !== null || filters.previousAmountRange[1] !== null,
    filters.differenceRange[0] !== null || filters.differenceRange[1] !== null,
    filters.rateRange[0] !== null || filters.rateRange[1] !== null,
  ].filter(Boolean).length;

  function goToPage(next: number) {
    setPage(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function toggleSort(column: ColumnSpec) {
    if (sortKey === column.key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column.key);
      setSortDir(defaultDirFor(column));
    }
    goToPage(1);
  }

  function startSidebarResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (e.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function startPanelResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (e: MouseEvent) => {
      // パネルは画面右側に置くため、ハンドルを左へ引くほど広がる
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth - (e.clientX - startX)));
      setPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  const selectedRow = selected ? (filtered.find(r => r.id === selected) ?? data?.items.find(r => r.id === selected)) : undefined;
  const rsLinksForSelected = selectedRow ? (linkageByKey.get(selectedRow.key) ?? []) : [];

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データの読み込みに失敗しました: {error}
          <br />
          <code className="text-xs">npm run generate-mof-kou-moku</code> で生成してください。
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-neutral-500">読み込み中…</p>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex shrink-0 items-start justify-between gap-4 px-3 pb-2 pt-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            予算書「科目別内訳」（項・目）一覧
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <a
              href={mofArchiveUrl(data.metadata.fiscalYear)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              {data.metadata.eraLabel}／財務省 予算書データベース
            </a>
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            <span>
              全{' '}
              <b className="font-semibold text-neutral-700 dark:text-neutral-300">
                {data.summary.count.toLocaleString()}
              </b>{' '}
              目
            </span>
            {data.summary.byBudgetType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            {data.summary.byAccountType.map(g => (
              <span key={g.key}>
                {g.key === 'general' ? '一般会計' : g.key === 'special' ? '特別会計' : '政府関係機関'}{' '}
                {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect
            value={String(data.metadata.fiscalYear)}
            onChange={y => changeYear(Number(y))}
            years={data.metadata.availableYears ?? [data.metadata.fiscalYear]}
          />
          <PageNavMenu current="/mof-kou-moku" />
        </div>
      </header>

      <section className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          aria-expanded={showFilters}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
            showFilters || activeFilterCount > 0
              ? 'border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900'
              : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3h12M4 8h8M6.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          フィルタ
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 text-[10px]">{activeFilterCount}</span>
          )}
        </button>

        <span className="whitespace-nowrap text-neutral-500">
          該当 {filtered.length.toLocaleString()} 件
          {filteredTotal !== null && <> / {formatYen(filteredTotal)}</>}
        </span>

        {widthsChanged && (
          <button
            type="button"
            onClick={() => setWidths(DEFAULT_WIDTHS)}
            className="whitespace-nowrap rounded border border-neutral-300 px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            列幅をリセット
          </button>
        )}
      </section>

      <div className="flex min-h-0 flex-1 px-3 pb-3">
        {showFilters && (
          <>
            <FilterSidebar
              state={filters}
              onChange={setFilter}
              budgetTypes={sortBudgetTypes(data.metadata.budgetTypes)}
              ministries={ministries}
              organizations={organizations}
              subAccounts={subAccounts}
              majorExpenses={majorExpenses}
              purposes={purposes}
              objectives={objectives}
              fiscalLaws={fiscalLaws}
              economicNatures={economicNatures}
              domains={domains}
              activeCount={activeFilterCount}
              onReset={() => setFilters(INITIAL_FILTERS)}
              width={sidebarWidth}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="フィルタパネルの幅を変更"
              onMouseDown={startSidebarResize}
              className="flex w-3 shrink-0 cursor-col-resize items-stretch justify-center"
            >
              <div className="w-1 rounded-full transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700" />
            </div>
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <KouMokuTable
              items={pageItems}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              widths={widths}
              onWidthsChange={setWidths}
              selectedId={selected}
              onSelectRow={id => setSelected(cur => (cur === id ? null : id))}
              linkageByKey={linkageByKey}
            />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
            <button
              type="button"
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              前へ
            </button>
            <span className="font-mono text-xs text-neutral-500">
              {page} / {totalPages}
              <span className="ml-2 text-neutral-400">
                {filtered.length === 0
                  ? '0 件'
                  : `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} 件目`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              次へ
            </button>
          </div>
        </div>

        {selectedRow && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="詳細パネルの幅を変更"
              onMouseDown={startPanelResize}
              className="flex w-3 shrink-0 cursor-col-resize items-stretch justify-center"
            >
              <div className="w-1 rounded-full transition-colors hover:bg-neutral-300 dark:hover:bg-neutral-700" />
            </div>
            <KouMokuSidePanel
              row={selectedRow}
              onClose={() => setSelected(null)}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              rsLinks={rsLinksForSelected}
              linkageAvailable={linkageAvailable}
              linkageRsYear={linkageRsYear}
              linkageLoading={linkageLoading}
              linkageError={linkageError}
              width={panelWidth}
              tab={panelTab}
              onTabChange={setPanelTab}
              gridStates={panelGridStates}
              onGridStateChange={updatePanelGridState}
            />
          </>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3">
        <details className="text-[11px] text-neutral-500">
          <summary className="cursor-pointer">データの読み方（{data.metadata.documents.length}帳票）</summary>
          <div className="mt-1 space-y-1 pl-4">
            {data.metadata.notes.map(note => (
              <p key={note}>・{note}</p>
            ))}
            <ul className="mt-1 space-y-0.5">
              {data.metadata.documents.map(doc => (
                <li key={`${doc.accountType}-${doc.budgetType}`}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-neutral-700"
                  >
                    {doc.title}
                  </a>
                  {' — '}
                  {doc.count.toLocaleString()} 件
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
