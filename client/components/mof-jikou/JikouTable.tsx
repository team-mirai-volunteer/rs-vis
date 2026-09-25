'use client';

/**
 * 事項一覧の表。並べ替え・列幅リサイズ・行の詳細展開を持つ。
 * データの絞り込みとページングは呼び出し側の責務で、ここは描画に専念する。
 */

import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  if (rate === null) return 'text-mirai-text-muted';
  if (rate === 'new') return 'text-primary';
  if (rate > 0) return 'text-status-good ';
  if (rate < 0) return 'text-destructive ';
  return 'text-mirai-text-muted';
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
      <thead className="sticky top-0 z-10 bg-mirai-surface text-left text-mirai-text-subtle">
        <tr>
          {COLUMNS.map(col => {
            const active = sortKey === col.key;
            return (
              <th
                key={col.key}
                scope="col"
                title={col.note}
                aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={cn('relative select-none p-0 font-bold', active && 'text-primary-accent')}
              >
                {/* 並べ替えはキーボードでも操作できるよう button にする */}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onToggleSort(col)}
                  className={cn(
                    'h-auto w-full gap-0.5 overflow-hidden rounded-none px-2 py-2 text-xs font-bold text-inherit hover:bg-mirai-surface-light hover:text-inherit',
                    col.numeric ? 'justify-end' : 'justify-start'
                  )}
                >
                  <span className="min-w-0 truncate">{col.label}</span>
                  {/* ソート記号は常に同じ幅を占有させ、切替で列幅も文字位置も動かさない */}
                  <span className="w-2.5 shrink-0 text-[9px]">
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </Button>
                {/* 列境界のドラッグハンドル。クリックがソートに伝播しないよう止める */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${col.label}の列幅を変更`}
                  onMouseDown={e => startResize(e, col.key)}
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-mirai-border-light"
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
                className={cn(
                  'cursor-pointer border-t border-border align-middle hover:bg-mirai-surface-teal/60',
                  isOpen && 'bg-mirai-surface'
                )}
              >
                <td className="truncate px-2 py-1.5 text-mirai-text-muted">
                  {/* 行全体の onClick と併存させつつ、キーボードでも展開できるようにする */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-expanded={isOpen}
                    aria-label={`${item.name} の詳細`}
                    onClick={e => {
                      e.stopPropagation();
                      onToggleExpand(isOpen ? null : item.id);
                    }}
                    className="mr-1 size-4 align-middle text-[9px] text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
                  >
                    {isOpen ? '▼' : '▶'}
                  </Button>
                  <BudgetTypeBadge budgetType={item.budgetType} />
                </td>
                <td className="truncate px-2 py-1.5 text-mirai-text-muted">
                  <AccountBadge accountType={item.accountType} />
                </td>
                <td className="px-2 py-1.5 text-mirai-text-subtle">
                  <span className="line-clamp-2">{item.ministry || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-mirai-text-subtle">
                  <span className="line-clamp-2">{orgColumn(item) || '—'}</span>
                </td>
                <td className="px-2 py-1.5 text-mirai-text-subtle">
                  <span className="line-clamp-2">{item.subAccount || '—'}</span>
                </td>
                <td className="truncate px-2 py-1.5 tabular-nums text-mirai-text-muted">
                  {item.sectionCode}
                </td>
                <td className="px-2 py-1.5 text-mirai-text-subtle">
                  <span className="line-clamp-2">{item.sectionName}</span>
                </td>
                <td className="px-2 py-1.5 text-mirai-text-subtle">
                  <span className="line-clamp-2">
                    {item.majorExpenseName ||
                      (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-medium text-mirai-text">
                  <span className="line-clamp-2">{item.name}</span>
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text">
                  {formatYen(item.amount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
                  {formatYen(item.previousAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
                  {formatYen(item.difference)}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}
                >
                  {formatChangeRate(rate)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
                  {formatYen(item.currentAmount)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text">
                  {formatYen(item.spent)}
                </td>
                <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
                  {formatYen(item.unused)}
                </td>
                <td
                  className={`truncate px-2 py-1.5 text-right tabular-nums ${
                    exec === null
                      ? 'text-mirai-text-muted'
                      : exec < 0.5
                        ? 'text-destructive '
                        : exec < 0.9
                          ? 'text-status-warn '
                          : 'text-mirai-text-subtle '
                  }`}
                >
                  {formatRate(exec)}
                </td>
              </tr>
              {/* 詳細は行全体を使う。狭い列の中に押し込むと説明文が読めないため */}
              {isOpen && (
                <tr className="bg-mirai-surface">
                  <td
                    colSpan={totalColumnCount}
                    className="border-b border-border p-0"
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
                        <div className="mb-1 text-[11px] font-medium text-mirai-text-muted">説明</div>
                        <p className="whitespace-pre-wrap leading-relaxed text-mirai-text-secondary">
                          {item.description ||
                            (item.budgetType === '決算'
                              ? '（決算の帳票に説明欄はありません。予算の年度・種別を開くと表示されます）'
                              : '（説明なし）')}
                        </p>
                      </div>
                      <dl className="grid shrink-0 grid-cols-[6.5rem_auto] gap-x-3 gap-y-1 text-[11px] text-mirai-text-muted">
                        <dt className="text-mirai-text-muted">合成キー</dt>
                        <dd className="max-w-[34rem] break-all tabular-nums">{item.key}</dd>
                        <dt className="text-mirai-text-muted">行ID</dt>
                        <dd className="tabular-nums">{item.id}</dd>
                        <dt className="text-mirai-text-muted">項コード</dt>
                        <dd className="tabular-nums">{item.sectionCode}</dd>
                        <dt className="text-mirai-text-muted">主要経費コード</dt>
                        <dd className="tabular-nums">{item.majorExpenseCode || '—'}</dd>
                        {item.carriedOver !== null && (
                          <>
                            <dt className="text-mirai-text-muted">翌年度繰越額</dt>
                            <dd className="tabular-nums">{formatYen(item.carriedOver)}</dd>
                          </>
                        )}
                        <dt className="text-mirai-text-muted">帳票・ページ</dt>
                        <dd>
                          {item.documentId} p.{item.page}{' '}
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-primary underline underline-offset-4 hover:text-primary-accent"
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
            <td colSpan={totalColumnCount} className="px-3 py-10 text-center text-mirai-text-muted">
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
