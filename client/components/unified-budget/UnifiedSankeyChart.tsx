'use client';

/**
 * 統合ビューの描画（自前 SVG）。
 *
 * `/mof-sankey` の SankeyChart（パン・ズーム・ミニマップ・検索・フィルタ・左ドックのサイドパネル）を
 * 列が可変な統合グラフ向けに作り直したもの。配置計算は `app/lib/mof-sankey-layout.ts` を共有する。
 * 図に出すノード（nodes/links）は TopN で絞ったもの、サイドパネルの一覧（browseNodes/browseLinks）は
 * 絞る前のものを受け取る。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeMOFSankeyLayout, mofRibbonPath, type MOFLayoutLink, type MOFLayoutNode } from '@/app/lib/mof-sankey-layout';
import { MAJOR_EXPENSE_NAMES, PURPOSE_NAMES, UNIFIED_LAYOUT, unifiedNodeColor } from '@/app/lib/unified-budget/constants';
import { ancestorsByColumn, descendantsByColumn, focusGraph, relatedNodeIds } from '@/app/lib/unified-budget/focus';
import { columnIndex } from '@/app/lib/unified-budget/transform';
import { UNIFIED_COLUMNS, UNIFIED_COLUMN_LABELS, UNIFIED_PROGRAM_KIND_LABELS, type UnifiedColumn } from '@/types/unified-budget';
import { hasActiveUnifiedFilter, UNIFIED_FILTER_DEFAULT, type UnifiedViewDetails, type UnifiedViewFilter, type UnifiedViewNode } from '@/types/unified-budget-view';
import type { LabelDensity } from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';
import type { MofRsAmountKind } from '@/types/mof-rs-kou-moku-linkage';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { UnifiedSearch } from './UnifiedSearch';
import { UnifiedFilterFields } from './UnifiedFilterFields';
import { HierarchyFilterClearButton } from '@/client/components/mof-hierarchy/HierarchyFilterClearButton';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel } from '@/client/hooks/useSidePanel';
import { testId } from '@/client/lib/testId';
import { ExternalLink, Maximize, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const LABEL_FONT_PX_DEFAULT = 11;

const labelSlot = (fontPx: number) => fontPx + 2;
const AGGREGATE_GAP = 14;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function UnifiedSankeyChart({
  nodes,
  links,
  browseNodes,
  browseLinks,
  visibleColumns,
  ministries,
  selectedId,
  onSelect,
  focusRelated = true,
  filter,
  onFilterChange,
  filterOpen,
  onToggleFilterOpen,
  fontPx = LABEL_FONT_PX_DEFAULT,
  labelDensity = 'all',
  budgetYear,
  rsSheetYear,
  rsAmountKind,
  bottomLeftExtra,
}: {
  nodes: UnifiedViewNode[];
  links: SankeyLink[];
  browseNodes: UnifiedViewNode[];
  browseLinks: SankeyLink[];
  visibleColumns: UnifiedColumn[];
  ministries: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusRelated?: boolean;
  filter: UnifiedViewFilter;
  onFilterChange: (next: UnifiedViewFilter) => void;
  filterOpen: boolean;
  onToggleFilterOpen: () => void;
  fontPx?: number;
  labelDensity?: LabelDensity;
  budgetYear: number;
  rsSheetYear: number;
  rsAmountKind: MofRsAmountKind;
  /** 左下・ミニマップの右隣に置くもの（表示設定の歯車） */
  bottomLeftExtra?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1900, height: 900 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const MINIMAP_W = 200;
  const [showMinimap, setShowMinimap] = useState(false);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDragging = useRef(false);
  const sidePanel = useSidePanel({ side: 'left', viewportWidth: viewport.width });
  const panelOpenWidth = selectedId !== null && !sidePanel.collapsed ? sidePanel.effectiveWidth : 0;
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const width = Math.max(viewport.width, 1300);
  const [hovered, setHovered] = useState<MOFLayoutNode<UnifiedViewDetails> | null>(null);
  const [hoveredLink, setHoveredLink] = useState<MOFLayoutLink<UnifiedViewDetails> | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  /** 表示列 → 図の列番号（畳んだ列を詰める） */
  const displayColumnIndex = useMemo(() => {
    const ordered = UNIFIED_COLUMNS.filter(c => visibleColumns.includes(c));
    return new Map<UnifiedColumn, number>(ordered.map((c, i) => [c, i]));
  }, [visibleColumns]);
  const orderedVisible = useMemo(() => UNIFIED_COLUMNS.filter(c => visibleColumns.includes(c)), [visibleColumns]);

  const related = useMemo(() => {
    if (!selectedId) return null;
    if (!nodes.some(n => n.id === selectedId)) return null;
    return relatedNodeIds(links, selectedId);
  }, [selectedId, links, nodes]);

  const hoveredRelated = useMemo(() => (hovered && (!selectedId || focusRelated) ? relatedNodeIds(links, hovered.id) : null), [hovered, selectedId, focusRelated, links]);

  const visible = useMemo(() => {
    if (!focusRelated || !selectedId || !related) return { nodes, links };
    return focusGraph(nodes, links, selectedId);
  }, [nodes, links, related, focusRelated, selectedId]);

  const layout = useMemo(
    () =>
      computeMOFSankeyLayout<UnifiedViewDetails>(
        { nodes: visible.nodes, links: visible.links },
        {
          width,
          height: viewport.height * zoom,
          ...UNIFIED_LAYOUT,
          margin: { ...UNIFIED_LAYOUT.margin, top: viewport.width < 1200 ? UNIFIED_LAYOUT.margin.top + 40 : UNIFIED_LAYOUT.margin.top },
          minNodeSlot: labelDensity === 'all' ? labelSlot(fontPx) : 0,
          gapBefore: node => (node.id.startsWith('__others__') || node.id.startsWith('np-') ? AGGREGATE_GAP : 0),
          columnOf: node => displayColumnIndex.get(node.type as UnifiedColumn) ?? 0,
        }
      ),
    [visible, width, viewport.height, viewport.width, zoom, fontPx, labelDensity, displayColumnIndex]
  );

  const minimapH = Math.round(MINIMAP_W * (layout.contentHeight / (width || 1)));

  useEffect(() => {
    if (!showMinimap) return;
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scaleX = MINIMAP_W / width;
    const scaleY = minimapH / layout.contentHeight;
    ctx.clearRect(0, 0, MINIMAP_W, minimapH);
    ctx.fillStyle = 'rgba(245,245,245,0.95)';
    ctx.fillRect(0, 0, MINIMAP_W, minimapH);
    for (const node of layout.nodes) {
      ctx.fillStyle = unifiedNodeColor(node.details);
      ctx.fillRect(node.x * scaleX, node.y * scaleY, Math.max(1, node.width * scaleX), Math.max(0.5, node.height * scaleY));
    }
    const mX = -pan.x * scaleX;
    const mY = -pan.y * scaleY;
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, container.clientWidth * scaleX, container.clientHeight * scaleY);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, container.clientWidth * scaleX, container.clientHeight * scaleY);
  }, [showMinimap, layout, width, minimapH, pan]);

  const minimapNavigate = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = minimapRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = MINIMAP_W / width;
      const scaleY = minimapH / layout.contentHeight;
      setPan({ x: container.clientWidth / 2 - (e.clientX - rect.left) / scaleX, y: container.clientHeight / 2 - (e.clientY - rect.top) / scaleY });
    },
    [width, minimapH, layout.contentHeight]
  );

  const columnX = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) map.set(node.column, node.x);
    return map;
  }, [layout]);
  const headerY = useMemo(() => Math.min(...layout.nodes.map(n => n.y), Number.POSITIVE_INFINITY) - 10, [layout.nodes]);
  const columnTotal = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) {
      if (node.details?.standalone) continue; // 擬似ノード（予算書外）は列の合計に混ぜない（会計〜項の合計が揃わなくなる）
      map.set(node.column, (map.get(node.column) ?? 0) + node.value);
    }
    return map;
  }, [layout]);
  /** 事業列のうちRS事業（個別＋集約）の合計 */
  const rsTotal = useMemo(() => layout.nodes.filter(n => n.details?.column === 'program' && (!n.details.kind || n.details.kind === 'rs')).reduce((s, n) => s + n.value, 0), [layout]);

  const showsLabel = useCallback((node: MOFLayoutNode<UnifiedViewDetails>) => labelDensity === 'all' || node.height >= labelSlot(fontPx), [labelDensity, fontPx]);

  useEffect(() => {
    if (!selectedId) return;
    const exists = nodes.some(n => n.id === selectedId) || browseNodes.some(n => n.id === selectedId);
    if (!exists) onSelect(null);
  }, [selectedId, nodes, browseNodes, onSelect]);

  const ministryOptions = useMemo(() => [...ministries].sort((a, b) => a.localeCompare(b, 'ja')), [ministries]);

  const selectedNode = useMemo(() => layout.nodes.find(n => n.id === selectedId) ?? null, [layout.nodes, selectedId]);
  const selectedPanelNode = useMemo(() => {
    if (selectedNode) return { id: selectedNode.id, name: selectedNode.name, value: selectedNode.value, details: selectedNode.details as UnifiedViewDetails };
    return browseNodes.find(n => n.id === selectedId) ?? null;
  }, [selectedNode, browseNodes, selectedId]);
  const selectedDetails = selectedPanelNode?.details;
  const selectedRsSvgUrl = useMemo(() => {
    if (!selectedDetails || selectedDetails.projectId === undefined || !selectedPanelNode?.name) return null;
    return sankeySvgProjectUrl(selectedDetails.projectId, selectedPanelNode.name, rsSheetYear);
  }, [selectedDetails, selectedPanelNode, rsSheetYear]);

  const descendantColumns = useMemo(() => (selectedId ? descendantsByColumn(browseNodes, browseLinks, selectedId) : new Map<UnifiedColumn, UnifiedViewNode[]>()), [browseNodes, browseLinks, selectedId]);
  const ancestorColumns = useMemo(() => (selectedId ? ancestorsByColumn(browseNodes, browseLinks, selectedId) : new Map<UnifiedColumn, UnifiedViewNode[]>()), [browseNodes, browseLinks, selectedId]);
  const relatedColumnList = useMemo(() => {
    const merged = new Map<UnifiedColumn, UnifiedViewNode[]>();
    for (const [column, items] of ancestorColumns) merged.set(column, items);
    for (const [column, items] of descendantColumns) merged.set(column, items);
    return UNIFIED_COLUMNS.filter(c => merged.has(c)).map(column => ({ column, items: merged.get(column) ?? [] }));
  }, [ancestorColumns, descendantColumns]);
  const tabs = useMemo(() => relatedColumnList.map(t => ({ id: t.column as string, label: UNIFIED_COLUMN_LABELS[t.column], count: t.items.length })), [relatedColumnList]);
  const [panelTab, setPanelTab] = useState<string | null>(null);
  const activeTab = tabs.some(t => t.id === panelTab) ? panelTab : (tabs[0]?.id ?? null);

  const zoomRef = useRef(1);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const zoomAt = useCallback((factor: number, anchorY: number) => {
    const prev = zoomRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
    if (next === prev) return;
    zoomRef.current = next;
    setZoom(next);
    setPan(p => ({ ...p, y: anchorY - (anchorY - p.y) * (next / prev) }));
  }, []);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
      const rect = containerRef.current?.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, rect ? e.clientY - rect.top : 0);
    },
    [zoomAt]
  );
  const zoomFromButton = useCallback((factor: number) => zoomAt(factor, (containerRef.current?.clientHeight ?? 0) / 2), [zoomAt]);

  useLayoutEffect(() => {
    if (!selectedNode || viewport.height <= 0) return;
    setPan(p => {
      const screenY = selectedNode.y + p.y;
      const edge = 80;
      if (screenY >= edge && screenY <= viewport.height - edge) return p;
      return { ...p, y: viewport.height / 2 - selectedNode.y };
    });
  }, [selectedNode, viewport.height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  const amountLabel = rsAmountKind === 'request' ? '要求額' : '予算額';

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onWheel={handleWheel}
      style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        dragged.current = false;
        setIsPanning(true);
      }}
      onMouseMove={e => {
        if (!panStart.current) return;
        if (Math.abs(e.clientX - panStart.current.x) > 3 || Math.abs(e.clientY - panStart.current.y) > 3) dragged.current = true;
        setPan({ x: panStart.current.panX + (e.clientX - panStart.current.x), y: panStart.current.panY + (e.clientY - panStart.current.y) });
      }}
      onMouseUp={() => {
        panStart.current = null;
        setIsPanning(false);
      }}
      onClick={e => {
        if (dragged.current) return;
        if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
        onSelect(null);
      }}
      onMouseLeave={() => {
        panStart.current = null;
        setIsPanning(false);
        setHovered(null);
      }}
    >
      <svg data-testid={testId('unified-canvas')} width={width} height={layout.contentHeight} style={{ position: 'absolute', left: pan.x, top: pan.y, display: 'block' }} role="img" aria-label="会計から所管・項・目を経てRS事業・支出先に至る予算の流れ">
        <g>
          {orderedVisible.map(column => {
            const index = displayColumnIndex.get(column) ?? 0;
            if (!columnX.has(index)) return null;
            return (
              <g key={column}>
                <text x={columnX.get(index) ?? 0} y={headerY - 16} fontSize={12} fontWeight={700} style={{ fill: 'var(--mirai-text-secondary)' }}>
                  {UNIFIED_COLUMN_LABELS[column]}
                </text>
                <text x={columnX.get(index) ?? 0} y={headerY} fontSize={11} style={{ fill: 'var(--mirai-text-muted)' }}>
                  {formatBudgetFromYen(columnTotal.get(index) ?? 0)}
                  {column === 'program' && <tspan style={{ fill: 'var(--primary-accent)' }}> (RS事業 {formatBudgetFromYen(rsTotal)})</tspan>}
                </text>
              </g>
            );
          })}
        </g>

        <g>
          {layout.links.map((link, i) => {
            const offSelection = !focusRelated && related !== null && !(related.has(link.source.id) && related.has(link.target.id));
            const offHover = hoveredRelated !== null && !(hoveredRelated.has(link.source.id) && hoveredRelated.has(link.target.id));
            const dim = offSelection || offHover;
            const isHovered = hoveredLink === link;
            return (
              <path
                key={`${link.source.id}-${link.target.id}-${i}`}
                data-testid={testId('unified-link')}
                d={mofRibbonPath(link)}
                fill={unifiedNodeColor(link.target.details)}
                opacity={dim ? 0.06 : isHovered ? 0.5 : 0.28}
                style={{ cursor: 'default' }}
                onMouseEnter={e => {
                  setHoveredLink(link);
                  setPointer({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setPointer({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setHoveredLink(null);
                  setPointer(null);
                }}
              />
            );
          })}
        </g>

        <g>
          {layout.nodes.map(node => {
            const details = node.details;
            const color = unifiedNodeColor(details);
            // 全列ともラベルは箱の右に出す（/sankey-svg と同じ）。先頭列だけ左に出すと 1 列だけ見え方が変わる
            const labelLeft = false;
            const labelX = node.x + node.width + 6;
            const centerY = node.y + node.height / 2;
            const offSelection = !focusRelated && related !== null && !related.has(node.id);
            const offHover = hoveredRelated !== null && !hoveredRelated.has(node.id);
            const dim = offSelection || offHover;
            const isSelected = selectedId === node.id;
            const isCategory = !!details?.kind && details.kind !== 'rs';
            return (
              <g
                key={node.id}
                data-testid={testId('unified-node')}
                data-column={testId(details?.column ?? '')}
                onMouseEnter={e => {
                  setHovered(node);
                  setPointer({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setPointer({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setHovered(null);
                  setPointer(null);
                }}
                onClick={e => {
                  if (dragged.current) return;
                  e.stopPropagation();
                  onSelect(selectedId === node.id ? null : node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={2}
                  fill={color}
                  opacity={dim ? 0.25 : 1}
                  stroke={isSelected ? 'var(--mirai-text)' : details?.kind === 'transfer' ? '#64748b' : undefined}
                  strokeWidth={isSelected ? 1.5 : details?.kind === 'transfer' ? 1 : undefined}
                  strokeDasharray={!isSelected && details?.kind === 'transfer' ? '3 2' : undefined}
                />
                {showsLabel(node) && (
                  <text
                    data-testid={testId('unified-label')}
                    x={labelX}
                    y={centerY}
                    textAnchor={labelLeft ? 'end' : 'start'}
                    dominantBaseline="middle"
                    fontSize={fontPx}
                    fontWeight={isSelected ? 700 : details?.aggregated || isCategory ? 400 : 500}
                    fill={details?.aggregated ? 'var(--mirai-text-muted)' : isCategory ? 'var(--mirai-text-secondary)' : 'var(--mirai-text)'}
                    stroke="var(--card)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    opacity={dim ? 0.35 : 1}
                  >
                    {`${shorten(node.name, labelLeft ? 16 : 18)} (${formatBudgetFromYen(node.value)})`}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && pointer && <UnifiedTooltip node={hovered} x={pointer.x} y={pointer.y} amountLabel={amountLabel} />}
      {!hovered && hoveredLink && pointer && <UnifiedLinkTooltip link={hoveredLink} x={pointer.x} y={pointer.y} />}

      <div data-pan-disabled="true" className="absolute top-3 z-30 flex items-start gap-1.5 transition-[left] duration-200" style={{ left: panelOpenWidth + 12 }}>
        <UnifiedSearch
          nodes={browseNodes}
          onSelect={onSelect}
          filterOpen={filterOpen}
          onToggleFilter={onToggleFilterOpen}
          filterFields={<UnifiedFilterFields filter={filter} onFilterChange={onFilterChange} ministryOptions={ministryOptions} />}
        />
        <HierarchyFilterClearButton active={hasActiveUnifiedFilter(filter)} onClear={() => onFilterChange(UNIFIED_FILTER_DEFAULT)} />
      </div>

      {selectedId !== null && (
        <SidePanelChrome
          side="left"
          open={!sidePanel.collapsed}
          onToggle={sidePanel.toggleCollapsed}
          width={sidePanel.effectiveWidth}
          minWidth={200}
          maxWidth={800}
          onResizeStart={sidePanel.onResizeStart}
          isResizing={sidePanel.isResizing}
          onResetWidth={sidePanel.resetWidth}
          testId={testId('unified-side-panel')}
        >
          {selectedPanelNode && selectedDetails && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-shrink-0 border-b border-border p-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-mirai-text">{selectedPanelNode.name}</div>
                    <div className="mt-0.5 text-lg font-bold text-mirai-text">{formatBudgetFromYen(selectedPanelNode.value)}</div>
                    <div className="text-[11px] text-mirai-text-muted">{Math.round(selectedPanelNode.value).toLocaleString()}円</div>
                    {!selectedNode && <div className="mt-1 text-[11px] text-stance-neutral">表示数の上限から溢れている、または非表示の列にあるため図には出ていません</div>}
                  </div>
                  <Button variant="ghost" size="icon-sm" title="選択を解除" aria-label="選択を解除" onClick={() => onSelect(null)} className="shrink-0 text-mirai-text-muted hover:text-mirai-text">
                    <X />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: unifiedNodeColor({ ...selectedDetails, aggregated: false }) }}>
                    {UNIFIED_COLUMN_LABELS[selectedDetails.column]}
                  </span>
                  {selectedDetails.kind && selectedDetails.kind !== 'rs' && (
                    <span className="rounded-full bg-mirai-surface-muted px-2 py-0.5 text-[11px] font-medium text-mirai-text">{UNIFIED_PROGRAM_KIND_LABELS[selectedDetails.kind]}</span>
                  )}
                  {selectedDetails.aggregated && <span className="rounded-full border border-mirai-border bg-card px-2 py-0.5 text-[11px] font-medium text-mirai-text-subtle">集約</span>}
                  {selectedDetails.accountType && (
                    <span className="rounded-full bg-mirai-surface-muted px-2 py-0.5 text-[11px] font-medium text-mirai-text-secondary">{selectedDetails.accountType === 'general' ? '一般会計' : '特別会計'}</span>
                  )}
                  {selectedDetails.sourceUrl && (
                    <a href={selectedDetails.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline underline-offset-4 hover:text-primary-accent">
                      予算書の出典
                    </a>
                  )}
                  {selectedRsSvgUrl && (
                    <a href={selectedRsSvgUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline underline-offset-4 hover:text-primary-accent">
                      /sankey-svgで開く
                    </a>
                  )}
                  {selectedDetails.column === 'koumoku' && (
                    <a href={`/mof-kou-moku?year=${budgetYear}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline underline-offset-4 hover:text-primary-accent">
                      科目別内訳で開く
                    </a>
                  )}
                </div>
              </div>

              <div className="flex-shrink-0 overflow-y-auto p-4 pb-0" style={{ maxHeight: '45%' }}>
                <NodeFacts details={selectedDetails} amountLabel={amountLabel} />
                {selectedDetails.aggregated && (
                  <div className="text-xs text-mirai-text-subtle">表示数から溢れた {selectedDetails.aggregatedCount?.toLocaleString()} 件</div>
                )}
                {selectedDetails.aggregatedTop && selectedDetails.aggregatedTop.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="mb-1 text-[11px] text-mirai-text-muted">内訳（金額の大きい順）</div>
                    {selectedDetails.aggregatedTop.map(member => (
                      <Button key={member.id} variant="ghost" onClick={() => onSelect(member.id)} className="flex h-auto w-full justify-between gap-3 rounded-md px-1 py-0.5 text-left text-xs font-normal text-mirai-text-secondary hover:bg-mirai-surface">
                        <span className="truncate">{member.name}</span>
                        <span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(member.amount)}</span>
                      </Button>
                    ))}
                    {(selectedDetails.aggregatedCount ?? 0) > selectedDetails.aggregatedTop.length && (
                      <div className="text-[11px] text-mirai-text-muted">ほか {((selectedDetails.aggregatedCount ?? 0) - selectedDetails.aggregatedTop.length).toLocaleString()} 件</div>
                    )}
                  </div>
                )}
                {focusRelated && <div className="mt-2 text-[11px] text-mirai-text-muted">この筋に連なるノードだけを表示しています</div>}
                <div className="h-3" />
              </div>

              {tabs.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
                  <div role="tablist" className="flex flex-shrink-0 overflow-x-auto border-b border-border px-2">
                    {tabs.map(({ id, label, count }) => (
                      <Button
                        key={id}
                        variant="ghost"
                        role="tab"
                        aria-selected={activeTab === id}
                        onClick={() => setPanelTab(id)}
                        className={cn(
                          'h-auto flex-1 whitespace-nowrap rounded-none border-b-2 px-1 py-1.5 text-[11px] font-bold hover:bg-transparent',
                          activeTab === id ? 'border-primary text-primary-accent' : 'border-transparent text-mirai-text-muted hover:text-mirai-text-subtle'
                        )}
                      >
                        {label}
                        <span className="ml-0.5 font-normal">({count.toLocaleString()})</span>
                      </Button>
                    ))}
                  </div>
                  <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4 pt-1">
                    {relatedColumnList
                      .find(t => t.column === activeTab)
                      ?.items.slice(0, 300)
                      .map(item => {
                        const rsLink = item.details.projectId !== undefined && item.details.column === 'program' ? sankeySvgProjectUrl(item.details.projectId, item.name, rsSheetYear) : null;
                        return (
                          <div key={item.id} className="flex w-full items-baseline gap-1 border-b border-border py-1.5">
                            <Button variant="ghost" onClick={() => onSelect(item.id)} className="flex h-auto min-w-0 flex-1 items-baseline justify-between gap-3 rounded-md px-1 py-0 text-left font-normal hover:bg-mirai-surface">
                              <span className="truncate text-xs text-mirai-text-secondary">{item.name}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">{formatBudgetFromYen(item.value)}</span>
                            </Button>
                            {rsLink && (
                              <a href={rsLink} target="_blank" rel="noopener noreferrer" title="/sankey-svgで開く" onClick={e => e.stopPropagation()} className="shrink-0 px-0.5 text-mirai-text-muted hover:text-primary">
                                <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </SidePanelChrome>
      )}

      {bottomLeftExtra && (
        <div data-pan-disabled="true" className="absolute z-30 flex items-end transition-[left] duration-200" style={{ left: panelOpenWidth + 12 + (showMinimap ? MINIMAP_W + 22 : 48), bottom: showMinimap ? 8 : 16 }}>
          {bottomLeftExtra}
        </div>
      )}

      <MinimapOverlay show={showMinimap} onShow={() => setShowMinimap(true)} onHide={() => setShowMinimap(false)} left={panelOpenWidth + 12} minimapW={MINIMAP_W} minimapH={minimapH} canvasRef={minimapRef} navigate={minimapNavigate} dragging={minimapDragging} />

      <div data-pan-disabled="true" className="absolute bottom-3 right-3 z-30 flex flex-col gap-1">
        <ZoomButton icon={Plus} title="拡大" onClick={() => zoomFromButton(ZOOM_STEP)} />
        <ZoomButton icon={Minus} title="縮小" onClick={() => zoomFromButton(1 / ZOOM_STEP)} />
        <ZoomButton
          icon={Maximize}
          title="全体を表示"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        />
        {isEditingZoom ? (
          <input
            type="number"
            autoFocus
            min={Math.round(ZOOM_MIN * 100)}
            max={Math.round(ZOOM_MAX * 100)}
            step={1}
            aria-label="ズーム率(数値)"
            value={zoomInputValue}
            onChange={e => setZoomInputValue(e.target.value)}
            onBlur={() => {
              const v = Number(zoomInputValue);
              if (!Number.isNaN(v) && v > 0) setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v / 100)));
              setIsEditingZoom(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
                return;
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setIsEditingZoom(false);
              }
            }}
            className="w-full rounded border border-mirai-border bg-card px-1 py-0.5 text-center text-[10px] text-mirai-text-secondary shadow-xs"
          />
        ) : (
          <Button
            variant="outline"
            title="クリックしてズーム率を入力"
            onClick={() => {
              setZoomInputValue(String(Math.round(zoom * 100)));
              setIsEditingZoom(true);
            }}
            className="h-auto w-full cursor-text rounded-md border-mirai-border px-1 py-0.5 text-center text-[10px] font-normal text-mirai-text-muted"
          >
            {Math.round(zoom * 100)}%
          </Button>
        )}
      </div>
    </div>
  );
}

/** ノード固有の事実（予算書の科目・分類、RS事業の予算執行サマリ） */
function NodeFacts({ details, amountLabel }: { details: UnifiedViewDetails; amountLabel: string }) {
  const rows: Array<[string, string]> = [];
  if (details.ministry) rows.push(['所管', details.ministry]);
  if (details.organization) rows.push([details.accountType === 'special' ? '特別会計' : '組織', details.organization]);
  if (details.subAccount) rows.push(['勘定', details.subAccount]);
  if (details.sectionName) rows.push(['項', `${details.sectionName}${details.sectionCode ? `（${details.sectionCode}）` : ''}`]);
  if (details.subItemName) rows.push(['目', `${details.subItemName}${details.subItemCode ? `（${details.subItemCode}）` : ''}`]);
  if (details.majorExpenseCode) rows.push(['主要経費', MAJOR_EXPENSE_NAMES[details.majorExpenseCode] ?? `コード ${details.majorExpenseCode}`]);
  if (details.purposeCode) rows.push(['使途別分類', PURPOSE_NAMES[details.purposeCode] ?? `コード ${details.purposeCode}`]);
  if (details.rsMinistry) rows.push(['RS府省庁', details.rsMinistry]);
  if (details.projectId !== undefined) rows.push(['予算事業ID', String(details.projectId)]);
  const b = details.budgetSummary;
  return (
    <div className="text-xs text-mirai-text-secondary">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {rows.map(([k, v]) => (
            <FactRow key={k} k={k} v={v} />
          ))}
        </dl>
      )}
      {details.kind === 'outside' && (
        <p className="mt-2 text-[11px] text-mirai-text-muted">
          事業の歳出予算現額のうち、予算書（当初予算）の目からの流入で説明できない分。補正・前年度繰越・予備費使用・RS側の項目未記載が含まれます。
        </p>
      )}
      {details.kind === 'unmatched' && (
        <p className="mt-2 text-[11px] text-stance-neutral">RS事業が1件も紐づかず、国債費・交付税・繰入・予備費・人件費のいずれにも当たらない目の残余です（要精査）。</p>
      )}
      {b && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[11px] text-mirai-text-muted">RS 予算・執行（{b.fiscalYear}年度）</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <FactRow k="当初予算" v={formatBudgetFromYen(b.initialBudget)} />
            <FactRow k="補正予算" v={formatBudgetFromYen(b.supplementaryBudget)} />
            <FactRow k="前年度繰越" v={formatBudgetFromYen(b.carryoverBudget)} />
            <FactRow k="予備費等" v={formatBudgetFromYen(b.reserveFund)} />
            <FactRow k="歳出予算現額" v={formatBudgetFromYen(b.totalBudget)} />
            <FactRow k="執行額" v={`${formatBudgetFromYen(b.executedAmount)}${b.executionRate !== null ? `（${b.executionRate.toFixed(1)}%）` : ''}`} />
            <FactRow k="翌年度要求" v={formatBudgetFromYen(b.nextYearRequest)} />
          </dl>
        </div>
      )}
      {!b && details.column === 'program' && (!details.kind || details.kind === 'rs') && (
        <p className="mt-2 text-[11px] text-mirai-text-muted">値はRS 2-2 の{amountLabel}の合計です（この年度は執行・支出先の情報がありません）。</p>
      )}
    </div>
  );
}

function FactRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-mirai-text-muted">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}

function ZoomButton({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon-sm" title={title} aria-label={title} onMouseDown={e => e.stopPropagation()} onClick={onClick} className="rounded-md border-mirai-border text-mirai-text-subtle">
      <Icon />
    </Button>
  );
}

function UnifiedTooltip({ node, x, y, amountLabel }: { node: MOFLayoutNode<UnifiedViewDetails>; x: number; y: number; amountLabel: string }) {
  const d = node.details;
  return (
    <div className="pointer-events-none fixed z-50 max-w-md rounded border border-mirai-border bg-card px-3 py-2 shadow-soft" style={{ left: x + 12, top: y + 12 }}>
      {d?.column && (
        <div className="text-[11px] font-medium text-mirai-text-muted">
          {UNIFIED_COLUMN_LABELS[d.column]}
          {d.kind && d.kind !== 'rs' ? ` / ${UNIFIED_PROGRAM_KIND_LABELS[d.kind]}` : ''}
        </div>
      )}
      <div className="font-semibold text-mirai-text">{node.name}</div>
      <div className="text-lg font-bold text-mirai-text">{formatBudgetFromYen(node.value)}</div>
      {d?.aggregated && <div className="mt-1 text-xs text-mirai-text-subtle">表示数から溢れた {d.aggregatedCount} 件をまとめたもの</div>}
      {d?.column === 'program' && (!d.kind || d.kind === 'rs') && d.rsMinistry && <div className="mt-1 text-xs text-mirai-text-subtle">{d.rsMinistry}（{amountLabel}）</div>}
      {d?.sectionName && d.column === 'koumoku' && <div className="mt-1 text-xs text-mirai-text-subtle">項: {d.sectionName}</div>}
    </div>
  );
}

function UnifiedLinkTooltip({ link, x, y }: { link: MOFLayoutLink<UnifiedViewDetails>; x: number; y: number }) {
  return (
    <div data-testid={testId('unified-link-tooltip')} className="pointer-events-none fixed z-50 max-w-md rounded border border-mirai-border bg-card px-3 py-2 shadow-soft" style={{ left: x + 12, top: y + 12 }}>
      <div className="text-xs text-mirai-text-subtle">
        {link.source.name} → {link.target.name}
      </div>
      <div className="text-lg font-bold text-mirai-text">{formatBudgetFromYen(link.value)}</div>
    </div>
  );
}

export { columnIndex };
