'use client';

/**
 * 科目別内訳（項・目）一覧の表。並べ替え・列幅リサイズを持つ。行クリックで選択し、
 * 詳細はページ層のサイドパネル（KouMokuSidePanel）に出す（`/mof-kou` と同じ構成、
 * インライン展開はしない）。
 */

import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MofRsKouMokuLinkageRecord } from '@/types/mof-rs-kou-moku-linkage';
import { AccountBadge, BudgetTypeBadge } from '@/client/components/mof-kou/Badge';
import { changeRate, executionRate, formatChangeRate, formatRate, formatYen } from '@/client/components/mof-jikou/format';
import { COLUMNS, DEFAULT_WIDTHS, MIN_COLUMN_WIDTH, orgColumn, type ColumnSpec, type SortDir, type SortKey } from './columns';

interface Props {
  /** 表示するページ分の目 */
  items: MOFKouMokuItem[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (column: ColumnSpec) => void;
  widths: Record<string, number>;
  onWidthsChange: (next: Record<string, number>) => void;
  selectedId: string | null;
  onSelectRow: (id: string) => void;
  /** kouMokuKey → 紐づくRS事業。年度分を一括取得したもの（取得はページ層の責務）。RS列の件数表示に使う */
  linkageByKey: Map<string, MofRsKouMokuLinkageRecord[]>;
  emptyMessage?: string;
}

function rateClass(rate: number | null | 'new'): string {
  if (rate === null) return 'text-mirai-text-muted';
  if (rate === 'new') return 'text-primary';
  if (rate > 0) return 'text-emerald-700 ';
  if (rate < 0) return 'text-destructive ';
  return 'text-mirai-text-muted';
}

export function KouMokuTable({
  items,
  sortKey,
  sortDir,
  onToggleSort,
  widths,
  onWidthsChange,
  selectedId,
  onSelectRow,
  linkageByKey,
  emptyMessage = '条件に合う目がありません。',
}: Props) {
  const RS_COLUMN_WIDTH = 52;
  const tableWidth = COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0) + RS_COLUMN_WIDTH;

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
        <col style={{ width: RS_COLUMN_WIDTH }} />
        {COLUMNS.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-mirai-surface text-left text-mirai-text-subtle">
        <tr>
          <th
            scope="col"
            title="紐づく RS 事業数（所管×組織×項×目の完全一致）"
            aria-sort={sortKey === 'rs' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={cn('relative select-none p-0 font-bold', sortKey === 'rs' && 'text-primary-accent')}
            style={{ width: RS_COLUMN_WIDTH }}
          >
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onToggleSort({ key: 'rs', label: 'RS', width: RS_COLUMN_WIDTH, numeric: true })}
              className="h-auto w-full justify-end gap-0.5 overflow-hidden rounded-none px-1 py-2 text-xs font-bold text-inherit hover:bg-mirai-surface-light hover:text-inherit"
            >
              <span className="min-w-0 truncate">RS</span>
              <span className="w-2.5 shrink-0 text-[9px]">{sortKey === 'rs' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
            </Button>
          </th>
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
        {items.map(item => {
          const rate = changeRate(item.amount, item.previousAmount);
          const exec = executionRate(item);
          const isSelected = selectedId === item.id;
          const rsCount = new Set((linkageByKey.get(item.key) ?? []).map(l => l.projectId)).size;
          return (
            <tr
              key={item.id}
              onClick={() => onSelectRow(item.id)}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectRow(item.id);
                }
              }}
              aria-selected={isSelected}
              className={cn(
                'cursor-pointer border-t border-border align-middle hover:bg-mirai-surface-teal/60',
                isSelected && 'bg-primary/10'
              )}
            >
              <td
                className={`truncate px-2 py-1.5 text-right tabular-nums ${
                  rsCount > 0 ? 'font-medium text-emerald-700 ' : 'text-mirai-text-placeholder '
                }`}
              >
                {rsCount || '—'}
              </td>
              <td className="truncate px-2 py-1.5 text-mirai-text-muted">
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
              <td className="truncate px-2 py-1.5 tabular-nums text-mirai-text-muted">{item.sectionCode}</td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">{item.sectionName}</span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">
                  {item.majorExpenseName || (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">
                  {item.objectiveName || (item.objectiveCode ? `(${item.objectiveCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">
                  {item.fiscalLawName || (item.fiscalLawCode ? `(${item.fiscalLawCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">
                  {item.economicNatureName || (item.economicNatureCode ? `(${item.economicNatureCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-mirai-text-subtle">
                <span className="line-clamp-2">
                  {item.purposeName || (item.purposeCode ? `(${item.purposeCode})` : '—')}
                </span>
              </td>
              <td className="truncate px-2 py-1.5 tabular-nums text-mirai-text-muted">{item.subItemCode}</td>
              <td className="px-2 py-1.5 font-medium text-mirai-text">
                <span className="line-clamp-2">{item.subItemName}</span>
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
              <td className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}>
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
                        ? 'text-amber-700 '
                        : 'text-mirai-text-subtle '
                }`}
              >
                {formatRate(exec)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
