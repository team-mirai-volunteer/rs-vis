'use client';

/**
 * サイドパネルの各タブ（年度推移・事項・目・RS）で使う汎用グリッド。
 * ソート・列幅リサイズを持つ。データの整形・リンクの組み立ては呼び出し側の責務
 * （このコンポーネントは表示だけを持つ）。
 *
 * ソート・列幅は呼び出し側（KouSidePanel経由でapp/mof-kou/page.tsx）が状態を持つ
 * controlled コンポーネント。タブの切り替えでこのコンポーネント自体がアンマウント
 * されても（年度切替時の一時的なパネル消失を含む）、ソート・列幅がリセットされない
 * ようにするため。
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';

export interface GridColumn<T> {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
  /** 省略した列はソート不可（見出しクリックが無効になる） */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
}

export interface GridViewState {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  widths: Record<string, number>;
}

const MIN_COLUMN_WIDTH = 40;

export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  state,
  onStateChange,
  emptyMessage = 'データがありません。',
}: {
  rows: T[];
  columns: GridColumn<T>[];
  rowKey: (row: T) => string;
  state: GridViewState;
  onStateChange: (updater: (prev: GridViewState) => GridViewState) => void;
  emptyMessage?: string;
}) {
  const { sortKey, sortDir, widths } = state;

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sortValue = col.sortValue;
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'ja') * factor;
    });
    // columns is stable per tab（呼び出し側でインライン定義しても件数は少なく、再計算コストは無視できる）
  }, [rows, columns, sortKey, sortDir]);

  function toggleSort(col: GridColumn<T>) {
    if (!col.sortValue) return;
    onStateChange(s =>
      s.sortKey === col.key
        ? { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...s, sortKey: col.key, sortDir: col.numeric ? 'desc' : 'asc' }
    );
  }

  function startResize(event: React.MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const col = columns.find(c => c.key === key);
    const startWidth = widths[key] ?? col?.width ?? MIN_COLUMN_WIDTH;
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + e.clientX - startX);
      onStateChange(s => ({ ...s, widths: { ...s.widths, [key]: next } }));
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

  if (rows.length === 0) {
    return <p className="p-3 text-neutral-400">{emptyMessage}</p>;
  }

  const tableWidth = columns.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);

  return (
    <table className="w-full table-fixed border-collapse text-[11px]" style={{ minWidth: tableWidth }}>
      <colgroup>
        {columns.map(c => (
          <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-neutral-50 text-left font-medium text-neutral-400 dark:bg-neutral-900">
        <tr>
          {columns.map(col => {
            const active = sortKey === col.key;
            return (
              <th key={col.key} scope="col" className="relative select-none p-0">
                <button
                  type="button"
                  onClick={() => toggleSort(col)}
                  disabled={!col.sortValue}
                  className={`flex w-full items-center gap-0.5 overflow-hidden px-2 py-1.5 ${
                    col.sortValue ? 'hover:bg-neutral-200 dark:hover:bg-neutral-700' : 'cursor-default'
                  } ${col.numeric ? 'justify-end' : 'justify-start'} ${active ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
                >
                  <span className="min-w-0 truncate">{col.label}</span>
                  {col.sortValue && (
                    <span className="w-2 shrink-0 text-[9px]">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  )}
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
      <tbody className="text-neutral-600 dark:text-neutral-400">
        {sorted.map(row => (
          <tr
            key={rowKey(row)}
            className="border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {columns.map(col => (
              <td key={col.key} className={`truncate px-2 py-1.5 ${col.numeric ? 'text-right tabular-nums' : ''}`}>
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
