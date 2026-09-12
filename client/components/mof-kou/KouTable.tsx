'use client';

/**
 * 項一覧の表。並べ替え・列幅リサイズを持つ。行クリックで選択し、詳細はページ層の
 * サイドパネル（KouSidePanel）に出す（インライン展開はしない）。
 */

import { formatYen } from '@/client/components/mof-jikou/format';
import { changeRate, formatChangeRate } from '@/client/components/mof-jikou/format';
import type { MOFKouSectionSummary } from '@/types/mof-kou';
import { AccountBadge, BudgetTypeBadge } from './Badge';
import { COLUMNS, DEFAULT_WIDTHS, MIN_COLUMN_WIDTH, orgColumn, type ColumnSpec, type SortDir, type SortKey } from './columns';

interface Props {
  items: MOFKouSectionSummary[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (column: ColumnSpec) => void;
  widths: Record<string, number>;
  onWidthsChange: (next: Record<string, number>) => void;
  selectedId: string | null;
  onSelectRow: (id: string) => void;
  emptyMessage?: string;
}

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
}

export function KouTable({
  items,
  sortKey,
  sortDir,
  onToggleSort,
  widths,
  onWidthsChange,
  selectedId,
  onSelectRow,
  emptyMessage = '条件に合う項がありません。',
}: Props) {
  const tableWidth = COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);

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

  if (items.length === 0) {
    return <p className="p-6 text-center text-xs text-neutral-400">{emptyMessage}</p>;
  }

  return (
    <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: tableWidth }}>
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
                className={`relative select-none p-0 font-medium ${active ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleSort(col)}
                  className={`flex w-full items-center gap-0.5 overflow-hidden px-2 py-2 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${
                    col.numeric ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <span className="min-w-0 truncate">{col.label}</span>
                  <span className="w-2.5 shrink-0 text-[9px]">
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
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
        {items.map(row => {
          const rate = changeRate(row.amount, row.previousAmount);
          const isSelected = selectedId === row.id;
          return (
            <tr
              key={row.id}
              onClick={() => onSelectRow(row.id)}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectRow(row.id);
                }
              }}
              aria-selected={isSelected}
              className={`cursor-pointer border-t border-neutral-100 align-middle hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : ''
              }`}
            >
              <td className="truncate px-2 py-1.5">
                <BudgetTypeBadge budgetType={row.budgetType} />
              </td>
              <td className="truncate px-2 py-1.5">
                <AccountBadge accountType={row.accountType} />
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">{row.ministry || '—'}</span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">{orgColumn(row) || '—'}</span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">{row.subAccount || '—'}</span>
              </td>
              <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{row.sectionCode}</td>
              <td className="px-2 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                <span className="line-clamp-2">{row.sectionName}</span>
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                {row.jikouCount.toLocaleString()}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                {row.kouMokuCount.toLocaleString()}
              </td>
              <td
                className={`truncate px-2 py-1.5 text-right tabular-nums ${
                  row.rsProjectCount > 0
                    ? 'font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-neutral-300 dark:text-neutral-700'
                }`}
              >
                {row.rsProjectCount.toLocaleString()}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatYen(row.amount)}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                {formatYen(row.previousAmount)}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-neutral-500">
                {formatYen(row.difference)}
              </td>
              <td className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}>
                {formatChangeRate(rate)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
