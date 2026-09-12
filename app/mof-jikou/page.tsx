'use client';

/**
 * 財務省 予算書「事項」一覧の確認用ビュー。
 *
 * 行政事業レビューのデータとは接続せず、MOF 単独で何が見えるかを確認するためのページ。
 * データは /api/mof-jikou（npm run generate-mof-jikou で生成）。
 * 表の列定義・並べ替え・描画は client/components/mof-jikou/ 側に置き、
 * ここは状態管理・API 呼び出し・レイアウトに限る。
 *
 * フィルタは `/mof-kou`（項一覧）と同じ左サイドパネル構成に揃えている。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { usePersistedState } from '@/client/hooks/usePersistedState';
import { mofArchiveUrl } from '@/app/lib/mof-archive-url';
import { MAJOR_EXPENSE_ORDER, MINISTRY_ORDER, sortBudgetTypes, sortByCodeOrder } from '@/app/lib/mof-classification-order';
import { pruneInvalidSelections } from '@/app/lib/filter-selection';
import type { MOFJikouData, MOFJikouHistory, MOFJikouItem } from '@/types/mof-jikou';
import { changeRate, formatYen } from '@/client/components/mof-jikou/format';
import { JikouTable } from '@/client/components/mof-jikou/JikouTable';
import { FilterSidebar, type FilterDomains, type FilterSidebarState, type NumRange } from '@/client/components/mof-jikou/FilterSidebar';
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
} from '@/client/components/mof-jikou/columns';

const PAGE_SIZE = 100;
const EMPTY_RANGE: NumRange = [null, null];

const INITIAL_FILTERS: FilterSidebarState = {
  account: [],
  budgetType: [],
  ministry: [],
  organization: [],
  subAccount: [],
  majorExpense: [],
  nameQuery: '',
  nameRegex: false,
  keywordQuery: '',
  keywordRegex: false,
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

export default function MOFJikouPage() {
  const [data, setData] = useState<MOFJikouData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 選択中の会計年度。null は「収録済みの最新年度」をAPIに任せる */
  const [year, setYear] = useState<number | null>(null);

  const [filters, setFilters] = useState<FilterSidebarState>(INITIAL_FILTERS);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarWidth, setSidebarWidth] = usePersistedState('mof-jikou:sidebarWidth', SIDEBAR_DEFAULT_WIDTH);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [widths, setWidths] = usePersistedState<Record<string, number>>('mof-jikou:widths', DEFAULT_WIDTHS);
  const [history, setHistory] = useState<MOFJikouHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(year === null ? '/api/mof-jikou' : `/api/mof-jikou?year=${year}`)
      .then(res => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      // ここで setYear すると year が null から数値へ変わって effect が再実行され、
      // 同じ年度をもう一度取りに行ってしまう。選択中の年度は data から読む。
      .then((json: MOFJikouData) => !cancelled && setData(json))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [year]);

  /**
   * 展開した事項の経年推移を取る。
   * 再利用コンポーネントから直接APIを叩かないよう、取得はページ層に置く。
   */
  const expandedKey = data?.items.find(i => i.id === expanded)?.key ?? null;
  useEffect(() => {
    if (!expandedKey) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    fetch(`/api/mof-jikou/history?key=${encodeURIComponent(expandedKey)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`API error: ${res.status}`))))
      .then((json: MOFJikouHistory) => !cancelled && setHistory(json))
      .catch((e: Error) => !cancelled && setHistoryError(e.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [expandedKey]);

  // 年度を変えると収録帳票が変わるので、絞り込みも初期化する
  function changeYear(next: number) {
    setYear(next);
    setData(null);
    setPage(1);
    setFilters(INITIAL_FILTERS);
    setExpanded(null);
  }

  function setFilter<K extends keyof FilterSidebarState>(key: K, value: FilterSidebarState[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  // フィルタ条件が変わったら1ページ目に戻す
  useEffect(() => {
    setPage(1);
  }, [filters]);

  const { account, budgetType, ministry, organization, subAccount, majorExpense } = filters;

  /**
   * 絞り込みの選択肢は上位の条件で連鎖させる。
   * 上位を変えたときに下位の値が残っていると、候補に無い値で0件になるため。
   */
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

  // 上位の絞り込みで選択肢が再計算されるたびに、無効になった選択を落とす
  // （FilterSidebar側での即時プルーンだと1テンポ古い選択肢を参照してしまうため）
  useEffect(() => {
    setFilters(
      prev =>
        pruneInvalidSelections(prev, [
          ['ministry', ministries],
          ['organization', organizations],
          ['subAccount', subAccounts],
          ['majorExpense', majorExpenses],
        ]) ?? prev
    );
  }, [ministries, organizations, subAccounts, majorExpenses]);

  /** 数値スライダーの可動域は年度全体（他の絞り込みの影響を受けない）から求める */
  const domains: FilterDomains = useMemo(() => {
    const rows = data?.items ?? [];
    const rates = rows.map(i => changeRate(i.amount, i.previousAmount)).filter((v): v is number => typeof v === 'number');
    return {
      amount: boundsOf(rows.map(i => i.amount)),
      previousAmount: boundsOf(rows.map(i => i.previousAmount).filter((v): v is number => v !== null)),
      difference: boundsOf(rows.map(i => i.difference).filter((v): v is number => v !== null)),
      rate: boundsOf(rates),
    };
  }, [data]);

  const filtered = useMemo(() => {
    function rateOf(item: MOFJikouItem): number | null {
      const r = changeRate(item.amount, item.previousAmount);
      return typeof r === 'number' ? r : null;
    }
    const rows = scopedRows.filter(item => {
      if (filters.subAccount.length > 0 && !filters.subAccount.includes(item.subAccount)) return false;
      if (filters.majorExpense.length > 0 && !filters.majorExpense.includes(item.majorExpenseName)) return false;
      if (!textMatches(item.name, filters.nameQuery.trim(), filters.nameRegex)) return false;
      const keyword = filters.keywordQuery.trim();
      if (keyword) {
        const haystack = `${item.name}\n${item.sectionName}\n${item.description}\n${item.ministry}\n${orgColumn(item)}`;
        if (!textMatches(haystack, keyword, filters.keywordRegex)) return false;
      }
      if (!inRange(item.amount, filters.amountRange)) return false;
      if (!inRange(item.previousAmount, filters.previousAmountRange)) return false;
      if (!inRange(item.difference, filters.differenceRange)) return false;
      if (!inRange(rateOf(item), filters.rateRange)) return false;
      return true;
    });
    return sortItems(rows, sortKey, sortDir);
  }, [scopedRows, filters, sortKey, sortDir]);

  /**
   * 絞り込み結果の合計。
   * 当初・暫定・補正は同じ予算の別断面で、会計区分をまたぐと会計間の繰入も重なる。
   * 種別や会計が混ざったまま足した数字は意味を持たないので、
   * どちらも1つに絞られているときだけ合計を出す。
   */
  const filteredTotal = useMemo(() => {
    if (filtered.length === 0) return null;
    const budgetTypes = new Set(filtered.map(i => i.budgetType));
    const accountTypes = new Set(filtered.map(i => i.accountType));
    if (budgetTypes.size > 1 || accountTypes.size > 1) return null;
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
    filters.nameQuery !== '',
    filters.keywordQuery !== '',
    filters.amountRange[0] !== null || filters.amountRange[1] !== null,
    filters.previousAmountRange[0] !== null || filters.previousAmountRange[1] !== null,
    filters.differenceRange[0] !== null || filters.differenceRange[1] !== null,
    filters.rateRange[0] !== null || filters.rateRange[1] !== null,
  ].filter(Boolean).length;

  /** ページを送ったら表の先頭に戻す */
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

  function startSidebarResize(event: React.MouseEvent) {
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

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データの読み込みに失敗しました: {error}
          <br />
          <code className="text-xs">npm run generate-mof-jikou</code> で生成してください。
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
            予算書「事項」一覧
          </h1>
          {/* 集計はカードにすると縦を食うので1行に畳む */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <a
              href={mofArchiveUrl(data.metadata.fiscalYear)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              {data.metadata.eraLabel}／財務省 予算書・決算書データベース
            </a>
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            <span>
              全{' '}
              <b className="font-semibold text-neutral-700 dark:text-neutral-300">
                {data.summary.count.toLocaleString()}
              </b>{' '}
              事項
            </span>
            {data.summary.byBudgetType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
            <span className="text-neutral-300 dark:text-neutral-700">|</span>
            {data.summary.byAccountType.map(g => (
              <span key={g.key}>
                {g.key} {g.count.toLocaleString()}件 / {formatYen(g.amount)}
              </span>
            ))}
          </p>
        </div>
        {/* 年度とページ切替。全ページ共通で右上に置く */}
        <div className="flex shrink-0 items-center gap-2">
          <YearSelect
            value={String(data.metadata.fiscalYear)}
            onChange={y => changeYear(Number(y))}
            years={data.metadata.availableYears ?? [data.metadata.fiscalYear]}
          />
          <PageNavMenu current="/mof-jikou" />
        </div>
      </header>

      <section className="shrink-0 px-3 pb-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
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
            {filteredTotal === null ? (
              filtered.length > 0 && (
                <span
                  className="ml-1 text-neutral-400"
                  title="当初・暫定・補正は同じ予算の別断面で、会計区分をまたぐと会計間の繰入も重なります。予算種別と会計区分を1つに絞ると合計を表示します。"
                >
                  （合計は種別・会計が混在のため非表示）
                </span>
              )
            ) : (
              <> / {formatYen(filteredTotal)}</>
            )}
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
        </div>
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

        {/*
          外枠（枠線・角丸）とスクロールする内箱を分ける。ページャを枠内フッタに固定するため、
          枠自体はスクロールさせない。内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。
        */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <JikouTable
              items={pageItems}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              widths={widths}
              onWidthsChange={setWidths}
              expandedId={expanded}
              onToggleExpand={setExpanded}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
            />
          </div>

          {/* ページャは表の枠内フッタ。表とページ番号が離れて見えないようにする */}
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
      </div>

      <div className="shrink-0 px-3 pb-3">
        <details className="text-[11px] text-neutral-500">
          <summary className="cursor-pointer">
            データの読み方と取り込み元（{data.metadata.documents.length}帳票）
          </summary>
          <div className="mt-1 space-y-1 pl-4">
            {data.metadata.notes.map(note => (
              <p key={note}>・{note}</p>
            ))}
            <ul className="mt-1 space-y-0.5">
              {data.metadata.documents.map(doc => (
                <li key={doc.documentId}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-neutral-700"
                  >
                    {doc.documentId} {doc.title}
                  </a>
                  {' — '}
                  {doc.pages} ページ / {doc.count.toLocaleString()} 件
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
