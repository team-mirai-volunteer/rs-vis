'use client';

import LoadingSpinner from '@/client/components/LoadingSpinner';
import { SubcontractsHelp } from '@/client/components/subcontract/SubcontractsHelp';
import { fiscalYear, fiscalYearLabel, sheetYearFromParams, rsViewUrl } from '@/app/lib/rs-fiscal-year';
import { useAiListFilter } from '@/client/lib/ai/use-ai-list-filter';
import { matchesAiListFilter } from '@/client/lib/ai/list-filter';
import { AiFilterChip } from '@/client/components/ai/AiFilterChip';

/**
 * /subcontracts（一覧） URL=状態パラメータ一覧。
 * 既定値のときは省略する（クリーンなURL維持）。すべて history.replaceState で同期（debounce後）。
 *
 *   year : 年度（既存、2024|2025。既定2025）
 *   q    : フリーテキスト検索語
 *   sort : ソートキー（SortKey のいずれか。既定 'projectId' は省略）
 *   dir  : ソート方向（'asc'|'desc'。sortKey既定時の既定dirは'asc'、それ以外は'desc'。一致時は省略）
 *   page : ページ番号（1始まり。既定1は省略）
 *   fp   : フィルタパネル開閉（'1'で開）
 *   fm   : 省庁フィルタ（複数選択、複数指定可）
 *   fac  : 会計区分フィルタ（複数選択、複数指定可）
 *   fst  : 構造フィルタ（複数選択、複数指定可）
 *   fnp  : 事業名テキストフィルタ
 *   fbu  : 担当組織テキストフィルタ
 *   bmin/bmax : 予算額 Min/Max
 *   emin/emax : 執行額 Min/Max
 *   dmin/dmax : 直接支出合計 Min/Max
 *   tmin/tmax : 支出額合計 Min/Max
 */
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, Suspense, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { rememberSubcontractsListUrl } from '@/client/lib/subcontracts-list-url';
import { onwardShare } from '@/app/lib/subcontract-onward-share';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FilterRow } from '@/components/filters/FilterRow';
import { FilterTextInput } from '@/components/filters/FilterTextInput';
import { MinMaxInput } from '@/components/filters/MinMaxInput';
import { MultiSelectDropdown } from '@/components/filters/MultiSelectDropdown';
import { AppHeader } from '@/components/navigation/AppHeader';
import { YearSelect } from '@/components/navigation/YearSelect';
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
  | 'institutional'
  | 'subcontractShare';

/**
 * 列の定義（表示順）。見出し・説明・寄せ・既定で出すかをここで一元管理し、
 * 列幅の配列（DEFAULT_COL_WIDTHS / MIN_COL_WIDTHS）はこの順に対応する。
 */
const COLUMN_DEFS: ReadonlyArray<{ key: SortKey; label: string; title: string; align: 'left' | 'right' | 'center'; /** 既定で出す画面幅の段。base = 常に、wide = 1280px 以上、xwide = 1700px 以上（フル HD）。無しは手で足す列 */ tier?: 'base' | 'wide' | 'xwide' }> = [
  { key: 'projectId', label: 'PID', title: '予算事業ID（RSシステムの事業番号）。年度をまたいで同じ事業を指します', align: 'left', tier: 'base' },
  { key: 'projectName', label: '事業名', title: '事業名。クリックするとその事業の委託構造（ブロックと資金の流れ）を開きます', align: 'left', tier: 'base' },
  { key: 'ministry', label: '省庁', title: '事業を所管する府省庁', align: 'left', tier: 'base' },
  { key: 'bureau', label: '担当組織', title: '事業を担当する局・庁／部／課', align: 'left', tier: 'xwide' },
  { key: 'accountCategory', label: '会計区分', title: '一般会計・特別会計のどちらの予算か（両方にまたがる事業もあります）', align: 'left', tier: 'wide' },
  { key: 'budget', label: '予算額', title: '歳出予算現額の合計（レビューシート 2-1）', align: 'right', tier: 'base' },
  { key: 'execution', label: '執行額', title: '実際に執行された額の合計（レビューシート 2-1）', align: 'right', tier: 'base' },
  { key: 'directExpenseTotal', label: '直接支出合計', title: '事業（国）から直接支払ったブロックの金額の合計（レビューシート 5-1）。再委託先への支払いは含みません', align: 'right', tier: 'wide' },
  { key: 'totalExpense', label: '支出額合計', title: '全ブロックの金額の合計。再委託先（B・C…）への支払いも足すので、同じお金を二重に数えることがあります', align: 'right', tier: 'base' },
  { key: 'subcontractShare', label: 'その先への割合', title: '直接支出のうち、直接の支出先からさらに先のブロック（再委託・補助金の再交付・支出委任など）へ流れた額の割合。契約上の再委託とは限りません', align: 'right', tier: 'base' },
  { key: 'totalMinusDirect', label: '支出額合計 − 直接支出合計', title: '支出額合計 − 直接支出合計（再委託・別財源など下流ブロック分）', align: 'right' },
  { key: 'executionMinusDirect', label: '執行額 − 直接支出合計', title: '執行額(2-1) − 直接支出合計(5-1)。間接経費分とほぼ一致するケースあり', align: 'right' },
  { key: 'totalBlockCount', label: 'ブロック', title: 'ブロック（同じ役割の支出先のまとまり。A・B・C…）の数', align: 'right', tier: 'wide' },
  { key: 'directBlockCount', label: '直接支出', title: '事業（国）から直接支払っているブロックの数', align: 'right' },
  { key: 'subcontractBlockCount', label: '再委託', title: '他のブロックから再委託・再々委託を受けているブロックの数', align: 'right' },
  { key: 'indirectCostCount', label: '間接経費', title: '国自らが支出する間接経費（職員旅費・事務費など）の記載件数', align: 'right', tier: 'xwide' },
  { key: 'separateOriginCount', label: '別財源', title: '別財源のブロック数。事業から直接も再委託でもつながりを確認できない起点ブロック（接続未確認の財源。財源データで確かめたものではない）', align: 'right', tier: 'xwide' },
  { key: 'totalRecipientCount', label: '支出先', title: '全ブロックに記載された支出先の数', align: 'right', tier: 'base' },
  { key: 'maxDepth', label: '階層', title: '再委託の最も深い段数（直接支出だけなら1）', align: 'right', tier: 'base' },
  { key: 'branchingBlockCount', label: '分岐', title: '1つのブロックから2つ以上のブロックへ再委託している「分岐元」の数', align: 'right' },
  { key: 'maxBranchWidth', label: '最大分岐', title: '1つのブロックから出ている再委託先ブロックの最大数', align: 'right' },
  { key: 'mergeTargetCount', label: '合流', title: '2つ以上のブロックから資金を受けている「合流先」ブロックの数', align: 'right' },
  { key: 'maxMergeWidth', label: '最大合流', title: '1つのブロックに流れ込む委託元ブロックの最大数', align: 'right' },
  { key: 'institutional', label: '構造', title: '全ブロックが金額0・支出先なしの「制度上の流れ」だけを記載した事業か（交付先の制度を示すだけの記載）', align: 'center' },
];
/** 画面幅に応じた既定の列。1280px 未満は 9 列、1280px 以上で 12 列（約 1,230px）、1700px 以上（フル HD）で 15 列（約 1,630px） */
function defaultVisibleFor(width: number): SortKey[] {
  const tiers: Array<'base' | 'wide' | 'xwide'> = width >= 1700 ? ['base', 'wide', 'xwide'] : width >= 1280 ? ['base', 'wide'] : ['base'];
  return COLUMN_DEFS.filter(c => c.tier && tiers.includes(c.tier)).map(c => c.key);
}
const BASE_VISIBLE_KEYS = defaultVisibleFor(0);
// v2: 以前は表示のたびに自動保存していたため、画面幅による既定が効かなくなっていた。利用者が列メニューで変えたときだけ保存する
const VISIBLE_COLUMNS_STORAGE_KEY = 'subcontracts-visible-columns-v2';

/** 検索バー横のクイック絞り込み（AND で重ねる）。件数は年度の全事業に対して出す */
const QUICK_FILTERS: ReadonlyArray<{ key: string; label: string; title: string; test: (g: SubcontractGraph) => boolean }> = [
  { key: 'sub', label: '再委託あり', title: '再委託（階層 2 以上）がある事業', test: g => g.maxDepth >= 2 },
  { key: 'deep', label: '再々委託以上', title: '再々委託（階層 3 以上）まである事業', test: g => g.maxDepth >= 3 },
  { key: 'single', label: '支出先1社', title: '記載された支出先が 1 者だけの事業', test: g => g.totalRecipientCount === 1 },
  { key: 'origin', label: '別財源あり', title: '事業からのつながりを確認できない起点ブロック（別財源）がある事業', test: g => g.separateOriginCount > 0 },
  { key: 'indirect', label: '間接経費あり', title: '国自らが支出する間接経費の記載がある事業', test: g => g.indirectCosts.length > 0 },
];

/** 直接支出のうち、その先のブロックへ流れた額の割合（0〜1）。直接支出が 0 なら null（app/lib/subcontract-onward-share.ts） */
function subcontractShare(g: SubcontractGraph): number | null {
  return onwardShare(g).share;
}

/** 利用者が列メニューで変えた保存値。無ければ null（画面幅の既定を使う） */
function loadVisibleColumns(): SortKey[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((k): k is SortKey => typeof k === 'string' && isSortKey(k));
    return keys.length > 0 ? keys : null;
  } catch {
    return null;
  }
}

const STRING_SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  'projectName',
  'ministry',
  'bureau',
  'accountCategory',
]);
type SortDir = 'asc' | 'desc';

const SORT_KEY_SET: ReadonlySet<string> = new Set<SortKey>([
  'projectId', 'projectName', 'ministry', 'bureau', 'accountCategory',
  'budget', 'execution', 'directExpenseTotal', 'totalExpense',
  'totalMinusDirect', 'executionMinusDirect', 'maxDepth',
  'totalBlockCount', 'directBlockCount', 'subcontractBlockCount',
  'indirectCostCount', 'separateOriginCount', 'totalRecipientCount',
  'branchingBlockCount', 'maxBranchWidth', 'mergeTargetCount', 'maxMergeWidth',
  'institutional', 'subcontractShare',
]);
function isSortKey(v: string): v is SortKey {
  return SORT_KEY_SET.has(v);
}
// sortKey切替時の既定方向（toggleSortの既定と一致させ、URL省略時の復元を揃える）
function defaultSortDir(key: SortKey): SortDir {
  return key === 'projectId' ? 'asc' : 'desc';
}

const PAGE_SIZE = 50;
const COLUMN_WIDTH_STORAGE_KEY = 'subcontracts-column-widths';
const COLUMN_LABELS = COLUMN_DEFS.map(c => c.label);
const DEFAULT_COL_WIDTHS = [
  44,    // PID
  280,   // 事業名
  112,   // 省庁（RS の府省庁名。最長でも 6 文字程度）
  240,   // 担当組織
  88,    // 会計区分
  88,    // 予算額
  88,    // 執行額
  112,   // 直接支出合計
  96,    // 支出額合計
  92,    // 再委託率（バー＋％）
  108,   // 支出計−直接
  96,    // 執行−直接
  88,    // ブロック
  88,    // 直接支出
  76,    // 再委託
  88,    // 間接経費
  76,    // 別財源
  76,    // 支出先
  64,    // 階層
  64,    // 分岐
  88,    // 最大分岐
  64,    // 合流
  88,    // 最大合流
  64,    // 構造
];
const MIN_COL_WIDTHS = [
  40,
  160,
  60,
  160,
  72,
  76,
  76,
  96,
  88,
  96,
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
].map((width, index) => Math.max(width, [...COLUMN_LABELS[index]].length * 11 + 24));

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
  const [year, setYear] = useState(() => {
    const y = Number(sheetYearFromParams(searchParams));
    return [2024, 2025].includes(y) ? y : 2025;
  });
  const [graphs, setGraphs] = useState<SubcontractGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  // AI ナビ（ヘッダー）の結果をこの一覧に当てる。事業名・府省庁・予算額・AI が選んだ事業 ID だけを判定し、他の条件はチップで案内
  const { aiFilter, clearAiFilter } = useAiListFilter('一覧');
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const s = searchParams.get('sort');
    return s && isSortKey(s) ? s : 'projectId';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const s = searchParams.get('sort');
    const key: SortKey = s && isSortKey(s) ? s : 'projectId';
    const d = searchParams.get('dir');
    return d === 'asc' || d === 'desc' ? d : defaultSortDir(key);
  });
  // 複数選択フィルタ
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>(() => searchParams.getAll('fm'));
  // 会計区分（'一般会計' | '特別会計' | '一般・特別' | '区分なし'）の複数選択
  const [selectedAccountCategories, setSelectedAccountCategories] = useState<string[]>(() => searchParams.getAll('fac'));
  // 構造（'別財源あり' | '合流あり' | '制度フローのみ'）の複数選択（OR）
  const [selectedStructures, setSelectedStructures] = useState<string[]>(() => searchParams.getAll('fst'));
  // 名称・組織テキストフィルタ
  const [filterProjectName, setFilterProjectName] = useState(() => searchParams.get('fnp') ?? '');
  const [filterBureau, setFilterBureau] = useState(() => searchParams.get('fbu') ?? '');
  // 金額 Min/Max
  const [filterBudgetMin, setFilterBudgetMin] = useState(() => searchParams.get('bmin') ?? '');
  const [filterBudgetMax, setFilterBudgetMax] = useState(() => searchParams.get('bmax') ?? '');
  const [filterExecutionMin, setFilterExecutionMin] = useState(() => searchParams.get('emin') ?? '');
  const [filterExecutionMax, setFilterExecutionMax] = useState(() => searchParams.get('emax') ?? '');
  const [filterDirectMin, setFilterDirectMin] = useState(() => searchParams.get('dmin') ?? '');
  const [filterDirectMax, setFilterDirectMax] = useState(() => searchParams.get('dmax') ?? '');
  const [filterTotalExpenseMin, setFilterTotalExpenseMin] = useState(() => searchParams.get('tmin') ?? '');
  const [filterTotalExpenseMax, setFilterTotalExpenseMax] = useState(() => searchParams.get('tmax') ?? '');
  // 折りたたみパネル
  const [showFilterPanel, setShowFilterPanel] = useState(() => searchParams.get('fp') === '1');
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'));
    return Number.isInteger(p) && p >= 1 ? p : 1;
  });
  const [columnWidths, setColumnWidths] = useState(loadColumnWidths);
  // 表示する列（URL の cols が最優先、無ければ利用者の保存値、無ければ画面幅に応じた既定）。
  // SSR では幅が分からないので最小の既定で描き、マウント後に幅で決め直す（URL・保存値があるときは変えない）
  const [visibleKeys, setVisibleKeys] = useState<SortKey[]>(() => {
    const fromUrl = (searchParams.get('cols') ?? '').split(',').filter((k): k is SortKey => isSortKey(k));
    return fromUrl.length > 0 ? fromUrl : BASE_VISIBLE_KEYS;
  });
  const columnsPinnedRef = useRef<boolean>((searchParams.get('cols') ?? '') !== '');
  useEffect(() => {
    if (columnsPinnedRef.current) return;
    const saved = loadVisibleColumns();
    setVisibleKeys(saved ?? defaultVisibleFor(window.innerWidth));
  }, []);
  /** 列メニューからの変更。以後はこのブラウザでその列を使う */
  const updateVisibleKeys = useCallback((next: SortKey[] | null) => {
    columnsPinnedRef.current = next !== null;
    if (next === null) {
      try { window.localStorage.removeItem(VISIBLE_COLUMNS_STORAGE_KEY); } catch { /* 無視 */ }
      setVisibleKeys(defaultVisibleFor(window.innerWidth));
      return;
    }
    try { window.localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* 保存できない環境では毎回既定 */ }
    setVisibleKeys(next);
  }, []);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  // 表の入れ物の幅（余りを事業名に足すため）。スクロールバー分を除いた clientWidth
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const element = tableContainerRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, error]);
  // クイック絞り込み（AND）
  const [quickFilters, setQuickFilters] = useState<string[]>(() => (searchParams.get('qf') ?? '').split(',').filter(k => QUICK_FILTERS.some(d => d.key === k)));
  const quickCounts = useMemo(() => QUICK_FILTERS.map(d => graphs.filter(d.test).length), [graphs]);
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

  // URL=状態同期（検索・ソート・フィルタ・ページ・年度）。history.replaceState、打鍵はdebounce後に反映
  const listUrlMountedRef = useRef(false);
  useEffect(() => {
    if (!listUrlMountedRef.current) { listUrlMountedRef.current = true; return; }
    const timer = window.setTimeout(() => {
      const p = new URLSearchParams();
      p.set('fiscalYear', String(fiscalYear(year)));
      if (query) p.set('q', query);
      if (sortKey !== 'projectId') p.set('sort', sortKey);
      if (sortDir !== defaultSortDir(sortKey)) p.set('dir', sortDir);
      if (page !== 1) p.set('page', String(page));
      if (showFilterPanel) p.set('fp', '1');
      for (const m of selectedMinistries) p.append('fm', m);
      for (const a of selectedAccountCategories) p.append('fac', a);
      for (const s of selectedStructures) p.append('fst', s);
      if (filterProjectName) p.set('fnp', filterProjectName);
      if (filterBureau) p.set('fbu', filterBureau);
      if (filterBudgetMin) p.set('bmin', filterBudgetMin);
      if (filterBudgetMax) p.set('bmax', filterBudgetMax);
      if (filterExecutionMin) p.set('emin', filterExecutionMin);
      if (filterExecutionMax) p.set('emax', filterExecutionMax);
      if (filterDirectMin) p.set('dmin', filterDirectMin);
      if (filterDirectMax) p.set('dmax', filterDirectMax);
      if (filterTotalExpenseMin) p.set('tmin', filterTotalExpenseMin);
      if (filterTotalExpenseMax) p.set('tmax', filterTotalExpenseMax);
      if (quickFilters.length > 0) p.set('qf', quickFilters.join(','));
      if (visibleKeys.join(',') !== defaultVisibleFor(window.innerWidth).join(',')) p.set('cols', visibleKeys.join(','));
      const qs = p.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
      rememberSubcontractsListUrl(`/subcontracts${qs ? `?${qs}` : ''}`);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    year, query, sortKey, sortDir, page, showFilterPanel,
    selectedMinistries, selectedAccountCategories, selectedStructures,
    filterProjectName, filterBureau,
    filterBudgetMin, filterBudgetMax, filterExecutionMin, filterExecutionMax,
    filterDirectMin, filterDirectMax, filterTotalExpenseMin, filterTotalExpenseMax,
    quickFilters, visibleKeys,
  ]);

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
      // AI ナビの条件
      if (aiFilter && !matchesAiListFilter(aiFilter, { pid: String(g.projectId), name: g.projectName, ministry: g.ministry, budget: g.budget })) return false;
      // クイック絞り込み（AND）
      for (const key of quickFilters) {
        const def = QUICK_FILTERS.find(d => d.key === key);
        if (def && !def.test(g)) return false;
      }
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
    graphs, query, aiFilter, quickFilters, selectedMinistries, selectedAccountCategories,
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
      else if (sortKey === 'subcontractShare') { va = subcontractShare(a) ?? -1; vb = subcontractShare(b) ?? -1; }
      else { va = a.totalRecipientCount; vb = b.totalRecipientCount; }
      return (va - vb) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // フィルタ・ソート・年度変更時はページ1へ戻す
  const filterKey = [
    year, query, quickFilters.join(','), selectedMinistries.join(','), selectedAccountCategories.join(','),
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
  // URL復元由来の page が実ページ数を超えている場合はクランプ（空テーブル+「次へ」有効の防止）。
  // loading 中はデータ未着で totalPages=1 になるため、確定後にのみ判定する
  if (!loading && page > totalPages) {
    setPage(totalPages);
  }
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
    if (sortKey !== k) return <ArrowUpDown aria-hidden="true" className="size-3 shrink-0 text-mirai-text-placeholder" />;
    const Icon = sortDir === 'asc' ? ArrowUp : ArrowDown;
    return <Icon aria-hidden="true" className="size-3 shrink-0 text-primary" />;
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
      <th
        style={{ ...thStyle, textAlign: align }}
        className="sticky top-0 z-[2] overflow-hidden border-b border-border bg-mirai-surface py-2 pl-2 pr-3 text-xs font-bold text-mirai-text-subtle"
        title={title ?? (typeof children === 'string' ? children : undefined)}
        scope="col"
        aria-sort={sortAria(sort)}
      >
        <Button
          variant="ghost"
          onClick={() => toggleSort(sort)}
          className={cn(
            'h-auto min-w-0 w-full gap-0.5 rounded-md p-0 text-xs font-bold text-inherit has-[>svg]:px-0 hover:bg-transparent hover:text-primary-accent',
            align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
          )}
        >
          <span className="shrink-0 whitespace-nowrap leading-4" style={{ textAlign: align }}>{children}</span>
          <SortIndicator k={sort} />
        </Button>
        <Button
          variant="ghost"
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
              startWidth: displayColumnWidths[columnIndex],
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
          className="absolute right-0 top-0 h-full w-2.5 cursor-col-resize rounded-none p-0 hover:bg-primary/10"
        />
      </th>
    );
  }

  // 位置・寸法のみ（色・フォントは className のトークンで指定する）
  const thStyle: CSSProperties = {
    textAlign: 'left',
    userSelect: 'none',
  };
  const tdNumStyle: CSSProperties = {
    padding: '8px 8px',
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const tdTextStyle: CSSProperties = {
    padding: '8px 8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const TD_CLASS = 'text-mirai-text-secondary';
  const dash = <span className="text-mirai-text-placeholder">—</span>;

  // 旧保存値や手動リサイズでも見出し・省庁名が欠けない幅を確保する。
  const ministryWidth = Math.max(MIN_COL_WIDTHS[2], ...graphs.map(g => [...g.ministry].length * 12 + 20));
  const displayColumnWidths = columnWidths.map((width, i) => Math.max(width, MIN_COL_WIDTHS[i], i === 2 ? ministryWidth : 0));
  // 表示する列の添字（定義順）。幅・リサイズは元の添字で管理する
  const visibleIndexes = COLUMN_DEFS.map((c, i) => (visibleKeys.includes(c.key) ? i : -1)).filter(i => i >= 0);
  const columnsWidth = visibleIndexes.reduce((sum, i) => sum + displayColumnWidths[i], 0);
  // 列の合計が画面より狭いとき、余りは事業名の列だけに足す（全列を均等に伸ばすと PID や省庁が無駄に広がる）
  const nameExtra = Math.max(0, containerWidth - columnsWidth);
  const tableWidth = columnsWidth + nameExtra;
  const colWidth = (i: number) => displayColumnWidths[i] + (COLUMN_DEFS[i].key === 'projectName' ? nameExtra : 0);

  /** 1 セルの中身。列の定義（COLUMN_DEFS）の key ごとに描く */
  function renderCell(key: SortKey, g: SubcontractGraph): ReactNode {
    switch (key) {
      case 'projectId': return <span className="text-mirai-text-muted">{g.projectId}</span>;
      case 'projectName': return (
        <div className="flex min-w-0 items-center gap-1">
          <Link href={rsViewUrl(`/subcontracts/${g.projectId}`, year)} title={g.projectName}
            className="block min-w-0 flex-1 truncate font-medium text-primary underline-offset-4 hover:text-primary-accent hover:underline">
            {g.projectName}
          </Link>
          <ProjectReferenceLinks projectId={g.projectId} projectName={g.projectName} year={year} compact />
        </div>
      );
      case 'ministry': return <span title={g.ministry}>{g.ministry}</span>;
      case 'bureau': return <span title={g.bureau || undefined}>{bureauLeaf(g.bureau) || dash}</span>;
      case 'accountCategory': return g.accountCategory ? accountCategoryLabel(g.accountCategory) : dash;
      case 'budget': return g.budget > 0 ? formatYen(g.budget) : '—';
      case 'execution': return g.execution > 0 ? formatYen(g.execution) : '—';
      case 'directExpenseTotal': return g.directExpenseTotal > 0 ? formatYen(g.directExpenseTotal) : '—';
      case 'totalExpense': return g.totalExpense > 0 ? formatYen(g.totalExpense) : '—';
      case 'subcontractShare': {
        const share = subcontractShare(g);
        if (share === null) return dash;
        const pct = Math.round(share * 100);
        return (
          <div className="flex items-center gap-1.5" title={`直接支出 ${formatYen(g.directExpenseTotal)} のうち、その先へ ${formatYen(onwardShare(g).amount)}`}>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mirai-surface-light">
              <div className={cn('h-full rounded-full', pct >= 50 ? 'bg-status-warn' : 'bg-primary')} style={{ width: `${pct}%` }} />
            </div>
            <span className={cn('w-8 shrink-0 text-right tabular-nums', pct === 0 && 'text-mirai-text-placeholder')}>{pct}%</span>
          </div>
        );
      }
      case 'totalMinusDirect': {
        const v = g.totalExpense - g.directExpenseTotal;
        if (!(g.totalExpense > 0 || g.directExpenseTotal > 0)) return dash;
        return v === 0 ? <span className="text-mirai-text-placeholder">0</span> : formatYen(v);
      }
      case 'executionMinusDirect': {
        const v = g.execution - g.directExpenseTotal;
        if (!(g.execution > 0 || g.directExpenseTotal > 0)) return dash;
        return v === 0 ? <span className="text-mirai-text-placeholder">0</span> : formatYen(v);
      }
      case 'totalBlockCount': return g.totalBlockCount;
      case 'directBlockCount': return g.directBlockCount > 0 ? g.directBlockCount : dash;
      case 'subcontractBlockCount': return subcontractBlockCount(g) > 0 ? subcontractBlockCount(g) : dash;
      case 'indirectCostCount': return g.indirectCosts.length > 0 ? g.indirectCosts.length.toLocaleString() : dash;
      case 'separateOriginCount': return g.separateOriginCount > 0 ? g.separateOriginCount : dash;
      case 'totalRecipientCount': return g.totalRecipientCount.toLocaleString();
      case 'maxDepth': return (
        <span className={cn('inline-block min-w-5 rounded-md px-1 text-center font-bold tabular-nums', g.maxDepth >= 3 ? 'bg-status-warn-bg text-status-warn-fg' : g.maxDepth === 2 ? 'bg-mirai-surface-teal text-primary-accent' : 'text-mirai-text-muted')}>{g.maxDepth}</span>
      );
      case 'branchingBlockCount': return g.branchingBlockCount > 0 ? g.branchingBlockCount : dash;
      case 'maxBranchWidth': return g.maxBranchWidth >= 2 ? g.maxBranchWidth : dash;
      case 'mergeTargetCount': return g.mergeTargetCount > 0 ? g.mergeTargetCount : dash;
      case 'maxMergeWidth': return g.maxMergeWidth >= 2 ? g.maxMergeWidth : dash;
      case 'institutional': return g.isInstitutionalFlowOnly
        ? <span className="inline-block rounded-full bg-stance-against-bg px-1 py-0.5 text-[10px] font-bold text-stance-against">制度</span>
        : dash;
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AppHeader fiscalYear={fiscalYear(year)} current="/subcontracts">
        <SubcontractsHelp />
        <YearSelect labelForYear={fiscalYearLabel} value={String(year)} onChange={y => setYear(Number(y))} years={[2025, 2024]} />
      </AppHeader>
      {/* ── 上部: フィルタ群 ── */}
      <div className="w-full shrink-0 p-3">
        {/* コントロール（/sankey-svg と同じトーン） */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {aiFilter && <AiFilterChip filter={aiFilter} sheetYear={year} onClear={() => clearAiFilter()} className="basis-full" />}

          {/* 検索 */}
          <div className="relative min-w-[180px] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mirai-text-muted" />
            <input
              type="text"
              placeholder="PID・事業名・省庁・ブロック・支出先で検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full rounded-full border border-mirai-border bg-card pl-9 pr-8 text-[13px] text-mirai-text shadow-xs transition-colors placeholder:text-mirai-text-placeholder focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setQuery('')}
                aria-label="検索クリア"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>

          {/* フィルタ展開トグル */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilterPanel((v) => !v)}
            title={showFilterPanel ? 'フィルタを閉じる' : 'フィルタを開く'}
            aria-pressed={showFilterPanel}
            className={cn('shrink-0 text-xs', showFilterPanel ? 'border-primary bg-primary/10 text-primary-accent' : 'border-mirai-border')}
          >
            フィルタ
            <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', showFilterPanel && 'rotate-180')} />
          </Button>

          <span className="shrink-0 text-xs text-mirai-text-subtle">
            {filtered.length.toLocaleString()}件表示
          </span>
          {/* 列の選択。既定は 9 列で、残りはここから足す。列幅のリセットもここに置く */}
          <div className="relative shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowColumnMenu(v => !v)}
              aria-expanded={showColumnMenu}
              aria-haspopup="dialog"
              title="表示する列を選ぶ"
              className={cn('text-xs', showColumnMenu ? 'border-primary bg-primary/10 text-primary-accent' : 'border-mirai-border')}
            >
              列 <span className="tabular-nums text-mirai-text-muted">{visibleIndexes.length}/{COLUMN_DEFS.length}</span>
              <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', showColumnMenu && 'rotate-180')} />
            </Button>
            {showColumnMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColumnMenu(false)} aria-hidden="true" />
                <div role="dialog" aria-label="表示する列" className="absolute right-0 top-full z-50 mt-1 w-[32rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-mirai-border bg-card p-3 text-xs shadow-soft">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-bold text-mirai-text">表示する列</span>
                    <span className="text-mirai-text-muted">見出しをドラッグすると幅を変えられます</span>
                    <Button variant="link" size="xs" className="ml-auto" onClick={() => updateVisibleKeys(null)}>既定に戻す</Button>
                    <Button variant="link" size="xs" onClick={() => updateVisibleKeys(COLUMN_DEFS.map(c => c.key))}>すべて表示</Button>
                    <Button variant="link" size="xs" onClick={() => setColumnWidths(DEFAULT_COL_WIDTHS)}>列幅リセット</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
                    {COLUMN_DEFS.map(c => {
                      const checked = visibleKeys.includes(c.key);
                      const locked = c.key === 'projectName';
                      return (
                        <label key={c.key} className={cn('flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-mirai-surface', locked && 'cursor-default')} title={c.title}>
                          <input type="checkbox" checked={checked || locked} disabled={locked}
                            onChange={() => updateVisibleKeys(checked ? visibleKeys.filter(k => k !== c.key) : COLUMN_DEFS.map(d => d.key).filter(k => k === c.key || visibleKeys.includes(k)))}
                            className="size-3 accent-primary" />
                          <span className={cn(locked && 'text-mirai-text-muted')}>{c.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

        </div>

        {/* クイック絞り込み。押すだけで重ねられる（AND）。件数は年度の全事業に対するもの */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="クイック絞り込み">
          {QUICK_FILTERS.map((d, i) => {
            const active = quickFilters.includes(d.key);
            return (
              <Button key={d.key} variant="outline" size="xs" aria-pressed={active} title={d.title}
                onClick={() => setQuickFilters(prev => active ? prev.filter(k => k !== d.key) : [...prev, d.key])}
                className={cn('h-7 rounded-full px-2.5 text-xs font-medium', active ? 'border-primary bg-mirai-surface-teal text-primary-accent' : 'border-mirai-border text-mirai-text-subtle')}>
                {d.label}
                <span className={cn('tabular-nums', active ? 'text-primary-accent/80' : 'text-mirai-text-muted')}>{quickCounts[i].toLocaleString()}</span>
              </Button>
            );
          })}
          {quickFilters.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setQuickFilters([])} className="h-7 text-xs text-mirai-text-muted">
              <X aria-hidden="true" className="size-3" />解除
            </Button>
          )}
        </div>

        {/* 折りたたみフィルタパネル（/sankey-svg ライク） */}
        {showFilterPanel && (
          <div
            className="mb-3 grid gap-x-4 gap-y-2 rounded-xl border border-mirai-border bg-card px-3 py-2.5 shadow-xs"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
          >
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
      <div className="flex min-h-0 w-full flex-1 flex-col px-3">
        {loading && <LoadingSpinner />}
        {error && <p className="text-sm text-destructive">エラー: {error}</p>}
        {!loading && !error && (
          <div ref={tableContainerRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-mirai-border bg-card shadow-xs">
            <table className="border-collapse text-xs" style={{ width: tableWidth, tableLayout: 'fixed' }}>
              <colgroup>
                {visibleIndexes.map(i => (
                  <col key={COLUMN_DEFS[i].key} style={{ width: colWidth(i) }} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-mirai-surface">
                  {visibleIndexes.map(i => {
                    const c = COLUMN_DEFS[i];
                    return <SortHeader key={c.key} sort={c.key} title={c.title} columnIndex={i} align={c.align}>{c.label}</SortHeader>;
                  })}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((g, rowIndex) => (
                  <tr
                    key={g.projectId}
                    className={cn(
                      'border-b border-border transition-colors hover:bg-mirai-surface-teal/60',
                      rowIndex % 2 === 0 ? 'bg-card' : 'bg-mirai-surface-gray',
                    )}
                  >
                    {visibleIndexes.map(i => {
                      const c = COLUMN_DEFS[i];
                      const style = c.align === 'right' ? tdNumStyle : c.align === 'center' ? { ...tdTextStyle, textAlign: 'center' as const } : tdTextStyle;
                      return <td key={c.key} style={style} className={TD_CLASS}>{renderCell(c.key, g)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 下部: ページネーション ── */}
      {!loading && !error && totalPages > 1 && (
        <div className="shrink-0 border-t border-mirai-border bg-card px-4 py-2">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="border-mirai-border text-[13px] font-medium"
            >
              ← 前へ
            </Button>
            <span className="text-[13px] text-mirai-text-subtle">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="border-mirai-border text-[13px] font-medium"
            >
              次へ →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubcontractsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SubcontractsPageInner />
    </Suspense>
  );
}
