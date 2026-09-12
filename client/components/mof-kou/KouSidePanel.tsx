'use client';

/**
 * 項の詳細サイドパネル。行クリックで開く。タブで「年度推移・事項・目・RS」を切り替える。
 * 各タブの一覧は列見出し付きのグリッド（DataGrid）で表示する。
 * データ取得（詳細・経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 *
 * タブの選択状態・各タブのグリッドのソート/列幅は、ページ層（app/mof-kou/page.tsx）が
 * controlled で持つ。年度切替時は一瞬 selectedRow が無くなりこのコンポーネント自体が
 * アンマウントされるため、このコンポーネント内部のuseStateに置くと毎回リセットされてしまう。
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouSectionDetail, MOFKouSectionHistory, MOFKouSectionSummary } from '@/types/mof-kou';
import type { MOFJikouItem } from '@/types/mof-jikou';
import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { changeRate, formatChangeRate, formatYen } from '@/client/components/mof-jikou/format';
import { AccountBadge, BudgetTypeBadge } from './Badge';
import { orgColumn } from './columns';
import { DataGrid, type GridColumn, type GridViewState } from './DataGrid';

export type Tab = 'history' | 'jikou' | 'koumoku' | 'rs';

export interface PanelGridStates {
  history: GridViewState;
  jikou: GridViewState;
  koumoku: GridViewState;
  rs: GridViewState;
}

/** タブ・各グリッドのソート/列幅の既定値 */
export function createDefaultPanelGridStates(): PanelGridStates {
  return {
    history: { sortKey: 'year', sortDir: 'asc', widths: {} },
    jikou: { sortKey: 'amount', sortDir: 'desc', widths: {} },
    koumoku: { sortKey: 'amount', sortDir: 'desc', widths: {} },
    rs: { sortKey: 'rsAmount', sortDir: 'desc', widths: {} },
  };
}

interface Props {
  row: MOFKouSectionSummary;
  /** 項単位サンキー（/mof-kou/[id]）へのリンクに使う会計年度 */
  fiscalYear: number;
  onClose: () => void;
  detail: MOFKouSectionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  history: MOFKouSectionHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  linkageRsYear: number | null;
  width: number;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  gridStates: PanelGridStates;
  onGridStateChange: (tab: Tab, updater: (prev: GridViewState) => GridViewState) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'history', label: '年度推移' },
  { key: 'jikou', label: '事項' },
  { key: 'koumoku', label: '目' },
  { key: 'rs', label: 'RS' },
];

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouSidePanel({
  row,
  fiscalYear,
  onClose,
  detail,
  detailLoading,
  detailError,
  history,
  historyLoading,
  historyError,
  linkageRsYear,
  width,
  tab,
  onTabChange,
  gridStates,
  onGridStateChange,
}: Props) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-xs dark:border-neutral-800 dark:bg-neutral-950"
      style={{ width }}
    >
      <div className="shrink-0 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.sectionName}</p>
            <BudgetTypeBadge budgetType={row.budgetType} />
            <AccountBadge accountType={row.accountType} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        <p className="mt-1 truncate text-xs text-neutral-500">
          {row.ministry || '—'} ・ {orgColumn(row) || '—'}
          {row.subAccount ? ` ・ ${row.subAccount}` : ''}
          {row.page !== null && (
            <>
              {' ・ '}
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                出典 p.{row.page}
              </a>
            </>
          )}
          {' ・ '}
          <Link
            href={`/mof-kou/${encodeURIComponent(row.id)}?year=${fiscalYear}`}
            className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            サンキーで見る
          </Link>
        </p>

        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatYen(row.amount)}</span>
          <span className="text-xs text-neutral-500">前年度 {formatYen(row.previousAmount)}</span>
          <span className={`text-xs font-medium ${rateClass(changeRate(row.amount, row.previousAmount))}`}>
            {formatChangeRate(changeRate(row.amount, row.previousAmount))}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 border-b border-neutral-200 text-xs dark:border-neutral-800">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTabChange(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex-1 px-2 py-1.5 font-medium ${
              tab === t.key
                ? 'border-b-2 border-neutral-800 text-neutral-900 dark:border-neutral-200 dark:text-neutral-100'
                : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            {t.label}
            {t.key === 'jikou' && ` (${row.jikouCount})`}
            {t.key === 'koumoku' && ` (${row.kouMokuCount})`}
            {t.key === 'rs' && ` (${row.rsProjectCount})`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto text-xs">
        {tab === 'history' && (
          <HistoryTab
            history={history}
            loading={historyLoading}
            error={historyError}
            gridState={gridStates.history}
            onGridStateChange={updater => onGridStateChange('history', updater)}
          />
        )}
        {tab === 'jikou' && (
          <JikouTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            gridState={gridStates.jikou}
            onGridStateChange={updater => onGridStateChange('jikou', updater)}
          />
        )}
        {tab === 'koumoku' && (
          <KouMokuTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            gridState={gridStates.koumoku}
            onGridStateChange={updater => onGridStateChange('koumoku', updater)}
          />
        )}
        {tab === 'rs' && (
          <RsTab
            detail={detail}
            loading={detailLoading}
            error={detailError}
            linkageRsYear={linkageRsYear}
            gridState={gridStates.rs}
            onGridStateChange={updater => onGridStateChange('rs', updater)}
          />
        )}
      </div>
    </aside>
  );
}

interface HistoryRow {
  fiscalYear: number;
  eraLabel: string;
  row: MOFKouSectionSummary;
}

function HistoryTab({
  history,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  history: MOFKouSectionHistory | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const flatRows: HistoryRow[] = history.years.flatMap(y =>
    y.rows.map(r => ({ fiscalYear: y.fiscalYear, eraLabel: y.eraLabel, row: r }))
  );

  const columns: GridColumn<HistoryRow>[] = [
    {
      key: 'year',
      label: '年度',
      width: 130,
      sortValue: r => r.fiscalYear,
      render: r => `${r.eraLabel}（${r.fiscalYear}）`,
    },
    {
      key: 'budgetType',
      label: '予算種別',
      width: 68,
      sortValue: r => r.row.budgetType,
      render: r => <BudgetTypeBadge budgetType={r.row.budgetType} />,
    },
    {
      key: 'jikou',
      label: '事項',
      width: 56,
      numeric: true,
      sortValue: r => r.row.jikouCount,
      render: r => r.row.jikouCount,
    },
    {
      key: 'koumoku',
      label: '目',
      width: 56,
      numeric: true,
      sortValue: r => r.row.kouMokuCount,
      render: r => r.row.kouMokuCount,
    },
    {
      key: 'rs',
      label: 'RS',
      width: 56,
      numeric: true,
      sortValue: r => r.row.rsProjectCount,
      render: r => r.row.rsProjectCount || '—',
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: r => r.row.amount,
      render: r => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(r.row.amount)}</span>,
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: r => {
        const rate = changeRate(r.row.amount, r.row.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: r => {
        const rate = changeRate(r.row.amount, r.row.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <div>
      <DataGrid
        rows={flatRows}
        columns={columns}
        rowKey={r => `${r.fiscalYear}-${r.row.budgetType}`}
        state={gridState}
        onStateChange={onGridStateChange}
        emptyMessage="推移データがありません。"
      />
      {history.years.length < history.availableYears.length && (
        <p className="px-2 pb-2 pt-1.5 text-[11px] text-neutral-400">
          計上のない年度は行がありません。所管表記の変更や項コードの振り直しがあると、実態としては継続でも別の項として扱われ欠けて見えることがあります。
        </p>
      )}
    </div>
  );
}

function JikouTab({
  detail,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  const [descriptionItem, setDescriptionItem] = useState<MOFJikouItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ダイアログを開いたらフォーカスを中に移し、Tabで背後の一覧へ抜けないよう閉じ込める。
  // 閉じたら開く前にフォーカスしていた要素（説明アイコン）へ戻す。
  useEffect(() => {
    if (!descriptionItem) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDescriptionItem(null);
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [descriptionItem]);

  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const columns: GridColumn<MOFJikouItem>[] = [
    {
      key: 'name',
      label: '事項名',
      width: 200,
      sortValue: it => it.name,
      render: it => (
        <span className="flex w-full min-w-0 items-center gap-1">
          <a
            href={it.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {it.name}
          </a>
          {it.description && (
            <button
              type="button"
              aria-label={`${it.name} の説明を表示`}
              title="説明を表示"
              onClick={e => {
                e.stopPropagation();
                setDescriptionItem(it);
              }}
              className="ml-auto shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <svg width="14" height="14" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
                <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
              </svg>
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'majorExpense',
      label: '主要経費',
      width: 110,
      sortValue: it => it.majorExpenseName,
      render: it => it.majorExpenseName || '—',
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.amount,
      render: it => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(it.amount)}</span>,
    },
    {
      key: 'previousAmount',
      label: '前年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.previousAmount,
      render: it => formatYen(it.previousAmount),
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <>
      <DataGrid
        rows={detail.jikouItems}
        columns={columns}
        rowKey={it => it.id}
        state={gridState}
        onStateChange={onGridStateChange}
        emptyMessage="この項に事項はありません。"
      />
      {descriptionItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDescriptionItem(null)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${descriptionItem.name} の説明`}
            tabIndex={-1}
            className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-2xl outline-none dark:bg-neutral-900"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{descriptionItem.name}</h3>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setDescriptionItem(null)}
                className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ×
              </button>
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
              {descriptionItem.description}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function KouMokuTab({
  detail,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const rsByKouMokuKey = new Map<string, MofRsKouMokuLinkageRecord[]>();
  for (const l of detail.rsLinks) {
    const list = rsByKouMokuKey.get(l.kouMokuKey) ?? [];
    list.push(l);
    rsByKouMokuKey.set(l.kouMokuKey, list);
  }

  const columns: GridColumn<MOFKouMokuItem>[] = [
    {
      key: 'name',
      label: '目名',
      width: 190,
      sortValue: it => it.subItemName,
      render: it =>
        it.sourceUrl ? (
          <a
            href={it.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {it.subItemName}
          </a>
        ) : (
          <span title="出典ページ不明">{it.subItemName}</span>
        ),
    },
    {
      key: 'majorExpense',
      label: '主要経費',
      width: 110,
      sortValue: it => it.majorExpenseName,
      render: it => it.majorExpenseName || '—',
    },
    {
      key: 'purpose',
      label: '使途別',
      width: 100,
      sortValue: it => it.purposeName,
      render: it => it.purposeName || '—',
    },
    {
      key: 'rs',
      label: 'RS',
      width: 60,
      numeric: true,
      sortValue: it => new Set((rsByKouMokuKey.get(it.key) ?? []).map(l => l.projectId)).size,
      render: it => {
        const links = rsByKouMokuKey.get(it.key) ?? [];
        const count = new Set(links.map(l => l.projectId)).size;
        return (
          <span
            className={count > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-300 dark:text-neutral-700'}
            title={links.map(l => l.projectName).join('\n') || undefined}
          >
            {count || '—'}
          </span>
        );
      },
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.amount,
      render: it => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(it.amount)}</span>,
    },
    {
      key: 'previousAmount',
      label: '前年度額',
      width: 100,
      numeric: true,
      sortValue: it => it.previousAmount,
      render: it => formatYen(it.previousAmount),
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: it => {
        const rate = changeRate(it.amount, it.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
  ];

  return (
    <DataGrid
      rows={detail.kouMokuItems}
      columns={columns}
      rowKey={it => it.id}
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="この項に目はありません。"
    />
  );
}

function RsTab({
  detail,
  loading,
  error,
  linkageRsYear,
  gridState,
  onGridStateChange,
}: {
  detail: MOFKouSectionDetail | null;
  loading: boolean;
  error: string | null;
  linkageRsYear: number | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">取得に失敗しました: {error}</p>;
  if (loading || !detail) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const columns: GridColumn<MofRsKouMokuLinkageRecord>[] = [
    {
      key: 'projectName',
      label: '事業名',
      width: 200,
      sortValue: l => l.projectName,
      render: l =>
        linkageRsYear !== null ? (
          <a
            href={sankeySvgProjectUrl(l.projectId, l.projectName, linkageRsYear)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-700 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
          >
            {l.projectName}
          </a>
        ) : (
          l.projectName
        ),
    },
    { key: 'projectMinistry', label: '府省庁', width: 110, sortValue: l => l.projectMinistry, render: l => l.projectMinistry },
    { key: 'subItemName', label: '目名', width: 150, sortValue: l => l.subItemName, render: l => l.subItemName },
    {
      key: 'rsAmount',
      label: 'RS計上額',
      width: 100,
      numeric: true,
      sortValue: l => l.rsAmount,
      render: l => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(l.rsAmount)}</span>,
    },
    {
      key: 'carriedOverFrom',
      label: '引継ぎ',
      width: 110,
      sortValue: l => l.carriedOverFrom ?? '',
      render: l => l.carriedOverFrom || '—',
    },
  ];

  return (
    <DataGrid
      rows={detail.rsLinks}
      columns={columns}
      rowKey={l => `${l.projectId}-${l.kouMokuKey}`}
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="紐づく RS 事業は見つかりませんでした。"
    />
  );
}
