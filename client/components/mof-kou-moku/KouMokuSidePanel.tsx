'use client';

/**
 * 目の詳細サイドパネル。行クリックで開く。タブで「年度推移・RS事業」を切り替える。
 * `/mof-kou`（項一覧）の KouSidePanel と同じ構成。
 *
 * データ取得（経年推移）はページ層の責務（client/components/ は API を直接叩かない）。
 * RS事業はページ層が一括取得したリンク集合から、この行ぶんだけを絞って渡してもらう。
 */

import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import type { MOFKouMokuHistory, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { changeRate, executionRate, formatChangeRate, formatRate, formatYen } from '@/client/components/mof-jikou/format';
import { AccountBadge, BudgetTypeBadge } from '@/client/components/mof-kou/Badge';
import { DataGrid, type GridColumn, type GridViewState } from '@/client/components/mof-kou/DataGrid';
import { orgColumn } from './columns';

export type Tab = 'history' | 'rs';

export interface PanelGridStates {
  history: GridViewState;
  rs: GridViewState;
}

/** タブのグリッドのソート/列幅の既定値 */
export function createDefaultPanelGridStates(): PanelGridStates {
  return {
    history: { sortKey: 'year', sortDir: 'asc', widths: {} },
    rs: { sortKey: 'rsAmount', sortDir: 'desc', widths: {} },
  };
}

interface Props {
  row: MOFKouMokuItem;
  onClose: () => void;
  history: MOFKouMokuHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  rsLinks: MofRsKouMokuLinkageRecord[];
  linkageAvailable: boolean;
  linkageRsYear: number | null;
  linkageLoading: boolean;
  linkageError: string | null;
  width: number;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  gridStates: PanelGridStates;
  onGridStateChange: (tab: keyof PanelGridStates, updater: (prev: GridViewState) => GridViewState) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'history', label: '年度推移' },
  { key: 'rs', label: 'RS事業' },
];

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouMokuSidePanel({
  row,
  onClose,
  history,
  historyLoading,
  historyError,
  rsLinks,
  linkageAvailable,
  linkageRsYear,
  linkageLoading,
  linkageError,
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
            <p className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{row.subItemName}</p>
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
          {' ・ '}
          {row.sectionCode} {row.sectionName}
          {row.sourceUrl && (
            <>
              {' ・ '}
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                {row.page !== null ? `出典 p.${row.page}` : '出典'}
              </a>
            </>
          )}
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
            {t.key === 'rs' && ` (${new Set(rsLinks.map(l => l.projectId)).size})`}
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
        {tab === 'rs' && (
          <RsTab
            links={rsLinks}
            linkageAvailable={linkageAvailable}
            linkageRsYear={linkageRsYear}
            loading={linkageLoading}
            error={linkageError}
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
  item: MOFKouMokuItem;
}

function HistoryTab({
  history,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  history: MOFKouMokuHistory | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">推移の取得に失敗しました: {error}</p>;
  if (loading || !history) return <p className="p-3 text-neutral-400">読み込み中…</p>;

  const flatRows: HistoryRow[] = history.years.flatMap(y =>
    y.items.map(item => ({ fiscalYear: y.fiscalYear, eraLabel: y.eraLabel, item }))
  );

  const columns: GridColumn<HistoryRow>[] = [
    {
      key: 'year',
      label: '年度',
      width: 110,
      sortValue: r => r.fiscalYear,
      render: r => `${r.eraLabel}（${r.fiscalYear}）`,
    },
    {
      key: 'budgetType',
      label: '予算種別',
      width: 68,
      sortValue: r => r.item.budgetType,
      render: r => <BudgetTypeBadge budgetType={r.item.budgetType} />,
    },
    {
      key: 'amount',
      label: '本年度額',
      width: 100,
      numeric: true,
      sortValue: r => r.item.amount,
      render: r => <span className="text-neutral-900 dark:text-neutral-100">{formatYen(r.item.amount)}</span>,
    },
    {
      key: 'previousAmount',
      label: '前年度額',
      width: 100,
      numeric: true,
      sortValue: r => r.item.previousAmount,
      render: r => formatYen(r.item.previousAmount),
    },
    {
      key: 'rate',
      label: '増減率',
      width: 80,
      numeric: true,
      sortValue: r => {
        const rate = changeRate(r.item.amount, r.item.previousAmount);
        return rate === null || rate === 'new' ? null : rate;
      },
      render: r => {
        const rate = changeRate(r.item.amount, r.item.previousAmount);
        return <span className={rateClass(rate)}>{formatChangeRate(rate)}</span>;
      },
    },
    {
      key: 'spent',
      label: '支出済',
      width: 100,
      numeric: true,
      sortValue: r => r.item.spent,
      render: r => formatYen(r.item.spent),
    },
    {
      key: 'unused',
      label: '不用額',
      width: 100,
      numeric: true,
      sortValue: r => r.item.unused,
      render: r => formatYen(r.item.unused),
    },
    {
      key: 'executionRate',
      label: '執行率',
      width: 78,
      numeric: true,
      sortValue: r => executionRate(r.item),
      render: r => {
        const exec = executionRate(r.item);
        return (
          <span
            className={
              exec === null
                ? 'text-neutral-400'
                : exec < 0.5
                  ? 'text-red-600 dark:text-red-400'
                  : exec < 0.9
                    ? 'text-amber-700 dark:text-amber-500'
                    : 'text-neutral-600 dark:text-neutral-400'
            }
          >
            {formatRate(exec)}
          </span>
        );
      },
    },
    {
      key: 'section',
      label: '項',
      width: 150,
      sortValue: r => r.item.sectionName,
      render: r => (
        <span className="text-neutral-400">
          {r.item.sectionCode} {r.item.sectionName}
        </span>
      ),
    },
  ];

  return (
    <div>
      <DataGrid
        rows={flatRows}
        columns={columns}
        rowKey={r => `${r.fiscalYear}-${r.item.budgetType}`}
        state={gridState}
        onStateChange={onGridStateChange}
        emptyMessage="推移データがありません。"
      />
      {history.years.length < history.availableYears.length && (
        <p className="px-2 pb-2 pt-1.5 text-[11px] text-neutral-400">
          計上のない年度は行がありません。目名や目分類コードが変わると別の目として扱われるため、実態としては継続でも欠けて見えることがあります。
        </p>
      )}
    </div>
  );
}

function RsTab({
  links,
  linkageAvailable,
  linkageRsYear,
  loading,
  error,
  gridState,
  onGridStateChange,
}: {
  links: MofRsKouMokuLinkageRecord[];
  linkageAvailable: boolean;
  linkageRsYear: number | null;
  loading: boolean;
  error: string | null;
  gridState: GridViewState;
  onGridStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
}) {
  if (error) return <p className="p-3 text-red-600">紐づけの取得に失敗しました: {error}</p>;
  if (loading) return <p className="p-3 text-neutral-400">読み込み中…</p>;
  if (!linkageAvailable) return <p className="p-3 text-neutral-400">この年度は RS 事業との紐づけデータが未生成です。</p>;

  const columns: GridColumn<MofRsKouMokuLinkageRecord>[] = [
    {
      key: 'projectName',
      label: '事業名',
      width: 220,
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
      rows={links}
      columns={columns}
      rowKey={l => `${l.projectId}-${l.kouMokuKey}`}
      state={gridState}
      onStateChange={onGridStateChange}
      emptyMessage="紐づく RS 事業は見つかりませんでした。"
    />
  );
}
