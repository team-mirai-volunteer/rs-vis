'use client';

/**
 * 科目別内訳（項・目）一覧の表。並べ替え・列幅リサイズを持つ。行クリックで選択し、
 * 詳細はページ層のサイドパネル（KouMokuSidePanel）に出す（`/mof-kou` と同じ構成、
 * インライン展開はしない）。
 */

import type { MOFKouMokuItem } from '@/types/mof-kou-moku';
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
  if (rate === null) return 'text-neutral-400';
  if (rate === 'new') return 'text-blue-600';
  if (rate > 0) return 'text-emerald-700 dark:text-emerald-500';
  if (rate < 0) return 'text-red-600 dark:text-red-400';
  return 'text-neutral-400';
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
    return <p className="p-6 text-center text-xs text-neutral-400">{emptyMessage}</p>;
  }

  return (
    <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: tableWidth }}>
      <colgroup>
        <col style={{ width: RS_COLUMN_WIDTH }} />
        {COLUMNS.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-neutral-100 text-left text-neutral-500 dark:bg-neutral-800">
        <tr>
          <th
            scope="col"
            title="紐づく RS 事業数（所管×組織×項×目の完全一致）"
            aria-sort={sortKey === 'rs' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={`relative select-none p-0 font-medium ${sortKey === 'rs' ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
            style={{ width: RS_COLUMN_WIDTH }}
          >
            <button
              type="button"
              onClick={() => onToggleSort({ key: 'rs', label: 'RS', width: RS_COLUMN_WIDTH, numeric: true })}
              className="flex w-full items-center justify-end gap-0.5 overflow-hidden px-1 py-2 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              <span className="min-w-0 truncate">RS</span>
              <span className="w-2.5 shrink-0 text-[9px]">{sortKey === 'rs' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
            </button>
          </th>
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
              className={`cursor-pointer border-t border-neutral-100 align-middle hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : ''
              }`}
            >
              <td
                className={`truncate px-2 py-1.5 text-right tabular-nums ${
                  rsCount > 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-300 dark:text-neutral-700'
                }`}
              >
                {rsCount || '—'}
              </td>
              <td className="truncate px-2 py-1.5 text-neutral-500">
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
              <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{item.sectionCode}</td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">{item.sectionName}</span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">
                  {item.majorExpenseName || (item.majorExpenseCode ? `(${item.majorExpenseCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">
                  {item.objectiveName || (item.objectiveCode ? `(${item.objectiveCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">
                  {item.fiscalLawName || (item.fiscalLawCode ? `(${item.fiscalLawCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">
                  {item.economicNatureName || (item.economicNatureCode ? `(${item.economicNatureCode})` : '—')}
                </span>
              </td>
              <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">
                <span className="line-clamp-2">
                  {item.purposeName || (item.purposeCode ? `(${item.purposeCode})` : '—')}
                </span>
              </td>
              <td className="truncate px-2 py-1.5 tabular-nums text-neutral-500">{item.subItemCode}</td>
              <td className="px-2 py-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                <span className="line-clamp-2">{item.subItemName}</span>
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
              <td className={`truncate px-2 py-1.5 text-right tabular-nums ${rateClass(rate)}`}>
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
          );
        })}
      </tbody>
    </table>
  );
}
