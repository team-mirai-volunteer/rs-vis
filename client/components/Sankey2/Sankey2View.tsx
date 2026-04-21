'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Sankey2LayoutData, LayoutNode, LayoutEdge, SubcontractChain } from '@/client/components/Sankey2/types';

// ─── 定数 ──────────────────────────────────────────────

/** typeごとの色 */
const TYPE_COLORS: Record<string, string> = {
  'total':            '#6b7280', // gray-500
  'ministry':         '#3b82f6', // blue-500
  'project-budget':   '#22c55e', // green-500
  'project-spending': '#f97316', // orange-500
  'recipient':        '#ef4444', // red-500
};

/** typeの日本語表示名 */
const TYPE_LABELS: Record<string, string> = {
  'total':            '予算総計',
  'ministry':         '府省庁',
  'project-budget':   '事業（予算）',
  'project-spending': '事業（支出）',
  'recipient':        '支出先',
};

/** 面積ベースLOD: スクリーン上でこの面積(px²)未満のノードは描画しない */
const MIN_SCREEN_AREA = 4;

/** エッジ面積ベースLOD: スクリーン上でこの面積(px²)未満のエッジは描画しない */
const MIN_EDGE_SCREEN_AREA = 2;

/** ノードごとに表示するエッジの最大数（value降順） */
const EDGE_TOP_N = 3;

/** 面積ベースLOD: スクリーン上でこの面積(px²)以上ならラベル表示 */
const LABEL_SCREEN_AREA = 400; // ~20×20px

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 1350;
const ZOOM_SENSITIVITY = 0.002;

/** ビューポート外のマージン（px、仮想座標系） */
const VIEWPORT_MARGIN = 100;

/** サイドパネル幅 */
const PANEL_WIDTH = 320;

/** BFS最大ホップ数（Shift押下時） */
const BFS_MAX_DEPTH = 3;

/** ホップ距離に応じたopacity */
const DEPTH_OPACITY = [1.0, 0.8, 0.5, 0.3];

/** サイドパネルの接続先表示上限 */
const PANEL_MAX_CONNECTIONS = 20;

/** Minimap設定 */
const MINIMAP_WIDTH = 200;
const MINIMAP_PADDING = 12;

/** 検索デバウンス(ms) */
const SEARCH_DEBOUNCE = 150;

/** 検索候補の最大表示数 */
const SEARCH_MAX_RESULTS = 20;

/** 金額スライダーの対数スケール範囲 (10^4 = 1万 〜 10^14 = 100兆) */
const MIN_AMOUNT_LOG_MIN = 4;
const MIN_AMOUNT_LOG_MAX = 14;

// ─── 型 ──────────────────────────────────────────────────

interface EdgeIndex {
  bySource: Map<string, LayoutEdge[]>;
  byTarget: Map<string, LayoutEdge[]>;
}

// ─── ユーティリティ ──────────────────────────────────────

/** 金額フォーマット */
function formatAmount(amount: number): string {
  if (amount >= 1e12) return `${(amount / 1e12).toFixed(1)}兆円`;
  if (amount >= 1e8) return `${(amount / 1e8).toFixed(0)}億円`;
  if (amount >= 1e4) return `${Math.round(amount / 1e4)}万円`;
  return `${Math.round(amount).toLocaleString()}円`;
}

/** polyline points文字列を生成 */
function pathToPolyline(path: [number, number][]): string {
  return path.map(([x, y]) => `${x},${y}`).join(' ');
}

/** BFS探索: startIdから上流・下流をmaxDepthホップまで探索
 *  サブコントラクトエッジのprojectIdsを使い、事業帰属を正しくフィルタリング。
 *
 *  制約の仕組み:
 *  - サブコントラクトエッジを通過すると、そのエッジのprojectIdsが制約として伝搬
 *  - 制約付きノードから上流のproject-spending探索: projectIdが制約に含まれる事業のみ
 *  - 制約付きノードから下流のサブコントラクト展開: projectIdsが制約と重なるエッジのみ
 *
 *  例: 朝倉市 ← 北海道(subcontract, pids=[3440]) → さつま町(subcontract, pids=[3440])
 *  北海道に制約{3440}が付与され、下流のさつま町にも伝搬。
 *  さつま町からPID=113(高校生の地域留学)への遡りはブロックされる。
 */
function bfsHighlight(
  startId: string,
  edgeIndex: EdgeIndex,
  maxDepth: number,
): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue: [string, number][] = [[startId, 0]];
  // サブコントラクトエッジ経由で到達したノードの事業ID制約
  const projectConstraints = new Map<string, Set<number>>();

  while (queue.length > 0) {
    const [nodeId, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    const constraint = projectConstraints.get(nodeId);

    // 下流（source→target）
    for (const edge of edgeIndex.bySource.get(nodeId) ?? []) {
      if (distances.has(edge.target)) continue;

      // 制約付きノードから下流サブコントラクト: projectIdsが制約と重なるエッジのみ
      if (constraint && edge.edgeType === 'subcontract') {
        if (!edge.projectIds || !edge.projectIds.some(pid => constraint.has(pid))) continue;
      }

      distances.set(edge.target, depth + 1);
      queue.push([edge.target, depth + 1]);

      // 下流サブコントラクトエッジの制約伝搬
      if (constraint && edge.edgeType === 'subcontract' && edge.projectIds) {
        // 親の制約とエッジのprojectIdsの交差を伝搬
        const intersection = edge.projectIds.filter(pid => constraint.has(pid));
        if (intersection.length > 0) {
          const existing = projectConstraints.get(edge.target);
          if (existing) {
            for (const pid of intersection) existing.add(pid);
          } else {
            projectConstraints.set(edge.target, new Set(intersection));
          }
        }
      }
    }

    // 上流（target←source）
    for (const edge of edgeIndex.byTarget.get(nodeId) ?? []) {
      if (distances.has(edge.source)) continue;

      // 制約付きノードからproject-spending遡り: projectIdで絞り込み
      if (constraint && edge.source.startsWith('project-spending-')) {
        const pid = parseInt(edge.source.replace('project-spending-', ''), 10);
        if (!constraint.has(pid)) continue;
      }

      distances.set(edge.source, depth + 1);
      queue.push([edge.source, depth + 1]);

      // 上流サブコントラクトエッジの制約伝搬
      if (edge.edgeType === 'subcontract' && edge.projectIds) {
        const existing = projectConstraints.get(edge.source);
        if (existing) {
          for (const pid of edge.projectIds) existing.add(pid);
        } else {
          projectConstraints.set(edge.source, new Set(edge.projectIds));
        }
      }
    }
  }
  return distances;
}

// ─── コンポーネント ──────────────────────────────────────

interface Props {
  data: Sankey2LayoutData | null;
}

export default function Sankey2View({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // Transform state: pan + zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.15 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Hover / Selection state
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredAggId, setHoveredAggId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // コンテナサイズ
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // ── フィルタ・検索 state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [ministryFilter, setMinistryFilter] = useState<Set<string>>(new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [minAmount, setMinAmount] = useState(0);
  const [maxAmount, setMaxAmount] = useState(Infinity);
  const [labelFilter, setLabelFilter] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** 次のURL同期でpushするかどうか（確定操作時にtrue） */
  const shouldPushRef = useRef(false);

  // ── rAFバッチ化用ref（8-4A） ──
  const pendingTransformRef = useRef<{ x: number; y: number; k: number } | null>(null);
  const rafIdRef = useRef(0);

  // ── FPSカウンター（8-1: 開発時のみ） ──
  const [fps, setFps] = useState(0);
  const fpsFramesRef = useRef(0);
  const fpsLastRef = useRef(performance.now());

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    let running = true;
    const tick = () => {
      if (!running) return;
      fpsFramesRef.current++;
      const now = performance.now();
      if (now - fpsLastRef.current >= 1000) {
        setFps(fpsFramesRef.current);
        fpsFramesRef.current = 0;
        fpsLastRef.current = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { running = false; };
  }, []);

  // ── Minimap背景キャッシュ（8-4B） ──
  const minimapBgRef = useRef<ImageData | null>(null);

  // ── エッジインデックス（O(1)接続検索） ──

  const edgeIndex = useMemo<EdgeIndex>(() => {
    if (!data) return { bySource: new Map(), byTarget: new Map() };
    const bySource = new Map<string, LayoutEdge[]>();
    const byTarget = new Map<string, LayoutEdge[]>();
    for (const edge of data.edges) {
      let s = bySource.get(edge.source);
      if (!s) { s = []; bySource.set(edge.source, s); }
      s.push(edge);
      let t = byTarget.get(edge.target);
      if (!t) { t = []; byTarget.set(edge.target, t); }
      t.push(edge);
    }
    return { bySource, byTarget };
  }, [data]);

  // ── ノードMap ──

  const nodeMap = useMemo(() => {
    if (!data) return new Map<string, LayoutNode>();
    const m = new Map<string, LayoutNode>();
    for (const node of data.nodes) m.set(node.id, node);
    return m;
  }, [data]);

  // ── stable hover handlers (4-4メモ化) ──

  const hoverHandlers = useMemo(() => {
    if (!data) return new Map<string, { start: () => void; end: () => void }>();
    const map = new Map<string, { start: () => void; end: () => void }>();
    for (const node of data.nodes) {
      map.set(node.id, {
        start: () => {
          if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null; }
          setHoveredNodeId(node.id);
        },
        end: () => {
          hoverTimeoutRef.current = setTimeout(() => setHoveredNodeId(null), 120);
        },
      });
    }
    return map;
  }, [data]);

  // ── 府省庁リスト（金額降順） ──

  const ministryList = useMemo(() => {
    if (!data) return [];
    return data.nodes
      .filter(n => n.type === 'ministry')
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  // ── フィルタ状態の集計 ──

  const activeFilterCount = (ministryFilter.size > 0 ? 1 : 0) + (minAmount > 0 ? 1 : 0) + (maxAmount < Infinity ? 1 : 0) + (labelFilter ? 1 : 0);
  const hasActiveFilter = activeFilterCount > 0;

  // ── URLパラメータからの復元（初期ロード + popstate） ──

  const restoreFromUrl = useCallback((params: URLSearchParams) => {
    const m = params.get('m');
    const min = params.get('min');
    const max = params.get('max');
    const l = params.get('l');
    const q = params.get('q');
    const s = params.get('s');

    setMinistryFilter(m ? new Set(m.split(',')) : new Set());
    let parsedMin = min ? Math.round(Math.max(0, Number(min) || 0)) : 0;
    let parsedMax = max ? (Number(max) || Infinity) : Infinity;
    if (parsedMax < Infinity) parsedMax = Math.round(Math.max(0, parsedMax));
    if (parsedMin > 0 && parsedMax < Infinity && parsedMin > parsedMax) {
      [parsedMin, parsedMax] = [parsedMax, parsedMin];
    }
    setMinAmount(parsedMin);
    setMaxAmount(parsedMax < Infinity ? parsedMax : Infinity);
    setLabelFilter(l ?? '');
    if (q) { setSearchQuery(q); setDebouncedQuery(q); } else { setSearchQuery(''); setDebouncedQuery(''); }
    setSelectedNodeId(s ?? null);
  }, []);

  // 初期ロード
  useEffect(() => {
    if (!data) return;
    restoreFromUrl(searchParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // popstate（ブラウザ戻る/進む）
  useEffect(() => {
    const handler = () => {
      restoreFromUrl(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [restoreFromUrl]);

  // ── 検索デバウンス ──

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── URLパラメータ同期 ──

  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams();
    if (ministryFilter.size > 0) params.set('m', [...ministryFilter].join(','));
    if (minAmount > 0) params.set('min', String(minAmount));
    if (maxAmount < Infinity) params.set('max', String(maxAmount));
    if (labelFilter) params.set('l', labelFilter);
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (selectedNodeId) params.set('s', selectedNodeId);

    const str = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (str !== current) {
      const url = str ? `?${str}` : window.location.pathname;
      if (shouldPushRef.current) {
        shouldPushRef.current = false;
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    } else {
      // URL差分なし → フラグをクリア（次の無関係な同期でpushされるのを防ぐ）
      shouldPushRef.current = false;
    }
  }, [data, ministryFilter, minAmount, maxAmount, labelFilter, debouncedQuery, selectedNodeId, router]);

  // ── 検索結果 ──

  const searchResults = useMemo(() => {
    if (!data || debouncedQuery.length < 2) return [];
    const q = debouncedQuery;
    const hasMinistryFilter = ministryFilter.size > 0;
    return data.nodes
      .filter(n => {
        if (!n.label.includes(q)) return false;
        // フィルタと一致させる（visibleNodesと同じ条件）
        if (n.type !== 'total') {
          if (minAmount > 0 && n.amount < minAmount) return false;
          if (maxAmount < Infinity && n.amount > maxAmount) return false;
        }
        if (labelFilter && !n.label.includes(labelFilter)) return false;
        if (hasMinistryFilter) {
          if (n.type === 'ministry') { if (!ministryFilter.has(n.label)) return false; }
          else if (n.type !== 'total') { if (!n.ministry || !ministryFilter.has(n.ministry)) return false; }
        }
        return true;
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, SEARCH_MAX_RESULTS);
  }, [data, debouncedQuery, ministryFilter, minAmount, maxAmount, labelFilter]);

  // ── Shiftキー追跡 ──

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setIsShiftHeld(false); };
    const blur = () => setIsShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Escキーで選択解除・パネル閉じ ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSearchResults) { setShowSearchResults(false); return; }
        if (showFilterPanel) { setShowFilterPanel(false); return; }
        setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearchResults, showFilterPanel]);

  // ── コンテナサイズをResizeObserverで追跡 ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 初期表示: データの中央にフィット
  useEffect(() => {
    if (!data || !containerRef.current) return;
    const { totalWidth, totalHeight } = data.metadata.layout;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    setContainerSize({ w: cw, h: ch });

    const scaleX = cw / totalWidth;
    const scaleY = ch / totalHeight;
    const k = Math.min(scaleX, scaleY) * 0.9;

    const tx = (cw - totalWidth * k) / 2;
    const ty = (ch - totalHeight * k) / 2;

    setTransform({ x: tx, y: ty, k });
  }, [data]);

  // ── TopNエッジセット（ノードごとにvalue上位N本のみ保持） ──

  const topEdgeSet = useMemo(() => {
    if (!data) return new Set<LayoutEdge>();
    const set = new Set<LayoutEdge>();
    // ノードごとに接続エッジをvalue降順でTopN選択
    for (const edges of edgeIndex.bySource.values()) {
      const sorted = [...edges].sort((a, b) => b.value - a.value);
      for (let i = 0; i < Math.min(EDGE_TOP_N, sorted.length); i++) {
        set.add(sorted[i]);
      }
    }
    for (const edges of edgeIndex.byTarget.values()) {
      const sorted = [...edges].sort((a, b) => b.value - a.value);
      for (let i = 0; i < Math.min(EDGE_TOP_N, sorted.length); i++) {
        set.add(sorted[i]);
      }
    }
    return set;
  }, [data, edgeIndex]);

  // ── 委託チェーン重複エッジの除外セット ──
  // project→委託元→受託先のチェーンがある場合、project→受託先の直接エッジは冗長
  const redundantEdgeSet = useMemo(() => {
    if (!data) return new Set<LayoutEdge>();
    const set = new Set<LayoutEdge>();
    for (const edge of data.edges) {
      if (edge.edgeType === 'subcontract') continue;
      // targetが委託元（subcontract out-edgesあり）なら中継点 → 直接エッジは残す
      const targetOutEdges = edgeIndex.bySource.get(edge.target);
      if (targetOutEdges?.some(e => e.edgeType === 'subcontract')) continue;
      // edge: source(project) → target(最終受託先)
      // targetに再委託で流入しているソース(委託元)を確認
      const subInEdges = edgeIndex.byTarget.get(edge.target);
      if (!subInEdges) continue;
      for (const subEdge of subInEdges) {
        if (subEdge.edgeType !== 'subcontract') continue;
        // 委託元(subEdge.source)がedge.source(同じproject)からも流入しているか
        const intermediaryInEdges = edgeIndex.byTarget.get(subEdge.source);
        if (intermediaryInEdges?.some(ie => ie.source === edge.source)) {
          set.add(edge);
          break;
        }
      }
    }
    return set;
  }, [data, edgeIndex]);

  // ── ハイライト: BFS or 1-hop（選択とホバーは独立） ──

  const activeNodeId = hoveredNodeId ?? selectedNodeId;

  const highlightMap = useMemo(() => {
    const maxDepth = isShiftHeld ? BFS_MAX_DEPTH : 1;
    if (!hoveredNodeId && !selectedNodeId) return new Map<string, number>();
    // 選択とホバー両方のBFSをマージ（近い方の距離を採用）
    const selected = selectedNodeId ? bfsHighlight(selectedNodeId, edgeIndex, maxDepth) : new Map<string, number>();
    if (!hoveredNodeId || hoveredNodeId === selectedNodeId) return selected;
    const hovered = bfsHighlight(hoveredNodeId, edgeIndex, maxDepth);
    const merged = new Map(selected);
    for (const [id, dist] of hovered) {
      const existing = merged.get(id);
      merged.set(id, existing !== undefined ? Math.min(existing, dist) : dist);
    }
    return merged;
  }, [hoveredNodeId, selectedNodeId, edgeIndex, isShiftHeld]);

  const isHighlighting = highlightMap.size > 0;

  // ── 面積ベースLOD + ビューポートカリング + TopNエッジ間引き ──

  interface AggregateNode {
    id: string;
    type: string;
    label: string;
    count: number;
    amount: number;
    cx: number;
    cy: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
  }

  const { visibleNodes, visibleEdges, aggregateNodes } = useMemo(() => {
    if (!data) return { visibleNodes: [], visibleEdges: [], aggregateNodes: [] };
    const _t0 = process.env.NODE_ENV === 'development' ? performance.now() : 0;

    const { k, x: tx, y: ty } = transform;
    const { w: cw, h: ch } = containerSize;
    const k2 = k * k;
    const hasMinistryFilter = ministryFilter.size > 0;

    const vpLeft   = (-tx / k) - VIEWPORT_MARGIN;
    const vpTop    = (-ty / k) - VIEWPORT_MARGIN;
    const vpRight  = (cw - tx) / k + VIEWPORT_MARGIN;
    const vpBottom = (ch - ty) / k + VIEWPORT_MARGIN;

    const nodeSet = new Set<string>();
    const filteredNodes: LayoutNode[] = [];

    // LOD除外ノードを集計キー別に収集
    // project-budget/project-spending: type+ministry別、recipient: type別（1グループ）
    const hiddenByKey = new Map<string, { type: string; label: string; nodes: LayoutNode[] }>();

    for (const node of data.nodes) {
      // 金額閾値フィルタ（totalは常に表示）
      if (node.type !== 'total') {
        if (minAmount > 0 && node.amount < minAmount) continue;
        if (maxAmount < Infinity && node.amount > maxAmount) continue;
      }

      // ノード名フィルタ
      if (labelFilter && !node.label.includes(labelFilter)) continue;

      // 府省庁フィルタ
      if (hasMinistryFilter) {
        if (node.type === 'ministry') {
          if (!ministryFilter.has(node.label)) continue;
        } else if (node.type !== 'total') {
          if (!node.ministry || !ministryFilter.has(node.ministry)) continue;
        }
      }

      // ハイライト中のノードはLOD・カリングをスキップ
      const inHighlight = highlightMap.has(node.id);
      if (!inHighlight) {
        // 面積ベースLOD
        const screenArea = (node.area ?? node.width * node.height) * k2;
        if (screenArea < MIN_SCREEN_AREA) {
          // LOD除外 → 集約候補
          if (node.type !== 'total' && node.type !== 'ministry') {
            // project系: 府省庁別、recipient: 全体で1グループ
            const key = node.type === 'recipient'
              ? `recipient`
              : `${node.type}::${node.ministry || '__unknown__'}`;
            let group = hiddenByKey.get(key);
            if (!group) {
              const label = node.type === 'recipient'
                ? '支出先'
                : (node.ministry || '不明');
              group = { type: node.type, label, nodes: [] };
              hiddenByKey.set(key, group);
            }
            group.nodes.push(node);
          }
          continue;
        }

        // ビューポートカリング
        if (node.x + node.width < vpLeft || node.x > vpRight) continue;
        if (node.y + node.height < vpTop || node.y > vpBottom) continue;
      }

      nodeSet.add(node.id);
      filteredNodes.push(node);
    }

    // 集約ノード生成
    const aggNodes: AggregateNode[] = [];
    for (const [key, group] of hiddenByKey) {
      if (group.nodes.length === 0) continue;
      let sumX = 0, sumY = 0, sumAmount = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of group.nodes) {
        const cx = n.x + n.width / 2;
        const cy = n.y + n.height / 2;
        sumX += cx;
        sumY += cy;
        sumAmount += n.amount;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
      aggNodes.push({
        id: `__lod-aggregate-${key}`,
        type: group.type,
        label: group.label,
        count: group.nodes.length,
        amount: sumAmount,
        cx: sumX / group.nodes.length,
        cy: sumY / group.nodes.length,
        bbox: { minX, minY, maxX, maxY },
      });
    }

    const filteredEdges: LayoutEdge[] = [];
    for (const edge of data.edges) {
      if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;

      // 委託チェーン重複エッジを除外（project→受託先の直接エッジが委託経由と重複）
      if (redundantEdgeSet.has(edge)) continue;

      // ハイライト中のエッジは面積LOD・TopN間引きをスキップして全表示
      const inHighlight = highlightMap.has(edge.source) && highlightMap.has(edge.target);
      if (!inHighlight) {
        // 8-3: エッジ面積ベースLOD（スクリーン上で小さすぎるエッジを間引き）
        const p = edge.path;
        const edgeScreenLength = Math.hypot(
          (p[p.length - 1][0] - p[0][0]) * k,
          (p[p.length - 1][1] - p[0][1]) * k,
        );
        const edgeScreenArea = edge.width * k * edgeScreenLength;
        if (edgeScreenArea < MIN_EDGE_SCREEN_AREA) continue;

        // TopNエッジ間引き
        if (!topEdgeSet.has(edge)) continue;
      }

      filteredEdges.push(edge);
    }

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug(`[sankey2] visibleNodes=${filteredNodes.length} visibleEdges=${filteredEdges.length} aggregates=${aggNodes.length} ${(performance.now() - _t0).toFixed(1)}ms`);
    }
    return { visibleNodes: filteredNodes, visibleEdges: filteredEdges, aggregateNodes: aggNodes };
  }, [data, transform, containerSize, ministryFilter, minAmount, maxAmount, labelFilter, topEdgeSet, highlightMap, redundantEdgeSet]);

  // ── 集約ノードクリック → bounding boxにズームイン ──

  const handleAggregateClick = useCallback((agg: AggregateNode) => {
    if (!containerRef.current) return;
    const { minX, minY, maxX, maxY } = agg.bbox;
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const cx = minX + bw / 2;
    const cy = minY + bh / 2;
    const cw = Math.max(1, containerRef.current.clientWidth - (selectedNodeId ? PANEL_WIDTH : 0));
    const ch = Math.max(1, containerRef.current.clientHeight);
    const targetK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw / bw, ch / bh) * 0.85));
    setTransform({ x: cw / 2 - cx * targetK, y: ch / 2 - cy * targetK, k: targetK });
  }, [selectedNodeId]);

  // ── ノードクリック ──

  const handleNodeClick = useCallback((nodeId: string) => {
    if (didPanRef.current) return;
    shouldPushRef.current = true;
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId);
  }, []);

  // ── パネル内接続先クリック → 選択切替 + ズーム移動 ──

  const handlePanelNodeClick = useCallback((nodeId: string) => {
    shouldPushRef.current = true;
    setSelectedNodeId(nodeId);
    setShowSearchResults(false);
    const node = nodeMap.get(nodeId);
    if (!node || !containerRef.current) return;

    // 現在のZoomでノードがスクリーン上で視認可能か判定（4×4px相当以上）
    const nodeArea = (node.area ?? node.width * node.height);
    const screenArea = nodeArea * transform.k * transform.k;
    if (screenArea >= MIN_SCREEN_AREA * 16) return;

    // 視認不可 → Fitと同じロジック（接続ノード含むバウンディングボックス）
    let minX = node.x, minY = node.y;
    let maxX = node.x + node.width, maxY = node.y + node.height;
    for (const edge of edgeIndex.bySource.get(nodeId) ?? []) {
      const t = nodeMap.get(edge.target);
      if (t) { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x + t.width); maxY = Math.max(maxY, t.y + t.height); }
    }
    for (const edge of edgeIndex.byTarget.get(nodeId) ?? []) {
      const s = nodeMap.get(edge.source);
      if (s) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.width); maxY = Math.max(maxY, s.y + s.height); }
    }

    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const cx = minX + bw / 2;
    const cy = minY + bh / 2;
    const cw = Math.max(1, containerRef.current.clientWidth - PANEL_WIDTH);
    const ch = Math.max(1, containerRef.current.clientHeight);
    const targetK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw / bw, ch / bh) * 0.85));

    setTransform({ x: cw / 2 - cx * targetK, y: ch / 2 - cy * targetK, k: targetK });
  }, [nodeMap, edgeIndex, transform.k]);

  // ── Wheel zoom ──

  // 8-4A: rAFバッチ化 — 高頻度wheelイベントを60FPSに制限
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const base = pendingTransformRef.current ?? transformRef.current;
      const factor = 1 - e.deltaY * ZOOM_SENSITIVITY;
      const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.k * factor));
      const ratio = newK / base.k;
      pendingTransformRef.current = {
        x: mx - (mx - base.x) * ratio,
        y: my - (my - base.y) * ratio,
        k: newK,
      };

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingTransformRef.current) {
            setTransform(pendingTransformRef.current);
            pendingTransformRef.current = null;
          }
          rafIdRef.current = 0;
        });
      }
    };

    svg.addEventListener('wheel', handler, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handler);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [data]);

  const didPanRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    didPanRef.current = false;
    panStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPanRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // ── SVG背景クリックで選択解除（Pan後は無視） ──

  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    if (didPanRef.current) return;
    if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('bg-rect')) {
      shouldPushRef.current = true;
      setSelectedNodeId(null);
    }
  }, []);

  // ── Minimap描画 ──

  const minimapHeight = useMemo(() => {
    if (!data) return 0;
    const { totalWidth, totalHeight } = data.metadata.layout;
    return Math.round(MINIMAP_WIDTH * (totalHeight / totalWidth));
  }, [data]);

  // 8-4B: Minimap背景を初回のみ描画してキャッシュ
  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || !data || !minimapHeight) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { totalWidth } = data.metadata.layout;
    const scale = MINIMAP_WIDTH / totalWidth;

    ctx.clearRect(0, 0, MINIMAP_WIDTH, minimapHeight);

    // クラスタ背景
    const { clusterWidth, clusterHeight, clusterGap } = data.metadata.layout;
    for (let i = 0; i < 5; i++) {
      const cx = (clusterWidth + clusterGap) * i * scale;
      const cw = clusterWidth * scale;
      const ch = clusterHeight * scale;
      ctx.fillStyle = 'rgba(100, 116, 139, 0.15)';
      ctx.fillRect(cx, 0, cw, ch);
    }

    // 背景をキャッシュ
    minimapBgRef.current = ctx.getImageData(0, 0, MINIMAP_WIDTH, minimapHeight);
  }, [data, minimapHeight]);

  // 8-4B: ビューポート矩形のみ再描画（transform変更時）
  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || !data || !minimapBgRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 背景をキャッシュから復元（全体再描画を回避）
    ctx.putImageData(minimapBgRef.current, 0, 0);

    const { totalWidth, totalHeight } = data.metadata.layout;
    const scale = MINIMAP_WIDTH / totalWidth;

    // ビューポート矩形
    const { k, x: tx, y: ty } = transform;
    const { w: cw, h: ch } = containerSize;
    const vpX = (-tx / k) * scale;
    const vpY = (-ty / k) * scale;
    const vpW = (cw / k) * scale;
    const vpH = (ch / k) * scale;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.max(0, vpX),
      Math.max(0, vpY),
      Math.min(vpW, totalWidth * scale - Math.max(0, vpX)),
      Math.min(vpH, totalHeight * scale - Math.max(0, vpY)),
    );
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fillRect(
      Math.max(0, vpX),
      Math.max(0, vpY),
      Math.min(vpW, totalWidth * scale - Math.max(0, vpX)),
      Math.min(vpH, totalHeight * scale - Math.max(0, vpY)),
    );
  }, [data, transform, containerSize, minimapHeight]);

  // ── Zoomコントロール ──

  const handleZoomFit = useCallback(() => {
    if (!data || !containerRef.current) return;
    const { totalWidth, totalHeight } = data.metadata.layout;
    const cw = containerRef.current.clientWidth - (selectedNodeId ? PANEL_WIDTH : 0);
    const ch = containerRef.current.clientHeight;
    const k = Math.min(cw / totalWidth, ch / totalHeight) * 0.9;
    setTransform({ x: (cw - totalWidth * k) / 2, y: (ch - totalHeight * k) / 2, k });
  }, [data, selectedNodeId]);

  const handleZoomIn = useCallback(() => {
    setTransform(prev => {
      const cw = containerRef.current?.clientWidth ?? 0;
      const ch = containerRef.current?.clientHeight ?? 0;
      const newK = Math.min(MAX_ZOOM, prev.k * 1.5);
      const ratio = newK / prev.k;
      return { x: cw / 2 - (cw / 2 - prev.x) * ratio, y: ch / 2 - (ch / 2 - prev.y) * ratio, k: newK };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform(prev => {
      const cw = containerRef.current?.clientWidth ?? 0;
      const ch = containerRef.current?.clientHeight ?? 0;
      const newK = Math.max(MIN_ZOOM, prev.k / 1.5);
      const ratio = newK / prev.k;
      return { x: cw / 2 - (cw / 2 - prev.x) * ratio, y: ch / 2 - (ch / 2 - prev.y) * ratio, k: newK };
    });
  }, []);

  /** 指定倍率にズーム（画面中心を基準） */
  const handleZoomTo = useCallback((newK: number) => {
    setTransform(prev => {
      const cw = containerRef.current?.clientWidth ?? 0;
      const ch = containerRef.current?.clientHeight ?? 0;
      const clampedK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newK));
      const ratio = clampedK / prev.k;
      return { x: cw / 2 - (cw / 2 - prev.x) * ratio, y: ch / 2 - (ch / 2 - prev.y) * ratio, k: clampedK };
    });
  }, []);

  /** Fit: Activeノード + 接続ノードがすべて見えるZoom */
  const handleZoomFitActive = useCallback(() => {
    if (!activeNodeId || !containerRef.current) return;
    const node = nodeMap.get(activeNodeId);
    if (!node) return;

    // 接続ノードのバウンディングボックスを計算
    let minX = node.x, minY = node.y;
    let maxX = node.x + node.width, maxY = node.y + node.height;
    for (const edge of edgeIndex.bySource.get(activeNodeId) ?? []) {
      const t = nodeMap.get(edge.target);
      if (t) { minX = Math.min(minX, t.x); minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x + t.width); maxY = Math.max(maxY, t.y + t.height); }
    }
    for (const edge of edgeIndex.byTarget.get(activeNodeId) ?? []) {
      const s = nodeMap.get(edge.source);
      if (s) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.width); maxY = Math.max(maxY, s.y + s.height); }
    }

    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const cx = minX + bw / 2;
    const cy = minY + bh / 2;
    const cw = Math.max(1, containerRef.current.clientWidth - (selectedNodeId ? PANEL_WIDTH : 0));
    const ch = Math.max(1, containerRef.current.clientHeight);
    const targetK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw / bw, ch / bh) * 0.85));

    setTransform({ x: cw / 2 - cx * targetK, y: ch / 2 - cy * targetK, k: targetK });
  }, [activeNodeId, nodeMap, edgeIndex, selectedNodeId]);

  /** Focus: Activeノード単体を画面中央に */
  const handleZoomFocusActive = useCallback(() => {
    const node = activeNodeId ? nodeMap.get(activeNodeId) : undefined;
    if (!node || !containerRef.current) return;
    const cw = Math.max(1, containerRef.current.clientWidth - (selectedNodeId ? PANEL_WIDTH : 0));
    const ch = Math.max(1, containerRef.current.clientHeight);
    const screenTarget = Math.max(1, Math.min(cw, ch) / 4);
    const nodeSide = Math.max(node.width, node.height, 1);
    const targetK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, screenTarget / nodeSide));
    setTransform({
      x: cw / 2 - (node.x + node.width / 2) * targetK,
      y: ch / 2 - (node.y + node.height / 2) * targetK,
      k: targetK,
    });
  }, [activeNodeId, nodeMap, selectedNodeId]);

  // ── Minimapクリック → ビューポート移動 ──

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { totalWidth } = data.metadata.layout;
    const scale = MINIMAP_WIDTH / totalWidth;
    const { w: cw, h: ch } = containerSize;
    const { k } = transform;

    const worldX = mx / scale;
    const worldY = my / scale;

    setTransform(prev => ({
      ...prev,
      x: cw / 2 - worldX * k,
      y: ch / 2 - worldY * k,
    }));
  }, [data, containerSize, transform]);

  // ── 描画 ──

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400 text-lg">読み込み中...</div>
      </div>
    );
  }

  const k2 = transform.k * transform.k;
  // ノード表示閾値金額: この金額以下のノードはLODで非表示
  // amount = MIN_SCREEN_AREA × totalAmount / (CLUSTER_AREA × k² × GAP_FACTOR)
  const TOTAL_AMOUNT = 151_123_034_375_145;
  const CLUSTER_AREA = 4000 * 4000;
  const GAP_FACTOR = 0.64; // (1 - 0.2)²
  const thresholdAmount = Math.round(MIN_SCREEN_AREA * TOTAL_AMOUNT / (CLUSTER_AREA * k2 * GAP_FACTOR));
  const showPanel = selectedNodeId !== null;
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : undefined;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-gray-50 dark:bg-gray-950 select-none flex"
    >
      {/* SVG領域 */}
      <div
        className="relative flex-1 h-full overflow-hidden"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {/* ヘッダー情報 + 検索 + フィルタ */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2" style={{ maxWidth: 320 }}>
          {/* 統計情報 */}
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs text-gray-600 dark:text-gray-300 shadow-sm backdrop-blur-sm">
            <div className="font-semibold mb-1">/sankey2 予算フロー</div>
            <div>描画: {visibleNodes.length.toLocaleString()} nodes / {visibleEdges.length.toLocaleString()} edges</div>
            <div>Zoom: {(transform.k * 100).toFixed(0)}% （≥{formatAmount(thresholdAmount)}）</div>
            {isShiftHeld && <div className="text-blue-500 font-semibold mt-1">Shift: BFS {BFS_MAX_DEPTH}ホップ</div>}
            {minAmount > 0 && <div className="text-orange-500 mt-0.5">最小金額: {formatAmount(minAmount)}</div>}
            {maxAmount < Infinity && <div className="text-orange-500 mt-0.5">最大金額: {formatAmount(maxAmount)}</div>}
            {labelFilter && <div className="text-green-500 mt-0.5">名前: &quot;{labelFilter}&quot;</div>}
            {ministryFilter.size > 0 && <div className="text-blue-500 mt-0.5">府省庁: {ministryFilter.size}件選択</div>}
          </div>

          {/* 検索バー */}
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true); }}
              onFocus={() => { if (debouncedQuery.length >= 2) setShowSearchResults(true); }}
              placeholder="ノード検索（2文字以上）"
              className="w-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 shadow-sm border border-gray-200 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-400"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setDebouncedQuery(''); setShowSearchResults(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >✕</button>
            )}
            {/* 検索結果ドロップダウン */}
            {showSearchResults && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto z-30">
                {searchResults.map(node => (
                  <button
                    key={node.id}
                    onClick={() => {
                      setShowSearchResults(false);
                      handlePanelNodeClick(node.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm"
                  >
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: TYPE_COLORS[node.type] || '#999' }} />
                    <span className="truncate flex-1 text-gray-800 dark:text-gray-200">{node.label}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatAmount(node.amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* フィルタボタン群 */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowFilterPanel(prev => !prev)}
              className={`text-xs px-2.5 py-1.5 rounded-lg shadow-sm backdrop-blur-sm border transition-colors flex items-center gap-1 ${
                hasActiveFilter
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              フィルタ{hasActiveFilter ? ` (${activeFilterCount})` : ''}
            </button>
            {hasActiveFilter && (
              <button
                onClick={() => { shouldPushRef.current = true; setMinistryFilter(new Set()); setMinAmount(0); setMaxAmount(Infinity); setLabelFilter(''); }}
                className="text-xs px-2 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 text-red-500 border border-gray-200 dark:border-gray-700 shadow-sm backdrop-blur-sm hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                リセット
              </button>
            )}
          </div>

          {/* フィルタパネル */}
          {showFilterPanel && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3 max-h-[70vh] overflow-y-auto">
              {/* 金額範囲スライダー */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">金額範囲</div>
                <AmountSlider label="最小" value={minAmount} noValueLabel="なし" accent="blue" onChange={setMinAmount} isMax={false} />
                <div className="mt-2">
                  <AmountSlider label="最大" value={maxAmount} noValueLabel="なし" accent="orange" onChange={setMaxAmount} isMax={true} />
                </div>
              </div>

              {/* ノード名フィルタ */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">ノード名フィルタ</div>
                <input
                  type="text"
                  value={labelFilter}
                  onChange={e => setLabelFilter(e.target.value)}
                  placeholder="含む文字列..."
                  className="w-full text-xs bg-gray-50 dark:bg-gray-700 rounded px-2 py-1.5 border border-gray-200 dark:border-gray-600 outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 dark:text-gray-200"
                />
              </div>

              {/* 府省庁フィルタ */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">府省庁</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { shouldPushRef.current = true; setMinistryFilter(new Set(ministryList.map(n => n.label))); }}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >全選択</button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => { shouldPushRef.current = true; setMinistryFilter(new Set()); }}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >全解除</button>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {ministryList.map(m => (
                    <label key={m.id} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ministryFilter.has(m.label)}
                        onChange={e => {
                          shouldPushRef.current = true;
                          setMinistryFilter(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.label); else next.delete(m.label);
                            return next;
                          });
                        }}
                        className="accent-blue-500"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{m.label}</span>
                      <span className="text-[10px] text-gray-400">{formatAmount(m.amount)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 凡例 */}
        <div className="absolute top-3 right-3 z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 mb-0.5 last:mb-0">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-gray-700 dark:text-gray-300">{TYPE_LABELS[type] ?? type}</span>
            </div>
          ))}
        </div>

        {/* Zoomコントロール */}
        <div
          className="absolute z-10 flex flex-col gap-1"
          style={{ bottom: MINIMAP_PADDING + minimapHeight + 8, left: MINIMAP_PADDING }}
        >
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm flex flex-col overflow-hidden" style={{ width: 44 }}>
            <button onClick={handleZoomIn} className="px-2.5 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" title="ズームイン">＋</button>
            {/* Zoomスライダー（対数スケール） */}
            <div className="px-1 py-1 flex justify-center border-y border-gray-200 dark:border-gray-700">
              <input
                type="range"
                min={Math.log10(MIN_ZOOM)}
                max={Math.log10(MAX_ZOOM)}
                step={0.01}
                value={Math.log10(transform.k)}
                onChange={e => handleZoomTo(Math.pow(10, parseFloat(e.target.value)))}
                className="h-20 accent-gray-500"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16 }}
                title={`Zoom: ${(transform.k * 100).toFixed(0)}%`}
              />
            </div>
            <button onClick={handleZoomOut} className="px-2.5 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" title="ズームアウト">ー</button>
          </div>
          {/* Zoom率 直接入力 */}
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm overflow-hidden" style={{ width: 44 }}>
            {isEditingZoom ? (
              <input
                type="text"
                autoFocus
                value={zoomInputValue}
                onChange={e => setZoomInputValue(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(zoomInputValue);
                  if (!isNaN(v) && v > 0) handleZoomTo(v / 100);
                  setIsEditingZoom(false);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(zoomInputValue);
                    if (!isNaN(v) && v > 0) handleZoomTo(v / 100);
                    setIsEditingZoom(false);
                  } else if (e.key === 'Escape') {
                    setIsEditingZoom(false);
                  }
                }}
                className="w-full text-[10px] text-center py-1 bg-transparent text-gray-700 dark:text-gray-200 outline-none"
              />
            ) : (
              <button
                onClick={() => { setZoomInputValue((transform.k * 100).toFixed(0)); setIsEditingZoom(true); }}
                className="w-full text-[10px] text-center py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-text"
                title="クリックしてZoom率を直接入力"
              >
                {(transform.k * 100).toFixed(0)}%
              </button>
            )}
          </div>
          {/* 表示閾値金額 */}
          <div
            className="bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm text-[9px] text-center text-gray-400 dark:text-gray-500 py-1 px-1 leading-tight"
            style={{ width: 44 }}
            title={`現在のZoomで表示可能な最小ノード金額（概算）: ${formatAmount(thresholdAmount)}`}
          >
            <div>≥</div>
            <div>{formatAmount(thresholdAmount)}</div>
          </div>
          <button onClick={handleZoomFit} className="bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm px-2 py-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center" style={{ width: 44 }} title="全体表示">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
          <div className="bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm flex flex-col overflow-hidden" style={{ width: 44 }}>
            <button onClick={handleZoomFitActive} className={`px-2 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-center ${activeNodeId ? 'text-blue-500' : 'text-gray-400 dark:text-gray-600'}`} title="接続ノードを含めてフィット" disabled={!activeNodeId}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
            </button>
            <button onClick={handleZoomFocusActive} className={`px-2 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-center border-t border-gray-200 dark:border-gray-700 ${activeNodeId ? 'text-blue-500' : 'text-gray-400 dark:text-gray-600'}`} title="選択ノードにフォーカス" disabled={!activeNodeId}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>
            </button>
          </div>
        </div>

        {/* Minimap */}
        <div
          className="absolute z-10 bg-white/90 dark:bg-gray-800/90 rounded-lg shadow-sm backdrop-blur-sm overflow-hidden"
          style={{ bottom: MINIMAP_PADDING, left: MINIMAP_PADDING }}
        >
          <canvas
            ref={minimapCanvasRef}
            width={MINIMAP_WIDTH}
            height={minimapHeight}
            className="cursor-crosshair block"
            onClick={handleMinimapClick}
          />
        </div>

        {/* 8-1: FPSカウンター（開発時のみ） */}
        {process.env.NODE_ENV === 'development' && (
          <div
            className="absolute z-10 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono"
            style={{ bottom: MINIMAP_PADDING, right: MINIMAP_PADDING }}
          >
            {fps} FPS
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleSvgClick}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {/* ズームで表示されるノードのエリア背景塗り（ホバー検知もここ） */}
            <g className="aggregate-bg">
            {aggregateNodes.map(agg => {
              const { minX, minY, maxX, maxY } = agg.bbox;
              const color = TYPE_COLORS[agg.type] || '#999';
              return (
                <rect
                  key={agg.id}
                  x={minX}
                  y={minY}
                  width={maxX - minX}
                  height={maxY - minY}
                  fill={color}
                  fillOpacity={0.1}
                  stroke="none"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredAggId(agg.id)}
                  onMouseLeave={() => setHoveredAggId(prev => prev === agg.id ? null : prev)}
                  onClick={() => handleAggregateClick(agg)}
                />
              );
            })}
            </g>

            {/* エッジ描画（pointer-events:none で集約ノードホバーを妨げない） */}
            <g className="edges" style={{ pointerEvents: 'none' }}>
              {visibleEdges.map((edge, i) => {
                const srcDist = highlightMap.get(edge.source);
                const tgtDist = highlightMap.get(edge.target);
                const edgeConnected = srcDist !== undefined && tgtDist !== undefined;
                const edgeDepth = edgeConnected ? Math.max(srcDist, tgtDist) : -1;

                return (
                  <MemoEdgeLine
                    key={`${edge.source}-${edge.target}-${i}`}
                    edge={edge}
                    isHighlighting={isHighlighting}
                    isConnected={edgeConnected}
                    depthOpacity={edgeConnected ? (DEPTH_OPACITY[edgeDepth] ?? 0.3) : 0}
                  />
                );
              })}
            </g>

            {/* ノード矩形 */}
            <g className="node-rects">
              {visibleNodes.map(node => {
                const depth = highlightMap.get(node.id);
                const handlers = hoverHandlers.get(node.id);
                return (
                  <MemoNodeRect
                    key={node.id}
                    node={node}
                    zoom={transform.k}
                    isHighlighting={isHighlighting}
                    isConnected={depth !== undefined}
                    isHovered={hoveredNodeId === node.id}
                    isSelected={selectedNodeId === node.id}
                    depthOpacity={depth !== undefined ? (DEPTH_OPACITY[depth] ?? 0.3) : 0}
                    onHoverStart={handlers?.start ?? noop}
                    onHoverEnd={handlers?.end ?? noop}
                    onClick={handleNodeClick}
                  />
                );
              })}
            </g>

            {/* ラベル */}
            <g className="node-labels">
              {visibleNodes.map(node => {
                const screenArea = (node.area ?? node.width * node.height) * k2;
                const isActive = hoveredNodeId === node.id || selectedNodeId === node.id;
                if (!isActive && screenArea < LABEL_SCREEN_AREA) return null;

                const screenW = node.width * transform.k;
                const screenH = node.height * transform.k;
                if (!isActive && (screenW < 20 || screenH < 10)) return null;

                const maxFontInLayout = 48 / transform.k; // 画面上最大48px
                const fontSize = Math.min(node.height * 0.25, node.width * 0.18, maxFontInLayout);
                if (!isActive && fontSize * transform.k < 6) return null;

                const depth = highlightMap.get(node.id);
                const opacity = isHighlighting
                  ? (depth !== undefined ? (DEPTH_OPACITY[depth] ?? 0.3) : 0.08)
                  : 1;

                // 6-2: screenArea段階表示
                // hover/selected中は常に全情報表示
                const showAmount = isActive || screenArea >= 2000;
                const showBadge = isActive || screenArea >= 8000;
                const subFontSize = fontSize * 0.6;

                return (
                  <foreignObject
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    opacity={opacity}
                    overflow="hidden"
                    style={{ pointerEvents: 'none' }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        color: '#fff',
                        textShadow: '0 0 3px rgba(0,0,0,0.9)',
                        textAlign: 'center',
                        overflow: 'hidden',
                        padding: `${fontSize * 0.1}px`,
                      }}
                    >
                      <div style={{ fontSize: `${fontSize}px`, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {node.label}
                      </div>
                      {showAmount && (
                        <div style={{ fontSize: `${subFontSize}px`, lineHeight: 1.2, opacity: 0.85, marginTop: `${fontSize * 0.05}px` }}>
                          {formatAmount(node.amount)}
                        </div>
                      )}
                      {showBadge && node.ministry && node.type !== 'ministry' && (
                        <div style={{ fontSize: `${subFontSize}px`, lineHeight: 1.2, opacity: 0.7, marginTop: `${fontSize * 0.03}px` }}>
                          {node.ministry}
                        </div>
                      )}
                      {showBadge && (
                        <div style={{
                          fontSize: `${subFontSize * 0.85}px`,
                          lineHeight: 1,
                          marginTop: `${fontSize * 0.05}px`,
                          backgroundColor: TYPE_COLORS[node.type] || '#999',
                          padding: `${subFontSize * 0.1}px ${subFontSize * 0.3}px`,
                          borderRadius: `${subFontSize * 0.2}px`,
                          opacity: 0.9,
                        }}>
                          {TYPE_LABELS[node.type] ?? node.type}
                        </div>
                      )}
                    </div>
                  </foreignObject>
                );
              })}
            {/* 集約ノードのホバーラベル（最前面・イベント透過） */}
            <g style={{ pointerEvents: 'none' }}>
            {aggregateNodes.map(agg => {
              if (hoveredAggId !== agg.id) return null;
              const { minX, minY, maxX, maxY } = agg.bbox;
              const bw = maxX - minX;
              const bh = maxY - minY;
              const fontSize = 11 / transform.k;
              const pad = fontSize * 0.5;
              const color = TYPE_COLORS[agg.type] || '#999';
              const labelW = fontSize * 12;
              const labelH = fontSize * 3.2;
              return (
                <g
                  key={agg.id}
                  transform={`translate(${minX},${minY})`}
                >
                  <rect
                    x={bw - labelW - pad}
                    y={bh - labelH - pad}
                    width={labelW}
                    height={labelH}
                    fill={color}
                    fillOpacity={0.85}
                    rx={fontSize * 0.3}
                  />
                  <text
                    x={bw - labelW / 2 - pad}
                    y={bh - labelH + fontSize * 0.9 - pad}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={fontSize * 0.9}
                  >
                    {agg.label}
                  </text>
                  <text
                    x={bw - labelW / 2 - pad}
                    y={bh - fontSize * 1.1 - pad}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={fontSize}
                    fontWeight="bold"
                  >
                    {`+${agg.count.toLocaleString()}件 ${formatAmount(agg.amount)}`}
                  </text>
                </g>
              );
            })}
            </g>


            </g>
          </g>

          {/* ノードツールチップ（transformグループ外・スクリーン座標で描画） */}
          {hoveredNodeId && (() => {
            const node = nodeMap.get(hoveredNodeId);
            if (!node) return null;
            const tipFontSize = 11; // スクリーンpx固定
            // ノード内ラベルのフォントサイズ（スクリーンpx換算）
            const nodeLabelScreenFont = Math.min(node.height * 0.25, node.width * 0.18, 48 / transform.k) * transform.k;
            // ノード内ラベルがツールチップ以上のサイズで、テキストがノード幅に収まっている場合はツールチップ不要
            const nodeScreenW = node.width * transform.k;
            const textFitsInNode = nodeLabelScreenFont >= tipFontSize
              && node.label.length * nodeLabelScreenFont * 0.6 <= nodeScreenW;
            if (textFitsInNode) return null;
            const color = TYPE_COLORS[node.type] || '#999';
            const tipW = 200;
            const tipH = 80;
            // ノード中央上にスクリーン座標で配置
            const screenCx = node.x * transform.k + transform.x + nodeScreenW / 2;
            const screenTop = node.y * transform.k + transform.y;
            const lx = screenCx - tipW / 2;
            const ly = screenTop - tipH - 6;
            return (
              <foreignObject
                x={lx}
                y={ly}
                width={tipW}
                height={tipH}
                overflow="visible"
              >
                <div
                  style={{
                    background: color,
                    opacity: 0.92,
                    borderRadius: 4,
                    padding: '5px 8px',
                    color: '#fff',
                    textAlign: 'center',
                    fontSize: tipFontSize,
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                    border: '1.5px solid rgba(255,255,255,0.6)',
                  }}
                  onMouseEnter={() => {
                    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null; }
                  }}
                  onMouseLeave={() => {
                    hoverTimeoutRef.current = setTimeout(() => setHoveredNodeId(null), 120);
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{node.label}</div>
                  <div style={{ fontSize: tipFontSize * 0.9 }}>{formatAmount(node.amount)}</div>
                  {node.ministry && node.type !== 'ministry' && (
                    <div style={{ fontSize: tipFontSize * 0.8, opacity: 0.8 }}>{node.ministry}</div>
                  )}
                </div>
              </foreignObject>
            );
          })()}
        </svg>
      </div>

      {/* サイドパネル */}
      {showPanel && selectedNode && (
        <DetailPanel
          node={selectedNode}
          edgeIndex={edgeIndex}
          nodeMap={nodeMap}
          subcontractChains={data?.subcontractChains}
          onClose={() => setSelectedNodeId(null)}
          onNodeClick={handlePanelNodeClick}
        />
      )}
    </div>
  );
}

// ─── noop ──────────────────────────────────────────────

const noop = () => {};

// ─── サイドパネル ──────────────────────────────────────

interface DetailPanelProps {
  node: LayoutNode;
  edgeIndex: EdgeIndex;
  nodeMap: Map<string, LayoutNode>;
  subcontractChains?: SubcontractChain[];
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

function DetailPanel({ node, edgeIndex, nodeMap, subcontractChains, onClose, onNodeClick }: DetailPanelProps) {
  const inEdges = (edgeIndex.byTarget.get(node.id) ?? [])
    .slice()
    .sort((a, b) => b.value - a.value);
  const outEdges = (edgeIndex.bySource.get(node.id) ?? [])
    .slice()
    .sort((a, b) => b.value - a.value);

  // 委託経由の重複エッジを除外:
  // project→委託元→当ノードのチェーンがある場合、project→当ノードの直接エッジは冗長
  const subcontractSourceIds = new Set(
    inEdges.filter(e => e.edgeType === 'subcontract').map(e => e.source)
  );
  const directInEdges = inEdges.filter(e => {
    if (e.edgeType === 'subcontract') return false;
    // この事業(source)が委託元にも流入している場合は重複
    for (const subSourceId of subcontractSourceIds) {
      const subSourceInEdges = edgeIndex.byTarget.get(subSourceId) ?? [];
      if (subSourceInEdges.some(se => se.source === e.source)) return false;
    }
    return true;
  });

  const color = TYPE_COLORS[node.type] || '#999';
  const hasSubcontract = node.isIndirect
    || inEdges.some(e => e.edgeType === 'subcontract')
    || outEdges.some(e => e.edgeType === 'subcontract');

  return (
    <div
      className="h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto select-text"
      style={{ width: PANEL_WIDTH, minWidth: PANEL_WIDTH }}
    >
      {/* ヘッダー */}
      <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-gray-900 dark:text-gray-100 break-all leading-tight">
              {node.label}
            </div>
            <div className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-1">
              {formatAmount(node.amount)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none p-1"
          >
            ✕
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {TYPE_LABELS[node.type] ?? node.type}
          </span>
          {hasSubcontract && (
            <span
              className="inline-block px-2 py-0.5 rounded text-xs font-medium text-gray-900"
              style={{ backgroundColor: '#f59e0b' }}
            >
              再委託
            </span>
          )}
          {node.ministry && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{node.ministry}</span>
          )}
        </div>
      </div>

      {/* 流入元（通常・委託元と重複しないもの） */}
      <ConnectionList
        title="流入元"
        arrow="←"
        edges={directInEdges}
        getNodeId={e => e.source}
        nodeMap={nodeMap}
        onNodeClick={onNodeClick}
      />

      {/* 委託元（再委託の流入・事業別グループ） */}
      <SubcontractGroupList
        title="委託元"
        arrow="←"
        edges={inEdges.filter(e => e.edgeType === 'subcontract')}
        getNodeId={e => e.source}
        nodeMap={nodeMap}
        edgeIndex={edgeIndex}
        selectedNode={node}
        direction="in"
        onNodeClick={onNodeClick}
      />

      {/* 資金の流れ（project-spending: 直接支出+再委託統合 / それ以外: 流出先） */}
      {node.type === 'project-spending' && node.projectId !== undefined && subcontractChains ? (
        <SubcontractChainTree
          projectId={node.projectId}
          chains={subcontractChains}
          directOutEdges={outEdges.filter(e => e.edgeType !== 'subcontract')}
          nodeMap={nodeMap}
          onNodeClick={onNodeClick}
        />
      ) : (
        <>
          <ConnectionList
            title="流出先"
            arrow="→"
            edges={outEdges.filter(e => e.edgeType !== 'subcontract')}
            getNodeId={e => e.target}
            nodeMap={nodeMap}
            onNodeClick={onNodeClick}
          />
          <SubcontractGroupList
            title="委託先"
            arrow="→"
            edges={outEdges.filter(e => e.edgeType === 'subcontract')}
            getNodeId={e => e.target}
            nodeMap={nodeMap}
            edgeIndex={edgeIndex}
            selectedNode={node}
            direction="out"
            onNodeClick={onNodeClick}
          />
        </>
      )}
    </div>
  );
}

interface ConnectionListProps {
  title: string;
  arrow: string;
  edges: LayoutEdge[];
  getNodeId: (e: LayoutEdge) => string;
  nodeMap: Map<string, LayoutNode>;
  onNodeClick: (nodeId: string) => void;
}

function ConnectionList({ title, arrow, edges, getNodeId, nodeMap, onNodeClick }: ConnectionListProps) {
  if (edges.length === 0) return null;

  const shown = edges.slice(0, PANEL_MAX_CONNECTIONS);
  const remaining = edges.length - shown.length;

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
        {arrow} {title}（{edges.length}件）
      </div>
      <div className="space-y-1">
        {shown.map((edge, i) => {
          const targetId = getNodeId(edge);
          const targetNode = nodeMap.get(targetId);
          const color = targetNode ? (TYPE_COLORS[targetNode.type] || '#999') : '#999';
          return (
            <button
              key={`${targetId}-${i}`}
              onClick={() => onNodeClick(targetId)}
              className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            >
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {targetNode?.label ?? targetId}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                {formatAmount(edge.value)}
              </span>
            </button>
          );
        })}
      </div>
      {remaining > 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 pl-2">
          …他 {remaining.toLocaleString()} 件
        </div>
      )}
    </div>
  );
}

// ─── 委託グループ表示（事業別） ──────────────────────────────

interface SubcontractGroupListProps {
  title: string;
  arrow: string;
  edges: LayoutEdge[];
  getNodeId: (e: LayoutEdge) => string;
  nodeMap: Map<string, LayoutNode>;
  edgeIndex: EdgeIndex;
  selectedNode: LayoutNode;
  direction: 'in' | 'out';
  onNodeClick: (nodeId: string) => void;
}

function SubcontractGroupList({
  title, arrow, edges, getNodeId, nodeMap, edgeIndex, selectedNode, direction, onNodeClick,
}: SubcontractGroupListProps) {
  if (edges.length === 0) return null;

  // 委託元/委託先ノードが接続している事業を特定してグループ化
  type GroupEntry = { edge: LayoutEdge; nodeId: string; node: LayoutNode | undefined };
  const groups = new Map<string, { projectNode: LayoutNode | undefined; entries: GroupEntry[] }>();

  for (const edge of edges) {
    const counterpartId = getNodeId(edge);
    const counterpart = nodeMap.get(counterpartId);

    // 委託元/委託先の接続元事業を探す
    let projectLabel = '不明な事業';
    let projectNode: LayoutNode | undefined;

    // サブコントラクトエッジのprojectIdsから事業ノードを直接特定
    if (edge.projectIds && edge.projectIds.length > 0) {
      // 最大金額の事業を代表として使用
      let bestNode: LayoutNode | undefined;
      let bestAmount = -1;
      for (const pid of edge.projectIds) {
        const psId = `project-spending-${pid}`;
        const psNode = nodeMap.get(psId);
        if (psNode && psNode.amount > bestAmount) {
          bestNode = psNode;
          bestAmount = psNode.amount;
        }
      }
      projectNode = bestNode;
    } else if (direction === 'in') {
      // フォールバック: 委託元ノードへの流入元事業を探す
      const counterpartInEdges = edgeIndex.byTarget.get(counterpartId) ?? [];
      const selectedInSources = new Set(
        (edgeIndex.byTarget.get(selectedNode.id) ?? []).map(e => e.source)
      );
      const sharedProject = counterpartInEdges.find(e =>
        e.edgeType !== 'subcontract' && selectedInSources.has(e.source)
      );
      if (sharedProject) {
        projectNode = nodeMap.get(sharedProject.source);
      } else if (counterpartInEdges.length > 0) {
        const directIn = counterpartInEdges.find(e => e.edgeType !== 'subcontract');
        projectNode = directIn ? nodeMap.get(directIn.source) : undefined;
      }
    } else {
      // フォールバック: 選択中ノードへの流入元事業を探す
      const selectedInEdges = edgeIndex.byTarget.get(selectedNode.id) ?? [];
      const counterpartInEdges = edgeIndex.byTarget.get(counterpartId) ?? [];
      const counterpartSources = new Set(counterpartInEdges.map(e => e.source));
      const sharedProject = selectedInEdges.find(e =>
        e.edgeType !== 'subcontract' && counterpartSources.has(e.source)
      );
      if (sharedProject) {
        projectNode = nodeMap.get(sharedProject.source);
      } else if (selectedInEdges.length > 0) {
        const directIn = selectedInEdges.find(e => e.edgeType !== 'subcontract');
        projectNode = directIn ? nodeMap.get(directIn.source) : undefined;
      }
    }

    if (projectNode) projectLabel = projectNode.label;
    const groupKey = projectNode?.id ?? '_unknown';
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { projectNode, entries: [] });
    }
    groups.get(groupKey)!.entries.push({ edge, nodeId: counterpartId, node: counterpart });
  }

  // 事業グループを金額降順でソート
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const aTotal = a[1].entries.reduce((s, e) => s + e.edge.value, 0);
    const bTotal = b[1].entries.reduce((s, e) => s + e.edge.value, 0);
    return bTotal - aTotal;
  });

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
        {arrow} {title}（{edges.length}件）
      </div>
      {sortedGroups.map(([groupKey, { projectNode, entries }]) => {
        const groupTotal = entries.reduce((s, e) => s + e.edge.value, 0);
        const shown = entries.slice(0, PANEL_MAX_CONNECTIONS);
        const remaining = entries.length - shown.length;
        return (
          <div key={groupKey} className="mb-2">
            <div className="flex items-center gap-1 mb-1">
              {projectNode ? (
                <button
                  onClick={() => onNodeClick(projectNode!.id)}
                  className="text-xs text-amber-700 dark:text-amber-400 font-medium truncate hover:underline"
                >
                  {projectNode.label}
                </button>
              ) : (
                <span className="text-xs text-gray-400 font-medium">不明な事業</span>
              )}
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatAmount(groupTotal)}
              </span>
            </div>
            <div className="space-y-1 pl-2">
              {shown.map((entry, i) => {
                const color = entry.node ? (TYPE_COLORS[entry.node.type] || '#999') : '#999';
                return (
                  <button
                    key={`${entry.nodeId}-${i}`}
                    onClick={() => onNodeClick(entry.nodeId)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                  >
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {entry.node?.label ?? entry.nodeId}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {formatAmount(entry.edge.value)}
                    </span>
                  </button>
                );
              })}
            </div>
            {remaining > 0 && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 pl-4">
                …他 {remaining.toLocaleString()} 件
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── メモ化サブコンポーネント ──────────────────────────────

interface NodeRectProps {
  node: LayoutNode;
  zoom: number;
  isHighlighting: boolean;
  isConnected: boolean;
  isHovered: boolean;
  isSelected: boolean;
  depthOpacity: number;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClick: (nodeId: string) => void;
}

const MemoNodeRect = React.memo(function NodeRect({
  node, zoom,
  isHighlighting, isConnected, isHovered, isSelected, depthOpacity,
  onHoverStart, onHoverEnd, onClick,
}: NodeRectProps) {
  const color = TYPE_COLORS[node.type] || '#999';
  const opacity = isHighlighting ? (isConnected ? depthOpacity : 0.08) : 1;
  const highlighted = isHovered || isSelected;

  return (
    <g
      opacity={opacity}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={(e) => { e.stopPropagation(); onClick(node.id); }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        fill={color}
        stroke={highlighted ? '#fff' : 'none'}
        strokeWidth={highlighted ? 2 / zoom : 0}
      />
    </g>
  );
});

interface EdgeLineProps {
  edge: LayoutEdge;
  isHighlighting: boolean;
  isConnected: boolean;
  depthOpacity: number;
}

const MemoEdgeLine = React.memo(function EdgeLine({ edge, isHighlighting, isConnected, depthOpacity }: EdgeLineProps) {
  const isSubcontract = edge.edgeType === 'subcontract';
  const opacity = isHighlighting ? (isConnected ? depthOpacity * 0.6 : 0.02) : (isSubcontract ? 0.15 : 0.04);
  const strokeColor = isConnected
    ? (isSubcontract ? '#f59e0b' : '#3b82f6')
    : '#9ca3af';

  return (
    <polyline
      points={pathToPolyline(edge.path)}
      fill="none"
      stroke={strokeColor}
      strokeWidth={Math.max(edge.width, 0.3)}
      opacity={opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(isSubcontract ? { strokeDasharray: '8 4' } : {})}
    />
  );
});

// ─── 再委託チェーンツリー ──────────────────────────────

interface SubcontractChainTreeProps {
  projectId: number;
  chains: SubcontractChain[];
  directOutEdges: LayoutEdge[];
  nodeMap: Map<string, LayoutNode>;
  onNodeClick: (nodeId: string) => void;
}

function SubcontractChainTree({ projectId, chains, directOutEdges, nodeMap, onNodeClick }: SubcontractChainTreeProps) {
  const chain = chains.find(c => c.projectId === projectId);

  // 直接支出の合計
  const directTotal = directOutEdges.reduce((sum, e) => sum + e.value, 0);
  // 再委託合計（blockChainのtargetブロック支出合計）
  const subcontractTotal = chain ? chain.blockChain.reduce((sum, bc) => sum + bc.amount, 0) : 0;

  // 支出先レコード数（直接支出 + 再委託の全recipients）
  const recipientCount = directOutEdges.length
    + (chain ? chain.blockChain.reduce((sum, bc) => sum + bc.recipients.length, 0) : 0);

  const hasBlockChain = chain && chain.blockChain.length > 0;
  const hasDirectBlocks = chain && chain.directBlocks.length > 0;
  if (directOutEdges.length === 0 && !hasBlockChain && !hasDirectBlocks) return null;

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
        → 資金の流れ（{recipientCount}件）
      </div>

      {/* 直接支出（ブロック単位） */}
      {(directOutEdges.length > 0 || (chain && chain.directBlocks.length > 0)) && (() => {
        // エッジをブロック単位でグルーピング
        type DirectEdgeWithBlock = { edge: LayoutEdge; block: string | undefined };
        const edgesWithBlock: DirectEdgeWithBlock[] = directOutEdges.map(edge => {
          const name = nodeMap.get(edge.target)?.label ?? edge.target.replace('recipient-', '');
          const block = chain?.directBlocks.find(db => db.recipients.includes(name))?.block;
          return { edge, block };
        });
        // ブロックごとにグルーピング（ブロックなし = undefined）
        const blockGroups = new Map<string | undefined, LayoutEdge[]>();
        for (const { edge, block } of edgesWithBlock) {
          const list = blockGroups.get(block) ?? [];
          list.push(edge);
          blockGroups.set(block, list);
        }
        // エッジのないdirectBlocksも空エントリとして追加
        if (chain) {
          for (const db of chain.directBlocks) {
            if (!blockGroups.has(db.block)) {
              blockGroups.set(db.block, []);
            }
          }
        }
        const sortedBlocks = [...blockGroups.entries()].sort((a, b) => {
          if (!a[0]) return 1; if (!b[0]) return -1;
          return a[0].localeCompare(b[0]);
        });
        return (
          <div className="mb-2">
            <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-1">
              直接支出 {formatAmount(directTotal)}
            </div>
            <div className="space-y-1">
              {sortedBlocks.map(([block, edges]) => (
                <DirectBlockGroup
                  key={block ?? '_none'}
                  block={block}
                  blockName={chain?.directBlocks.find(db => db.block === block)?.blockName}
                  edges={edges}
                  nodeMap={nodeMap}
                  onNodeClick={onNodeClick}
                />
              ))}
            </div>
          </div>
        );
      })()}

      {/* 再委託（blockChainベースで全ステップ表示） */}
      {hasBlockChain && (() => {
        const directBlockIds = new Set(chain.directBlocks.map(db => db.block));
        return (
        <div>
          <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-1">
            再委託 {formatAmount(subcontractTotal)}
          </div>
          <div className="space-y-2">
            {chain.blockChain.map((bc, i) => (
              <SubcontractStepNode
                key={`${bc.source}-${bc.target}-${i}`}
                step={{
                  sourceBlock: bc.source,
                  targetBlock: bc.target,
                  from: bc.sourceName,
                  to: bc.targetName,
                  amount: bc.amount,
                  recipients: bc.recipients,
                }}
                directBlockIds={directBlockIds}
                onNodeClick={onNodeClick}
              />
            ))}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

const DIRECT_BLOCK_MAX_COLLAPSED = 4;

interface DirectBlockGroupProps {
  block: string | undefined;
  blockName: string | undefined;
  edges: LayoutEdge[];
  nodeMap: Map<string, LayoutNode>;
  onNodeClick: (nodeId: string) => void;
}

function DirectBlockGroup({ block, blockName, edges, nodeMap, onNodeClick }: DirectBlockGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const sorted = edges.slice().sort((a, b) => b.value - a.value);
  const blockTotal = sorted.reduce((sum, e) => sum + e.value, 0);

  // エッジが0件のブロック（支出データなし）
  if (sorted.length === 0 && block) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 py-0.5">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 font-semibold text-[10px] flex-shrink-0">
          {block}
        </span>
        <span className="truncate">{blockName ?? block}</span>
        <span className="flex-shrink-0 ml-auto">{formatAmount(0)}</span>
      </div>
    );
  }

  // ブロック内に1件のみ、またはブロックなしの場合はフラット表示
  const isSingleOrNoBlock = !block || sorted.length === 1;
  const showAll = isSingleOrNoBlock || expanded || sorted.length <= DIRECT_BLOCK_MAX_COLLAPSED;
  const shown = showAll ? sorted : sorted.slice(0, DIRECT_BLOCK_MAX_COLLAPSED);
  const remaining = sorted.length - shown.length;

  return (
    <div>
      {/* ブロックヘッダー（複数件のブロックのみ） */}
      {!isSingleOrNoBlock && (
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-0.5">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 font-semibold text-[10px] flex-shrink-0">
            {block}
          </span>
          <span className="truncate">{blockName}</span>
          <span className="flex-shrink-0 ml-auto">{formatAmount(blockTotal)}</span>
        </div>
      )}
      {/* 支出先一覧 */}
      <div className={!isSingleOrNoBlock ? 'ml-3' : ''}>
        {shown.map((edge, i) => {
          const targetNode = nodeMap.get(edge.target);
          const color = targetNode ? (TYPE_COLORS[targetNode.type] || '#999') : '#999';
          return (
            <button
              key={`${edge.target}-${i}`}
              onClick={() => onNodeClick(edge.target)}
              className="w-full text-left flex items-center gap-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            >
              {isSingleOrNoBlock && block && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 font-semibold text-[10px] flex-shrink-0">
                  {block}
                </span>
              )}
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {targetNode?.label ?? edge.target}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                {formatAmount(edge.value)}
              </span>
            </button>
          );
        })}
        {remaining > 0 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 py-0.5 ml-3"
          >
            …他 {remaining} 件を表示
          </button>
        )}
        {expanded && sorted.length > DIRECT_BLOCK_MAX_COLLAPSED && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 py-0.5 ml-3"
          >
            折りたたむ
          </button>
        )}
      </div>
    </div>
  );
}

const STEP_MAX_COLLAPSED = 4;

interface SubcontractStepNodeProps {
  step: {
    sourceBlock: string;
    targetBlock: string;
    from: string;
    to: string;
    amount: number;
    recipients: { name: string; amount: number }[];
  };
  directBlockIds?: Set<string>;
  onNodeClick: (nodeId: string) => void;
}

function SubcontractStepNode({ step, directBlockIds, onNodeClick }: SubcontractStepNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const recipients = step.recipients.slice().sort((a, b) => b.amount - a.amount);
  const showAll = expanded || recipients.length <= STEP_MAX_COLLAPSED;
  const shown = showAll ? recipients : recipients.slice(0, STEP_MAX_COLLAPSED);
  const remaining = recipients.length - shown.length;

  return (
    <div>
      {/* ブロック遷移ヘッダー: A → B ブロック名 金額 */}
      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-0.5">
        <span className={`inline-flex items-center justify-center w-4 h-4 rounded font-semibold text-[10px] flex-shrink-0 ${
          directBlockIds?.has(step.sourceBlock)
            ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
            : 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
        }`}>
          {step.sourceBlock}
        </span>
        <span className="text-gray-400">→</span>
        <span className={`inline-flex items-center justify-center w-4 h-4 rounded font-semibold text-[10px] flex-shrink-0 ${
          directBlockIds?.has(step.targetBlock)
            ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
            : 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
        }`}>
          {step.targetBlock}
        </span>
        <span className="truncate text-gray-600 dark:text-gray-300">
          {step.from}
        </span>
        <span className="text-gray-400">→</span>
        <span className="truncate text-gray-600 dark:text-gray-300">
          {step.to}
        </span>
        <span className="flex-shrink-0 ml-auto">{formatAmount(step.amount)}</span>
      </div>
      {/* 個別支出先 */}
      <div className="ml-3">
        {shown.map((r, i) => (
          <button
            key={`${r.name}-${i}`}
            onClick={() => onNodeClick(`recipient-${r.name}`)}
            className="w-full text-left flex items-center gap-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
          >
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: '#f59e0b' }} />
            <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {r.name}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
              {formatAmount(r.amount)}
            </span>
          </button>
        ))}
        {remaining > 0 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 py-0.5 ml-3"
          >
            …他 {remaining} 社を表示
          </button>
        )}
        {expanded && recipients.length > STEP_MAX_COLLAPSED && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 py-0.5 ml-3"
          >
            折りたたむ
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 金額スライダー + 直接入力 ──────────────────────────

interface AmountSliderProps {
  label: string;
  value: number;
  noValueLabel: string;
  accent: 'blue' | 'orange';
  isMax: boolean;
  onChange: (v: number) => void;
}

function AmountSlider({ label, value, noValueLabel, accent, isMax, onChange }: AmountSliderProps) {
  const [editing, setEditing] = useState(false);
  const [inputText, setInputText] = useState('');

  const isNoValue = isMax ? value >= Infinity : value <= 0;
  const displayText = isNoValue ? noValueLabel : formatAmount(value);

  const sliderValue = isMax
    ? (value >= Infinity ? 100 : ((Math.log10(value) - MIN_AMOUNT_LOG_MIN) / (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)) * 100)
    : (value <= 0 ? 0 : ((Math.log10(value) - MIN_AMOUNT_LOG_MIN) / (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN)) * 100);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (isMax) {
      onChange(v >= 100 ? Infinity : Math.round(Math.pow(10, MIN_AMOUNT_LOG_MIN + (v / 100) * (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN))));
    } else {
      onChange(v <= 0 ? 0 : Math.round(Math.pow(10, MIN_AMOUNT_LOG_MIN + (v / 100) * (MIN_AMOUNT_LOG_MAX - MIN_AMOUNT_LOG_MIN))));
    }
  };

  const parseAmountInput = (text: string): number | null => {
    const t = text.trim().replace(/,/g, '');
    // "100兆円" → 100e12, "5億円" → 5e8, "1万円" → 1e4
    const chouMatch = t.match(/^([\d.]+)\s*兆/);
    if (chouMatch) return Math.round(parseFloat(chouMatch[1]) * 1e12);
    const okuMatch = t.match(/^([\d.]+)\s*億/);
    if (okuMatch) return Math.round(parseFloat(okuMatch[1]) * 1e8);
    const manMatch = t.match(/^([\d.]+)\s*万/);
    if (manMatch) return Math.round(parseFloat(manMatch[1]) * 1e4);
    // 数字のみ → 円
    const num = parseFloat(t.replace(/円$/, ''));
    if (!isNaN(num) && num >= 0) return Math.round(num);
    return null;
  };

  const commitInput = () => {
    setEditing(false);
    if (!inputText.trim()) {
      onChange(isMax ? Infinity : 0);
      return;
    }
    const parsed = parseAmountInput(inputText);
    if (parsed !== null) onChange(parsed);
  };

  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>{label}:</span>
        {editing ? (
          <input
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onBlur={commitInput}
            onKeyDown={e => { if (e.key === 'Enter') commitInput(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            placeholder="例: 1億, 100万, 5兆"
            className="flex-1 text-xs bg-gray-50 dark:bg-gray-700 rounded px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 dark:text-gray-200"
          />
        ) : (
          <button
            onClick={() => { setInputText(isNoValue ? '' : String(Math.round(value))); setEditing(true); }}
            className="text-xs text-blue-500 hover:text-blue-700 hover:underline cursor-text"
            title="クリックして直接入力"
          >
            {displayText}
          </button>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={sliderValue}
        onChange={handleSliderChange}
        className={`w-full h-1.5 ${accent === 'blue' ? 'accent-blue-500' : 'accent-orange-500'}`}
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{isMax ? '1万' : 'なし'}</span>
        <span>10億</span>
        <span>{isMax ? 'なし' : '100兆'}</span>
      </div>
    </div>
  );
}
