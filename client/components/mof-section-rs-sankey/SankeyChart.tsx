'use client';

/**
 * 予算→項→RS紐づけサンキーの描画（自前 SVG）。
 *
 * `/mof-hierarchy` の HierarchyChart.tsx と同じ作り（パン・ズーム・ミニマップ・
 * 検索・フィルタ・左ドックのサイドパネル）を、列が5列+RS対象/RS対象外の
 * 6列版に合わせて移植したもの。配置計算は `app/lib/mof-sankey-layout.ts` を共有する。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeMOFSankeyLayout,
  mofRibbonPath,
  type MOFLayoutLink,
  type MOFLayoutNode,
} from '@/app/lib/mof-sankey-layout';
import {
  SECTION_RS_COLUMN_INDEX,
  MOF_SECTION_RS_LAYOUT,
  MOF_SECTION_RS_STATUS_LABELS,
  sectionRsNodeColor,
} from '@/app/lib/mof-section-rs-constants';
import {
  MOF_SECTION_RS_COLUMNS,
  MOF_SECTION_RS_COLUMN_LABELS,
  MOF_SECTION_RS_FILTER_DEFAULT,
  hasActiveMOFSectionRsFilterState,
  type MOFSectionRsColumn,
  type MOFSectionRsFilterState,
  type MOFSectionRsNode,
} from '@/types/mof-section-rs-sankey';
import type { LabelDensity } from '@/types/mof-hierarchy';
import type { SankeyLink } from '@/types/sankey';
import { ancestorsByColumn, descendantsByColumn, focusHierarchy, relatedNodeIds, rsStatusBreakdown } from '@/app/lib/mof-section-rs-focus';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { SankeyChartSearch } from './SankeyChartSearch';
import { FilterFields } from './FilterFields';
import { KouMokuTab } from './KouMokuTab';
import { HierarchyFilterClearButton } from '@/client/components/mof-hierarchy/HierarchyFilterClearButton';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel } from '@/client/hooks/useSidePanel';
import { E2E_TEST_IDS_ENABLED, testId } from '@/client/lib/testId';

export const LABEL_FONT_PX_DEFAULT = 11;

const labelSlot = (fontPx: number) => fontPx + 2;
const AGGREGATE_GAP = 14;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function SankeyChart({
  nodes,
  links,
  browseNodes,
  browseLinks,
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
  fiscalYear,
  budgetType,
  rsYear,
}: {
  /** 図の描画用（TopNで絞ってある） */
  nodes: MOFSectionRsNode[];
  links: SankeyLink[];
  /** サイドパネル用の全ノード（TopNで絞る前） */
  browseNodes: MOFSectionRsNode[];
  browseLinks: SankeyLink[];
  ministries: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusRelated?: boolean;
  filter: MOFSectionRsFilterState;
  onFilterChange: (next: MOFSectionRsFilterState) => void;
  filterOpen: boolean;
  onToggleFilterOpen: () => void;
  fontPx?: number;
  labelDensity?: LabelDensity;
  /** 「目」タブの詳細取得（/api/mof-kou/detail, /api/mof-sankey/rs-project）に使う */
  fiscalYear: number;
  budgetType: string;
  /** RS事業一覧の /sankey-svg リンクに使う（RS紐づけデータの対象年度。未生成の年度は null） */
  rsYear: number | null;
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
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number; centerY: number } | null>(null);
  const width = Math.max(viewport.width, 1300);
  const [hovered, setHovered] = useState<MOFLayoutNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<MOFLayoutLink | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  /**
   * 選択が表示グラフ（nodes/links）に無いノード（TopN外の集約に畳まれ、
   * サイドパネルの「目」タブ等からbrowse経由で選んだだけの実項・実RS事業）の
   * ときは related を作らない。作ると selectedId が links 上で孤立ノード扱いになり、
   * relatedNodeIds が「自分だけ」を返して、本来関連のはずの集約ノード・帯まで
   * すべて非活性（ダーク→薄暗い）に見えてしまう
   */
  const related = useMemo(() => {
    if (!selectedId) return null;
    const selected = nodes.find(n => n.id === selectedId);
    if (!selected) return null;
    const set = relatedNodeIds(links, selectedId);
    /**
     * 個別のRS事業/RS対象外は、真の親項（browseで分かる）のうち一部が項のTopNに
     * 収まらず「N項」集約に畳まれていることがある。畳まれた項からこのノードへの
     * 寄与は、表示グラフ上は集約の総額に紛れて個別の帯を持たないため、
     * relatedNodeIds だけでは「N項」集約ノードが関連扱いにならない。
     *
     * 「N項」集約ノードは全所管の畳まれた項が合流する共有バケツ（1個のみ）なので、
     * その ancestors・descendants を丸ごと足すと無関係な所管・組織まで活性化してしまう
     * （実際に起きたバグ）。畳まれた真の親項の実際の祖先（所管/組織/勘定。browseで
     * ancestorsByColumn を使えば按分込みで正しく辿れる）だけを、表示グラフに実在する
     * ノードに限って足す。集約ノード自体は、選択RS事業への窓口として実際に帯を
     * 持つ場合だけ足す
     */
    if (selected.details.column === 'rsStatus') {
      const displayIds = new Set(nodes.map(n => n.id));
      const hasCollapsedParent = browseLinks.some(l => l.target === selectedId && !displayIds.has(l.source));
      if (hasCollapsedParent) {
        for (const ancestorNodes of ancestorsByColumn(browseNodes, browseLinks, selectedId).values()) {
          for (const ancestor of ancestorNodes) {
            if (displayIds.has(ancestor.id)) set.add(ancestor.id);
          }
        }
        if (displayIds.has('__others__section')) set.add('__others__section');
      }
    }
    return set;
  }, [selectedId, links, nodes, browseNodes, browseLinks]);

  const hoveredRelated = useMemo(
    () => (hovered && (!selectedId || focusRelated) ? relatedNodeIds(links, hovered.id) : null),
    [hovered, selectedId, focusRelated, links]
  );

  const visible = useMemo(() => {
    if (!focusRelated || !selectedId || !related) return { nodes, links };
    return focusHierarchy(nodes, links, selectedId);
  }, [nodes, links, related, focusRelated, selectedId]);

  const layout = useMemo(
    () =>
      computeMOFSankeyLayout(
        { nodes: visible.nodes as Array<(typeof visible.nodes)[number]>, links: visible.links },
        {
          width,
          height: viewport.height * zoom,
          ...MOF_SECTION_RS_LAYOUT,
          margin: {
            ...MOF_SECTION_RS_LAYOUT.margin,
            top: viewport.width < 1200 ? MOF_SECTION_RS_LAYOUT.margin.top + 40 : MOF_SECTION_RS_LAYOUT.margin.top,
          },
          minNodeSlot: labelDensity === 'all' ? labelSlot(fontPx) : 0,
          gapBefore: node => (node.id.startsWith('__others__') ? AGGREGATE_GAP : 0),
          columnOf: node => SECTION_RS_COLUMN_INDEX[node.type as MOFSectionRsColumn] ?? undefined,
        }
      ),
    [visible, width, viewport.height, viewport.width, zoom, fontPx, labelDensity]
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
      const details = node.details as MOFSectionRsNode['details'] | undefined;
      if (details?.passThrough) continue;
      ctx.fillStyle = sectionRsNodeColor({
        column: details?.column,
        aggregated: details?.aggregated,
        rsStatus: details?.rsStatus,
      });
      ctx.fillRect(node.x * scaleX, node.y * scaleY, Math.max(1, node.width * scaleX), Math.max(0.5, node.height * scaleY));
    }

    const mX = -pan.x * scaleX;
    const mY = -pan.y * scaleY;
    const mW = container.clientWidth * scaleX;
    const mH = container.clientHeight * scaleY;
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mX, mY, mW, mH);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(mX, mY, mW, mH);
  }, [showMinimap, layout, width, minimapH, pan]);

  const minimapNavigate = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = minimapRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scaleX = MINIMAP_W / width;
      const scaleY = minimapH / layout.contentHeight;
      const worldX = mx / scaleX;
      const worldY = my / scaleY;
      setPan({ x: container.clientWidth / 2 - worldX, y: container.clientHeight / 2 - worldY });
    },
    [width, minimapH, layout.contentHeight]
  );

  const visibleColumns = useMemo(() => {
    const present = new Set(
      layout.nodes.filter(n => !(n.details as MOFSectionRsNode['details'] | undefined)?.passThrough).map(n => n.column)
    );
    return MOF_SECTION_RS_COLUMNS.map((column, index) => ({ column, index })).filter(c => present.has(c.index));
  }, [layout]);

  const columnX = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) map.set(node.column, node.x);
    return map;
  }, [layout]);

  const headerY = useMemo(() => Math.min(...layout.nodes.map(n => n.y), Number.POSITIVE_INFINITY) - 10, [layout.nodes]);

  const showsLabel = useCallback(
    (node: MOFLayoutNode) => {
      const details = node.details as MOFSectionRsNode['details'] | undefined;
      if (details?.passThrough) return false;
      return labelDensity === 'all' || node.height >= labelSlot(fontPx);
    },
    [labelDensity, fontPx]
  );

  const labelOverlaps = useMemo(() => {
    if (!E2E_TEST_IDS_ENABLED) return [];
    const byColumn = new Map<number, Array<{ id: string; y: number }>>();
    for (const node of layout.nodes) {
      if (!showsLabel(node)) continue;
      const list = byColumn.get(node.column) ?? [];
      list.push({ id: node.id, y: node.y + node.height / 2 });
      byColumn.set(node.column, list);
    }
    const found: string[] = [];
    for (const list of byColumn.values()) {
      list.sort((a, b) => a.y - b.y);
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].y - list[i - 1].y < fontPx) found.push(list[i].id);
      }
    }
    return found;
  }, [layout, fontPx, showsLabel]);

  const columnTotal = useMemo(() => {
    const map = new Map<number, number>();
    for (const node of layout.nodes) {
      if ((node.details as MOFSectionRsNode['details'] | undefined)?.passThrough) continue;
      map.set(node.column, (map.get(node.column) ?? 0) + node.value);
    }
    return map;
  }, [layout]);

  /** rsStatus列の内訳。RS対象外を除いた分（個別のRS事業＋集約）がRS対象の総額 */
  const rsLinkedTotal = useMemo(() => {
    let sum = 0;
    for (const node of layout.nodes) {
      const details = node.details as MOFSectionRsNode['details'] | undefined;
      if (details?.column !== 'rsStatus' || details.rsStatus === 'unlinked') continue;
      sum += node.value;
    }
    return sum;
  }, [layout]);

  useEffect(() => {
    if (!selectedId) return;
    const exists = nodes.some(n => n.id === selectedId) || browseNodes.some(n => n.id === selectedId);
    if (!exists) onSelect(null);
  }, [selectedId, nodes, browseNodes, onSelect]);

  const ministryOptions = useMemo(() => [...ministries].sort((a, b) => a.localeCompare(b, 'ja')), [ministries]);

  const selectedNode = useMemo(() => layout.nodes.find(n => n.id === selectedId) ?? null, [layout.nodes, selectedId]);
  const selectedPanelNode = useMemo(
    () => selectedNode ?? browseNodes.find(n => n.id === selectedId) ?? null,
    [selectedNode, browseNodes, selectedId]
  );
  const selectedDetails = selectedPanelNode?.details as MOFSectionRsNode['details'] | undefined;
  /** RS事業ノードの/sankey-svgリンク（RS事業一覧の行と同じヘルパー・同じ年度で該当事業をピンする） */
  const selectedRsSvgUrl = useMemo(() => {
    if (selectedDetails?.column !== 'rsStatus' || selectedDetails.projectId === undefined || rsYear === null || !selectedPanelNode?.name) {
      return null;
    }
    return sankeySvgProjectUrl(selectedDetails.projectId, selectedPanelNode.name, rsYear);
  }, [selectedDetails, selectedPanelNode, rsYear]);

  const descendantColumns = useMemo(
    () => (selectedId ? descendantsByColumn(browseNodes, browseLinks, selectedId) : new Map<MOFSectionRsColumn, MOFSectionRsNode[]>()),
    [browseNodes, browseLinks, selectedId]
  );
  /**
   * 選択ノードより左の列（祖先）。木構造（親は1つ）の列は ancestorsByColumn が
   * 選択ノードの値をそのまま伝播するので正しい。rsStatus列を選んだ場合の項列だけは
   * ancestorsByColumn 内部でエッジの value による按分に切り替わる
   * （1つのRS事業が複数の項から計上されうるため）。
   */
  const ancestorColumns = useMemo(
    () => (selectedId ? ancestorsByColumn(browseNodes, browseLinks, selectedId) : new Map<MOFSectionRsColumn, MOFSectionRsNode[]>()),
    [browseNodes, browseLinks, selectedId]
  );
  /**
   * 「RS事業」タブは descendantsByColumn に任せられない。rsStatus列（項→RS事業）は、
   * 他の列と違って同じRS事業ノードが複数の項から共有されることがある（1つの事業が
   * 複数の項に計上されるため）。browse上のノード自身の value は「browseに最初に
   * 登場した項からの寄与額」でしかなく複数項の合算ではないので、descendantsByColumn
   * （ノードの value をそのまま使う）には任せられない。
   *
   * 項ノードを選んだときは自分自身、それより左の列（所管・組織・勘定）を選んだときは
   * 配下の項すべてを対象に、rsStatusBreakdown でエッジの value を事業ごとに合算する
   * （逆方向＝RS事業を選んだときの祖先タブは ancestorsByColumn が同じ考え方で面倒を見る）
   */
  const rsRelatedTab = useMemo(() => {
    if (!selectedId) return null;
    const column = (nodes.find(n => n.id === selectedId) ?? browseNodes.find(n => n.id === selectedId))?.details.column;
    if (!column || column === 'total' || column === 'rsStatus') return null;
    const sectionIds = column === 'section' ? [selectedId] : (descendantColumns.get('section') ?? []).map(n => n.id);
    if (sectionIds.length === 0) return null;
    const items = rsStatusBreakdown(browseNodes, browseLinks, sectionIds);
    if (items.length === 0) return null;
    return { column: 'rsStatus' as MOFSectionRsColumn, items };
  }, [selectedId, nodes, browseNodes, browseLinks, descendantColumns]);
  /** サイドパネルのタブ一覧。選択ノードから見て左右どちらの列も、自然な列順で並べる */
  const relatedColumnList = useMemo(() => {
    const merged = new Map<MOFSectionRsColumn, MOFSectionRsNode[]>();
    for (const [column, items] of ancestorColumns) merged.set(column, items);
    for (const [column, items] of descendantColumns) {
      if (column !== 'rsStatus') merged.set(column, items);
    }
    if (rsRelatedTab) merged.set(rsRelatedTab.column, rsRelatedTab.items);
    return MOF_SECTION_RS_COLUMNS.filter(c => c !== 'total' && merged.has(c)).map(column => ({
      column,
      items: merged.get(column) ?? [],
    }));
  }, [ancestorColumns, descendantColumns, rsRelatedTab]);

  /**
   * 「目」タブ。項ノードならその項の目一覧、RS事業ノード（個別）ならその事業が
   * 計上されている目一覧を、選んだときに遅延取得する（KouMokuTab側で fetch する）
   */
  const koumokuTabInfo = useMemo(() => {
    if (!selectedDetails) return null;
    if (selectedDetails.column === 'section' && selectedDetails.mofKouSectionId) {
      return { mode: 'section' as const, sectionId: selectedDetails.mofKouSectionId };
    }
    if (selectedDetails.column === 'rsStatus' && selectedDetails.rsStatus === 'linked' && selectedDetails.projectId !== undefined) {
      return { mode: 'project' as const, projectId: selectedDetails.projectId };
    }
    if (
      selectedDetails.column === 'ministry' ||
      selectedDetails.column === 'organization' ||
      selectedDetails.column === 'subAccount'
    ) {
      const sectionIds = (descendantColumns.get('section') ?? [])
        .map(n => n.details.mofKouSectionId)
        .filter((id): id is string => Boolean(id));
      if (sectionIds.length === 0) return null;
      return { mode: 'sections' as const, sectionIds };
    }
    return null;
  }, [selectedDetails, descendantColumns]);
  /** 「目」タブの件数。他のタブと同じく見出しに件数を出すため、KouMokuTab側の取得結果を持ち回す */
  const [koumokuCount, setKoumokuCount] = useState<number | null>(null);
  useEffect(() => {
    setKoumokuCount(null);
  }, [koumokuTabInfo]);

  /**
   * 「目」タブを「RS事業」タブの直前に差し込む（項→目→RS事業の順で読みたいため）。
   * 項ノードそのものを選んだときは「項」タブ自体が無い（自分自身のため）ので、
   * 「RS事業」タブの位置を基準にする（無ければ末尾）
   */
  const tabs = useMemo(() => {
    const columnTabs = relatedColumnList.map(t => ({
      id: t.column as string,
      label: MOF_SECTION_RS_COLUMN_LABELS[t.column],
      count: t.items.length,
    }));
    if (!koumokuTabInfo) return columnTabs;
    const koumokuTab = { id: 'koumoku', label: '目', count: koumokuCount ?? undefined };
    const rsStatusIndex = columnTabs.findIndex(t => t.id === 'rsStatus');
    if (rsStatusIndex === -1) return [...columnTabs, koumokuTab];
    return [...columnTabs.slice(0, rsStatusIndex), koumokuTab, ...columnTabs.slice(rsStatusIndex)];
  }, [relatedColumnList, koumokuTabInfo, koumokuCount]);
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
      const anchorY = rect ? e.clientY - rect.top : 0;
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchorY);
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

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onWheel={handleWheel}
      onPointerDown={e => {
        if (e.pointerType !== 'touch') return;
        if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 1) {
          panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          dragged.current = false;
        }
        if (touches.current.size === 2) {
          const [a, b2] = [...touches.current.values()];
          const rect = containerRef.current?.getBoundingClientRect();
          pinchStart.current = {
            distance: Math.hypot(a.x - b2.x, a.y - b2.y),
            zoom,
            centerY: (a.y + b2.y) / 2 - (rect?.top ?? 0),
          };
          panStart.current = null;
        }
      }}
      onPointerMove={e => {
        if (e.pointerType !== 'touch') return;
        if (!touches.current.has(e.pointerId)) return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 1 && panStart.current) {
          if (Math.abs(e.clientX - panStart.current.x) > 3 || Math.abs(e.clientY - panStart.current.y) > 3) {
            dragged.current = true;
          }
          setPan({
            x: panStart.current.panX + (e.clientX - panStart.current.x),
            y: panStart.current.panY + (e.clientY - panStart.current.y),
          });
          return;
        }
        if (touches.current.size === 2 && pinchStart.current) {
          const [a, b2] = [...touches.current.values()];
          const distance = Math.hypot(a.x - b2.x, a.y - b2.y);
          if (pinchStart.current.distance > 0) {
            const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchStart.current.zoom * (distance / pinchStart.current.distance)));
            const prev = zoomRef.current;
            if (next !== prev) {
              const anchorY = pinchStart.current.centerY;
              zoomRef.current = next;
              setZoom(next);
              setPan(p => ({ ...p, y: anchorY - (anchorY - p.y) * (next / prev) }));
            }
          }
          dragged.current = true;
        }
      }}
      onPointerUp={e => {
        if (e.pointerType !== 'touch') return;
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinchStart.current = null;
        if (touches.current.size === 0) panStart.current = null;
      }}
      onPointerCancel={e => {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinchStart.current = null;
      }}
      style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-pan-disabled="true"]')) return;
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        dragged.current = false;
        setIsPanning(true);
      }}
      onMouseMove={e => {
        if (!panStart.current) return;
        if (Math.abs(e.clientX - panStart.current.x) > 3 || Math.abs(e.clientY - panStart.current.y) > 3) {
          dragged.current = true;
        }
        setPan({
          x: panStart.current.panX + (e.clientX - panStart.current.x),
          y: panStart.current.panY + (e.clientY - panStart.current.y),
        });
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
      <svg
        data-testid={testId('section-rs-canvas')}
        width={width}
        height={layout.contentHeight}
        style={{ position: 'absolute', left: pan.x, top: pan.y, display: 'block' }}
        role="img"
        aria-label="所管から項を経てRS対象/RS対象外に至る予算の流れ"
      >
        <g>
          {visibleColumns.map(({ column, index }) => (
            <g key={column}>
              <text x={columnX.get(index) ?? 0} y={headerY - 16} fontSize={12} fontWeight={600} fill="#374151">
                {MOF_SECTION_RS_COLUMN_LABELS[column]}
              </text>
              <text x={columnX.get(index) ?? 0} y={headerY} fontSize={11} fill="#9ca3af">
                {formatBudgetFromYen(columnTotal.get(index) ?? 0)}
                {column === 'rsStatus' && (
                  <tspan fill="#0d9488"> (RS対象 {formatBudgetFromYen(rsLinkedTotal)})</tspan>
                )}
              </text>
            </g>
          ))}
        </g>

        <g>
          {layout.links.map((link, i) => {
            const offSelection =
              !focusRelated && related !== null && !(related.has(link.source.id) && related.has(link.target.id));
            const offHover = hoveredRelated !== null && !(hoveredRelated.has(link.source.id) && hoveredRelated.has(link.target.id));
            const dim = offSelection || offHover;
            const isHovered = hoveredLink === link;
            return (
              <path
                key={`${link.source.id}-${link.target.id}-${i}`}
                data-testid={testId('section-rs-link')}
                d={mofRibbonPath(link)}
                fill={sectionRsNodeColor({
                  column: link.target.details?.column as MOFSectionRsColumn | undefined,
                  aggregated: link.target.details?.aggregated,
                  rsStatus: link.target.details?.rsStatus,
                })}
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
            const details = node.details as MOFSectionRsNode['details'] | undefined;
            if (details?.passThrough) return null;
            const color = sectionRsNodeColor({
              column: details?.column,
              aggregated: details?.aggregated,
              rsStatus: details?.rsStatus,
            });
            const labelLeft = node.column === 0;
            const labelX = labelLeft ? node.x - 6 : node.x + node.width + 6;
            const centerY = node.y + node.height / 2;
            const textY = centerY;
            const offSelection = !focusRelated && related !== null && !related.has(node.id);
            const offHover = hoveredRelated !== null && !hoveredRelated.has(node.id);
            const dim = offSelection || offHover;
            const isSelected = selectedId === node.id;
            return (
              <g
                key={node.id}
                data-testid={testId('section-rs-node')}
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
                  stroke={isSelected ? '#1f2937' : undefined}
                  strokeWidth={isSelected ? 1.5 : undefined}
                />
                {showsLabel(node) && (
                  <text
                    data-testid={testId('section-rs-label')}
                    x={labelX}
                    y={textY}
                    textAnchor={labelLeft ? 'end' : 'start'}
                    dominantBaseline="middle"
                    fontSize={fontPx}
                    fontWeight={isSelected ? 700 : details?.aggregated ? 400 : 500}
                    fill={details?.aggregated ? '#6b7280' : '#1f2937'}
                    stroke="#ffffff"
                    strokeWidth={3}
                    paintOrder="stroke"
                    opacity={dim ? 0.35 : 1}
                  >
                    {`${shorten(node.name, labelLeft ? 24 : 18)} (${formatBudgetFromYen(node.value)})`}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {labelOverlaps.map(id => (
          <g key={`overlap-${id}`} data-testid={testId('section-rs-label-overlap')} />
        ))}
      </svg>

      {hovered && pointer && <SectionRsTooltip node={hovered} x={pointer.x} y={pointer.y} />}
      {!hovered && hoveredLink && pointer && <SectionRsLinkTooltip link={hoveredLink} x={pointer.x} y={pointer.y} />}

      <div
        data-pan-disabled="true"
        className="absolute top-3 z-30 flex items-start gap-1.5 transition-[left] duration-200"
        style={{ left: panelOpenWidth + 12 }}
      >
        <SankeyChartSearch
          nodes={browseNodes}
          onSelect={onSelect}
          filterOpen={filterOpen}
          onToggleFilter={onToggleFilterOpen}
          filterFields={<FilterFields filter={filter} onFilterChange={onFilterChange} ministryOptions={ministryOptions} />}
        />
        <HierarchyFilterClearButton
          active={hasActiveMOFSectionRsFilterState(filter)}
          onClear={() => onFilterChange(MOF_SECTION_RS_FILTER_DEFAULT)}
        />
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
          testId={testId('section-rs-side-panel')}
        >
          {selectedPanelNode && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-shrink-0 border-b border-gray-100 p-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-gray-900">{selectedPanelNode.name}</div>
                    <div className="mt-0.5 text-lg font-bold text-gray-800">{formatBudgetFromYen(selectedPanelNode.value ?? 0)}</div>
                    <div className="text-[11px] text-gray-400">{Math.round(selectedPanelNode.value ?? 0).toLocaleString()}円</div>
                    {!selectedNode && (
                      <div className="mt-1 text-[11px] text-amber-600">表示数の上限から溢れているため図には出ていません</div>
                    )}
                  </div>
                  <button
                    type="button"
                    title="選択を解除"
                    aria-label="選択を解除"
                    onClick={() => onSelect(null)}
                    className="shrink-0 rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    ×
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {selectedDetails?.column && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                      style={{
                        backgroundColor: sectionRsNodeColor({
                          column: selectedDetails.column,
                          aggregated: false,
                          rsStatus: selectedDetails.rsStatus,
                        }),
                      }}
                    >
                      {MOF_SECTION_RS_COLUMN_LABELS[selectedDetails.column]}
                    </span>
                  )}
                  {selectedDetails?.aggregated && (
                    <span className="rounded-full bg-gray-400 px-2 py-0.5 text-[11px] font-medium text-white">集約</span>
                  )}
                  {selectedDetails?.column === 'section' && selectedDetails.rsLinked !== undefined && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                      style={{
                        backgroundColor: sectionRsNodeColor({ rsStatus: selectedDetails.rsLinked ? 'linked' : 'unlinked' }),
                      }}
                    >
                      {MOF_SECTION_RS_STATUS_LABELS[selectedDetails.rsLinked ? 'linked' : 'unlinked']}
                    </span>
                  )}
                  {selectedDetails?.column === 'section' && selectedDetails.page != null && (
                    <a
                      href={selectedDetails.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 underline hover:text-blue-800"
                    >
                      出典 p.{selectedDetails.page}
                    </a>
                  )}
                  {selectedRsSvgUrl && (
                    <a
                      href={selectedRsSvgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 underline hover:text-blue-800"
                    >
                      /sankey-svgで開く
                    </a>
                  )}
                </div>
              </div>

              {(selectedDetails?.aggregated || focusRelated) && (
                <div className="flex-shrink-0 overflow-y-auto p-4 pb-0" style={{ maxHeight: '40%' }}>
                  {selectedDetails?.aggregated && (
                    <div className="text-xs text-gray-600">表示数から溢れた {selectedDetails.aggregatedCount?.toLocaleString()} 件</div>
                  )}
                  {selectedDetails?.aggregatedTop && selectedDetails.aggregatedTop.length > 0 && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="mb-1 text-[11px] text-gray-400">内訳（金額の大きい順）</div>
                      {selectedDetails.aggregatedTop.map((member, index) => (
                        <div key={`${index}-${member.name}`} className="flex justify-between gap-3 text-xs text-gray-700">
                          <span className="truncate">{member.name}</span>
                          <span className="shrink-0 tabular-nums text-gray-500">{formatBudgetFromYen(member.amount)}</span>
                        </div>
                      ))}
                      {(selectedDetails.aggregatedCount ?? 0) > selectedDetails.aggregatedTop.length && (
                        <div className="text-[11px] text-gray-400">
                          ほか {((selectedDetails.aggregatedCount ?? 0) - selectedDetails.aggregatedTop.length).toLocaleString()} 件
                        </div>
                      )}
                    </div>
                  )}
                  {focusRelated && <div className="mt-2 text-[11px] text-gray-400">この筋に連なるノードだけを表示しています</div>}
                  <div className="h-3" />
                </div>
              )}

              {tabs.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-gray-100">
                  <div role="tablist" className="flex flex-shrink-0 border-b border-gray-100 px-2">
                    {tabs.map(({ id, label, count }) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === id}
                        onClick={() => setPanelTab(id)}
                        className={`flex-1 border-b-2 px-1 py-1.5 text-[11px] font-semibold ${
                          activeTab === id ? 'border-blue-500 text-gray-800' : 'border-transparent text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {label}
                        {count !== undefined && <span className="ml-0.5 font-normal">({count.toLocaleString()})</span>}
                      </button>
                    ))}
                  </div>
                  <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                    {/* 目タブが選ばれていなくても、件数を見出しに出すため常時マウントして
                        取得だけは進めておく（表示だけ hidden で切り替える） */}
                    {koumokuTabInfo && (
                      <div hidden={activeTab !== 'koumoku'}>
                        <KouMokuTab
                          {...(koumokuTabInfo.mode === 'section'
                            ? { mode: 'section', fiscalYear, sectionId: koumokuTabInfo.sectionId }
                            : koumokuTabInfo.mode === 'sections'
                              ? { mode: 'sections', fiscalYear, sectionIds: koumokuTabInfo.sectionIds }
                              : { mode: 'project', fiscalYear, budgetType, projectId: koumokuTabInfo.projectId })}
                          onCount={setKoumokuCount}
                        />
                      </div>
                    )}
                    {activeTab !== 'koumoku' && (
                      <div className="p-4 pt-1">
                        {relatedColumnList
                          .find(t => t.column === activeTab)
                          ?.items.map(item => {
                            const rsLink =
                              activeTab === 'rsStatus' && rsYear !== null && item.details.projectId !== undefined
                                ? sankeySvgProjectUrl(item.details.projectId, item.name ?? '', rsYear)
                                : null;
                            return (
                              <div key={item.id} className="flex w-full items-baseline gap-1 border-b border-gray-50 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => onSelect(item.id)}
                                  className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-left hover:bg-gray-50"
                                >
                                  <span className="truncate text-xs text-gray-700">{item.name}</span>
                                  <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
                                    {formatBudgetFromYen(item.value ?? 0)}
                                  </span>
                                </button>
                                {rsLink && (
                                  <a
                                    href={rsLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="/sankey-svgで開く"
                                    onClick={e => e.stopPropagation()}
                                    className="shrink-0 px-0.5 text-gray-400 hover:text-blue-600"
                                  >
                                    ↗
                                  </a>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SidePanelChrome>
      )}

      <MinimapOverlay
        show={showMinimap}
        onShow={() => setShowMinimap(true)}
        onHide={() => setShowMinimap(false)}
        left={panelOpenWidth + 12}
        minimapW={MINIMAP_W}
        minimapH={minimapH}
        canvasRef={minimapRef}
        navigate={minimapNavigate}
        dragging={minimapDragging}
      />

      <div data-pan-disabled="true" className="absolute bottom-3 right-3 z-30 flex flex-col gap-1">
        <ZoomButton label="＋" title="拡大" onClick={() => zoomFromButton(ZOOM_STEP)} />
        <ZoomButton label="－" title="縮小" onClick={() => zoomFromButton(1 / ZOOM_STEP)} />
        <ZoomButton
          label="⤢"
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
            className="w-full rounded border border-black/10 bg-white px-1 py-0.5 text-center text-[10px] text-gray-700 shadow"
          />
        ) : (
          <button
            type="button"
            title="クリックしてズーム率を入力"
            onClick={() => {
              setZoomInputValue(String(Math.round(zoom * 100)));
              setIsEditingZoom(true);
            }}
            className="w-full cursor-text rounded border border-black/10 bg-white/90 px-1 py-0.5 text-center text-[10px] text-gray-500 shadow"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
      </div>
    </div>
  );
}

function ZoomButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={e => e.stopPropagation()}
      onClick={onClick}
      className="h-7 w-7 rounded border border-black/10 bg-white/90 text-sm text-gray-600 shadow hover:bg-white"
    >
      {label}
    </button>
  );
}

function SectionRsTooltip({ node, x, y }: { node: MOFLayoutNode; x: number; y: number }) {
  const details = node.details as MOFSectionRsNode['details'] | undefined;
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-md rounded border border-gray-200 bg-white px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y + 12 }}
    >
      {details?.column && <div className="text-[11px] font-medium text-gray-400">{MOF_SECTION_RS_COLUMN_LABELS[details.column]}</div>}
      <div className="font-semibold text-gray-900">{node.name}</div>
      <div className="text-lg font-bold text-gray-800">{formatBudgetFromYen(node.value)}</div>
      {details?.aggregated && (
        <div className="mt-1 text-xs text-gray-600">TopN から溢れた {details.aggregatedCount} 件をまとめたもの</div>
      )}
      {details?.column === 'section' && details.rsLinked !== undefined && (
        <div className="mt-1 text-xs font-medium" style={{ color: sectionRsNodeColor({ rsStatus: details.rsLinked ? 'linked' : 'unlinked' }) }}>
          {MOF_SECTION_RS_STATUS_LABELS[details.rsLinked ? 'linked' : 'unlinked']}
        </div>
      )}
    </div>
  );
}

function SectionRsLinkTooltip({ link, x, y }: { link: MOFLayoutLink; x: number; y: number }) {
  return (
    <div
      data-testid={testId('section-rs-link-tooltip')}
      className="pointer-events-none fixed z-50 max-w-md rounded border border-gray-200 bg-white px-3 py-2 shadow-lg"
      style={{ left: x + 12, top: y + 12 }}
    >
      <div className="text-xs text-gray-600">
        {link.source.name} → {link.target.name}
      </div>
      <div className="text-lg font-bold text-gray-800">{formatBudgetFromYen(link.value)}</div>
    </div>
  );
}
