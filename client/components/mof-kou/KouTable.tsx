'use client';

/**
 * 項一覧の表。並べ替え・列幅リサイズを持つ。行クリックで選択し、詳細はページ層の
 * サイドパネル（KouSidePanel）に出す（インライン展開はしない）。
 */

import { formatYen } from '@/client/components/mof-jikou/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  if (rate === null) return 'text-mirai-text-muted';
  if (rate === 'new') return 'text-primary';
  if (rate > 0) return 'text-status-good ';
  if (rate < 0) return 'text-destructive ';
  return 'text-mirai-text-muted';
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
    return <p className="p-6 text-center text-xs text-mirai-text-muted">{emptyMessage}</p>;
  }

  return (
    <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: tableWidth }}>
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
                  <span className="w-2.5 shrink-0 text-[9px]">
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </Button>
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
              className={cn(
                'cursor-pointer border-t border-border align-middle hover:bg-mirai-surface-teal/60',
                isSelected && 'bg-primary/10'
              )}
            >
              <td className="truncate px-2 py-1.5">
                <BudgetTypeBadge budgetType={row.budgetType} />
              </td>
              <td className="truncate px-2 py-1.5">
                <AccountBadge accountType={row.accountType} />
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">{row.ministry || '—'}</span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">{orgColumn(row) || '—'}</span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">{row.subAccount || '—'}</span>
              </td>
              <td className="truncate px-2 py-1.5 tabular-nums text-mirai-text-muted">{row.sectionCode}</td>
              <td className="px-2 py-1.5 font-medium text-mirai-text">
                <span className="line-clamp-2">{row.sectionName}</span>
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">
                {row.jikouCount.toLocaleString()}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-subtle">
                {row.kouMokuCount.toLocaleString()}
              </td>
              <td
                className={`truncate px-2 py-1.5 text-right tabular-nums ${
                  row.rsProjectCount > 0
                    ? 'font-medium text-status-good '
                    : 'text-mirai-text-placeholder '
                }`}
              >
                {row.rsProjectCount.toLocaleString()}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text">
                {formatYen(row.amount)}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
                {formatYen(row.previousAmount)}
              </td>
              <td className="truncate px-2 py-1.5 text-right tabular-nums text-mirai-text-muted">
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
