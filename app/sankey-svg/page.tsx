'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { GraphData, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import type { ProjectDetail } from '@/types/project-details';
import {
  COL_LABELS, MARGIN, NODE_W, NODE_PAD,
  TYPE_COLORS, TYPE_LABELS,
  getColumn, getNodeColor, getLinkColor, ribbonPath, formatYen,
} from '@/app/lib/sankey-svg-constants';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { filterTopN, computeLayout } from '@/app/lib/sankey-svg-filter';

// ── URL state serialization ──

interface SankeyUrlState {
  selectedNodeId: string | null;
  pinnedProjectId: string | null;
  pinnedRecipientId: string | null;
  pinnedMinistryName: string | null;
  recipientOffset: number;
  projectOffset: number;
  offsetTarget: 'recipient' | 'project';
  topMinistry: number;
  topProject: number;
  topRecipient: number;
  showLabels: boolean;
  showAggRecipient: boolean;
  showAggProject: boolean;
  projectSortBy: 'budget' | 'spending';
  scaleBudgetToVisible: boolean;
  focusRelated: boolean;
  autoFocusRelated: boolean;
  year: '2024' | '2025';
  zoom?: number;
  filterActive?: boolean;
  filterTarget?: 'project' | 'recipient';
  filterNameQuery?: string;
  filterMinistryNames?: string[];
  filterMinBudgetText?: string;
  filterMaxBudgetText?: string;
  filterMinSpendingText?: string;
  filterMaxSpendingText?: string;
}

function parseSearchParams(search: string): Partial<SankeyUrlState> {
  const p = new URLSearchParams(search);
  const result: Partial<SankeyUrlState> = {};
  const sel = p.get('sel'); if (sel !== null) result.selectedNodeId = sel;
  const pp = p.get('pp'); if (pp !== null) result.pinnedProjectId = pp;
  const pr = p.get('pr'); if (pr !== null) result.pinnedRecipientId = pr;
  const pm = p.get('pm'); if (pm !== null) result.pinnedMinistryName = pm;
  const ro = p.get('ro'); if (ro !== null) { const n = parseInt(ro, 10); if (!isNaN(n)) result.recipientOffset = Math.max(0, n); }
  const ot = p.get('ot'); if (ot === 'p') result.offsetTarget = 'project';
  const po = p.get('po'); if (po !== null) { const n = parseInt(po, 10); if (!isNaN(n)) result.projectOffset = Math.max(0, n); }
  const tm = p.get('tm'); if (tm !== null) { const n = parseInt(tm, 10); if (!isNaN(n)) result.topMinistry = Math.max(1, Math.min(37, n)); }
  const tp = p.get('tp'); if (tp !== null) { const n = parseInt(tp, 10); if (!isNaN(n)) result.topProject = Math.max(1, Math.min(300, n)); }
  const tr = p.get('tr'); if (tr !== null) { const n = parseInt(tr, 10); if (!isNaN(n)) result.topRecipient = Math.max(1, Math.min(300, n)); }
  const sl = p.get('sl'); if (sl !== null) result.showLabels = sl !== '0';
  const ar = p.get('ar'); if (ar !== null) result.showAggRecipient = ar !== '0';
  const ap = p.get('ap'); if (ap !== null) result.showAggProject = ap !== '0';
  const ps = p.get('ps'); if (ps === 's') result.projectSortBy = 'spending';
  const sb = p.get('sb'); if (sb !== null) result.scaleBudgetToVisible = sb !== '0';
  const fr = p.get('fr'); if (fr !== null) result.focusRelated = fr === '1';
  const afr = p.get('afr'); if (afr !== null) result.autoFocusRelated = afr === '1';
  const yr = p.get('yr'); if (yr === '2024' || yr === '2025') result.year = yr;
  const z = p.get('z'); if (z !== null) { const n = parseFloat(z); if (!isNaN(n) && n >= 0.1 && n <= 10) result.zoom = n; }
  const f = p.get('f'); if (f === '1') result.filterActive = true;
  const nft = p.get('nft'); if (nft === 'p') result.filterTarget = 'project'; else if (nft === 'r') result.filterTarget = 'recipient';
  const nf = p.get('nf'); if (nf !== null) result.filterNameQuery = nf;
  const fm = p.getAll('fm'); if (fm.length > 0) result.filterMinistryNames = Array.from(new Set(fm.map(v => v.trim()).filter(Boolean)));
  const fmb = p.get('fmb'); if (fmb !== null) result.filterMinBudgetText = fmb;
  const fxb = p.get('fxb'); if (fxb !== null) result.filterMaxBudgetText = fxb;
  const fms = p.get('fms'); if (fms !== null) result.filterMinSpendingText = fms;
  const fxs = p.get('fxs'); if (fxs !== null) result.filterMaxSpendingText = fxs;
  return result;
}

/**
 * 事業統合ノードの SVG パスを生成する。
 * x0 = 予算ノード左端, nodeW = NODE_W, bH = 予算高さ, sH = 支出高さ (共通 y0=0 基準)
 * 上辺: 直線, 下辺: 予算下端 ↔ 支出下端を結ぶベジェ曲線
 */
function mergedProjectPath(x0: number, nodeW: number, bH: number, sH: number): string {
  const x2 = x0 + nodeW * 2;
  const mx = (x0 + x2) / 2;
  return `M${x0},0 L${x2},0 L${x2},${sH} C${mx},${sH} ${mx},${bH} ${x0},${bH} Z`;
}

/** ノードID → フォーカスピン状態を導出する純粋ヘルパー */
function parseJapaneseNumeral(s: string): number {
  const d: Record<string, number> = { 一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
  let result = 0, cur = 0;
  for (const c of s) {
    if (c in d) { cur = d[c]; }
    else if (c === '十') { result += (cur || 1) * 10; cur = 0; }
    else if (c === '百') { result += (cur || 1) * 100; cur = 0; }
    else if (c === '千') { result += (cur || 1) * 1000; cur = 0; }
  }
  return result + cur;
}

function normalizeAmountInput(s: string): string {
  // 全角数字・小数点・マイナス → 半角
  let t = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
  t = t.replace(/[－−‐]/g, '-').replace(/[．]/g, '.').replace(/[，　,\s]/g, '');
  // 和数字ブロック（一〜千）→ アラビア数字
  t = t.replace(/[一二三四五六七八九十百千]+/g, m => String(parseJapaneseNumeral(m)));
  return t;
}

/** "1.26億", "４５６７万円", "一千二百億", "1兆2000億", "-51000円", "-51000" などを1円単位の数値に変換。解析失敗時 null */
function parseAmountToYen(s: string): number | null {
  const t = normalizeAmountInput(s);
  if (!t) return null;
  const sign = t.startsWith('-') ? -1 : 1;
  const abs = sign === -1 ? t.slice(1) : t;
  const comboMatch = abs.match(/^([\d.]+)兆([\d.]+)億?$/);
  if (comboMatch) {
    const cho = parseFloat(comboMatch[1]);
    const oku = parseFloat(comboMatch[2]);
    if (!isNaN(cho) && !isNaN(oku)) return sign * (cho * 10000 + oku) * 1e8;
  }
  const m = abs.match(/^([\d.]+)\s*(兆円?|億円?|万円?|円)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const unit = m[2] ?? '';
  if (unit.startsWith('兆')) return sign * n * 1e12;
  if (unit.startsWith('億')) return sign * n * 1e8;
  if (unit.startsWith('万')) return sign * n * 1e4;
  if (unit === '円') return sign * n;
  return sign * n; // 単位なし → 1円単位
}

function computeFocusPins(
  nodeId: string,
  nodes: Array<{ id: string; name: string }> | undefined,
): { pinnedProjectId: string | null; pinnedRecipientId: string | null; pinnedMinistryName: string | null } {
  if (nodeId.startsWith('r-')) {
    return { pinnedProjectId: null, pinnedRecipientId: nodeId, pinnedMinistryName: null };
  }
  if (nodeId.startsWith('project-budget-') || nodeId.startsWith('project-spending-')) {
    const spendingId = nodeId.startsWith('project-budget-')
      ? nodeId.replace('project-budget-', 'project-spending-')
      : nodeId;
    return { pinnedProjectId: spendingId, pinnedRecipientId: null, pinnedMinistryName: null };
  }
  if (nodeId.startsWith('ministry-')) {
    return { pinnedProjectId: null, pinnedRecipientId: null, pinnedMinistryName: nodes?.find(n => n.id === nodeId)?.name ?? null };
  }
  return { pinnedProjectId: null, pinnedRecipientId: null, pinnedMinistryName: null };
}

export default function RealDataSankeyPage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topMinistry, setTopMinistry] = useState(37);
  const [topProject, setTopProject] = useState(40);
  const [topRecipient, setTopRecipient] = useState(40);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [projectOffset, setProjectOffset] = useState(0);
  const [offsetTarget, setOffsetTarget] = useState<'recipient' | 'project'>('recipient');
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(null);
  const [pinnedRecipientId, setPinnedRecipientId] = useState<string | null>(null);
  const [pinnedMinistryName, setPinnedMinistryName] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<LayoutLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [hoveredColIndex, setHoveredColIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showAggRecipient, setShowAggRecipient] = useState(true);
  const [showAggProject, setShowAggProject] = useState(true);
  const [projectSortBy, setProjectSortBy] = useState<'budget' | 'spending'>('budget');
  const [scaleBudgetToVisible, setScaleBudgetToVisible] = useState(true);
  const [focusRelated, setFocusRelated] = useState(false);
  const [autoFocusRelated, setAutoFocusRelated] = useState(true);
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isEditingOffset, setIsEditingOffset] = useState(false);
  const [offsetInputValue, setOffsetInputValue] = useState('');
  const [localTopProject, setLocalTopProject] = useState<number | null>(null);
  const [localTopRecipient, setLocalTopRecipient] = useState<number | null>(null);
  const [isEditingTopProject, setIsEditingTopProject] = useState(false);
  const [isEditingTopRecipient, setIsEditingTopRecipient] = useState(false);
  const [topProjectInputValue, setTopProjectInputValue] = useState('');
  const [topRecipientInputValue, setTopRecipientInputValue] = useState('');
  const [showTopNSliders, setShowTopNSliders] = useState(true);
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchCursorIndex, setSearchCursorIndex] = useState(-1);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  // Filter feature
  const [filterActive, setFilterActive] = useState(false);
  const [showAmountSliders, setShowAmountSliders] = useState(false);
  const [filterTarget, setFilterTarget] = useState<'project' | 'recipient'>('recipient');
  const [filterMinistryNames, setFilterMinistryNames] = useState<string[]>([]);
  const [showMinistryDropdown, setShowMinistryDropdown] = useState(false);
  const [ministryDropdownRect, setMinistryDropdownRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const ministryDropdownRef = useRef<HTMLDivElement>(null);
  const ministryButtonRef = useRef<HTMLButtonElement>(null);
  const [filterMinBudgetText, setFilterMinBudgetText] = useState('');
  const [filterMaxBudgetText, setFilterMaxBudgetText] = useState('');
  const [filterMinSpendingText, setFilterMinSpendingText] = useState('');
  const [filterMaxSpendingText, setFilterMaxSpendingText] = useState('');
  const isPidQuery = (q: string) => /^\d+$/.test(q);
  const meetsSearchMinLength = (q: string) => isPidQuery(q) ? q.length >= 1 : q.length >= 2;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  // Tracks whether the next URL update should push (navigation) or replace (slider/toggle)
  const pendingHistoryAction = useRef<'push' | 'replace' | null>(null);
  const pendingFocusId = useRef<string | null>(null);
  const pendingResetViewport = useRef<boolean>(false);
  const pendingConnectionNodeId = useRef<string | null>(null);
  // focusRelated ON中に事業をピンしたときのコンテキスト事業ID
  // projectOffsetMode + r-* 選択後にfocusRelated=OFFしたとき、親事業の特定に使う
  const pinnedContextProjectId = useRef<string | null>(null);
  // Zoom URL state
  const urlRestoredZoomRef = useRef<number | null>(null); // zoom to restore on first layout (no sel= case)
  const zoomRef = useRef(1);                              // always-current zoom for debounce callbacks
  const zoomUrlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Container size (responsive to window)
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(1200);
  const [svgHeight, setSvgHeight] = useState(800);

  useEffect(() => {
    const updateSize = () => {
      const el = containerRef.current;
      if (!el) return;
      setSvgWidth(el.clientWidth);
      setSvgHeight(el.clientHeight);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updateSize);
    return () => { ro.disconnect(); window.removeEventListener('resize', updateSize); };
  }, []);

  // Initialize state from URL on mount
  useEffect(() => {
    const parsed = parseSearchParams(window.location.search);
    // Pre-update prev refs before setters so reset effects don't fire for URL-restored values.
    // The refs are declared below but are accessible here via closure (closures capture by reference).
    if (parsed.offsetTarget !== undefined) prevOffsetTargetRef.current = parsed.offsetTarget;
    if (parsed.projectSortBy !== undefined) prevProjectSortByRef.current = parsed.projectSortBy;
    if (parsed.topProject !== undefined) prevTopProjectRef.current = parsed.topProject;
    if (parsed.selectedNodeId !== undefined) { setSelectedNodeId(parsed.selectedNodeId); pendingFocusId.current = parsed.selectedNodeId; }
    if (parsed.pinnedProjectId !== undefined) setPinnedProjectId(parsed.pinnedProjectId);
    if (parsed.pinnedRecipientId !== undefined) setPinnedRecipientId(parsed.pinnedRecipientId);
    if (parsed.pinnedMinistryName !== undefined) setPinnedMinistryName(parsed.pinnedMinistryName);
    if (parsed.recipientOffset !== undefined) setRecipientOffset(parsed.recipientOffset);
    if (parsed.offsetTarget !== undefined) setOffsetTarget(parsed.offsetTarget);
    if (parsed.projectOffset !== undefined) setProjectOffset(parsed.projectOffset);
    if (parsed.topMinistry !== undefined) setTopMinistry(parsed.topMinistry);
    if (parsed.topProject !== undefined) setTopProject(parsed.topProject);
    if (parsed.topRecipient !== undefined) setTopRecipient(parsed.topRecipient);
    if (parsed.showLabels !== undefined) setShowLabels(parsed.showLabels);
    if (parsed.showAggRecipient !== undefined) setShowAggRecipient(parsed.showAggRecipient);
    if (parsed.showAggProject !== undefined) setShowAggProject(parsed.showAggProject);
    if (parsed.projectSortBy !== undefined) setProjectSortBy(parsed.projectSortBy);
    if (parsed.scaleBudgetToVisible !== undefined) setScaleBudgetToVisible(parsed.scaleBudgetToVisible);
    if (parsed.focusRelated !== undefined) setFocusRelated(parsed.focusRelated);
    if (parsed.autoFocusRelated !== undefined) setAutoFocusRelated(parsed.autoFocusRelated);
    if (parsed.year !== undefined) setYear(parsed.year);
    // Restore zoom only when no sel= (focusOnNeighborhood will handle zoom for sel= case)
    if (parsed.zoom !== undefined && parsed.selectedNodeId === undefined) {
      urlRestoredZoomRef.current = parsed.zoom;
    }
    if (parsed.filterActive !== undefined) setFilterActive(parsed.filterActive);
    if (parsed.filterTarget !== undefined) setFilterTarget(parsed.filterTarget);
    if (parsed.filterNameQuery !== undefined) { setSearchQuery(parsed.filterNameQuery); }
    if (parsed.filterMinistryNames !== undefined) setFilterMinistryNames(parsed.filterMinistryNames);
    if (parsed.filterMinBudgetText !== undefined) setFilterMinBudgetText(parsed.filterMinBudgetText);
    if (parsed.filterMaxBudgetText !== undefined) setFilterMaxBudgetText(parsed.filterMaxBudgetText);
    if (parsed.filterMinSpendingText !== undefined) setFilterMinSpendingText(parsed.filterMinSpendingText);
    if (parsed.filterMaxSpendingText !== undefined) setFilterMaxSpendingText(parsed.filterMaxSpendingText);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only init; state setters and refs are stable
  }, []);

  // Restore state on browser back/forward
  useEffect(() => {
    const handler = () => {
      const parsed = parseSearchParams(window.location.search);
      // Pre-update prev refs so reset effects don't fire for URL-restored values
      prevOffsetTargetRef.current = parsed.offsetTarget ?? 'recipient';
      prevProjectSortByRef.current = parsed.projectSortBy ?? 'budget';
      prevTopProjectRef.current = parsed.topProject ?? 40;
      setSelectedNodeId(parsed.selectedNodeId ?? null);
      setPinnedProjectId(parsed.pinnedProjectId ?? null);
      setPinnedRecipientId(parsed.pinnedRecipientId ?? null);
      setPinnedMinistryName(parsed.pinnedMinistryName ?? null);
      setRecipientOffset(parsed.recipientOffset ?? 0);
      setOffsetTarget(parsed.offsetTarget ?? 'recipient');
      setProjectOffset(parsed.projectOffset ?? 0);
      setTopMinistry(parsed.topMinistry ?? 37);
      setTopProject(parsed.topProject ?? 40);
      setTopRecipient(parsed.topRecipient ?? 40);
      setShowLabels(parsed.showLabels ?? true);
      setShowAggRecipient(parsed.showAggRecipient ?? true);
      setShowAggProject(parsed.showAggProject ?? true);
      setProjectSortBy(parsed.projectSortBy ?? 'budget');
      setScaleBudgetToVisible(parsed.scaleBudgetToVisible ?? true);
      setFocusRelated(parsed.focusRelated ?? false);
      setAutoFocusRelated(parsed.autoFocusRelated ?? true);
      if (parsed.year !== undefined) setYear(parsed.year);
      setFilterActive(parsed.filterActive ?? false);
      if (parsed.filterTarget !== undefined) setFilterTarget(parsed.filterTarget); else setFilterTarget('recipient');
      setSearchQuery(parsed.filterNameQuery ?? '');
      setFilterMinistryNames(parsed.filterMinistryNames ?? []);
      setFilterMinBudgetText(parsed.filterMinBudgetText ?? '');
      setFilterMaxBudgetText(parsed.filterMaxBudgetText ?? '');
      setFilterMinSpendingText(parsed.filterMinSpendingText ?? '');
      setFilterMaxSpendingText(parsed.filterMaxSpendingText ?? '');
      if (parsed.selectedNodeId) pendingResetViewport.current = true;
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL after user actions (push for node selection, replace for sliders/toggles)
  useEffect(() => {
    const action = pendingHistoryAction.current;
    if (action === null) return;
    pendingHistoryAction.current = null;
    const p = new URLSearchParams();
    if (selectedNodeId !== null) p.set('sel', selectedNodeId);
    if (pinnedProjectId !== null) p.set('pp', pinnedProjectId);
    if (pinnedRecipientId !== null) p.set('pr', pinnedRecipientId);
    if (pinnedMinistryName !== null) p.set('pm', pinnedMinistryName);
    if (recipientOffset !== 0) p.set('ro', String(recipientOffset));
    if (offsetTarget === 'project') p.set('ot', 'p');
    if (projectOffset !== 0) p.set('po', String(projectOffset));
    if (topMinistry !== 37) p.set('tm', String(topMinistry));
    if (topProject !== 40) p.set('tp', String(topProject));
    if (topRecipient !== 40) p.set('tr', String(topRecipient));
    if (!showLabels) p.set('sl', '0');
    if (!showAggRecipient) p.set('ar', '0');
    if (!showAggProject) p.set('ap', '0');
    if (projectSortBy === 'spending') p.set('ps', 's');
    if (!scaleBudgetToVisible) p.set('sb', '0');
    if (focusRelated) p.set('fr', '1');
    if (!autoFocusRelated) p.set('afr', '0');
    if (year !== '2025') p.set('yr', year);
    if (filterActive) p.set('f', '1');
    if (filterTarget === 'project') p.set('nft', 'p');
    if (filterActive && searchQuery) p.set('nf', searchQuery);
    for (const name of filterMinistryNames) p.append('fm', name);
    if (filterMinBudgetText) p.set('fmb', filterMinBudgetText);
    if (filterMaxBudgetText) p.set('fxb', filterMaxBudgetText);
    if (filterMinSpendingText) p.set('fms', filterMinSpendingText);
    if (filterMaxSpendingText) p.set('fxs', filterMaxSpendingText);
    const qs = p.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    if (action === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
  }, [selectedNodeId, pinnedProjectId, pinnedRecipientId, pinnedMinistryName, recipientOffset, offsetTarget, projectOffset, topMinistry, topProject, topRecipient, showLabels, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, autoFocusRelated, year, filterActive, filterTarget, filterMinistryNames, searchQuery, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText]);

  // Keep zoomRef in sync for debounce callbacks
  // (declared before zoom state so the effect below can reference it)

  // Zoom/Pan state
  const [zoom, setZoom] = useState(1);
  // Keep zoomRef current for use in debounce timeouts
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    if (!showMinistryDropdown) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ministryDropdownRef.current && !ministryDropdownRef.current.contains(e.target as Node)) {
        setShowMinistryDropdown(false);
      }
    };
    const recompute = () => {
      if (ministryButtonRef.current) {
        const r = ministryButtonRef.current.getBoundingClientRect();
        setMinistryDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [showMinistryDropdown]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const didPanRef = useRef(false);
  const offsetRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopOffsetRepeat = useCallback(() => {
    if (offsetRepeatRef.current !== null) { clearTimeout(offsetRepeatRef.current); clearInterval(offsetRepeatRef.current); offsetRepeatRef.current = null; }
  }, []);
  useEffect(() => {
    const onBlur = () => stopOffsetRepeat();
    window.addEventListener('blur', onBlur);
    return () => { stopOffsetRepeat(); window.removeEventListener('blur', onBlur); };
  }, [stopOffsetRepeat]);

  const topNRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTopNRepeat = useCallback(() => {
    if (topNRepeatRef.current !== null) { clearTimeout(topNRepeatRef.current); clearInterval(topNRepeatRef.current); topNRepeatRef.current = null; }
  }, []);
  useEffect(() => {
    const onBlur = () => stopTopNRepeat();
    window.addEventListener('blur', onBlur);
    return () => { stopTopNRepeat(); window.removeEventListener('blur', onBlur); };
  }, [stopTopNRepeat]);

  // Reset both offsets when offsetTarget switches
  // Reset offsets and sync URL when filter conditions change
  const filterSigInitRef = useRef(false);
  useEffect(() => {
    if (!filterSigInitRef.current) { filterSigInitRef.current = true; return; }
    pendingHistoryAction.current = 'replace';
    setRecipientOffset(0);
    setProjectOffset(0);
  }, [filterActive, filterTarget, filterMinistryNames, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText, debouncedQuery]);

  // Sync URL when filter name query changes (separate from above to avoid double reset)
  const filterQueryInitRef = useRef(false);
  useEffect(() => {
    if (!filterQueryInitRef.current) { filterQueryInitRef.current = true; return; }
    pendingHistoryAction.current = 'replace';
  }, [searchQuery]);

  const prevOffsetTargetRef = useRef(offsetTarget);
  useEffect(() => {
    if (prevOffsetTargetRef.current !== offsetTarget) {
      prevOffsetTargetRef.current = offsetTarget;
      pendingHistoryAction.current = 'replace';
      setRecipientOffset(0);
      setProjectOffset(0);
    }
  }, [offsetTarget]);

  // Reset projectOffset when projectSortBy changes (ranking order changes)
  const prevProjectSortByRef = useRef(projectSortBy);
  useEffect(() => {
    if (prevProjectSortByRef.current !== projectSortBy) {
      prevProjectSortByRef.current = projectSortBy;
      if (offsetTarget === 'project') {
        pendingHistoryAction.current = 'replace';
        setProjectOffset(0);
      }
    }
  }, [projectSortBy, offsetTarget]);

  // Reset projectOffset when topProject changes (only in project offset mode)
  const prevTopProjectRef = useRef(topProject);
  useEffect(() => {
    if (prevTopProjectRef.current !== topProject) {
      prevTopProjectRef.current = topProject;
      if (offsetTarget === 'project') {
        pendingHistoryAction.current = 'replace';
        setProjectOffset(0);
      }
    }
  }, [topProject, offsetTarget]);

  const svgRef = useRef<SVGSVGElement>(null);

  // Prevent overlay control interactions from bubbling into canvas pan/zoom
  const isOverlayControlTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('[data-pan-disabled],button,input,select,textarea,label');

  // Debounced zoom URL write — called only on explicit user zoom (wheel / buttons)
  const scheduleZoomUrlWrite = useCallback(() => {
    if (zoomUrlDebounceRef.current) clearTimeout(zoomUrlDebounceRef.current);
    zoomUrlDebounceRef.current = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      p.set('z', zoomRef.current.toFixed(2));
      const qs = p.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }, 500);
  }, []);
  // Cancel pending zoom URL write on unmount to avoid mutating the next page's history
  useEffect(() => {
    return () => { if (zoomUrlDebounceRef.current) { clearTimeout(zoomUrlDebounceRef.current); zoomUrlDebounceRef.current = null; } };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isOverlayControlTarget(e.target)) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const doZoom = (dy: number) => {
      const delta = dy > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.2, Math.min(baseZoom * 10, zoom * delta));
      const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
      const newPanY = my - (my - pan.y) * (newZoom / zoom);
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
      scheduleZoomUrlWrite();
    };

    if (scrollMode === 'zoom') {
      doZoom(e.deltaY);
    } else {
      // 移動モード: Ctrl/Cmd+scroll = zoom、それ以外 = pan
      if (e.ctrlKey || e.metaKey) {
        doZoom(e.deltaY);
      } else {
        const speed = 1.2;
        setPan(prev => ({ x: prev.x - e.deltaX * speed, y: prev.y - e.deltaY * speed }));
      }
    }
  }, [zoom, pan, baseZoom, scheduleZoomUrlWrite, scrollMode]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isOverlayControlTarget(e.target)) return; // left click only
    didPanRef.current = false;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { ...pan };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true;
    setPan({
      x: panOrigin.current.x + dx,
      y: panOrigin.current.y + dy,
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const layoutRef = useRef<{ contentW: number; contentH: number } | null>(null);

  // Top offset reserved for the search box (top:12 + height:36 + gap:8)
  const SEARCH_BOX_RESERVE = 56;

  const resetView = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    setRecipientOffset(0);
    if (container && l) {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const totalW = MARGIN.left + l.contentW;
      const totalH = MARGIN.top + l.contentH;
      const availH = cH - SEARCH_BOX_RESERVE;
      const k = Math.max(0.2, Math.min(10, Math.min(cW / totalW, availH / totalH) * 0.9));
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: (cW - totalW * k) / 2, y: SEARCH_BOX_RESERVE + (availH - totalH * k) / 2 });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: SEARCH_BOX_RESERVE });
    }
  }, []);

  // Viewport-only reset (zoom/pan only, recipientOffset unchanged)
  const resetViewport = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    if (container && l) {
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const totalW = MARGIN.left + l.contentW;
      const totalH = MARGIN.top + l.contentH;
      const availH = cH - SEARCH_BOX_RESERVE;
      const k = Math.max(0.2, Math.min(10, Math.min(cW / totalW, availH / totalH) * 0.9));
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: (cW - totalW * k) / 2, y: SEARCH_BOX_RESERVE + (availH - totalH * k) / 2 });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: SEARCH_BOX_RESERVE });
    }
  }, []);

  // Minimap refs (hooks must be unconditional)
  const MINIMAP_W = 200;
  const minimapH = Math.round(MINIMAP_W * (svgHeight / (svgWidth || 1)));
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDragging = useRef(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Layout constants for bottom-right widgets the dropdown must clear
  const MINIMAP_BOTTOM = 8;       // minimap wrapper bottom offset
  const MINIMAP_BUFFER = 32;      // extra clearance above minimap when visible
  const MAP_ICON_BOTTOM = 32;     // bottom clearance for map icon (includes extra margin)
  const MAP_ICON_HEIGHT = 32;     // map icon button height
  const MAP_ICON_GAP = 8;         // gap between map icon and dropdown bottom
  const DROPDOWN_GAP = 12;        // gap between search box bottom and dropdown top

  const [searchBoxBottom, setSearchBoxBottom] = useState(52); // 12 (top) + ~40 (approx height)
  useLayoutEffect(() => {
    const measure = () => {
      const r = searchBoxRef.current?.getBoundingClientRect();
      if (r) setSearchBoxBottom(r.bottom);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (searchBoxRef.current) ro.observe(searchBoxRef.current);
    return () => ro.disconnect();
  }, [showAmountSliders, filterActive]);

  const searchDropdownMaxH = useMemo(() => {
    const obstacleTop = showMinimap
      ? svgHeight - MINIMAP_BOTTOM - MINIMAP_BUFFER - minimapH
      : svgHeight - MAP_ICON_BOTTOM - MAP_ICON_HEIGHT - MAP_ICON_GAP;
    return Math.max(120, obstacleTop - searchBoxBottom - DROPDOWN_GAP);
  }, [svgHeight, minimapH, showMinimap, searchBoxBottom]);

  useEffect(() => {
    setGraphData(null);
    setLoading(true);
    setError(null);
    fetch(`/data/sankey-svg-${year}-graph.json`)
      .then(res => {
        if (!res.ok) throw new Error(`Fetch error: ${res.status}`);
        return res.json();
      })
      .then(data => { setGraphData(data); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [year]);

  // Max values for filter sliders (in 億円)
  const graphDataStats = useMemo(() => {
    if (!graphData) return { maxBudget: 100000, maxSpending: 100000 };
    let mb = 0, ms = 0;
    for (const n of graphData.nodes) {
      if (n.type === 'project-budget') mb = Math.max(mb, n.value);
      else if (n.type === 'project-spending' || n.type === 'recipient') ms = Math.max(ms, n.value);
    }
    return {
      maxBudget: Math.max(1000, Math.ceil(mb / 1e8 / 1000) * 1000),
      maxSpending: Math.max(1000, Math.ceil(ms / 1e8 / 1000) * 1000),
    };
  }, [graphData]);

  // Shared lookup: projectId → project-budget node (depends only on graphData)
  const budgetNodeByPid = useMemo(() => {
    const m = new Map<number, NonNullable<typeof graphData>['nodes'][number]>();
    if (!graphData) return m;
    for (const n of graphData.nodes) {
      if (n.type === 'project-budget' && n.projectId != null) m.set(n.projectId, n);
    }
    return m;
  }, [graphData]);

  // Pre-filter exclusion set: built from filter conditions, applied before filterTopN
  const filterExcludedIds = useMemo(() => {
    if (!graphData) return null;
    const minBudgetYen = parseAmountToYen(filterMinBudgetText);
    const maxBudgetYen = parseAmountToYen(filterMaxBudgetText);
    const minSpendingYen = parseAmountToYen(filterMinSpendingText);
    const maxSpendingYen = parseAmountToYen(filterMaxSpendingText);
    const hasBudget = minBudgetYen !== null || maxBudgetYen !== null;
    const hasSpending = minSpendingYen !== null || maxSpendingYen !== null;
    const trimmedQuery = debouncedQuery.trim();
    const hasName = filterActive && trimmedQuery.length >= 1;
    const hasMinistry = filterMinistryNames.length > 0;
    if (!hasBudget && !hasSpending && !hasName && !hasMinistry) return null;
    const selectedMinistrySet = new Set(filterMinistryNames);
    const minBudget = minBudgetYen ?? -Infinity;
    const maxBudget = maxBudgetYen ?? Infinity;
    const minSpending = minSpendingYen ?? 0;
    const maxSpending = maxSpendingYen ?? Infinity;
    let nameRegex: RegExp | null = null;
    if (hasName && searchUseRegex) {
      try { nameRegex = new RegExp(trimmedQuery, 'i'); } catch { /* invalid regex */ }
    }
    const trimmedQueryLower = trimmedQuery.toLocaleLowerCase();
    const matchesName = (name: string) => nameRegex ? nameRegex.test(name) : name.toLocaleLowerCase().includes(trimmedQueryLower);
    const excluded = new Set<string>();
    const spendingByPid = new Map(
      graphData.nodes.filter(n => n.type === 'project-spending' && n.projectId != null).map(n => [n.projectId!, n])
    );
    for (const n of graphData.nodes) {
      if (n.aggregated) continue;
      if (n.type === 'project-budget' && n.projectId != null) {
        const sn = spendingByPid.get(n.projectId);
        const failBudget = hasBudget && (n.value < minBudget || n.value > maxBudget);
        const failName = hasName && filterTarget === 'project' && !matchesName(n.name);
        const failMinistry = hasMinistry && !selectedMinistrySet.has(n.ministry ?? '');
        if (failBudget || failName || failMinistry) { excluded.add(n.id); if (sn) excluded.add(sn.id); }
      } else if (n.type === 'recipient') {
        const failSpending = hasSpending && (n.value < minSpending || n.value > maxSpending);
        const failName = hasName && filterTarget === 'recipient' && !matchesName(n.name);
        if (failSpending || failName) excluded.add(n.id);
      }
    }
    // Pass 2: 支出先・予算フィルタが有効な場合、残存支出先のない事業／孤立支出先を除外
    if (hasSpending || hasBudget || hasMinistry || (hasName && filterTarget === 'recipient')) {
      const projectsWithSurvivingRecipients = new Set(
        graphData.edges
          .filter(e => e.target.startsWith('r-') && !excluded.has(e.target))
          .map(e => e.source)
      );
      for (const [pid, sn] of spendingByPid) {
        if (!excluded.has(sn.id) && !projectsWithSurvivingRecipients.has(sn.id)) {
          excluded.add(sn.id);
          const bn = budgetNodeByPid.get(pid);
          if (bn) excluded.add(bn.id);
        }
      }
    }
    // ゼロ予算事業は graph 生成時に ministry→project-budget エッジを持たないため Pass 3 で
    // 省庁保護ロジックを切り替える必要がある。minBudget > 0 の場合は failBudget が除外済み。
    const excludeZeroBudget = hasBudget && minBudget > 0;
    // Pass 3: 残存事業のない省庁を除外（project → ministry のカスケード）
    const ministriesWithSurvivingProjects = new Set(
      graphData.edges
        .filter(e => !excluded.has(e.source) && !excluded.has(e.target) && e.target.startsWith('project-budget-'))
        .map(e => e.source)
    );
    // ゼロ予算事業がいる可能性がある場合（excludeZeroBudget=false）は、
    // ministry→project-budgetエッジが存在しないため、生き残ったproject-spendingノードから省庁を保護する。
    if (!excludeZeroBudget) {
      for (const n of graphData.nodes) {
        if (n.type === 'project-spending' && !excluded.has(n.id) && n.value > 0 && n.ministry) {
          ministriesWithSurvivingProjects.add(`ministry-${n.ministry}`);
        }
      }
    }
    for (const n of graphData.nodes) {
      if (n.type === 'ministry' && !n.aggregated && !excluded.has(n.id)) {
        if (!ministriesWithSurvivingProjects.has(n.id)) excluded.add(n.id);
      }
    }
    return excluded.size > 0 ? excluded : null;
  }, [graphData, filterActive, filterTarget, filterMinistryNames, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText, debouncedQuery, searchUseRegex]);

  const filtered = useMemo(() => {
    if (!graphData) return null;
    // Apply pre-filter: remove excluded nodes and their edges before TopN selection
    const nodes = filterExcludedIds
      ? graphData.nodes.filter(n => !filterExcludedIds.has(n.id))
      : graphData.nodes;
    const edges = filterExcludedIds
      ? graphData.edges.filter(e => !filterExcludedIds.has(e.source) && !filterExcludedIds.has(e.target))
      : graphData.edges;
    const maxOffset = Math.max(0, (nodes.filter(n => n.type === 'recipient').length) - topRecipient);
    const clampedOffset = Math.min(recipientOffset, maxOffset);
    return filterTopN(nodes, edges, topMinistry, topProject, topRecipient, clampedOffset, pinnedProjectId, true, showAggRecipient, showAggProject, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset, projectSortBy);
  }, [graphData, topMinistry, topProject, topRecipient, recipientOffset, pinnedProjectId, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset, filterExcludedIds]);

  const layout = useMemo(() => {
    if (!filtered) return null;
    if (!showLabels) {
      const result = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight);
      layoutRef.current = { contentW: result.contentW, contentH: result.contentH };
      return result;
    }
    // Two-pass: estimate fit zoom from ungapped layout, derive stable minNodeGap from it.
    // This breaks the zoom→minNodeGap→layout→zoom feedback loop.
    const noGap = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight);
    const availH = Math.max(100, svgHeight - SEARCH_BOX_RESERVE);
    const fitZoom = Math.max(0.1, Math.min(10,
      Math.min(svgWidth / (MARGIN.left + noGap.contentW), availH / (MARGIN.top + noGap.contentH)) * 0.9
    ));
    const result = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight, 14 / fitZoom);
    layoutRef.current = { contentW: result.contentW, contentH: result.contentH };
    return result;
  }, [filtered, svgWidth, svgHeight, showLabels]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    // First: try current layout
    const layoutNode = layout?.nodes.find(n => n.id === selectedNodeId) ?? null;
    if (layoutNode) return layoutNode;
    // Fallback: synthesize from graphData for nodes outside current layout
    // (ministry/project not in TopN — panel shows info but no highlight)
    const rawNode = graphData?.nodes.find(n => n.id === selectedNodeId) ?? null;
    if (!rawNode) return null;
    return { ...rawNode, x0: 0, x1: 0, y0: 0, y1: 0, sourceLinks: [], targetLinks: [] } as LayoutNode;
  }, [selectedNodeId, layout, graphData]);

  // The selected node in the current layout (null if not in layout)
  const selectedNodeInLayout = useMemo(
    () => (selectedNodeId !== null ? (layout?.nodes.find(n => n.id === selectedNodeId) ?? null) : null),
    [selectedNodeId, layout],
  );

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeInLayout) return null;
    const ids = new Set<string>();
    // BFS upstream (follow targetLinks → source recursively) — separate visited set
    const uVisited = new Set<string>();
    const uQueue = [selectedNodeInLayout];
    while (uQueue.length) {
      const n = uQueue.shift()!;
      if (uVisited.has(n.id)) continue;
      uVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.targetLinks) if (!uVisited.has(l.source.id)) uQueue.push(l.source);
    }
    // BFS downstream (follow sourceLinks → target recursively) — separate visited set
    const dVisited = new Set<string>();
    const dQueue = [selectedNodeInLayout];
    while (dQueue.length) {
      const n = dQueue.shift()!;
      if (dVisited.has(n.id)) continue;
      dVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.sourceLinks) if (!dVisited.has(l.target.id)) dQueue.push(l.target);
    }
    return ids;
  }, [selectedNodeInLayout]);

  // Connected node IDs for hovered node (upstream + downstream BFS)
  const hoveredNodeIds = useMemo(() => {
    if (!hoveredNode || selectedNode) return null;
    const ids = new Set<string>();
    const uVisited = new Set<string>();
    const uQueue = [hoveredNode];
    while (uQueue.length) {
      const n = uQueue.shift()!;
      if (uVisited.has(n.id)) continue;
      uVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.targetLinks) if (!uVisited.has(l.source.id)) uQueue.push(l.source);
    }
    const dVisited = new Set<string>();
    const dQueue = [hoveredNode];
    while (dQueue.length) {
      const n = dQueue.shift()!;
      if (dVisited.has(n.id)) continue;
      dVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.sourceLinks) if (!dVisited.has(l.target.id)) dQueue.push(l.target);
    }
    return ids;
  }, [hoveredNode, selectedNode]);

  // Spending partner of the currently hovered merged project node (for link highlight)
  const hoveredPartnerSpendingId = hoveredNode?.type === 'project-budget' && hoveredNode.projectId != null
    ? `project-spending-${hoveredNode.projectId}`
    : hoveredNode?.id === '__agg-project-budget' ? '__agg-project-spending' : null;

  // Per-ministry project stats — for total/ministry node side panel
  type ProjectStat = { pid: number; name: string; budgetId: string; spendingId: string; budgetValue: number; spendingValue: number };
  type MinistryStat = { total: number; budgetTotal: number; spendingTotal: number; budgetOnly: number; spendingOnly: number; neither: number; projects: ProjectStat[] };
  const ministryProjectStats = useMemo(() => {
    if (!graphData) return new Map<string, MinistryStat>();
    const spendingByPid = new Map(
      graphData.nodes
        .filter((n): n is typeof n & { projectId: number } => n.type === 'project-spending' && n.projectId != null)
        .map(n => [n.projectId, n] as const)
    );
    const stats = new Map<string, MinistryStat>();
    for (const n of graphData.nodes) {
      if (n.type !== 'project-budget' || !n.projectId || !n.ministry) continue;
      const sn = spendingByPid.get(n.projectId);
      const b = n.value;
      const s = sn?.value ?? 0;
      const m = n.ministry;
      if (!stats.has(m)) stats.set(m, { total: 0, budgetTotal: 0, spendingTotal: 0, budgetOnly: 0, spendingOnly: 0, neither: 0, projects: [] });
      const st = stats.get(m)!;
      st.total++;
      st.budgetTotal += b;
      st.spendingTotal += s;
      if (b === 0 && s === 0) st.neither++;
      else if (b === 0) st.spendingOnly++;
      else if (s === 0) st.budgetOnly++;
      st.projects.push({ pid: n.projectId, name: n.name, budgetId: n.id, spendingId: sn?.id ?? `project-spending-${n.projectId}`, budgetValue: b, spendingValue: s });
    }
    return stats;
  }, [graphData]);

  // Global recipient rank (0-indexed, value-descending) — for offset jump
  const allRecipientRanks = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const amounts = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target.startsWith('r-')) amounts.set(e.target, (amounts.get(e.target) || 0) + e.value);
    }
    const sorted = Array.from(amounts.entries()).sort((a, b) => b[1] - a[1]);
    return new Map(sorted.map(([id], i) => [id, i]));
  }, [graphData]);

  // Global project rank (0-indexed) — for projectOffset jump
  const allProjectRanks = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const budgetValues = new Map<string, number>(
      graphData.nodes
        .filter(n => n.type === 'project-budget' && n.projectId != null)
        .map(n => [`project-spending-${n.projectId}`, n.value] as const)
    );
    const ranked = graphData.nodes
      .filter(n => n.type === 'project-spending')
      .sort((a, b) => {
        if (projectSortBy === 'budget') {
          const ba = budgetValues.get(a.id) ?? 0;
          const bb = budgetValues.get(b.id) ?? 0;
          if (bb !== ba) return bb - ba;
        }
        return b.value - a.value;
      });
    return new Map(ranked.map((n, i) => [n.id, i]));
  }, [graphData, projectSortBy]);

  // Recipient count per project-spending node (from raw graphData)
  const projectRecipientCount = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const countMap = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target.startsWith('r-')) countMap.set(e.source, (countMap.get(e.source) || 0) + 1);
    }
    return countMap;
  }, [graphData]);

  // Panel sections — 3-tab data (府省庁 / 事業 / 支出先)
  type PanelEntry = { id: string; name: string; value: number; ministry?: string; aggregated?: boolean; budgetValue?: number; spendingValue?: number; recipientCount?: number; projectCount?: number; };
  type PanelSections = { ministries: PanelEntry[]; projects: PanelEntry[]; recipients: PanelEntry[]; };
  const panelSections = useMemo((): PanelSections | null => {
    if (!selectedNode || !graphData) return null;
    const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
    const spendingByPid = new Map(
      graphData.nodes
        .filter((n): n is typeof n & { projectId: number } => n.type === 'project-spending' && n.projectId != null)
        .map(n => [n.projectId, n] as const)
    );
    const toProjectEntry = (budgetNode: { id: string; name: string; value: number; projectId?: number; ministry?: string }): PanelEntry => {
      const sn = budgetNode.projectId != null ? spendingByPid.get(budgetNode.projectId) : undefined;
      const spId = sn?.id ?? (budgetNode.projectId != null ? `project-spending-${budgetNode.projectId}` : budgetNode.id);
      return { id: budgetNode.id, name: budgetNode.name, value: sn?.value ?? 0, ministry: budgetNode.ministry, budgetValue: budgetNode.value, spendingValue: sn?.value ?? 0, recipientCount: projectRecipientCount.get(spId) };
    };

    const nid = selectedNode.id;
    const ntype = selectedNode.type;

    // ── Precompute per-ministry project/recipient counts (used by total & ministry) ──
    const ministryProjectCounts = new Map<string, number>();
    const ministrySpendingIdsMap = new Map<string, Set<string>>();
    const ministrySpendingTotals = new Map<string, number>();
    for (const n of graphData.nodes) {
      if (n.type === 'project-budget' && n.ministry) ministryProjectCounts.set(n.ministry, (ministryProjectCounts.get(n.ministry) || 0) + 1);
      if (n.type === 'project-spending' && n.ministry) {
        if (!ministrySpendingIdsMap.has(n.ministry)) ministrySpendingIdsMap.set(n.ministry, new Set());
        ministrySpendingIdsMap.get(n.ministry)!.add(n.id);
        ministrySpendingTotals.set(n.ministry, (ministrySpendingTotals.get(n.ministry) || 0) + n.value);
      }
    }
    const ministryRecipientCounts = new Map<string, number>();
    for (const [ministry, spIds] of ministrySpendingIdsMap) {
      const rSet = new Set<string>();
      for (const e of graphData.edges) { if (spIds.has(e.source) && e.target.startsWith('r-')) rSet.add(e.target); }
      ministryRecipientCounts.set(ministry, rSet.size);
    }

    // ── total ──────────────────────────────────────────────────────────
    if (ntype === 'total') {
      const ministries: PanelEntry[] = graphData.nodes.filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value).map(n => ({
        id: n.id, name: n.name, value: n.value, budgetValue: n.value, spendingValue: ministrySpendingTotals.get(n.name) ?? 0,
        projectCount: ministryProjectCounts.get(n.name), recipientCount: ministryRecipientCounts.get(n.name),
      }));
      const projects: PanelEntry[] = graphData.nodes.filter(n => n.type === 'project-budget').map(toProjectEntry).sort((a, b) => { const bv = (b.budgetValue ?? 0) - (a.budgetValue ?? 0); return bv !== 0 ? bv : (b.spendingValue ?? b.value) - (a.spendingValue ?? a.value); });
      const windowRecipients = (filtered?.nodes ?? []).filter(n => n.type === 'recipient').map(n => ({ id: n.id, name: n.name, value: n.value }));
      const aggRecipients = (filtered?.aggNodeMembers?.get('__agg-recipient') ?? []).map(r => ({ id: r.id, name: r.name, value: r.value }));
      const recipients: PanelEntry[] = [...windowRecipients, ...aggRecipients].sort((a, b) => b.value - a.value);
      return { ministries, projects, recipients };
    }

    // ── ministry ───────────────────────────────────────────────────────
    if (ntype === 'ministry') {
      const projects: PanelEntry[] = graphData.nodes
        .filter(n => n.type === 'project-budget' && n.ministry === selectedNode.name)
        .map(toProjectEntry)
        .sort((a, b) => { const bv = (b.budgetValue ?? 0) - (a.budgetValue ?? 0); return bv !== 0 ? bv : (b.spendingValue ?? b.value) - (a.spendingValue ?? a.value); });
      const ministrySpendingIds = ministrySpendingIdsMap.get(selectedNode.name) ?? new Set<string>();
      const rMap = new Map<string, number>();
      for (const e of graphData.edges) { if (ministrySpendingIds.has(e.source) && e.target.startsWith('r-')) rMap.set(e.target, (rMap.get(e.target) || 0) + e.value); }
      const recipients: PanelEntry[] = Array.from(rMap.entries()).sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ id, name: nodeById.get(id)?.name ?? id, value }));
      const ministries: PanelEntry[] = [{ id: selectedNode.id, name: selectedNode.name, value: selectedNode.value, budgetValue: selectedNode.value, spendingValue: ministrySpendingTotals.get(selectedNode.name) ?? 0, projectCount: projects.length, recipientCount: recipients.length }];
      return { ministries, projects, recipients };
    }

    // ── project-budget / project-spending (non-aggregated) ─────────────
    if ((ntype === 'project-budget' || ntype === 'project-spending') && !selectedNode.aggregated) {
      const pid = selectedNode.projectId;
      const budgetNode = ntype === 'project-budget' ? nodeById.get(nid) : (pid != null ? budgetNodeByPid.get(pid) : undefined);
      const spendingNode = pid != null ? spendingByPid.get(pid) : undefined;
      const ministryName = selectedNode.ministry ?? budgetNode?.ministry ?? spendingNode?.ministry;
      const ministryNode = ministryName ? graphData.nodes.find(n => n.type === 'ministry' && n.name === ministryName) : undefined;
      const ministries: PanelEntry[] = ministryNode ? [{ id: ministryNode.id, name: ministryNode.name, value: ministryNode.value, budgetValue: ministryNode.value, spendingValue: ministrySpendingTotals.get(ministryNode.name) ?? 0 }] : [];
      const bValue = budgetNode?.value ?? 0;
      const sValue = spendingNode?.value ?? 0;
      const spId = spendingNode?.id ?? (pid != null ? `project-spending-${pid}` : nid);
      const projects: PanelEntry[] = [{ id: nid, name: selectedNode.name, value: sValue, ministry: ministryName, budgetValue: bValue, spendingValue: sValue, recipientCount: projectRecipientCount.get(spId) }];
      const recipients: PanelEntry[] = [];
      if (spendingNode) {
        for (const e of graphData.edges) { if (e.source === spendingNode.id && e.target.startsWith('r-')) recipients.push({ id: e.target, name: nodeById.get(e.target)?.name ?? e.target, value: e.value }); }
        recipients.sort((a, b) => b.value - a.value);
      }
      return { ministries, projects, recipients };
    }

    // ── __agg-project-budget / __agg-project-spending ──────────────────
    if (nid === '__agg-project-budget' || nid === '__agg-project-spending') {
      const aggBudgetMembers = filtered?.aggNodeMembers?.get('__agg-project-budget') ?? [];
      const aggSpendingMembers = filtered?.aggNodeMembers?.get('__agg-project-spending') ?? [];
      const mMap = new Map<string, number>();
      for (const m of aggBudgetMembers) { if (m.ministry) mMap.set(m.ministry, (mMap.get(m.ministry) || 0) + m.value); }
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value, budgetValue: value, spendingValue: ministrySpendingTotals.get(name) ?? 0 }; });
      const projects: PanelEntry[] = aggBudgetMembers.map(m => { const bn = nodeById.get(m.id); return bn ? toProjectEntry(bn) : { id: m.id, name: m.name, value: m.value, ministry: m.ministry }; }).sort((a, b) => { const bv = (b.budgetValue ?? 0) - (a.budgetValue ?? 0); return bv !== 0 ? bv : (b.spendingValue ?? b.value) - (a.spendingValue ?? a.value); });
      const rMap = new Map<string, { name: string; value: number }>();
      for (const sm of aggSpendingMembers) { for (const e of graphData.edges) { if (e.source === sm.id && e.target.startsWith('r-')) { const prev = rMap.get(e.target); if (prev) prev.value += e.value; else rMap.set(e.target, { name: nodeById.get(e.target)?.name ?? e.target, value: e.value }); } } }
      const recipients: PanelEntry[] = Array.from(rMap.entries()).sort((a, b) => b[1].value - a[1].value).map(([id, { name, value }]) => ({ id, name, value }));
      return { ministries, projects, recipients };
    }

    // ── recipient (non-aggregated) ──────────────────────────────────────
    if (ntype === 'recipient' && !selectedNode.aggregated) {
      const pMap = new Map<string, number>();
      for (const e of graphData.edges) { if (e.target === nid) pMap.set(e.source, (pMap.get(e.source) || 0) + e.value); }
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => { const n = nodeById.get(id); const bn = n?.projectId != null ? nodeById.get(`project-budget-${n.projectId}`) : null; return { id, name: n?.name ?? id, value, ministry: n?.ministry, budgetValue: bn?.value, spendingValue: n?.value }; }).sort((a, b) => b.value - a.value);
      const mMap = new Map<string, number>();
      for (const p of projects) { if (p.ministry) mMap.set(p.ministry, (mMap.get(p.ministry) || 0) + p.value); }
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value, budgetValue: mn?.value, spendingValue: ministrySpendingTotals.get(name) ?? 0 }; });
      const recipients: PanelEntry[] = [{ id: nid, name: selectedNode.name, value: selectedNode.value }];
      return { ministries, projects, recipients };
    }

    // ── __agg-recipient ────────────────────────────────────────────────
    if (nid === '__agg-recipient') {
      const aggRcpts = filtered?.aggNodeMembers?.get('__agg-recipient') ?? [];
      const pMap = new Map<string, number>();
      for (const r of aggRcpts) { for (const e of graphData.edges) { if (e.target === r.id) pMap.set(e.source, (pMap.get(e.source) || 0) + e.value); } }
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => { const n = nodeById.get(id); const bn = n?.projectId != null ? nodeById.get(`project-budget-${n.projectId}`) : null; return { id, name: n?.name ?? id, value, ministry: n?.ministry, budgetValue: bn?.value, spendingValue: n?.value }; }).sort((a, b) => b.value - a.value);
      const mMap = new Map<string, number>();
      for (const p of projects) { if (p.ministry) mMap.set(p.ministry, (mMap.get(p.ministry) || 0) + p.value); }
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value, budgetValue: mn?.value, spendingValue: ministrySpendingTotals.get(name) ?? 0 }; });
      const recipients: PanelEntry[] = aggRcpts.map(r => ({ id: r.id, name: r.name, value: r.value }));
      return { ministries, projects, recipients };
    }

    // ── __agg-ministry ─────────────────────────────────────────────────
    if (nid === '__agg-ministry') {
      const aggMins = filtered?.aggNodeMembers?.get('__agg-ministry') ?? [];
      const ministries: PanelEntry[] = aggMins.map(m => ({ id: m.id, name: m.name, value: m.value, budgetValue: m.value, spendingValue: ministrySpendingTotals.get(m.name) ?? 0 }));
      const aggMinNames = new Set(aggMins.map(m => m.name));
      const projects: PanelEntry[] = graphData.nodes.filter(n => n.type === 'project-budget' && n.ministry != null && aggMinNames.has(n.ministry!)).sort((a, b) => b.value - a.value).map(toProjectEntry);
      const spIds = new Set(graphData.nodes.filter(n => n.type === 'project-spending' && n.ministry != null && aggMinNames.has(n.ministry!)).map(n => n.id));
      const rMap = new Map<string, number>();
      for (const e of graphData.edges) { if (spIds.has(e.source) && e.target.startsWith('r-')) rMap.set(e.target, (rMap.get(e.target) || 0) + e.value); }
      const recipients: PanelEntry[] = Array.from(rMap.entries()).sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ id, name: nodeById.get(id)?.name ?? id, value }));
      return { ministries, projects, recipients };
    }

    return { ministries: [], projects: [], recipients: [] };
  }, [selectedNode, graphData, filtered, projectRecipientCount]);

  const [isProjectDetailExpanded, setIsProjectDetailExpanded] = useState(false);
  const [projectDetailCache, setProjectDetailCache] = useState<Map<string, ProjectDetail | null>>(new Map());
  const [panelTab, setPanelTab] = useState<'ministry' | 'project' | 'recipient'>('ministry');
  // Auto-select panel tab based on selected node type.
  // selectedNode is derived from selectedNodeId and won't change for the same id
  // when only layout/graphData updates, so it is intentionally excluded from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = selectedNode?.type; const id = selectedNode?.id;
    let tab: 'ministry' | 'project' | 'recipient' = 'ministry';
    if (t === 'total') tab = 'ministry';
    else if (t === 'ministry') tab = 'project';
    else if (id === '__agg-ministry') tab = 'ministry';
    else if (t === 'project-budget' || t === 'project-spending') tab = 'recipient';
    else if (id === '__agg-project-budget' || id === '__agg-project-spending') tab = 'project';
    else if (t === 'recipient') tab = 'project';
    else if (id === '__agg-recipient') tab = 'recipient';
    setPanelTab(tab);
  }, [selectedNodeId]);

  const selectNode = useCallback((id: string | null, forceReplace?: boolean) => {
    // User-initiated select/deselect both push to history so back/forward works naturally.
    // Auto-deselect (stale node cleanup) passes forceReplace=true to avoid polluting history.
    pendingHistoryAction.current = forceReplace ? 'replace' : 'push';
    setSelectedNodeId(id);
    setIsProjectDetailExpanded(false);
    if (id === null) { setPinnedProjectId(null); setPinnedRecipientId(null); setPinnedMinistryName(null); setFocusRelated(false); }
  }, [setPinnedRecipientId, setPinnedMinistryName, setIsProjectDetailExpanded]);

  // Auto-clear stale selection when node no longer exists in graphData at all
  // Guard: skip while graphData is loading to avoid clearing URL-restored selection
  useEffect(() => {
    if (!graphData) return;
    if (selectedNodeId !== null && !selectedNode) {
      selectNode(null, true); // forceReplace: don't push to history for automatic cleanup
    }
  }, [selectedNode, selectedNodeId, selectNode, graphData]);

  // Pre-fetch project detail on node selection (for collapsed preview)
  useEffect(() => {
    if (!selectedNode || selectedNode.aggregated) return;
    if (selectedNode.type !== 'project-budget' && selectedNode.type !== 'project-spending') return;
    const pid = selectedNode.projectId;
    const cacheKey = `${year}-${pid}`;
    if (pid == null || projectDetailCache.has(cacheKey)) return;
    fetch(`/api/project-details/${pid}?year=${year}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: ProjectDetail | null) => setProjectDetailCache(prev => new Map(prev).set(cacheKey, data)))
      .catch(() => setProjectDetailCache(prev => new Map(prev).set(cacheKey, null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, year]);

  // Imperatively focus a layout node (direct call + pending effect)
  const focusOnNode = useCallback((node: LayoutNode) => {
    const container = containerRef.current;
    if (!container) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const cx = MARGIN.left + node.x0 + NODE_W / 2;
    const cy = MARGIN.top + node.y0 + (node.y1 - node.y0) / 2;
    const h = node.y1 - node.y0;
    const minZoomForLabel = 10 / (h + NODE_PAD);
    const panelW = isPanelCollapsed ? 0 : 310;
    const availableW = cW - panelW;
    const targetK = Math.max(zoom, Math.min(baseZoom * 10, minZoomForLabel * 1.2));
    setZoom(targetK);
    setPan({ x: panelW + availableW / 2 - cx * targetK, y: cH / 2 - cy * targetK });
  }, [zoom, baseZoom, isPanelCollapsed]);

  const focusOnNeighborhood = useCallback((nodeOverride?: LayoutNode) => {
    const node = nodeOverride ?? selectedNode;
    if (!node || (!nodeOverride && !selectedNodeInLayout) || !layout || !containerRef.current) return;
    const container = containerRef.current;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    // BFS: include all transitively connected nodes (upstream + downstream)
    const neighborIds = new Set<string>();
    const queue: LayoutNode[] = [node];
    while (queue.length) {
      const cur = queue.shift()!;
      if (neighborIds.has(cur.id)) continue;
      neighborIds.add(cur.id);
      for (const l of cur.sourceLinks) if (!neighborIds.has(l.target.id)) queue.push(l.target);
      for (const l of cur.targetLinks) if (!neighborIds.has(l.source.id)) queue.push(l.source);
    }
    const neighborNodes = layout.nodes.filter(n => neighborIds.has(n.id));
    if (neighborNodes.length === 0) return;
    const minX = Math.min(...neighborNodes.map(n => n.x0));
    const minY = Math.min(...neighborNodes.map(n => n.y0));
    const maxX = Math.max(...neighborNodes.map(n => n.x1));
    const maxY = Math.max(...neighborNodes.map(n => n.y1));
    const PADDING = 40;
    const boxW = (maxX - minX) + PADDING * 2;
    const boxH = (maxY - minY) + PADDING * 2;
    const panelW = isPanelCollapsed ? 0 : 310;
    const availableW = cW - panelW;
    const targetK = Math.max(0.2, Math.min(baseZoom * 10, Math.min(availableW / boxW, cH / boxH) * 0.9));
    const centerX = MARGIN.left + (minX + maxX) / 2;
    const centerY = MARGIN.top + (minY + maxY) / 2;
    setZoom(targetK);
    setPan({ x: panelW + availableW / 2 - centerX * targetK, y: cH / 2 - centerY * targetK });
  }, [selectedNode, selectedNodeInLayout, layout, isPanelCollapsed, baseZoom]);

  const handleConnectionClick = useCallback((nodeId: string) => {
    // If already in layout, select and focus directly (no effect needed)
    const inLayoutNode = layout?.nodes.find(n => n.id === nodeId);
    if (inLayoutNode) {
      if (focusRelated && (nodeId.startsWith('r-') || inLayoutNode.type === 'ministry') && !inLayoutNode.aggregated) {
        const pins = computeFocusPins(nodeId, graphData?.nodes);
        setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
        selectNode(nodeId);
        focusOnNeighborhood(inLayoutNode);
        return;
      }
      // Preserve pin if the clicked node belongs to the same pinned project
      const derivedPinnedId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId.startsWith('project-spending-')
          ? nodeId
          : null;
      const nextPinnedProjectId =
        focusRelated && derivedPinnedId !== null
          ? derivedPinnedId
          : derivedPinnedId !== null && derivedPinnedId === pinnedProjectId
            ? pinnedProjectId
            : null;
      if (focusRelated && derivedPinnedId !== null) { setPinnedRecipientId(null); setPinnedMinistryName(null); }
      if (focusRelated && nextPinnedProjectId) pinnedContextProjectId.current = nextPinnedProjectId;
      const needsDeferredFocus = nextPinnedProjectId !== pinnedProjectId || isPanelCollapsed;
      setPinnedProjectId(nextPinnedProjectId);
      if (needsDeferredFocus) pendingFocusId.current = nodeId;
      selectNode(nodeId);
      if (!needsDeferredFocus) focusOnNeighborhood(inLayoutNode);
      return;
    }
    // Helper: jump recipientOffset to center on a recipient rank
    const jumpToRecipientRank = (rank: number, totalCount: number) => {
      const maxOffset = Math.max(0, totalCount - topRecipient);
      const newOffset = Math.max(0, Math.min(rank - Math.floor(topRecipient / 2), maxOffset));
      setRecipientOffset(newOffset);
    };

    const projectOffsetModeActive = offsetTarget === 'project';
    const jumpToProjectRank = (rank: number) => {
      const maxOffset = Math.max(0, allProjectRanks.size - topProject);
      const newOffset = Math.max(0, Math.min(rank - Math.floor(topProject / 2), maxOffset));
      setProjectOffset(newOffset);
    };
    if (focusRelated) {
      // focusRelated ON: 現在のフォーカスコンテキストをクリアして新しいノードに切り替える
      const pins = computeFocusPins(nodeId, graphData?.nodes);
      setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
      if (pins.pinnedProjectId) pinnedContextProjectId.current = pins.pinnedProjectId;
    } else if (!projectOffsetModeActive && nodeId.startsWith('r-') && filtered) {
      // Recipient outside window: jump offset so it's visible (disabled in project offset mode)
      const rank = allRecipientRanks.get(nodeId);
      if (rank !== undefined) jumpToRecipientRank(rank, filtered.totalRecipientCount);
    } else if (!projectOffsetModeActive && (nodeId.startsWith('project-spending-') || nodeId.startsWith('project-budget-')) && filtered && graphData) {
      // Project outside TopN: pin it (TopN+1) and jump offset to its best recipient (disabled in project offset mode)
      const spendingId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId;
      setPinnedProjectId(spendingId);
      let bestRecipientId: string | null = null;
      let bestRecipientTotal = -1;
      const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
      for (const e of graphData.edges) {
        if (e.source === spendingId && e.target.startsWith('r-')) {
          const total = nodeById.get(e.target)?.value ?? 0;
          if (total > bestRecipientTotal) { bestRecipientTotal = total; bestRecipientId = e.target; }
        }
      }
      if (bestRecipientId !== null) {
        const rank = allRecipientRanks.get(bestRecipientId);
        if (rank !== undefined) jumpToRecipientRank(rank, filtered.totalRecipientCount);
      }
    } else if (projectOffsetModeActive && nodeId.startsWith('r-') && graphData) {
      // Recipient in project offset mode: resolve parent project and jump offset to it.
      // Prefer pinnedContextProjectId (the project the user was exploring), but only if it
      // actually parents this recipient (guards against stale ref from a different flow).
      let parentSpendingId: string | null = null;
      const ctxId = pinnedContextProjectId.current;
      pinnedContextProjectId.current = null;
      if (ctxId && graphData.edges.some(e => e.target === nodeId && e.source === ctxId)) {
        parentSpendingId = ctxId;
      }
      if (!parentSpendingId) {
        let bestEdgeValue = -1;
        for (const e of graphData.edges) {
          if (e.target === nodeId && e.source.startsWith('project-spending-') && e.value > bestEdgeValue) {
            bestEdgeValue = e.value;
            parentSpendingId = e.source;
          }
        }
      }
      if (parentSpendingId !== null) {
        const rank = allProjectRanks.get(parentSpendingId);
        if (rank !== undefined) jumpToProjectRank(rank);
        setPinnedProjectId(null);
        pendingFocusId.current = parentSpendingId;
        selectNode(parentSpendingId);
        return;
      }
      setPinnedProjectId(null);
    } else if (projectOffsetModeActive && (nodeId.startsWith('project-spending-') || nodeId.startsWith('project-budget-'))) {
      // Project offset mode: jump projectOffset window so the target project is visible
      const spendingId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId;
      const rank = allProjectRanks.get(spendingId);
      if (rank !== undefined) jumpToProjectRank(rank);
      setPinnedProjectId(null);
    } else {
      setPinnedProjectId(null);
    }
    // Out-of-layout node: focus via effect once it appears in layout after pin/offset jump
    pendingFocusId.current = nodeId;
    selectNode(nodeId);
  }, [layout, filtered, allRecipientRanks, allProjectRanks, topRecipient, topProject, selectNode, graphData, focusOnNeighborhood, pinnedProjectId, isPanelCollapsed, focusRelated, setPinnedRecipientId, setPinnedMinistryName, offsetTarget, setProjectOffset]);

  // Step2 → Step1 遷移: 選択ノード (selectedNodeId) は維持し、
  // focusRelated と pinnedProject/Recipient/Ministry (Step2 用のフォーカスピン) のみ解除
  const exitFocusRelated = useCallback((nodeId?: string) => {
    pendingHistoryAction.current = 'push';
    setPinnedProjectId(null);
    setPinnedRecipientId(null);
    setPinnedMinistryName(null);
    setFocusRelated(false);
    if (nodeId) pendingConnectionNodeId.current = nodeId;
  }, [setPinnedRecipientId, setPinnedMinistryName]);

  const handleNodeClick = useCallback((node: LayoutNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (didPanRef.current) return;
    const newId = selectedNodeId === node.id ? null : node.id;
    if (newId === null && focusRelated) {
      // Pin中ノードを再クリック → フィルターのみOFF（Pin解除しない）
      exitFocusRelated(selectedNodeId ?? undefined);
      return;
    }
    if (newId !== null) {
      if (autoFocusRelated) {
        // 自動focusRelated: ピンを新ノードに切り替えてStep2へ直行
        const pins = computeFocusPins(newId, graphData?.nodes);
        setPinnedProjectId(pins.pinnedProjectId);
        setPinnedRecipientId(pins.pinnedRecipientId);
        setPinnedMinistryName(pins.pinnedMinistryName);
        if (pins.pinnedProjectId) pinnedContextProjectId.current = pins.pinnedProjectId;
        setFocusRelated(true);
        pendingResetViewport.current = true;
        selectNode(newId);
        return;
      }
      if (focusRelated) {
        // focusRelated=ON 中の新規選択: ピン・フィルターをリセットし、
        // レイアウト更新後に handleConnectionClick でオフセット調整
        setFocusRelated(false);
        setPinnedProjectId(null);
        setPinnedRecipientId(null);
        setPinnedMinistryName(null);
        pendingConnectionNodeId.current = newId;
        return;
      }
      setPinnedProjectId(null);
      setPinnedRecipientId(null);
      setPinnedMinistryName(null);
    }
    selectNode(newId);
  }, [selectedNodeId, selectNode, focusRelated, autoFocusRelated, exitFocusRelated, graphData]);

  // focusRelated=ON 中に別ノードをクリックした後、フルレイアウト更新後にオフセット調整
  useEffect(() => {
    if (!pendingConnectionNodeId.current || !layout) return;
    const id = pendingConnectionNodeId.current;
    pendingConnectionNodeId.current = null;
    handleConnectionClick(id);
  }, [layout, handleConnectionClick]);

  // ── Search ──

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => { setSearchPage(0); setSearchCursorIndex(-1); }, [debouncedQuery]);

  const SEARCH_REGEX_MAX_LEN = 100;
  const searchRegexError = useMemo(() => {
    if (!searchUseRegex || debouncedQuery.trim().length < 2) return false;
    if (debouncedQuery.trim().length > SEARCH_REGEX_MAX_LEN) return true;
    try { new RegExp(debouncedQuery.trim()); return false; } catch { return true; }
  }, [searchUseRegex, debouncedQuery]);

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim();
    const pidQuery = isPidQuery(q) ? Number(q) : null;
    if (!graphData || !meetsSearchMinLength(q)) return [];
    type SearchResult = { id: string; name: string; type: string; value: number; sortValue: number; projectId?: number; budgetValue?: number };
    const results: SearchResult[] = [];
    let matcher: (name: string) => boolean;
    if (pidQuery !== null) {
      matcher = () => false;
    } else if (searchUseRegex) {
      if (q.length > SEARCH_REGEX_MAX_LEN) return [];
      try { const re = new RegExp(q, 'i'); matcher = name => re.test(name); }
      catch { return []; }
    } else {
      const qLower = q.toLocaleLowerCase();
      matcher = name => name.toLocaleLowerCase().includes(qLower);
    }
    // 府省庁フィルタが設定されている場合、検索対象を選択府省庁の事業・支出先に絞る
    const searchMinistrySet = new Set(filterMinistryNames);
    let allowedIds: Set<string> | null = null;
    if (filterMinistryNames.length > 0) {
      allowedIds = new Set<string>();
      const allowedSpendingIds = new Set<string>();
      for (const n of graphData.nodes) {
        if (n.type === 'project-spending' && n.ministry != null && searchMinistrySet.has(n.ministry)) {
          allowedIds.add(n.id);
          allowedSpendingIds.add(n.id);
        }
      }
      for (const e of graphData.edges) {
        if (allowedSpendingIds.has(e.source) && e.target.startsWith('r-')) allowedIds.add(e.target);
      }
    }
    // 金額フィルタは filterExcludedIds 経由で適用
    const nodesToSearch = graphData.nodes.filter(n =>
      (!allowedIds || allowedIds.has(n.id)) &&
      (!filterExcludedIds || !filterExcludedIds.has(n.id))
    );
    for (const n of nodesToSearch) {
      if (n.type === 'project-budget') continue; // merged into project-spending entry
      if (pidQuery !== null) {
        if (n.type === 'project-spending' && n.projectId === pidQuery) {
          const bv = budgetNodeByPid.get(n.projectId)?.value ?? 0;
          results.push({ id: n.id, name: n.name, type: n.type, value: n.value, sortValue: Math.max(bv, n.value), projectId: n.projectId, budgetValue: bv });
        }
      } else {
        if (matcher(n.name)) {
          if (n.type === 'project-spending' && n.projectId != null) {
            const bv = budgetNodeByPid.get(n.projectId)?.value ?? 0;
            results.push({ id: n.id, name: n.name, type: n.type, value: n.value, sortValue: Math.max(bv, n.value), projectId: n.projectId, budgetValue: bv });
          } else {
            results.push({ id: n.id, name: n.name, type: n.type, value: n.value, sortValue: n.value });
          }
        }
      }
    }
    return results.sort((a, b) => b.sortValue - a.sortValue);
  }, [graphData, debouncedQuery, searchUseRegex, filterExcludedIds, filterMinistryNames, budgetNodeByPid]);

  const SEARCH_PAGE_SIZE = 200;
  const searchPagedResults = useMemo(
    () => searchResults.slice(searchPage * SEARCH_PAGE_SIZE, (searchPage + 1) * SEARCH_PAGE_SIZE),
    [searchResults, searchPage]
  );
  const searchTotalPages = Math.ceil(searchResults.length / SEARCH_PAGE_SIZE);

  const pendingSearchResetRef = useRef(false);

  const handleSearchSelect = useCallback((nodeId: string) => {
    setShowSearchResults(false);
    handleConnectionClick(nodeId);
    if (focusRelated) {
      // focusRelated ON: show full view after layout settles (so related nodes are all visible)
      pendingSearchResetRef.current = true;
    } else {
      // focusRelated OFF: explicitly pan to the node
      const inLayout = layout?.nodes.find(n => n.id === nodeId);
      if (inLayout) {
        focusOnNeighborhood(inLayout);
      } else {
        pendingFocusId.current = nodeId;
      }
    }
  }, [handleConnectionClick, focusRelated, layout, focusOnNeighborhood]);

  // Reset viewport after search-triggered selection when focusRelated is ON
  useEffect(() => {
    if (!pendingSearchResetRef.current || !layout) return;
    pendingSearchResetRef.current = false;
    resetViewport();
  }, [layout, resetViewport]);

  // Center on initial load / layout change
  const initialCentered = useRef(false);
  useEffect(() => {
    if (layout && !initialCentered.current) {
      initialCentered.current = true;
      if (urlRestoredZoomRef.current !== null) {
        // URL had z= but no sel=: center layout at user zoom
        const k = urlRestoredZoomRef.current;
        urlRestoredZoomRef.current = null;
        const container = containerRef.current;
        const l = layoutRef.current;
        setRecipientOffset(0);
        if (container && l) {
          const cW = container.clientWidth;
          const cH = container.clientHeight;
          const totalW = MARGIN.left + l.contentW;
          const totalH = MARGIN.top + l.contentH;
          const availH = cH - SEARCH_BOX_RESERVE;
          const fitK = Math.max(0.2, Math.min(10, Math.min(cW / totalW, availH / totalH) * 0.9));
          setBaseZoom(fitK);
          setZoom(k);
          setPan({ x: (cW - totalW * k) / 2, y: SEARCH_BOX_RESERVE + (availH - totalH * k) / 2 });
        } else {
          setZoom(k); setBaseZoom(k); setPan({ x: 0, y: SEARCH_BOX_RESERVE });
        }
      } else {
        resetView();
      }
    }
  }, [layout, resetView]);

  // Focus on node after selection — fires when node appears in layout (pinned TopN+1 case)
  // Also watches isPanelCollapsed: when panel opens, recalculate fit with updated panel width
  useEffect(() => {
    if (!layout) return;
    if (pendingResetViewport.current) {
      pendingResetViewport.current = false;
      if (!isPanelCollapsed) resetViewport();
      return;
    }
    if (isPanelCollapsed || !pendingFocusId.current) return;
    const node = layout.nodes.find(n => n.id === pendingFocusId.current);
    if (!node) return;
    pendingFocusId.current = null;
    focusOnNeighborhood(node);
    // resetViewport is useCallback(()=>{}, []) — stable, intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, focusOnNeighborhood, isPanelCollapsed]);

  // Draw minimap
  useEffect(() => {
    if (!showMinimap || !layout) return;
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The "world" that the minimap represents = the full SVG content area
    // Nodes are at (MARGIN.left + x0, MARGIN.top + y0) in SVG coords
    // The SVG transform: translate(pan.x, pan.y) scale(zoom) then translate(MARGIN, MARGIN)
    // So a node at inner (x0,y0) appears at screen (pan.x + (MARGIN.left+x0)*zoom, pan.y + (MARGIN.top+y0)*zoom)
    const worldW = svgWidth;
    const worldH = svgHeight;
    const scaleX = MINIMAP_W / worldW;
    const scaleY = minimapH / worldH;

    ctx.clearRect(0, 0, MINIMAP_W, minimapH);
    ctx.fillStyle = 'rgba(245,245,245,0.95)';
    ctx.fillRect(0, 0, MINIMAP_W, minimapH);

    // Draw nodes (at their SVG-coord positions including MARGIN)
    for (const node of layout.nodes) {
      const x = (MARGIN.left + node.x0) * scaleX;
      const y = (MARGIN.top + node.y0) * scaleY;
      const w = Math.max(1, NODE_W * scaleX);
      const h = Math.max(0.5, (node.y1 - node.y0) * scaleY);
      ctx.fillStyle = getNodeColor(node);
      ctx.fillRect(x, y, w, h);
    }

    // Viewport: what part of the SVG world is visible in the container?
    // Container shows screen coords (0,0) to (containerW, containerH)
    // Screen to SVG: svgX = (screenX - pan.x) / zoom
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vpLeft = -pan.x / zoom;
    const vpTop = -pan.y / zoom;
    const vpW = cW / zoom;
    const vpH = cH / zoom;

    // Convert to minimap coords
    const mX = vpLeft * scaleX;
    const mY = vpTop * scaleY;
    const mW = vpW * scaleX;
    const mH = vpH * scaleY;

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, mW, mH);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, mW, mH);
  }, [showMinimap, layout, zoom, pan, svgWidth, minimapH]);

  const minimapNavigate = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Minimap coord to SVG world coord
    const scaleX = MINIMAP_W / svgWidth;
    const scaleY = minimapH / svgHeight;
    const svgX = mx / scaleX;
    const svgY = my / scaleY;
    // Center the container on this SVG coord
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    setPan({ x: cW / 2 - svgX * zoom, y: cH / 2 - svgY * zoom });
  }, [svgWidth, minimapH, zoom]);

  // Escape key: focusRelated ON → フィルターのみOFF、OFF → 選択解除
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (focusRelated) exitFocusRelated(selectedNodeId ?? undefined); else selectNode(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectNode, focusRelated, exitFocusRelated]);

  const focusOnSelectedNode = useCallback(() => {
    if (!selectedNode || !selectedNodeInLayout) return;
    focusOnNode(selectedNode);
  }, [selectedNode, selectedNodeInLayout, focusOnNode]);


  const applyZoom = useCallback((factor: number) => {
    const nz = Math.max(0.2, Math.min(baseZoom * 10, zoom * factor));
    setPan({ x: svgWidth / 2 - (svgWidth / 2 - pan.x) * (nz / zoom), y: svgHeight / 2 - (svgHeight / 2 - pan.y) * (nz / zoom) });
    setZoom(nz);
    scheduleZoomUrlWrite();
  }, [zoom, pan, svgWidth, svgHeight, baseZoom, scheduleZoomUrlWrite]);


  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#fff', fontFamily: 'system-ui, sans-serif', cursor: isPanning ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >


      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Loading sankey-svg-{year}-graph.json...</p>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
          <p style={{ color: 'red', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {layout && (
        <>
            <style>{`
              @keyframes snk-fade-in { from { opacity: 0 } to { opacity: 1 } }
              .snk-node { animation: snk-fade-in 0.25s ease forwards; }
            `}</style>
            <svg
              ref={svgRef}
              width={svgWidth}
              height={svgHeight}
              overflow="visible"
              style={{ position: 'absolute', inset: 0, display: 'block' }}
            >
              {/* Gradient defs for merged project nodes */}
              <defs>
                <linearGradient id="proj-node-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4db870" />
                  <stop offset="44%" stopColor="#4db870" />
                  <stop offset="56%" stopColor="#e07040" />
                  <stop offset="100%" stopColor="#e07040" />
                </linearGradient>
                <linearGradient id="proj-agg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#999" />
                  <stop offset="44%" stopColor="#999" />
                  <stop offset="50%" stopColor="#777" />
                  <stop offset="56%" stopColor="#999" />
                  <stop offset="100%" stopColor="#999" />
                </linearGradient>
              </defs>
              {/* Backdrop: full-SVG invisible rect for deselection on background click */}
              <rect
                x={0} y={0} width={svgWidth} height={svgHeight}
                fill="transparent"
                onClick={() => { if (!didPanRef.current) { if (focusRelated) exitFocusRelated(selectedNodeId ?? undefined); else selectNode(null); } }}
              />
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {/* Links (skip internal project-budget → project-spending links) */}
                {layout.links.filter(link => !(link.source.type === 'project-budget' && link.target.type === 'project-spending')).map((link) => (
                  <path
                    key={`${link.source.id}→${link.target.id}`}
                    fill={getLinkColor(link)}
                    fillOpacity={
                      connectedNodeIds
                        ? (connectedNodeIds.has(link.source.id) && connectedNodeIds.has(link.target.id))
                          ? (hoveredLink === link ? 0.45 : 0.35)
                          : 0.05
                        : hoveredLink === link ? 0.6
                          : hoveredNode && (link.source === hoveredNode || link.target === hoveredNode
                              || link.source.id === hoveredPartnerSpendingId || link.target.id === hoveredPartnerSpendingId) ? 0.5
                          : (hoveredNode || hoveredLink) ? 0.1
                          : 0.25
                    }
                    stroke="none"
                    strokeWidth={0}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                      setHoveredLink(link);
                    }}
                    onMouseMove={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                    }}
                    onMouseLeave={() => setHoveredLink(null)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'grab', transition: 'fill-opacity 0.2s ease, d 0.3s ease', d: `path("${ribbonPath(link)}")` } as React.CSSProperties}
                  />
                ))}

                {/* Label clip regions per non-last column */}
                {(() => {
                  const colSpacing = layout.maxCol > 0 ? (layout.innerW - NODE_W) / layout.maxCol : layout.innerW;
                  const lastCol = layout.maxCol;
                  const cols = new Set(layout.nodes.map(n => getColumn(n)));
                  return Array.from(cols).filter(c => c < lastCol).map(c => (
                    <defs key={`clip-col-${c}`}>
                      <clipPath id={`clip-col-${c}`}>
                        <rect x={c * colSpacing + NODE_W} y={-1000} width={colSpacing - NODE_W} height={10000} />
                      </clipPath>
                    </defs>
                  ));
                })()}

                {/* Nodes */}
                {(() => {
                  const lastCol = layout.maxCol;
                  // Build spending node lookup for merged project rendering
                  const spendingByBudgetId = new Map<string, LayoutNode>();
                  for (const n of layout.nodes) {
                    if (n.type === 'project-spending' && n.projectId != null) {
                      spendingByBudgetId.set(`project-budget-${n.projectId}`, n);
                    } else if (n.id === '__agg-project-spending') {
                      spendingByBudgetId.set('__agg-project-budget', n);
                    }
                  }
                  // project-spending nodes are rendered as part of their budget node
                  return layout.nodes.filter(node => node.type !== 'project-spending').map((node) => {
                    if (node.type === 'project-budget' || node.id === '__agg-project-budget') {
                      // Merged project node: budget (left) + spending (right) as one shape
                      const spendingNode = spendingByBudgetId.get(node.id);
                      const bH = Math.max(1, node.y1 - node.y0);
                      const sH = spendingNode ? Math.max(1, spendingNode.y1 - spendingNode.y0) : bH;
                      const isConnected = connectedNodeIds
                        ? (connectedNodeIds.has(node.id) || (spendingNode != null && connectedNodeIds.has(spendingNode.id)))
                        : null;
                      const isSelectedMerged = node.id === selectedNodeId || spendingNode?.id === selectedNodeId;
                      const labelVisible = showLabels || Math.max(bH, sH) * zoom > 10 || isSelectedMerged;
                      const nodeOpacity = connectedNodeIds
                        ? (isConnected ? 1 : 0.3)
                        : (hoveredNode && hoveredNode !== node ? 0.4 : 1);
                      const nodeFill = node.aggregated ? 'url(#proj-agg-grad)' : 'url(#proj-node-grad)';
                      if (!spendingNode) {
                        // No paired spending node — render as plain budget rect
                        return (
                          <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                            <rect x={node.x0} y={0} width={NODE_W} fill={getNodeColor(node)} rx={1}
                              style={{ height: bH, opacity: nodeOpacity, cursor: 'pointer', transition: 'opacity 0.2s ease, height 0.3s ease' }}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onClick={(e) => handleNodeClick(node, e)}
                            />
                            {labelVisible && (
                              <text x={node.x1 + 3} y={bH / 2} fontSize={11 / zoom} dominantBaseline="middle"
                                fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                                style={{ userSelect: 'none', cursor: 'pointer' }} clipPath={`url(#clip-col-${getColumn(node)})`}
                                onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                                onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                                onMouseLeave={() => setHoveredNode(null)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => handleNodeClick(node, e)}>
                                {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.value)}){node.isScaled && node.rawValue != null && (<tspan fill="#777"> / {formatYen(node.rawValue)}</tspan>)}
                              </text>
                            )}
                          </g>
                        );
                      }
                      return (
                        <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                          <path
                            d={mergedProjectPath(node.x0, NODE_W, bH, sH)}
                            fill={nodeFill}
                            style={{ opacity: nodeOpacity, cursor: 'pointer', transition: 'opacity 0.2s ease' }}
                            onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                            onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                            onMouseLeave={() => setHoveredNode(null)}
                            onClick={(e) => handleNodeClick(node, e)}
                          />
                          {labelVisible && (<>
                            {/* Left label: budget amount */}
                            <text x={node.x0 - 3} y={Math.max(bH, sH) / 2} fontSize={11 / zoom} dominantBaseline="middle" textAnchor="end"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer' }}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => handleNodeClick(node, e)}>
                              {formatYen(node.value)}{node.isScaled && node.rawValue != null && <tspan fill="#888"> / {formatYen(node.rawValue)}</tspan>}
                            </text>
                            {/* Right label: project name + spending amount */}
                            <text x={spendingNode.x1 + 3} y={Math.max(bH, sH) / 2} fontSize={11 / zoom} dominantBaseline="middle"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer' }} clipPath={`url(#clip-col-${getColumn(node)})`}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => handleNodeClick(node, e)}>
                              {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(spendingNode.value)}){spendingNode.isScaled && spendingNode.rawValue != null && (<tspan fill="#777"> / {formatYen(spendingNode.rawValue)}</tspan>)}
                            </text>
                          </>)}
                        </g>
                      );
                    }
                    // Regular node (total, ministry, recipient)
                    const h = node.y1 - node.y0;
                    const isSelected = node.id === selectedNodeId;
                    const labelVisible = showLabels || (h + NODE_PAD) * zoom > 10 || isSelected;
                    const col = getColumn(node);
                    const isLastCol = col === lastCol;
                    return (
                      <g key={node.id} className="snk-node" style={{ transform: `translateY(${node.y0}px)`, transition: 'transform 0.3s ease' }}>
                        <rect
                          x={node.x0}
                          y={0}
                          width={NODE_W}
                          fill={getNodeColor(node)}
                          rx={1}
                          style={{
                            height: Math.max(1, h),
                            opacity: connectedNodeIds
                              ? (connectedNodeIds.has(node.id) ? 1 : 0.3)
                              : (hoveredNode && hoveredNode !== node ? 0.4 : 1),
                            cursor: 'pointer',
                            transition: 'opacity 0.2s ease, height 0.3s ease',
                          }}
                          onMouseEnter={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                            setHoveredNode(node);
                          }}
                          onMouseMove={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                          }}
                          onMouseLeave={() => setHoveredNode(null)}
                          onClick={(e) => handleNodeClick(node, e)}
                        />
                        {labelVisible && (
                          <text
                            x={node.x1 + 3}
                            y={h / 2}
                            fontSize={11 / zoom}
                            dominantBaseline="middle"
                            fill={connectedNodeIds && !connectedNodeIds.has(node.id) ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                            style={{ userSelect: 'none', cursor: 'pointer' }}
                            clipPath={isLastCol ? undefined : `url(#clip-col-${col})`}
                            onMouseEnter={(e) => { const rect = containerRef.current?.getBoundingClientRect(); if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); setHoveredNode(node); }}
                            onMouseMove={(e) => { const rect = containerRef.current?.getBoundingClientRect(); if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); }}
                            onMouseLeave={() => setHoveredNode(null)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => handleNodeClick(node, e)}
                          >
                            {node.name.length > 20 ? node.name.slice(0, 20) + '…' : node.name} ({formatYen(node.value)}){node.isScaled && node.rawValue != null && (<tspan fill="#777"> / {formatYen(node.rawValue)}</tspan>)}
                          </text>
                        )}
                      </g>
                    );
                  });
                })()}
              </g>
              </g>
            </svg>

            {/* Column labels — DOM overlay, positioned from zoom/pan to avoid hiding behind search box */}
            {(() => {
              const maxCol = layout.maxCol || 1;
              const innerW = svgWidth - MARGIN.left - MARGIN.right;
              const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
              const colAmounts: (number | null)[] = colNodeTypes.map((t, i) => {
                const nodes = t === 'total' ? layout.nodes.filter(n => n.type === 'total') : layout.nodes.filter(n => n.type === t);
                return i === 0 ? (nodes[0]?.value ?? null) : nodes.reduce((s, n) => s + n.value, 0);
              });
              const projectSpendingTotal = layout.nodes.filter(n => n.type === 'project-spending').reduce((s, n) => s + n.value, 0);
              const nodeAreaScreenY = pan.y + MARGIN.top * zoom;
              const labelFontPx = 11;
              // 列ごとの最上端ノードを取得（ラベル基準位置の計算用）
              const topNodeByCol = colNodeTypes.map(t =>
                layout.nodes.filter(n => n.type === t).reduce<typeof layout.nodes[0] | null>((top, n) => (top === null || n.y0 < top.y0 ? n : top), null)
              );
              return COL_LABELS.map((label, i) => {
                const colInnerX = MARGIN.left + (i / maxCol) * (innerW - NODE_W) + NODE_W / 2;
                const screenX = pan.x + colInnerX * zoom;
                const total = colAmounts[i];
                const amountLine = i === 2 && total != null
                  ? `${formatYen(total)} / ${formatYen(projectSpendingTotal)}`
                  : total != null ? formatYen(total) : '';
                const labelBlockH = amountLine ? 34 : 18;
                // ノード高さがラベル高さ以下のとき、ノードラベルのTop位置を基準にする
                const topNode = topNodeByCol[i];
                const nodeScreenH = topNode ? (topNode.y1 - topNode.y0) * zoom : labelFontPx;
                const refScreenY = nodeScreenH < labelFontPx
                  ? nodeAreaScreenY + nodeScreenH / 2 - labelFontPx / 2
                  : nodeAreaScreenY;
                const top = Math.max(SEARCH_BOX_RESERVE, refScreenY - labelBlockH - 8);
                return (
                  <div
                    key={i}
                    data-pan-disabled="true"
                    style={{
                      position: 'absolute', left: screenX, top,
                      transform: 'translateX(-50%)',
                      textAlign: 'center', fontSize: 13, color: '#999',
                      whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default',
                      zIndex: 8, lineHeight: 1.4,
                      background: 'rgba(255,255,255,0.82)', padding: '2px 8px', borderRadius: 4,
                    }}
                    onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredColIndex(i); }}
                    onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                    onMouseLeave={() => setHoveredColIndex(null)}
                  >
                    <div>{label}</div>
                    {amountLine && <div style={{ fontSize: 11 }}>{amountLine}</div>}
                  </div>
                );
              });
            })()}

            {/* Minimap */}
            <MinimapOverlay
              show={showMinimap}
              onShow={() => setShowMinimap(true)}
              onHide={() => setShowMinimap(false)}
              left={selectedNodeId !== null ? (isPanelCollapsed ? 26 : 318) : 8}
              minimapW={MINIMAP_W}
              minimapH={minimapH}
              canvasRef={minimapRef}
              navigate={minimapNavigate}
              dragging={minimapDragging}
            />

          {/* DOM tooltip — link hover */}
          {hoveredLink && !hoveredNode && (() => {
            const tipW = 220;
            const tipH = 58;
            const lx = Math.max(4, Math.min(mousePos.x + 12, svgWidth - tipW - 4));
            const ly = Math.max(4, Math.min(mousePos.y - 10, svgHeight - tipH - 4));
            return (
              <div style={{
                position: 'absolute', left: lx, top: ly, width: tipW, boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.97)', borderRadius: 6, padding: '6px 10px',
                color: '#222', lineHeight: 1.3, textAlign: 'center', wordBreak: 'break-word',
                border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                pointerEvents: 'none', zIndex: 20,
              }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 5, textAlign: 'left' }}>{hoveredLink.source.name} → {hoveredLink.target.name}</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 10, fontWeight: 500, color: '#222' }}>{formatYen(hoveredLink.value)}</div>
                    <div style={{ fontSize: 9, color: '#555' }}>{Math.round(hoveredLink.value).toLocaleString()}円</div>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* DOM tooltip — node hover (sankey2スタイル: ノード上方・ノード色背景) */}
          {hoveredNode && layout && (() => {
            const GAP = 8;
            const tipW = 240;
            const nodeScreenH = (hoveredNode.y1 - hoveredNode.y0) * zoom;
            const screenCx = pan.x + (MARGIN.left + hoveredNode.x0 + NODE_W / 2) * zoom;
            const screenTop = pan.y + (MARGIN.top + hoveredNode.y0) * zoom;
            const screenBottom = screenTop + nodeScreenH;
            const lx = Math.max(4, Math.min(screenCx - tipW / 2, svgWidth - tipW - 4));
            // ノードタイプ別に予算・支出を解決
            let budget: number | null = null;
            let spending: number | null = null;
            const t = hoveredNode.type;
            if (t === 'project-budget') {
              budget = hoveredNode.rawValue ?? hoveredNode.value;
              // sourceLinks から project-spending ノードを探す（集約ノード含む）
              const spLink = hoveredNode.sourceLinks.find(l => l.target.type === 'project-spending');
              spending = spLink?.target.value ?? null;
            } else if (t === 'project-spending') {
              spending = hoveredNode.value;
              // targetLinks から project-budget ノードを探す（集約ノード含む）
              const bdLink = hoveredNode.targetLinks.find(l => l.source.type === 'project-budget');
              budget = bdLink ? (bdLink.source.rawValue ?? bdLink.source.value) : null;
            } else if (t === 'ministry') {
              budget = hoveredNode.value;
              // サイドパネルと同じ計算: ministryProjectStats.spendingTotal
              spending = ministryProjectStats.get(hoveredNode.name)?.spendingTotal ?? null;
            } else if (t === 'total') {
              budget = hoveredNode.value;
              // サイドパネルと同じ計算: 全 ministryProjectStats の spendingTotal 合計
              spending = Array.from(ministryProjectStats.values()).reduce((s, v) => s + v.spendingTotal, 0);
            } else {
              // recipient: 支出のみ
              spending = hoveredNode.value;
            }
            // 予算・支出が両方ある場合は2列グリッドで横並び、片方だけなら1列
            const both = budget != null && spending != null;
            const tipH = both ? 78 : 68;
            // 大ノード: マウスY連動（カーソル上方）/ 小ノード: ラベル上端-GAPにポップアップ底辺を固定
            const labelFontPx = 11; // SVG font-size = 11/zoom → screen px = 11
            const labelTopScreenY = screenTop + nodeScreenH / 2 - labelFontPx / 2;
            const cursorGap = 12;
            const lyAboveCursor = mousePos.y - tipH - cursorGap;
            const largeNode = nodeScreenH > tipH;
            const showBelow = labelTopScreenY - GAP < 40;
            const lyRaw = largeNode
              ? (lyAboveCursor >= 4 ? lyAboveCursor : mousePos.y + cursorGap + 16)
              : showBelow ? screenBottom + GAP : labelTopScreenY - GAP;
            const transform = (!largeNode && !showBelow) ? 'translateY(-100%)' : undefined;
            const minLy = transform === 'translateY(-100%)' ? tipH + 4 : 4;
            const maxLy = transform === 'translateY(-100%)' ? svgHeight - 4 : svgHeight - tipH - 4;
            const ly = Math.max(minLy, Math.min(lyRaw, maxLy));
            const amtCol = (label: string, val: number) => (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                  <span style={{ fontSize: 9, color: '#888', flexShrink: 0, paddingTop: 1 }}>{label}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: '#222' }}>{formatYen(val)}</span>
                </div>
                <div style={{ fontSize: 9, color: '#555', wordBreak: 'break-all' }}>{Math.round(val).toLocaleString()}円</div>
              </div>
            );
            return (
              <div style={{
                position: 'absolute', left: lx, top: ly, width: tipW, boxSizing: 'border-box',
                transform,
                background: 'rgba(255,255,255,0.97)', borderRadius: 6, padding: '6px 10px',
                color: '#222', lineHeight: 1.3, textAlign: 'center', wordBreak: 'break-word',
                border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                pointerEvents: 'none', zIndex: 20,
              }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 5, color: '#111', textAlign: 'left' }}>{hoveredNode.name}</div>
                {both ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px', textAlign: 'left' }}>
                    {amtCol('予算', budget!)}
                    {amtCol('支出', spending!)}
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {budget != null ? amtCol('予算', budget) : spending != null ? amtCol('支出', spending) : null}
                  </div>
                )}
              </div>
            );
          })()}
          {/* DOM tooltip — column label hover */}
          {hoveredColIndex !== null && layout && (() => {
            const amt = (n: LayoutNode) => n.value;
            const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
            const nodes = hoveredColIndex === 0
              ? layout.nodes.filter(n => n.type === 'total')
              : layout.nodes.filter(n => n.type === colNodeTypes[hoveredColIndex]);
            const total = hoveredColIndex === 0
              ? (nodes[0] ? amt(nodes[0]) : 0)
              : nodes.reduce((s, n) => s + amt(n), 0);
            const count = hoveredColIndex === 0 ? null : nodes.length;
            const colDescs = [
              '全事業の予算額合計（予算案ベース）',
              '各府省庁所管事業の予算額合計',
              '各事業の予算額（左：予算 / 右：支出）',
              '全エッジ合計（ウィンドウ外流入含む）',
            ];
            return (
              <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y + 16, background: 'rgba(255,255,255,0.97)', color: '#222', padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.5, pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap', border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2 }}>{COL_LABELS[hoveredColIndex]}</div>
                {count != null && <div style={{ color: '#888', fontSize: 10 }}>{count.toLocaleString()}件</div>}
                <div style={{ fontWeight: 500, fontSize: 10, color: '#222' }}>{formatYen(total)}</div>
                <div style={{ color: '#555', fontSize: 9 }}>{Math.round(total).toLocaleString()}円</div>
                <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>{colDescs[hoveredColIndex]}</div>
              </div>
            );
          })()}
        </>
      )}

      {/* Left side panel — node detail */}
      {selectedNodeId !== null && (
        <div
          data-pan-disabled="true"
          style={{
            position: 'fixed', left: 0, top: 0, height: '100%',
            width: isPanelCollapsed ? 0 : 310,
            background: '#fff',
            borderRight: isPanelCollapsed ? 'none' : '1px solid #e0e0e0',
            boxShadow: isPanelCollapsed ? 'none' : '2px 0 8px rgba(0,0,0,0.1)',
            zIndex: 25,
            transition: 'width 0.2s ease',
            overflow: 'visible',
            cursor: 'default',
          }}
        >
          {/* Collapse/expand toggle + close buttons on right edge */}
          <div
            data-pan-disabled="true"
            style={{
              position: 'absolute', right: -25, top: '50%', transform: 'translateY(-50%)',
              width: 25,
              background: '#fff', border: '1px solid #e0e0e0', borderLeft: 'none',
              borderRadius: '0 6px 6px 0',
              boxShadow: '2px 0 4px rgba(0,0,0,0.08)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            {/* Collapse/expand button: panel folds, node stays selected */}
            <button
              data-pan-disabled="true"
              onClick={() => setIsPanelCollapsed(c => !c)}
              title={isPanelCollapsed ? 'パネルを展開' : 'パネルを折りたたむ'}
              style={{
                width: 25, height: 56,
                background: 'transparent', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, borderRadius: '0 6px 6px 0',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isPanelCollapsed
                  ? <polyline points="9 6 15 12 9 18"/>
                  : <polyline points="15 6 9 12 15 18"/>}
              </svg>
            </button>
          </div>

          {/* Panel content */}
          {!isPanelCollapsed && selectedNode && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header — fixed, never scrolls */}
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
                      {selectedNode.name}
                    </div>
                    {(() => {
                      // Main value (予算額 for budget types, 支出額 for spending type)
                      let mainValue = 0;
                      let mainLabel = '';
                      let subValue: number | null = null;
                      let subLabel = '';
                      if (selectedNode.type === 'total' || selectedNode.type === 'ministry') {
                        const stats = selectedNode.type === 'total'
                          ? Array.from(ministryProjectStats.values())
                          : (ministryProjectStats.has(selectedNode.name) ? [ministryProjectStats.get(selectedNode.name)!] : []);
                        mainValue = selectedNode.value;
                        mainLabel = '予算額';
                        subValue = stats.reduce((s, v) => s + v.spendingTotal, 0);
                        subLabel = '支出額';
                      } else if (selectedNode.id === '__agg-project-budget') {
                        mainValue = selectedNode.value;
                        mainLabel = '予算額';
                        // spending node is a direct source-link target in the layout
                        const spLink = selectedNode.sourceLinks.find(l => l.target.id === '__agg-project-spending');
                        if (spLink) { subValue = spLink.target.value; subLabel = '支出額'; }
                        else {
                          const aggSp = filtered?.nodes.find(n => n.id === '__agg-project-spending');
                          if (aggSp) { subValue = aggSp.value; subLabel = '支出額'; }
                        }
                      } else if (selectedNode.id === '__agg-project-spending') {
                        mainValue = selectedNode.value;
                        mainLabel = '支出額';
                        // budget node is a direct target-link source in the layout
                        const buLink = selectedNode.targetLinks.find(l => l.source.id === '__agg-project-budget');
                        if (buLink) { subValue = buLink.source.value; subLabel = '予算額'; }
                        else {
                          const aggBu = filtered?.nodes.find(n => n.id === '__agg-project-budget');
                          if (aggBu) { subValue = aggBu.value; subLabel = '予算額'; }
                        }
                      } else if (selectedNode.type === 'project-budget') {
                        mainValue = selectedNode.value;
                        mainLabel = '予算額';
                        if (selectedNode.projectId != null) {
                          const sn = filtered?.nodes.find(n => n.type === 'project-spending' && n.projectId === selectedNode.projectId);
                          if (sn) { subValue = sn.value; subLabel = '支出額'; }
                        }
                      } else if (selectedNode.type === 'project-spending') {
                        mainValue = selectedNode.value;
                        mainLabel = '支出額';
                        if (selectedNode.projectId != null) {
                          const bn = filtered?.nodes.find(n => n.type === 'project-budget' && n.projectId === selectedNode.projectId);
                          if (bn) { subValue = bn.value; subLabel = '予算額'; }
                        }
                      } else {
                        mainValue = selectedNode.value;
                      }
                      const rawMain = selectedNode.isScaled && selectedNode.rawValue != null ? selectedNode.rawValue : null;
                      const rawMainLabel = mainLabel ? `元の${mainLabel}` : '元の値';
                      return (<>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#222', marginTop: 3 }}>
                          {mainLabel && <span style={{ fontSize: 10, color: '#aaa', fontWeight: 400, marginRight: 4 }}>{mainLabel}</span>}
                          {formatYen(mainValue)}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{Math.round(mainValue).toLocaleString()}円</div>
                        {rawMain !== null && (
                          <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>
                            <span style={{ fontSize: 10, color: '#ccc', marginRight: 4 }}>{rawMainLabel}</span>
                            {formatYen(rawMain)}
                            <span style={{ fontSize: 10, color: '#ccc', marginLeft: 4 }}>{Math.round(rawMain).toLocaleString()}円</span>
                          </div>
                        )}
                        {subValue !== null && (
                          <div style={{ fontSize: 12, color: '#777', marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: '#aaa', marginRight: 4 }}>{subLabel}</span>
                            {formatYen(subValue)}
                            <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>{Math.round(subValue).toLocaleString()}円</span>
                          </div>
                        )}
                      </>);
                    })()}
                  </div>
                  <button
                    onClick={() => selectNode(null)}
                    title="閉じる（選択解除）"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                  >✕</button>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ background: getNodeColor(selectedNode), color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                    {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                  </span>
                  {selectedNode.aggregated && (
                    <span style={{ background: '#999', color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>集約</span>
                  )}
                  {selectedNode.projectId != null && (
                    <span style={{ fontSize: 11, color: '#aaa' }}>PID:{selectedNode.projectId}</span>
                  )}
                  {selectedNode.ministry && selectedNode.type !== 'ministry' && (
                    <span style={{ fontSize: 11, color: '#666' }}>{selectedNode.ministry}</span>
                  )}
                </div>
              </div>

              {/* 事業概要アコーディオン — project-budget / project-spending（非集約）のみ */}
              {selectedNode && (selectedNode.type === 'project-budget' || selectedNode.type === 'project-spending') && !selectedNode.aggregated && selectedNode.projectId != null && (() => {
                const pid = selectedNode.projectId;
                const cachedDetail = projectDetailCache.get(`${year}-${pid}`);
                const isLoading = isProjectDetailExpanded && cachedDetail === undefined;
                const rsUrl = `https://rssystem.go.jp/project?q=${encodeURIComponent(selectedNode.name.replace(/\//g, ''))}&fiscalYear=${year}&isSearchTargetProjectName=true`;
                const handleToggle = () => setIsProjectDetailExpanded(v => !v);
                return (
                  <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', gap: 4 }}>
                      <button type="button" onClick={handleToggle}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                      >
                        <span style={{ fontSize: 11, color: '#888' }}>{isProjectDetailExpanded ? '▼' : '▶'}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>事業概要</span>
                      </button>
                      <a href={rsUrl} target="_blank" rel="noopener noreferrer"
                        title="RSシステムで開く"
                        style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="18" viewBox="0 0 24 20" fill="none">
                          <text x="12" y="16" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="sans-serif" fill="#4a90d9">RS</text>
                        </svg>
                      </a>
                      {cachedDetail?.url && /^https?:\/\//.test(cachedDetail.url) && (
                        <a href={cachedDetail.url} target="_blank" rel="noopener noreferrer"
                          title="事業概要URL"
                          style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9">
                            <path d="M320-440h320v-80H320v80Zm0 120h320v-80H320v80Zm0 120h200v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/>
                          </svg>
                        </a>
                      )}
                      <a href={`/subcontracts/${pid}?year=${year}`} target="_blank" rel="noopener noreferrer"
                        title="再委託構造を見る"
                        style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9">
                          <path d="M760-120q-39 0-70-22.5T647-200H440q-66 0-113-47t-47-113q0-66 47-113t113-47h80q33 0 56.5-23.5T600-600q0-33-23.5-56.5T520-680H313q-13 35-43.5 57.5T200-600q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T313-760h207q66 0 113 47t47 113q0 66-47 113t-113 47h-80q-33 0-56.5 23.5T360-360q0 33 23.5 56.5T440-280h207q13-35 43.5-57.5T760-360q50 0 85 35t35 85q0 50-35 85t-85 35ZM228.5-691.5Q240-703 240-720t-11.5-28.5Q217-760 200-760t-28.5 11.5Q160-737 160-720t11.5 28.5Q183-680 200-680t28.5-11.5Z"/>
                        </svg>
                      </a>
                    </div>
                    {!isProjectDetailExpanded && cachedDetail?.overview && (
                      <div style={{ padding: '0 14px 8px', fontSize: 11, color: '#888', lineHeight: 1.5,
                        maxHeight: '4.5em', overflowY: 'auto', wordBreak: 'break-all' }}>
                        {cachedDetail.overview}
                      </div>
                    )}
                    {isProjectDetailExpanded && (
                      <div style={{ padding: '0 14px 10px', fontSize: 12, color: '#444', maxHeight: 320, overflowY: 'auto' }}>
                        {isLoading && <span style={{ color: '#aaa' }}>読み込み中...</span>}
                        {!isLoading && cachedDetail === null && <span style={{ color: '#aaa' }}>詳細情報が見つかりませんでした</span>}
                        {!isLoading && cachedDetail && (() => {
                          const d = cachedDetail;
                          const fieldStyle: React.CSSProperties = { marginBottom: 8 };
                          const labelStyle: React.CSSProperties = { fontSize: 10, color: '#aaa', display: 'block', marginBottom: 2 };
                          const textStyle: React.CSSProperties = { lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
                          return (<>
                            {d.category && (
                              <div style={fieldStyle}>
                                <span style={labelStyle}>事業区分</span>
                                <span>{d.category}</span>
                                {(d.startYear || d.endYear || d.noEndDate) && (
                                  <span style={{ marginLeft: 8, color: '#888' }}>
                                    {d.startYear ?? (d.startYearUnknown ? '不明' : '?')}年度〜{d.noEndDate ? '終了予定なし' : (d.endYear ? `${d.endYear}年度` : '?')}
                                  </span>
                                )}
                              </div>
                            )}
                            {d.implementationMethods.length > 0 && (
                              <div style={fieldStyle}>
                                <span style={labelStyle}>実施方法</span>
                                <span>{d.implementationMethods.join('・')}</span>
                              </div>
                            )}
                            {d.overview && (
                              <div style={fieldStyle}>
                                <span style={labelStyle}>概要</span>
                                <span style={textStyle}>{d.overview}</span>
                              </div>
                            )}
                            {d.purpose && (
                              <div style={fieldStyle}>
                                <span style={labelStyle}>目的</span>
                                <span style={textStyle}>{d.purpose}</span>
                              </div>
                            )}
                            {d.url && (
                              <div style={fieldStyle}>
                                <a href={d.url} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 11, color: '#4a90d9', wordBreak: 'break-all' }}>
                                  事業概要URL ↗
                                </a>
                              </div>
                            )}
                          </>);
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 府省庁 / 事業 / 支出先 3タブ */}
              {panelSections && (() => {
                const tabBtnBase: React.CSSProperties = { flex: 1, padding: '6px 4px', fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', color: '#999' };
                const tabBtnActive: React.CSSProperties = { ...tabBtnBase, color: '#333', borderBottom: '2px solid #4a90d9' };
                type PanelItem = { id: string; name: string; value: number; aggregated?: boolean; budgetValue?: number; spendingValue?: number; recipientCount?: number; };
                const renderFlatList = (items: PanelItem[], getValue?: (item: PanelItem) => number) => {
                  const getVal = getValue ?? ((item: PanelItem) => item.value);
                  if (items.length === 0) return <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                  return items.map((item) => (
                    <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: item.aggregated ? 'default' : 'pointer', gap: 6, textAlign: 'left' }}
                    >
                      <span title={item.name} style={{ flex: 1, fontSize: 12, color: item.aggregated ? '#999' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(getVal(item))}</span>
                    </button>
                  ));
                };
                return (
                  <div style={{ borderTop: '1px solid #f0f0f0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fff' }}>
                      <button type="button" style={panelTab === 'ministry' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('ministry')}>
                        府省庁<span style={{ fontWeight: 400, fontSize: 11 }}>({panelSections.ministries.length})</span>
                      </button>
                      <button type="button" style={panelTab === 'project' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('project')}>
                        事業<span style={{ fontWeight: 400, fontSize: 11 }}>({panelSections.projects.length})</span>
                      </button>
                      <button type="button" style={panelTab === 'recipient' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('recipient')}>
                        支出先<span style={{ fontWeight: 400, fontSize: 11 }}>({panelSections.recipients.length})</span>
                      </button>
                    </div>
                    {/* Tab content */}
                    <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
                      {/* 府省庁タブ */}
                      {panelTab === 'ministry' && (() => {
                        const items = panelSections.ministries;
                        if (items.length === 0) return <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                        return items.map((item) => (
                          <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: item.aggregated ? 'default' : 'pointer', gap: 6, textAlign: 'left' }}
                          >
                            <span title={item.name} style={{ flex: 1, fontSize: 12, color: item.aggregated ? '#999' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                            <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {item.budgetValue != null
                                ? <>予{formatYen(item.budgetValue)} / 支{formatYen(item.spendingValue ?? item.value)}</>
                                : formatYen(item.value)
                              }
                            </span>
                          </button>
                        ));
                      })()}
                      {/* 事業タブ */}
                      {panelTab === 'project' && (() => {
                        const items = panelSections.projects;
                        if (items.length === 0) return <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                        return items.map((item) => (
                          <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #f5f5f5', width: '100%', background: 'transparent', border: 'none', cursor: item.aggregated ? 'default' : 'pointer', gap: 6, textAlign: 'left' }}
                          >
                            <span title={item.name} style={{ flex: 1, fontSize: 12, color: item.aggregated ? '#999' : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                            {item.budgetValue != null
                              ? <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>予{formatYen(item.budgetValue)} / 支{formatYen(item.spendingValue ?? item.value)}</span>
                              : <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(item.value)}</span>
                            }
                          </button>
                        ));
                      })()}
                      {/* 支出先タブ */}
                      {panelTab === 'recipient' && (() => {
                        const items = panelSections.recipients;
                        return renderFlatList(items);
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Year selector — top center */}
      <div data-pan-disabled="true" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
        <select
          value={year}
          onChange={e => { pendingHistoryAction.current = 'replace'; setYear(e.target.value as '2024' | '2025'); }}
          style={{ fontSize: 13, border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 28px 6px 10px', background: 'rgba(255,255,255,0.95)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', color: '#333', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
        >
          <option value="2025">2025年度</option>
          <option value="2024">2024年度</option>
        </select>
        {/* dropdown arrow */}
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </div>

      {/* Search box — top left */}
      <div
        ref={searchBoxRef}
        data-pan-disabled="true"
        style={{ position: 'absolute', top: 12, left: selectedNodeId !== null && !isPanelCollapsed ? 322 : 12, zIndex: 100, width: 296, transition: 'left 0.2s ease' }}
      >
        {/* Row 1: 検索セクション（input+sliders+toggle）とフィルタボタン */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {/* 検索セクション: input card（内部にsliders）+ toggle（TopNと同じ構造） */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Card: input + optional sliders（TopNのパネルdivに相当） */}
          <div style={{ background: 'rgba(255,255,255,0.95)', border: `1px solid ${searchRegexError ? '#e53935' : '#e0e0e0'}`, borderRadius: '8px 8px 0 0', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            {/* Input row */}
            <div style={{ position: 'relative' }}>
              {/* Search/Filter mode toggle icon */}
              <button
                type="button"
                title={filterActive ? 'フィルタモード（クリックで検索モードに切替）' : '検索モード（クリックでフィルタモードに切替）'}
                onClick={() => setFilterActive(f => !f)}
                style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20 }}
              >
                {filterActive ? (
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#1a73e8">
                    <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999">
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                )}
              </button>
              {/* Filter target select — フィルタモード時のみ表示、虫眼鏡の隣 */}
              {filterActive && (
                <select
                  value={filterTarget}
                  onChange={e => setFilterTarget(e.target.value as 'project' | 'recipient')}
                  style={{ position: 'absolute', left: 28, top: '50%', transform: 'translateY(-50%)', fontSize: 10, border: '1px solid #ddd', borderRadius: 3, padding: '1px 2px', background: 'rgba(255,255,255,0.9)', color: '#555', cursor: 'pointer', height: 20 }}
                >
                  <option value="project">事業</option>
                  <option value="recipient">支出先</option>
                </select>
              )}
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); if (!filterActive) setShowSearchResults(true); setSearchCursorIndex(-1); }}
                onFocus={() => { const q = debouncedQuery.trim(); if (meetsSearchMinLength(q)) setShowSearchResults(true); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setShowSearchResults(false); setSearchQuery(''); setDebouncedQuery(''); setSearchCursorIndex(-1); return; }
                  if (!showSearchResults || searchPagedResults.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchCursorIndex(i => {
                      const next = Math.min(i + 1, searchPagedResults.length - 1);
                      setTimeout(() => searchDropdownRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' }), 0);
                      return next;
                    });
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchCursorIndex(i => {
                      const next = Math.max(i - 1, 0);
                      setTimeout(() => searchDropdownRef.current?.children[next + 1]?.scrollIntoView({ block: 'nearest' }), 0);
                      return next;
                    });
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (searchCursorIndex >= 0 && searchCursorIndex < searchPagedResults.length) {
                      handleSearchSelect(searchPagedResults[searchCursorIndex].id);
                      setSearchCursorIndex(-1);
                    }
                  }
                }}
                placeholder={filterActive ? 'フィルタ' : '検索(2文字以上/PID)'}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  paddingLeft: filterActive ? 90 : 30, paddingRight: searchQuery ? 54 : 34, paddingTop: 7, paddingBottom: 7,
                  fontSize: 13, border: 'none', borderRadius: 8,
                  background: 'transparent', outline: 'none', color: '#333',
                }}
              />
              {/* .* regex toggle */}
              <button
                type="button"
                title={searchUseRegex ? '正規表現検索をオフ' : '正規表現で検索'}
                aria-label={searchUseRegex ? '正規表現検索をオフ' : '正規表現で検索'}
                aria-pressed={searchUseRegex}
                onClick={() => setSearchUseRegex(v => !v)}
                style={{
                  position: 'absolute', right: searchQuery ? 30 : 6, top: '50%', transform: 'translateY(-50%)',
                  background: searchUseRegex ? '#1a73e8' : 'transparent',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  color: searchUseRegex ? '#fff' : '#888',
                  fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold',
                  lineHeight: 1, padding: '2px 4px',
                }}
              >.*</button>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setDebouncedQuery(''); setShowSearchResults(false); searchInputRef.current?.focus(); }}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
                >✕</button>
              )}
            </div>{/* end input row */}

            {/* 金額フィルタ（card内部 — TopNのshowTopNSliders && <> に相当） */}
            {showAmountSliders && (
              <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* 府省庁フィルタ（複数選択ドロップダウン） */}
                {(() => {
                  const ministryNodes = (graphData?.nodes ?? []).filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
                  const allSelected = filterMinistryNames.length === 0;
                  const label = allSelected ? '全府省庁' : filterMinistryNames.length === 1 ? filterMinistryNames[0] : `選択中 (${filterMinistryNames.length}/${ministryNodes.length})`;
                  const chevron = (
                    <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="#aaa"
                      style={{ transform: showMinistryDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'block' }}>
                      <path d="M480-360 280-560h400L480-360Z"/>
                    </svg>
                  );
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} ref={ministryDropdownRef}>
                      <span style={{ fontSize: 11, color: '#555', width: 22, flexShrink: 0 }}>省庁</span>
                      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                        <button type="button" ref={ministryButtonRef}
                          onClick={() => {
                            if (ministryButtonRef.current) {
                              const r = ministryButtonRef.current.getBoundingClientRect();
                              setMinistryDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
                            }
                            setShowMinistryDropdown(v => !v);
                          }}
                          style={{ width: '100%', fontSize: 11, border: '1px solid #ddd', borderRadius: 4, padding: '3px 20px 3px 5px', background: '#fafafa', color: allSelected ? '#aaa' : '#333', outline: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >{label}</button>
                        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>{chevron}</span>
                        {showMinistryDropdown && ministryDropdownRect && createPortal(
                          <div style={{ position: 'fixed', top: ministryDropdownRect.top, left: ministryDropdownRect.left, width: ministryDropdownRect.width, zIndex: 9999, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: ministryDropdownRect.maxHeight, overflowY: 'auto' }}
                            onMouseDown={e => e.stopPropagation()}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                              <input type="checkbox" checked={allSelected} onChange={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames([]); }} style={{ width: 12, height: 12 }} />
                              <span style={{ fontSize: 11, color: '#333' }}>すべて選択/解除</span>
                            </label>
                            {ministryNodes.map(n => (
                              <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
                                <input type="checkbox"
                                  checked={!allSelected && filterMinistryNames.includes(n.name)}
                                  onChange={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames(prev => prev.includes(n.name) ? prev.filter(m => m !== n.name) : [...prev, n.name]); }}
                                  style={{ width: 12, height: 12 }} />
                                <span style={{ fontSize: 11, color: '#333' }}>{n.name}</span>
                              </label>
                            ))}
                          </div>,
                          document.body
                        )}
                      </div>
                      {!allSelected && (
                        <button type="button" onClick={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames([]); }}
                          style={{ fontSize: 10, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })()}
                {/* 予算・支出 テキスト入力 */}
                {([
                  { label: '予算', minText: filterMinBudgetText, maxText: filterMaxBudgetText, setMin: setFilterMinBudgetText, setMax: setFilterMaxBudgetText },
                  { label: '支出', minText: filterMinSpendingText, maxText: filterMaxSpendingText, setMin: setFilterMinSpendingText, setMax: setFilterMaxSpendingText },
                ] as const).map(({ label, minText, maxText, setMin, setMax }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: '#555', width: 22, flexShrink: 0 }}>{label}</span>
                    <input type="text" value={minText} onChange={e => setMin(e.target.value)}
                      placeholder="例: 100億、50万円"
                      style={{ flex: 1, minWidth: 0, fontSize: 11, border: `1px solid ${parseAmountToYen(minText) !== null || !minText ? '#ddd' : '#e53935'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                    />
                    <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>〜</span>
                    <input type="text" value={maxText} onChange={e => setMax(e.target.value)}
                      placeholder="例: 1兆、500億"
                      style={{ flex: 1, minWidth: 0, fontSize: 11, border: `1px solid ${parseAmountToYen(maxText) !== null || !maxText ? '#ddd' : '#e53935'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                    />
                    {(minText || maxText) && (
                      <button type="button" onClick={() => { setMin(''); setMax(''); }}
                        style={{ fontSize: 10, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 10, color: '#bbb', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>例: 1.26億 / 4567万円 / 1兆2000億</div>
              </div>
            )}
          </div>{/* end card */}

          {/* トグルボタン（card外・下部 — TopNの構造と同一） */}
          {(() => {
            return (
              <button
                type="button"
                title={showAmountSliders ? '金額フィルタ を隠す' : '金額フィルタ を表示'}
                aria-pressed={showAmountSliders}
                onClick={() => setShowAmountSliders(s => !s)}
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.92)', borderTop: 'none', borderLeft: '1px solid #e0e0e0', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', borderRadius: '0 0 4px 4px', cursor: 'pointer', padding: '0 2px', marginTop: -1, userSelect: 'none' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
                  <path d={showAmountSliders ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
                </svg>
              </button>
            );
          })()}
        </div>{/* end 検索セクション */}

        </div>{/* end Row 1 flex */}

        {/* Dropdown */}
        {!filterActive && showSearchResults && searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20 }}>
            {/* Count header */}
            <div style={{ padding: '5px 10px', fontSize: 11, color: '#999', borderBottom: '1px solid #f0f0f0' }}>
              {searchResults.length}件{searchTotalPages > 1 ? `（${searchPage + 1} / ${searchTotalPages} ページ）` : ''}
            </div>
            {/* Scrollable list */}
            <div ref={searchDropdownRef} style={{ maxHeight: searchDropdownMaxH, overflowY: 'auto' }}>
              {searchPagedResults.map((node, i) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => { handleSearchSelect(node.id); setSearchCursorIndex(-1); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: i === searchCursorIndex ? '#e8f0fe' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { if (i !== searchCursorIndex) e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i === searchCursorIndex ? '#e8f0fe' : 'transparent'; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: node.budgetValue !== undefined ? `linear-gradient(to right, ${TYPE_COLORS['project-budget']} 44%, ${TYPE_COLORS['project-spending']} 56%)` : getNodeColor(node) }} />
                  <span title={node.name} style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                  {node.projectId != null && <span style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', flexShrink: 0 }}>PID:{node.projectId}</span>}
                  {node.budgetValue !== undefined
                    ? <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>予{formatYen(node.budgetValue)} / 支{formatYen(node.value)}</span>
                    : <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(node.value)}</span>
                  }
                </button>
              ))}
            </div>
            {/* Pagination footer */}
            {searchTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderTop: '1px solid #f0f0f0' }}>
                <button type="button" onClick={() => { setSearchPage(p => Math.max(p - 1, 0)); setSearchCursorIndex(-1); }} disabled={searchPage === 0}
                  style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: 'transparent', cursor: searchPage === 0 ? 'default' : 'pointer', color: searchPage === 0 ? '#ccc' : '#555' }}>‹ 前へ</button>
                <button type="button" onClick={() => { setSearchPage(p => Math.min(p + 1, searchTotalPages - 1)); setSearchCursorIndex(-1); }} disabled={searchPage === searchTotalPages - 1}
                  style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: 'transparent', cursor: searchPage === searchTotalPages - 1 ? 'default' : 'pointer', color: searchPage === searchTotalPages - 1 ? '#ccc' : '#555' }}>次へ ›</button>
              </div>
            )}
          </div>
        )}
        {/* No results */}
        {!filterActive && showSearchResults && meetsSearchMinLength(debouncedQuery.trim()) && searchResults.length === 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '10px 12px', fontSize: 12, color: '#999', zIndex: 20 }}>
            該当なし
          </div>
        )}
      </div>

      {/* Top-right panel: offset slider */}
      {filtered && (() => {
        // Recipient offset mode
        const maxRecipOffset = Math.max(0, filtered.totalRecipientCount - topRecipient);
        const clampedOffset = Math.min(recipientOffset, maxRecipOffset);
        const recipRangeStart = clampedOffset + 1;
        const recipRangeEnd = Math.min(clampedOffset + topRecipient, filtered.totalRecipientCount);
        const recipMaxStartRank = maxRecipOffset + 1;
        // Project offset mode
        const maxProjOffset = Math.max(0, filtered.totalProjectCount - topProject);
        const clampedProjOffset = Math.min(projectOffset, maxProjOffset);
        const projRangeStart = clampedProjOffset + 1;
        const projRangeEnd = Math.min(clampedProjOffset + topProject, filtered.totalProjectCount);
        // Active values for shared controls
        const isProjectMode = offsetTarget === 'project';
        const activeOffset = isProjectMode ? clampedProjOffset : clampedOffset;
        const activeMax = isProjectMode ? maxProjOffset : maxRecipOffset;
        const activeTotalCount = isProjectMode ? filtered.totalProjectCount : filtered.totalRecipientCount;
        const activeRangeStart = isProjectMode ? projRangeStart : recipRangeStart;
        const activeRangeEnd = isProjectMode ? projRangeEnd : recipRangeEnd;
        const activeMaxStartRank = isProjectMode ? maxProjOffset + 1 : recipMaxStartRank;
        const setActiveOffset = (v: number) => {
          pendingHistoryAction.current = 'replace';
          if (isProjectMode) setProjectOffset(v); else setRecipientOffset(v);
        };
        return (
          <div style={{ position: 'absolute', top: 12, right: 52, zIndex: 15, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, rowGap: 4, background: 'rgba(255,255,255,0.92)', padding: '5px 10px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }}>
            {/* Row 1: オフセットスライダー（2列スパン） */}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* オフセット対象コンボボックス */}
              <select
                value={offsetTarget}
                onChange={e => { pendingHistoryAction.current = 'replace'; setOffsetTarget(e.target.value as 'recipient' | 'project'); }}
                style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 3, padding: '1px 2px', background: '#fff', color: '#555', cursor: 'pointer' }}
              >
                <option value="recipient">支出先</option>
                <option value="project">事業</option>
              </select>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#555', fontSize: 11 }}>Top</span>
                {isEditingOffset ? (
                  <input
                    type="number"
                    autoFocus
                    min={1} max={activeMaxStartRank} step={1}
                    value={offsetInputValue}
                    onChange={e => { setOffsetInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v >= 1) setActiveOffset(Math.max(0, Math.min(activeMax, v - 1))); }}
                    onBlur={() => setIsEditingOffset(false)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setIsEditingOffset(false); }}
                    style={{ width: `${Math.max(40, String(activeMaxStartRank).length * 8 + 20)}px`, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                  />
                ) : (
                  <button
                    onClick={() => { setOffsetInputValue(String(activeRangeStart)); setIsEditingOffset(true); }}
                    title="クリックして開始位置を入力"
                    style={{ color: '#999', fontSize: 11, background: 'transparent', border: 'none', cursor: 'text', padding: 0 }}
                  >{activeRangeStart}</button>
                )}
                <span style={{ color: '#999', fontSize: 11 }}>〜{activeRangeEnd}</span>
                <input type="range" min={0} max={activeMax} value={activeOffset} onChange={e => setActiveOffset(Number(e.target.value))} style={{ width: 60 }} />
                <span style={{ color: '#999', fontSize: 11 }}>/{activeTotalCount}件</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
                  {([
                    [1,  'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '次へ'],
                    [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '前へ'],
                  ] as [number, string, string][]).map(([delta, path, title]) => (
                    <button key={delta} title={title} aria-label={title}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        const step = () => {
                          pendingHistoryAction.current = 'replace';
                          if (isProjectMode) setProjectOffset(prev => Math.max(0, Math.min(activeMax, prev + delta)));
                          else setRecipientOffset(prev => Math.max(0, Math.min(activeMax, prev + delta)));
                        };
                        stopOffsetRepeat();
                        step();
                        offsetRepeatRef.current = setTimeout(() => {
                          offsetRepeatRef.current = setInterval(step, 150);
                        }, 400);
                      }}
                      onPointerUp={stopOffsetRepeat} onPointerLeave={stopOffsetRepeat} onPointerCancel={stopOffsetRepeat}
                      onClick={(e) => { if (e.detail === 0) setActiveOffset(Math.max(0, Math.min(activeMax, activeOffset + delta))); }}
                      style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path}/></svg>
                    </button>
                  ))}
                </div>
                {/* Material Icons: vertical_align_top — オフセットリセット */}
                <button onClick={e => { e.preventDefault(); setActiveOffset(0); }} title="先頭へリセット" aria-label="先頭へリセット"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#555" style={{ transform: 'rotate(-90deg)' }}><path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z"/></svg>
                </button>
              </label>
            </div>
            {/* Row 2: 事業・支出先 TopN スライダー（各グリッドセル） */}
            {showTopNSliders && <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ color: '#555', fontSize: 11, whiteSpace: 'nowrap' }}>事業</span>
                <input
                  type="range" min={1} max={300} step={1}
                  value={localTopProject ?? topProject}
                  onChange={e => { setLocalTopProject(Number(e.target.value)); }}
                  onPointerUp={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, v))); setLocalTopProject(null); }}
                  onTouchEnd={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, v))); setLocalTopProject(null); }}
                  onKeyUp={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, v))); setLocalTopProject(null); }}
                  onBlur={e => { if (localTopProject === null) return; const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, v))); setLocalTopProject(null); }}
                  style={{ flex: 1, minWidth: 0, width: 0 }}
                />
                {isEditingTopProject ? (
                  <input type="number" autoFocus min={1} max={300} step={1}
                    value={topProjectInputValue}
                    onChange={e => setTopProjectInputValue(e.target.value)}
                    onBlur={() => { const v = Number(topProjectInputValue); if (!isNaN(v) && v >= 1) { pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, v))); } setIsEditingTopProject(false); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                    style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 11 }}
                  />
                ) : (
                  <button onClick={() => { setTopProjectInputValue(String(topProject)); setIsEditingTopProject(true); }} title="クリックして直接入力"
                    style={{ color: '#999', fontSize: 11, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  >{localTopProject ?? topProject}</button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
                  {([
                    [1,  'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '増やす'],
                    [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '減らす'],
                  ] as [number, string, string][]).map(([delta, path, title]) => (
                    <button key={delta} title={title} aria-label={title}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        const step = () => { pendingHistoryAction.current = 'replace'; setTopProject(prev => Math.max(1, Math.min(300, prev + delta))); };
                        stopTopNRepeat(); step();
                        topNRepeatRef.current = setTimeout(() => { topNRepeatRef.current = setInterval(step, 150); }, 400);
                      }}
                      onPointerUp={stopTopNRepeat} onPointerLeave={stopTopNRepeat} onPointerCancel={stopTopNRepeat}
                      onClick={(e) => { if (e.detail === 0) { pendingHistoryAction.current = 'replace'; setTopProject(prev => Math.max(1, Math.min(300, prev + delta))); } }}
                      style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path}/></svg>
                    </button>
                  ))}
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ color: '#555', fontSize: 11, whiteSpace: 'nowrap' }}>支出先</span>
                <input
                  type="range" min={1} max={300} step={1}
                  value={localTopRecipient ?? topRecipient}
                  onChange={e => { setLocalTopRecipient(Number(e.target.value)); }}
                  onPointerUp={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, v))); setLocalTopRecipient(null); }}
                  onTouchEnd={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, v))); setLocalTopRecipient(null); }}
                  onKeyUp={e => { const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, v))); setLocalTopRecipient(null); }}
                  onBlur={e => { if (localTopRecipient === null) return; const v = Number((e.target as HTMLInputElement).value); pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, v))); setLocalTopRecipient(null); }}
                  style={{ flex: 1, minWidth: 0, width: 0 }}
                />
                {isEditingTopRecipient ? (
                  <input type="number" autoFocus min={1} max={300} step={1}
                    value={topRecipientInputValue}
                    onChange={e => setTopRecipientInputValue(e.target.value)}
                    onBlur={() => { const v = Number(topRecipientInputValue); if (!isNaN(v) && v >= 1) { pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, v))); } setIsEditingTopRecipient(false); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                    style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 11 }}
                  />
                ) : (
                  <button onClick={() => { setTopRecipientInputValue(String(topRecipient)); setIsEditingTopRecipient(true); }} title="クリックして直接入力"
                    style={{ color: '#999', fontSize: 11, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  >{localTopRecipient ?? topRecipient}</button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
                  {([
                    [1,  'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '増やす'],
                    [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '減らす'],
                  ] as [number, string, string][]).map(([delta, path, title]) => (
                    <button key={delta} title={title} aria-label={title}
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse' && e.button !== 0) return;
                        const step = () => { pendingHistoryAction.current = 'replace'; setTopRecipient(prev => Math.max(1, Math.min(300, prev + delta))); };
                        stopTopNRepeat(); step();
                        topNRepeatRef.current = setTimeout(() => { topNRepeatRef.current = setInterval(step, 150); }, 400);
                      }}
                      onPointerUp={stopTopNRepeat} onPointerLeave={stopTopNRepeat} onPointerCancel={stopTopNRepeat}
                      onClick={(e) => { if (e.detail === 0) { pendingHistoryAction.current = 'replace'; setTopRecipient(prev => Math.max(1, Math.min(300, prev + delta))); } }}
                      style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path}/></svg>
                    </button>
                  ))}
                </div>
              </label>
            </>}
          </div>
          {/* トグルボタン（パネル外・下部） */}
          <button
            onClick={() => setShowTopNSliders(s => !s)}
            title={showTopNSliders ? 'TopN設定 を隠す' : 'TopN設定 を表示'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.92)', borderTop: 'none', borderLeft: '1px solid #e0e0e0', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', borderRadius: '0 0 4px 4px', cursor: 'pointer', padding: '0 2px', marginTop: -1, userSelect: 'none' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
              <path d={showTopNSliders ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
            </svg>
          </button>
          </div>
        );
      })()}

      {/* Settings button — independent, top right */}
      <div style={{ position: 'absolute', top: 14, right: 12, zIndex: 15 }}>
        <button
          onClick={() => setShowSettings(s => !s)}
          aria-label="表示設定を開く"
          aria-expanded={showSettings}
          aria-controls="sankey-topn-settings"
          aria-haspopup="dialog"
          style={{ width: 32, height: 32, border: 'none', borderRadius: 6, background: showSettings ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Material Icons: more_vert */}
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill={showSettings ? '#333' : '#888'}>
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
        {showSettings && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 18 }} onMouseDown={() => setShowSettings(false)} />
            <div id="sankey-topn-settings" role="dialog" aria-label="表示設定" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowSettings(false); }} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 19, background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '12px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', fontSize: 12, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10, colorScheme: 'light', color: '#333' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showLabels} onChange={e => { pendingHistoryAction.current = 'replace'; setShowLabels(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>すべてのノードラベルを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAggRecipient} onChange={e => { pendingHistoryAction.current = 'replace'; setShowAggRecipient(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>支出先の集約ノードを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAggProject} onChange={e => { pendingHistoryAction.current = 'replace'; setShowAggProject(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>事業の集約ノードを表示</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#555' }}>事業ノードの並び順:</span>
                <select value={projectSortBy} onChange={e => { pendingHistoryAction.current = 'replace'; setProjectSortBy(e.target.value as 'budget' | 'spending'); }} style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }} data-pan-disabled>
                  <option value="budget">予算額</option>
                  <option value="spending">支出額</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={scaleBudgetToVisible} onChange={e => { pendingHistoryAction.current = 'replace'; setScaleBudgetToVisible(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>事業の予算額を支出額に合わせて調整</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={autoFocusRelated} onChange={e => { pendingHistoryAction.current = 'replace'; setAutoFocusRelated(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>選択時に関連ノードのみ表示</span>
              </label>
            </div>
          </>
        )}
      </div>

      {/* Zoom controls — bottom right (sankey2 style) */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* スクロールモード切替ボタン */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
          <button
            aria-label={scrollMode === 'pan' ? 'スクロール移動モード（クリックでズームモードへ）' : 'スクロール移動モードに切替'}
            title={scrollMode === 'pan' ? 'スクロール: 移動モード\nCtrl/Cmd+スクロール = ズーム\nクリックでズームモードへ' : 'スクロール: ズームモード\nクリックで移動モードへ'}
            onClick={() => setScrollMode(m => m === 'zoom' ? 'pan' : 'zoom')}
            style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: scrollMode === 'pan' ? '#e8f0fe' : 'transparent', cursor: 'pointer' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill={scrollMode === 'pan' ? '#1a73e8' : '#bbb'}><path d="M480-80 310-250l57-57 73 73v-166H274l73 74-57 57L120-440l170-170 57 57-74 73h166v-166l-73 73-57-57 170-170 170 170-57 57-73-73v166h166l-74-73 57-57 170 170-170 170-57-57 74-74H520v166l73-73 57 57L480-80Z"/></svg>
          </button>
        </div>
        {/* + / vertical slider / - */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Material Icons: add */}
          <button aria-label="ズームイン" onClick={() => applyZoom(1.5)} title="ズームイン" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
          <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="range"
              aria-label="ズーム倍率"
              min={Math.log10(0.2)}
              max={Math.log10(baseZoom * 10)}
              step={0.01}
              value={Math.log10(Math.max(0.2, Math.min(baseZoom * 10, zoom)))}
              onChange={e => { const newK = Math.pow(10, parseFloat(e.target.value)); applyZoom(newK / zoom); }}
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
              title={`Zoom: ${Math.round(zoom / baseZoom * 100)}%`}
            />
          </div>
          {/* Material Icons: remove */}
          <button aria-label="ズームアウト" onClick={() => applyZoom(1 / 1.5)} title="ズームアウト" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z"/></svg>
          </button>
        </div>
        {/* Zoom% — 非編集時は "N%" 表示、クリックで数値入力 */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
          {isEditingZoom ? (
            <input
              type="number"
              autoFocus
              min={1} max={1000} step={1}
              value={zoomInputValue}
              onChange={e => { setZoomInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / zoom); }}
              onBlur={() => setIsEditingZoom(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setIsEditingZoom(false); }}
              style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', outline: 'none', background: 'transparent', color: '#555', boxSizing: 'border-box' }}
            />
          ) : (
            <button
              onClick={() => { setZoomInputValue(String(Math.round(zoom / baseZoom * 100))); setIsEditingZoom(true); }}
              title="クリックしてZoom率を入力"
              style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '4px 0', border: 'none', background: 'transparent', color: '#888', cursor: 'text' }}
            >{Math.round(zoom / baseZoom * 100)}%</button>
          )}
        </div>
        {/* 全体表示ボタン */}
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
          {/* fit screen */}
          <button aria-label="全体表示" onClick={resetViewport} title="全体表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z"/></svg>
          </button>
        </div>
        {/* 関連ノードのみ表示トグル — Pin状態のときのみ表示 */}
        {selectedNode && (
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {/* Material Icons: account_tree — 関連ノードのみ表示トグル */}
            <button
              aria-label={focusRelated ? '関連ノードのみ表示 ON（クリックでOFF）' : '関連ノードのみ表示 OFF（クリックでON）'}
              title={focusRelated ? '関連ノードのみ表示: ON\nクリックでOFF' : '関連ノードのみ表示: OFF\nクリックでON'}
              onClick={() => {
                pendingHistoryAction.current = 'push';
                const next = !focusRelated;
                if (next && selectedNode) {
                  const pins = computeFocusPins(selectedNode.id, graphData?.nodes);
                  setPinnedProjectId(pins.pinnedProjectId);
                  setPinnedRecipientId(pins.pinnedRecipientId);
                  setPinnedMinistryName(pins.pinnedMinistryName);
                  if (pins.pinnedProjectId) pinnedContextProjectId.current = pins.pinnedProjectId;
                  pendingResetViewport.current = true;
                } else if (!next) {
                  setPinnedProjectId(null);
                  setPinnedRecipientId(null);
                  setPinnedMinistryName(null);
                  // 選択ノードがある場合はレイアウト更新後にオフセット調整
                  if (selectedNode) pendingConnectionNodeId.current = selectedNode.id;
                }
                setFocusRelated(next);
              }}
              style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: focusRelated ? '#e8f0fe' : 'transparent', cursor: 'pointer' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill={focusRelated ? '#1a73e8' : '#888'}><path transform="scale(-1, 1) translate(-960, 0)" d="M576-168v-84H444v-192h-60v84H96v-240h288v84h60v-192h132v-84h288v240H576v-84h-60v312h60v-84h288v240H576Zm72-72h144v-96H648v96ZM168-432h144v-96H168v96Zm480-192h144v-96H648v96Zm0 384v-96 96ZM312-432v-96 96Zm336-192v-96 96Z"/></svg>
            </button>
            {/* 選択ノードにフォーカス */}
            <button aria-label="選択ノードにフォーカス" onClick={focusOnSelectedNode} title="選択ノードにフォーカス" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', borderTop: '1px solid #eee', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path transform="rotate(180 480 -480)" d="M168-360h240v-240H168v240Zm312 72H96v-384h384v156h384v72H480v156ZM288-480Z"/></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
