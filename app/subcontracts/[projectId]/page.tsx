'use client';

/**
 * /subcontracts/[projectId]（詳細） URL=状態パラメータ一覧。
 * 既定値のときは省略する（クリーンなURL維持）。
 *
 *   year : 年度（既存、2024|2025。既定2025）
 *   sel  : 選択中ブロックID（未選択時は省略）。選択・タブ変更は history.pushState（ブラウザバックで戻れる）
 *   tab  : アクティブタブの短縮コード（fl=フロー/bl=ブロック/rc=支出先/ic=間接経費。既定'fl'は省略）
 *   z    : ズーム倍率（絶対スケール値、小数第2位）。history.replaceState（debounce後、履歴を汚さない）
 *   tx/ty: パン位置（transform.x / transform.y、整数px）。z と同じ replaceState 経路で同期
 *   view : 表示モード（block=ブロック図。既定のフロー図(ribbon)は省略）。replaceState で同期
 */
import { useState, useEffect, useRef, useCallback, useMemo, Suspense, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import type { QualityScoreItem } from '@/app/api/quality-scores/route';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  SubcontractGraph,
  BlockNode,
  BlockRecipient,
  BlockEdge,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';
import type { BudgetBreakdownItem, BudgetSummary } from '@/types/sankey-svg';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { ProjectOverviewSection } from '@/client/components/subcontract/ProjectOverviewSection';
import type { ProjectDetail } from '@/types/project-details';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import {
  computeSubcontractLayout,
  backEdgePath,
  selfLoopPath,
  formatYen,
  COLOR_DIRECT,
  COLOR_SUBCONTRACT,
  COLOR_ROOT,
  NODE_PAD,
} from '@/app/lib/subcontract-layout';
import { SEMANTIC_SEPARATE_ORIGIN, SEMANTIC_PROJECT } from '@/app/lib/semantic-colors';
import { TagChip } from '@/client/components/TagChip';
import { getAccountBadgeStyle, classifyAccountCategory } from '@/app/lib/account-badge';
import { originKindLabel } from '@/client/components/subcontract/origin-kind';
import { PolicyEvaluationBlock, type PolicyEvaluationView } from '@/client/components/quality/PolicyEvaluationBlock';
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';
import {
  computeSubcontractRibbonLayout,
  ribbonFlowPath,
  ribbonBackEdgePath,
  ribbonSelfLoopPath,
  RIBBON_MARGIN,
  RIBBON_COL_W,
  RIBBON_COL_GAP,
  RIBBON_BAR_W,
  RIBBON_LABEL_W,
  truncateRibbonLabelName,
  type RibbonFlow,
  type RibbonBudgetItem,
} from '@/app/lib/subcontract-ribbon-layout';
import { summarizeOffFlowIndirectCosts, INDIRECT_COST_NODE_LABEL, type IndirectCostSummary } from '@/app/lib/subcontracts/indirect-costs';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel, SIDE_PANEL_WIDTH_MIN, SIDE_PANEL_WIDTH_MAX } from '@/client/hooks/useSidePanel';
import { useBaseFontPx } from '@/client/hooks/useBaseFontPx';
import { createScaleFont } from '@/app/lib/font-scale';
import { FontSizeControls } from '@/client/components/SankeySvg/FontSizeControls';

// サイドパネルの既定幅は現状の SidePane 固定幅(390)を維持。最小/最大はサンキーと共通の値を使う
const SUBCONTRACT_PANEL_WIDTH_DEFAULT = 390;

const COLOR_BACK_EDGE = 'rgba(217,69,69,0.65)';
const COLOR_CANVAS = '#fff';
const COLOR_DIRECT_BODY = '#f8d3d3';
const COLOR_SUBCONTRACT_BODY = '#f5e3c0';
const COLOR_DIRECT_BODY_TEXT = '#8f1f1f';
const COLOR_SUBCONTRACT_BODY_TEXT = '#7a5312';
const COLOR_DIRECT_BODY_SUBTLE = '#b33434';
const COLOR_SUBCONTRACT_BODY_SUBTLE = '#855a0f'; // 淡アンバー背景で 4.5:1 を満たす濃さ（TagChip と共通）
const COLOR_DIRECT_EDGE = 'rgba(217,69,69,0.48)';
const COLOR_SUBCONTRACT_EDGE = 'rgba(217,149,43,0.55)';
// 別財源ブロック（5-2の構造的に府省庁ルートでは説明できない財投借入・自己収入・利水者等）
// 色は紫（旧インディゴ #6366f1 はリンク青と衝突するため semantic-colors.ts に合わせて変更）
const COLOR_SEPARATE_ORIGIN_STRONG = SEMANTIC_SEPARATE_ORIGIN;
const COLOR_SEPARATE_ORIGIN_BODY = '#f2edf8';
const COLOR_SEPARATE_ORIGIN_BODY_TEXT = '#5b4483';
const COLOR_SEPARATE_ORIGIN_BODY_SUBTLE = '#6b4fa0';
const COLOR_SEPARATE_ORIGIN_EDGE = 'rgba(123,94,167,0.55)';
const COLOR_REFERENCE_EDGE = 'rgba(148,163,184,0.55)';
// 間接経費（国が直接支出・支出先ノードを持たない終端）。赤=直接/橙=再委託/紫=別財源/緑=予算 と
// 意味色が埋まっているため、「受け手がいない支出」は無彩色のグレーで表す
const COLOR_INDIRECT_COST = '#94a3b8';

interface OriginPalette {
  header: string;
  body: string;
  bodyText: string;
  bodySubtle: string;
  selectedStroke: string;
  badgeText: string;
}

function originPalette(originKind: BlockOriginKind): OriginPalette {
  // 別財源ブロックは broad/strong の内部区別を表示せず一律「別財源」として扱う
  if (originKind === 'separate-origin-strong' || originKind === 'separate-origin-broad') {
    return {
      header: COLOR_SEPARATE_ORIGIN_STRONG,
      body: COLOR_SEPARATE_ORIGIN_BODY,
      bodyText: COLOR_SEPARATE_ORIGIN_BODY_TEXT,
      bodySubtle: COLOR_SEPARATE_ORIGIN_BODY_SUBTLE,
      selectedStroke: '#312e81',
      badgeText: '別財源',
    };
  }
  if (originKind === 'direct') {
    return {
      header: COLOR_DIRECT,
      body: COLOR_DIRECT_BODY,
      bodyText: COLOR_DIRECT_BODY_TEXT,
      bodySubtle: COLOR_DIRECT_BODY_SUBTLE,
      selectedStroke: '#991b1b',
      badgeText: '直接支出',
    };
  }
  return {
    header: COLOR_SUBCONTRACT,
    body: COLOR_SUBCONTRACT_BODY,
    bodyText: COLOR_SUBCONTRACT_BODY_TEXT,
    bodySubtle: COLOR_SUBCONTRACT_BODY_SUBTLE,
    selectedStroke: '#9a3412',
    badgeText: '再委託',
  };
}

function flowEdgeStyle(origin: FlowOrigin): { stroke: string; dasharray?: string; width: number } {
  switch (origin) {
    case 'direct':
      return { stroke: COLOR_DIRECT_EDGE, width: 2.5 };
    case 'transfer':
      return { stroke: COLOR_DIRECT_EDGE, width: 2.5, dasharray: '6 3' };
    case 'separate-origin':
      return { stroke: COLOR_SEPARATE_ORIGIN_EDGE, width: 2.5, dasharray: '5 4' };
    case 'reference':
      return { stroke: COLOR_REFERENCE_EDGE, width: 1.5, dasharray: '3 3' };
    case 'subcontract':
    default:
      return { stroke: COLOR_SUBCONTRACT_EDGE, width: 2.5 };
  }
}

function flowOriginLabel(origin: FlowOrigin): string {
  switch (origin) {
    case 'direct': return '直接';
    case 'transfer': return '移替';
    case 'separate-origin': return '別財源';
    case 'reference': return '参考';
    case 'subcontract': return '再委託';
  }
}

function flowOriginSortRank(origin: FlowOrigin): number {
  switch (origin) {
    case 'direct': return 0;
    case 'transfer': return 1;
    case 'separate-origin': return 2;
    case 'subcontract': return 3;
    case 'reference': return 4;
  }
}

function flowOriginBadgeColor(origin: FlowOrigin): { bg: string; fg: string } {
  switch (origin) {
    case 'direct': return { bg: '#f9dddd', fg: COLOR_DIRECT_BODY_SUBTLE };
    // 移替・参考は意味色を持たせずグレー系（意味色は直接/再委託/別財源のみ）
    case 'transfer': return { bg: '#eceff2', fg: '#475569' };
    case 'separate-origin': return { bg: '#ece5f5', fg: COLOR_SEPARATE_ORIGIN_BODY_TEXT };
    case 'subcontract': return { bg: '#faedcf', fg: COLOR_SUBCONTRACT_BODY_SUBTLE };
    case 'reference': return { bg: '#f1f5f9', fg: '#475569' };
  }
}

function originKindBadgeColor(kind: BlockOriginKind): { bg: string; fg: string } {
  switch (kind) {
    case 'direct': return { bg: '#f9dddd', fg: COLOR_DIRECT_BODY_SUBTLE };
    case 'subcontract': return { bg: '#faedcf', fg: COLOR_SUBCONTRACT_BODY_SUBTLE };
    case 'separate-origin-strong':
    case 'separate-origin-broad':
      return { bg: '#ece5f5', fg: COLOR_SEPARATE_ORIGIN_BODY_TEXT };
  }
}

const COLOR_CONTEXT_BODY = '#d8f1df';
const COLOR_CONTEXT_BODY_TEXT = '#1f6b3a';
const COLOR_CONTEXT_BODY_SUBTLE = '#2d7d46';
const COLOR_PANEL_BORDER = '#e5e7eb';
// フォントスケール機構（サンキー = app/sankey-svg/page.tsx と共通の app/lib/font-scale.ts + client/hooks/useBaseFontPx.ts を使用）。
// 以下の "_DEFAULT" 定数は等倍（baseFontPx = BASE_FONT_PX_DEFAULT）時の値。実描画では scaleFont(...) を通す。
const BASE_FONT_PX_DEFAULT = 12;
const BASE_FONT_PX_MIN = 8;
const BASE_FONT_PX_MAX = 24;
const PANEL_TITLE_FONT_PX_DEFAULT = 14;
const PANEL_PRIMARY_VALUE_FONT_PX_DEFAULT = 15;
const PANEL_LIST_NAME_FONT_PX_DEFAULT = 12;
const PANEL_LIST_VALUE_FONT_PX_DEFAULT = 12;
const PANEL_META_FONT_PX_DEFAULT = 11;
const CARD_HEADER_H = 46;
const CARD_RADIUS = 8;
const CARD_BORDER_W = 1;
const CARD_BORDER_NEUTRAL = '#e2e8f0';
const CARD_SHADOW = 'drop-shadow(0 1px 2px rgba(15,23,42,0.10)) drop-shadow(0 1px 1px rgba(15,23,42,0.06))';
const CARD_SELECTED_RING = 'rgba(74,144,217,0.28)';
// ズーム倍率レンジ（/sankey-svg の ZOOM_MIN_ABS/MAX_ABS/MULTIPLIER と同じ考え方: 絶対上下限と
// baseZoom（フィット倍率）からの相対上下限の両方で挟む）
const ZOOM_MIN_ABS = 0.05;
const ZOOM_MAX_ABS = 20;
const ZOOM_MIN_MULTIPLIER = 0.25;
const ZOOM_MAX_MULTIPLIER = 30;
// ズーム連動フォント拡大の上限（/sankey-svg の ZOOM_FONT_MAX_RATIO と同値）。
const ZOOM_FONT_MAX_RATIO = 2.0;
// ラベル衝突回避で確保する最小スロット高（画面px・等倍時）。/sankey-svg の MAP_LABEL_SLOT_PX_DEFAULT と同値。
const RIBBON_LABEL_SLOT_PX_BASE = 12;
// フロー図の横方向は「可視幅に収める列数」を固定にする（メイン画面の横幅に4列が収まる
// 制約に合わせる）。再委託階層が深く5列以上になる場合は圧縮せず横へオーバーフローさせる。
// 4列 = 予算・執行 / 事業 / 支出先(depth1) / 再委託先(depth2)。
const RIBBON_VISIBLE_COLS = 4;

/**
 * ribbon図のフィット値を算出。横は「可視幅に4列」の固定ピッチ（zoom非依存）、
 * 縦は高さフィット（baseZoom）。resetViewport と URL復元の両方から使い、式の二重化を防ぐ。
 */
function computeRibbonFit(cW: number, cH: number, contentH: number): { horizontalScale: number; baseZoom: number } {
  return {
    horizontalScale: (cW / RIBBON_VISIBLE_COLS) / (RIBBON_COL_W + RIBBON_COL_GAP),
    baseZoom: Math.max(0.05, Math.min(10, (cH / contentH) * 0.9)),
  };
}
// フロー図ラベルを「画面上ほぼ一定サイズ（baseZoom 超のズームインで最大 ZOOM_FONT_MAX_RATIO 倍まで拡大）」
// にするための係数。scaled <g> 内の fontSize に scale を打ち消す形で掛ける（/sankey-svg の getZoomLabelScale 相当）。
function getZoomLabelScale(zoomK: number, baseZoomK: number): number {
  if (baseZoomK <= 0 || zoomK <= baseZoomK + 0.001) return 1;
  return Math.min(zoomK / baseZoomK, ZOOM_FONT_MAX_RATIO);
}
// エッジ太さスケール（金額に応じて 2〜10px の平方根スケール。線が細すぎ/太すぎにならない範囲）
const EDGE_WIDTH_MIN = 2;
const EDGE_WIDTH_MAX = 10;
function edgeWidthForAmount(amount: number, maxAmount: number): number {
  if (amount <= 0 || maxAmount <= 0) return EDGE_WIDTH_MIN;
  const t = Math.sqrt(Math.min(1, amount / maxAmount));
  return EDGE_WIDTH_MIN + t * (EDGE_WIDTH_MAX - EDGE_WIDTH_MIN);
}
// キャンバス背景のドット格子（薄い格子点。パン位置に応じてずらし、キャンバスと一緒に動く見た目にする）
// サンキー（app/sankey-svg/page.tsx）のホバー流儀に合わせた定数
const HOVER_ENTER_DELAY_MS = 220;
const HOVER_SUPPRESS_AFTER_INTERACTION_MS = 500;
const CLAMP_2_LINES: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
} as CSSProperties;

/**
 * 事業ノードの結合シェイプ（予算=左・緑・高さbH / 支出=右・オレンジ・高さsH。上端揃え）。
 * メイン /sankey-svg の mergedProjectPath と同型（絶対座標版）。幅は barW*2。
 */
function mergedProjectPath(x0: number, yTop: number, barW: number, bH: number, sH: number): string {
  const x2 = x0 + barW * 2;
  const mx = (x0 + x2) / 2;
  return `M${x0},${yTop} L${x2},${yTop} L${x2},${yTop + sH} C${mx},${yTop + sH} ${mx},${yTop + bH} ${x0},${yTop + bH} Z`;
}

interface ProjectQualityOrg {
  pid: string;
  bureau?: string;
  division?: string;
  section?: string;
  office?: string;
  team?: string;
  unit?: string;
}

/** 品質スコア表示に使う項目だけ抜き出したもの */

const ORG_LEVEL_LABELS = ['局庁', '部', '課', '室', '班', '係'];

function percentOf(amount: number, total: number): string {
  if (total <= 0) return '—';
  return `${((amount / total) * 100).toFixed(1)}%`;
}

function verticalBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h}`,
    `H ${x}`,
    'Z',
  ].join(' ');
}

function roundedBottomPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x} ${y}`,
    `H ${x + w}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    'Z',
  ].join(' ');
}

function sortRecipients(
  recipients: BlockRecipient[],
  sortKey: 'amount-desc' | 'amount-asc' | 'name-asc',
): BlockRecipient[] {
  return [...recipients].sort((a, b) => {
    if (sortKey === 'amount-asc') return a.amount - b.amount;
    if (sortKey === 'name-asc') return (a.name || '').localeCompare(b.name || '', 'ja');
    return b.amount - a.amount;
  });
}

type HoveredNode =
  | { kind: 'root' }
  | { kind: 'block'; block: BlockNode }
  | { kind: 'ribbonFlow'; flow: RibbonFlow; flowKey: string }
  | { kind: 'budget'; item: RibbonBudgetItem }
  | { kind: 'indirect' };

type ViewMode = 'block' | 'ribbon';

// ─── サイドパネル（タブ式） ──────────────────────────────────────────────

type PaneTab = 'flow' | 'blocks' | 'recipients' | 'indirect-cost';

const TAB_TO_CODE: Record<PaneTab, string> = { flow: 'fl', blocks: 'bl', recipients: 'rc', 'indirect-cost': 'ic' };
const CODE_TO_TAB: Record<string, PaneTab> = { fl: 'flow', bl: 'blocks', rc: 'recipients', ic: 'indirect-cost' };

/**
 * API が返す再委託グラフ（+ サンキーグラフから合成した予算・執行）。
 * 予算内訳は再委託データ側に無いため /api/subcontracts が付与する。
 */
type SubcontractGraphWithBudget = SubcontractGraph & {
  budgetBreakdown?: BudgetBreakdownItem[];
  budgetSummary?: BudgetSummary | null;
};

interface DetailUrlState {
  sel: string;
  tab: PaneTab;
  zoom: number;
  tx: number;
  ty: number;
  view: ViewMode;
}

/** URL(検索パラメータ文字列)から sel/tab/z/tx/ty/view を復元する。存在しない・不正な値は省略する */
function parseDetailUrlState(sp: { get(key: string): string | null }): Partial<DetailUrlState> {
  const result: Partial<DetailUrlState> = {};
  const sel = sp.get('sel'); if (sel) result.sel = sel;
  const tab = sp.get('tab'); if (tab && CODE_TO_TAB[tab]) result.tab = CODE_TO_TAB[tab];
  const z = sp.get('z'); if (z !== null) { const n = parseFloat(z); if (!isNaN(n) && n > 0) result.zoom = n; }
  const tx = sp.get('tx'); if (tx !== null) { const n = parseFloat(tx); if (!isNaN(n)) result.tx = n; }
  const ty = sp.get('ty'); if (ty !== null) { const n = parseFloat(ty); if (!isNaN(n)) result.ty = n; }
  // 既定は 'ribbon'（フロー図）。旧リンクの view=ribbon もそのまま解決する
  const view = sp.get('view'); if (view === 'ribbon' || view === 'block') result.view = view;
  return result;
}

/** 選択・タブ変更を pushState で反映する（ブラウザバックで選択を戻れる）。sel=null は選択解除 */
function pushSelTabUrl(sel: string | null, tab: PaneTab) {
  const p = new URLSearchParams(window.location.search);
  if (sel !== null) p.set('sel', sel); else p.delete('sel');
  if (tab !== 'flow') p.set('tab', TAB_TO_CODE[tab]); else p.delete('tab');
  const qs = p.toString();
  window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
}

/** ビュー切替を replaceState で反映する（履歴を汚さない）。既定値(ribbon)は省略する */
function replaceViewUrl(view: ViewMode) {
  const p = new URLSearchParams(window.location.search);
  if (view !== 'ribbon') p.set('view', view); else p.delete('view');
  const qs = p.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

function SidePane({
  block,
  graph,
  projectDetail,
  policyView,
  policyError,
  orgChain,
  year,
  activeTab,
  indirect,
  onChangeTab,
  onSelectBlock,
  scaleFont,
}: {
  block: BlockNode | null;
  graph: SubcontractGraphWithBudget;
  projectDetail: ProjectDetail | null;
  policyView: PolicyEvaluationView | null | undefined;
  policyError: string | null;
  orgChain: string[];
  year: number;
  activeTab: PaneTab;
  /** 間接経費の集計（フロー図と同じ値を使うため親から受け取る） */
  indirect: IndirectCostSummary;
  onChangeTab: (tab: PaneTab) => void;
  onSelectBlock: (block: BlockNode) => void;
  scaleFont: (px: number) => number;
}) {
  const PANEL_TITLE_FONT_PX = scaleFont(PANEL_TITLE_FONT_PX_DEFAULT);
  const PANEL_PRIMARY_VALUE_FONT_PX = scaleFont(PANEL_PRIMARY_VALUE_FONT_PX_DEFAULT);
  const PANEL_META_FONT_PX = scaleFont(PANEL_META_FONT_PX_DEFAULT);
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(new Set());
  const [overviewOpen, setOverviewOpen] = useState(false); // 既定は折りたたみ＝プレビュー表示（メイン同様）
  const [budgetOpen, setBudgetOpen] = useState(false);
  // 品質スコア詳細ダイアログ（/quality と共通の ScoreDetailDialog。メイン画面と同型）
  const [scoreDialogItem, setScoreDialogItem] = useState<QualityScoreItem | null>(null);
  const [scoreDialogLoading, setScoreDialogLoading] = useState(false);
  const openScoreDialog = useCallback((pid: string | number) => {
    setScoreDialogLoading(true);
    fetch(`/api/quality-scores/${pid}?year=${year}&full=1`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((data: { score?: QualityScoreItem }) => { if (data.score) setScoreDialogItem(data.score); })
      .catch(() => { /* スコアなし等は何もしない */ })
      .finally(() => setScoreDialogLoading(false));
  }, [year]);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientSort, setRecipientSort] = useState<'amount-desc' | 'amount-asc' | 'name-asc'>('amount-desc');
  const [blockQuery, setBlockQuery] = useState('');
  const [blockFilter, setBlockFilter] = useState<'all' | 'direct' | 'subcontract' | 'separate-origin'>('all');
  const [blockSort, setBlockSort] = useState<'amount-desc' | 'name-asc'>('amount-desc');
  const [flowFilter, setFlowFilter] = useState<'all' | FlowOrigin>('all');

  useEffect(() => {
    setExpandedRecipients(new Set());
    setRecipientQuery('');
  }, [block?.blockId]);

  function toggleRecipient(i: number) {
    setExpandedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const blockById = useMemo(() => new Map(graph.blocks.map((b) => [b.blockId, b])), [graph.blocks]);

  const downstreamBlocks = useMemo(() => {
    if (!block) return [];
    const ids = graph.flows.filter((f) => f.sourceBlock === block.blockId).map((f) => f.targetBlock);
    return ids.map((id) => blockById.get(id)).filter(Boolean) as BlockNode[];
  }, [block, blockById, graph.flows]);
  const upstreamBlocks = useMemo(() => {
    if (!block) return [];
    const ids = graph.flows.filter((f) => f.targetBlock === block.blockId && f.sourceBlock !== null).map((f) => f.sourceBlock as string);
    return ids.map((id) => blockById.get(id)).filter(Boolean) as BlockNode[];
  }, [block, blockById, graph.flows]);

  // ── 集計（フロー / ブロック） ──
  const filteredBlocks = graph.blocks
    .filter((b) => {
      if (blockFilter === 'all') return true;
      if (blockFilter === 'direct') return b.originKind === 'direct';
      if (blockFilter === 'subcontract') return b.originKind === 'subcontract';
      return b.originKind === 'separate-origin-broad' || b.originKind === 'separate-origin-strong';
    })
    .filter((b) => {
      const q = blockQuery.trim().toLowerCase();
      if (!q) return true;
      return `${b.blockId} ${b.blockName} ${b.role ?? ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) => blockSort === 'name-asc'
      ? `${a.blockId} ${a.blockName}`.localeCompare(`${b.blockId} ${b.blockName}`, 'ja')
      : b.totalAmount - a.totalAmount);

  const filteredFlows = graph.flows
    .filter((f) => flowFilter === 'all' || f.origin === flowFilter)
    .sort((a, b) => {
      const ar = flowOriginSortRank(a.origin);
      const br = flowOriginSortRank(b.origin);
      if (ar !== br) return ar - br;
      return (a.sourceBlock ?? '').localeCompare(b.sourceBlock ?? '', 'ja');
    });

  const rq = recipientQuery.trim().toLowerCase();
  const sortedRecipients = block
    ? sortRecipients(block.recipients, recipientSort)
        .filter((r) => !rq || `${r.name} ${r.corporateNumber} ${r.contractSummaries.join(' ')}`.toLowerCase().includes(rq))
    : [];

  // ブロック未選択時の支出先タブ = 事業全体の支出先（どのブロック由来かを併記する）
  const allRecipients = useMemo(
    () => graph.blocks.flatMap((b) => b.recipients.map((r) => ({ r, blockId: b.blockId, originKind: b.originKind }))),
    [graph.blocks],
  );
  const filteredAllRecipients = sortRecipients(allRecipients.map(x => x.r), recipientSort)
    .map((r) => allRecipients.find((x) => x.r === r)!)
    .filter(({ r, blockId }) => !rq || `${blockId} ${r.name} ${r.corporateNumber} ${r.contractSummaries.join(' ')}`.toLowerCase().includes(rq));

  // 間接経費（支出先ブロックを持たない＝フロー図の終端ノードに載る分）は親から受け取る
  const indirectCount = indirect.count;

  // タブ定義。フローを入口（初期選択）に置く。
  // 支出先はブロック未選択なら事業全体、選択中はそのブロック内訳を出す。
  // 間接経費は0件でも押せるようにする（「無い」ことも情報。図に現れない支出の唯一の受け皿）。
  // 予算・執行タブは一旦廃止（S1 でメイン画面と同型のパネル表示に統合済み。
  // データ（graph.budgetSummary/budgetBreakdown）は API 側で保持）。
  const tabs: Array<{ key: PaneTab; label: string; count?: number; disabled?: boolean }> = [
    { key: 'flow', label: 'フロー', count: graph.flows.length },
    { key: 'blocks', label: 'ブロック', count: graph.blocks.length },
    { key: 'recipients', label: '支出先', count: block ? block.recipients.length : graph.totalRecipientCount },
    { key: 'indirect-cost', label: '間接経費', count: indirectCount },
  ];

  return (
    <aside style={{
      width: '100%',
      height: '100%',
      background: '#fff',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ヘッダー・インスペクター・タブは固定（/sankey-svg と同様に、スクロールはリスト部のみ） */}
      <div style={{ flexShrink: 0, background: '#fff' }}>
      {/* 事業ヘッダー（常時表示）。セクション並びはメイン画面と同じ 概要→品質→再委託→予算・執行 */}
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${COLOR_PANEL_BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: PANEL_TITLE_FONT_PX, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
              {graph.projectName}
            </div>
            {/* 予算額 / 支出額（メイン画面と同じ2列＋1円単位のサブ表記。予算vs支出で用語統一） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 12, rowGap: 4, marginTop: 5 }}>
              {([['予算額', graph.budget], ['支出額', graph.execution]] as [string, number][]).map(([label, value]) => (
                <div key={label} style={{ flex: `1 1 ${scaleFont(112)}px`, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: PANEL_META_FONT_PX, color: '#aaa', fontWeight: 400, marginBottom: 1 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: PANEL_PRIMARY_VALUE_FONT_PX, fontWeight: 600, color: '#222', whiteSpace: 'nowrap' }}>
                    {value > 0 ? formatYen(value) : '—'}
                  </span>
                  <span style={{ display: 'block', fontSize: PANEL_META_FONT_PX, color: '#999', marginTop: 1, whiteSpace: 'nowrap' }}>
                    {value > 0 ? `${Math.round(value).toLocaleString()}円` : ''}
                  </span>
                </div>
              ))}
            </div>
            {/* 支出の内訳。図に現れる分（支出先ブロック）と現れない分（間接経費）を明示する。
                出典が別（5-1 ブロック支出 / 2-1 執行額）で合計は支出額に一致しないため、
                式ではなく併記に留める */}
            {(graph.directExpenseTotal > 0 || indirect.total > 0) && (
              <div style={{ fontSize: PANEL_META_FONT_PX, color: '#888', marginTop: 4 }}>
                支出先 {graph.directExpenseTotal > 0 ? formatYen(graph.directExpenseTotal) : '—'}
                {indirect.total > 0 && <> ／ 間接経費 {formatYen(indirect.total)}</>}
              </div>
            )}
          </div>
        </div>
        {/* メイン画面と同型: 事業タグ＋PID＋省庁＋組織のみ（構造サマリは下の「再委託」節へ） */}
        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: PANEL_META_FONT_PX }}>
          <span style={{ background: SEMANTIC_PROJECT, color: '#fff', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }}>事業</span>
          <span style={{ color: '#aaa' }}>PID:{graph.projectId}</span>
          <span style={{ color: '#666' }}>{graph.ministry}</span>
          {orgChain.length > 0 && <span style={{ color: '#777' }}>{orgChain.join(' / ')}</span>}
          {!orgChain.length && projectDetail?.bureau && <span style={{ color: '#777' }}>{projectDetail.bureau}</span>}
        </div>
      </div>

      {/* 事業概要（共有コンポーネント。メイン画面と同一のプレビュー＋展開詳細） */}
      {projectDetail && (
        <ProjectOverviewSection
          detail={projectDetail}
          projectName={graph.projectName}
          year={year}
          sankeyHref={sankeySvgProjectUrl(graph.projectId, graph.projectName, year)}
          scaleFont={scaleFont}
          expanded={overviewOpen}
          onToggle={() => setOverviewOpen(o => !o)}
          previewHeight={72}
        />
      )}

      {/* 政策評価ブロック（メイン画面と共有コンポーネント） */}
      <PolicyEvaluationBlock
        view={policyView}
        error={policyError}
        pid={graph.projectId}
        year={year}
        labelPx={scaleFont(12)}
        metaPx={scaleFont(10)}
        onOpenDetail={() => openScoreDialog(graph.projectId)}
        detailLoading={scoreDialogLoading}
      />

      {/* 再委託（構造サマリ）— メイン画面の「再委託」節と同型。当ページはフロー詳細なので フロー↗ は出さない */}
      <div style={{ borderBottom: `1px solid ${COLOR_PANEL_BORDER}`, padding: '7px 16px 9px' }}>
        <div style={{ fontSize: PANEL_META_FONT_PX, fontWeight: 600, color: '#555' }}>再委託</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', fontSize: PANEL_META_FONT_PX }}>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>ブロック {graph.totalBlockCount}</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>支出先 {graph.totalRecipientCount.toLocaleString()}</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>階層 {graph.maxDepth}</span>
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
          <TagChip kind="direct" fontSize={PANEL_META_FONT_PX}>直接 {graph.directBlockCount}</TagChip>
          <TagChip kind="subcontract" fontSize={PANEL_META_FONT_PX}>再委託 {Math.max(0, graph.totalBlockCount - graph.directBlockCount - graph.separateOriginCount)}</TagChip>
          {graph.separateOriginCount > 0 && (
            <TagChip kind="separate-origin" fontSize={PANEL_META_FONT_PX}>別財源 {graph.separateOriginCount}</TagChip>
          )}
        </div>
      </div>

      {/* 予算・執行（共有コンポーネント。メイン画面と同一の会計集計・歳出項目カード表示） */}
      <BudgetExecutionSection
        budgetSummary={graph.budgetSummary}
        budgetBreakdown={graph.budgetBreakdown ?? []}
        scaleFont={scaleFont}
        expanded={budgetOpen}
        onToggleExpanded={() => setBudgetOpen(o => !o)}
        listHeight={260}
      />

      {/* ブロックインスペクター（Phase 4）は一旦非表示（ユーザー要望）。選択自体は
          タブ内容（支出先＝ブロック内訳）とフロー図のハイライトに反映される。復活時は
          BlockInspector と selectedBlockFlows を戻す。 */}

      {/* タブヘッダー */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${COLOR_PANEL_BORDER}`,
        background: '#fff',
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const isDisabled = tab.disabled;
          return (
            <button
              key={tab.key}
              onClick={() => !isDisabled && onChangeTab(tab.key)}
              disabled={isDisabled}
              style={{
                flex: 1,
                background: isActive ? '#f1f5f9' : '#fff',
                border: 'none',
                borderBottom: isActive ? '2px solid #4a90d9' : '2px solid transparent',
                padding: '10px 4px 8px',
                fontSize: 12,
                fontWeight: 700,
                color: isDisabled ? '#cbd5e1' : (isActive ? '#111827' : '#475569'),
                cursor: isDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span style={{ marginLeft: 4, fontSize: 10, color: isDisabled ? '#cbd5e1' : '#94a3b8' }}>
                  {tab.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {/* タブ本体 — ここだけがスクロールする（ヘッダ・タブは固定） */}
      <div style={{ padding: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {activeTab === 'flow' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{filteredFlows.length.toLocaleString()}本 / {graph.flows.length.toLocaleString()}本</div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              {([
                ['all', 'すべて'],
                ['direct', '直接'],
                ['transfer', '移替'],
                ['separate-origin', '別財源'],
                ['subcontract', '再委託'],
                ['reference', '参考'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFlowFilter(key)}
                  style={{
                    border: `1px solid ${flowFilter === key ? '#94a3b8' : COLOR_PANEL_BORDER}`,
                    background: flowFilter === key ? '#f1f5f9' : '#fff',
                    borderRadius: 999,
                    padding: '4px 9px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredFlows.length === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>該当するフローがありません</div>
            )}
            {/* 対象ブロックでグルーピング（合流は同一対象への複数流入を1グループに集約）。
                並びはフロー図に合わせ金額順。ただし群は 直接→再委託→別財源 の順にし、
                直接を再委託より上位に置く（移替の対象ブロックは originKind=direct のため直接群に入る）。 */}
            {(() => {
              const groups: { targetBlockId: string; incoming: BlockEdge[] }[] = [];
              const idx = new Map<string, number>();
              for (const f of filteredFlows) {
                let gi = idx.get(f.targetBlock);
                if (gi === undefined) { gi = groups.length; idx.set(f.targetBlock, gi); groups.push({ targetBlockId: f.targetBlock, incoming: [] }); }
                groups[gi].incoming.push(f);
              }
              const tierOf = (blockId: string): number => {
                const k = blockById.get(blockId)?.originKind;
                return k === 'direct' ? 0 : k === 'subcontract' ? 1 : 2; // 別財源(separate-origin)は最後
              };
              const amountOf = (blockId: string): number => blockById.get(blockId)?.totalAmount ?? 0;
              groups.sort((a, b) => {
                const t = tierOf(a.targetBlockId) - tierOf(b.targetBlockId);
                return t !== 0 ? t : amountOf(b.targetBlockId) - amountOf(a.targetBlockId);
              });
              return groups.map((g) => (
                <FlowGroupRow
                  key={g.targetBlockId}
                  targetBlockId={g.targetBlockId}
                  incoming={g.incoming}
                  graph={graph}
                  onSelectBlock={onSelectBlock}
                  scaleFont={scaleFont}
                />
              ));
            })()}
          </>
        )}

        {activeTab === 'blocks' && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {filteredBlocks.length.toLocaleString()}件 / {graph.blocks.length.toLocaleString()}件
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
              <input
                value={blockQuery}
                onChange={(e) => setBlockQuery(e.target.value)}
                placeholder="ブロック名・役割で検索"
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 9px', fontSize: 12 }}
              />
              <select
                value={blockSort}
                onChange={(e) => setBlockSort(e.target.value as typeof blockSort)}
                style={{ border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, background: '#fff' }}
              >
                <option value="amount-desc">金額順</option>
                <option value="name-asc">名称順</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                ['all', 'すべて'],
                ['direct', '直接'],
                ['subcontract', '再委託'],
                ['separate-origin', '別財源'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setBlockFilter(key)}
                  style={{
                    border: `1px solid ${blockFilter === key ? '#94a3b8' : COLOR_PANEL_BORDER}`,
                    background: blockFilter === key ? '#f1f5f9' : '#fff',
                    borderRadius: 999,
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredBlocks.map((b) => (
              <BlockListRow
                key={b.blockId}
                block={b}
                onClick={() => onSelectBlock(b)}
                selected={block?.blockId === b.blockId}
                scaleFont={scaleFont}
              />
            ))}
          </>
        )}

        {activeTab === 'recipients' && (
          <>
            {!block && (
              <>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                  {filteredAllRecipients.length.toLocaleString()}件 / {allRecipients.length.toLocaleString()}件（事業全体）
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
                  <input
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                    placeholder="支出先名・契約・ブロックで検索"
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 9px', fontSize: 12 }}
                  />
                  <select
                    value={recipientSort}
                    onChange={(e) => setRecipientSort(e.target.value as typeof recipientSort)}
                    style={{ border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, background: '#fff' }}
                  >
                    <option value="amount-desc">金額順</option>
                    <option value="amount-asc">金額昇順</option>
                    <option value="name-asc">名称順</option>
                  </select>
                </div>
                <div style={{ fontSize: 10.5, color: '#9ca3af', marginBottom: 6 }}>
                  ブロックを選ぶとそのブロック内訳（費目・使途）に切り替わります
                </div>
                {filteredAllRecipients.map(({ r, blockId, originKind }, i) => {
                  const b = blockById.get(blockId);
                  const badge = originKindBadgeColor(originKind);
                  const contract = r.contractSummaries.filter(s => s && s.trim()).join(' / ');
                  const expense = r.expenses
                    .map(e => [e.category, e.purpose].filter(s => s && s.trim()).join(': '))
                    .filter(Boolean).join(' ・ ');
                  const meta = [contract || null, expense || null].filter(Boolean).join(' ・ ');
                  return (
                    <button
                      key={`${blockId}-${r.name}-${i}`}
                      onClick={() => b && onSelectBlock(b)}
                      title={`${blockId} ${b?.blockName ?? ''}\n${r.name}${meta ? `\n${meta}` : ''}`}
                      style={{
                        width: '100%', display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left',
                        border: 'none', borderBottom: '1px solid #f1f5f9', background: 'transparent',
                        borderRadius: 0, padding: '7px 0', margin: 0, cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', width: '100%' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 400, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#94a3b8', marginRight: 4 }}>{blockId}</span>
                          {r.name}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(r.amount)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, width: '100%' }}>
                        <span style={{ padding: '0 6px', borderRadius: 999, background: badge.bg, color: badge.fg, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                          {originKindLabel(originKind)}
                        </span>
                        {meta && (
                          <span style={{ fontSize: 10.5, color: '#888', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </>
            )}
            {block && (
              <>
                {/* 選択中ブロックの要約 */}
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {(() => {
                      const badge = originKindBadgeColor(block.originKind);
                      return (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: badge.bg,
                          color: badge.fg,
                          flexShrink: 0,
                        }}>
                          {originKindLabel(block.originKind)}
                        </span>
                      );
                    })()}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {block.blockId} {block.blockName}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                    {formatYen(block.totalAmount)} ／ 支出先 {block.recipientCount.toLocaleString()}件
                    ／ 構成比 {percentOf(block.totalAmount, Math.max(graph.execution, graph.budget, block.totalAmount))}
                  </div>
                  {block.role && (
                    <div style={{ fontSize: 11, color: '#374151', marginTop: 4, padding: '3px 6px', background: '#fff', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                      {block.role}
                    </div>
                  )}
                  {(downstreamBlocks.length > 0 || upstreamBlocks.length > 0) && (
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
                      上流 {upstreamBlocks.length}件 ／ 下流 {downstreamBlocks.length}件
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
                  <input
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                    placeholder="支出先・法人番号・契約で検索"
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 9px', fontSize: 12 }}
                  />
                  <select
                    value={recipientSort}
                    onChange={(e) => setRecipientSort(e.target.value as typeof recipientSort)}
                    style={{ border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, background: '#fff' }}
                  >
                    <option value="amount-desc">金額大</option>
                    <option value="amount-asc">金額小</option>
                    <option value="name-asc">名称順</option>
                  </select>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{sortedRecipients.length.toLocaleString()}件</div>
                {sortedRecipients.map((r, i) => (
                  <RecipientCard
                    key={`${r.name}-${r.corporateNumber}-${i}`}
                    recipient={r}
                    expanded={expandedRecipients.has(i)}
                    onToggle={() => toggleRecipient(i)}
                    totalAmount={block.totalAmount}
                    barColor={originPalette(block.originKind).header}
                    scaleFont={scaleFont}
                  />
                ))}
                {sortedRecipients.length === 0 && (
                  <p style={{ fontSize: 12, color: '#9ca3af' }}>該当する支出先がありません</p>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'indirect-cost' && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              国自らが支出する間接経費 {indirectCount.toLocaleString()}件
              {indirect.total > 0 && <> ・ 合計 {formatYen(indirect.total)}</>}
            </div>
            {indirectCount === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>間接経費の記録はありません</div>
            )}
            {indirect.items.map((cost, i) => (
              <div key={i} style={{ borderBottom: '1px solid #f1f5f9', padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 400, color: '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cost.category || cost.kind || '（項目なし）'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {cost.amount > 0 ? formatYen(cost.amount) : '—'}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {cost.kind && <span style={{ marginRight: 8 }}>{cost.kind}</span>}
                  {cost.blockHint && <span>{cost.blockHint}</span>}
                </div>
                {cost.note && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{cost.note}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {scoreDialogItem && createPortal(
        <ScoreDetailDialog
          item={scoreDialogItem}
          onClose={() => setScoreDialogItem(null)}
          year={String(year)}
        />,
        document.body,
      )}
    </aside>
  );
}

function BlockListRow({ block, selected, onClick, scaleFont }: { block: BlockNode; selected: boolean; onClick: () => void; scaleFont: (px: number) => number }) {
  const badge = originKindBadgeColor(block.originKind);
  const badgeText = originKindLabel(block.originKind);
  const PANEL_LIST_NAME_FONT_PX = scaleFont(PANEL_LIST_NAME_FONT_PX_DEFAULT);
  const PANEL_LIST_VALUE_FONT_PX = scaleFont(PANEL_LIST_VALUE_FONT_PX_DEFAULT);
  const PANEL_META_FONT_PX = scaleFont(PANEL_META_FONT_PX_DEFAULT);

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px solid #f1f5f9',
        background: selected ? '#f8fafc' : 'transparent',
        borderRadius: 0,
        padding: '7px 0',
        margin: 0,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', width: '100%' }}>
        <div title={`${block.blockId} ${block.blockName}`} style={{ flex: 1, fontSize: PANEL_LIST_NAME_FONT_PX, fontWeight: 400, color: '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.blockId} {block.blockName}
        </div>
        <div style={{ fontSize: PANEL_LIST_VALUE_FONT_PX, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(block.totalAmount)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: PANEL_META_FONT_PX, color: '#888', width: '100%', minWidth: 0 }}>
        <span style={{
          padding: '1px 6px',
          borderRadius: 999,
          background: badge.bg,
          color: badge.fg,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {badgeText}
        </span>
        <span>支出先 {block.recipientCount.toLocaleString()}件</span>
        {block.role && (
          <span title={block.role} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.role}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * 流れタブの1グループ = 1つの対象ブロックへの流入。
 * 上段に「対象ブロック＋流入額（対象ブロックの totalAmount）」、下段に起点（上流）を列挙する。
 * 合流（対象へ複数ブロックから流入）のときは起点が複数行になり、視認性を高める。
 */
function FlowGroupRow({
  targetBlockId, incoming, graph, onSelectBlock, scaleFont,
}: {
  targetBlockId: string;
  incoming: BlockEdge[];
  graph: SubcontractGraph;
  onSelectBlock: (block: BlockNode) => void;
  scaleFont: (px: number) => number;
}) {
  const NAME_PX = scaleFont(PANEL_LIST_NAME_FONT_PX_DEFAULT);
  const META_PX = scaleFont(PANEL_META_FONT_PX_DEFAULT);
  const VALUE_PX = scaleFont(PANEL_LIST_VALUE_FONT_PX_DEFAULT);
  const blockById = new Map(graph.blocks.map(b => [b.blockId, b]));
  const target = blockById.get(targetBlockId) ?? null;
  const targetLabel = target ? `${target.blockId} ${target.blockName}` : targetBlockId;
  const inflow = target ? target.totalAmount : 0;
  // 合流数は表示中（フィルタ後）の起点行数から導出する。構造的な targetIncomingBlockCount を
  // 使うと、フィルタで一部の起点が除かれても「合流 N本」が全数のままになり行数と食い違うため。
  const mergeCount = incoming.length;
  const isMerge = mergeCount >= 2;

  const notes = incoming.filter(f => f.note);
  // 他タブと同じ2行構成に合わせる。上流→下流を縦方向で表現し、
  // 上段=起点（上流。合流時は複数行）、下段=「→ 対象ブロック」＋流入額（右寄せ）。
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderBottom: '1px solid #f1f5f9', padding: '7px 0', minWidth: 0 }}>
      {/* 上段: 起点（上流）。合流時は複数行になる */}
      {incoming.map((f, i) => {
        const src = f.sourceBlock ? blockById.get(f.sourceBlock) ?? null : null;
        const srcLabel = f.sourceBlock === null
          ? `${graph.ministry}（直接）`
          : src ? `${src.blockId} ${src.blockName}` : f.sourceBlock;
        const badge = flowOriginBadgeColor(f.origin);
        return (
          <div key={`${f.sourceBlock ?? 'root'}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: META_PX, color: '#64748b', minWidth: 0 }}>
            <span style={{ padding: '0 6px', borderRadius: 999, background: badge.bg, color: badge.fg, fontWeight: 700, flexShrink: 0, fontSize: Math.max(9, META_PX - 1) }}>
              {flowOriginLabel(f.origin)}
            </span>
            {src ? (
              <button
                onClick={() => onSelectBlock(src)}
                title={srcLabel}
                style={{ flex: 1, minWidth: 0, fontSize: META_PX, color: '#4a90d9', background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {srcLabel}
              </button>
            ) : (
              <span title={srcLabel} style={{ flex: 1, minWidth: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {srcLabel}
              </span>
            )}
            {f.isReference && <span style={{ color: '#94a3b8', flexShrink: 0 }}>参考</span>}
          </div>
        );
      })}
      {/* 下段: → 対象ブロック（下流）＋流入額（右寄せ・他タブと同様） */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0, marginTop: 1 }}>
        <span style={{ color: '#94a3b8', flexShrink: 0, fontSize: NAME_PX }}>→</span>
        {isMerge && (
          <span style={{ padding: '0 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontWeight: 700, fontSize: Math.max(9, META_PX - 1), flexShrink: 0 }}>
            合流 {mergeCount}本
          </span>
        )}
        {target ? (
          <button
            onClick={() => onSelectBlock(target)}
            title={targetLabel}
            style={{ flex: 1, minWidth: 0, fontSize: NAME_PX, fontWeight: 400, color: '#333', background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {targetLabel}
          </button>
        ) : (
          <span title={targetLabel} style={{ flex: 1, minWidth: 0, fontSize: NAME_PX, fontWeight: 400, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {targetLabel}
          </span>
        )}
        <span title="対象ブロックへの流入額（合計）" style={{ fontSize: VALUE_PX, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {inflow > 0 ? formatYen(inflow) : '—'}
        </span>
      </div>
      {/* 補足（note を持つ辺があれば列挙） */}
      {notes.map((f, i) => (
        <div key={`note-${i}`} title={f.note} style={{ fontSize: META_PX, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 14 }}>
          補足: {f.note}
        </div>
      ))}
    </div>
  );
}

function RecipientCard({
  recipient, expanded, onToggle, totalAmount, barColor, scaleFont,
}: {
  recipient: BlockRecipient;
  expanded: boolean;
  onToggle: () => void;
  totalAmount: number;
  barColor: string;
  scaleFont: (px: number) => number;
}) {
  const hasDetails = recipient.contractSummaries.length > 0 || recipient.expenses.length > 0;
  const share = totalAmount > 0 ? Math.max(2, Math.min(100, (recipient.amount / totalAmount) * 100)) : 0;
  const PANEL_LIST_NAME_FONT_PX = scaleFont(PANEL_LIST_NAME_FONT_PX_DEFAULT);
  const PANEL_LIST_VALUE_FONT_PX = scaleFont(PANEL_LIST_VALUE_FONT_PX_DEFAULT);
  const PANEL_META_FONT_PX = scaleFont(PANEL_META_FONT_PX_DEFAULT);

  return (
    <div style={{
      borderBottom: '1px solid #f1f5f9',
      fontSize: PANEL_LIST_NAME_FONT_PX,
    }}>
      <div
        style={{
          padding: '7px 0',
          background: 'transparent',
          cursor: hasDetails ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div title={recipient.name || '（氏名なし）'} style={{ flex: 1, minWidth: 0, fontWeight: 400, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recipient.name || '（氏名なし）'}</div>
            <div style={{ color: '#555', fontSize: PANEL_LIST_VALUE_FONT_PX, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(recipient.amount)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <div style={{ width: 52, height: 3, background: '#eef2f7', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ width: `${share}%`, height: '100%', background: barColor }} />
            </div>
            <div style={{ color: '#999', fontSize: PANEL_META_FONT_PX, whiteSpace: 'nowrap' }}>構成比 {percentOf(recipient.amount, totalAmount)}</div>
          </div>
          {recipient.corporateNumber && (
            <div style={{ color: '#aaa', fontSize: PANEL_META_FONT_PX, marginTop: 1 }}>法人番号: {recipient.corporateNumber}</div>
          )}
        </div>
        {hasDetails && (
          <span style={{ color: '#aaa', fontSize: 12, marginTop: 1, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '0 0 8px 60px', background: '#fff' }}>
          {recipient.contractSummaries.map((cs, j) => (
            <div key={j} style={{ color: '#555', marginBottom: 4, lineHeight: 1.5 }}>{cs}</div>
          ))}
          {recipient.expenses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: PANEL_META_FONT_PX, fontWeight: 600, color: '#888', marginBottom: 4 }}>費目・使途</div>
              {recipient.expenses.map((e, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#555', gap: 8 }}>
                  <span style={{ color: '#777', minWidth: 0 }}>{e.category} / {e.purpose}</span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 500, color: '#555' }}>{formatYen(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── メインページ ──────────────────────────────────────────────

function SubcontractDetailPageInner() {
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const projectId = params.projectId;
  const parsedYear = Number.parseInt(searchParams.get('year') ?? '2025', 10);
  const year = parsedYear === 2024 || parsedYear === 2025 ? parsedYear : 2025;
  // マウント時のURL(sel/tab/z/tx/ty)を一度だけ捕捉。データ読み込み後の初回復元にのみ使う
  // （sel/tab の復元先はグラフ読み込み完了時、z/tx/ty の復元先は初回フィット時と別タイミングのため、
  //   オブジェクト自体は読み取り専用で保持し、消費側は各々の「適用済み」refで一度きりに制御する）
  const initialUrlStateRef = useRef<Partial<DetailUrlState> | null>(null);
  if (initialUrlStateRef.current === null) initialUrlStateRef.current = parseDetailUrlState(searchParams);
  const selRestoredRef = useRef(false);
  const viewportRestoredRef = useRef(false);
  // resetViewport() 呼び出しがURL復元由来か（=書き込み抑制すべきか）を伝えるフラグ
  const suppressViewportWriteRef = useRef(false);

  const [graph, setGraph] = useState<SubcontractGraph | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [orgChain, setOrgChain] = useState<string[]>([]);
  // undefined = fetch中（ブロックは非表示）、null = スコアなし確定。メイン画面と同じ作法
  const [policyView, setPolicyView] = useState<PolicyEvaluationView | null | undefined>(undefined);
  // 取得失敗を黙って隠さない（サンキー図と同じ扱い）
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockNode | null>(null);
  // ホバーはサンキーと同じ流儀: 進入は遅延、離脱は即時。パン/ズーム直後は抑制する
  const [hoveredNodeRaw, setHoveredNodeRaw] = useState<HoveredNode | null>(null);
  // カードのホバー枠色は即時反映（ツールチップの表示遅延とは別系統）
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  // フロー図（B案）のリボンホバー（sankeyの hoveredLink 流儀）。key = `${sourceBlock ?? 'root'}->${targetBlock}-${index}`
  const [hoveredRibbonFlowKey, setHoveredRibbonFlowKey] = useState<string | null>(null);
  const [hoveredNodeStable, setHoveredNodeStable] = useState<HoveredNode | null>(null);
  const hoverEnterTimerRef = useRef<number | null>(null);
  const [isHoverSuppressed, setIsHoverSuppressed] = useState(false);
  const hoverSuppressTimerRef = useRef<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<PaneTab>('flow');
  // 表示切り替え: フロー図（サンキー風横フロー・既定）/ ブロック図（縦ブロック図）。
  // 既定をフロー図にすることで、初期表示が /sankey-svg と同じ「左パネル＋横フロー」になる。
  // URL `view=block` でブロック図を復元（既定は省略）
  const [viewMode, setViewModeState] = useState<ViewMode>('ribbon');
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    replaceViewUrl(mode);
  }, []);
  // サイドパネルの chrome 状態。表示位置はビューモードに連動する:
  // ブロック図(A案)=右（既存の配置を維持）、フロー図(B案)=左（/sankey-svg と同じ配置）。
  // 幅・折りたたみ状態は useSidePanel が side をまたいで共有するため、ビュー切替をまたいでも保持される
  const sidePanelSide: 'left' | 'right' = viewMode === 'ribbon' ? 'left' : 'right';
  const sidePanel = useSidePanel({ side: sidePanelSide, defaultWidth: SUBCONTRACT_PANEL_WIDTH_DEFAULT });
  // 左下・左上のフローティングUI（一覧リンク・凡例・フォントサイズ操作）は、パネルが左表示の
  // ときだけ退避オフセットが必要（サンキーの left: selectedNodeId... と同じ流儀）
  const leftFloatOffset = sidePanelSide === 'left' && !sidePanel.collapsed ? sidePanel.effectiveWidth + 12 : 12;
  // 基準フォントサイズ（サンキーと同じ localStorage 永続化方式。キーはページごとに分離）
  const [baseFontPx, setBaseFontPx] = useBaseFontPx(
    'subcontracts-detail-base-font-px', BASE_FONT_PX_DEFAULT, BASE_FONT_PX_MIN, BASE_FONT_PX_MAX,
  );
  const scaleFont = useMemo(() => createScaleFont(baseFontPx), [baseFontPx]);

  const beginHoverSuppressCooldown = useCallback(() => {
    setIsHoverSuppressed(true);
    if (hoverSuppressTimerRef.current) window.clearTimeout(hoverSuppressTimerRef.current);
    hoverSuppressTimerRef.current = window.setTimeout(() => setIsHoverSuppressed(false), HOVER_SUPPRESS_AFTER_INTERACTION_MS);
  }, []);

  useEffect(() => {
    if (hoverEnterTimerRef.current) {
      window.clearTimeout(hoverEnterTimerRef.current);
      hoverEnterTimerRef.current = null;
    }
    // 離脱は即時、進入は遅延（マウス通過時の意図しないポップアップ抑制）
    if (hoveredNodeRaw === null) {
      setHoveredNodeStable(null);
      return;
    }
    hoverEnterTimerRef.current = window.setTimeout(() => {
      setHoveredNodeStable(hoveredNodeRaw);
    }, HOVER_ENTER_DELAY_MS);
    return () => {
      if (hoverEnterTimerRef.current) {
        window.clearTimeout(hoverEnterTimerRef.current);
        hoverEnterTimerRef.current = null;
      }
    };
  }, [hoveredNodeRaw]);

  useEffect(() => () => {
    if (hoverSuppressTimerRef.current) window.clearTimeout(hoverSuppressTimerRef.current);
  }, []);

  // 選択解除（案C1）: Esc / パネルヘッダ✕ / キャンバス空白クリック / ルートノードクリックで共通利用。
  // アクティブタブは変更しない
  const handleDeselect = useCallback(() => {
    setSelectedBlock(null);
    pushSelTabUrl(null, activeTab);
  }, [activeTab]);

  // ノードクリック: 選択のみを変更する（案C1）。アクティブタブは動かさない。
  // 同一ノードの再クリックはトグル解除せず選択を維持する
  // 図中ノード（フロー図バー/ブロック図カード）クリック（Phase 4）。
  // 選択すると同時に支出先タブへ切り替え、そのブロックの支出先内訳（深掘り）を即表示する。
  // ブロックインスペクター（左パネル上部）＋支出先タブ内訳で「ノードのインスペクター」を構成する。
  const handleNodeClick = useCallback((node: BlockNode) => {
    setSelectedBlock(node);
    setActiveTab('recipients');
    pushSelTabUrl(node.blockId, 'recipients');
  }, []);

  // 間接経費ノード（支出先を持たない終端）クリック: ブロック選択を解除し、間接経費タブへ切り替える
  const handleIndirectClick = useCallback(() => {
    setSelectedBlock(null);
    setActiveTab('indirect-cost');
    pushSelTabUrl(null, 'indirect-cost');
  }, []);

  // フロー一覧/ブロック一覧の行から選択した場合は選択のみを変更する（タブは動かさない）
  const handleSelectFromList = useCallback((node: BlockNode) => {
    setSelectedBlock(node);
    pushSelTabUrl(node.blockId, activeTab);
  }, [activeTab]);

  // Esc キーで選択解除（input/textarea/select フォーカス中は無視。サンキーの作法に合わせる）
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      handleDeselect();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeselect]);

  // ズーム/パン
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [baseZoom, setBaseZoom] = useState(1);
  // フロー図の横スケール（zoom非依存・4列固定ピッチ）。resetViewport / URL復元時に可視幅から算出して保持。
  // 縦は transform.scale(zoom) が担い、横はこの値で「画面上の列位置」を zoom不変に固定する。
  const [horizontalScale, setHorizontalScale] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  // スクロールモード: 'zoom' = 素のスクロールでズーム（既定）/ 'pan' = 素のスクロールで移動、
  // Ctrl/Cmd+スクロールでズーム（/sankey-svg と同じトグル）
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const bgMouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedBlock(null);
    setActiveTab('flow');
    setHoveredNodeRaw(null);
    setProjectDetail(null);
    setOrgChain([]);
    fetch(`/api/subcontracts/${projectId}?year=${year}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SubcontractGraph) => {
        if (controller.signal.aborted) return;
        setGraph(data);
        // 主語は「事業」。ブロック選択はユーザーの明示クリックを起点とする。
        // ただしマウント時にURLへ sel/tab があれば復元する（存在しないblockIdは無視）。
        // この復元は最初の読み込みでのみ行い、以降の年度/事業切替では適用しない
        if (!selRestoredRef.current) {
          selRestoredRef.current = true;
          const restore = initialUrlStateRef.current;
          const restoredBlock = restore?.sel ? data.blocks.find((b) => b.blockId === restore.sel) ?? null : null;
          setSelectedBlock(restoredBlock);
          // 案C1: タブは URL の tab（=最後にユーザーが選んだタブ）をそのまま復元する。
          // tab 省略時は既定の 'flow'（selがあっても recipients へ自動遷移しない）
          setActiveTab(restore?.tab ?? 'flow');
          setViewModeState(restore?.view ?? 'ribbon');
        } else {
          setSelectedBlock(null);
        }
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, year]);

  useEffect(() => {
    if (!graph) return;
    const controller = new AbortController();
    fetch(`/api/project-details/${projectId}?year=${year}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: ProjectDetail | null) => {
        if (controller.signal.aborted) return;
        setProjectDetail(data);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setProjectDetail(null);
      });
    return () => controller.abort();
  }, [graph, projectId, year]);

  useEffect(() => {
    if (!graph) return;
    setPolicyView(undefined);   // 事業/年度切替時は fetch中（非表示）に戻す
    setPolicyError(null);
    const controller = new AbortController();
    // 組織階層は品質スコアの1事業分から取る（従来は全件 9MB を落としていた）
    fetch(`/api/quality-scores/${projectId}?year=${year}&full=1`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { score?: ProjectQualityOrg } | null) => {
        if (controller.signal.aborted) return;
        const item = data?.score;
        setOrgChain(item
          ? [item.bureau, item.division, item.section, item.office, item.team, item.unit]
              .map((v) => v?.trim() ?? '')
              .filter(Boolean)
          : []);
      })
      .catch((e: Error) => { if (e.name !== 'AbortError') setOrgChain([]); });
    // 政策評価は母集団依存のためサーバ側で全件計算した結果を1事業だけ引く
    fetch(`/api/policy-summary?year=${year}&pid=${projectId}`, { signal: controller.signal })
      .then((r) => {
        if (r.ok) return r.json();
        // 404 =「その事業の評価が無い」＝確定。それ以外は失敗として表示する
        if (r.status === 404) return null;
        throw new Error(String(r.status));
      })
      .then((data: { evaluation?: PolicyEvaluation } | null) => {
        if (controller.signal.aborted) return;
        const e = data?.evaluation;
        setPolicyView(e ? {
          overall: e.overallScore,
          proportionality: e.proportionalityScore,
          necessity: e.necessityScore,
          recommendation: e.recommendation,
          improvementAction: e.improvementAction,
          categoryLabel: e.policyCategoryLabel,
        } : null);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setPolicyError(err.message || '取得失敗');
        setPolicyView(null);
      });
    return () => controller.abort();
  }, [graph, projectId, year]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    beginHoverSuppressCooldown();

    const doZoom = (dy: number, clientX: number, clientY: number) => {
      setTransform((prev) => {
        const factor = dy > 0 ? 0.9 : 1.1;
        const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
        const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
        const newScale = Math.max(minZoom, Math.min(maxZoom, prev.scale * factor));
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return { ...prev, scale: newScale };
        const cy = clientY - rect.top;
        const cx = clientX - rect.left;
        // ribbon図は横スケールが transform.scale に依存しない（ix/iw で打ち消す）ため pan.x を据え置き、
        // 縦のみカーソルアンカー。block図は生座標を一様スケールで描くため、横もカーソルに再アンカーする。
        return {
          scale: newScale,
          x: viewMode === 'ribbon' ? prev.x : cx - (cx - prev.x) * (newScale / prev.scale),
          y: cy - (cy - prev.y) * (newScale / prev.scale),
        };
      });
    };

    if (scrollMode === 'zoom') {
      doZoom(e.deltaY, e.clientX, e.clientY);
    } else {
      // 移動モード: Ctrl/Cmd+スクロール = ズーム、それ以外 = パン
      if (e.ctrlKey || e.metaKey) {
        doZoom(e.deltaY, e.clientX, e.clientY);
      } else {
        const speed = 1.2;
        setTransform((prev) => ({ ...prev, x: prev.x - e.deltaX * speed, y: prev.y - e.deltaY * speed }));
      }
    }
  }, [beginHoverSuppressCooldown, baseZoom, scrollMode, viewMode]);

  useEffect(() => {
    if (!graph) return; // SVGがレンダリングされるまで待つ
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, graph]);

  // ページタイトル
  useEffect(() => {
    if (graph) document.title = `再委託 ${graph.projectName}`;
    return () => { document.title = '再委託構造ブラウザ'; };
  }, [graph]);

  // Hooks はすべて early return より前に呼ぶ必要がある
  const fallbackOrgChain = useMemo(() => {
    const bureau = projectDetail?.bureau?.trim();
    return bureau ? [bureau] : [];
  }, [projectDetail]);
  const visibleOrgChain = orgChain.length > 0 ? orgChain : fallbackOrgChain;

  const layout = useMemo(() => graph ? computeSubcontractLayout(graph) : null, [graph]);
  // B案（フロー図）のレイアウト。A案とは独立に計算するが computeDepths/mergeParallelFlows は共通利用
  const ribbonLayout = useMemo(() => graph ? computeSubcontractRibbonLayout(graph) : null, [graph]);
  // 間接経費の集計。フロー図（終端ノードのツールチップ）と側パネルで同じ値を使い、
  // マウス移動によるツールチップ再描画のたびに再計算されないよう memo 化する
  const indirectSummary = useMemo(() => summarizeOffFlowIndirectCosts(graph?.indirectCosts), [graph]);
  // エッジ太さスケールの基準（このグラフ内の最大ブロック金額）
  const maxBlockAmount = useMemo(
    () => layout ? Math.max(0, ...layout.blocks.map((b) => b.totalAmount)) : 0,
    [layout],
  );
  // ズーム/パンのフィット計算に使う「現在のビューのコンテンツサイズ」（参照安定化のため useMemo で保持）
  const activeContentSize = useMemo(() => {
    if (viewMode === 'ribbon') return ribbonLayout ? { w: ribbonLayout.svgWidth, h: ribbonLayout.svgHeight } : null;
    return layout ? { w: layout.svgWidth, h: layout.svgHeight } : null;
  }, [viewMode, layout, ribbonLayout]);

  const applyZoom = useCallback((factor: number) => {
    setTransform((prev) => {
      const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
      const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
      const newScale = Math.max(minZoom, Math.min(maxZoom, prev.scale * factor));
      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const cy = container.clientHeight / 2;
      const cx = container.clientWidth / 2;
      // ribbon図は横 zoom不変（pan.x 据え置き）、block図は生座標のため横も中央アンカーで再計算。縦は共通で中央アンカー。
      return {
        scale: newScale,
        x: viewMode === 'ribbon' ? prev.x : cx - (cx - prev.x) * (newScale / prev.scale),
        y: cy - (cy - prev.y) * (newScale / prev.scale),
      };
    });
  }, [baseZoom, viewMode]);

  const resetViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || !activeContentSize) return;
    // サイドパネルは position:fixed のオーバーレイで flex レイアウトの外にあるため、
    // container.clientWidth はパネルを含む全幅になる。フィット計算はパネルが開いている側の
    // 幅を差し引いた「実際に見える領域」を基準にしないと、コンテンツの端（ルートカード等）が
    // パネルの下に隠れてしまう（特にリボンビューは既定でパネルが左に開いているため顕著）
    const reserveLeft = sidePanelSide === 'left' && !sidePanel.collapsed ? sidePanel.effectiveWidth : 0;
    const reserveRight = sidePanelSide === 'right' && !sidePanel.collapsed ? sidePanel.effectiveWidth : 0;
    const cW = Math.max(100, container.clientWidth - reserveLeft - reserveRight);
    const cH = container.clientHeight;
    if (viewMode === 'ribbon') {
      // 横縦分離: 横は「可視幅に4列」の固定ピッチ（zoom非依存）、縦のみ高さフィットで baseZoom を決める。
      // pan.x は可視領域左端に左寄せ（予算・執行列が左端）。横フィットはしない（5列以上はオーバーフロー）。
      const { horizontalScale: hScale, baseZoom: fitZoomV } = computeRibbonFit(cW, cH, activeContentSize.h);
      setHorizontalScale(hScale);
      setBaseZoom(fitZoomV);
      setTransform({
        x: reserveLeft,
        y: (cH - activeContentSize.h * fitZoomV) / 2,
        scale: fitZoomV,
      });
      return;
    }
    // ブロック図（別経路）は従来どおり一様フィット。
    const fitZoom = Math.max(0.05, Math.min(10, Math.min(cW / activeContentSize.w, cH / activeContentSize.h) * 0.9));
    setHorizontalScale(1);
    setBaseZoom(fitZoom);
    setTransform({
      x: reserveLeft + (cW - activeContentSize.w * fitZoom) / 2,
      y: (cH - activeContentSize.h * fitZoom) / 2,
      scale: fitZoom,
    });
  }, [activeContentSize, sidePanelSide, sidePanel.collapsed, sidePanel.effectiveWidth, viewMode]);

  // グラフ読み込み後に全体表示。ただし最初の1回はURLにz/tx/tyがあればそれを優先復元する
  useEffect(() => {
    if (!activeContentSize) return;
    const container = containerRef.current;
    if (!viewportRestoredRef.current) {
      viewportRestoredRef.current = true;
      const restore = initialUrlStateRef.current;
      if (container && restore?.zoom !== undefined && restore.tx !== undefined && restore.ty !== undefined) {
        const cW = container.clientWidth;
        const cH = container.clientHeight;
        suppressViewportWriteRef.current = true;
        if (viewMode === 'ribbon') {
          // 横スケールは可視幅から再算出（URLには保存しない）。縦の baseZoom は高さフィット基準。
          const fit = computeRibbonFit(cW, cH, activeContentSize.h);
          setHorizontalScale(fit.horizontalScale);
          setBaseZoom(fit.baseZoom);
        } else {
          setHorizontalScale(1);
          setBaseZoom(Math.max(0.05, Math.min(10, Math.min(cW / activeContentSize.w, cH / activeContentSize.h) * 0.9)));
        }
        setTransform({ x: restore.tx, y: restore.ty, scale: restore.zoom });
        return;
      }
    }
    suppressViewportWriteRef.current = true;
    resetViewport();
  }, [activeContentSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ズーム/パンのURL同期。手動操作（ホイール/ボタン/ドラッグ）による変化のみ書き込む
  // （resetViewport起因の自動フィットは suppressViewportWriteRef で抑制）。history.replaceState、debounce後に反映
  useEffect(() => {
    if (!activeContentSize) return;
    if (suppressViewportWriteRef.current) { suppressViewportWriteRef.current = false; return; }
    const timer = window.setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      p.set('z', transform.scale.toFixed(2));
      p.set('tx', String(Math.round(transform.x)));
      p.set('ty', String(Math.round(transform.y)));
      const qs = p.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeContentSize intentionally excluded; only transform changes should retrigger this write
  }, [transform.scale, transform.x, transform.y]);

  // ブラウザバック/フォワードで sel/tab を復元する（同一ページ内の履歴移動。z/tx/tyも併せて反映）
  useEffect(() => {
    function onPopState() {
      const s = parseDetailUrlState(new URLSearchParams(window.location.search));
      if (s.sel) {
        const found = graph?.blocks.find((b) => b.blockId === s.sel) ?? null;
        setSelectedBlock(found);
      } else {
        setSelectedBlock(null);
      }
      setActiveTab(s.tab ?? 'flow');
      setViewModeState(s.view ?? 'ribbon');
      if (s.zoom !== undefined && s.tx !== undefined && s.ty !== undefined) {
        suppressViewportWriteRef.current = true;
        setTransform({ x: s.tx, y: s.ty, scale: s.zoom });
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [graph]);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    bgMouseDownPosRef.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (!isPanning.current) return;
    beginHoverSuppressCooldown();
    setTransform((prev) => ({ ...prev, x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }));
  }
  function onMouseUp() {
    if (isPanning.current) beginHoverSuppressCooldown();
    isPanning.current = false;
  }
  // キャンバス空白部のクリックで選択解除（案C1）。ノード上のクリックは e.target !== e.currentTarget で除外し、
  // パン操作（mousedown→mouseupの間に動いたドラッグ）はしきい値を超えた移動量で除外する
  const BACKGROUND_CLICK_DRAG_THRESHOLD_PX = 4;
  function onSvgBackgroundClick(e: React.MouseEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const start = bgMouseDownPosRef.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > BACKGROUND_CLICK_DRAG_THRESHOLD_PX) return;
    }
    handleDeselect();
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <p style={{ color: '#6b7280' }}>読み込み中...</p>
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', gap: 12 }}>
        <p style={{ color: '#ef4444' }}>エラー: {error ?? 'データなし'}</p>
        <Link href="/subcontracts" style={{ color: '#4a90d9', fontSize: 14 }}>← 一覧に戻る</Link>
      </div>
    );
  }

  // ここに到達した時点で graph は必ず非 null
  const safeLayout = layout!;
  const safeRibbonLayout = ribbonLayout!;
  // ラベルが次列のバーへ食い込まないよう、列ごとに clipPath でラベル領域を切り取る
  // （sankey の clip-col-* と同じ流儀）。最終列だけはラベルが右マージンへ自由に伸びてよい
  const ribbonMaxDepth = safeRibbonLayout.bars.length > 0 ? Math.max(...safeRibbonLayout.bars.map((b) => b.depth)) : 0;
  // 予算・執行ノード列がある場合のみ、事業(depth0相当)以降を1列右へずらす。
  // 予算データが無い事業ではオフセットせず、レイアウト側 CONTENT_BASE_X と整合させる。
  const ribbonHasBudgetCol = safeRibbonLayout.root.budgetH != null;
  const ribbonColX = (depth: number) => RIBBON_MARGIN.left + (depth + (ribbonHasBudgetCol ? 1 : 0)) * (RIBBON_COL_W + RIBBON_COL_GAP);
  // フロー図ラベルはメイン流儀で画面上ほぼ一定サイズにする。scaled <g> 内なので
  // fontSize を transform.scale で割って群のスケールを打ち消し、getZoomLabelScale で
  // baseZoom 超のズームイン時に最大 ZOOM_FONT_MAX_RATIO 倍まで拡大する。
  const ribbonZoomLabelScale = getZoomLabelScale(transform.scale, baseZoom);
  const ribbonLabelFont = (px: number) => scaleFont(px) * ribbonZoomLabelScale / transform.scale;
  // 横縦分離の座標変換（メインの screenToInnerX / screenWToInner 相当）。
  // 群は translate(pan) scale(transform.scale) されるので、横座標/幅を横スケール倍して
  // transform.scale で割り戻すと、群の scale(zoom) を打ち消して「画面上の横位置は zoom不変」
  // になる。縦(y・高さ)は素のレイアウト座標のまま群の scale(zoom) で拡大させる。
  const ix = (x: number) => (x * horizontalScale) / transform.scale;
  const iw = (w: number) => (w * horizontalScale) / transform.scale;
  // ラベル衝突回避（メインの nodeShiftInfo 相当）。列ごとに「最小ラベルスロット高」を確保し、
  // 高さがそれに満たない少額ノードは下方向へ余白を足して（cumShift）ラベルの重なりを防ぐ。
  // ノード自身は拡張スロットの中央（topShift）に置く。zoom連動：拡大でノードが十分高くなれば
  // スロット拡張は不要になり、縮小時ほど余白が増える（＝ズームでノード縦間隔が変化する）。
  const ribbonLabelSlotPx = scaleFont(RIBBON_LABEL_SLOT_PX_BASE) * ribbonZoomLabelScale;
  const ribbonColShifts = (items: { y: number; h: number }[]): number[] => {
    // items は y昇順である前提。返す値は各ノードに足す縦シフト（cumShift + topShift）。
    const out: number[] = [];
    let cum = 0;
    for (const it of items) {
      const slotExtra = it.h * transform.scale < ribbonLabelSlotPx
        ? Math.max(0, ribbonLabelSlotPx / transform.scale - it.h)
        : 0;
      out.push(cum + slotExtra / 2);
      cum += slotExtra;
    }
    return out;
  };
  // ブロックバー: 深度（＝視覚的な列）ごとに y昇順で衝突回避シフトを算出
  const ribbonBarShift = new Map<string, number>();
  {
    // 間接経費ノード（深度1列の最下段）も同じ列の衝突回避に含める。含めないと、
    // 少額ブロックの下方シフト分だけ終端ノードと重なる
    type ShiftItem = { key: string; depth: number; y: number; h: number };
    const items: ShiftItem[] = safeRibbonLayout.bars.map((b) => ({ key: b.blockId, depth: b.depth, y: b.y, h: b.h }));
    const iNode = safeRibbonLayout.indirectNode;
    if (iNode) items.push({ key: iNode.key, depth: 1, y: iNode.y, h: iNode.h });
    const byDepth = new Map<number, ShiftItem[]>();
    for (const item of items) {
      const arr = byDepth.get(item.depth);
      if (arr) arr.push(item); else byDepth.set(item.depth, [item]);
    }
    for (const group of byDepth.values()) {
      const sorted = [...group].sort((a, b) => a.y - b.y);
      const shifts = ribbonColShifts(sorted.map((b) => ({ y: b.y, h: b.h })));
      sorted.forEach((b, i) => ribbonBarShift.set(b.key, shifts[i]));
    }
  }
  const ribbonIndirectShift = safeRibbonLayout.indirectNode
    ? ribbonBarShift.get(safeRibbonLayout.indirectNode.key) ?? 0
    : 0;
  // 予算・執行列（上から積まれているので配列順＝y昇順）
  const ribbonBudgetShifts = ribbonColShifts(safeRibbonLayout.budgetItems.map((b) => ({ y: b.y, h: b.h })));
  // フロー端点用: ブロックID→シフト（root=null はシフト0）
  const ribbonShiftOf = (blockId: string | null): number => (blockId === null ? 0 : ribbonBarShift.get(blockId) ?? 0);
  return (
    <div style={{ display: 'flex', height: '100vh', background: COLOR_CANVAS, overflow: 'hidden' }}>
      {/* SVGキャンバス */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: COLOR_CANVAS,
        }}
      >
        {/* 一覧へ戻る — 左上（サイドパネルが左表示のときは退避） */}
        <div style={{ position: 'absolute', top: 12, left: leftFloatOffset, zIndex: 15, transition: sidePanel.isResizing ? 'none' : 'left 0.2s ease' }}>
          <Link
            href={`/subcontracts?year=${year}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 13,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#333',
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            ← 一覧
          </Link>
        </div>

        {/* 年度切替 — 上部中央 */}
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
          <select
            value={year}
            onChange={(e) => router.push(`/subcontracts/${projectId}?year=${e.target.value}`)}
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

        {/* 表示切り替え — 年度ピルの右隣（フロー図=既定 / ブロック図） */}
        <div
          data-pan-disabled="true"
          style={{
            position: 'absolute',
            top: 12,
            left: 'calc(50% + 108px)',
            zIndex: 15,
            display: 'flex',
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          {([
            ['ribbon', 'フロー図'],
            ['block', 'ブロック図'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={mode === 'block' ? '縦ブロック図' : 'サンキー風横フロー（既定）'}
              style={{
                border: 'none',
                background: viewMode === mode ? '#eff6ff' : 'transparent',
                color: viewMode === mode ? '#1e40af' : '#555',
                fontWeight: viewMode === mode ? 700 : 500,
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ cursor: isPanning.current ? 'grabbing' : 'grab', display: 'block' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={onSvgBackgroundClick}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {viewMode === 'block' && (
          <>
            {/* 順方向エッジ */}
            {safeLayout.edges.filter(e => !e.isBackEdge).map((edge, i) => {
              const target = safeLayout.blocks.find((b) => b.blockId === edge.targetBlock);
              const amountLabel = target && target.totalAmount > 0 ? formatYen(target.totalAmount) : null;
              const edgeStyle = flowEdgeStyle(edge.origin);
              const edgeColor = edgeStyle.stroke;
              // 線幅は金額（対象ブロックの totalAmount）に応じてスケール（平方根スケール 2〜10px）
              const edgeWidth = target ? edgeWidthForAmount(target.totalAmount, maxBlockAmount) : edgeStyle.width;
              const labelX = (edge.x1 + edge.x2) / 2;
              const labelY = (edge.y1 + edge.y2) / 2 - 8;
              const labelW = 140;
              const labelH = amountLabel && edge.note ? 30 : 18;
              return (
                <g key={`fwd-${i}`}>
                  <path
                    d={verticalBezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                    fill="none"
                    stroke={edgeColor}
                    strokeWidth={edgeWidth}
                    strokeDasharray={edgeStyle.dasharray}
                    strokeLinecap="round"
                  />
                  {(amountLabel || edge.note) && (
                    <foreignObject
                      x={labelX - labelW / 2}
                      y={labelY - labelH / 2}
                      width={labelW}
                      height={labelH}
                      style={{ pointerEvents: 'none' }}
                    >
                      <div style={{
                        width: labelW,
                        height: labelH,
                        boxSizing: 'border-box',
                        background: 'rgba(255,255,255,0.88)',
                        border: '1px solid rgba(148,163,184,0.5)',
                        borderRadius: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1px 6px',
                        fontFamily: 'inherit',
                      }}>
                        {amountLabel && (
                          <div style={{ fontSize: scaleFont(9), fontWeight: 700, color: '#475569', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {amountLabel}
                          </div>
                        )}
                        {edge.note && (
                          <div style={{ fontSize: scaleFont(8), fontWeight: 600, color: '#64748b', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {edge.note}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {/* バックエッジ（循環・参照フロー） */}
            {safeLayout.edges.filter(e => e.isBackEdge).map((edge, i) => (
              <g key={`back-${i}`}>
                <path
                  d={edge.isSelfLoop
                    ? selfLoopPath(edge.x1, edge.y1)
                    : backEdgePath(edge.x1, edge.y1, edge.x2, edge.y2)}
                  fill="none"
                  stroke={COLOR_BACK_EDGE}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
              </g>
            ))}

            {/* 事業コンテキストノード */}
            <g
              onClick={handleDeselect}
              onMouseEnter={() => setHoveredNodeRaw({ kind: 'root' })}
              onMouseLeave={() => setHoveredNodeRaw(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={safeLayout.root.x}
                y={safeLayout.root.y}
                width={safeLayout.root.w}
                height={safeLayout.root.h}
                rx={CARD_RADIUS}
                fill="transparent"
                style={{ pointerEvents: 'all' }}
              />
              <path
                d={roundedTopPath(
                  safeLayout.root.x,
                  safeLayout.root.y,
                  safeLayout.root.w,
                  56,
                  CARD_RADIUS,
                )}
                fill={COLOR_ROOT}
                stroke={COLOR_ROOT}
                strokeWidth={CARD_BORDER_W}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              <path
                d={roundedBottomPath(
                  safeLayout.root.x,
                  safeLayout.root.y + 56,
                  safeLayout.root.w,
                  safeLayout.root.h - 56,
                  CARD_RADIUS,
                )}
                fill={COLOR_CONTEXT_BODY}
                stroke={COLOR_ROOT}
                strokeWidth={CARD_BORDER_W}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              <foreignObject
                x={safeLayout.root.x + 14}
                y={safeLayout.root.y + 6}
                width={safeLayout.root.w - 28}
                height={44}
                style={{ pointerEvents: 'none' }}
              >
                <div style={{ fontFamily: 'inherit', userSelect: 'none' }}>
                  <div style={{ fontSize: scaleFont(9), fontWeight: 700, color: 'rgba(255,255,255,0.78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    事業 / PID {graph.projectId}
                  </div>
                  <div style={{ fontSize: scaleFont(11), fontWeight: 700, color: '#fff', lineHeight: `${scaleFont(13)}px`, marginTop: 3, ...CLAMP_2_LINES }}>
                    {graph.projectName}
                  </div>
                </div>
              </foreignObject>
              <foreignObject
                x={safeLayout.root.x + 14}
                y={safeLayout.root.y + 60}
                width={safeLayout.root.w - 28}
                height={44}
                style={{ pointerEvents: 'none' }}
              >
                <div style={{ fontFamily: 'inherit', fontSize: scaleFont(9), userSelect: 'none' }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, color: COLOR_CONTEXT_BODY_SUBTLE, flexShrink: 0, width: 48 }}>府省庁</span>
                    <span style={{ fontWeight: 700, fontSize: scaleFont(10), color: COLOR_CONTEXT_BODY_TEXT, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {graph.ministry}
                    </span>
                  </div>
                  {visibleOrgChain.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginTop: 4 }}>
                      <span style={{ fontWeight: 700, color: COLOR_CONTEXT_BODY_SUBTLE, flexShrink: 0, width: 48 }}>担当組織</span>
                      <span style={{ fontWeight: 600, color: COLOR_CONTEXT_BODY_TEXT, minWidth: 0, flex: 1, lineHeight: `${scaleFont(11)}px`, ...CLAMP_2_LINES }}>
                        {visibleOrgChain.map((v, i) => `${ORG_LEVEL_LABELS[i] ?? '組織'}:${v}`).join(' / ')}
                      </span>
                    </div>
                  )}
                </div>
              </foreignObject>
              <text
                x={safeLayout.root.x + safeLayout.root.w - 14}
                y={safeLayout.root.y + safeLayout.root.h - 24}
                textAnchor="end"
                fontSize={scaleFont(9)}
                fontWeight={700}
                fill={COLOR_CONTEXT_BODY_SUBTLE}
                style={{ userSelect: 'none' }}
              >
                <tspan x={safeLayout.root.x + safeLayout.root.w - 14}>予算 {graph.budget > 0 ? formatYen(graph.budget) : '—'}</tspan>
                <tspan x={safeLayout.root.x + safeLayout.root.w - 14} dy={scaleFont(12)}>支出 {graph.execution > 0 ? formatYen(graph.execution) : '—'}</tspan>
              </text>
            </g>

            {/* ブロックノード（縦型カードフロー） */}
            {safeLayout.blocks.map((lb) => {
              const isSelected = selectedBlock?.blockId === lb.blockId;
              const isHovered = hoveredBlockId === lb.blockId;
              const palette = originPalette(lb.originKind);
              const nodeColor = palette.header;
              // カード本体は白背景（意味色はヘッダ帯・ボーダーで表現。メイン画面のフラットな作法に統一）
              const bodyFill = '#fff';
              const bodyTextColor = palette.bodyText;
              const bodySubtleTextColor = palette.bodySubtle;
              const recipients = lb.node.recipients;
              const topRecipients = sortRecipients(recipients, 'amount-desc').slice(0, 3);
              const selectedStroke = palette.selectedStroke;
              const headerKindLabel = palette.badgeText;
              // ボディ枠: 既定は控えめなグレー、ホバーでアクセント色、選択時は強調色
              const bodyBorderColor = isSelected ? selectedStroke : (isHovered ? nodeColor : CARD_BORDER_NEUTRAL);

              return (
                <g
                  key={lb.blockId}
                  onClick={() => handleNodeClick(lb.node)}
                  onMouseEnter={() => { setHoveredNodeRaw({ kind: 'block', block: lb.node }); setHoveredBlockId(lb.blockId); }}
                  onMouseLeave={() => { setHoveredNodeRaw(null); setHoveredBlockId(null); }}
                  style={{ cursor: 'pointer', filter: CARD_SHADOW }}
                >
                  {isSelected && (
                    <rect
                      x={lb.x - 3}
                      y={lb.y - 3}
                      width={lb.w + 6}
                      height={lb.h + 6}
                      rx={CARD_RADIUS + 3}
                      fill="none"
                      stroke={CARD_SELECTED_RING}
                      strokeWidth={4}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <rect
                    x={lb.x}
                    y={lb.y}
                    width={lb.w}
                    height={lb.h}
                    rx={CARD_RADIUS}
                    fill="transparent"
                    style={{ pointerEvents: 'all' }}
                  />

                  <path
                    d={roundedTopPath(
                      lb.x,
                      lb.y,
                      lb.w,
                      CARD_HEADER_H,
                      CARD_RADIUS,
                    )}
                    fill={nodeColor}
                    stroke={nodeColor}
                    strokeWidth={CARD_BORDER_W}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                  <path
                    d={roundedBottomPath(
                      lb.x,
                      lb.y + CARD_HEADER_H,
                      lb.w,
                      lb.h - CARD_HEADER_H,
                      CARD_RADIUS,
                    )}
                    fill={bodyFill}
                    stroke={bodyBorderColor}
                    strokeWidth={CARD_BORDER_W}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />

                  <foreignObject
                    x={lb.x + NODE_PAD}
                    y={lb.y + 4}
                    width={lb.w - NODE_PAD * 2}
                    height={CARD_HEADER_H - 6}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div style={{ fontFamily: 'inherit', userSelect: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: scaleFont(12), fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {lb.blockName}
                        </div>
                        <span style={{
                          flexShrink: 0,
                          fontSize: scaleFont(9),
                          fontWeight: 700,
                          color: '#fff',
                          background: 'rgba(255,255,255,0.26)',
                          borderRadius: 999,
                          padding: '2px 7px',
                        }}>
                          {headerKindLabel}
                        </span>
                      </div>
                      <div style={{ fontSize: scaleFont(9), fontWeight: 600, color: 'rgba(255,255,255,0.78)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ブロック {lb.blockId}
                      </div>
                    </div>
                  </foreignObject>

                  <foreignObject
                    x={lb.x + NODE_PAD}
                    y={lb.y + CARD_HEADER_H + 4}
                    width={lb.w - NODE_PAD * 2}
                    height={lb.h - CARD_HEADER_H - 8}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div style={{ fontFamily: 'inherit', userSelect: 'none' }}>
                      {lb.node.role && (
                        <div style={{ fontSize: scaleFont(9), fontWeight: 500, color: bodySubtleTextColor, marginBottom: 4, lineHeight: `${scaleFont(12)}px`, ...CLAMP_2_LINES }}>
                          {lb.node.role}
                        </div>
                      )}
                      <div style={{ fontSize: scaleFont(11), fontWeight: 700, color: bodyTextColor, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lb.isZeroAmount ? '金額内訳なし' : `${formatYen(lb.totalAmount)} / 支出先 ${recipients.length.toLocaleString()}件`}
                      </div>
                      {!lb.isZeroAmount && topRecipients.map((r, i) => (
                        <div
                          key={`${r.name}-${r.corporateNumber}-${i}`}
                          style={{ display: 'flex', gap: 4, alignItems: 'baseline', fontSize: scaleFont(9), color: bodyTextColor, marginTop: i === 0 ? 6 : 3 }}
                        >
                          <span style={{ fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.name || '（氏名なし）'}
                          </span>
                          <span style={{ fontWeight: 700, color: bodySubtleTextColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {formatYen(r.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </>
          )}

          {viewMode === 'ribbon' && (
          <>
            {/* 列ラベルの clipPath（ラベルが次列のバーへ食い込むのを防ぐ。sankeyのclip-col-*と同じ流儀） */}
            <defs>
              {/* 事業ノードの 予算(緑)｜支出(オレンジ) ドッキング用グラデ（メインの proj-node-grad と同じ 44/56 分割） */}
              <linearGradient id="budget-exec-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={SEMANTIC_PROJECT} />
                <stop offset="44%" stopColor={SEMANTIC_PROJECT} />
                <stop offset="56%" stopColor="#e07040" />
                <stop offset="100%" stopColor="#e07040" />
              </linearGradient>
              {Array.from({ length: ribbonMaxDepth }, (_, i) => i + 1).map((d) => (
                <clipPath id={`ribbon-clip-col-${d}`} key={d}>
                  <rect
                    x={ix(ribbonColX(d) + RIBBON_BAR_W)}
                    y={0}
                    width={iw(Math.max(0, ribbonColX(d + 1) - (ribbonColX(d) + RIBBON_BAR_W)))}
                    height={safeRibbonLayout.svgHeight}
                  />
                </clipPath>
              ))}
            </defs>

            {/* 別財源レーンの区切り線（薄い破線 + ラベル。直接系バンド群と視覚的に区切る） */}
            {safeRibbonLayout.separateLane && (
              <g style={{ pointerEvents: 'none' }}>
                <line
                  x1={ix(0)}
                  y1={safeRibbonLayout.separateLane.top}
                  x2={ix(safeRibbonLayout.svgWidth)}
                  y2={safeRibbonLayout.separateLane.top}
                  stroke="#cbd5e1"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={ix(RIBBON_MARGIN.left)}
                  y={safeRibbonLayout.separateLane.top - 6}
                  fontSize={ribbonLabelFont(10)}
                  fontWeight={700}
                  fill={COLOR_SEPARATE_ORIGIN_STRONG}
                  style={{ userSelect: 'none' }}
                >
                  別財源
                </text>
              </g>
            )}

            {/* 間接経費リボン（事業ノード支出側 → 支出先を持たない終端ノード。グレー） */}
            {safeRibbonLayout.indirectFlow && (
              <path
                d={ribbonFlowPath(
                  ix(safeRibbonLayout.indirectFlow.x1), safeRibbonLayout.indirectFlow.y1Top, safeRibbonLayout.indirectFlow.y1Bot,
                  ix(safeRibbonLayout.indirectFlow.x2), safeRibbonLayout.indirectFlow.y2Top + ribbonIndirectShift, safeRibbonLayout.indirectFlow.y2Bot + ribbonIndirectShift,
                )}
                fill={COLOR_INDIRECT_COST}
                fillOpacity={selectedBlock ? 0.1 : (hoveredNodeRaw?.kind === 'indirect' ? 0.55 : (hoveredBlockId ? 0.12 : 0.3))}
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* 順方向フロー（帯・sankey風のリンク表現） */}
            {safeRibbonLayout.flows.map((flow, i) => {
              const target = safeRibbonLayout.bars.find((b) => b.blockId === flow.targetBlock);
              const palette = target ? originPalette(target.originKind) : null;
              const edgeStyle = flowEdgeStyle(flow.origin);
              const isSeparateOrigin = flow.origin === 'separate-origin';
              const flowKey = `${flow.sourceBlock ?? 'root'}->${flow.targetBlock}-${i}`;
              const activeId = selectedBlock?.blockId ?? null;
              const isFlowHovered = hoveredRibbonFlowKey === flowKey;
              let fillOpacity: number;
              if (activeId) {
                const isConnected = flow.sourceBlock === activeId || flow.targetBlock === activeId;
                fillOpacity = isConnected ? (isFlowHovered ? 0.55 : 0.42) : 0.08;
              } else if (isFlowHovered) {
                fillOpacity = 0.6;
              } else if (hoveredBlockId) {
                const isConnected = flow.sourceBlock === hoveredBlockId || flow.targetBlock === hoveredBlockId;
                fillOpacity = isConnected ? 0.5 : 0.1;
              } else {
                fillOpacity = 0.28;
              }
              const sShift = ribbonShiftOf(flow.sourceBlock);
              const tShift = ribbonShiftOf(flow.targetBlock);
              return (
                <path
                  key={`rfwd-${i}`}
                  d={ribbonFlowPath(ix(flow.x1), flow.y1Top + sShift, flow.y1Bot + sShift, ix(flow.x2), flow.y2Top + tShift, flow.y2Bot + tShift)}
                  fill={palette ? palette.header : edgeStyle.stroke}
                  fillOpacity={fillOpacity}
                  stroke={isSeparateOrigin ? edgeStyle.stroke : 'none'}
                  strokeWidth={isSeparateOrigin ? 1.5 : 0}
                  strokeDasharray={isSeparateOrigin ? '5 4' : undefined}
                  style={{ cursor: 'pointer', transition: 'fill-opacity 0.12s ease' }}
                  onMouseEnter={() => {
                    setHoveredRibbonFlowKey(flowKey);
                    setHoveredNodeRaw({ kind: 'ribbonFlow', flow, flowKey });
                  }}
                  onMouseLeave={() => {
                    setHoveredRibbonFlowKey((k) => (k === flowKey ? null : k));
                    setHoveredNodeRaw((n) => (n && n.kind === 'ribbonFlow' && n.flowKey === flowKey ? null : n));
                  }}
                />
              );
            })}

            {/* バックエッジ・自己ループ（簡略表現: 細い破線で上方を迂回） */}
            {safeRibbonLayout.backEdges.map((edge, i) => {
              const eSShift = ribbonShiftOf(edge.sourceBlock);
              const eTShift = ribbonShiftOf(edge.targetBlock);
              return (
              <path
                key={`rback-${i}`}
                d={edge.isSelfLoop ? ribbonSelfLoopPath(ix(edge.x1), edge.y1 + eSShift) : ribbonBackEdgePath(ix(edge.x1), edge.y1 + eSShift, ix(edge.x2), edge.y2 + eTShift)}
                fill="none"
                stroke={COLOR_BACK_EDGE}
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              );
            })}

            {/* 予算・執行列 → 事業(予算側) のリボン（緑） */}
            {safeRibbonLayout.budgetFlows.map((bf, i) => {
              const bShift = ribbonBudgetShifts[i] ?? 0; // 源=予算内訳ノード / 着地=事業(root, シフト0)
              return (
              <path
                key={`bflow-${i}`}
                d={ribbonFlowPath(ix(bf.x1), bf.y1Top + bShift, bf.y1Bot + bShift, ix(bf.x2), bf.y2Top, bf.y2Bot)}
                fill={SEMANTIC_PROJECT}
                fillOpacity={0.22}
                style={{ pointerEvents: 'none' }}
              />
              );
            })}

            {/* 予算・執行ノード列（最左・緑）。ラベルは 名前(金額) */}
            {safeRibbonLayout.budgetItems.map((bi, i) => {
              const biY = bi.y + (ribbonBudgetShifts[i] ?? 0);
              return (
              <g
                key={`bnode-${i}`}
                onMouseEnter={() => setHoveredNodeRaw({ kind: 'budget', item: bi })}
                onMouseLeave={() => setHoveredNodeRaw(null)}
                style={{ cursor: 'default' }}
              >
                <rect x={ix(bi.x)} y={biY} width={iw(bi.w)} height={Math.max(1, bi.h)} rx={1} fill={SEMANTIC_PROJECT} vectorEffect="non-scaling-stroke" />
                <text
                  x={ix(bi.x + bi.w + 6)}
                  y={biY + bi.h / 2}
                  dominantBaseline="middle"
                  fontSize={ribbonLabelFont(10)}
                  fill="#333"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {bi.label.length > 16 ? bi.label.slice(0, 15) + '…' : bi.label}
                  <tspan> ({formatYen(bi.amount)})</tspan>
                </text>
              </g>
              );
            })}

            {/* 事業ノード（予算=緑 / 支出=オレンジ の結合ドッキング。メインの mergedProjectPath 相当） */}
            <g
              onClick={handleDeselect}
              onMouseEnter={() => setHoveredNodeRaw({ kind: 'root' })}
              onMouseLeave={() => setHoveredNodeRaw(null)}
              style={{ cursor: 'pointer' }}
            >
              {safeRibbonLayout.root.budgetH != null ? (
                <path
                  d={mergedProjectPath(ix(safeRibbonLayout.root.x), safeRibbonLayout.root.y, iw(RIBBON_BAR_W), safeRibbonLayout.root.budgetH, safeRibbonLayout.root.h)}
                  fill="url(#budget-exec-grad)"
                  stroke={hoveredNodeRaw?.kind === 'root' ? '#111827' : 'none'}
                  strokeWidth={hoveredNodeRaw?.kind === 'root' ? 1.5 : 0}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'all' }}
                />
              ) : (
                <rect
                  x={ix(safeRibbonLayout.root.x)}
                  y={safeRibbonLayout.root.y}
                  width={iw(safeRibbonLayout.root.w)}
                  height={Math.max(1, safeRibbonLayout.root.h)}
                  rx={1}
                  fill="#e07040"
                  stroke={hoveredNodeRaw?.kind === 'root' ? '#111827' : 'none'}
                  strokeWidth={hoveredNodeRaw?.kind === 'root' ? 1.5 : 0}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'all' }}
                />
              )}
              <foreignObject
                x={ix(safeRibbonLayout.root.x + safeRibbonLayout.root.w + 6)}
                y={safeRibbonLayout.root.y - 4}
                width={iw(RIBBON_LABEL_W - 6)}
                height={Math.max(safeRibbonLayout.root.h + 8, 44)}
                style={{ pointerEvents: 'none' }}
              >
                <div style={{ fontFamily: 'inherit', userSelect: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
                  <div style={{ fontSize: ribbonLabelFont(9), fontWeight: 700, color: '#94a3b8' }}>事業 / PID {graph.projectId}</div>
                  <div style={{ fontSize: ribbonLabelFont(11), fontWeight: 700, color: '#333', lineHeight: `${ribbonLabelFont(13)}px`, marginTop: 2, ...CLAMP_2_LINES }}>
                    {graph.projectName}
                    <span style={{ fontWeight: 500 }}> （支出 {graph.execution > 0 ? formatYen(graph.execution) : '—'}）</span>
                  </div>
                </div>
              </foreignObject>
              {/* メイン画面同様、予算額は緑（予算）側の左隣・ノード縦中央に表示（textAnchor=end）。
                  縦位置は max(支出,予算) の中央にし、予算=支出で緑=橙のときも中央に出る（右の事業名とは
                  左右に分かれるため重ならない）。 */}
              {safeRibbonLayout.root.budgetH != null && safeRibbonLayout.root.budgetAmount != null && (
                <text
                  x={ix(safeRibbonLayout.root.x) - iw(6)}
                  y={safeRibbonLayout.root.y + Math.max(safeRibbonLayout.root.h, safeRibbonLayout.root.budgetH) / 2}
                  dominantBaseline="middle"
                  textAnchor="end"
                  fontSize={ribbonLabelFont(11)}
                  fontWeight={600}
                  fill="#333"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  予算 {formatYen(safeRibbonLayout.root.budgetAmount)}
                </text>
              )}
            </g>

            {/* ブロックバー（sankeyノード風の細帯。ラベルはバー右横のテキスト） */}
            {safeRibbonLayout.bars.map((bar) => {
              const isSelected = selectedBlock?.blockId === bar.blockId;
              const isHovered = hoveredBlockId === bar.blockId;
              const palette = originPalette(bar.originKind);
              const selectedStroke = palette.selectedStroke;
              const activeId = selectedBlock?.blockId ?? null;
              const isDimmed = activeId !== null && activeId !== bar.blockId && !safeRibbonLayout.flows.some(
                (f) => (f.sourceBlock === activeId && f.targetBlock === bar.blockId) || (f.targetBlock === activeId && f.sourceBlock === bar.blockId)
              );
              const barOpacity = isDimmed ? 0.35 : 1;
              const labelColor = isDimmed ? '#bbb' : '#333';
              const amountLabel = bar.isZeroAmount ? '金額内訳なし' : formatYen(bar.totalAmount);
              const barLabelFontPx = ribbonLabelFont(11);
              const amountTspanText = ` (${amountLabel})`;
              // 金額部分（"(1,234億円)"）を必ず収めた上で名前部分を切り詰める（列幅からはみ出し・
              // 文字切れを防ぐ。clipPath は保険として残すが、通常ケースではここで収まる）
              const displayBlockName = truncateRibbonLabelName(bar.blockName, amountTspanText, iw(RIBBON_LABEL_W - 6), barLabelFontPx);
              const barY = bar.y + (ribbonBarShift.get(bar.blockId) ?? 0); // ラベル衝突回避の縦シフト

              return (
                <g
                  key={bar.blockId}
                  onClick={() => handleNodeClick(bar.node)}
                  onMouseEnter={() => { setHoveredNodeRaw({ kind: 'block', block: bar.node }); setHoveredBlockId(bar.blockId); }}
                  onMouseLeave={() => { setHoveredNodeRaw(null); setHoveredBlockId(null); }}
                  style={{ cursor: 'pointer' }}
                >
                  {isSelected && (
                    <rect
                      x={ix(bar.x - 3)}
                      y={barY - 3}
                      width={iw(bar.w + 6)}
                      height={bar.h + 6}
                      rx={4}
                      fill="none"
                      stroke={CARD_SELECTED_RING}
                      strokeWidth={4}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <rect
                    x={ix(bar.x)}
                    y={barY}
                    width={iw(bar.w)}
                    height={Math.max(1, bar.h)}
                    rx={1}
                    fill={palette.header}
                    stroke={isSelected ? selectedStroke : (isHovered ? '#111827' : 'none')}
                    strokeWidth={isSelected ? 2.5 : (isHovered ? 1.5 : 0)}
                    vectorEffect="non-scaling-stroke"
                    style={{ opacity: barOpacity, transition: 'opacity 0.12s ease' }}
                  />
                  <text
                    x={ix(bar.x + bar.w + 6)}
                    y={barY + bar.h / 2}
                    dominantBaseline="middle"
                    fontSize={barLabelFontPx}
                    fontWeight={isSelected || isHovered ? 700 : 500}
                    fill={labelColor}
                    clipPath={bar.depth === ribbonMaxDepth ? undefined : `url(#ribbon-clip-col-${bar.depth})`}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {displayBlockName}
                    <tspan>{amountTspanText}</tspan>
                  </text>
                </g>
              );
            })}

            {/* 間接経費の終端ノード（支出先を持たない支出。深度1列の最下段・グレー）。
                クリックで側パネルの間接経費タブへ */}
            {safeRibbonLayout.indirectNode && (() => {
              const iNode = safeRibbonLayout.indirectNode;
              const iY = iNode.y + ribbonIndirectShift;
              const isDimmed = selectedBlock !== null; // どのブロックとも関係を持たないため選択中は常に減光
              const iHovered = hoveredNodeRaw?.kind === 'indirect';
              const iFontPx = ribbonLabelFont(11);
              const iAmountText = ` (${formatYen(iNode.amount)})`;
              return (
                <g
                  onClick={handleIndirectClick}
                  onMouseEnter={() => setHoveredNodeRaw({ kind: 'indirect' })}
                  onMouseLeave={() => setHoveredNodeRaw((n) => (n?.kind === 'indirect' ? null : n))}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={ix(iNode.x)}
                    y={iY}
                    width={iw(iNode.w)}
                    height={Math.max(1, iNode.h)}
                    rx={1}
                    fill={COLOR_INDIRECT_COST}
                    stroke={iHovered ? '#111827' : 'none'}
                    strokeWidth={iHovered ? 1.5 : 0}
                    vectorEffect="non-scaling-stroke"
                    style={{ opacity: isDimmed ? 0.35 : 1, transition: 'opacity 0.12s ease' }}
                  />
                  <text
                    x={ix(iNode.x + iNode.w + 6)}
                    y={iY + iNode.h / 2}
                    dominantBaseline="middle"
                    fontSize={iFontPx}
                    fontWeight={iHovered ? 700 : 500}
                    fill={isDimmed ? '#bbb' : '#333'}
                    clipPath={ribbonMaxDepth > 1 ? 'url(#ribbon-clip-col-1)' : undefined}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {truncateRibbonLabelName(iNode.label, iAmountText, iw(RIBBON_LABEL_W - 6), iFontPx)}
                    <tspan>{iAmountText}</tspan>
                  </text>
                </g>
              );
            })()}
          </>
          )}
          </g>

        </svg>

        {/* 列見出し（メイン /sankey-svg の列ラベル方式）。列ごとの合計金額を列の上に
            Sticky 表示する。pan/zoom に追従しつつ、スクロールで列頭が上に隠れても
            上部ツールバーの直下に張り付く（top を max でクランプ）。 */}
        {viewMode === 'ribbon' && (() => {
          const L = safeRibbonLayout;
          const scale = transform.scale;
          const HEADER_TOP_RESERVE = 52; // 上部ツールバー（一覧/年度/タブ）の下端目安
          const labelPx = scaleFont(11);
          const amountPx = scaleFont(10);
          type Col = { key: string; label: string; amountLines: string[]; xCenter: number };
          const cols: Col[] = [];
          if (L.budgetItems.length > 0) {
            // 実際に描画している予算内訳ノードの合計を見出しに出す（レイアウトの funnel と一致）
            const budgetTotal = L.budgetItems.reduce((s, b) => s + b.amount, 0);
            cols.push({
              key: 'budget', label: '予算・執行', amountLines: [formatYen(budgetTotal)],
              xCenter: L.budgetItems[0].x + L.budgetItems[0].w / 2,
            });
          }
          cols.push({
            key: 'root', label: '事業',
            amountLines: L.root.budgetH != null
              ? [`${formatYen(L.root.budgetAmount ?? 0)} / ${formatYen(L.root.spendingAmount ?? graph.execution)}`]
              : [formatYen(graph.execution)],
            xCenter: L.root.x + L.root.w / 2,
          });
          // 深度1列は間接経費ノード（ブロックではない）を含めた合計を見出しに出す。
          // ブロックが1件も無く間接経費のみの事業でも列見出しを出す
          const depths = [...new Set([...L.bars.map((b) => b.depth), ...(L.indirectNode ? [1] : [])])].sort((a, b) => a - b);
          for (const d of depths) {
            const barsAtD = L.bars.filter((b) => b.depth === d);
            const indirectAtD = d === 1 ? L.indirectNode : null;
            if (barsAtD.length === 0 && !indirectAtD) continue;
            const total = barsAtD.reduce((s, b) => s + b.totalAmount, 0) + (indirectAtD?.amount ?? 0);
            const anchor = barsAtD[0] ?? indirectAtD!;
            cols.push({
              key: `d${d}`,
              label: d === 1 ? '支出先' : d === 2 ? '再委託先' : `再委託先${d - 1}`,
              amountLines: [formatYen(total)],
              xCenter: anchor.x + anchor.w / 2,
            });
          }
          // 全列で共通の Top 位置に見出しを揃える（列ごとの最上端ノードYではなく、Top揃えの
          // 基準 RIBBON_MARGIN.top を使う。再委託先2 など深い列も 支出先/再委託先 と同じ高さになる）。
          const colTopScreenY = transform.y + RIBBON_MARGIN.top * scale;
          return cols.map((col) => {
            // 横は zoom不変（horizontalScale）、縦は zoom連動（scale）で列位置を出す。
            const screenX = transform.x + col.xCenter * horizontalScale;
            const blockH = Math.round(labelPx * 1.4 + col.amountLines.length * amountPx * 1.4 + 6);
            const top = Math.max(HEADER_TOP_RESERVE, colTopScreenY - blockH - 6);
            return (
              <div
                key={col.key}
                style={{
                  position: 'absolute', left: screenX, top,
                  transform: 'translateX(-50%)', textAlign: 'center',
                  fontSize: labelPx, color: '#999', whiteSpace: 'nowrap',
                  userSelect: 'none', cursor: 'default', pointerEvents: 'none',
                  zIndex: 6, lineHeight: 1.4,
                  background: 'rgba(255,255,255,0.82)', padding: '2px 8px', borderRadius: 4,
                }}
              >
                <div>{col.label}</div>
                {col.amountLines.map((a, i) => (
                  <div key={i} style={{ fontSize: amountPx }}>{a}</div>
                ))}
              </div>
            );
          });
        })()}

        {/* ホバーツールチップ — サンキー流儀のマウス追従 HTML div（220ms遅延・パン/ズーム直後は抑制） */}
        {hoveredNodeStable && !isPanning.current && !isHoverSuppressed && (() => {
          const isRoot = hoveredNodeStable.kind === 'root';
          const lb = hoveredNodeStable.kind === 'block' ? hoveredNodeStable.block : null;
          const rf = hoveredNodeStable.kind === 'ribbonFlow' ? hoveredNodeStable.flow : null;
          const bud = hoveredNodeStable.kind === 'budget' ? hoveredNodeStable.item : null;
          const isIndirect = hoveredNodeStable.kind === 'indirect';
          const indirectTopItems = isIndirect ? indirectSummary.items.slice(0, 3) : [];
          const tipW = 300;
          const rfTargetBar = rf ? safeRibbonLayout.bars.find((b) => b.blockId === rf.targetBlock) ?? null : null;
          const rfSourceName = rf
            ? (rf.sourceBlock === null
              ? graph.projectName
              : (safeRibbonLayout.bars.find((b) => b.blockId === rf.sourceBlock)?.blockName ?? rf.sourceBlock))
            : '';
          const rfTargetName = rfTargetBar?.blockName ?? rf?.targetBlock ?? '';
          const topRecipients = lb ? sortRecipients(lb.recipients, 'amount-desc').slice(0, 3) : [];
          const tipH = isRoot
            ? 126
            : isIndirect
            ? 92 + indirectTopItems.length * 18
            : bud
              ? 92 + ((bud.item || bud.subItem) ? 18 : 0) + (bud.note.trim() ? 22 : 0)
              : rf
                ? 88 + (rf.note ? 22 : 0)
                : 96 + (lb!.role ? 18 : 0) + topRecipients.length * 18;
          const containerW = containerRef.current?.clientWidth ?? 1000;
          const containerH = containerRef.current?.clientHeight ?? 800;
          const GAP = 12;
          // 横方向: カーソル右+GAP。画面端で左側に反転クランプ
          let tipX = mousePos.x + GAP;
          if (tipX + tipW + 4 > containerW) tipX = mousePos.x - GAP - tipW;
          tipX = Math.max(4, Math.min(tipX, containerW - tipW - 4));
          // 縦方向: カーソル上方が基本。上に収まらない場合は下方向へフォールバック
          let tipY = mousePos.y - tipH - GAP;
          if (tipY < 4) tipY = mousePos.y + GAP;
          tipY = Math.max(4, Math.min(tipY, containerH - tipH - 4));

          // タイトル横のバッジ。種別（事業/予算/直接/再委託…）バッジは廃止し、
          // 予算・執行ノードと事業ノードには会計区分（一般/特別）バッジを出す。
          const renderAccountBadge = (key: 'general' | 'special' | 'both' | null) => {
            const badge = getAccountBadgeStyle(key);
            if (!badge) return null;
            return (
              <span style={{ background: badge.background, color: '#fff', padding: '1px 6px', borderRadius: 8, fontSize: scaleFont(9), fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                {badge.label}
              </span>
            );
          };
          // 事業(root)の会計区分は予算内訳ノードの一般/特別の有無から判定（両方あれば both）
          const rootAccountKey: 'general' | 'special' | 'both' | null = (() => {
            if (!isRoot) return null;
            let hasGeneral = false, hasSpecial = false;
            for (const bi of safeRibbonLayout.budgetItems) {
              const k = classifyAccountCategory(bi.accountCategory);
              if (k === 'general') hasGeneral = true; else if (k === 'special') hasSpecial = true;
            }
            return hasGeneral && hasSpecial ? 'both' : hasGeneral ? 'general' : hasSpecial ? 'special' : null;
          })();
          const titleTag = isRoot
            ? renderAccountBadge(rootAccountKey)
            : bud
              ? renderAccountBadge(classifyAccountCategory(bud.accountCategory))
              : null;
          const titleText = isRoot ? graph.projectName : isIndirect ? INDIRECT_COST_NODE_LABEL : bud ? bud.label : rf ? `${rfSourceName} → ${rfTargetName}` : lb!.blockName;
          return (
            <div style={{
              position: 'absolute',
              left: tipX,
              top: tipY,
              width: tipW,
              boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.97)',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#222',
              lineHeight: 1.3,
              wordBreak: 'break-word',
              border: '1px solid #e0e0e0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              pointerEvents: 'none',
              zIndex: 20,
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
                <span title={titleText} style={{ fontWeight: 600, fontSize: scaleFont(12), color: '#111', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {titleText}
                </span>
                <span style={{ flexShrink: 0 }}>{titleTag}</span>
              </div>
              <div style={{ fontSize: scaleFont(11), lineHeight: 1.45, color: '#555' }}>
                {isRoot ? (
                  <>
                    <div>PID {graph.projectId} ・ {graph.ministry}</div>
                    {visibleOrgChain.length > 0 && <div>{visibleOrgChain.join(' / ')}</div>}
                    <div>予算 <b style={{ color: '#222' }}>{graph.budget > 0 ? formatYen(graph.budget) : '—'}</b> ・ 支出 <b style={{ color: '#222' }}>{graph.execution > 0 ? formatYen(graph.execution) : '—'}</b></div>
                  </>
                ) : isIndirect ? (
                  <>
                    <div><b style={{ color: '#222' }}>{formatYen(indirectSummary.total)}</b> ・ {indirectSummary.count.toLocaleString()}件</div>
                    <div style={{ color: '#777' }}>支出先ブロックを持たない支出（クリックで一覧）</div>
                    {indirectTopItems.map((c, i) => (
                      <div key={`${c.category}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 1 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {c.category || c.kind || '（項目なし）'}</span>
                        <span style={{ flexShrink: 0, color: '#222' }}>{formatYen(c.amount)}</span>
                      </div>
                    ))}
                  </>
                ) : bud ? (
                  <>
                    <div>予算額 <b style={{ color: '#222' }}>{formatYen(bud.amount)}</b>
                      {bud.nextYearRequestAmount > 0 && <> ・ 翌年度要求 <b style={{ color: '#222' }}>{formatYen(bud.nextYearRequestAmount)}</b></>}
                    </div>
                    {(bud.item.trim() || bud.subItem.trim()) && (
                      <div style={{ color: '#777' }}>
                        {bud.item.trim() && <>項: {bud.item}</>}
                        {bud.subItem.trim() && <>{bud.item.trim() ? ' ・ ' : ''}目: {bud.subItem}</>}
                      </div>
                    )}
                    {bud.note.trim() && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee' }}>補足: {bud.note}</div>
                    )}
                  </>
                ) : rf ? (
                  <>
                    <div><b style={{ color: '#222' }}>{formatYen(Math.round(rf.amount))}</b>
                      {rf.isReference && ' ・ 参考標記'}
                      {rf.targetIncomingBlockCount >= 2 && ` ・ 合流 ${rf.targetIncomingBlockCount}本`}
                    </div>
                    {rf.note && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #eee' }}>補足: {rf.note}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div><b style={{ color: '#222' }}>{formatYen(lb!.totalAmount)}</b> ・ 支出先 {lb!.recipients.length.toLocaleString()}件</div>
                    {lb!.role && <div style={{ color: '#777' }}>{lb!.role}</div>}
                    {topRecipients.map((r, i) => (
                      <div key={`${r.name}-${r.corporateNumber}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 1 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {r.name || '（氏名なし）'}</span>
                        <span style={{ flexShrink: 0, color: '#222' }}>{formatYen(r.amount)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ズームコントロール — 右下（サイドパネルが右表示時のみ左にシフト。パネルが左表示のフロー図ビューでは
            右側は空くため退避不要。パネルは position:fixed のオーバーレイのため、
            キャンバスは全幅を使う＝このコントロールの座標系はビューポート全体に一致する） */}
        <div style={{
          position: 'absolute', bottom: 12,
          right: sidePanelSide === 'right' && !sidePanel.collapsed ? sidePanel.effectiveWidth + 12 : 12,
          zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4,
          transition: sidePanel.isResizing ? 'none' : 'right 0.2s ease',
        }}>
          {/* スクロールモード切替ボタン（/sankey-svg と同じ意匠） */}
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
          {/* + / スライダー / - */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button aria-label="ズームイン" onClick={() => applyZoom(1.5)} title="ズームイン" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
              <input
                type="range"
                aria-label="ズーム倍率"
                min={Math.log10(Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER))}
                max={Math.log10(Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER))}
                step={0.01}
                value={Math.log10(Math.max(Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER), Math.min(Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER), transform.scale)))}
                onChange={e => { const newK = Math.pow(10, parseFloat(e.target.value)); applyZoom(newK / transform.scale); }}
                style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
                title={`Zoom: ${Math.round(transform.scale / baseZoom * 100)}%`}
              />
            </div>
            <button aria-label="ズームアウト" onClick={() => applyZoom(1 / 1.5)} title="ズームアウト" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z"/></svg>
            </button>
          </div>
          {/* Zoom% */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {isEditingZoom ? (
              <input
                type="number"
                autoFocus
                min={1} max={1000} step={1}
                value={zoomInputValue}
                onChange={e => setZoomInputValue(e.target.value)}
                onBlur={() => { const v = Number(zoomInputValue); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / transform.scale); setIsEditingZoom(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { const v = Number(zoomInputValue); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / transform.scale); setIsEditingZoom(false); } else if (e.key === 'Escape') { setIsEditingZoom(false); } }}
                style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', outline: 'none', background: 'transparent', color: '#555', boxSizing: 'border-box' }}
              />
            ) : (
              <button
                onClick={() => { setZoomInputValue(String(Math.round(transform.scale / baseZoom * 100))); setIsEditingZoom(true); }}
                title="クリックしてZoom率を入力"
                style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '4px 0', border: 'none', background: 'transparent', color: '#888', cursor: 'text' }}
              >{Math.round(transform.scale / baseZoom * 100)}%</button>
            )}
          </div>
          {/* 全体表示 */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            <button aria-label="全体表示" onClick={resetViewport} title="全体表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z"/></svg>
            </button>
          </div>
        </div>

        {/* フォントサイズコントロール — 左下フローティング（サンキー流儀と同じ配置・操作感。
            サイドパネルが左表示のときは退避） */}
        <div
          data-pan-disabled="true"
          style={{
            position: 'absolute',
            left: leftFloatOffset,
            bottom: 12,
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            padding: '6px 10px',
            transition: sidePanel.isResizing ? 'none' : 'left 0.2s ease',
          }}
        >
          <FontSizeControls
            baseFontPx={baseFontPx}
            setBaseFontPx={setBaseFontPx}
            markReplace={() => {}}
            isCompactWidth={false}
            min={BASE_FONT_PX_MIN}
            max={BASE_FONT_PX_MAX}
            defaultValue={BASE_FONT_PX_DEFAULT}
            controlSmallFontPx={scaleFont(12)}
            numberFontPx={11}
          />
        </div>

      </div>

        {/* サイドパネル — ブロック図(A案)=右、フロー図(B案)=左（/sankey-svg と同じ配置） */}
        <SidePanelChrome
          side={sidePanelSide}
          open={!sidePanel.collapsed}
          onToggle={sidePanel.toggleCollapsed}
          width={sidePanel.effectiveWidth}
          minWidth={SIDE_PANEL_WIDTH_MIN}
          maxWidth={SIDE_PANEL_WIDTH_MAX}
          onResizeStart={sidePanel.onResizeStart}
          isResizing={sidePanel.isResizing}
          onResetWidth={sidePanel.resetWidth}
        >
          <SidePane
            block={selectedBlock}
            graph={graph}
            projectDetail={projectDetail}
            policyView={policyView}
            policyError={policyError}
            orgChain={visibleOrgChain}
            year={year}
            activeTab={activeTab}
            indirect={indirectSummary}
            onChangeTab={(tab) => { setActiveTab(tab); pushSelTabUrl(selectedBlock?.blockId ?? null, tab); }}
            onSelectBlock={handleSelectFromList}
            scaleFont={scaleFont}
          />
        </SidePanelChrome>
    </div>
  );
}

export default function SubcontractDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractDetailPageInner />
    </Suspense>
  );
}
