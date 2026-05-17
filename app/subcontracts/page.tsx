'use client';

import { useState, useEffect, useMemo, useRef, Suspense, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { FilterRow } from '@/components/filters/FilterRow';
import { FilterTextInput } from '@/components/filters/FilterTextInput';
import { MinMaxInput } from '@/components/filters/MinMaxInput';
import { MultiSelectDropdown } from '@/components/filters/MultiSelectDropdown';
import { ProjectReferenceLinks } from '@/components/subcontracts/ProjectReferenceLinks';
import { formatYen, parseAmountToYen } from '@/app/lib/format/yen';
import { accountCategoryLabel, bureauLeaf } from '@/app/lib/subcontracts/labels';
import type { SubcontractGraph } from '@/types/subcontract';

type SortKey =
  | 'projectId'
  | 'projectName'
  | 'ministry'
  | 'bureau'
  | 'accountCategory'
  | 'budget'
  | 'execution'
  | 'directExpenseTotal'
  | 'totalExpense'
  | 'totalMinusDirect'
  | 'executionMinusDirect'
  | 'maxDepth'
  | 'totalBlockCount'
  | 'directBlockCount'
  | 'subcontractBlockCount'
  | 'indirectCostCount'
  | 'separateOriginCount'
  | 'totalRecipientCount'
  | 'branchingBlockCount'
  | 'maxBranchWidth'
  | 'mergeTargetCount'
  | 'maxMergeWidth'
  | 'institutional';

const STRING_SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  'projectName',
  'ministry',
  'bureau',
  'accountCategory',
]);
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const COLUMN_WIDTH_STORAGE_KEY = 'subcontracts-column-widths';
const DEFAULT_COL_WIDTHS = [
  56,    // PID
  280,   // 事業名
  72,    // 省庁
  240,   // 担当組織
  80,    // 会計区分
  88,    // 予算額
  88,    // 執行額
  104,   // 直接支出合計
  96,    // 支出額合計
  100,   // 支出計−直接
  96,    // 執行−直接
  76,    // ブロック
  80,    // 直接支出
  68,    // 再委託
  80,    // 間接経費
  68,    // 別財源
  68,    // 支出先
  56,    // 階層
  56,    // 分岐
  80,    // 最大分岐
  56,    // 合流
  80,    // 最大合流
  64,    // 構造
];
const MIN_COL_WIDTHS = [
  48,
  160,
  60,
  160,
  72,
  76,
  76,
  96,
  88,
  92,
  88,
  68,
  72,
  60,
  72,
  60,
  60,
  48,
  48,
  72,
  48,
  72,
  56,
];

function loadColumnWidths(): number[] {
  if (typeof window === 'undefined') return DEFAULT_COL_WIDTHS;
  try {
    const saved = window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY);
    if (!saved) return DEFAULT_COL_WIDTHS;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_COL_WIDTHS.length) return DEFAULT_COL_WIDTHS;
    return parsed.map((value, index) => {
      const width = Number(value);
      return Number.isFinite(width) ? Math.max(MIN_COL_WIDTHS[index], width) : DEFAULT_COL_WIDTHS[index];
    });
  } catch {
    return DEFAULT_COL_WIDTHS;
  }
}

function SubcontractsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [year, setYear] = useState(() => {
    const y = parseInt(searchParams.get('year') ?? '2025', 10);
    return [2024, 2025].includes(y) ? y : 2025;
  });
  const [graphs, setGraphs] = useState<SubcontractGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('projectId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // 複数選択フィルタ
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  // 会計区分（'一般会計' | '特別会計' | '一般・特別' | '区分なし'）の複数選択
  const [selectedAccountCategories, setSelectedAccountCategories] = useState<string[]>([]);
  // 構造（'別財源あり' | '合流あり' | '制度フローのみ'）の複数選択（OR）
  const [selectedStructures, setSelectedStructures] = useState<string[]>([]);
  // 名称・組織テキストフィルタ
  const [filterProjectName, setFilterProjectName] = useState('');
  const [filterBureau, setFilterBureau] = useState('');
  // 金額 Min/Max
  const [filterBudgetMin, setFilterBudgetMin] = useState('');
  const [filterBudgetMax, setFilterBudgetMax] = useState('');
  const [filterExecutionMin, setFilterExecutionMin] = useState('');
  const [filterExecutionMax, setFilterExecutionMax] = useState('');
  const [filterDirectMin, setFilterDirectMin] = useState('');
  const [filterDirectMax, setFilterDirectMax] = useState('');
  const [filterTotalExpenseMin, setFilterTotalExpenseMin] = useState('');
  const [filterTotalExpenseMax, setFilterTotalExpenseMax] = useState('');
  // 折りたたみパネル
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [page, setPage] = useState(1);
  const [columnWidths, setColumnWidths] = useState(loadColumnWidths);
  const resizingColumnRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const savedColumnWidthsRef = useRef<string | null>(null);

  const ministries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of graphs) {
      if (!g.ministry) continue;
      counts.set(g.ministry, (counts.get(g.ministry) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([m]) => m);
  }, [graphs]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/data/subcontracts-${year}.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, SubcontractGraph>) => {
        setGraphs(Object.values(data));
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [year]);

  useEffect(() => {
    const serialized = JSON.stringify(columnWidths);
    if (savedColumnWidthsRef.current === serialized) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, serialized);
        savedColumnWidthsRef.current = serialized;
      } catch {
        // Ignore persistence failures such as private mode, disabled storage, or quota issues.
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [columnWidths]);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const resizing = resizingColumnRef.current;
      if (!resizing) return;
      const nextWidth = Math.max(
        MIN_COL_WIDTHS[resizing.index],
        Math.round(resizing.startWidth + e.clientX - resizing.startX)
      );
      setColumnWidths((prev) => {
        if (prev[resizing.index] === nextWidth) return prev;
        const next = [...prev];
        next[resizing.index] = nextWidth;
        return next;
      });
    }

    function onPointerUp() {
      if (!resizingColumnRef.current) return;
      resizingColumnRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // 金額フィルタの解析
  const budgetMinYen = parseAmountToYen(filterBudgetMin);
  const budgetMaxYen = parseAmountToYen(filterBudgetMax);
  const executionMinYen = parseAmountToYen(filterExecutionMin);
  const executionMaxYen = parseAmountToYen(filterExecutionMax);
  const directMinYen = parseAmountToYen(filterDirectMin);
  const directMaxYen = parseAmountToYen(filterDirectMax);
  const totalExpenseMinYen = parseAmountToYen(filterTotalExpenseMin);
  const totalExpenseMaxYen = parseAmountToYen(filterTotalExpenseMax);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const projectQ = filterProjectName.trim().toLocaleLowerCase();
    const bureauQ = filterBureau.trim().toLocaleLowerCase();
    return graphs.filter((g) => {
      // 府省庁
      if (selectedMinistries.length > 0 && !selectedMinistries.includes(g.ministry)) return false;
      // 会計区分（複数選択 OR）
      if (selectedAccountCategories.length > 0) {
        const label = g.accountCategory ? accountCategoryLabel(g.accountCategory) : '区分なし';
        if (!selectedAccountCategories.includes(label)) return false;
      }
      // 事業名
      if (projectQ && !g.projectName.toLocaleLowerCase().includes(projectQ)) return false;
      // 担当組織
      if (bureauQ && !g.bureau.toLocaleLowerCase().includes(bureauQ)) return false;
      // 金額 Min/Max
      if (budgetMinYen !== null && g.budget < budgetMinYen) return false;
      if (budgetMaxYen !== null && g.budget > budgetMaxYen) return false;
      if (executionMinYen !== null && g.execution < executionMinYen) return false;
      if (executionMaxYen !== null && g.execution > executionMaxYen) return false;
      if (directMinYen !== null && g.directExpenseTotal < directMinYen) return false;
      if (directMaxYen !== null && g.directExpenseTotal > directMaxYen) return false;
      if (totalExpenseMinYen !== null && g.totalExpense < totalExpenseMinYen) return false;
      if (totalExpenseMaxYen !== null && g.totalExpense > totalExpenseMaxYen) return false;
      // 構造（複数選択 OR）
      if (selectedStructures.length > 0) {
        const matchAny =
          (selectedStructures.includes('別財源あり') && g.hasSeparateOrigin) ||
          (selectedStructures.includes('合流あり') && g.hasMerge) ||
          (selectedStructures.includes('制度フローのみ') && g.isInstitutionalFlowOnly);
        if (!matchAny) return false;
      }
      // フリーテキスト検索（既存）
      if (!q) return true;
      return (
        String(g.projectId).includes(q) ||
        g.projectName.toLocaleLowerCase().includes(q) ||
        g.ministry.toLocaleLowerCase().includes(q) ||
        g.blocks.some(
          (b) =>
            b.blockName.toLocaleLowerCase().includes(q) ||
            b.recipients.some((r) => r.name.toLocaleLowerCase().includes(q))
        )
      );
    });
  }, [
    graphs, query, selectedMinistries, selectedAccountCategories,
    filterProjectName, filterBureau, selectedStructures,
    budgetMinYen, budgetMaxYen, executionMinYen, executionMaxYen,
    directMinYen, directMaxYen, totalExpenseMinYen, totalExpenseMaxYen,
  ]);

  function subcontractBlockCount(g: SubcontractGraph): number {
    return g.totalBlockCount - g.directBlockCount - g.separateOriginCount;
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (STRING_SORT_KEYS.has(sortKey)) {
        const sa: string =
          sortKey === 'projectName' ? a.projectName :
          sortKey === 'ministry' ? a.ministry :
          sortKey === 'bureau' ? bureauLeaf(a.bureau) :
          sortKey === 'accountCategory' ? accountCategoryLabel(a.accountCategory) :
          '';
        const sb: string =
          sortKey === 'projectName' ? b.projectName :
          sortKey === 'ministry' ? b.ministry :
          sortKey === 'bureau' ? bureauLeaf(b.bureau) :
          sortKey === 'accountCategory' ? accountCategoryLabel(b.accountCategory) :
          '';
        return sa.localeCompare(sb, 'ja') * dir;
      }
      let va: number, vb: number;
      if (sortKey === 'projectId') { va = a.projectId; vb = b.projectId; }
      else if (sortKey === 'budget') { va = a.budget; vb = b.budget; }
      else if (sortKey === 'execution') { va = a.execution; vb = b.execution; }
      else if (sortKey === 'directExpenseTotal') { va = a.directExpenseTotal; vb = b.directExpenseTotal; }
      else if (sortKey === 'totalExpense') { va = a.totalExpense; vb = b.totalExpense; }
      else if (sortKey === 'totalMinusDirect') { va = a.totalExpense - a.directExpenseTotal; vb = b.totalExpense - b.directExpenseTotal; }
      else if (sortKey === 'executionMinusDirect') { va = a.execution - a.directExpenseTotal; vb = b.execution - b.directExpenseTotal; }
      else if (sortKey === 'maxDepth') { va = a.maxDepth; vb = b.maxDepth; }
      else if (sortKey === 'totalBlockCount') { va = a.totalBlockCount; vb = b.totalBlockCount; }
      else if (sortKey === 'directBlockCount') { va = a.directBlockCount; vb = b.directBlockCount; }
      else if (sortKey === 'subcontractBlockCount') { va = subcontractBlockCount(a); vb = subcontractBlockCount(b); }
      else if (sortKey === 'indirectCostCount') { va = a.indirectCosts.length; vb = b.indirectCosts.length; }
      else if (sortKey === 'separateOriginCount') { va = a.separateOriginCount; vb = b.separateOriginCount; }
      else if (sortKey === 'branchingBlockCount') { va = a.branchingBlockCount; vb = b.branchingBlockCount; }
      else if (sortKey === 'maxBranchWidth') { va = a.maxBranchWidth; vb = b.maxBranchWidth; }
      else if (sortKey === 'mergeTargetCount') { va = a.mergeTargetCount; vb = b.mergeTargetCount; }
      else if (sortKey === 'maxMergeWidth') { va = a.maxMergeWidth; vb = b.maxMergeWidth; }
      else if (sortKey === 'institutional') { va = a.isInstitutionalFlowOnly ? 1 : 0; vb = b.isInstitutionalFlowOnly ? 1 : 0; }
      else { va = a.totalRecipientCount; vb = b.totalRecipientCount; }
      return (va - vb) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // フィルタ・ソート・年度変更時はページ1へ戻す
  const filterKey = [
    year, query, selectedMinistries.join(','), selectedAccountCategories.join(','),
    selectedStructures.join(','), filterProjectName, filterBureau,
    filterBudgetMin, filterBudgetMax, filterExecutionMin, filterExecutionMax,
    filterDirectMin, filterDirectMax, filterTotalExpenseMin, filterTotalExpenseMax,
    sortKey, sortDir,
  ].join('|');
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'projectId' ? 'asc' : 'desc');
    }
  }

  function sortAria(key: SortKey): 'none' | 'ascending' | 'descending' {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function SortIndicator({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span aria-hidden="true" style={{ color: '#bbb', marginLeft: 4 }}>↕</span>;
    return <span aria-hidden="true" style={{ color: '#3b82f6', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function SortHeader({
    sort,
    children,
    columnIndex,
    align = 'left',
    title,
  }: {
    sort: SortKey;
    children: ReactNode;
    columnIndex: number;
    align?: 'left' | 'right' | 'center';
    title?: string;
  }) {
    return (
      <th style={{ ...thStyle, textAlign: align }} title={title} aria-sort={sortAria(sort)}>
        <button
          type="button"
          onClick={() => toggleSort(sort)}
          style={{
            width: '100%',
            display: 'inline-flex',
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            alignItems: 'center',
            gap: 2,
            border: 0,
            background: 'transparent',
            padding: '0 8px 0 0',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span>{children}</span>
          <SortIndicator k={sort} />
        </button>
        <button
          type="button"
          aria-label={`${children}列の幅を変更`}
          title="列幅を変更"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            resizingColumnRef.current = {
              index: columnIndex,
              startX: e.clientX,
              startWidth: columnWidths[columnIndex],
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setColumnWidths((prev) => {
              const next = [...prev];
              next[columnIndex] = DEFAULT_COL_WIDTHS[columnIndex];
              return next;
            });
          }}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 10,
            height: '100%',
            border: 0,
            borderRight: '1px solid transparent',
            background: 'transparent',
            cursor: 'col-resize',
            padding: 0,
          }}
        />
      </th>
    );
  }

  const thStyle: CSSProperties = {
    padding: '8px 8px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#6b7280',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    background: '#f9fafb',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    overflow: 'hidden',
  };
  const tdNumStyle: CSSProperties = {
    padding: '8px 8px',
    textAlign: 'right',
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const tdTextStyle: CSSProperties = {
    padding: '8px 8px',
    color: '#374151',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  return (
    <div style={{ height: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── 上部: フィルタ群 ── */}
      <div style={{ flexShrink: 0, padding: '12px 16px', maxWidth: 1600, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* コントロール（/sankey-svg と同じトーン） */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* トップへ戻る（矢印のみ） */}
          <Link
            href="/"
            aria-label="トップへ戻る"
            title="トップへ戻る"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #e0e0e0',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#666',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </Link>

          {/* 年度切替 */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <select
              value={year}
              onChange={(e) => { const y = Number(e.target.value); setYear(y); router.replace(`/subcontracts?year=${y}`); }}
              style={{
                fontSize: 13,
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                padding: '6px 28px 6px 10px',
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: '#333',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            >
              <option value={2025}>2025年度</option>
              <option value={2024}>2024年度</option>
            </select>
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </div>

          {/* 検索 */}
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="PID・事業名・省庁・ブロック・支出先で検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 28px 6px 30px',
                borderRadius: 8,
                border: '1px solid #e0e0e0',
                fontSize: 13,
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: '#333',
                outline: 'none',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="検索クリア"
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#999', cursor: 'pointer', padding: 4, fontSize: 12 }}
              >
                ✕
              </button>
            )}
          </div>

          {/* フィルタ展開トグル */}
          <button
            type="button"
            onClick={() => setShowFilterPanel((v) => !v)}
            title={showFilterPanel ? 'フィルタを閉じる' : 'フィルタを開く'}
            aria-pressed={showFilterPanel}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: 600,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 10px',
              background: showFilterPanel ? '#f1f5f9' : 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#334155',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            フィルタ
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="currentColor"
              style={{ transform: showFilterPanel ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </button>

          <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
            {filtered.length.toLocaleString()}件表示
          </span>
          <button
            type="button"
            onClick={() => setColumnWidths(DEFAULT_COL_WIDTHS)}
            title="列幅を初期値に戻す"
            style={{
              fontSize: 12,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#334155',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            列幅リセット
          </button>
        </div>

        {/* 折りたたみフィルタパネル（/sankey-svg ライク） */}
        {showFilterPanel && (
          <div style={{
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            columnGap: 16,
            rowGap: 8,
          }}>
            {/* 会計区分 */}
            <FilterRow label="会計">
              <MultiSelectDropdown
                options={['一般会計', '特別会計', '一般・特別', '区分なし']}
                selected={selectedAccountCategories}
                onChange={setSelectedAccountCategories}
                allLabel="全会計区分"
              />
            </FilterRow>

            {/* 省庁 */}
            <FilterRow label="省庁">
              <MultiSelectDropdown
                options={ministries}
                selected={selectedMinistries}
                onChange={setSelectedMinistries}
                allLabel="全府省庁"
              />
            </FilterRow>

            {/* 事業名 */}
            <FilterRow label="事業">
              <FilterTextInput value={filterProjectName} onChange={setFilterProjectName} placeholder="事業名（部分一致）" />
            </FilterRow>

            {/* 担当組織 */}
            <FilterRow label="組織">
              <FilterTextInput value={filterBureau} onChange={setFilterBureau} placeholder="担当組織（局・部・課）" />
            </FilterRow>

            {/* MinMax 4種 */}
            <FilterRow label="予算">
              <MinMaxInput minVal={filterBudgetMin} maxVal={filterBudgetMax} onMinChange={setFilterBudgetMin} onMaxChange={setFilterBudgetMax} />
            </FilterRow>
            <FilterRow label="執行">
              <MinMaxInput minVal={filterExecutionMin} maxVal={filterExecutionMax} onMinChange={setFilterExecutionMin} onMaxChange={setFilterExecutionMax} />
            </FilterRow>
            <FilterRow label="直接">
              <MinMaxInput minVal={filterDirectMin} maxVal={filterDirectMax} onMinChange={setFilterDirectMin} onMaxChange={setFilterDirectMax} />
            </FilterRow>
            <FilterRow label="支出計">
              <MinMaxInput minVal={filterTotalExpenseMin} maxVal={filterTotalExpenseMax} onMinChange={setFilterTotalExpenseMin} onMaxChange={setFilterTotalExpenseMax} />
            </FilterRow>

            {/* 構造 */}
            <FilterRow label="構造">
              <MultiSelectDropdown
                options={['別財源あり', '合流あり', '制度フローのみ']}
                selected={selectedStructures}
                onChange={setSelectedStructures}
                allLabel="すべて"
              />
            </FilterRow>
          </div>
        )}
      </div>

      {/* ── 中部: スクロールテーブル ── */}
      <div style={{ flex: 1, minHeight: 0, padding: '0 16px', maxWidth: 1600, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {loading && <p style={{ color: '#6b7280', fontSize: 14 }}>読み込み中...</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>エラー: {error}</p>}
        {!loading && !error && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <table style={{ width: tableWidth, minWidth: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <colgroup>
                {columnWidths.map((width, i) => (
                  <col key={i} style={{ width }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <SortHeader sort="projectId" columnIndex={0}>PID</SortHeader>
                  <SortHeader sort="projectName" columnIndex={1}>事業名</SortHeader>
                  <SortHeader sort="ministry" columnIndex={2}>省庁</SortHeader>
                  <SortHeader sort="bureau" columnIndex={3}>担当組織</SortHeader>
                  <SortHeader sort="accountCategory" columnIndex={4}>会計区分</SortHeader>
                  <SortHeader sort="budget" columnIndex={5} align="right">予算額</SortHeader>
                  <SortHeader sort="execution" columnIndex={6} align="right">執行額</SortHeader>
                  <SortHeader sort="directExpenseTotal" columnIndex={7} align="right">直接支出合計</SortHeader>
                  <SortHeader sort="totalExpense" columnIndex={8} align="right">支出額合計</SortHeader>
                  <SortHeader sort="totalMinusDirect" columnIndex={9} align="right" title="支出額合計 − 直接支出合計（再委託・別財源など下流ブロック分）">支出計−直接</SortHeader>
                  <SortHeader sort="executionMinusDirect" columnIndex={10} align="right" title="執行額(2-1) − 直接支出合計(5-1)。間接経費分とほぼ一致するケースあり">執行−直接</SortHeader>
                  <SortHeader sort="totalBlockCount" columnIndex={11} align="right">ブロック</SortHeader>
                  <SortHeader sort="directBlockCount" columnIndex={12} align="right">直接支出</SortHeader>
                  <SortHeader sort="subcontractBlockCount" columnIndex={13} align="right">再委託</SortHeader>
                  <SortHeader sort="indirectCostCount" columnIndex={14} align="right">間接経費</SortHeader>
                  <SortHeader sort="separateOriginCount" columnIndex={15} align="right">別財源</SortHeader>
                  <SortHeader sort="totalRecipientCount" columnIndex={16} align="right">支出先</SortHeader>
                  <SortHeader sort="maxDepth" columnIndex={17} align="right">階層</SortHeader>
                  <SortHeader sort="branchingBlockCount" columnIndex={18} align="right">分岐</SortHeader>
                  <SortHeader sort="maxBranchWidth" columnIndex={19} align="right">最大分岐</SortHeader>
                  <SortHeader sort="mergeTargetCount" columnIndex={20} align="right">合流</SortHeader>
                  <SortHeader sort="maxMergeWidth" columnIndex={21} align="right">最大合流</SortHeader>
                  <SortHeader sort="institutional" columnIndex={22} align="center">構造</SortHeader>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((g, i) => (
                  <tr
                    key={g.projectId}
                    style={{
                      background: i % 2 === 0 ? '#fff' : '#f9fafb',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <td style={{ ...tdTextStyle, color: '#6b7280' }}>{g.projectId}</td>
                    <td style={tdTextStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <Link
                          href={`/subcontracts/${g.projectId}?year=${year}`}
                          title={g.projectName}
                          style={{
                            color: '#2563eb',
                            textDecoration: 'none',
                            fontWeight: 500,
                            flex: 1,
                            minWidth: 0,
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {g.projectName}
                        </Link>
                        <ProjectReferenceLinks projectId={g.projectId} projectName={g.projectName} year={year} compact />
                      </div>
                    </td>
                    <td style={tdTextStyle} title={g.ministry}>{g.ministry}</td>
                    <td style={tdTextStyle} title={g.bureau || undefined}>
                      {bureauLeaf(g.bureau) || <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdTextStyle}>
                      {g.accountCategory ? accountCategoryLabel(g.accountCategory) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.budget > 0 ? formatYen(g.budget) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.execution > 0 ? formatYen(g.execution) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.directExpenseTotal > 0 ? formatYen(g.directExpenseTotal) : '—'}
                    </td>
                    <td style={tdNumStyle}>
                      {g.totalExpense > 0 ? formatYen(g.totalExpense) : '—'}
                    </td>
                    {(() => {
                      const totalMinusDirect = g.totalExpense - g.directExpenseTotal;
                      const executionMinusDirect = g.execution - g.directExpenseTotal;
                      const fmtDiff = (v: number, hasBase: boolean) => {
                        if (!hasBase) return <span style={{ color: '#cbd5e1' }}>—</span>;
                        if (v === 0) return <span style={{ color: '#cbd5e1' }}>0</span>;
                        return formatYen(Math.abs(v)).replace(/^/, v < 0 ? '−' : '');
                      };
                      return (
                        <>
                          <td style={tdNumStyle}>
                            {fmtDiff(totalMinusDirect, g.totalExpense > 0 || g.directExpenseTotal > 0)}
                          </td>
                          <td style={tdNumStyle}>
                            {fmtDiff(executionMinusDirect, g.execution > 0 || g.directExpenseTotal > 0)}
                          </td>
                        </>
                      );
                    })()}
                    <td style={tdNumStyle}>{g.totalBlockCount}</td>
                    <td style={tdNumStyle}>
                      {g.directBlockCount > 0 ? g.directBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {subcontractBlockCount(g) > 0 ? subcontractBlockCount(g) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.indirectCosts.length > 0 ? g.indirectCosts.length.toLocaleString() : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.separateOriginCount > 0 ? g.separateOriginCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>{g.totalRecipientCount.toLocaleString()}</td>
                    <td style={tdNumStyle}>{g.maxDepth}</td>
                    <td style={tdNumStyle}>
                      {g.branchingBlockCount > 0 ? g.branchingBlockCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.maxBranchWidth >= 2 ? g.maxBranchWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.mergeTargetCount > 0 ? g.mergeTargetCount : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={tdNumStyle}>
                      {g.maxMergeWidth >= 2 ? g.maxMergeWidth : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ ...tdTextStyle, textAlign: 'center' }}>
                      {g.isInstitutionalFlowOnly ? (
                        <span style={{ display: 'inline-block', padding: '2px 4px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#991b1b' }}>
                          制度
                        </span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 下部: ページネーション ── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ flexShrink: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '8px 16px' }}>
          <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: '4px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                opacity: page === 1 ? 0.3 : 1,
              }}
            >
              ← 前へ
            </button>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              style={{
                padding: '4px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
                opacity: page === totalPages ? 0.3 : 1,
              }}
            >
              次へ →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubcontractsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractsPageInner />
    </Suspense>
  );
}
