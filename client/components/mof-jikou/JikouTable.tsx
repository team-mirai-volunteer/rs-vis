'use client';

/**
 * 事項一覧の表。並べ替え・列幅リサイズ・行の詳細展開を持つ。
 * データの絞り込みとページングは呼び出し側の責務で、ここは描画に専念する。
 */

import { Fragment } from 'react';
import type { MOFJikouHistory, MOFJikouItem } from '@/types/mof-jikou';
import { AccountBadge, BudgetTypeBadge } from '@/client/components/mof-kou/Badge';
import { JikouHistory } from './JikouHistory';
import { changeRate, executionRate, formatChangeRate, formatRate, formatYen } from './format';
import { COLUMNS, DEFAULT_WIDTHS, MIN_COLUMN_WIDTH, orgColumn, type ColumnSpec, type SortDir, type SortKey } from './columns';

interface Props {
  /** 表示するページ分の事項 */
  items: MOFJikouItem[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (column: ColumnSpec) => void;
  widths: Record<string, number>;
  onWidthsChange: (next: Record<string, number>) => void;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  /** 展開中の行の経年推移。取得はページ層の責務 */
  history: MOFJikouHistory | null;
  historyLoading: boolean;
  historyError: string | null;
  /** 絞り込み結果が0件のときに表の中へ出す文言 */
  emptyMessage?: string;
}

/** 増減率の色分け。null（比較欄なし）と新規計上を区別する */
function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function JikouTable({
  items,
  sortKey,
  sortDir,
  onToggleSort,
  widths,
  onWidthsChange,
  expandedId,
  onToggleExpand,
  history,
  historyLoading,
  historyError,
  emptyMessage = '条件に合う事項がありません。',
}: Props) {
  const tableWidth = COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);
  const totalColumnCount = COLUMNS.length;

  /** 列境界のドラッグで幅を変える。mousedown 時にだけ window へリスナを張る */
  function startResize(event: React.MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] ?? DEFAULT_WIDTHS[key];
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + e.clientX - startX);
      onWidthsChange({ ...widths, [key]: next });
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

  return (
    // table-fixed + colgroup: ソートで中身が変わっても列幅が動かないようにする
    <table
      className="w-full table-fixed border-collapse text-xs"
      style={{ minWidth: tableWidth }}
    >
      <colgroup>
        {COLUMNS.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-neutral-100 text-left text-neutral-500 dark:bg-neutral-800">
        <tr>
          {COLUMNS.map(col => {
            const active = sortKey === col.key;
            return (
              <th
                key={col.key}
                scope="col"
                title={col.note}
                aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`relative select-none p-0 font-medium ${
                  active ? 'text-neutral-900 dark:text-neutral-100' : ''
                }`}
              >
                {/* 並べ替えはキーボードでも操作できるよう button にする */}
                <button
                  type="button"
                  onClick={() => onToggleSort(col)}
                  className={`flex w-full items-center gap-0.5 overflow-hidden px-2 py-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                    col.numeric ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <span className="min-w-0 truncate">{col.label}</span>
                  {/* ソート記号は常に同じ幅を占有させ、切替で列幅も文字位置も動かさない */}
                  <span className="w-2.5 shrink-0 text-[9px]">
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
                {/* 列境界のドラッグハンドル。クリックがソートに伝播しないよう止める */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${col.label}の列幅を変更`}
                  onMouseDown={e => startResize(e, col.key)}
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-neutral-400/60"
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const rate = changeRate(item.amount, item.previousAmount);
          const exec = executionRate(item);
          const isOpen = expandedId === item.id;
          return (
            <Fragment key={item.id}>
              <tr
                onClick={() => onToggleExpand(isOpen ? null : item.id)}
                className={`cursor-pointer border-t border-neutral-100 align-middle hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                  isOpen ? 'bg-neutral-50 dark:bg-neutral-900' : ''
                }`}
              >
                <td className="truncate px-2 py-1.5 text-neutral-500">
                  {/* 行全体の onClick と併存させつつ、キーボードでも展開できるようにする */}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`${item.name} の詳細`}
                    onClick={e => {
                      e.stopPropagation();
                      onToggleExpand(isOpen ? null : item.id);
                    }}
                    className="mr-1 align-middle text-[9px] text-neutral-400"
                  >
                    {isOpen ? '▼' : '▶'}
                  </button>
                  <BudgetTypeBadge budgetType={item.budgetType} />
                </td>
                <td className="truncate px-2 py-1.5 text-neutral-500">
                  <AccountBadge accountType={item.accountType} />
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.ministry || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{orgColumn(item) || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.subAccount || '—'}</span>
                </td>
                <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">
                  {item.sectionCode}
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">{item.sectionName}</span>
                </td>
                <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="line-clamp-2">
                    {item.majorExpenseName ||
                      (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="line-clamp-2">{item.name}</span>
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatYen(item.amount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.previousAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.difference)}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}
                >
                  {formatChangeRate(rate)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.currentAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatYen(item.spent)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                  {formatYen(item.unused)}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${
                    exec === null
                      ? 'text-neutral-400'
                      : exec < 0.5
                        ? 'text-red-600 dark:text-red-400'
                        : exec < 0.9
                          ? 'text-amber-700 dark:text-amber-500'
                          : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  {formatRate(exec)}
                </td>
              </tr>
              {/* 詳細は行全体を使う。狭い列の中に押し込むと説明文が読めないため */}
              {isOpen && (
                <tr className="bg-neutral-50 dark:bg-neutral-900">
                  <td
                    colSpan={totalColumnCount}
                    className="border-b border-neutral-200 p-0 dark:border-neutral-800"
                  >
                    {/*
                      表は画面より広く横スクロールするので、詳細を素直に置くと
                      右へスクロールしたときに左端の内容が見切れる。
                      sticky left-0 ＋ 画面幅で、横位置に関わらず常に見えるようにする。
                    */}
                    <div className="sticky left-0 w-[calc(100vw-3rem)] px-4 py-3">
                      <div className="flex flex-wrap gap-x-10 gap-y-4">
                      {/* 年度推移は全年度を横断するのでページ層が取得したものを受け取る */}
                      <JikouHistory
                        history={history}
                        loading={historyLoading}
                        error={historyError}
                      />
                      <div className="min-w-[24rem] max-w-3xl flex-1">
                        <div className="mb-1 text-[11px] font-medium text-neutral-400">説明</div>
                        <p className="whitespace-pre-wrap leading-relaxed text-neutral-700 dark:text-neutral-300">
                          {item.description ||
                            (item.budgetType === '決算'
                              ? '（決算の帳票に説明欄はありません。予算の年度・種別を開くと表示されます）'
                              : '（説明なし）')}
                        </p>
                      </div>
                      <dl className="grid shrink-0 grid-cols-[6.5rem_auto] gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                        <dt className="text-neutral-400">合成キー</dt>
                        <dd className="max-w-[34rem] break-all font-mono">{item.key}</dd>
                        <dt className="text-neutral-400">行ID</dt>
                        <dd className="font-mono">{item.id}</dd>
                        <dt className="text-neutral-400">項コード</dt>
                        <dd className="font-mono">{item.sectionCode}</dd>
                        <dt className="text-neutral-400">主要経費コード</dt>
                        <dd className="font-mono">{item.majorExpenseCode || '—'}</dd>
                        {item.carriedOver !== null && (
                          <>
                            <dt className="text-neutral-400">翌年度繰越額</dt>
                            <dd className="tabular-nums">{formatYen(item.carriedOver)}</dd>
                          </>
                        )}
                        <dt className="text-neutral-400">帳票・ページ</dt>
                        <dd>
                          {item.documentId} p.{item.page}{' '}
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="underline hover:text-neutral-700"
                          >
                            出典XML
                          </a>
                        </dd>
                      </dl>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={totalColumnCount} className="px-3 py-10 text-center text-neutral-500">
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
