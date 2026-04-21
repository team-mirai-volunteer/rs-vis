'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { GraphData, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import type { ProjectDetail } from '@/types/project-details';
import {
  COL_LABELS, MARGIN, NODE_W, NODE_PAD,
  TYPE_LABELS,
  getColumn, getNodeColor, getLinkColor, ribbonPath, formatYen,
} from '@/app/lib/sankey-svg-constants';
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
  includeZeroSpending: boolean;
  showAggRecipient: boolean;
  showAggProject: boolean;
  projectSortBy: 'budget' | 'spending';
  scaleBudgetToVisible: boolean;
  focusRelated: boolean;
  year: '2024' | '2025';
  zoom?: number;
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
  const iz = p.get('iz'); if (iz !== null) result.includeZeroSpending = iz !== '0';
  const ar = p.get('ar'); if (ar !== null) result.showAggRecipient = ar !== '0';
  const ap = p.get('ap'); if (ap !== null) result.showAggProject = ap !== '0';
  const ps = p.get('ps'); if (ps === 's') result.projectSortBy = 'spending';
  const sb = p.get('sb'); if (sb !== null) result.scaleBudgetToVisible = sb !== '0';
  const fr = p.get('fr'); if (fr !== null) result.focusRelated = fr !== '0';
  const yr = p.get('yr'); if (yr === '2024' || yr === '2025') result.year = yr;
  const z = p.get('z'); if (z !== null) { const n = parseFloat(z); if (!isNaN(n) && n >= 0.1 && n <= 10) result.zoom = n; }
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
  const [includeZeroSpending, setIncludeZeroSpending] = useState(false);
  const [showAggRecipient, setShowAggRecipient] = useState(true);
  const [showAggProject, setShowAggProject] = useState(true);
  const [projectSortBy, setProjectSortBy] = useState<'budget' | 'spending'>('budget');
  const [scaleBudgetToVisible, setScaleBudgetToVisible] = useState(true);
  const [focusRelated, setFocusRelated] = useState(true);
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isEditingOffset, setIsEditingOffset] = useState(false);
  const [offsetInputValue, setOffsetInputValue] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchCursorIndex, setSearchCursorIndex] = useState(-1);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const isPidQuery = (q: string) => /^\d+$/.test(q);
  const meetsSearchMinLength = (q: string) => isPidQuery(q) ? q.length >= 1 : q.length >= 2;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const [zeroSpendingAlert, setZeroSpendingAlert] = useState(false);
  const zeroSpendingAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the next URL update should push (navigation) or replace (slider/toggle)
  const pendingHistoryAction = useRef<'push' | 'replace' | null>(null);
  const pendingFocusId = useRef<string | null>(null);
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
    if (parsed.includeZeroSpending !== undefined) setIncludeZeroSpending(parsed.includeZeroSpending);
    if (parsed.showAggRecipient !== undefined) setShowAggRecipient(parsed.showAggRecipient);
    if (parsed.showAggProject !== undefined) setShowAggProject(parsed.showAggProject);
    if (parsed.projectSortBy !== undefined) setProjectSortBy(parsed.projectSortBy);
    if (parsed.scaleBudgetToVisible !== undefined) setScaleBudgetToVisible(parsed.scaleBudgetToVisible);
    if (parsed.focusRelated !== undefined) setFocusRelated(parsed.focusRelated);
    if (parsed.year !== undefined) setYear(parsed.year);
    // Restore zoom only when no sel= (focusOnNeighborhood will handle zoom for sel= case)
    if (parsed.zoom !== undefined && parsed.selectedNodeId === undefined) {
      urlRestoredZoomRef.current = parsed.zoom;
    }
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
      setIncludeZeroSpending(parsed.includeZeroSpending ?? false);
      setShowAggRecipient(parsed.showAggRecipient ?? true);
      setShowAggProject(parsed.showAggProject ?? true);
      setProjectSortBy(parsed.projectSortBy ?? 'budget');
      setScaleBudgetToVisible(parsed.scaleBudgetToVisible ?? true);
      setFocusRelated(parsed.focusRelated ?? true);
      if (parsed.year !== undefined) setYear(parsed.year);
      if (parsed.selectedNodeId) pendingFocusId.current = parsed.selectedNodeId;
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
    if (includeZeroSpending) p.set('iz', '1');
    if (!showAggRecipient) p.set('ar', '0');
    if (!showAggProject) p.set('ap', '0');
    if (projectSortBy === 'spending') p.set('ps', 's');
    if (!scaleBudgetToVisible) p.set('sb', '0');
    if (!focusRelated) p.set('fr', '0');
    if (year !== '2025') p.set('yr', year);
    const qs = p.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    if (action === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
  }, [selectedNodeId, pinnedProjectId, pinnedRecipientId, pinnedMinistryName, recipientOffset, offsetTarget, projectOffset, topMinistry, topProject, topRecipient, showLabels, includeZeroSpending, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, year]);

  // Keep zoomRef in sync for debounce callbacks
  // (declared before zoom state so the effect below can reference it)

  // Zoom/Pan state
  const [zoom, setZoom] = useState(1);
  // Keep zoomRef current for use in debounce timeouts
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
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

  // Reset both offsets when offsetTarget switches
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
    // Mouse position relative to SVG
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(baseZoom * 10, zoom * delta));

    // Adjust pan so zoom centers on mouse position
    const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
    const newPanY = my - (my - pan.y) * (newZoom / zoom);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
    scheduleZoomUrlWrite();
  }, [zoom, pan, baseZoom, scheduleZoomUrlWrite]);

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
  const showMinimap = true;

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

  const filtered = useMemo(() => {
    if (!graphData) return null;
    const maxOffset = Math.max(0, (graphData.nodes.filter(n => n.type === 'recipient').length) - topRecipient);
    const clampedOffset = Math.min(recipientOffset, maxOffset);
    return filterTopN(graphData.nodes, graphData.edges, topMinistry, topProject, topRecipient, clampedOffset, pinnedProjectId, includeZeroSpending, showAggRecipient, showAggProject, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset, projectSortBy);
  }, [graphData, topMinistry, topProject, topRecipient, recipientOffset, pinnedProjectId, includeZeroSpending, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset]);

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
    const budgetByPid = new Map(
      graphData.nodes
        .filter((n): n is typeof n & { projectId: number } => n.type === 'project-budget' && n.projectId != null)
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
    for (const n of graphData.nodes) {
      if (n.type === 'project-budget' && n.ministry) ministryProjectCounts.set(n.ministry, (ministryProjectCounts.get(n.ministry) || 0) + 1);
      if (n.type === 'project-spending' && n.ministry) {
        if (!ministrySpendingIdsMap.has(n.ministry)) ministrySpendingIdsMap.set(n.ministry, new Set());
        ministrySpendingIdsMap.get(n.ministry)!.add(n.id);
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
        id: n.id, name: n.name, value: n.value,
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
      const ministries: PanelEntry[] = [{ id: selectedNode.id, name: selectedNode.name, value: selectedNode.value, projectCount: projects.length, recipientCount: recipients.length }];
      return { ministries, projects, recipients };
    }

    // ── project-budget / project-spending (non-aggregated) ─────────────
    if ((ntype === 'project-budget' || ntype === 'project-spending') && !selectedNode.aggregated) {
      const pid = selectedNode.projectId;
      const budgetNode = ntype === 'project-budget' ? nodeById.get(nid) : (pid != null ? budgetByPid.get(pid) : undefined);
      const spendingNode = pid != null ? spendingByPid.get(pid) : undefined;
      const ministryName = selectedNode.ministry ?? budgetNode?.ministry ?? spendingNode?.ministry;
      const ministryNode = ministryName ? graphData.nodes.find(n => n.type === 'ministry' && n.name === ministryName) : undefined;
      const ministries: PanelEntry[] = ministryNode ? [{ id: ministryNode.id, name: ministryNode.name, value: ministryNode.value }] : [];
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
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value }; });
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
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => { const n = nodeById.get(id); return { id, name: n?.name ?? id, value, ministry: n?.ministry }; }).sort((a, b) => b.value - a.value);
      const mMap = new Map<string, number>();
      for (const p of projects) { if (p.ministry) mMap.set(p.ministry, (mMap.get(p.ministry) || 0) + p.value); }
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value }; });
      const recipients: PanelEntry[] = [{ id: nid, name: selectedNode.name, value: selectedNode.value }];
      return { ministries, projects, recipients };
    }

    // ── __agg-recipient ────────────────────────────────────────────────
    if (nid === '__agg-recipient') {
      const aggRcpts = filtered?.aggNodeMembers?.get('__agg-recipient') ?? [];
      const pMap = new Map<string, number>();
      for (const r of aggRcpts) { for (const e of graphData.edges) { if (e.target === r.id) pMap.set(e.source, (pMap.get(e.source) || 0) + e.value); } }
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => { const n = nodeById.get(id); return { id, name: n?.name ?? id, value, ministry: n?.ministry }; }).sort((a, b) => b.value - a.value);
      const mMap = new Map<string, number>();
      for (const p of projects) { if (p.ministry) mMap.set(p.ministry, (mMap.get(p.ministry) || 0) + p.value); }
      const ministries: PanelEntry[] = Array.from(mMap.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => { const mn = graphData.nodes.find(n => n.type === 'ministry' && n.name === name); return { id: mn?.id ?? `ministry-${name}`, name, value }; });
      const recipients: PanelEntry[] = aggRcpts.map(r => ({ id: r.id, name: r.name, value: r.value }));
      return { ministries, projects, recipients };
    }

    // ── __agg-ministry ─────────────────────────────────────────────────
    if (nid === '__agg-ministry') {
      const aggMins = filtered?.aggNodeMembers?.get('__agg-ministry') ?? [];
      const ministries: PanelEntry[] = aggMins.map(m => ({ id: m.id, name: m.name, value: m.value }));
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
    if (id === null) { setPinnedProjectId(null); setPinnedRecipientId(null); setPinnedMinistryName(null); }
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
    const neighborIds = new Set<string>([node.id]);
    for (const l of node.sourceLinks) neighborIds.add(l.target.id);
    for (const l of node.targetLinks) neighborIds.add(l.source.id);
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
    // Block selection of zero-spending projects when includeZeroSpending is OFF
    if (!includeZeroSpending && graphData) {
      const spId = nodeId.startsWith('project-budget-')
        ? nodeId.replace('project-budget-', 'project-spending-')
        : nodeId;
      if (spId.startsWith('project-spending-')) {
        const spNode = graphData.nodes.find(n => n.id === spId);
        if (spNode && spNode.value === 0) {
          if (zeroSpendingAlertTimer.current) clearTimeout(zeroSpendingAlertTimer.current);
          setZeroSpendingAlert(true);
          zeroSpendingAlertTimer.current = setTimeout(() => setZeroSpendingAlert(false), 3500);
          return;
        }
      }
    }
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
    if (focusRelated) {
      // focusRelated ON: 現在のフォーカスコンテキストをクリアして新しいノードに切り替える
      const pins = computeFocusPins(nodeId, graphData?.nodes);
      setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
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
    } else {
      setPinnedProjectId(null);
    }
    // Out-of-layout node: focus via effect once it appears in layout after pin/offset jump
    pendingFocusId.current = nodeId;
    selectNode(nodeId);
  }, [layout, filtered, allRecipientRanks, topRecipient, selectNode, graphData, focusOnNeighborhood, pinnedProjectId, isPanelCollapsed, focusRelated, setPinnedRecipientId, setPinnedMinistryName, includeZeroSpending, offsetTarget]);

  const handleNodeClick = useCallback((node: LayoutNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (didPanRef.current) return;
    const newId = selectedNodeId === node.id ? null : node.id;
    if (focusRelated && newId !== null && !node.aggregated) {
      const pins = computeFocusPins(node.id, graphData?.nodes);
      setPinnedProjectId(pins.pinnedProjectId); setPinnedRecipientId(pins.pinnedRecipientId); setPinnedMinistryName(pins.pinnedMinistryName);
    } else if (!focusRelated || newId === null) {
      setPinnedRecipientId(null);
      setPinnedMinistryName(null);
    }
    selectNode(newId);
  }, [selectedNodeId, selectNode, focusRelated, graphData]);

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
    const results: { id: string; name: string; type: string; value: number; projectId?: number }[] = [];
    let matcher: (name: string) => boolean;
    if (pidQuery !== null) {
      matcher = () => false;
    } else if (searchUseRegex) {
      if (q.length > SEARCH_REGEX_MAX_LEN) return [];
      try { const re = new RegExp(q, 'i'); matcher = name => re.test(name); }
      catch { return []; }  // invalid regex → no results
    } else {
      const qLower = q.toLocaleLowerCase();
      matcher = name => name.toLocaleLowerCase().includes(qLower);
    }
    for (const n of graphData.nodes) {
      if (pidQuery !== null) {
        if (n.type === 'project-spending' && n.projectId === pidQuery) results.push({ id: n.id, name: n.name, type: n.type, value: n.value, projectId: n.projectId });
      } else {
        if (matcher(n.name)) results.push({ id: n.id, name: n.name, type: n.type, value: n.value, projectId: n.projectId });
      }
    }
    return results.sort((a, b) => b.value - a.value);
  }, [graphData, debouncedQuery, searchUseRegex]);

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
    if (!pendingFocusId.current || !layout || isPanelCollapsed) return;
    const node = layout.nodes.find(n => n.id === pendingFocusId.current);
    if (!node) return;
    pendingFocusId.current = null;
    focusOnNeighborhood(node);
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

  // Escape key deselects via window listener (reliable regardless of focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') selectNode(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectNode]);

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

      {zeroSpendingAlert && (
        <div style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', background: '#fff8e1', border: '1px solid #f9a825', color: '#5d4037', padding: '10px 18px', borderRadius: 8, fontSize: 13, boxShadow: '0 2px 10px rgba(0,0,0,0.15)', zIndex: 30, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          支出0円のため現在の設定では選択できません。「支出0円事業を対象にする」をオンにしてください。
        </div>
      )}

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
                onClick={() => { if (!didPanRef.current) selectNode(null); }}
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
                                fill={connectedNodeIds && !isConnected ? '#bbb' : '#333'}
                                style={{ userSelect: 'none', cursor: 'pointer' }} clipPath={`url(#clip-col-${getColumn(node)})`}
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
                            <text x={node.x0 - 3} y={bH / 2} fontSize={11 / zoom} dominantBaseline="middle" textAnchor="end"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer' }}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => handleNodeClick(node, e)}>
                              {formatYen(node.value)}{node.isScaled && node.rawValue != null && <tspan fill="#888"> / {formatYen(node.rawValue)}</tspan>}
                            </text>
                            {/* Right label: project name + spending amount */}
                            <text x={spendingNode.x1 + 3} y={sH / 2} fontSize={11 / zoom} dominantBaseline="middle"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer' }} clipPath={`url(#clip-col-${getColumn(node)})`}
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
                            fill={connectedNodeIds && !connectedNodeIds.has(node.id) ? '#bbb' : '#333'}
                            style={{ userSelect: 'none', cursor: 'pointer' }}
                            clipPath={isLastCol ? undefined : `url(#clip-col-${col})`}
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
              // Screen y of node area top — label bottom sits just above this
              const nodeAreaScreenY = pan.y + MARGIN.top * zoom;
              return COL_LABELS.map((label, i) => {
                const colInnerX = MARGIN.left + (i / maxCol) * (innerW - NODE_W) + NODE_W / 2;
                const screenX = pan.x + colInnerX * zoom;
                const total = colAmounts[i];
                const amountLine = i === 2 && total != null
                  ? `${formatYen(total)} / ${formatYen(projectSpendingTotal)}`
                  : total != null ? formatYen(total) : '';
                // Position: bottom of label block 8px above node area top, clamped to stay on-screen
                const labelBlockH = amountLine ? 34 : 18;
                const top = Math.max(SEARCH_BOX_RESERVE, nodeAreaScreenY - labelBlockH - 8);
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
            {showMinimap && (
              <canvas
                ref={minimapRef}
                width={MINIMAP_W}
                height={minimapH}
                onClick={(e) => { e.stopPropagation(); minimapNavigate(e); }}
                onMouseDown={(e) => { e.stopPropagation(); minimapDragging.current = true; minimapNavigate(e); }}
                onMouseMove={(e) => { if (minimapDragging.current) minimapNavigate(e); }}
                onMouseUp={() => { minimapDragging.current = false; }}
                onMouseLeave={() => { minimapDragging.current = false; }}
                style={{
                  position: 'absolute',
                  left: selectedNodeId !== null ? (isPanelCollapsed ? 26 : 318) : 8,
                  bottom: 8,
                  zIndex: 10,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  cursor: 'crosshair',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  transition: 'left 0.2s ease',
                }}
              />
            )}

          {/* DOM tooltip — link hover */}
          {hoveredLink && !hoveredNode && (
            <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y - 10, background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '6px 10px', borderRadius: 4, fontSize: 12, lineHeight: 1.4, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20 }}>
              <div>{hoveredLink.source.name} → {hoveredLink.target.name}</div>
              <div style={{ color: '#adf' }}>{formatYen(hoveredLink.value)}</div>
              <div style={{ color: '#aaa', fontSize: 11 }}>{Math.round(hoveredLink.value).toLocaleString()}円</div>
            </div>
          )}
          {/* DOM tooltip — node hover (mini: name + amount only) */}
          {hoveredNode && (
            <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y - 10, background: 'rgba(0,0,0,0.78)', color: '#fff', padding: '5px 9px', borderRadius: 4, fontSize: 12, lineHeight: 1.4, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20 }}>
              <div style={{ fontWeight: 500 }}>{hoveredNode.name}</div>
              <div style={{ color: '#7df', fontSize: 11 }}>{formatYen(hoveredNode.value)}</div>
              <div style={{ color: '#aaa', fontSize: 10 }}>{Math.round(hoveredNode.value).toLocaleString()}円</div>
              {hoveredNode.isScaled && hoveredNode.rawValue != null && (
                <div style={{ color: '#888', fontSize: 10 }}>/ {formatYen(hoveredNode.rawValue)}</div>
              )}
            </div>
          )}
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
              <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y + 16, background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '8px 12px', borderRadius: 4, fontSize: 12, lineHeight: 1.5, pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap' }}>
                <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{COL_LABELS[hoveredColIndex]}</div>
                {count != null && <div style={{ color: '#aaa', fontSize: 11 }}>{count.toLocaleString()}件</div>}
                <div style={{ color: '#7df' }}>{formatYen(total)}</div>
                <div style={{ color: '#aaa', fontSize: 11 }}>{Math.round(total).toLocaleString()}円</div>
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
                            <span style={{ fontSize: 11, color: '#777', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                              {item.projectCount != null && <span style={{ fontSize: 10, color: '#bbb' }}>事業{item.projectCount.toLocaleString()}件</span>}
                              {item.recipientCount != null && <span style={{ fontSize: 10, color: '#bbb' }}>支出先{item.recipientCount.toLocaleString()}件</span>}
                              {formatYen(item.value)}
                            </span>
                          </button>
                        ));
                      })()}
                      {/* 事業タブ */}
                      {panelTab === 'project' && (() => {
                        const items = panelSections.projects;
                        if (items.length === 0) return <p style={{ fontSize: 12, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                        return renderFlatList(items, item => item.budgetValue ?? item.value);
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
        data-pan-disabled="true"
        style={{ position: 'absolute', top: 12, left: selectedNodeId !== null && !isPanelCollapsed ? 322 : 12, zIndex: 100, width: 260, transition: 'left 0.2s ease' }}
      >
        <div style={{ position: 'relative' }}>
          {/* Search icon */}
          <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="#999"
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true); setSearchCursorIndex(-1); }}
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
            placeholder="ノード検索（2文字以上／PIDは1文字〜）"
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 30, paddingRight: searchQuery ? 54 : 34, paddingTop: 7, paddingBottom: 7,
              fontSize: 13,
              border: `1px solid ${searchRegexError ? '#e53935' : '#e0e0e0'}`, borderRadius: 8,
              background: 'rgba(255,255,255,0.95)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              outline: 'none', color: '#333',
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
              border: 'none',
              borderRadius: 4, cursor: 'pointer',
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
        </div>
        {/* Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20 }}>
            {/* Count header */}
            <div style={{ padding: '5px 10px', fontSize: 11, color: '#999', borderBottom: '1px solid #f0f0f0' }}>
              {searchResults.length}件{searchTotalPages > 1 ? `（${searchPage + 1} / ${searchTotalPages} ページ）` : ''}
            </div>
            {/* Scrollable list */}
            <div ref={searchDropdownRef} style={{ maxHeight: 280, overflowY: 'auto' }}>
              {searchPagedResults.map((node, i) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => { handleSearchSelect(node.id); setSearchCursorIndex(-1); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: i === searchCursorIndex ? '#e8f0fe' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { if (i !== searchCursorIndex) e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i === searchCursorIndex ? '#e8f0fe' : 'transparent'; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: getNodeColor(node) }} />
                  <span title={node.name} style={{ flex: 1, fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                  {node.projectId != null && <span style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', flexShrink: 0 }}>PID:{node.projectId}</span>}
                  <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(node.value)}</span>
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
        {showSearchResults && meetsSearchMinLength(debouncedQuery.trim()) && searchResults.length === 0 && (
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
          <div style={{ position: 'absolute', top: 12, right: 52, zIndex: 15, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.92)', padding: '5px 10px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: 12 }}>
            {/* オフセット対象コンボボックス */}
            <select
              value={offsetTarget}
              onChange={e => { pendingHistoryAction.current = 'replace'; setOffsetTarget(e.target.value as 'recipient' | 'project'); }}
              style={{ fontSize: 11, border: '1px solid #ccc', borderRadius: 3, padding: '1px 2px', background: '#fff', color: '#555', cursor: 'pointer' }}
            >
              <option value="recipient">支出先</option>
              <option value="project">事業</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
            {/* 区切り */}
            <div style={{ width: 1, alignSelf: 'stretch', background: '#e0e0e0', margin: '0 2px' }} />
            {/* TopN: 事業・支出先 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ color: '#555', fontSize: 11 }}>事業:</span>
              <input type="number" min={1} max={300} value={topProject}
                onChange={e => { pendingHistoryAction.current = 'replace'; setTopProject(Math.max(1, Math.min(300, Number(e.target.value) || 1))); }}
                style={{ width: 50, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ color: '#555', fontSize: 11 }}>支出先:</span>
              <input type="number" min={1} max={300} value={topRecipient}
                onChange={e => { pendingHistoryAction.current = 'replace'; setTopRecipient(Math.max(1, Math.min(300, Number(e.target.value) || 1))); }}
                style={{ width: 50, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }} />
            </label>
          </div>
        );
      })()}

      {/* Settings button — independent, top right */}
      <div style={{ position: 'absolute', top: 14, right: 12, zIndex: 15 }}>
        <button
          onClick={() => setShowSettings(s => !s)}
          aria-label="TopN 設定を開く"
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
                <input type="checkbox" checked={includeZeroSpending} onChange={e => { pendingHistoryAction.current = 'replace'; setIncludeZeroSpending(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>支出が0円の事業を対象にする</span>
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
                <input type="checkbox" checked={focusRelated} onChange={e => { pendingHistoryAction.current = 'replace'; setFocusRelated(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>選択ノードの関連ノードのみ表示</span>
              </label>
            </div>
          </>
        )}
      </div>

      {/* Zoom controls — bottom right (sankey2 style) */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
        {/* 選択ノードフォーカスボタン — 選択中のみ表示 */}
        {selectedNodeInLayout && (
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {/* Material Icons: account_tree (flowchart) */}
            <button aria-label="選択ノードと接続先をフィット表示" onClick={() => focusOnNeighborhood()} title="選択ノードと接続先をフィット表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path transform="scale(-1, 1) translate(-960, 0)" d="M576-168v-84H444v-192h-60v84H96v-240h288v84h60v-192h132v-84h288v240H576v-84h-60v312h60v-84h288v240H576Zm72-72h144v-96H648v96ZM168-432h144v-96H168v96Zm480-192h144v-96H648v96Zm0 384v-96 96ZM312-432v-96 96Zm336-192v-96 96Z"/></svg>
            </button>
            {/* Focus */}
            <button aria-label="選択ノードにフォーカス" onClick={focusOnSelectedNode} title="選択ノードにフォーカス" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', borderTop: '1px solid #eee', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path transform="rotate(180 480 -480)" d="M168-360h240v-240H168v240Zm312 72H96v-384h384v156h384v72H480v156ZM288-480Z"/></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
