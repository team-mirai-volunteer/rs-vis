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
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { FLOW_SCALE_BASE, FLOW_SCALE_DEFAULT } from '@/client/lib/unified-flow-scale';
import { UnifiedSearch } from './UnifiedSearch';
import type { ReactNode } from 'react';
import { UnifiedFilterFields, type UnifiedScoreStatus } from './UnifiedFilterFields';
import { SidePanelChrome, SIDE_PANEL_INSET } from '@/client/components/SidePanelChrome';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { useSidePanel } from '@/client/hooks/useSidePanel';
import { testId } from '@/client/lib/testId';
import { Building2, Maximize, Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { externalCorporateLinks } from '@/app/lib/api/links';
import { UnifiedProjectSections } from './UnifiedProjectSections';
import { UnifiedProjectBlocks, UnifiedBlockRecipients, useProjectBlocks } from './UnifiedProjectBlocks';
import { RsApiProjectDetail } from './RsApiProjectDetail';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { UnifiedAggregateEvaluation } from './UnifiedAggregateEvaluation';
import { FactRow } from './FactRow';
import type { WeightedProgram } from '@/app/lib/unified-budget/policy-aggregate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { truncateName, Ellipsis } from './sankey-label';

export const LABEL_FONT_PX_DEFAULT = 13;

const labelSlot = (fontPx: number) => fontPx + 2;
const AGGREGATE_GAP = 14;
const ZOOM_MIN = 0.3;
/** 左上の検索クラスタが占める高さ（top 12px + 検索ボックス 34px + 余白 8px）。サイドパネルはこの下から始める */
const SEARCH_ROW_PX = 54; // sm 未満: 左上の検索ピルの行
const CONTROL_ROW_PX = 60; // sm 以上: 左上の表示数カード（1行）の行。詳細パネルはこの下から
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

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
  flowScale = FLOW_SCALE_DEFAULT,
  labelDensity = 'all',
  budgetYear,
  basisMeasureLabel,
  rsMeasureLabel,
  columnLabels,
  rsSheetYear,
  rsAmountKind,
  hasSpending = true,
  scoreStatus = 'idle',
  searchAddon,
  searchPopover,
  searchTrailing,
  sidePanelTopOffset,
  provisional = false,
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
  /** 検索ピル内「絞込」の右に並べる同体裁のボタン（AI絞り込みなど） */
  searchAddon?: ReactNode;
  /** 検索クラスタの直下に開くポップオーバー（AI絞り込み） */
  searchPopover?: ReactNode;
  /** 検索ピルの右に並べる道具（表示設定の歯車）。sm 以上で使う */
  searchTrailing?: ReactNode;
  /** 詳細パネルの上端（px）。左上に置いたコントロール行の実高さをページ側で測って渡す。未指定なら固定値 */
  sidePanelTopOffset?: number;
  fontPx?: number;
  flowScale?: number;
  labelDensity?: LabelDensity;
  budgetYear: number;
  /** 列見出しに添える基準名（当初予算 / 補正後（改予算額） / 支出済額）。無ければ当初予算 */
  basisMeasureLabel?: string;
  /** 列見出しに添える RS事業側の測定量（当初予算 / 当初＋補正 / 執行額）。無ければ年度種別から推定 */
  rsMeasureLabel?: string;
  /** 列見出しの差し替え（府省庁基準では 会計→予算総計、所管→府省庁）。無い列は既定の列名 */
  columnLabels?: Partial<Record<UnifiedColumn, string>>;
  rsSheetYear: number;
  rsAmountKind: MofRsAmountKind;
  /** 事業(支出)・支出先の列がある年度か（無ければ支出額・支出先名・再委託の絞り込みを出さない） */
  hasSpending?: boolean;
  /** 政策評価スコアの取得状況（絞り込み欄の補足表示用） */
  scoreStatus?: UnifiedScoreStatus;
  provisional?: boolean;
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
  // 既定幅 520px・上限 960px（sm 未満はボトムシートになり幅は使わない）。上端はコントロール行の下
  const sidePanel = useSidePanel({ side: 'left', viewportWidth: viewport.width, defaultWidth: 520, maxWidth: 960 });
  // 浮島の左右余白ぶんを含む。スマホ幅ではパネルがボトムシートになり横幅を取らない
  const panelOpenWidth =
    selectedId !== null && !sidePanel.collapsed && viewport.width >= 640 ? sidePanel.effectiveWidth + SIDE_PANEL_INSET * 2 : 0;
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number; worldX: number; worldY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const width = Math.max(viewport.width, 1300) * Math.max(1, fontPx / LABEL_FONT_PX_DEFAULT);
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
    return relatedNodeIds(links, selectedId, nodes);
  }, [selectedId, links, nodes]);

  const hoveredRelated = useMemo(() => (hovered && (!selectedId || focusRelated) ? relatedNodeIds(links, hovered.id, nodes) : null), [hovered, selectedId, focusRelated, links, nodes]);

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
          height: viewport.height,
          ...UNIFIED_LAYOUT,
          margin: { ...UNIFIED_LAYOUT.margin, top: viewport.width < 1200 ? UNIFIED_LAYOUT.margin.top + 40 : UNIFIED_LAYOUT.margin.top },
          // 金額用の高さを確保し、ラベルの行間は別に足す。図の高さはパンで移動できる。
          flowScale: flowScale * FLOW_SCALE_BASE,
          minNodeSlot: labelDensity === 'all' ? labelSlot(fontPx) : 0,
          gapBefore: node => (node.id.startsWith('__others__') || node.id.startsWith('np-') ? AGGREGATE_GAP : 0),
          columnOf: node => displayColumnIndex.get(node.type as UnifiedColumn) ?? 0,
        }
      ),
    [visible, width, viewport.height, viewport.width, fontPx, flowScale, labelDensity, displayColumnIndex]
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
      const color = unifiedNodeColor(node.details);
      ctx.fillStyle = color.startsWith('var(') ? getComputedStyle(container).getPropertyValue('--primary').trim() : color;
      ctx.fillRect(node.x * scaleX, node.y * scaleY, Math.max(1, node.width * scaleX), Math.max(0.5, node.height * scaleY));
    }
    const mX = -pan.x / zoom * scaleX;
    const mY = -pan.y / zoom * scaleY;
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, container.clientWidth / zoom * scaleX, container.clientHeight / zoom * scaleY);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, container.clientWidth / zoom * scaleX, container.clientHeight / zoom * scaleY);
  }, [showMinimap, layout, width, minimapH, pan, zoom]);

  const minimapNavigate = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = minimapRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = MINIMAP_W / width;
      const scaleY = minimapH / layout.contentHeight;
      setPan({ x: container.clientWidth / 2 - (e.clientX - rect.left) / scaleX * zoom, y: container.clientHeight / 2 - (e.clientY - rect.top) / scaleY * zoom });
    },
    [width, minimapH, layout.contentHeight, zoom]
  );

  const columnX = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) map.set(node.column, node.x);
    return map;
  }, [layout]);
  /**
   * 列ごとのラベル最大文字数。隣の列の箱に届かない長さに収める。
   * 使える幅 = 次の列までの距離 − 箱の幅 − 余白。金額の括弧書き（"(30.04兆円)" ≒ 7em）を差し引き、
   * 残りを 1 文字 1em（和文）として数える。最右列は右余白いっぱいまで使える
   */
  const labelMaxChars = useMemo(() => {
    const xs = [...new Set(columnX.values())].sort((a, b) => a - b);
    const map = new Map<number, number>();
    for (const [index, x] of columnX) {
      const nextX = xs.find(v => v > x);
      const spanPx = (nextX ?? width) - x;
      const availableEm = (spanPx - UNIFIED_LAYOUT.nodeWidth - 16) / fontPx;
      map.set(index, Math.max(6, Math.min(18, Math.floor(availableEm - 7))));
    }
    return map;
  }, [columnX, width, fontPx]);
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

  const showsLabel = useCallback((node: MOFLayoutNode<UnifiedViewDetails>) => node.id === selectedId || labelDensity === 'all' || node.height >= labelSlot(fontPx), [selectedId, labelDensity, fontPx]);

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

  const descendantColumns = useMemo(() => (selectedId ? descendantsByColumn(browseNodes, browseLinks, selectedId) : new Map<UnifiedColumn, UnifiedViewNode[]>()), [browseNodes, browseLinks, selectedId]);
  const ancestorColumns = useMemo(() => (selectedId ? ancestorsByColumn(browseNodes, browseLinks, selectedId) : new Map<UnifiedColumn, UnifiedViewNode[]>()), [browseNodes, browseLinks, selectedId]);
  /** 配下の RS事業（選択ノードからの寄与額つき）。項・目・所管などの加重平均評価に使う */
  const downstreamPrograms = useMemo<WeightedProgram[]>(
    () =>
      (descendantColumns.get('program') ?? [])
        .filter(n => (!n.details.kind || n.details.kind === 'rs') && !n.details.aggregated && n.details.projectId !== undefined)
        .map(n => ({ pid: n.details.projectId as number, weight: n.value })),
    [descendantColumns]
  );
  const relatedColumnList = useMemo(() => {
    const merged = new Map<UnifiedColumn, UnifiedViewNode[]>();
    for (const [column, items] of ancestorColumns) merged.set(column, items);
    for (const [column, items] of descendantColumns) merged.set(column, items);
    return UNIFIED_COLUMNS.filter(c => merged.has(c)).map(column => ({ column, items: merged.get(column) ?? [] }));
  }, [ancestorColumns, descendantColumns]);
  const isIndividualProject = !!selectedDetails &&
    (selectedDetails.column === 'program' || selectedDetails.column === 'program-spending') &&
    (!selectedDetails.kind || selectedDetails.kind === 'rs') &&
    !selectedDetails.aggregated && selectedDetails.projectId !== undefined;
  const projectBlocks = useProjectBlocks(isIndividualProject && hasSpending && !provisional ? selectedDetails?.projectId : undefined, rsSheetYear);
  const budgetSummary = selectedDetails?.budgetSummary ?? projectBlocks?.budgetSummary;
  const budgetBreakdown = selectedDetails?.budgetBreakdown ?? projectBlocks?.budgetBreakdown ?? [];
  const hasBudgetTab = isIndividualProject && !provisional;
  /**
   * パネル上段（事実表・評価・事業の詳細群・集約の内訳）に出すものがあるか。支出先などは何も無いので、
   * 空の枠（余白と罫線だけの帯）を描かない
   */
  const hasOverview = !!selectedDetails && (
    !nodeFactsEmpty(selectedDetails)
    || (!provisional && ['account', 'ministry', 'organization', 'section', 'koumoku'].includes(selectedDetails.column) && downstreamPrograms.length > 0)
    || (isIndividualProject && selectedDetails.projectId !== undefined)
    || !!selectedDetails.aggregated
    || !!selectedDetails.aggregatedTop?.length
    || focusRelated
  );
  const hasBlocksTab = isIndividualProject && hasSpending && !provisional;
  const [blockSelection, setBlockSelection] = useState<{ projectId: number; year: number; blockId: string } | null>(null);
  const selectedBlock = blockSelection?.projectId === selectedDetails?.projectId && blockSelection?.year === rsSheetYear
    ? projectBlocks?.blocks.find(block => block.blockId === blockSelection.blockId) : undefined;
  const tabs = useMemo(() => {
    const items: { id: string; label: string; count?: number }[] = relatedColumnList.map(t => ({ id: t.column, label: UNIFIED_COLUMN_LABELS[t.column], count: t.items.length }));
    if (hasBudgetTab) {
      const index = relatedColumnList.findIndex(t => UNIFIED_COLUMNS.indexOf(t.column) >= UNIFIED_COLUMNS.indexOf('program-spending'));
      items.splice(index < 0 ? items.length : index, 0, { id: 'budget-execution', label: '予算', count: budgetBreakdown.length });
    }
    if (hasBlocksTab) {
      const index = items.findIndex(tab => tab.id === 'recipient');
      items.splice(index < 0 ? items.length : index, 0, { id: 'blocks', label: 'ブロック', count: projectBlocks?.blocks.length });
      if (index < 0) items.push({ id: 'recipient', label: '支出先', count: selectedBlock?.recipients.length ?? 0 });
      else if (selectedBlock) items.find(tab => tab.id === 'recipient')!.count = selectedBlock.recipients.length;
    }
    return items;
  }, [hasBudgetTab, budgetBreakdown.length, hasBlocksTab, projectBlocks?.blocks.length, selectedBlock, relatedColumnList]);
  const [mobileOverviewOpen, setMobileOverviewOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<string | null>(null);
  const activeTab = tabs.some(t => t.id === panelTab) ? panelTab : (viewport.width < 640 && tabs.some(t => t.id === 'recipient') ? 'recipient' : tabs[0]?.id ?? null);

  const zoomRef = useRef(1);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    const prev = zoomRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
    if (next === prev) return;
    zoomRef.current = next;
    setZoom(next);
    setPan(p => ({ x: anchorX - (anchorX - p.x) * (next / prev), y: anchorY - (anchorY - p.y) * (next / prev) }));
  }, []);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
      const rect = containerRef.current?.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, rect ? e.clientX - rect.left : 0, rect ? e.clientY - rect.top : 0);
    },
    [zoomAt]
  );
  const zoomFromButton = useCallback((factor: number) => zoomAt(factor, (containerRef.current?.clientWidth ?? 0) / 2, (containerRef.current?.clientHeight ?? 0) / 2), [zoomAt]);

  useLayoutEffect(() => {
    if (!selectedNode || viewport.height <= 0) return;
    setPan(p => {
      const screenY = selectedNode.y * zoomRef.current + p.y;
      const edge = 80;
      if (screenY >= edge && screenY <= viewport.height - edge) return p;
      return { ...p, y: viewport.height / 2 - selectedNode.y * zoomRef.current };
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
  /** 執行年度（支出先まで繋がる年度）か。事業(支出)ノードがあれば執行年度 */
  const isExecutionYear = useMemo(() => nodes.some(n => n.details.column === 'program-spending'), [nodes]);
  /**
   * 列見出し。事業〜支出先は「何年度の・何の額か」で混乱しやすいので年度と測定量を添える
   * （事業_2024 予算現額 / 事業(支出)_2024 支出額 / 支出先_2024）。会計〜目は MOF の当初予算
   */
  const columnHeader = (column: UnifiedColumn): { label: string; measure?: string } => {
    const base = columnLabels?.[column] ?? UNIFIED_COLUMN_LABELS[column];
    if (column === 'revenue') return { label: `${base}_${budgetYear}`, measure: '当初予算・会計間受入含む' };
    if (column === 'program') {
      const measure = rsAmountKind === 'request' ? '翌年度要求額' : rsMeasureLabel ?? (isExecutionYear ? '歳出予算現額' : '当初予算');
      return { label: `${base}_${budgetYear}`, measure };
    }
    if (column === 'program-spending') return { label: `${base}_${budgetYear}`, measure: '支出額' };
    if (column === 'recipient') return { label: `${base}_${budgetYear}`, measure: '支出額' };
    return { label: `${base}_${budgetYear}`, measure: basisMeasureLabel ?? '当初予算' };
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onWheel={handleWheel}
      style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={e => {
        if (e.pointerType !== 'touch' || (e.target as Element).closest('[data-pan-disabled="true"]')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const points = [...touches.current.values()];
        if (points.length === 1) {
          panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          dragged.current = false;
          setIsPanning(true);
        } else if (points.length === 2) {
          const [a, b] = points;
          const rect = e.currentTarget.getBoundingClientRect();
          pinchStart.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: zoomRef.current,
            worldX: ((a.x + b.x) / 2 - rect.left - pan.x) / zoomRef.current,
            worldY: ((a.y + b.y) / 2 - rect.top - pan.y) / zoomRef.current };
          dragged.current = true;
        }
      }}
      onPointerMove={e => {
        if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const points = [...touches.current.values()];
        if (points.length >= 2 && pinchStart.current) {
          const [a, b] = points;
          const start = pinchStart.current;
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.zoom * Math.hypot(a.x - b.x, a.y - b.y) / start.distance));
          const rect = e.currentTarget.getBoundingClientRect();
          zoomRef.current = next;
          setZoom(next);
          setPan({ x: (a.x + b.x) / 2 - rect.left - start.worldX * next, y: (a.y + b.y) / 2 - rect.top - start.worldY * next });
        } else if (panStart.current) {
          const start = panStart.current;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) dragged.current = true;
          setPan({ x: start.panX + e.clientX - start.x, y: start.panY + e.clientY - start.y });
        }
      }}
      onPointerUp={e => {
        if (e.pointerType !== 'touch') return;
        touches.current.delete(e.pointerId);
        pinchStart.current = null;
        const remaining = [...touches.current.values()][0];
        panStart.current = remaining ? { ...remaining, panX: pan.x, panY: pan.y } : null;
        if (!remaining) setIsPanning(false);
      }}
      onPointerCancel={() => {
        touches.current.clear();
        pinchStart.current = null;
        panStart.current = null;
        setIsPanning(false);
      }}
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
      <svg data-testid={testId('unified-canvas')} width={width} height={layout.contentHeight} style={{ position: 'absolute', left: pan.x, top: pan.y, display: 'block', transform: `scale(${zoom})`, transformOrigin: '0 0' }} role="img" aria-label="歳入から会計・所管・項・目を経てRS事業・支出先に至る予算の流れ">
        <g>
          {orderedVisible.map(column => {
            const index = displayColumnIndex.get(column) ?? 0;
            if (!columnX.has(index)) return null;
            return (
              <g key={column}>
                <text x={columnX.get(index) ?? 0} y={headerY - 16} fontSize={12} fontWeight={700} style={{ fill: 'var(--mirai-text-secondary)' }}>
                  {columnHeader(column).label}
                  {columnHeader(column).measure && (
                    <tspan fontSize={10} fontWeight={500} style={{ fill: 'var(--mirai-text-muted)' }}>
                      {` ${columnHeader(column).measure}`}
                    </tspan>
                  )}
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
                  stroke={isSelected ? 'var(--mirai-text)' : details?.kind === 'transfer' ? 'var(--mirai-text-muted)' : undefined}
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
                    strokeWidth={3 * fontPx / LABEL_FONT_PX_DEFAULT}
                    paintOrder="stroke"
                    opacity={dim ? 0.35 : 1}
                  >
                    {(() => {
                      const { text, truncated } = truncateName(node.name, labelMaxChars.get(node.column) ?? 12);
                      return (
                        <>
                          {text}
                          {truncated && <Ellipsis fontPx={fontPx} />}
                          {` (${details?.budgetUnmatched ? '予算未突合' : formatBudgetFromYen(node.value)})`}
                        </>
                      );
                    })()}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hovered && pointer && <UnifiedTooltip node={hovered} x={pointer.x} y={pointer.y} amountLabel={amountLabel} />}
      {!hovered && hoveredLink && pointer && <UnifiedLinkTooltip link={hoveredLink} x={pointer.x} y={pointer.y} />}

      {/* 検索クラスタ（検索・絞込・AI・解除）。sm 未満は左上、sm 以上は右上（左上は表示数カードと設定） */}
      <div data-pan-disabled="true" className="absolute left-3 top-3 z-30 flex items-start gap-1.5 sm:top-[2px] sm:left-auto sm:right-3">
        <UnifiedSearch
          nodes={browseNodes}
          onSelect={onSelect}
          filterOpen={filterOpen}
          onToggleFilter={onToggleFilterOpen}
          onApplyQuery={nameQuery => onFilterChange({ ...filter, nameQuery })}
          filterFields={<UnifiedFilterFields filter={filter} onFilterChange={onFilterChange} ministryOptions={ministryOptions} hasSpending={hasSpending} scoreStatus={scoreStatus} />}
          trailing={searchAddon}
          filterActive={hasActiveUnifiedFilter(filter)}
          onClearFilter={() => onFilterChange(UNIFIED_FILTER_DEFAULT)}
        />
        {searchTrailing}
      </div>
      {/* 検索クラスタの直下に開くポップオーバー（AI絞り込み）。左の詳細パネルとは重ならない */}
      {searchPopover && <div data-pan-disabled="true" className="absolute left-3 top-14 z-[220] sm:top-11 sm:left-auto sm:right-3">{searchPopover}</div>}

      {selectedId !== null && (
        <SidePanelChrome
          side="left"
          topOffset={sidePanelTopOffset ?? (viewport.width >= 640 ? CONTROL_ROW_PX : SEARCH_ROW_PX)}
          open={!sidePanel.collapsed}
          onToggle={sidePanel.toggleCollapsed}
          width={sidePanel.effectiveWidth}
          minWidth={200}
          maxWidth={960}
          onResizeStart={sidePanel.onResizeStart}
          isResizing={sidePanel.isResizing}
          onResetWidth={sidePanel.resetWidth}
          testId={testId('unified-side-panel')}
        >
          {selectedPanelNode && selectedDetails && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-shrink-0 border-b border-border p-3 sm:p-4 sm:pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-all text-sm font-semibold text-mirai-text sm:line-clamp-none">{selectedPanelNode.name}</div>
                    {selectedDetails.column === 'recipient' && selectedDetails.representativeCorporateNumber && (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mirai-text-subtle">
                        <span className="inline-flex items-center gap-1 tabular-nums" title="法人番号（代表：内包する有効法人番号のうち最大金額のもの）">
                          法人番号 {selectedDetails.representativeCorporateNumber}
                          {(() => {
                            const links = externalCorporateLinks(selectedDetails.representativeCorporateNumber);
                            if (!links) return null;
                            return (
                              <a
                                href={links.gbizinfo}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`gBizINFO で法人番号を確認: ${selectedDetails.representativeCorporateNumber}`}
                                className="inline-flex text-primary-accent"
                                onClick={e => e.stopPropagation()}
                              >
                                <Building2 className="size-3.5" aria-hidden="true" />
                              </a>
                            );
                          })()}
                        </span>
                        {(selectedDetails.corporateNumberCount ?? 0) >= 2 && (
                          <span
                            className="whitespace-nowrap rounded-md bg-stance-neutral-badge-bg px-1.5 font-bold text-stance-neutral"
                            title={`この支出先名には${selectedDetails.corporateNumberCount}件の法人番号が紐づいています（表記揺れ・誤記載・複数実体の可能性）`}
                          >
                            他{(selectedDetails.corporateNumberCount ?? 1) - 1}件
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-0.5 text-lg font-bold text-mirai-text">{selectedDetails.budgetUnmatched ? '予算額未突合' : formatBudgetFromYen(selectedPanelNode.value)}</div>
                    {!selectedDetails.budgetUnmatched && <div className="hidden text-[11px] text-mirai-text-muted sm:block">{Math.round(selectedPanelNode.value).toLocaleString()}円</div>}
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
                  {/* RS府省庁・予算事業ID は事実表の 2 行を取らず、バッジ行に 1 行で添える */}
                  {(selectedDetails.rsMinistry || selectedDetails.projectId !== undefined) && (
                    <span className="flex gap-2 text-[11px] text-mirai-text-muted">
                      {selectedDetails.rsMinistry && <span>{selectedDetails.rsMinistry}</span>}
                      {selectedDetails.projectId !== undefined && <span>予算事業ID {selectedDetails.projectId}</span>}
                    </span>
                  )}
                  {selectedDetails.sourceUrl && (
                    <a href={selectedDetails.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline underline-offset-4 hover:text-primary-accent">
                      {provisional && isIndividualProject ? 'RSシートの出典' : '予算書の出典'}
                    </a>
                  )}
                  {selectedDetails.column === 'koumoku' && (
                    <a href={`/mof-kou-moku?year=${budgetYear}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline underline-offset-4 hover:text-primary-accent">
                      科目別内訳で開く
                    </a>
                  )}
                </div>
              </div>

              {hasOverview && <>
              <Button variant="ghost" className="h-auto min-h-10 w-full shrink-0 justify-start rounded-none border-b border-border px-3 text-left text-xs font-bold text-primary-accent hover:bg-mirai-surface-teal sm:hidden" aria-expanded={mobileOverviewOpen} onClick={() => setMobileOverviewOpen(value => !value)}>事業概要・評価 {mobileOverviewOpen ? 'を閉じる' : 'を見る'}</Button>
              {/* 上段（事業概要・評価・推移）は PC で 48% まで。フル HD のブラウザ（表示領域 900px 前後）で、意見を閉じた状態ならスクロールなしで収まる高さ。残りを下段の予算・ブロック・支出先タブに確保する */}
              <div className={cn("flex-shrink-0 overflow-y-auto p-4 pb-0", !mobileOverviewOpen && "max-sm:hidden")} style={{ maxHeight: viewport.width < 640 ? '35%' : '48%' }}>
                <NodeFacts details={selectedDetails} />
                {/* 会計〜目（自身は評価を持たない）: 配下 RS事業の政策評価を金額加重平均で要約 */}
                {!provisional && ['account', 'ministry', 'organization', 'section', 'koumoku'].includes(selectedDetails.column) && downstreamPrograms.length > 0 && (
                  <div className="-mx-4 mt-3 border-t border-border">
                    <UnifiedAggregateEvaluation programs={downstreamPrograms} rsSheetYear={rsSheetYear} fontPx={fontPx} />
                  </div>
                )}
                {/* RS事業（個別）: /sankey-svg のサイドパネルと同じ詳細群（政策評価・事業概要・意見・再委託） */}
                {isIndividualProject && selectedDetails.projectId !== undefined && (provisional ? (
                    <RsApiProjectDetail key={selectedDetails.projectId} projectId={selectedDetails.projectId} />
                  ) : (
                    <UnifiedProjectSections
                      pid={selectedDetails.projectId}
                      projectName={selectedPanelNode.name}
                      rsSheetYear={rsSheetYear}
                      fontPx={fontPx}
                      flush={nodeFactsEmpty(selectedDetails)}
                    />
                  ))}
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
                {/* 下端の余白（pb-0 の代わり）。事業のセクション群で終わるときは、最後の推移セクションが自前で余白を持つので付けない */}
                {!(isIndividualProject && selectedDetails.projectId !== undefined && !provisional && !focusRelated
                  && !selectedDetails.aggregated && !selectedDetails.aggregatedTop?.length) && <div className="h-3" />}
              </div>
              </>}

              {tabs.length > 0 && (
                <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', hasOverview && 'border-t border-border')}>
                  <div role="tablist" className="grid flex-shrink-0 grid-cols-4 border-b border-border px-2 sm:flex sm:overflow-x-auto">
                    {tabs.map(({ id, label, count }) => (
                      <Button
                        key={id}
                        variant="ghost"
                        role="tab"
                        aria-selected={activeTab === id}
                        onClick={() => setPanelTab(id)}
                        className={cn(
                          'h-auto min-h-10 flex-1 whitespace-nowrap rounded-none border-b-2 px-1 py-1.5 text-[11px] font-bold hover:bg-transparent',
                          activeTab === id ? 'border-primary text-primary-accent' : 'border-transparent text-mirai-text-muted hover:text-mirai-text-subtle'
                        )}
                      >
                        {label}
                        {count !== undefined && <span className="ml-0.5 font-normal">({count.toLocaleString()})</span>}
                      </Button>
                    ))}
                  </div>
                  <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4 pt-1">
                    {activeTab === 'budget-execution' ? (
                      <>
                        <BudgetExecutionSection
                          budgetSummary={budgetSummary}
                          budgetBreakdown={budgetBreakdown}
                          scaleFont={px => Math.round((px * fontPx) / 11)}
                          presentation="tab"
                        />
                      </>
                    ) : activeTab === 'blocks' ? (
                      <UnifiedProjectBlocks graph={projectBlocks} year={rsSheetYear} onSelect={block => {
                        setBlockSelection({ projectId: selectedDetails.projectId!, year: rsSheetYear, blockId: block.blockId });
                        setPanelTab('recipient');
                      }} />
                    ) : activeTab === 'recipient' && selectedBlock && projectBlocks ? (
                      <UnifiedBlockRecipients graph={projectBlocks} block={selectedBlock} onClear={() => setBlockSelection(null)} />
                    ) : activeTab === 'recipient' && !relatedColumnList.some(t => t.column === 'recipient') ? (
                      <p className="py-2 text-xs text-mirai-text-muted">支出先の記載はありません。</p>
                    ) : relatedColumnList
                      .find(t => t.column === activeTab)
                      ?.items.slice(0, 300)
                      .map(item => {
                        return (
                          <div key={item.id} className="flex w-full items-baseline gap-1 border-b border-border py-1.5">
                            <Button variant="ghost" onClick={() => onSelect(item.id)} className="flex h-auto min-w-0 flex-1 items-baseline justify-between gap-3 rounded-md px-1 py-0 text-left font-normal hover:bg-mirai-surface">
                              <span className="truncate text-xs text-mirai-text-secondary">{item.name}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">{item.details.budgetUnmatched ? '予算未突合' : formatBudgetFromYen(item.value)}</span>
                            </Button>
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


      {/* 左下: ミニマップ */}
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
              if (Number.isFinite(v) && v > 0) zoomFromButton(v / 100 / zoomRef.current);
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
function revenueAmountLabel(details: UnifiedViewDetails) {
  return details.revenueBasis === 'settlement' ? '収納済歳入額' : details.revenueBasis === 'supplementary' ? '歳入予算額（補正後）' : '歳入予算額';
}
/** ノードの事実表の行と、補足文を出すかどうか。事業ノードでは空になりうる（ID 等はバッジ行へ移した） */
function nodeFactContent(details: UnifiedViewDetails) {
  const rows: Array<[string, string]> = [];
  if (details.revenueCategory) rows.push(['歳入区分', details.revenueCategory]);
  if (details.column === 'revenue' && details.revenueAmount !== undefined) rows.push([`${revenueAmountLabel(details)}（全額）`, formatBudgetFromYen(details.revenueAmount)]);
  if (details.column === 'account' && details.revenueAmount !== undefined) rows.push([revenueAmountLabel(details), formatBudgetFromYen(details.revenueAmount)]);
  if (details.ministry) rows.push(['所管', details.ministry]);
  if (details.organization) rows.push([details.accountType === 'special' ? '特別会計' : '組織', details.organization]);
  if (details.subAccount) rows.push(['勘定', details.subAccount]);
  if (details.sectionName) rows.push(['項', `${details.sectionName}${details.sectionCode ? `（${details.sectionCode}）` : ''}`]);
  if (details.subItemName) rows.push(['目', `${details.subItemName}${details.subItemCode ? `（${details.subItemCode}）` : ''}`]);
  if (details.majorExpenseCode) rows.push(['主要経費', MAJOR_EXPENSE_NAMES[details.majorExpenseCode] ?? `コード ${details.majorExpenseCode}`]);
  if (details.purposeCode) rows.push(['使途別分類', PURPOSE_NAMES[details.purposeCode] ?? `コード ${details.purposeCode}`]);
  const hasNote = details.kind === 'outside' || details.column === 'revenue' || details.revenueKind === 'internal-transfer'
    || (details.column === 'account' && details.revenueAmount !== undefined);
  return { rows, hasNote };
}
function nodeFactsEmpty(details: UnifiedViewDetails) {
  const { rows, hasNote } = nodeFactContent(details);
  return rows.length === 0 && !hasNote;
}
function NodeFacts({ details }: { details: UnifiedViewDetails }) {
  const { rows, hasNote } = nodeFactContent(details);
  // 空の枠で縦を取らない
  if (rows.length === 0 && !hasNote) return null;
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
      {details.column === 'revenue' && <p className="mt-2 text-[11px] text-mirai-text-muted">
        この会計の{revenueAmountLabel(details)}です。会計から先の表示・関連額は構成比による按分であり、この税目・収入が個別事業に充てられた額を示しません。
      </p>}
      {details.revenueKind === 'internal-transfer' && <p className="mt-2 text-[11px] text-mirai-text-muted">
        他の会計・勘定からの受入です。新たな税収ではなく、国全体で単純に足すと重複する分を含みます。
      </p>}
      {details.column === 'account' && details.revenueAmount !== undefined && <p className="mt-2 text-[11px] text-mirai-text-muted">
        会計の表示額は{details.revenueBasis === 'settlement' ? '支出済歳出額' : '歳出予算額'}です。歳入と歳出が異なる場合も、金額を合わせる補正はしていません。帯の太さは両方を収めるための値です。
      </p>}
      {details.kind === 'unmatched' && (
        <p className="mt-2 text-[11px] text-stance-neutral">RS事業が1件も紐づかず、国債費・交付税・繰入・予備費・人件費のいずれにも当たらない目の残余です（要精査）。</p>
      )}
    </div>
  );
}


function ZoomButton({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon-sm" title={title} aria-label={title} onMouseDown={e => e.stopPropagation()} onClick={onClick} className="rounded-md border-mirai-border text-mirai-text-subtle">
      <Icon />
    </Button>
  );
}

const ACCOUNT_TYPE_LABELS = { general: '一般会計', special: '特別会計' };

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
      {d?.accountType && <div className="text-xs text-mirai-text-subtle">会計区分：{ACCOUNT_TYPE_LABELS[d.accountType]}</div>}
      <div className="text-lg font-bold text-mirai-text">{d?.budgetUnmatched ? '予算額未突合' : formatBudgetFromYen(node.value)}</div>
      {d?.column === 'revenue' && <div className="mt-1 text-xs text-mirai-text-subtle">{revenueAmountLabel(d)}。個別事業への充当額を示すものではありません。</div>}
      {d?.revenueKind === 'internal-transfer' && <div className="mt-1 text-xs text-mirai-text-subtle">会計・勘定間の受入（国全体の単純合計では重複）</div>}
      {d?.budgetUnmatched && <div className="mt-1 text-xs">予算側の事業と未突合です。0円予算を意味しません。</div>}
      {!d?.budgetUnmatched && d?.column === 'program' && d.spendingFlow !== undefined && d.spendingFlow > node.value && <div className="mt-1 text-xs">支出フロー：{formatBudgetFromYen(d.spendingFlow)}。選択した予算基準との差には補正・前年度繰越等が含まれ得ます。帯の太さは支出も収める描画用の値です。</div>}
      {d?.aggregated && <div className="mt-1 text-xs text-mirai-text-subtle">表示数から溢れた {d.aggregatedCount} 件をまとめたもの</div>}
      {d?.column === 'program' && (!d.kind || d.kind === 'rs') && d.rsMinistry && <div className="mt-1 text-xs text-mirai-text-subtle">{d.rsMinistry}（{amountLabel}）</div>}
      {d?.sectionName && d.column === 'koumoku' && <div className="mt-1 text-xs text-mirai-text-subtle">項: {d.sectionName}</div>}
    </div>
  );
}

function UnifiedLinkTooltip({ link, x, y }: { link: MOFLayoutLink<UnifiedViewDetails>; x: number; y: number }) {
  const accountTypes = [...new Set([link.source.details?.accountType, link.target.details?.accountType].filter((type): type is 'general' | 'special' => !!type))];
  return (
    <div data-testid={testId('unified-link-tooltip')} className="pointer-events-none fixed z-50 max-w-md rounded border border-mirai-border bg-card px-3 py-2 shadow-soft" style={{ left: x + 12, top: y + 12 }}>
      <div className="text-xs text-mirai-text-subtle">
        {link.source.name} → {link.target.name}
      </div>
      {accountTypes.length > 0 && <div className="text-xs text-mirai-text-subtle">会計区分：{accountTypes.map(type => ACCOUNT_TYPE_LABELS[type]).join(' → ')}</div>}
      <div className="text-lg font-bold text-mirai-text">{formatBudgetFromYen(link.value)}</div>
    </div>
  );
}

export { columnIndex };
