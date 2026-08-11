'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { GraphData, LayoutNode, LayoutLink } from '@/types/sankey-svg';
import type { ProjectDetail } from '@/types/project-details';
import type { PolicySummaryResponse } from '@/app/api/policy-summary/route';
import {
  COL_LABELS, MARGIN, NODE_W, NODE_PAD,
  MAX_RECIPIENT_GAP_PX, MAX_MINISTRY_GAP_PX,
  TYPE_COLORS, TYPE_LABELS,
  getColumn, getNodeColor, getLinkColor, ribbonPath, formatYen, sortPriority,
} from '@/app/lib/sankey-svg-constants';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { YearSelect } from '@/components/navigation/YearSelect';
import { MinimapOverlay } from '@/client/components/SankeySvg/MinimapOverlay';
import { TopNSliders } from '@/client/components/SankeySvg/TopNSliders';
import { FontSizeControls } from '@/client/components/SankeySvg/FontSizeControls';
import { useRepeatPress } from '@/client/components/SankeySvg/useRepeatPress';
import { useBaseFontPx } from '@/client/hooks/useBaseFontPx';
import { createScaleFont, FONT_SCALE_REFERENCE_PX } from '@/app/lib/font-scale';
import { filterTopN, computeLayout, getTopMinistriesInScope } from '@/app/lib/sankey-svg-filter';
import { canonicalSelectableNodeId } from '@/app/lib/sankey-svg-ids';
import { resolveYearSelectionSnapshot, type YearSelectionSnapshot } from '@/app/lib/sankey-svg-year-selection';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { buildFilterExcludedIds, sankeyQueryToUrlParams, sankeyQueryFromUrlParams } from '@/app/lib/sankey-query';
import { externalCorporateLinks } from '@/app/lib/api/links';
import type { AccountCategoryKey } from '@/types/sankey-query';
import { AiChatPanel, type AiChatUiMessage } from '@/client/components/SankeySvg/AiChatPanel';
import { MAX_CHAT_MESSAGES, type SankeyChatProgressEvent, type SankeyChatResponse, type SankeyChatResult } from '@/types/sankey-ai-chat';
import { loadByokSettings, saveByokSettings, deleteByokSettings, type ByokSettings } from '@/client/lib/ai/api-key-store';
import {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
  deleteAllChatSessions,
  renameChatSession,
  type ChatSessionMeta,
} from '@/client/lib/ai/chat-history-store';
import { ExplorationHistory } from '@/client/components/SankeySvg/ExplorationHistory';
import { FEATURE_AI_CHAT, FEATURE_EXPLORATION_HISTORY } from '@/app/lib/feature-flags';
import { recordVisit, saveMemo } from '@/client/lib/exploration-store';
import { buildExplorationLabel } from '@/app/lib/exploration-label';
import { testOpenRouterKey, DEFAULT_BYOK_MODEL } from '@/client/lib/ai/openrouter-caller';
import { runByokChat, LlmUpstreamError } from '@/client/lib/ai/byok-chat';
import type { ClientGraphSource } from '@/client/lib/ai/client-tool-executor';
import type { QualityScoreItem } from '@/app/api/quality-scores/route';
import { TagChip } from '@/client/components/TagChip';
import { PolicyEvaluationBlock } from '@/client/components/quality/PolicyEvaluationBlock';
import { ProjectOverviewSection } from '@/client/components/subcontract/ProjectOverviewSection';
import { getAccountBadgeStyle } from '@/app/lib/account-badge';
import { BudgetExecutionSection } from '@/client/components/BudgetExecutionSection';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import {
  useSidePanel,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_VIEWPORT_RESERVE_PX,
} from '@/client/hooks/useSidePanel';

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
  filterOnMinistryClick: boolean;
  year: '2024' | '2025';
  zoom?: number;
  searchQuery?: string;
  showFilterPanel?: boolean;
  filterProjectName?: string;
  filterProjectNameRegex?: boolean;
  filterRecipientName?: string;
  filterRecipientNameRegex?: boolean;
  filterMinistryNames?: string[];
  filterMinBudgetText?: string;
  filterMaxBudgetText?: string;
  filterMinSpendingText?: string;
  filterMaxSpendingText?: string;
  /** 政策評価スコアの足きり "min-max"（0-100・片側空欄可）。o=総合 x=費用対内容 n=必要性 */
  filterScoreO?: string;
  filterScoreX?: string;
  filterScoreN?: string;
  acGeneral?: boolean;
  acSpecial?: boolean;
  /** 再委託フィルタ: 階層下限の文字列（'2'=あり〜'9'）。空/未指定 = フィルタなし */
  filterSubcontract?: string;
  filterRecipientIncludeSub?: boolean;
  acBoth?: boolean;
  acNone?: boolean;
}

/** 政策評価スコア足きりの範囲（0-100の数値文字列・空欄=指定なし） */
type ScoreRange = { min: string; max: string };
const EMPTY_SCORE_RANGE: ScoreRange = { min: '', max: '' };
/** URLの "min-max" 表現との相互変換 */
function parseScoreRangeParam(v: string): ScoreRange {
  const i = v.indexOf('-');
  return i < 0 ? { min: v, max: '' } : { min: v.slice(0, i), max: v.slice(i + 1) };
}
function scoreRangeToParam(r: ScoreRange): string | null {
  return r.min || r.max ? `${r.min}-${r.max}` : null;
}

const SCREEN_LEFT_PADDING_PX = 32;
const SCREEN_HORIZONTAL_FIT_RATIO = 0.82;
const SCREEN_MIN_TOTAL_LABEL_GAP_PX = 112;
const SCREEN_MIN_MINISTRY_LABEL_WIDTH_PX = 128;
const SCREEN_MAX_MINISTRY_LABEL_GAP_PX = 72;
const E2E_TEST_IDS_ENABLED = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PLAYWRIGHT === '1';
const testId = (id: string): string | undefined => E2E_TEST_IDS_ENABLED ? id : undefined;

const MAP_LABEL_FONT_PX_DEFAULT = 11;
const MAP_LABEL_SLOT_PX_DEFAULT = 12;
const MAP_LABEL_VISIBLE_MIN_H_PX_DEFAULT = 11;
// この幅（px）以下では、タッチ操作で代替できるズーム系コントロールを非表示にする。
// 767 = 「タブレット未満」境界。iPad縦(768px〜)ではコントロールを残し、スマホ幅でのみ隠す。
const COMPACT_CONTROL_MAX_WIDTH = 767;
const ZOOM_MIN_ABS = 0.05;
const ZOOM_MAX_ABS = 20;
const ZOOM_MIN_MULTIPLIER = 0.25;
const ZOOM_MAX_MULTIPLIER = 30;
const COLUMN_LABEL_FONT_PX_DEFAULT = 12;
const COLUMN_AMOUNT_FONT_PX_DEFAULT = 11;
const SEARCH_FONT_PX_DEFAULT = 14;
const CONTROL_FONT_PX_DEFAULT = 13;
const CONTROL_SMALL_FONT_PX_DEFAULT = 12;
const META_FONT_PX_DEFAULT = 11;
const PANEL_TITLE_FONT_PX_DEFAULT = 14;
const PANEL_PRIMARY_VALUE_FONT_PX_DEFAULT = 15;
const PANEL_LIST_NAME_FONT_PX_DEFAULT = 12;
const PANEL_LIST_VALUE_FONT_PX_DEFAULT = 12;
const PANEL_META_FONT_PX_DEFAULT = 13;
const TOOLTIP_TITLE_FONT_PX_DEFAULT = 12;
const TOOLTIP_VALUE_FONT_PX_DEFAULT = 11;
const TOOLTIP_META_FONT_PX_DEFAULT = 10;
// フォントスケールの基準値（baseFontPx ÷ FONT_SCALE_REFERENCE_PX で全フォントを比例拡縮）。
// 実際の scaleFont 生成は app/lib/font-scale.ts（Pure ヘルパー、他ページと共有）に委譲。
const BASE_FONT_PX_DEFAULT = 12;
const BASE_FONT_PX_MIN = 8;
const BASE_FONT_PX_MAX = 24;
// サイドパネルの幅定数（既定/最小/最大/ビューポート予約）は client/hooks/useSidePanel.ts に一元化
const PROJECT_OVERVIEW_PREVIEW_HEIGHT_DEFAULT = 72;
const PROJECT_OVERVIEW_PREVIEW_HEIGHT_MIN = 24;
const PROJECT_OVERVIEW_PREVIEW_HEIGHT_MAX = 600;
const BUDGET_EXECUTION_LIST_HEIGHT_DEFAULT = 260;
const BUDGET_EXECUTION_LIST_HEIGHT_MIN = 96;
const BUDGET_EXECUTION_LIST_HEIGHT_MAX = 600;
const HOVER_SUPPRESS_AFTER_INTERACTION_MS = 500;
const HOVER_ENTER_DELAY_MS = 220;
const TOUCH_PAN_SLOP_PX = 10;
const FIT_TOP_PAD_PX = 32;
const ZOOM_FONT_MAX_RATIO = 2.0;   // zoom-in でフォントを最大で元の何倍まで拡大するか
const AGGREGATE_BOUNDARY_GAP_PX = 6;

type ShiftLayoutNode = {
  y0: number;
  y1: number;
  id: string;
  type: string;
  name: string;
  projectId?: number;
  aggregated?: boolean;
};

function getZoomLabelScale(zoomK: number, baseZoomK: number): number {
  if (baseZoomK <= 0 || zoomK <= baseZoomK + 0.001) return 1;
  return Math.min(zoomK / baseZoomK, ZOOM_FONT_MAX_RATIO);
}

/**
 * サイドパネルの再委託サマリ用。/api/subcontracts の全グラフから件数のみ抽出して保持する
 * （全グラフはメイングラフに載せず、事業選択時に遅延取得する）。
 */
interface SubcontractSummary {
  maxDepth: number;
  totalBlockCount: number;
  totalRecipientCount: number;
  directBlockCount: number;
  separateOriginCount: number;
  /** 再委託ブロック数 = 全 − 直接 − 別財源 */
  subcontractBlockCount: number;
}

/**
 * 事業ノード選択時に pid 単位のデータを遅延取得してキャッシュする共通フック
 * （事業概要プレビュー・品質スコアブロックで共用）。
 * キーは `${year}-${pid}`。取得失敗・404 は null をキャッシュし再試行しない。
 */
function useProjectPidCache<T>(
  selectedNode: LayoutNode | null | undefined,
  year: string,
  urlFor: (pid: number, y: string) => string,
  extract: (data: unknown) => T | null,
): Map<string, T | null> {
  const [cache, setCache] = useState<Map<string, T | null>>(new Map());
  useEffect(() => {
    if (!selectedNode || selectedNode.aggregated) return;
    if (selectedNode.type !== 'project-budget' && selectedNode.type !== 'project-spending') return;
    const pid = selectedNode.projectId;
    const cacheKey = `${year}-${pid}`;
    if (pid == null || cache.has(cacheKey)) return;
    fetch(urlFor(pid, year))
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => setCache(prev => new Map(prev).set(cacheKey, data == null ? null : extract(data))))
      .catch(() => setCache(prev => new Map(prev).set(cacheKey, null)));
    // urlFor/extract はインライン定義を許容し、再取得は selectedNode.id と year のみで制御する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, year]);
  return cache;
}


function parseSearchParams(search: string): Partial<SankeyUrlState> {
  const p = new URLSearchParams(search);
  const result: Partial<SankeyUrlState> = {};
  const sel = p.get('sel'); if (sel !== null) result.selectedNodeId = canonicalSelectableNodeId(sel);
  const pp = p.get('pp'); if (pp !== null) result.pinnedProjectId = pp;
  const pr = p.get('pr'); if (pr !== null) result.pinnedRecipientId = pr;
  const pm = p.get('pm'); if (pm !== null) result.pinnedMinistryName = pm;
  const ro = p.get('ro'); if (ro !== null) { const n = parseInt(ro, 10); if (!isNaN(n)) result.recipientOffset = Math.max(0, n); }
  const ot = p.get('ot'); if (ot === 'p') result.offsetTarget = 'project'; else if (ot === 'r') result.offsetTarget = 'recipient';
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
  const fmc = p.get('fmc'); if (fmc !== null) result.filterOnMinistryClick = fmc !== '0';
  const yr = p.get('yr'); if (yr === '2024' || yr === '2025') result.year = yr;
  const z = p.get('z'); if (z !== null) { const n = parseFloat(z); if (!isNaN(n) && n >= ZOOM_MIN_ABS && n <= ZOOM_MAX_ABS) result.zoom = n; }
  const q = p.get('q'); if (q !== null) result.searchQuery = q;
  const fp = p.get('fp'); if (fp !== null) result.showFilterPanel = fp === '1';
  const fnp = p.get('fnp'); if (fnp !== null) result.filterProjectName = fnp;
  const fnpr = p.get('fnpr'); if (fnpr !== null) result.filterProjectNameRegex = fnpr === '1';
  const fnr = p.get('fnr'); if (fnr !== null) result.filterRecipientName = fnr;
  const fnrr = p.get('fnrr'); if (fnrr !== null) result.filterRecipientNameRegex = fnrr === '1';
  const fm = p.getAll('fm'); if (fm.length > 0) result.filterMinistryNames = Array.from(new Set(fm.map(v => v.trim()).filter(Boolean)));
  const fmb = p.get('fmb'); if (fmb !== null) result.filterMinBudgetText = fmb;
  const fxb = p.get('fxb'); if (fxb !== null) result.filterMaxBudgetText = fxb;
  const fms = p.get('fms'); if (fms !== null) result.filterMinSpendingText = fms;
  const fxs = p.get('fxs'); if (fxs !== null) result.filterMaxSpendingText = fxs;
  const fso = p.get('fso'); if (fso !== null) result.filterScoreO = fso;
  const fsx = p.get('fsx'); if (fsx !== null) result.filterScoreX = fsx;
  const fsn = p.get('fsn'); if (fsn !== null) result.filterScoreN = fsn;
  const ac = p.get('ac');
  if (ac !== null) {
    result.acGeneral = ac.includes('g');
    result.acSpecial = ac.includes('s');
    result.acBoth    = ac.includes('b');
    result.acNone    = ac.includes('n');
  }
  const fsd = p.get('fsd');
  const fsdNum = fsd !== null ? parseInt(fsd, 10) : NaN;
  // 上限クランプはしない（スライダ最大 = データの maxSubcontractDepth。範囲外は clamp effect が是正）
  if (!isNaN(fsdNum) && fsdNum >= 2) result.filterSubcontract = String(fsdNum);
  else if (p.get('fsr') === '1') result.filterSubcontract = '2';
  const fnrs = p.get('fnrs'); if (fnrs !== null) result.filterRecipientIncludeSub = fnrs === '1';
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
  const [topProject, setTopProject] = useState(50);
  const [topRecipient, setTopRecipient] = useState(50);
  const [recipientOffset, setRecipientOffset] = useState(0);
  const [projectOffset, setProjectOffset] = useState(0);
  const [offsetTarget, setOffsetTarget] = useState<'recipient' | 'project'>('project');
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(null);
  const [pinnedRecipientId, setPinnedRecipientId] = useState<string | null>(null);
  const [pinnedMinistryName, setPinnedMinistryName] = useState<string | null>(null);
  const [hoveredLinkRaw, setHoveredLink] = useState<LayoutLink | null>(null);
  const [hoveredNodeRaw, setHoveredNode] = useState<LayoutNode | null>(null);
  const [hoveredColIndex, setHoveredColIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showFontControls, setShowFontControls] = useState(false);
  const [baseFontPx, setBaseFontPx] = useBaseFontPx(
    'sankey-base-font-px', BASE_FONT_PX_DEFAULT, BASE_FONT_PX_MIN, BASE_FONT_PX_MAX,
  );
  const [showLabels, setShowLabels] = useState(true);
  const [showAggRecipient, setShowAggRecipient] = useState(true);
  const [showAggProject, setShowAggProject] = useState(true);
  const [projectSortBy, setProjectSortBy] = useState<'budget' | 'spending'>('budget');
  const [scaleBudgetToVisible, setScaleBudgetToVisible] = useState(true);
  const [focusRelated, setFocusRelated] = useState(false);
  const [autoFocusRelated, setAutoFocusRelated] = useState(false);
  const [filterOnMinistryClick, setFilterOnMinistryClick] = useState(true);
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  // 品質スコア詳細ダイアログ（/quality と共通の ScoreDetailDialog を全項目取得して表示）
  const [scoreDialogItem, setScoreDialogItem] = useState<QualityScoreItem | null>(null);
  const [scoreDialogLoading, setScoreDialogLoading] = useState(false);
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isEditingOffset, setIsEditingOffset] = useState(false);
  const [offsetInputValue, setOffsetInputValue] = useState('');
  const [showTopNSliders, setShowTopNSliders] = useState(true);
  const [scrollMode, setScrollMode] = useState<'zoom' | 'pan'>('zoom');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // 左サイドパネル（ノード詳細）の chrome 状態は useSidePanel に集約。
  // isPanelCollapsed/effectiveSidePanelWidth/isResizingSidePanel は下記 svgWidth 定義後にエイリアスする
  // AIチャットパネル（右側）。サーバモードの可否は /api/ai/sankey-chat の疎通で判定
  const [aiChatAvailable, setAiChatAvailable] = useState(false);
  // BYOK（使用者キー）設定。登録済みならサーバモードより優先する（設計 20260718_1542 3-1節）
  const [byokSettings, setByokSettings] = useState<ByokSettings | null>(null);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiChatMessages, setAiChatMessages] = useState<AiChatUiMessage[]>([]);
  const [aiChatSending, setAiChatSending] = useState(false);
  // ストリーミング応答（stream:true）の最新進行イベントのみ保持。result/error 受信で null に戻す
  const [aiChatProgress, setAiChatProgress] = useState<SankeyChatProgressEvent | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState(SIDE_PANEL_WIDTH_DEFAULT);
  const [isResizingAiPanel, setIsResizingAiPanel] = useState(false);
  const aiPanelResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const [isResizingOverview, setIsResizingOverview] = useState(false);
  const [isResizingBudgetExecution, setIsResizingBudgetExecution] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchCursorIndex, setSearchCursorIndex] = useState(-1);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  // Filter feature
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterProjectName, setFilterProjectName] = useState('');
  const [filterProjectNameRegex, setFilterProjectNameRegex] = useState(false);
  const [debouncedFilterProjectName, setDebouncedFilterProjectName] = useState('');
  const [filterRecipientName, setFilterRecipientName] = useState('');
  const [filterRecipientNameRegex, setFilterRecipientNameRegex] = useState(false);
  const [debouncedFilterRecipientName, setDebouncedFilterRecipientName] = useState('');
  const [filterMinistryNames, setFilterMinistryNames] = useState<string[]>([]);
  const [showMinistryDropdown, setShowMinistryDropdown] = useState(false);
  const [ministryDropdownRect, setMinistryDropdownRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const ministryDropdownRef = useRef<HTMLDivElement>(null);
  const ministryButtonRef = useRef<HTMLButtonElement>(null);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [accountDropdownRect, setAccountDropdownRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const accountDropdownRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [filterMinBudgetText, setFilterMinBudgetText] = useState('');
  const [filterMaxBudgetText, setFilterMaxBudgetText] = useState('');
  const [filterMinSpendingText, setFilterMinSpendingText] = useState('');
  const [filterMaxSpendingText, setFilterMaxSpendingText] = useState('');
  // 政策評価スコアの足きり（0-100の数値文字列。"min-max" でURLに載せる）
  const [filterScoreO, setFilterScoreO] = useState<ScoreRange>(EMPTY_SCORE_RANGE);
  const [filterScoreX, setFilterScoreX] = useState<ScoreRange>(EMPTY_SCORE_RANGE);
  const [filterScoreN, setFilterScoreN] = useState<ScoreRange>(EMPTY_SCORE_RANGE);
  const [acGeneral, setAcGeneral] = useState(true);
  const [acSpecial, setAcSpecial] = useState(true);
  const [acBoth,    setAcBoth]    = useState(true);
  const [acNone,    setAcNone]    = useState(true);
  // 再委託フィルタ: 階層下限（'2'=あり、'3'=再々委託以深…）。'' = フィルタなし
  const [filterSubcontract, setFilterSubcontract] = useState('');
  // 支出先名フィルタの「再委託先を含む」（OR判定・事業単位）
  const [filterRecipientIncludeSub, setFilterRecipientIncludeSub] = useState(false);
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
  // 事業ピン付きディープリンク（/subcontracts からの遷移など）で po= 未指定のとき、
  // グラフ読込後に一度だけ projectOffset をその事業の順位へ中央寄せするための保留ID。
  // 順位は graphData がないと決まらないため、リンク側では po を計算せずここで解決する。
  const pendingProjectOffsetPinId = useRef<string | null>(null);
  // Zoom URL state
  const urlRestoredZoomRef = useRef<number | null>(null); // zoom to restore on first layout (no sel= case)
  const zoomRef = useRef(1);                              // always-current zoom for debounce callbacks
  const zoomUrlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingYearSelectionRef = useRef<YearSelectionSnapshot | null>(null);

  // Container size (responsive to window)
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgWidth, setSvgWidth] = useState(1200);
  const [svgHeight, setSvgHeight] = useState(800);
  // 幅ベースのコンパクト判定。閾値以下では、ピンチズーム/2本指パンで代替できる
  // ズーム系コントロール（スライダー・±ボタン・スクロールモード切替）を非表示にする。
  // 入力デバイス（pointer:coarse）ではなく幅で判定することで、タッチ対応ノートPC等の
  // 誤判定を避け、初期値1200=デスクトップ表示から安全側に倒す。
  const isCompactWidth = svgWidth <= COMPACT_CONTROL_MAX_WIDTH;
  // スマホ横（コンパクト幅かつ横長）: オフセットコントロールをサイドパネルでスライドさせる
  const isLandscapeCompact = isCompactWidth && svgWidth > svgHeight;

  // 左サイドパネル（ノード詳細）の chrome 状態。effectiveWidth は svgWidth に対する
  // ビューポートクランプ込み（旧: minPanelWidthForViewport/maxPanelWidthForViewport 計算と同一式）
  const leftSidePanel = useSidePanel({ side: 'left', viewportWidth: svgWidth });
  const isPanelCollapsed = leftSidePanel.collapsed;
  const isResizingSidePanel = leftSidePanel.isResizing;
  const effectiveSidePanelWidth = leftSidePanel.effectiveWidth;

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
    // po= 明示がない事業ピン付きリンクは、グラフ読込後に順位へ中央寄せする（下の useEffect）。
    // 初回マウント限定なのは意図的。popstate・探索履歴・AI結果の復元（applyUrlState）は
    // 「記録された表示状態をそのまま戻す」経路であり、po 非出力＝当時 offset 0 を意味する。
    // そこで中央寄せすると戻り先が記録時と別のウィンドウになり、URL も書き換わってしまう。
    if (parsed.pinnedProjectId && parsed.projectOffset === undefined && parsed.offsetTarget !== 'recipient') {
      pendingProjectOffsetPinId.current = parsed.pinnedProjectId;
    }
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
    if (parsed.filterOnMinistryClick !== undefined) setFilterOnMinistryClick(parsed.filterOnMinistryClick);
    if (parsed.year !== undefined) setYear(parsed.year);
    // Restore zoom only when no sel= (focusOnNeighborhood will handle zoom for sel= case)
    if (parsed.zoom !== undefined && parsed.selectedNodeId === undefined) {
      urlRestoredZoomRef.current = parsed.zoom;
    }
    // URL 復元時は debounced 値も同時にセットして、~150ms の stale-filter window を回避
    if (parsed.searchQuery !== undefined) { setSearchQuery(parsed.searchQuery); setDebouncedQuery(parsed.searchQuery); }
    if (parsed.showFilterPanel !== undefined) setShowFilterPanel(parsed.showFilterPanel);
    if (parsed.filterProjectName !== undefined) { setFilterProjectName(parsed.filterProjectName); setDebouncedFilterProjectName(parsed.filterProjectName); }
    if (parsed.filterProjectNameRegex !== undefined) setFilterProjectNameRegex(parsed.filterProjectNameRegex);
    if (parsed.filterRecipientName !== undefined) { setFilterRecipientName(parsed.filterRecipientName); setDebouncedFilterRecipientName(parsed.filterRecipientName); }
    if (parsed.filterRecipientNameRegex !== undefined) setFilterRecipientNameRegex(parsed.filterRecipientNameRegex);
    if (parsed.filterMinistryNames !== undefined) setFilterMinistryNames(parsed.filterMinistryNames);
    if (parsed.filterMinBudgetText !== undefined) setFilterMinBudgetText(parsed.filterMinBudgetText);
    if (parsed.filterMaxBudgetText !== undefined) setFilterMaxBudgetText(parsed.filterMaxBudgetText);
    if (parsed.filterMinSpendingText !== undefined) setFilterMinSpendingText(parsed.filterMinSpendingText);
    if (parsed.filterMaxSpendingText !== undefined) setFilterMaxSpendingText(parsed.filterMaxSpendingText);
    if (parsed.filterScoreO !== undefined) setFilterScoreO(parseScoreRangeParam(parsed.filterScoreO));
    if (parsed.filterScoreX !== undefined) setFilterScoreX(parseScoreRangeParam(parsed.filterScoreX));
    if (parsed.filterScoreN !== undefined) setFilterScoreN(parseScoreRangeParam(parsed.filterScoreN));
    if (parsed.acGeneral !== undefined) setAcGeneral(parsed.acGeneral);
    if (parsed.acSpecial !== undefined) setAcSpecial(parsed.acSpecial);
    if (parsed.acBoth    !== undefined) setAcBoth(parsed.acBoth);
    if (parsed.acNone    !== undefined) setAcNone(parsed.acNone);
    if (parsed.filterSubcontract !== undefined) setFilterSubcontract(parsed.filterSubcontract);
    if (parsed.filterRecipientIncludeSub !== undefined) setFilterRecipientIncludeSub(parsed.filterRecipientIncludeSub);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only init; state setters and refs are stable
  }, []);

  // URL(パース済み)から全表示状態を復元する。
  // ブラウザバック/フォワード（popstate）と、AIチャット結果の適用の両方から呼ばれる。
  const applyUrlState = useCallback((parsed: Partial<SankeyUrlState>) => {
      // Pre-update prev refs so reset effects don't fire for URL-restored values
      prevOffsetTargetRef.current = parsed.offsetTarget ?? 'project';
      prevProjectSortByRef.current = parsed.projectSortBy ?? 'budget';
      prevTopProjectRef.current = parsed.topProject ?? 50;
      setSelectedNodeId(parsed.selectedNodeId ?? null);
      setPinnedProjectId(parsed.pinnedProjectId ?? null);
      setPinnedRecipientId(parsed.pinnedRecipientId ?? null);
      setPinnedMinistryName(parsed.pinnedMinistryName ?? null);
      setRecipientOffset(parsed.recipientOffset ?? 0);
      setOffsetTarget(parsed.offsetTarget ?? 'project');
      setProjectOffset(parsed.projectOffset ?? 0);
      setTopMinistry(parsed.topMinistry ?? 37);
      setTopProject(parsed.topProject ?? 50);
      setTopRecipient(parsed.topRecipient ?? 50);
      setShowLabels(parsed.showLabels ?? true);
      setShowAggRecipient(parsed.showAggRecipient ?? true);
      setShowAggProject(parsed.showAggProject ?? true);
      setProjectSortBy(parsed.projectSortBy ?? 'budget');
      setScaleBudgetToVisible(parsed.scaleBudgetToVisible ?? true);
      setFocusRelated(parsed.focusRelated ?? false);
      setAutoFocusRelated(parsed.autoFocusRelated ?? false);
      setFilterOnMinistryClick(parsed.filterOnMinistryClick ?? true);
      if (parsed.year !== undefined) setYear(parsed.year);
      // URL 復元時は debounced 値も同時にセットして、~150ms の stale-filter window を回避
      const restoredSearchQuery = parsed.searchQuery ?? '';
      setSearchQuery(restoredSearchQuery);
      setDebouncedQuery(restoredSearchQuery);
      setShowFilterPanel(parsed.showFilterPanel ?? false);
      const restoredProjectName = parsed.filterProjectName ?? '';
      setFilterProjectName(restoredProjectName);
      setDebouncedFilterProjectName(restoredProjectName);
      setFilterProjectNameRegex(parsed.filterProjectNameRegex ?? false);
      const restoredRecipientName = parsed.filterRecipientName ?? '';
      setFilterRecipientName(restoredRecipientName);
      setDebouncedFilterRecipientName(restoredRecipientName);
      setFilterRecipientNameRegex(parsed.filterRecipientNameRegex ?? false);
      setFilterMinistryNames(parsed.filterMinistryNames ?? []);
      setFilterMinBudgetText(parsed.filterMinBudgetText ?? '');
      setFilterMaxBudgetText(parsed.filterMaxBudgetText ?? '');
      setFilterMinSpendingText(parsed.filterMinSpendingText ?? '');
      setFilterMaxSpendingText(parsed.filterMaxSpendingText ?? '');
      setFilterScoreO(parsed.filterScoreO !== undefined ? parseScoreRangeParam(parsed.filterScoreO) : EMPTY_SCORE_RANGE);
      setFilterScoreX(parsed.filterScoreX !== undefined ? parseScoreRangeParam(parsed.filterScoreX) : EMPTY_SCORE_RANGE);
      setFilterScoreN(parsed.filterScoreN !== undefined ? parseScoreRangeParam(parsed.filterScoreN) : EMPTY_SCORE_RANGE);
      setAcGeneral(parsed.acGeneral ?? true);
      setAcSpecial(parsed.acSpecial ?? true);
      setAcBoth(parsed.acBoth ?? true);
      setAcNone(parsed.acNone ?? true);
      setFilterSubcontract(parsed.filterSubcontract ?? '');
      setFilterRecipientIncludeSub(parsed.filterRecipientIncludeSub ?? false);
      if (parsed.selectedNodeId) pendingResetViewport.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore state on browser back/forward
  useEffect(() => {
    const handler = () => applyUrlState(parseSearchParams(window.location.search));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [applyUrlState]);

  // 探索履歴の自動記録（URL 同期・状態適用に連動して debounce）。
  // 既定状態（qs 空）は記録しない。保存先は IndexedDB のみ（exploration-store）
  const explorationRecordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleExplorationRecord = useCallback((qs: string) => {
    if (explorationRecordTimer.current) clearTimeout(explorationRecordTimer.current);
    if (!qs) return;
    explorationRecordTimer.current = setTimeout(() => {
      const query = sankeyQueryFromUrlParams(new URLSearchParams(qs));
      recordVisit(qs, buildExplorationLabel(query), query.year ?? '2025');
    }, 1500);
  }, []);

  // 共有URL等で開いた初期状態も履歴に載せる
  useEffect(() => {
    scheduleExplorationRecord(window.location.search.replace(/^\?/, ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (offsetTarget === 'recipient') p.set('ot', 'r');
    if (projectOffset !== 0) p.set('po', String(projectOffset));
    if (topMinistry !== 37) p.set('tm', String(topMinistry));
    if (topProject !== 50) p.set('tp', String(topProject));
    if (topRecipient !== 50) p.set('tr', String(topRecipient));
    if (!showLabels) p.set('sl', '0');
    if (!showAggRecipient) p.set('ar', '0');
    if (!showAggProject) p.set('ap', '0');
    if (projectSortBy === 'spending') p.set('ps', 's');
    if (!scaleBudgetToVisible) p.set('sb', '0');
    if (focusRelated) p.set('fr', '1');
    if (autoFocusRelated) p.set('afr', '1');
    if (!filterOnMinistryClick) p.set('fmc', '0');
    if (year !== '2025') p.set('yr', year);
    if (searchQuery) p.set('q', searchQuery);
    if (showFilterPanel) p.set('fp', '1');
    if (filterProjectName) p.set('fnp', filterProjectName);
    if (filterProjectNameRegex) p.set('fnpr', '1');
    if (filterRecipientName) p.set('fnr', filterRecipientName);
    if (filterRecipientNameRegex) p.set('fnrr', '1');
    for (const name of filterMinistryNames) p.append('fm', name);
    if (filterMinBudgetText) p.set('fmb', filterMinBudgetText);
    if (filterMaxBudgetText) p.set('fxb', filterMaxBudgetText);
    if (filterMinSpendingText) p.set('fms', filterMinSpendingText);
    if (filterMaxSpendingText) p.set('fxs', filterMaxSpendingText);
    const fso = scoreRangeToParam(filterScoreO); if (fso) p.set('fso', fso);
    const fsx = scoreRangeToParam(filterScoreX); if (fsx) p.set('fsx', fsx);
    const fsn = scoreRangeToParam(filterScoreN); if (fsn) p.set('fsn', fsn);
    if (!acGeneral || !acSpecial || !acBoth || !acNone) {
      p.set('ac', `${acGeneral ? 'g' : ''}${acSpecial ? 's' : ''}${acBoth ? 'b' : ''}${acNone ? 'n' : ''}`);
    }
    if (filterSubcontract) p.set('fsd', filterSubcontract);
    if (filterRecipientName && filterRecipientIncludeSub) p.set('fnrs', '1');
    const qs = p.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    if (action === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
    scheduleExplorationRecord(qs);
  }, [scheduleExplorationRecord, selectedNodeId, pinnedProjectId, pinnedRecipientId, pinnedMinistryName, recipientOffset, offsetTarget, projectOffset, topMinistry, topProject, topRecipient, showLabels, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, autoFocusRelated, filterOnMinistryClick, year, searchQuery, showFilterPanel, filterProjectName, filterProjectNameRegex, filterRecipientName, filterRecipientNameRegex, filterMinistryNames, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText, acGeneral, acSpecial, acBoth, acNone, filterSubcontract, filterRecipientIncludeSub, filterScoreO, filterScoreX, filterScoreN]);

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
  useEffect(() => {
    if (!showAccountDropdown) return;
    const onMouseDown = (e: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target as Node)) {
        setShowAccountDropdown(false);
      }
    };
    const recompute = () => {
      if (accountButtonRef.current) {
        const r = accountButtonRef.current.getBoundingClientRect();
        setAccountDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
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
  }, [showAccountDropdown]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const touchPanStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchPanOriginRef = useRef<{ x: number; y: number } | null>(null);
  const pinchLastDistanceRef = useRef<number | null>(null);
  const didPinchRef = useRef(false);
  const touchActivatedNodeIdRef = useRef<string | null>(null);
  const [isHoverSuppressed, setIsHoverSuppressed] = useState(false);
  const hoverSuppressTimerRef = useRef<number | null>(null);
  const suppressHoverPopup = isPanning || isHoverSuppressed;
  const [hoveredNodeStable, setHoveredNodeStable] = useState<LayoutNode | null>(null);
  const [hoveredLinkStable, setHoveredLinkStable] = useState<LayoutLink | null>(null);
  const hoverEnterTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (hoverEnterTimerRef.current) {
      window.clearTimeout(hoverEnterTimerRef.current);
      hoverEnterTimerRef.current = null;
    }
    // 離脱は即時、進入は遅延（マウス通過時の意図しないポップアップ抑制）
    if (hoveredNodeRaw === null && hoveredLinkRaw === null) {
      setHoveredNodeStable(null);
      setHoveredLinkStable(null);
      return;
    }
    hoverEnterTimerRef.current = window.setTimeout(() => {
      setHoveredNodeStable(hoveredNodeRaw);
      setHoveredLinkStable(hoveredLinkRaw);
    }, HOVER_ENTER_DELAY_MS);
    return () => {
      if (hoverEnterTimerRef.current) {
        window.clearTimeout(hoverEnterTimerRef.current);
        hoverEnterTimerRef.current = null;
      }
    };
  }, [hoveredNodeRaw, hoveredLinkRaw]);
  // hoverSuppressTimerRef のアンマウントクリア
  useEffect(() => () => {
    if (hoverSuppressTimerRef.current) {
      window.clearTimeout(hoverSuppressTimerRef.current);
      hoverSuppressTimerRef.current = null;
    }
  }, []);
  // サイドパネル幅ドラッグリスナは client/hooks/useSidePanel.ts（leftSidePanel）に集約済み
  // AIチャットパネル幅ドラッグリスナ（右側パネルのため左方向ドラッグで拡大）
  useEffect(() => {
    if (!isResizingAiPanel) return;
    const onMove = (ev: MouseEvent) => {
      const s = aiPanelResizeRef.current;
      if (!s) return;
      const next = Math.max(SIDE_PANEL_WIDTH_MIN, Math.min(SIDE_PANEL_WIDTH_MAX, s.startW - (ev.clientX - s.startX)));
      setAiPanelWidth(next);
    };
    const onUp = () => {
      aiPanelResizeRef.current = null;
      setIsResizingAiPanel(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingAiPanel]);

  // サーバモードの疎通確認: 無効環境（キー未設定・Vercel本番）では404が返る。
  // BYOK（使用者キー）はサーバモードと独立に利用可能なため、パネル自体は常に出す
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/sankey-chat')
      .then(res => { if (!cancelled && res.ok) setAiChatAvailable(true); })
      .catch(() => { /* 疎通失敗 = サーバモードなしとして扱う */ });
    return () => { cancelled = true; };
  }, []);

  // BYOK設定の復元（IndexedDB。未保存・非対応環境は null のまま）
  useEffect(() => {
    let cancelled = false;
    loadByokSettings().then(s => { if (!cancelled) setByokSettings(s); });
    return () => { cancelled = true; };
  }, []);

  // チャット会話の復元・永続化（IndexedDB のみ・サーバ送信なし・複数セッション）。
  // 起動時は最新セッションを復元。復元完了前の保存で空上書きしないようフラグ制御
  const [chatSessions, setChatSessions] = useState<ChatSessionMeta[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const chatHistoryLoadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const metas = await listChatSessions();
      if (cancelled) return;
      setChatSessions(metas);
      const latest = metas.length > 0 ? await loadChatSession(metas[0].id) : null;
      if (cancelled) return;
      if (latest) {
        setChatSessionId(latest.id);
        setAiChatMessages(latest.messages);
      } else {
        setChatSessionId(crypto.randomUUID());
      }
      chatHistoryLoadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!chatHistoryLoadedRef.current || !chatSessionId || aiChatMessages.length === 0) return;
    const timer = setTimeout(() => {
      saveChatSession(chatSessionId, aiChatMessages).then(() => listChatSessions().then(setChatSessions));
    }, 500);
    return () => clearTimeout(timer);
  }, [aiChatMessages, chatSessionId]);

  // 「クリア」= 新しい会話の開始（以前の会話はセッション一覧に残る）
  const handleNewChatSession = useCallback(() => {
    setChatSessionId(crypto.randomUUID());
    setAiChatMessages([]);
    setAiChatProgress(null);
  }, []);

  const handleSwitchChatSession = useCallback(async (id: string) => {
    const session = await loadChatSession(id);
    if (!session) return;
    setChatSessionId(session.id);
    setAiChatMessages(session.messages);
    setAiChatProgress(null);
  }, []);

  const handleRenameChatSession = useCallback(async (id: string, title: string) => {
    await renameChatSession(id, title);
    setChatSessions(await listChatSessions());
  }, []);

  const handleDeleteChatSession = useCallback(async (id: string) => {
    await deleteChatSession(id);
    setChatSessions(await listChatSessions());
    if (id === chatSessionId) {
      setChatSessionId(crypto.randomUUID());
      setAiChatMessages([]);
    }
  }, [chatSessionId]);

  // 実行モード: キー登録済みなら BYOK を優先、なければサーバモード、どちらも無ければ未設定
  const aiChatMode: 'byok' | 'server' | null = byokSettings ? 'byok' : aiChatAvailable ? 'server' : null;

  // BYOKツール実行用の graph 取得: 表示中の年度はページの graph を再利用し、
  // 他年度（compare_years 等）は /data から fetch してセッション内キャッシュする
  const byokGraphCacheRef = useRef(new Map<string, GraphData>());
  const byokGetGraph = useCallback<ClientGraphSource>(async y => {
    if (y === year && graphData) return graphData;
    const cached = byokGraphCacheRef.current.get(y);
    if (cached) return cached;
    // no-cache: 必ず ETag 再検証（更新時のみ本体取得・未更新は304）。データ構造更新後の
    // 古いキャッシュ配信を防ぐ（graph はフィルタ機能追加でフィールドが増えるため）
    const res = await fetch(`/data/sankey-svg-${y}-graph.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${y}年度のグラフデータの取得に失敗しました（HTTP ${res.status}）`);
    const data = await res.json() as GraphData;
    byokGraphCacheRef.current.set(y, data);
    return data;
  }, [year, graphData]);

  // BYOK設定の保存・削除（AiChatPanel の設定ビューから呼ばれる）。
  // apiKey が null のときは登録済みキーを維持してモデルだけ更新する
  const handleSaveByok = useCallback(async (apiKey: string | null, model: string) => {
    const key = apiKey ?? byokSettings?.apiKey;
    if (!key) throw new Error('APIキーが未登録です');
    const settings: ByokSettings = { apiKey: key, model };
    await saveByokSettings(settings);
    setByokSettings(settings);
  }, [byokSettings]);
  const handleDeleteByok = useCallback(async () => {
    await deleteByokSettings();
    setByokSettings(null);
    // BYOK下の会話をサーバモードへ引き継がない: 残すと後のサーバモード送信で
    // BYOK中の会話全文が /api/ai/sankey-chat へ送られ、プライバシー境界が変わってしまう。
    // 保存済みセッションから再開しても同じことが起きるため、全セッションを削除する
    await deleteAllChatSessions();
    setChatSessions([]);
    setChatSessionId(crypto.randomUUID());
    setAiChatMessages([]);
    setAiChatProgress(null);
  }, []);

  // SSE応答本文をパースし、progress は逐次state更新、result/error で終端メッセージを積む。
  // 途中切断（result/error を受け取れずストリームが閉じる）は従来のエラー表示に落とす
  const consumeAiChatStream = useCallback(async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let settled = false;
    let sepIndex: number;
    while (!settled) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        let eventName = 'message';
        let dataLine = '';
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith(':')) continue; // ping コメント行は無視
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (eventName === 'progress') {
          setAiChatProgress(parsed as SankeyChatProgressEvent);
        } else if (eventName === 'result') {
          const data = parsed as SankeyChatResponse;
          setAiChatMessages(prev => [...prev, { role: 'assistant', content: data.message, result: data.result, suggestions: data.suggestions }]);
          setAiChatProgress(null);
          settled = true;
        } else if (eventName === 'error') {
          const data = parsed as { error?: string };
          setAiChatMessages(prev => [...prev, { role: 'assistant', content: `エラー: ${data.error ?? '不明なエラー'}`, isError: true }]);
          setAiChatProgress(null);
          settled = true;
        }
      }
    }
    if (!settled) {
      setAiChatMessages(prev => [...prev, { role: 'assistant', content: 'エラー: 通信に失敗しました。再度お試しください', isError: true }]);
      setAiChatProgress(null);
    }
  }, []);

  // AIチャット送信: 履歴全量 + 現在のビュー状態（URL由来のSankeyQuery）をステートレスAPIへ送る。
  // stream:true を付け、応答が text/event-stream ならSSEパース、JSONなら従来処理にフォールバックする
  const handleAiChatSend = useCallback(async (text: string) => {
    const userMessage: AiChatUiMessage = { role: 'user', content: text };
    setAiChatMessages(prev => [...prev, userMessage]);
    setAiChatSending(true);
    setAiChatProgress(null);
    try {
      // エラーバブルは role/content のみの API 履歴に含めない（isError 付きは表示専用）
      const history = [...aiChatMessages, userMessage]
        .filter(m => !m.isError)
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-MAX_CHAT_MESSAGES);
      const currentQuery = sankeyQueryFromUrlParams(new URLSearchParams(window.location.search));

      // BYOKモード: ブラウザ内でエージェントループを実行（LLMはOpenRouter直接、
      // ツールは公開API fetch + graph ローカル実行）。キー・会話本文は自サイトへ
      // 送信されない（ツールの検索キーワード等のみ公開データAPIへ送られる）
      if (byokSettings) {
        try {
          const agentResult = await runByokChat({
            messages: history,
            context: { year, currentQuery },
            settings: byokSettings,
            getGraph: byokGetGraph,
            onProgress: ev => setAiChatProgress(ev),
          });
          setAiChatMessages(prev => [...prev, {
            role: 'assistant',
            content: agentResult.message,
            result: agentResult.result,
            suggestions: agentResult.suggestions,
          }]);
        } catch (e) {
          // LlmUpstreamError の message はユーザー向け文言（キー拒否・接続失敗等）。キーは含まれない
          const text = e instanceof LlmUpstreamError
            ? e.message
            : e instanceof Error && e.name === 'TimeoutError'
              ? 'AIの応答がタイムアウトしました。時間をおいて再度お試しください'
              : 'AIが応答できませんでした。時間をおいて再度お試しください';
          setAiChatMessages(prev => [...prev, { role: 'assistant', content: `エラー: ${text}`, isError: true }]);
        }
        return;
      }

      const res = await fetch('/api/ai/sankey-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context: { year, currentQuery }, stream: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        const detail = body?.error ?? `HTTP ${res.status}`;
        setAiChatMessages(prev => [...prev, { role: 'assistant', content: `エラー: ${detail}`, isError: true }]);
        return;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream') && res.body) {
        await consumeAiChatStream(res.body);
      } else {
        // 従来のJSON応答へのフォールバック（例: SSE非対応の中間層を経由する場合）
        const data = await res.json() as SankeyChatResponse;
        setAiChatMessages(prev => [...prev, { role: 'assistant', content: data.message, result: data.result, suggestions: data.suggestions }]);
      }
    } catch {
      setAiChatMessages(prev => [...prev, { role: 'assistant', content: 'エラー: 通信に失敗しました。再度お試しください', isError: true }]);
    } finally {
      setAiChatSending(false);
      setAiChatProgress(null);
    }
  }, [aiChatMessages, year, consumeAiChatStream, byokSettings, byokGetGraph]);

  // AIチャット結果の適用: SankeyQuery → URL変換 → pushState → popstate と同じ復元経路で図を更新。
  // フルリロードしないためチャット履歴が保持され、ブラウザバックで適用前の図に戻れる
  const applyAiChatResult = useCallback((result: SankeyChatResult) => {
    const params = sankeyQueryToUrlParams(result.query);
    const qs = params.toString();
    window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
    applyUrlState(parseSearchParams(window.location.search));
    // フィルタで図が大きく変わるため、レイアウト確定後に全体表示へフィットさせる
    pendingResetViewport.current = true;
    scheduleExplorationRecord(qs);
  }, [applyUrlState, scheduleExplorationRecord]);

  // 探索履歴・メモの適用: AIチャット結果適用と同じ URL 復元経路を使う
  const applyExplorationEntry = useCallback((qs: string) => {
    window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
    applyUrlState(parseSearchParams(window.location.search));
    pendingResetViewport.current = true;
    scheduleExplorationRecord(qs);
  }, [applyUrlState, scheduleExplorationRecord]);

  // メモ保存用: 現在の URL 状態のスナップショット（ラベルは自動合成）
  const getExplorationSnapshot = useCallback(() => {
    const qs = window.location.search.replace(/^\?/, '');
    const query = sankeyQueryFromUrlParams(new URLSearchParams(qs));
    return { qs, label: buildExplorationLabel(query), year: query.year ?? '2025' };
  }, []);

  // チャットのレポート応答を発見メモとして保存（現在の図の状態に紐づく。
  // 常に新規エントリとして追記され、同一状態に複数のレポートを残せる）。
  // タイトルは Markdown の最初の見出し（無ければ先頭行）から自動抽出する
  const handleSaveReportMemo = useCallback(async (reportText: string) => {
    const snap = getExplorationSnapshot();
    const headingLine = reportText.split('\n').map(l => l.trim()).find(l => /^#{1,3}\s+\S/.test(l));
    const firstLine = reportText.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    const rawTitle = (headingLine ?? firstLine).replace(/^#{1,3}\s+/, '').replace(/\*\*/g, '');
    const title = rawTitle.length > 40 ? `${rawTitle.slice(0, 40)}…` : rawTitle;
    await saveMemo(snap.qs, snap.label, snap.year, reportText, title || undefined);
  }, [getExplorationSnapshot]);

  // 事業概要プレビュー高さドラッグリスナ
  useEffect(() => {
    if (!isResizingOverview) return;
    const onMove = (ev: MouseEvent) => {
      const s = overviewResizeRef.current;
      if (!s) return;
      const next = Math.max(PROJECT_OVERVIEW_PREVIEW_HEIGHT_MIN, Math.min(PROJECT_OVERVIEW_PREVIEW_HEIGHT_MAX, s.startH + (ev.clientY - s.startY)));
      setProjectOverviewPreviewHeight(next);
    };
    const onUp = () => {
      overviewResizeRef.current = null;
      setIsResizingOverview(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingOverview]);
  // 予算・執行カードリスト高さドラッグリスナ
  useEffect(() => {
    if (!isResizingBudgetExecution) return;
    const onMove = (ev: MouseEvent) => {
      const s = budgetExecutionResizeRef.current;
      if (!s) return;
      const next = Math.max(BUDGET_EXECUTION_LIST_HEIGHT_MIN, Math.min(BUDGET_EXECUTION_LIST_HEIGHT_MAX, s.startH + (ev.clientY - s.startY)));
      setBudgetExecutionListHeight(next);
    };
    const onUp = () => {
      budgetExecutionResizeRef.current = null;
      setIsResizingBudgetExecution(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingBudgetExecution]);
  const hoveredLink = suppressHoverPopup ? null : hoveredLinkStable;
  const hoveredNode = suppressHoverPopup ? null : hoveredNodeStable;
  const panOrigin = useRef({ x: 0, y: 0 });
  const didPanRef = useRef(false);
  // 押し続けで増減するリピートボタン用ハンドラ（オフセットコントロール）。
  // TopN・フォントサイズのリピートは各コントロールコンポーネント側で同フックを使う。
  const offsetRepeat = useRepeatPress();
  const subDepthRepeat = useRepeatPress();
  // 再委託階層の数値直接入力（TopNSliderRow と同型のクリック編集）
  const [subDepthEditing, setSubDepthEditing] = useState(false);
  const [subDepthInput, setSubDepthInput] = useState('');
  // 再委託スライダの上限 = グラフ中の最大ブロック階層数（データ無しなら5）
  const maxSubcontractDepth = useMemo(() => {
    let m = 5;
    if (graphData) for (const n of graphData.nodes) if (n.subcontractDepth != null && n.subcontractDepth > m) m = n.subcontractDepth;
    return m;
  }, [graphData]);
  // URL履歴を replace で更新するためのマーク（子コンポーネントにも渡す）
  const markHistoryReplace = useCallback(() => { pendingHistoryAction.current = 'replace'; }, []);

  // Reset both offsets when offsetTarget switches
  // Reset offsets and sync URL when filter conditions change
  const filterSigInitRef = useRef(false);
  useEffect(() => {
    if (!filterSigInitRef.current) { filterSigInitRef.current = true; return; }
    pendingHistoryAction.current = 'replace';
    setRecipientOffset(0);
    setProjectOffset(0);
  }, [filterMinistryNames, debouncedFilterProjectName, debouncedFilterRecipientName, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText, filterSubcontract, filterRecipientIncludeSub, filterScoreO, filterScoreX, filterScoreN]);

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

  const layoutRef = useRef<{ contentW: number; contentH: number; nodes: ShiftLayoutNode[] } | null>(null);
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;

  const fontScale = baseFontPx / FONT_SCALE_REFERENCE_PX;
  const scaleFont = useMemo(() => createScaleFont(baseFontPx), [baseFontPx]);
  const scaleSize = scaleFont;
  // Top offset reserved for search/year/TopN controls. Narrow screens need another row's worth of breathing room.
  const SEARCH_BOX_RESERVE = Math.round((svgWidth < 1100 ? 92 : 56) * Math.max(1, fontScale));
  const searchBoxReserveRef = useRef(SEARCH_BOX_RESERVE);
  searchBoxReserveRef.current = SEARCH_BOX_RESERVE;
  const MAP_LABEL_FONT_PX = scaleFont(MAP_LABEL_FONT_PX_DEFAULT);
  const MAP_LABEL_SLOT_PX = scaleFont(MAP_LABEL_SLOT_PX_DEFAULT);
  const MAP_LABEL_VISIBLE_MIN_H_PX = scaleFont(MAP_LABEL_VISIBLE_MIN_H_PX_DEFAULT);
  const COLUMN_LABEL_FONT_PX = scaleFont(COLUMN_LABEL_FONT_PX_DEFAULT);
  const COLUMN_AMOUNT_FONT_PX = scaleFont(COLUMN_AMOUNT_FONT_PX_DEFAULT);
  const SEARCH_FONT_PX = scaleFont(SEARCH_FONT_PX_DEFAULT);
  const CONTROL_FONT_PX = scaleFont(CONTROL_FONT_PX_DEFAULT);
  const CONTROL_SMALL_FONT_PX = scaleFont(CONTROL_SMALL_FONT_PX_DEFAULT);
  const META_FONT_PX = scaleFont(META_FONT_PX_DEFAULT);
  const PANEL_TITLE_FONT_PX = scaleFont(PANEL_TITLE_FONT_PX_DEFAULT);
  const PANEL_PRIMARY_VALUE_FONT_PX = scaleFont(PANEL_PRIMARY_VALUE_FONT_PX_DEFAULT);
  const PANEL_LIST_NAME_FONT_PX = scaleFont(PANEL_LIST_NAME_FONT_PX_DEFAULT);
  const PANEL_LIST_VALUE_FONT_PX = scaleFont(PANEL_LIST_VALUE_FONT_PX_DEFAULT);
  const PANEL_META_FONT_PX = scaleFont(PANEL_META_FONT_PX_DEFAULT);
  const TOOLTIP_TITLE_FONT_PX = scaleFont(TOOLTIP_TITLE_FONT_PX_DEFAULT);
  const TOOLTIP_VALUE_FONT_PX = scaleFont(TOOLTIP_VALUE_FONT_PX_DEFAULT);
  const TOOLTIP_META_FONT_PX = scaleFont(TOOLTIP_META_FONT_PX_DEFAULT);
  const SEARCH_BOX_WIDTH_PX = Math.round(Math.max(260, Math.min(440, 296 * fontScale)));
  const SEARCH_ICON_BOX_PX = scaleSize(20);
  const SEARCH_ICON_PX = scaleSize(16);
  const SEARCH_INPUT_PAD_Y_PX = scaleSize(7);
  const SEARCH_INPUT_PAD_LEFT_PX = scaleSize(30);
  const SEARCH_INPUT_PAD_RIGHT_PX = searchQuery ? scaleSize(58) : scaleSize(38);
  const SEARCH_INLINE_BUTTON_PAD_X_PX = scaleSize(4);
  const SEARCH_INLINE_BUTTON_OFFSET_PX = scaleSize(6);
  const SEARCH_INLINE_BUTTON_GAP_PX = scaleSize(24);
  const SEARCH_CLEAR_BUTTON_FONT_PX = scaleFont(14);
  const SEARCH_RESULT_GAP_PX = scaleSize(8);
  const SEARCH_RESULT_PAD_Y_PX = scaleSize(7);
  const SEARCH_RESULT_PAD_X_PX = scaleSize(10);
  const SEARCH_RESULT_SWATCH_PX = scaleSize(8);
  const FILTER_CLEAR_BUTTON_PX = scaleSize(32);
  const FILTER_CLEAR_ICON_PX = scaleSize(18);
  const FONT_CONTROL_BUTTON_PX = 32;
  const FONT_CONTROL_ICON_PX = 18;
  const mapLabelFontPx = MAP_LABEL_FONT_PX;
  const mapLabelSlotPx = MAP_LABEL_SLOT_PX;
  const mapLabelVisibleMinHPx = MAP_LABEL_VISIBLE_MIN_H_PX;
  const mapLabelMetricsRef = useRef({ fontPx: mapLabelFontPx, slotPx: mapLabelSlotPx, visibleMinHPx: mapLabelVisibleMinHPx });
  mapLabelMetricsRef.current = { fontPx: mapLabelFontPx, slotPx: mapLabelSlotPx, visibleMinHPx: mapLabelVisibleMinHPx };
  const fitTopPadPx = FIT_TOP_PAD_PX;
  const fitTopPadPxRef = useRef(fitTopPadPx);
  fitTopPadPxRef.current = fitTopPadPx;

  // Compute max extra height from label shifts at a given zoom level (2-pass helper).
  // During fit, pass baseZoomK=zoomK to keep the whole-view baseline unchanged.
  const calcShiftExtraH = useCallback((nodes: ShiftLayoutNode[], zoomK: number, baseZoomK = zoomK): number => {
    if (!showLabelsRef.current) return 0;
    const colShifts = new Map<number, number>();
    const labelScale = getZoomLabelScale(zoomK, baseZoomK);
    const spendingH = new Map<string, number>();
    for (const node of nodes) {
      if (node.type === 'project-spending' && node.projectId != null) {
        spendingH.set(`project-budget-${node.projectId}`, Math.max(1, node.y1 - node.y0));
      } else if (node.id === '__agg-project-spending') {
        spendingH.set('__agg-project-budget', Math.max(1, node.y1 - node.y0));
      }
    }
    const nodesByColumn = new Map<number, ShiftLayoutNode[]>();
    for (const node of nodes) {
      const col = getColumn(node);
      if (!nodesByColumn.has(col)) nodesByColumn.set(col, []);
      nodesByColumn.get(col)!.push(node);
    }
    for (const [col, colNodes] of nodesByColumn) {
      const sorted = [...colNodes].sort((a, b) => a.y0 - b.y0);
      let totalShift = 0;
      for (let i = 0; i < sorted.length; i++) {
        const node = sorted[i];
        if (i > 0 && sortPriority(node) > sortPriority(sorted[i - 1])) {
          totalShift += AGGREGATE_BOUNDARY_GAP_PX / zoomK;
        }
        const ownH = Math.max(1, node.y1 - node.y0);
        const h = node.type === 'project-budget' || node.id === '__agg-project-budget'
          ? Math.max(ownH, spendingH.get(node.id) ?? ownH)
          : ownH;
        const slotPx = mapLabelMetricsRef.current.slotPx * labelScale;
        totalShift += h * zoomK < slotPx ? Math.max(0, slotPx / zoomK - h) : 0;
      }
      colShifts.set(col, totalShift);
    }
    return colShifts.size > 0 ? Math.max(...colShifts.values()) : 0;
  }, []);

  const getZoomAnchoredPanY = useCallback((anchorY: number, nextZoom: number): number => {
    const l = layoutRef.current;
    if (!l) return anchorY - (anchorY - pan.y) * (nextZoom / zoom);
    const currentTotalH = MARGIN.top + l.contentH + calcShiftExtraH(l.nodes, zoom, baseZoom);
    const nextTotalH = MARGIN.top + l.contentH + calcShiftExtraH(l.nodes, nextZoom, baseZoom);
    const currentScreenH = Math.max(1, currentTotalH * zoom);
    const nextScreenH = Math.max(1, nextTotalH * nextZoom);
    const ratioFromTop = (anchorY - pan.y) / currentScreenH;
    return anchorY - ratioFromTop * nextScreenH;
  }, [baseZoom, calcShiftExtraH, pan.y, zoom]);

  // Prevent overlay control interactions from bubbling into canvas pan/zoom
  const isOverlayControlTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest('[data-pan-disabled],button,input,select,textarea,label');

  const beginHoverSuppressCooldown = useCallback(() => {
    setIsHoverSuppressed(true);
    if (hoverSuppressTimerRef.current) window.clearTimeout(hoverSuppressTimerRef.current);
    hoverSuppressTimerRef.current = window.setTimeout(() => setIsHoverSuppressed(false), HOVER_SUPPRESS_AFTER_INTERACTION_MS);
  }, []);

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

  const handleWheel = useCallback((e: WheelEvent) => {
    if (isOverlayControlTarget(e.target)) return;
    e.preventDefault();
    setIsHoverSuppressed(true);
    if (hoverSuppressTimerRef.current) window.clearTimeout(hoverSuppressTimerRef.current);
    hoverSuppressTimerRef.current = window.setTimeout(() => setIsHoverSuppressed(false), HOVER_SUPPRESS_AFTER_INTERACTION_MS);
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const my = e.clientY - rect.top;

    const doZoom = (dy: number) => {
      const delta = dy > 0 ? 0.9 : 1.1;
      const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
      const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
      const newZoom = Math.max(minZoom, Math.min(maxZoom, zoom * delta));
      const newPanY = getZoomAnchoredPanY(my, newZoom);
      setZoom(newZoom);
      setPan({ x: pan.x, y: newPanY });
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
  }, [zoom, pan, baseZoom, getZoomAnchoredPanY, scheduleZoomUrlWrite, scrollMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

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
    // 実際にパンが発生したときだけクールダウン（単なるクリックでは抑制しない）
    if (!didPanRef.current) return;
    beginHoverSuppressCooldown();
  }, [beginHoverSuppressCooldown]);

  const getTouchPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  }, []);

  const getPinchState = useCallback((): { distance: number; midpoint: { x: number; y: number } } | null => {
    const points = Array.from(activePointersRef.current.values());
    if (points.length < 2) return null;
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      distance: Math.max(1, Math.hypot(dx, dy)),
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }, []);

  const getTouchZoomAnchoredPanY = useCallback((
    anchorY: number,
    nextZoom: number,
    fromZoom: number,
    fromPanY: number,
  ): number => {
    const l = layoutRef.current;
    if (!l) return anchorY - (anchorY - fromPanY) * (nextZoom / fromZoom);
    const currentTotalH = MARGIN.top + l.contentH + calcShiftExtraH(l.nodes, fromZoom, baseZoom);
    const nextTotalH = MARGIN.top + l.contentH + calcShiftExtraH(l.nodes, nextZoom, baseZoom);
    const currentScreenH = Math.max(1, currentTotalH * fromZoom);
    const nextScreenH = Math.max(1, nextTotalH * nextZoom);
    const ratioFromTop = (anchorY - fromPanY) / currentScreenH;
    return anchorY - ratioFromTop * nextScreenH;
  }, [baseZoom, calcShiftExtraH]);

  const setTouchViewport = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  const resetTouchPanOriginToRemainingPointer = useCallback(() => {
    const remaining = Array.from(activePointersRef.current.values())[0] ?? null;
    touchPanStartRef.current = remaining;
    touchPanOriginRef.current = remaining ? { ...panRef.current } : null;
  }, []);

  const handleTouchPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || isOverlayControlTarget(e.target)) return;
    const point = getTouchPoint(e);
    activePointersRef.current.set(e.pointerId, point);
    setIsPanning(true);
    setHoveredNode(null);
    setHoveredLink(null);

    if (activePointersRef.current.size === 1) {
      didPanRef.current = false;
      didPinchRef.current = false;
      pinchLastDistanceRef.current = null;
      touchPanStartRef.current = point;
      touchPanOriginRef.current = { ...panRef.current };
      return;
    }

    const pinch = getPinchState();
    if (pinch) {
      didPanRef.current = true;
      didPinchRef.current = true;
      pinchLastDistanceRef.current = pinch.distance;
      touchPanStartRef.current = null;
      touchPanOriginRef.current = null;
    }
  }, [getPinchState, getTouchPoint]);

  const handleTouchPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !activePointersRef.current.has(e.pointerId)) return;
    e.preventDefault();
    const point = getTouchPoint(e);
    activePointersRef.current.set(e.pointerId, point);

    if (activePointersRef.current.size >= 2) {
      const pinch = getPinchState();
      if (!pinch) return;
      const lastDistance = pinchLastDistanceRef.current ?? pinch.distance;
      const ratio = pinch.distance / Math.max(1, lastDistance);
      const fromZoom = zoomRef.current;
      const fromPan = panRef.current;
      const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
      const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, fromZoom * ratio));
      const nextPanY = getTouchZoomAnchoredPanY(pinch.midpoint.y, nextZoom, fromZoom, fromPan.y);
      didPanRef.current = true;
      didPinchRef.current = true;
      pinchLastDistanceRef.current = pinch.distance;
      setTouchViewport(nextZoom, { x: fromPan.x, y: nextPanY });
      return;
    }

    const start = touchPanStartRef.current;
    const origin = touchPanOriginRef.current;
    if (!start || !origin) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (Math.abs(dx) > TOUCH_PAN_SLOP_PX || Math.abs(dy) > TOUCH_PAN_SLOP_PX) didPanRef.current = true;
    const nextPan = { x: origin.x + dx, y: origin.y + dy };
    panRef.current = nextPan;
    setPan(nextPan);
  }, [baseZoom, getPinchState, getTouchPoint, getTouchZoomAnchoredPanY, setTouchViewport]);

  const handleTouchPointerEnd = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    activePointersRef.current.delete(e.pointerId);
    pinchLastDistanceRef.current = null;

    if (activePointersRef.current.size === 0) {
      setIsPanning(false);
      touchPanStartRef.current = null;
      touchPanOriginRef.current = null;
      if (didPinchRef.current) scheduleZoomUrlWrite();
      if (didPanRef.current) beginHoverSuppressCooldown();
      return;
    }

    resetTouchPanOriginToRemainingPointer();
  }, [beginHoverSuppressCooldown, resetTouchPanOriginToRemainingPointer, scheduleZoomUrlWrite]);

  // Converge on fit zoom accounting for label shifts (shifts grow as zoom shrinks → iterate)
  const fitZoomWithShifts = useCallback((
    nodes: ShiftLayoutNode[],
    contentW: number, contentH: number, cW: number, availH: number
  ): { k: number; totalH: number } => {
    let k = Math.max(ZOOM_MIN_ABS, Math.min(ZOOM_MAX_ABS, (availH / (MARGIN.top + contentH)) * 0.9));
    let totalH = MARGIN.top + contentH;
    for (let i = 0; i < 6; i++) {
      const extraH = calcShiftExtraH(nodes, k);
      totalH = MARGIN.top + contentH + extraH;
      const newK = Math.max(ZOOM_MIN_ABS, Math.min(ZOOM_MAX_ABS, (availH / totalH) * 0.9));
      if (Math.abs(newK - k) < 0.0005) { k = newK; break; }
      k = newK;
    }
    return { k, totalH };
  }, [calcShiftExtraH]);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    setRecipientOffset(0);
    if (container && l) {
      const cW = container.clientWidth;
      const reserve = searchBoxReserveRef.current;
      const availH = container.clientHeight - reserve;
      const { k, totalH } = fitZoomWithShifts(l.nodes, l.contentW, l.contentH, cW, availH);
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: 0, y: reserve + Math.min((availH - totalH * k) / 2, fitTopPadPxRef.current) });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: searchBoxReserveRef.current });
    }
  }, [fitZoomWithShifts]);

  // Viewport-only reset (zoom/pan only, recipientOffset unchanged)
  const resetViewport = useCallback(() => {
    const container = containerRef.current;
    const l = layoutRef.current;
    if (container && l) {
      const cW = container.clientWidth;
      const reserve = searchBoxReserveRef.current;
      const availH = container.clientHeight - reserve;
      const { k, totalH } = fitZoomWithShifts(l.nodes, l.contentW, l.contentH, cW, availH);
      setZoom(k);
      setBaseZoom(k);
      setPan({ x: 0, y: reserve + Math.min((availH - totalH * k) / 2, fitTopPadPxRef.current) });
    } else {
      setZoom(1);
      setBaseZoom(1);
      setPan({ x: 0, y: searchBoxReserveRef.current });
    }
  }, [fitZoomWithShifts]);

  // Minimap refs (hooks must be unconditional)
  const MINIMAP_W = 200;
  const minimapH = Math.round(MINIMAP_W * (svgHeight / (svgWidth || 1)));
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapDragging = useRef(false);
  const [showMinimap, setShowMinimap] = useState(false);
  // スマホ幅ではミニマップを表示しない（実機の縦横ともに画面が狭く有用性が低いため）
  const minimapVisible = showMinimap && !isCompactWidth;
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  // スマホ縦のとき、サイドパネルのリスト下端がオフセットコントロールに隠れないよう
  // コントロールの実高を計測してリストの下パディングを確保する。
  const offsetControlRef = useRef<HTMLDivElement>(null);
  const [offsetControlHeight, setOffsetControlHeight] = useState(0);

  // Layout constants for bottom-right widgets the dropdown must clear
  const MINIMAP_BOTTOM = 8;       // minimap wrapper bottom offset
  const MINIMAP_BUFFER = 32;      // extra clearance above minimap when visible
  const MAP_ICON_BOTTOM = 32;     // bottom clearance for map icon (includes extra margin)
  const MAP_ICON_HEIGHT = 32;     // map icon button height
  const MAP_ICON_GAP = 8;         // gap between map icon and dropdown bottom
  const DROPDOWN_GAP = 12;        // gap between search box bottom and dropdown top

  const [searchBoxBottom, setSearchBoxBottom] = useState(52); // 12 (top) + ~40 (approx height)
  // 展開中のフィルタパネルの実高。列ヘッダーの基準位置を「フィルタ非展開時」に固定するため使う。
  const [filterPanelHeight, setFilterPanelHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const r = searchBoxRef.current?.getBoundingClientRect();
      if (r) setSearchBoxBottom(r.bottom);
      const fr = filterPanelRef.current?.getBoundingClientRect();
      setFilterPanelHeight(fr ? fr.height : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (searchBoxRef.current) ro.observe(searchBoxRef.current);
    if (filterPanelRef.current) ro.observe(filterPanelRef.current);
    return () => ro.disconnect();
  }, [showFilterPanel]);

  const searchDropdownMaxH = useMemo(() => {
    const obstacleTop = minimapVisible
      ? svgHeight - MINIMAP_BOTTOM - MINIMAP_BUFFER - minimapH
      : svgHeight - MAP_ICON_BOTTOM - MAP_ICON_HEIGHT - MAP_ICON_GAP;
    return Math.max(120, obstacleTop - searchBoxBottom - DROPDOWN_GAP);
  }, [svgHeight, minimapH, minimapVisible, searchBoxBottom]);

  useEffect(() => {
    setGraphData(null);
    setLoading(true);
    setError(null);
    // no-cache: 必ず ETag 再検証（未更新は304・帯域ゼロ、更新時のみ本体取得）。
    // データ構造更新後に古いキャッシュ版を掴み続ける問題（再委託フィルタで顕在化）の対策
    fetch(`/data/sankey-svg-${year}-graph.json`, { cache: 'no-cache' })
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

  // 政策評価サマリ（事業単位）。サーバ側で算出済みの軽量データを年度ごとに取得する。
  // 取得に失敗しても Sankey 本体の表示は妨げない（スコア欄が出ないだけ）。
  const [policySummary, setPolicySummary] = useState<PolicySummaryResponse | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  useEffect(() => {
    let aborted = false;
    setPolicySummary(null);
    setPolicyError(null);
    fetch(`/api/policy-summary?year=${year}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: PolicySummaryResponse) => { if (!aborted) setPolicySummary(json); })
      .catch((e: Error) => { if (!aborted) setPolicyError(e.message || '取得失敗'); });
    return () => { aborted = true; };
  }, [year]);

  // 政策評価スコアの足きり（総合点・費用対内容・必要性）。API のクエリスキーマには載せず、
  // buildFilterExcludedIds の事業単位フックとして差し込む（policySummary は画面側にしか無いため）。
  const scoreExcludeProject = useMemo(() => {
    const parseBound = (t: string): number | null => {
      const trimmed = t.trim();
      if (trimmed === '') return null;
      const v = Number(trimmed);
      return Number.isFinite(v) ? v : null;
    };
    const scoreFilters = ([
      ['o', filterScoreO], ['x', filterScoreX], ['n', filterScoreN],
    ] as const)
      .map(([key, r]) => ({ key, min: parseBound(r.min), max: parseBound(r.max) }))
      .filter(f => f.min !== null || f.max !== null);
    // 未ロード時は効かせない（スコア取得前に事業が消えるのを避ける）
    if (scoreFilters.length === 0 || policySummary === null) return null;
    return (projectId: number) => {
      const entry = policySummary.items[String(projectId)];
      for (const f of scoreFilters) {
        const v = entry?.[f.key];
        // 足きり指定時、未評価（スコア無し）の事業は落とす。0点扱いで残すと絞り込みの意味が薄れる
        if (v === null || v === undefined) return true;
        if (f.min !== null && v < f.min) return true;
        if (f.max !== null && v > f.max) return true;
      }
      return false;
    };
  }, [filterScoreO, filterScoreX, filterScoreN, policySummary]);

  // Pre-filter exclusion set: built from filter conditions, applied before filterTopN
  // (除外ロジック本体は app/lib/sankey-query.ts に移設。ここでは UI 状態 → フィルタ条件への変換のみ行う)
  const filterExcludedIds = useMemo(() => {
    if (!graphData) return null;
    const trimmedProjectName = debouncedFilterProjectName.trim();
    const trimmedRecipientName = debouncedFilterRecipientName.trim();
    const accountCategories: AccountCategoryKey[] = [];
    if (acGeneral) accountCategories.push('general');
    if (acSpecial) accountCategories.push('special');
    if (acBoth) accountCategories.push('both');
    if (acNone) accountCategories.push('none');
    return buildFilterExcludedIds(
      graphData.nodes,
      graphData.edges,
      {
        projectName: trimmedProjectName ? { query: trimmedProjectName, regex: filterProjectNameRegex } : null,
        recipientName: trimmedRecipientName
          ? { query: trimmedRecipientName, regex: filterRecipientNameRegex, ...(filterRecipientIncludeSub ? { includeSubcontract: true } : {}) }
          : null,
        ministries: filterMinistryNames,
        budget: { min: parseAmountToYen(filterMinBudgetText), max: parseAmountToYen(filterMaxBudgetText) },
        spending: { min: parseAmountToYen(filterMinSpendingText), max: parseAmountToYen(filterMaxSpendingText) },
        accountCategories,
        subcontract: {
          hasRedelegation: false,
          minDepth: filterSubcontract ? parseInt(filterSubcontract, 10) : null,
        },
      },
      [selectedNodeId, pinnedProjectId],
      // 政策評価スコアの足きり。事業単位フックとして差し込む（policySummary は画面側にしか無い）
      scoreExcludeProject,
    );
  }, [graphData, selectedNodeId, pinnedProjectId, filterMinistryNames, filterMinBudgetText, filterMaxBudgetText, filterMinSpendingText, filterMaxSpendingText, debouncedFilterProjectName, debouncedFilterRecipientName, filterProjectNameRegex, filterRecipientNameRegex, acGeneral, acSpecial, acBoth, acNone, filterSubcontract, filterRecipientIncludeSub, scoreExcludeProject]);

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
    return filterTopN(nodes, edges, topMinistry, topProject, topRecipient, clampedOffset, pinnedProjectId, true, showAggRecipient, showAggProject, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset, projectSortBy, !!filterRecipientName.trim());
  }, [graphData, topMinistry, topProject, topRecipient, recipientOffset, pinnedProjectId, showAggRecipient, showAggProject, projectSortBy, scaleBudgetToVisible, focusRelated, pinnedRecipientId, pinnedMinistryName, offsetTarget, projectOffset, filterExcludedIds, filterRecipientName]);

  // オフセットコントロールの実高を計測（スマホ縦のリスト下パディング用）。
  // 再購読はコントロールのマウント/アンマウント時のみで十分。サイズ変化は ResizeObserver が拾う。
  const offsetControlMounted = filtered != null;
  useLayoutEffect(() => {
    const el = offsetControlRef.current;
    if (!el) { setOffsetControlHeight(0); return; }
    const measure = () => setOffsetControlHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [offsetControlMounted]);

  const layout = useMemo(() => {
    if (!filtered) return null;
    // fitZoom を求めるための第1パス（ギャップなし）
    const noGap = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight);
    const availH = Math.max(100, svgHeight - SEARCH_BOX_RESERVE);
    const fitZoom = Math.max(0.1, Math.min(10,
      Math.min(svgWidth / (MARGIN.left + noGap.contentW), availH / (MARGIN.top + noGap.contentH)) * 0.9
    ));
    // Horizontal rendering is screen-fixed; compute x layout once from the fit scale.
    const extraRecipientGapSVG = MAX_RECIPIENT_GAP_PX / fitZoom;
    const extraMinistryGapSVG  = MAX_MINISTRY_GAP_PX  / fitZoom;
    const result = computeLayout(filtered.nodes, filtered.edges, svgWidth, svgHeight, NODE_PAD, extraRecipientGapSVG, extraMinistryGapSVG);
    layoutRef.current = { contentW: result.contentW, contentH: result.contentH, nodes: result.nodes };
    return result;
  }, [filtered, svgWidth, svgHeight, SEARCH_BOX_RESERVE]);

  // Cumulative shift per node: { cumShift: slot-level offset, topShift: rect-within-slot offset, colFontPx: label font px }
  const nodeShiftInfo = useMemo(() => {
    const info = new Map<string, { cumShift: number; topShift: number; colFontPx: number }>();
    if (!layout || !showLabels) return info;
    const nodesByColumn = new Map<number, typeof layout.nodes[0][]>();
    for (const node of layout.nodes) {
      const col = getColumn(node);
      if (!nodesByColumn.has(col)) nodesByColumn.set(col, []);
      nodesByColumn.get(col)!.push(node);
    }
    // Build spending height lookup for merged project nodes
    const spendingH = new Map<string, number>();
    for (const n of layout.nodes) {
      if (n.type === 'project-spending' && n.projectId != null) {
        spendingH.set(`project-budget-${n.projectId}`, Math.max(1, n.y1 - n.y0));
      } else if (n.id === '__agg-project-spending') {
        spendingH.set('__agg-project-budget', Math.max(1, n.y1 - n.y0));
      }
    }
    const labelScale = getZoomLabelScale(zoom, baseZoom);
    const zoomedLabelFontPx = mapLabelFontPx * labelScale;
    const zoomedLabelSlotPx = mapLabelSlotPx * labelScale;
    for (const nodes of nodesByColumn.values()) {
      const sorted = [...nodes].sort((a, b) => a.y0 - b.y0);
      // Pre-compute each node's effective height for label-slot spacing.
      const heights = sorted.map(n => {
        const bH = Math.max(1, n.y1 - n.y0);
        return n.type === 'project-budget' || n.id === '__agg-project-budget'
          ? Math.max(bH, spendingH.get(n.id) ?? bH)
          : bH;
      });
      let cumShift = 0;
      for (let i = 0; i < sorted.length; i++) {
        const node = sorted[i];
        if (i > 0 && sortPriority(node) > sortPriority(sorted[i - 1])) {
          cumShift += AGGREGATE_BOUNDARY_GAP_PX / zoom;
        }
        const h = heights[i];
        const colFontPx = zoomedLabelFontPx;
        const slotExtra = h * zoom < zoomedLabelSlotPx
          ? Math.max(0, zoomedLabelSlotPx / zoom - h)
          : 0;
        const topShift = slotExtra / 2;
        info.set(node.id, { cumShift, topShift, colFontPx });
        cumShift += slotExtra;
      }
    }
    return info;
  }, [layout, showLabels, zoom, mapLabelSlotPx, mapLabelFontPx, baseZoom]);

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

  const selectedProjectBudgetNode = useMemo(() => {
    if (!selectedNode || selectedNode.aggregated) return undefined;
    if (selectedNode.type === 'project-budget') return budgetNodeByPid.get(selectedNode.projectId ?? -1);
    if (selectedNode.type === 'project-spending' && selectedNode.projectId != null) return budgetNodeByPid.get(selectedNode.projectId);
    return undefined;
  }, [selectedNode, budgetNodeByPid]);

  useEffect(() => {
    if (!graphData || !pendingYearSelectionRef.current) return;
    const snapshot = pendingYearSelectionRef.current;
    pendingYearSelectionRef.current = null;

    const nextId = canonicalSelectableNodeId(resolveYearSelectionSnapshot(snapshot, graphData));

    if (nextId !== selectedNodeId) {
      pendingHistoryAction.current = 'replace';
      setSelectedNodeId(nextId);
      if (nextId) pendingFocusId.current = nextId;
    }
  }, [graphData, selectedNodeId]);

  // The selected node in the current layout (null if not in layout)
  const selectedNodeInLayout = useMemo(
    () => (selectedNodeId !== null ? (layout?.nodes.find(n => n.id === selectedNodeId) ?? null) : null),
    [selectedNodeId, layout],
  );

  const buildConnectedNodeIds = useCallback((origin: LayoutNode): Set<string> => {
    const ids = new Set<string>();
    const layoutNodeIds = new Set(layout?.nodes.map(n => n.id) ?? []);
    const aggProjectMembers = filtered?.aggNodeMembers?.get('__agg-project-spending') ?? [];
    const aggRecipientIds = new Set((filtered?.aggNodeMembers?.get('__agg-recipient') ?? []).map(r => r.id));
    const aggMinistryNames = new Set((filtered?.aggNodeMembers?.get('__agg-ministry') ?? []).map(m => m.name));

    const aggProjectTargetsByMinistry = new Map<string, Set<string>>();
    const getAggProjectTargetsForMinistry = (ministryName: string): Set<string> => {
      const cached = aggProjectTargetsByMinistry.get(ministryName);
      if (cached) return cached;
      const memberProjectIds = new Set(aggProjectMembers.filter(m => m.ministry === ministryName).map(m => m.id));
      const targets = new Set<string>();
      for (const edge of graphData?.edges ?? []) {
        if (!memberProjectIds.has(edge.source)) continue;
        if (layoutNodeIds.has(edge.target)) targets.add(edge.target);
        else if (aggRecipientIds.has(edge.target)) targets.add('__agg-recipient');
      }
      aggProjectTargetsByMinistry.set(ministryName, targets);
      return targets;
    };

    const aggProjectSourcesByRecipient = new Map<string, Set<string>>();
    const getAggProjectSourcesForRecipient = (recipientId: string): Set<string> => {
      const cached = aggProjectSourcesByRecipient.get(recipientId);
      if (cached) return cached;
      const targetIds = recipientId === '__agg-recipient' ? aggRecipientIds : new Set([recipientId]);
      const connectedProjectIds = new Set<string>();
      for (const edge of graphData?.edges ?? []) {
        if (targetIds.has(edge.target)) connectedProjectIds.add(edge.source);
      }
      const sources = new Set<string>();
      for (const member of aggProjectMembers) {
        if (!connectedProjectIds.has(member.id) || !member.ministry) continue;
        const ministryId = `ministry-${member.ministry}`;
        if (layoutNodeIds.has(ministryId)) sources.add(ministryId);
        else if (aggMinistryNames.has(member.ministry)) sources.add('__agg-ministry');
      }
      aggProjectSourcesByRecipient.set(recipientId, sources);
      return sources;
    };

    const canFollowAggregateLink = (current: LayoutNode, next: LayoutNode, direction: 'up' | 'down'): boolean => {
      if (direction === 'down' && current.id === '__agg-project-spending' && origin.type === 'ministry' && !origin.aggregated) {
        return getAggProjectTargetsForMinistry(origin.name).has(next.id);
      }
      if (direction === 'up' && current.id === '__agg-project-budget' && origin.type === 'recipient') {
        return getAggProjectSourcesForRecipient(origin.id).has(next.id);
      }
      return true;
    };

    // BFS upstream (follow targetLinks → source recursively) — separate visited set
    const uVisited = new Set<string>();
    const uQueue = [origin];
    while (uQueue.length) {
      const n = uQueue.shift()!;
      if (uVisited.has(n.id)) continue;
      uVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.targetLinks) {
        if (!uVisited.has(l.source.id) && canFollowAggregateLink(n, l.source, 'up')) uQueue.push(l.source);
      }
    }
    // BFS downstream (follow sourceLinks → target recursively) — separate visited set
    const dVisited = new Set<string>();
    const dQueue = [origin];
    while (dQueue.length) {
      const n = dQueue.shift()!;
      if (dVisited.has(n.id)) continue;
      dVisited.add(n.id);
      ids.add(n.id);
      for (const l of n.sourceLinks) {
        if (!dVisited.has(l.target.id) && canFollowAggregateLink(n, l.target, 'down')) dQueue.push(l.target);
      }
    }
    return ids;
  }, [filtered?.aggNodeMembers, graphData?.edges, layout?.nodes]);

  const connectedNodeIds = useMemo(() => {
    if (!selectedNodeInLayout) return null;
    return buildConnectedNodeIds(selectedNodeInLayout);
  }, [buildConnectedNodeIds, selectedNodeInLayout]);

  // Connected node IDs for hovered node (upstream + downstream BFS)
  const hoveredNodeIds = useMemo(() => {
    if (!hoveredNode || selectedNode) return null;
    return buildConnectedNodeIds(hoveredNode);
  }, [buildConnectedNodeIds, hoveredNode, selectedNode]);

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

  // Recipient rank in the same pre-filtered scope as recipient-offset mode — for offset jump
  const allRecipientRanks = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const edges = filterExcludedIds
      ? graphData.edges.filter(e => !filterExcludedIds.has(e.source) && !filterExcludedIds.has(e.target))
      : graphData.edges;
    const amounts = new Map<string, number>();
    for (const e of edges) {
      if (e.target.startsWith('r-')) amounts.set(e.target, (amounts.get(e.target) || 0) + e.value);
    }
    const sorted = Array.from(amounts.entries()).sort((a, b) => b[1] - a[1]);
    return new Map(sorted.map(([id], i) => [id, i]));
  }, [graphData, filterExcludedIds]);

  // Project rank in the same scope as project-offset mode — for projectOffset jump
  const allProjectRanks = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const nodes = filterExcludedIds
      ? graphData.nodes.filter(n => !filterExcludedIds.has(n.id))
      : graphData.nodes;
    const budgetValues = new Map<string, number>(
      nodes
        .filter(n => n.type === 'project-budget' && n.projectId != null)
        .map(n => [`project-spending-${n.projectId}`, n.value] as const)
    );
    const recipientFocusMode = focusRelated && pinnedRecipientId != null;
    const ministryFocusMode = focusRelated && pinnedMinistryName != null && !recipientFocusMode;
    const { topMinistryNodes } = getTopMinistriesInScope(nodes, topMinistry, ministryFocusMode, pinnedMinistryName);
    const topMinistryNames = new Set(topMinistryNodes.map(n => n.name));
    const ranked = nodes
      .filter(n => n.type === 'project-spending' && topMinistryNames.has(n.ministry || ''))
      .sort((a, b) => {
        if (projectSortBy === 'budget') {
          const ba = budgetValues.get(a.id) ?? 0;
          const bb = budgetValues.get(b.id) ?? 0;
          if (bb !== ba) return bb - ba;
        }
        return b.value - a.value;
      });
    return new Map(ranked.map((n, i) => [n.id, i]));
  }, [graphData, filterExcludedIds, topMinistry, projectSortBy, focusRelated, pinnedRecipientId, pinnedMinistryName]);

  // 事業ピン付きディープリンク（po= 未指定）の projectOffset 中央寄せ。
  // ピン事業は TopN 圏外でも表示されるが、関連ノードのみを解除した瞬間に
  // 先頭50事業へ飛んでしまうため、順位が判明した時点で一度だけウィンドウを合わせる。
  // 計算は事業クリック時の jumpToProjectRank と同一。
  useEffect(() => {
    const pinId = pendingProjectOffsetPinId.current;
    if (!pinId || allProjectRanks.size === 0) return;
    pendingProjectOffsetPinId.current = null;
    const rank = allProjectRanks.get(pinId);
    if (rank === undefined) return;
    const maxOffset = Math.max(0, allProjectRanks.size - topProject);
    const newOffset = Math.max(0, Math.min(rank - Math.floor(topProject / 2), maxOffset));
    if (newOffset > 0) {
      pendingHistoryAction.current = 'replace';
      setProjectOffset(newOffset);
    }
  }, [allProjectRanks, topProject]);

  // Recipient count per project-spending node (from raw graphData)
  const projectRecipientCount = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const countMap = new Map<string, number>();
    for (const e of graphData.edges) {
      if (e.target.startsWith('r-')) countMap.set(e.source, (countMap.get(e.source) || 0) + 1);
    }
    return countMap;
  }, [graphData]);

  // Panel sections — 3-tab data (省庁 / 事業 / 支出先)
  type PanelEntry = { id: string; name: string; value: number; ministry?: string; projectId?: number; accountCategory?: string; aggregated?: boolean; budgetValue?: number; spendingValue?: number; recipientFlowValue?: number; recipientCount?: number; projectCount?: number; };
  type PanelSections = { ministries: PanelEntry[]; projects: PanelEntry[]; recipients: PanelEntry[]; };
  const panelSections = useMemo((): PanelSections | null => {
    if (!selectedNode || !graphData) return null;
    const nodeById = new Map(graphData.nodes.map(n => [n.id, n]));
    const spendingByPid = new Map(
      graphData.nodes
        .filter((n): n is typeof n & { projectId: number } => n.type === 'project-spending' && n.projectId != null)
        .map(n => [n.projectId, n] as const)
    );
    const toProjectEntry = (budgetNode: { id: string; name: string; value: number; projectId?: number; ministry?: string; accountCategory?: string }): PanelEntry => {
      const sn = budgetNode.projectId != null ? spendingByPid.get(budgetNode.projectId) : undefined;
      const spId = sn?.id ?? (budgetNode.projectId != null ? `project-spending-${budgetNode.projectId}` : budgetNode.id);
      return { id: budgetNode.id, name: budgetNode.name, value: sn?.value ?? 0, ministry: budgetNode.ministry, projectId: budgetNode.projectId, accountCategory: budgetNode.accountCategory, budgetValue: budgetNode.value, spendingValue: sn?.value ?? 0, recipientCount: projectRecipientCount.get(spId) };
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
      const projectEntryId = budgetNode?.id ?? canonicalSelectableNodeId(nid) ?? nid;
      const projects: PanelEntry[] = [{ id: projectEntryId, name: budgetNode?.name ?? selectedNode.name, value: sValue, ministry: ministryName, projectId: selectedNode.projectId, accountCategory: budgetNode?.accountCategory ?? selectedNode.accountCategory, budgetValue: bValue, spendingValue: sValue, recipientCount: projectRecipientCount.get(spId) }];
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
      const projects: PanelEntry[] = aggBudgetMembers.map((m): PanelEntry => { const bn = nodeById.get(m.id); return bn ? toProjectEntry(bn) : { id: m.id, name: m.name, value: m.value, ministry: m.ministry }; }).sort((a, b) => { const bv = (b.budgetValue ?? 0) - (a.budgetValue ?? 0); return bv !== 0 ? bv : (b.spendingValue ?? b.value) - (a.spendingValue ?? a.value); });
      const rMap = new Map<string, { name: string; value: number }>();
      for (const sm of aggSpendingMembers) { for (const e of graphData.edges) { if (e.source === sm.id && e.target.startsWith('r-')) { const prev = rMap.get(e.target); if (prev) prev.value += e.value; else rMap.set(e.target, { name: nodeById.get(e.target)?.name ?? e.target, value: e.value }); } } }
      const recipients: PanelEntry[] = Array.from(rMap.entries()).sort((a, b) => b[1].value - a[1].value).map(([id, { name, value }]) => ({ id, name, value }));
      return { ministries, projects, recipients };
    }

    // ── recipient (non-aggregated) ──────────────────────────────────────
    if (ntype === 'recipient' && !selectedNode.aggregated) {
      const pMap = new Map<string, number>();
      for (const e of graphData.edges) { if (e.target === nid) pMap.set(e.source, (pMap.get(e.source) || 0) + e.value); }
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => {
        const n = nodeById.get(id);
        const bn = n?.projectId != null ? nodeById.get(`project-budget-${n.projectId}`) : null;
        const budgetId = bn?.id ?? canonicalSelectableNodeId(id) ?? id;
        return { id: budgetId, name: bn?.name ?? n?.name ?? id, value, ministry: bn?.ministry ?? n?.ministry, projectId: bn?.projectId ?? n?.projectId, accountCategory: bn?.accountCategory ?? n?.accountCategory, budgetValue: bn?.value, spendingValue: n?.value, recipientFlowValue: value };
      }).sort((a, b) => b.value - a.value);
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
      const projects: PanelEntry[] = Array.from(pMap.entries()).map(([id, value]) => {
        const n = nodeById.get(id);
        const bn = n?.projectId != null ? nodeById.get(`project-budget-${n.projectId}`) : null;
        const budgetId = bn?.id ?? canonicalSelectableNodeId(id) ?? id;
        return { id: budgetId, name: bn?.name ?? n?.name ?? id, value, ministry: bn?.ministry ?? n?.ministry, projectId: bn?.projectId ?? n?.projectId, accountCategory: bn?.accountCategory ?? n?.accountCategory, budgetValue: bn?.value, spendingValue: n?.value, recipientFlowValue: value };
      }).sort((a, b) => b.value - a.value);
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
  const [isBudgetExecutionExpanded, setIsBudgetExecutionExpanded] = useState(false);
  const [projectOverviewPreviewHeight, setProjectOverviewPreviewHeight] = useState(PROJECT_OVERVIEW_PREVIEW_HEIGHT_DEFAULT);
  const [budgetExecutionListHeight, setBudgetExecutionListHeight] = useState(BUDGET_EXECUTION_LIST_HEIGHT_DEFAULT);
  const overviewResizeRef = useRef<{ startY: number; startH: number } | null>(null);
  const budgetExecutionResizeRef = useRef<{ startY: number; startH: number } | null>(null);
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
    const canonicalId = canonicalSelectableNodeId(id);
    pendingHistoryAction.current = forceReplace ? 'replace' : 'push';
    setSelectedNodeId(canonicalId);
    setIsProjectDetailExpanded(false);
    if (canonicalId === null) { setPinnedProjectId(null); setPinnedRecipientId(null); setPinnedMinistryName(null); setFocusRelated(false); }
  }, [setPinnedRecipientId, setPinnedMinistryName, setIsProjectDetailExpanded]);

  // Auto-clear stale selection when node no longer exists in graphData at all
  // Guard: skip while graphData is loading to avoid clearing URL-restored selection
  useEffect(() => {
    if (!graphData) return;
    if (selectedNodeId !== null && !selectedNode) {
      selectNode(null, true); // forceReplace: don't push to history for automatic cleanup
    }
  }, [selectedNode, selectedNodeId, selectNode, graphData]);

  // 事業ノード選択時の遅延取得キャッシュ（useProjectPidCache で共通化）
  // Pre-fetch project detail on node selection (for collapsed preview)
  const projectDetailCache = useProjectPidCache<ProjectDetail>(
    selectedNode, year,
    (pid, y) => `/api/project-details/${pid}?year=${y}`,
    data => data as ProjectDetail,
  );
  // Fetch subcontract summary on project node selection (side panel 再委託 block)
  const subcontractSummaryCache = useProjectPidCache<SubcontractSummary>(
    selectedNode, year,
    (pid, y) => `/api/subcontracts/${pid}?year=${y}`,
    (data) => {
      const g = data as {
        maxDepth?: number; totalBlockCount?: number; totalRecipientCount?: number;
        directBlockCount?: number; separateOriginCount?: number;
      };
      if (g?.totalBlockCount == null) return null;
      const totalBlockCount = g.totalBlockCount;
      const directBlockCount = g.directBlockCount ?? 0;
      const separateOriginCount = g.separateOriginCount ?? 0;
      return {
        maxDepth: g.maxDepth ?? 0,
        totalBlockCount,
        totalRecipientCount: g.totalRecipientCount ?? 0,
        directBlockCount,
        separateOriginCount,
        subcontractBlockCount: Math.max(0, totalBlockCount - directBlockCount - separateOriginCount),
      };
    },
  );

  // 品質スコアブロックのクリックで全項目を取得し /quality と同じ詳細ダイアログを開く
  const openScoreDialog = useCallback((pid: string | number) => {
    setScoreDialogLoading(true);
    fetch(`/api/quality-scores/${pid}?year=${year}&full=1`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((data: { score?: QualityScoreItem }) => {
        if (data.score) setScoreDialogItem(data.score);
      })
      .catch(() => { /* スコアなし等は何もしない */ })
      .finally(() => setScoreDialogLoading(false));
  }, [year]);

  const nodeByLayoutId = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const node of layout?.nodes ?? []) m.set(node.id, node);
    return m;
  }, [layout]);

  const getRenderedYBounds = useCallback((node: LayoutNode): { top: number; bottom: number } => {
    let renderNode = node;
    let effectiveHeight = Math.max(1, node.y1 - node.y0);
    if (node.type === 'project-spending') {
      const budgetId = node.id === '__agg-project-spending'
        ? '__agg-project-budget'
        : node.projectId != null ? `project-budget-${node.projectId}` : null;
      const budgetNode = budgetId ? nodeByLayoutId.get(budgetId) : null;
      if (budgetNode) {
        renderNode = budgetNode;
        effectiveHeight = Math.max(effectiveHeight, Math.max(1, budgetNode.y1 - budgetNode.y0));
      }
    } else if (node.type === 'project-budget' || node.id === '__agg-project-budget') {
      const spendingId = node.id === '__agg-project-budget'
        ? '__agg-project-spending'
        : node.projectId != null ? `project-spending-${node.projectId}` : null;
      const spendingNode = spendingId ? nodeByLayoutId.get(spendingId) : null;
      if (spendingNode) effectiveHeight = Math.max(effectiveHeight, Math.max(1, spendingNode.y1 - spendingNode.y0));
    }
    const { cumShift = 0, topShift = 0 } = nodeShiftInfo.get(renderNode.id) ?? {};
    const top = renderNode.y0 + cumShift + topShift;
    return { top, bottom: top + effectiveHeight };
  }, [nodeByLayoutId, nodeShiftInfo]);

  // Imperatively focus a layout node (direct call + pending effect)
  const focusOnNode = useCallback((node: LayoutNode) => {
    const container = containerRef.current;
    if (!container) return;
    const cH = container.clientHeight;
    const bounds = getRenderedYBounds(node);
    const cy = MARGIN.top + (bounds.top + bounds.bottom) / 2;
    const h = bounds.bottom - bounds.top;
    const minZoomForLabel = 10 / (h + NODE_PAD);
    const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
    const targetK = Math.max(zoom, Math.min(maxZoom, minZoomForLabel * 1.2));
    setZoom(targetK);
    setPan(prev => ({ x: prev.x, y: cH / 2 - cy * targetK }));
  }, [zoom, baseZoom, getRenderedYBounds]);

  const focusOnNeighborhood = useCallback((nodeOverride?: LayoutNode) => {
    const node = nodeOverride ?? selectedNode;
    if (!node || (!nodeOverride && !selectedNodeInLayout) || !layout || !containerRef.current) return;
    const container = containerRef.current;
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
    const neighborBounds = neighborNodes.map(getRenderedYBounds);
    const minY = Math.min(...neighborBounds.map(b => b.top));
    const maxY = Math.max(...neighborBounds.map(b => b.bottom));
    const PADDING = 40;
    const boxH = (maxY - minY) + PADDING * 2;
    const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
    const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
    const targetK = Math.max(minZoom, Math.min(maxZoom, (cH / boxH) * 0.9));
    const centerY = MARGIN.top + (minY + maxY) / 2;
    setZoom(targetK);
    setPan(prev => ({ x: prev.x, y: cH / 2 - centerY * targetK }));
  }, [selectedNode, selectedNodeInLayout, layout, baseZoom, getRenderedYBounds]);

  const handleConnectionClick = useCallback((nodeId: string) => {
    const selectionNodeId = canonicalSelectableNodeId(nodeId);
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
      if (needsDeferredFocus) pendingFocusId.current = selectionNodeId;
      selectNode(selectionNodeId);
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
        pendingFocusId.current = canonicalSelectableNodeId(parentSpendingId);
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
      if (rank !== undefined) {
        jumpToProjectRank(rank);
        setPinnedProjectId(null);
      } else {
        setPinnedProjectId(spendingId);
      }
    } else {
      setPinnedProjectId(null);
    }
    // Out-of-layout node: focus via effect once it appears in layout after pin/offset jump
    pendingFocusId.current = selectionNodeId;
    selectNode(selectionNodeId);
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

  const activateNode = useCallback((node: LayoutNode) => {
    // 省庁ノード × filterOnMinistryClick 連動: 未設定時だけ単独フィルタを設定する。
    // 解除はフィルタ解除ボタンに一本化し、再クリックはサイドパネル表示を優先する。
    if (filterOnMinistryClick && node.type === 'ministry' && !node.aggregated) {
      const isSingleFilterMatch = filterMinistryNames.length === 1 && filterMinistryNames[0] === node.name;
      if (!isSingleFilterMatch) {
        setFilterMinistryNames([node.name]);
      }
    }
    const newId = selectedNodeId === node.id && node.type !== 'ministry' ? null : node.id;
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
  }, [selectedNodeId, selectNode, focusRelated, autoFocusRelated, exitFocusRelated, graphData, filterOnMinistryClick, filterMinistryNames]);

  const handleNodeClick = useCallback((node: LayoutNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (touchActivatedNodeIdRef.current === node.id) {
      touchActivatedNodeIdRef.current = null;
      return;
    }
    if (didPanRef.current) return;
    activateNode(node);
  }, [activateNode]);

  const handleNodeTouchPointerUp = useCallback((node: LayoutNode, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    e.stopPropagation();
    const shouldActivate = !didPanRef.current && !didPinchRef.current;
    handleTouchPointerEnd(e);
    if (!shouldActivate) return;
    touchActivatedNodeIdRef.current = node.id;
    window.setTimeout(() => {
      if (touchActivatedNodeIdRef.current === node.id) touchActivatedNodeIdRef.current = null;
    }, 500);
    activateNode(node);
  }, [activateNode, handleTouchPointerEnd]);

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilterProjectName(filterProjectName), 150);
    return () => clearTimeout(timer);
  }, [filterProjectName]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilterRecipientName(filterRecipientName), 150);
    return () => clearTimeout(timer);
  }, [filterRecipientName]);

  // 年度切替・URL直接指定で filterSubcontract が現在データの最大階層を超えた場合、
  // 表示（cur のクランプ）と実フィルタ（buildFilterExcludedIds は生値を受け取る）の
  // 乖離を防ぐため state 側をクランプして永続化する。クランプ後は条件が false になり再発火しない。
  // graphData 確定前は maxSubcontractDepth がデフォルト値（5）のため、ロード前にクランプしない
  useEffect(() => {
    if (!graphData) return;
    if (filterSubcontract && parseInt(filterSubcontract, 10) > maxSubcontractDepth) {
      pendingHistoryAction.current = 'replace';
      setFilterSubcontract(String(maxSubcontractDepth));
    }
  }, [graphData, maxSubcontractDepth, filterSubcontract]);


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
    // 省庁フィルタが設定されている場合、検索対象を選択省庁の事業・支出先に絞る
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
          const budgetNode = budgetNodeByPid.get(n.projectId);
          const bv = budgetNode?.value ?? 0;
          results.push({ id: budgetNode?.id ?? `project-budget-${n.projectId}`, name: budgetNode?.name ?? n.name, type: n.type, value: n.value, sortValue: Math.max(bv, n.value), projectId: n.projectId, budgetValue: bv });
        }
      } else {
        if (matcher(n.name)) {
          if (n.type === 'project-spending' && n.projectId != null) {
            const budgetNode = budgetNodeByPid.get(n.projectId);
            const bv = budgetNode?.value ?? 0;
            results.push({ id: budgetNode?.id ?? `project-budget-${n.projectId}`, name: budgetNode?.name ?? n.name, type: n.type, value: n.value, sortValue: Math.max(bv, n.value), projectId: n.projectId, budgetValue: bv });
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

  // フィルタが何か掛かっているか（会計区分は全選択が「掛かっていない」状態）
  const hasActiveFilters =
    filterMinistryNames.length > 0 ||
    filterProjectName !== '' ||
    filterRecipientName !== '' ||
    filterMinBudgetText !== '' || filterMaxBudgetText !== '' ||
    filterMinSpendingText !== '' || filterMaxSpendingText !== '' ||
    scoreRangeToParam(filterScoreO) !== null ||
    scoreRangeToParam(filterScoreX) !== null ||
    scoreRangeToParam(filterScoreN) !== null ||
    !(acGeneral && acSpecial && acBoth && acNone) ||
    filterSubcontract !== '';

  const clearAllFilters = useCallback(() => {
    pendingHistoryAction.current = 'push';
    setFilterMinistryNames([]);
    setFilterProjectName('');
    setFilterProjectNameRegex(false);
    setDebouncedFilterProjectName('');
    setFilterRecipientName('');
    setFilterRecipientNameRegex(false);
    setDebouncedFilterRecipientName('');
    setFilterMinBudgetText('');
    setFilterMaxBudgetText('');
    setFilterMinSpendingText('');
    setFilterMaxSpendingText('');
    setFilterScoreO(EMPTY_SCORE_RANGE);
    setFilterScoreX(EMPTY_SCORE_RANGE);
    setFilterScoreN(EMPTY_SCORE_RANGE);
    setAcGeneral(true);
    setAcSpecial(true);
    setAcBoth(true);
    setAcNone(true);
    setFilterSubcontract('');
    setFilterRecipientIncludeSub(false);
  }, []);

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
          const reserve = searchBoxReserveRef.current;
          const availH = container.clientHeight - reserve;
          const { k: fitK } = fitZoomWithShifts(l.nodes, l.contentW, l.contentH, cW, availH);
          const restoredTotalH = MARGIN.top + l.contentH + calcShiftExtraH(l.nodes, k, fitK);
          setBaseZoom(fitK);
          setZoom(k);
          setPan({ x: 0, y: reserve + Math.min((availH - restoredTotalH * k) / 2, fitTopPadPxRef.current) });
        } else {
          setZoom(k); setBaseZoom(k); setPan({ x: 0, y: searchBoxReserveRef.current });
        }
      } else {
        resetView();
      }
    }
  }, [calcShiftExtraH, layout, resetView, fitZoomWithShifts]);

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

  const horizontalScale = useMemo(() => {
    if (!layout) return 1;
    return Math.max(0.2, Math.min(10, (svgWidth / (MARGIN.left + layout.contentW + SCREEN_LEFT_PADDING_PX)) * SCREEN_HORIZONTAL_FIT_RATIO));
  }, [layout, svgWidth]);
  const totalLabelGapPx = useMemo(() => {
    if (!layout) return 0;
    return Math.max(0, SCREEN_MIN_TOTAL_LABEL_GAP_PX - layout.colSpacing * horizontalScale);
  }, [horizontalScale, layout]);
  const ministryLabelGapPx = useMemo(() => {
    if (!layout) return 0;
    const leftLabelChars = layout.nodes
      .filter(n => n.type === 'project-budget')
      .reduce((m, n) => {
        const main = formatYen(n.value);
        const raw = n.isScaled && n.rawValue != null ? ` / ${formatYen(n.rawValue)}` : '';
        return Math.max(m, (main + raw).length);
      }, 0);
    const labelScale = getZoomLabelScale(zoom, baseZoom);
    const leftLabelReservePx = leftLabelChars > 0
      ? 6 + leftLabelChars * mapLabelFontPx * labelScale * 0.7
      : 0;
    const ministryLabelWidthPx = layout.colSpacing * horizontalScale - NODE_W - leftLabelReservePx;
    return Math.min(
      SCREEN_MAX_MINISTRY_LABEL_GAP_PX,
      Math.max(0, SCREEN_MIN_MINISTRY_LABEL_WIDTH_PX - ministryLabelWidthPx)
    );
  }, [baseZoom, horizontalScale, layout, mapLabelFontPx, zoom]);
  const screenNodeW = NODE_W;
  const screenToInnerX = useCallback((screenX: number) => screenX / zoom - MARGIN.left, [zoom]);
  const screenWToInner = useCallback((screenW: number) => screenW / zoom, [zoom]);
  const getNodeScreenX0 = useCallback((node: LayoutNode): number => {
    const left = MARGIN.left + SCREEN_LEFT_PADDING_PX;
    if (node.type === 'project-spending') {
      const budgetId = node.id === '__agg-project-spending'
        ? '__agg-project-budget'
        : node.projectId != null ? `project-budget-${node.projectId}` : null;
      const budgetNode = budgetId ? nodeByLayoutId.get(budgetId) : null;
      if (budgetNode) return left + budgetNode.x0 * horizontalScale + totalLabelGapPx + ministryLabelGapPx + screenNodeW;
    }
    const totalLabelOffset = node.type === 'total' ? 0 : totalLabelGapPx;
    const ministryLabelOffset = node.type === 'total' || node.type === 'ministry' ? 0 : ministryLabelGapPx;
    return left + node.x0 * horizontalScale + totalLabelOffset + ministryLabelOffset;
  }, [horizontalScale, ministryLabelGapPx, nodeByLayoutId, screenNodeW, totalLabelGapPx]);
  const getNodeScreenX1 = useCallback((node: LayoutNode): number => getNodeScreenX0(node) + screenNodeW, [getNodeScreenX0, screenNodeW]);
  const getNodeInnerX0 = useCallback((node: LayoutNode): number => screenToInnerX(getNodeScreenX0(node)), [getNodeScreenX0, screenToInnerX]);
  const getNodeInnerX1 = useCallback((node: LayoutNode): number => screenToInnerX(getNodeScreenX1(node)), [getNodeScreenX1, screenToInnerX]);
  const innerNodeW = screenWToInner(screenNodeW);
  const innerLabelGap = screenWToInner(3);
  const innerLabelHitH = screenWToInner(14);
  const getRightLabelHitW = (col: number, isLastCol: boolean) => screenWToInner(
    isLastCol ? 220 : col === 0 ? 112 : col === 1 ? 140 : 160
  );
  const renderLabelHitRect = (
    node: LayoutNode,
    x: number,
    centerY: number,
    width: number,
    anchor: 'start' | 'end' = 'start',
    clipPath?: string
  ) => {
    const hitX = anchor === 'end' ? x - width : x;
    return (
      <rect
        x={hitX}
        y={centerY - innerLabelHitH / 2}
        width={width}
        height={innerLabelHitH}
        clipPath={clipPath}
        fill="transparent"
        style={{ cursor: 'pointer', pointerEvents: 'all' }}
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
        onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
        onClick={(e) => handleNodeClick(node, e)}
      />
    );
  };
  const getMinimapRenderedYBounds = useCallback((node: LayoutNode): { top: number; bottom: number } => {
    let shiftNode = node;
    if (node.type === 'project-spending') {
      const budgetId = node.id === '__agg-project-spending'
        ? '__agg-project-budget'
        : node.projectId != null ? `project-budget-${node.projectId}` : null;
      const budgetNode = budgetId ? nodeByLayoutId.get(budgetId) : null;
      if (budgetNode) shiftNode = budgetNode;
    }
    const { cumShift = 0, topShift = 0 } = nodeShiftInfo.get(shiftNode.id) ?? {};
    const top = shiftNode.y0 + cumShift + topShift;
    return { top, bottom: top + Math.max(1, node.y1 - node.y0) };
  }, [nodeByLayoutId, nodeShiftInfo]);
  const minimapWorldH = useMemo(() => {
    if (!layout || layout.nodes.length === 0) return svgHeight;
    const renderedBottom = Math.max(...layout.nodes.map(node => getRenderedYBounds(node).bottom));
    return Math.max(svgHeight, MARGIN.top + renderedBottom + MARGIN.bottom);
  }, [layout, svgHeight, getRenderedYBounds]);

  // Draw minimap
  useEffect(() => {
    if (!minimapVisible || !layout) return;
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The "world" that the minimap represents = the rendered SVG content area.
    // Nodes are at (MARGIN.left + x0, MARGIN.top + shiftedY0) in SVG coords.
    // The SVG transform: translate(pan.x, pan.y) scale(zoom) then translate(MARGIN, MARGIN)
    // So a node at inner (x0,shiftedY0) appears at screen (pan.x + (MARGIN.left+x0)*zoom, pan.y + (MARGIN.top+shiftedY0)*zoom)
    const worldW = svgWidth;
    const worldH = minimapWorldH;
    const scaleX = MINIMAP_W / worldW;
    const scaleY = minimapH / worldH;

    ctx.clearRect(0, 0, MINIMAP_W, minimapH);
    ctx.fillStyle = 'rgba(245,245,245,0.95)';
    ctx.fillRect(0, 0, MINIMAP_W, minimapH);

    // Draw nodes (at their SVG-coord positions including MARGIN)
    for (const node of layout.nodes) {
      const bounds = getMinimapRenderedYBounds(node);
      const x = getNodeScreenX0(node) * scaleX;
      const y = (MARGIN.top + bounds.top) * scaleY;
      const w = Math.max(1, screenNodeW * scaleX);
      const h = Math.max(0.5, (bounds.bottom - bounds.top) * scaleY);
      ctx.fillStyle = getNodeColor(node);
      ctx.fillRect(x, y, w, h);
    }

    // Viewport: x is screen-fixed, y remains zoomed SVG world.
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const vpLeft = -pan.x;
    const vpTop = -pan.y / zoom;
    const vpW = cW;
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
  }, [minimapVisible, layout, zoom, pan, svgWidth, minimapWorldH, minimapH, getNodeScreenX0, getMinimapRenderedYBounds, screenNodeW]);

  const minimapNavigate = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Minimap coord to SVG world coord
    const scaleX = MINIMAP_W / svgWidth;
    const scaleY = minimapH / minimapWorldH;
    const svgX = mx / scaleX;
    const svgY = my / scaleY;
    // Center horizontally in screen space and vertically in zoomed SVG world.
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    setPan({ x: cW / 2 - svgX, y: cH / 2 - svgY * zoom });
  }, [svgWidth, minimapWorldH, minimapH, zoom]);

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
    const minZoom = Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER);
    const maxZoom = Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER);
    const nz = Math.max(minZoom, Math.min(maxZoom, zoom * factor));
    setPan({ x: pan.x, y: getZoomAnchoredPanY(svgHeight / 2, nz) });
    setZoom(nz);
    scheduleZoomUrlWrite();
  }, [zoom, pan.x, svgHeight, baseZoom, getZoomAnchoredPanY, scheduleZoomUrlWrite]);

  // Edge path with per-node cumulative shift applied to y coordinates
  const shiftedRibbonPath = (link: Parameters<typeof ribbonPath>[0]): string => {
    // project-spending nodes are rendered inside their paired budget node's <g>,
    // so their edges must use the budget node's shift values.
    const srcId = link.source.type === 'project-spending'
      ? (link.source.id === '__agg-project-spending' ? '__agg-project-budget' : `project-budget-${link.source.projectId}`)
      : link.source.id;
    const src = nodeShiftInfo.get(srcId) ?? { cumShift: 0, topShift: 0 };
    const tgt = nodeShiftInfo.get(link.target.id) ?? { cumShift: 0, topShift: 0 };
    const srcShift = src.cumShift + src.topShift;
    const tgtShift = tgt.cumShift + tgt.topShift;
    const sx = getNodeInnerX1(link.source), tx = getNodeInnerX0(link.target);
    const sTop = link.y0 + srcShift, sBot = sTop + link.sourceWidth;
    const tTop = link.y1 + tgtShift, tBot = tTop + link.targetWidth;
    const mx = (sx + tx) / 2;
    return `M${sx},${sTop}C${mx},${sTop} ${mx},${tTop} ${tx},${tTop}`
      + `L${tx},${tBot}C${mx},${tBot} ${mx},${sBot} ${sx},${sBot}Z`;
  };

  // 左サイドパネルの実効幅（ビューポートクランプ込み）は leftSidePanel（useSidePanel）が算出済み。
  // AIチャットパネル（右）も同じクランプ規則を使うため、境界値だけここでも算出する。
  const maxPanelWidthForViewport = Math.max(0, svgWidth - SIDE_PANEL_VIEWPORT_RESERVE_PX);
  const minPanelWidthForViewport = Math.min(SIDE_PANEL_WIDTH_MIN, maxPanelWidthForViewport);
  const searchLeftOffset = selectedNodeId !== null && !isPanelCollapsed ? effectiveSidePanelWidth : 0;
  // AIチャットパネル（右側）の実効幅: 左パネルと同じ規則でビューポート幅に収める。
  // コンパクト幅では全幅オーバーレイになるため右端コントロールの退避は行わない。
  const effectiveAiPanelWidth = Math.min(
    maxPanelWidthForViewport,
    Math.max(minPanelWidthForViewport, aiPanelWidth),
  );
  const rightControlsOffset = showAiChat && !isCompactWidth ? effectiveAiPanelWidth : 0;
  // 右上の設定(⋮)ボタン領域(幅32+余白)に重ならないよう右側を確保。
  // これがないと文字拡大時に検索ボックスが設定ボタンを覆い、タップで開けなくなる。
  const searchMaxWidth = `calc(100vw - ${searchLeftOffset}px - 64px)`;
  const minimapLeft = selectedNodeId !== null ? (isPanelCollapsed ? 26 : effectiveSidePanelWidth + 8) : 8;
  const fontControlLeft = minimapLeft + (showMinimap ? MINIMAP_W + 22 : 48);
  // 年度変更（トップ中央セレクトとスマホ幅の設定ダイアログで共用）
  const handleYearChange = (value: '2024' | '2025') => {
    pendingHistoryAction.current = 'replace';
    pendingYearSelectionRef.current = selectedNode
      ? { type: selectedNode.type, name: selectedNode.name, projectId: selectedNode.projectId }
      : null;
    setYear(value);
  };

  // 事業・支出先 TopN スライダー（デスクトップはオフセットパネル内、スマホ幅では設定ダイアログ内に表示）
  const topNSlidersFragment = (
    <TopNSliders
      topProject={topProject}
      topRecipient={topRecipient}
      setTopProject={setTopProject}
      setTopRecipient={setTopRecipient}
      markReplace={markHistoryReplace}
      metaFontPx={META_FONT_PX}
    />
  );

  // 基準フォントサイズ調整（デスクトップは左下フローティング、スマホ幅では設定ダイアログ内に表示）
  const fontSizeControlsFragment = (
    <FontSizeControls
      baseFontPx={baseFontPx}
      setBaseFontPx={setBaseFontPx}
      markReplace={markHistoryReplace}
      isCompactWidth={isCompactWidth}
      min={BASE_FONT_PX_MIN}
      max={BASE_FONT_PX_MAX}
      defaultValue={BASE_FONT_PX_DEFAULT}
      controlSmallFontPx={CONTROL_SMALL_FONT_PX}
      numberFontPx={META_FONT_PX_DEFAULT}
    />
  );

  /**
   * TopN・オフセットの操作パネル。狭幅では画面下部、通常は右上クラスタの左端に置く。
   * 右上は［ツール - 表示設定 - 年度 - メニュー］の並びで rs-vis と揃える。
   */
  const offsetControlsBlock = filtered ? (() => {
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
          <div ref={offsetControlRef} style={ isCompactWidth
            ? { position: 'absolute', bottom: 12, left: isLandscapeCompact && selectedNodeId !== null && !isPanelCollapsed ? effectiveSidePanelWidth + 8 : 8, zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: 'calc(100vw - 16px)', transition: isResizingSidePanel ? 'none' : 'left 0.2s ease' }
            // 通常幅では右上クラスタの子として並べる（位置はクラスタ側が持つ）
            : { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, rowGap: 4, background: 'rgba(255,255,255,0.92)', padding: '5px 10px', borderRadius: isCompactWidth ? 6 : '6px 6px 0 6px', border: '1px solid #e0e0e0', fontSize: CONTROL_SMALL_FONT_PX }}>
            {/* Row 1: オフセットスライダー（2列スパン） */}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* オフセット対象コンボボックス */}
              <select
                data-testid={testId('offset-target-select')}
                value={offsetTarget}
                onChange={e => { pendingHistoryAction.current = 'replace'; setOffsetTarget(e.target.value as 'recipient' | 'project'); }}
                style={{ fontSize: META_FONT_PX, border: '1px solid #ccc', borderRadius: 3, padding: '1px 2px', background: '#fff', color: '#555', cursor: 'pointer' }}
              >
                <option value="project">事業</option>
                <option value="recipient">支出先</option>
              </select>
              <label style={{ flex: isCompactWidth ? '0 0 auto' : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* スマホ幅では「Top」ラベルを省き数値だけ表示 */}
                {!isCompactWidth && <span style={{ color: '#555', fontSize: META_FONT_PX }}>Top</span>}
                {isEditingOffset ? (
                  <input
                    type="number"
                    autoFocus
                    min={1} max={activeMaxStartRank} step={1}
                    value={offsetInputValue}
                    onChange={e => { setOffsetInputValue(e.target.value); const v = Number(e.target.value); if (!isNaN(v) && v >= 1) setActiveOffset(Math.max(0, Math.min(activeMax, v - 1))); }}
                    onBlur={() => setIsEditingOffset(false)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setIsEditingOffset(false); }}
                    style={{ width: `${Math.max(40, String(activeMaxStartRank).length * 8 + 20)}px`, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: CONTROL_SMALL_FONT_PX }}
                  />
                ) : (
                  <button
                    onClick={() => { setOffsetInputValue(String(activeRangeStart)); setIsEditingOffset(true); }}
                    title="クリックして開始位置を入力"
                    style={{ color: '#999', fontSize: META_FONT_PX, background: 'transparent', border: 'none', cursor: 'text', padding: 0 }}
                  >{activeRangeStart}</button>
                )}
                <span style={{ color: '#999', fontSize: META_FONT_PX }}>〜{activeRangeEnd}</span>
                <input type="range" min={0} max={activeMax} value={activeOffset} onChange={e => { pendingFocusId.current = null; setActiveOffset(Number(e.target.value)); }} style={{ width: 60 }} />
                {/* 総件数表示は幅を取るためスマホ幅では非表示 */}
                {!isCompactWidth && <span style={{ color: '#999', fontSize: META_FONT_PX }}>/{activeTotalCount}件</span>}
                <div style={{ display: 'flex', flexDirection: 'row', gap: 2, alignItems: 'center' }}>
                  {([
                    [-1, 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z', '前へ'],
                    [1,  'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z', '次へ'],
                  ] as [number, string, string][]).map(([delta, path, title]) => (
                    <button key={delta} title={title} aria-label={title}
                      data-testid={testId(delta > 0 ? 'recipient-offset-next' : 'recipient-offset-prev')}
                      {...offsetRepeat(() => {
                        pendingHistoryAction.current = 'replace';
                        pendingFocusId.current = null;
                        if (isProjectMode) setProjectOffset(prev => Math.max(0, Math.min(activeMax, prev + delta)));
                        else setRecipientOffset(prev => Math.max(0, Math.min(activeMax, prev + delta)));
                      }, { stopPropagation: true })}
                      onClick={(e) => {
                        if (e.detail === 0) {
                          setActiveOffset(Math.max(0, Math.min(activeMax, activeOffset + delta)));
                        }
                      }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" height={scaleSize(14)} width={scaleSize(14)} viewBox="0 0 24 24" fill="#555"><path d={path}/></svg>
                    </button>
                  ))}
                </div>
                {/* Material Icons: vertical_align_top — オフセットリセット */}
                <button onClick={e => { e.preventDefault(); setActiveOffset(0); }} title="先頭へリセット" aria-label="先頭へリセット"
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height={scaleSize(14)} width={scaleSize(14)} viewBox="0 0 24 24" fill="#555" style={{ transform: 'rotate(-90deg)' }}><path d="M8 11h3v10h2V11h3l-4-4-4 4zM4 3v2h16V3H4z"/></svg>
                </button>
              </label>
            </div>
            {/* Row 2: 事業・支出先 TopN スライダー（スマホ幅では設定ダイアログへ移動） */}
            {!isCompactWidth && showTopNSliders && topNSlidersFragment}
          </div>
          {/* トグルボタン（パネル外・下部）— スマホ幅では設定ダイアログにTopNを移すため非表示 */}
          {!isCompactWidth && (
          <button
            onClick={() => setShowTopNSliders(s => !s)}
            title={showTopNSliders ? 'TopN設定 を隠す' : 'TopN設定 を表示'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.92)', borderTop: 'none', borderLeft: '1px solid #e0e0e0', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', borderRadius: '0 0 4px 4px', cursor: 'pointer', padding: '0 2px', marginTop: -1, userSelect: 'none' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
              <path d={showTopNSliders ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
            </svg>
          </button>
          )}
          </div>
        );
      })() : null;

  return (
    <div
      ref={containerRef}
      data-testid={testId('sankey-svg-root')}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#fff', fontFamily: 'system-ui, sans-serif', cursor: isPanning ? 'grabbing' : 'grab' }}
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
              .snk-node,
              .snk-ribbon {
                animation: none !important;
                transition: none !important;
              }
            `}</style>
            <svg
              ref={svgRef}
              data-testid={testId('sankey-svg-canvas')}
              width={svgWidth}
              height={svgHeight}
              overflow="visible"
              onPointerDown={handleTouchPointerDown}
              onPointerMove={handleTouchPointerMove}
              onPointerUp={handleTouchPointerEnd}
              onPointerCancel={handleTouchPointerEnd}
              style={{ position: 'absolute', inset: 0, display: 'block', touchAction: 'none' }}
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
                    data-testid={testId('sankey-link')}
                    d={shiftedRibbonPath(link)}
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
                    className="snk-ribbon"
                    style={{ cursor: 'grab' }}
                  />
                ))}

                {/* Label clip regions per non-last column */}
                {(() => {
                  const lastCol = layout.maxCol;
                  const cols = new Set(layout.nodes.map(n => getColumn(n)));
                  // Compute clip end per column from the actual x0 of the next column's nodes
                  const colMinX0 = new Map<number, number>();
                  for (const node of layout.nodes) {
                    const col = getColumn(node);
                    const cur = colMinX0.get(col);
                    const nodeX0 = getNodeInnerX0(node);
                    if (cur === undefined || nodeX0 < cur) colMinX0.set(col, nodeX0);
                  }
                  return Array.from(cols).filter(c => c < lastCol).map(c => {
                    const labelStart = (colMinX0.get(c) ?? 0) + innerNodeW;
                    // Clip end = leftmost x0 of next VISUAL column (skip project-spending)
                    let nextColNodes: typeof layout.nodes = [];
                    for (let nc = c + 1; nc <= lastCol; nc++) {
                      nextColNodes = layout.nodes.filter(n => getColumn(n) === nc && n.type !== 'project-spending');
                      if (nextColNodes.length > 0) break;
                    }
                    const nextX0 = nextColNodes.length > 0
                      ? Math.min(...nextColNodes.map(n => getNodeInnerX0(n)))
                      : labelStart + screenWToInner(layout.colSpacing * horizontalScale - screenNodeW);
                    // 次列ノードが左側ラベル（事業予算金額）を持つ場合、その想定幅分を予約
                    const leftLabelChars = nextColNodes
                      .filter(n => n.type === 'project-budget')
                      .reduce((m, n) => {
                        const main = formatYen(n.value);
                        const raw = n.isScaled && n.rawValue != null ? ` / ${formatYen(n.rawValue)}` : '';
                        return Math.max(m, (main + raw).length);
                      }, 0);
                    const labelScale = getZoomLabelScale(zoom, baseZoom);
                    const innerFontPx = (mapLabelFontPx * labelScale) / zoom;
                    const leftLabelReserve = leftLabelChars > 0
                      ? innerLabelGap * 2 + leftLabelChars * innerFontPx * 0.7
                      : 0;
                    const clipEnd = nextX0 - leftLabelReserve;
                    return (
                      <defs key={`clip-col-${c}`}>
                        <clipPath id={`clip-col-${c}`}>
                          <rect x={labelStart} y={-1000} width={Math.max(0, clipEnd - labelStart)} height={10000} />
                        </clipPath>
                      </defs>
                    );
                  });
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
                      const maxH = Math.max(bH, sH);
                      const { cumShift = 0, topShift = 0, colFontPx = mapLabelFontPx } = nodeShiftInfo.get(node.id) ?? {};
                      const labelVisible = topShift > 0 || maxH * zoom > mapLabelVisibleMinHPx || isSelectedMerged;
                      const nodeOpacity = connectedNodeIds
                        ? (isConnected ? 1 : 0.3)
                        : (hoveredNode && hoveredNode !== node ? 0.4 : 1);
                      const nodeFill = node.aggregated ? 'url(#proj-agg-grad)' : 'url(#proj-node-grad)';
                      if (!spendingNode) {
                        // No paired spending node — render as plain budget rect
                        return (
                          <g key={node.id} className="snk-node" data-testid={testId('sankey-node')} style={{ transform: `translateY(${node.y0 + cumShift}px)` }}>
                            <rect x={getNodeInnerX0(node)} y={topShift} width={innerNodeW} fill={getNodeColor(node)} rx={1}
                              style={{ height: bH, opacity: nodeOpacity, cursor: 'pointer' }}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                              onClick={(e) => handleNodeClick(node, e)}
                            />
                            {labelVisible && (<>
                              <text x={getNodeInnerX1(node) + innerLabelGap} y={topShift + bH / 2} fontSize={colFontPx / zoom} dominantBaseline="middle"
                                fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                                style={{ userSelect: 'none', cursor: 'pointer', pointerEvents: 'all' }} clipPath={`url(#clip-col-${getColumn(node)})`}
                                onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                                onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                                onMouseLeave={() => setHoveredNode(null)}
                                onMouseDown={(e) => e.preventDefault()}
                                onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                                onClick={(e) => handleNodeClick(node, e)}>
                                {node.name.length > 40 ? node.name.slice(0, 40) + '…' : node.name} ({formatYen(node.value)}){node.isScaled && node.rawValue != null && (<tspan fill="#777"> / {formatYen(node.rawValue)}</tspan>)}
                              </text>
                              {renderLabelHitRect(node, getNodeInnerX1(node) + innerLabelGap, topShift + bH / 2, getRightLabelHitW(getColumn(node), false), 'start', `url(#clip-col-${getColumn(node)})`)}
                            </>)}
                          </g>
                        );
                      }
                      return (
                        <g key={node.id} className="snk-node" data-testid={testId('sankey-node')} style={{ transform: `translateY(${node.y0 + cumShift}px)` }}>
                          <path
                            d={mergedProjectPath(getNodeInnerX0(node), innerNodeW, bH, sH)}
                            fill={nodeFill}
                            transform={topShift > 0 ? `translate(0, ${topShift})` : undefined}
                            style={{ opacity: nodeOpacity, cursor: 'pointer' }}
                            onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                            onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                            onMouseLeave={() => setHoveredNode(null)}
                            onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                            onClick={(e) => handleNodeClick(node, e)}
                          />
                          {labelVisible && (<>
                            {/* Left label: budget amount */}
                            <text x={getNodeInnerX0(node) - innerLabelGap} y={topShift + Math.max(bH, sH) / 2} fontSize={colFontPx / zoom} dominantBaseline="middle" textAnchor="end"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer', pointerEvents: 'all' }}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onMouseDown={(e) => e.preventDefault()}
                              onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                              onClick={(e) => handleNodeClick(node, e)}>
                              {formatYen(node.value)}{node.isScaled && node.rawValue != null && <tspan fill="#888"> / {formatYen(node.rawValue)}</tspan>}
                            </text>
                            {renderLabelHitRect(node, getNodeInnerX0(node) - innerLabelGap, topShift + Math.max(bH, sH) / 2, screenWToInner(96), 'end')}
                            {/* Right label: project name + spending amount */}
                            <text x={getNodeInnerX1(spendingNode) + innerLabelGap} y={topShift + Math.max(bH, sH) / 2} fontSize={colFontPx / zoom} dominantBaseline="middle"
                              fill={connectedNodeIds && !isConnected ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                              style={{ userSelect: 'none', cursor: 'pointer', pointerEvents: 'all' }} clipPath={`url(#clip-col-${getColumn(node)})`}
                              onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredNode(node); }}
                              onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                              onMouseLeave={() => setHoveredNode(null)}
                              onMouseDown={(e) => e.preventDefault()}
                              onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                              onClick={(e) => handleNodeClick(node, e)}>
                              {node.name.length > 40 ? node.name.slice(0, 40) + '…' : node.name} ({formatYen(spendingNode.value)}){spendingNode.isScaled && spendingNode.rawValue != null && (<tspan fill="#777"> / {formatYen(spendingNode.rawValue)}</tspan>)}
                            </text>
                            {renderLabelHitRect(node, getNodeInnerX1(spendingNode) + innerLabelGap, topShift + Math.max(bH, sH) / 2, getRightLabelHitW(getColumn(node), false), 'start', `url(#clip-col-${getColumn(node)})`)}
                          </>)}
                        </g>
                      );
                    }
                    // Regular node (total, ministry, recipient)
                    const h = node.y1 - node.y0;
                    const isSelected = node.id === selectedNodeId;
                    const { cumShift = 0, topShift = 0, colFontPx = mapLabelFontPx } = nodeShiftInfo.get(node.id) ?? {};
                    const labelVisible = topShift > 0 || (h + NODE_PAD) * zoom > mapLabelVisibleMinHPx || isSelected;
                    const col = getColumn(node);
                    const isLastCol = col === lastCol;
                    return (
                      <g key={node.id} className="snk-node" data-testid={testId('sankey-node')} style={{ transform: `translateY(${node.y0 + cumShift}px)` }}>
                        <rect
                          x={getNodeInnerX0(node)}
                          y={topShift}
                          width={innerNodeW}
                          fill={getNodeColor(node)}
                          rx={1}
                          style={{
                            height: Math.max(1, h),
                            opacity: connectedNodeIds
                              ? (connectedNodeIds.has(node.id) ? 1 : 0.3)
                              : (hoveredNode && hoveredNode !== node ? 0.4 : 1),
                            cursor: 'pointer',
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
                          onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                          onClick={(e) => handleNodeClick(node, e)}
                        />
                        {labelVisible && (<>
                          <text
                            x={getNodeInnerX1(node) + innerLabelGap}
                            y={topShift + h / 2}
                            fontSize={colFontPx / zoom}
                            dominantBaseline="middle"
                            fill={connectedNodeIds && !connectedNodeIds.has(node.id) ? '#bbb' : hoveredNodeIds && !hoveredNodeIds.has(node.id) ? '#bbb' : '#333'}
                            style={{ userSelect: 'none', cursor: 'pointer', pointerEvents: 'all' }}
                            clipPath={isLastCol ? undefined : `url(#clip-col-${col})`}
                            onMouseEnter={(e) => { const rect = containerRef.current?.getBoundingClientRect(); if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); setHoveredNode(node); }}
                            onMouseMove={(e) => { const rect = containerRef.current?.getBoundingClientRect(); if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top }); }}
                            onMouseLeave={() => setHoveredNode(null)}
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerUp={(e) => handleNodeTouchPointerUp(node, e)}
                            onClick={(e) => handleNodeClick(node, e)}
                          >
                            {node.name.length > 40 ? node.name.slice(0, 40) + '…' : node.name} ({formatYen(node.value)}){node.isScaled && node.rawValue != null && (<tspan fill="#777"> / {formatYen(node.rawValue)}</tspan>)}
                          </text>
                          {renderLabelHitRect(node, getNodeInnerX1(node) + innerLabelGap, topShift + h / 2, getRightLabelHitW(col, isLastCol), 'start', isLastCol ? undefined : `url(#clip-col-${col})`)}
                        </>)}
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
              const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
              const columnAmount = (node: LayoutNode, colIndex: number) =>
                colIndex === 2 && node.type === 'project-budget' && node.rawValue != null ? node.rawValue : node.value;
              const colAmounts: (number | null)[] = colNodeTypes.map((t, i) => {
                const nodes = t === 'total' ? layout.nodes.filter(n => n.type === 'total') : layout.nodes.filter(n => n.type === t);
                return i === 0 ? (nodes[0]?.value ?? null) : nodes.reduce((s, n) => s + columnAmount(n, i), 0);
              });
              const projectSpendingTotal = layout.nodes.filter(n => n.type === 'project-spending').reduce((s, n) => s + n.value, 0);
              // 列ごとの最上端ノードを取得（ラベル基準位置の計算用）
              const topNodeByCol = colNodeTypes.map(t =>
                layout.nodes.filter(n => n.type === t).reduce<typeof layout.nodes[0] | null>((top, n) => (top === null || n.y0 < top.y0 ? n : top), null)
              );
              return COL_LABELS.map((label, i) => {
                // Use actual node x0 from layout (accounts for extraMinistryGapSVG / extraRecipientGapSVG)
                const colNodes = layout.nodes.filter(n => n.type === colNodeTypes[i]);
                const screenX = pan.x + (colNodes.length > 0
                  ? Math.min(...colNodes.map(n => getNodeScreenX0(n))) + screenNodeW / 2
                  : MARGIN.left + SCREEN_LEFT_PADDING_PX + (i / maxCol) * (svgWidth - MARGIN.left - MARGIN.right - SCREEN_LEFT_PADDING_PX - screenNodeW) + screenNodeW / 2);
                const total = colAmounts[i];
                const amountLine = i === 2 && total != null
                  ? `${formatYen(total)} / ${formatYen(projectSpendingTotal)}`
                  : total != null ? formatYen(total) : '';
                const labelBlockH = Math.round((amountLine ? 36 : 20) * fontScale);
                const topNode = topNodeByCol[i];
                const topNodeShift = topNode ? (nodeShiftInfo.get(topNode.id) ?? { cumShift: 0, topShift: 0 }) : null;
                const topNodeScreenY = topNode
                  ? pan.y + (MARGIN.top + topNode.y0 + (topNodeShift?.cumShift ?? 0) + (topNodeShift?.topShift ?? 0)) * zoom
                  : pan.y + MARGIN.top * zoom;
                // ラベルの上限位置は検索ボックスの実測下端に合わせる。
                // 静的なSEARCH_BOX_RESERVE(モバイル92/デスクトップ56)だと
                // モバイルで一律に下げ過ぎるため、実際の検索ボックス高さに追従させる。
                // フィルタ展開時も列ヘッダーの位置を固定する。
                // searchBoxBottom はフィルタパネル込みの実測値なので、その実高を差し引いて
                // 「フィルタ非展開時の下端」を基準にする（フィルタパネルは zIndex で前面に重なる）。
                const top = Math.max(searchBoxBottom - filterPanelHeight + 4, topNodeScreenY - labelBlockH - 8);
                return (
                  <div
                    key={i}
                    data-pan-disabled="true"
                    style={{
                      position: 'absolute', left: screenX, top,
                      transform: 'translateX(-50%)',
                      textAlign: 'center', fontSize: COLUMN_LABEL_FONT_PX, color: '#999',
                      whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default',
                      zIndex: 8, lineHeight: 1.4,
                      background: 'rgba(255,255,255,0.82)', padding: '2px 8px', borderRadius: 4,
                    }}
                    onMouseEnter={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); setHoveredColIndex(i); }}
                    onMouseMove={(e) => { const r = containerRef.current?.getBoundingClientRect(); if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
                    onMouseLeave={() => setHoveredColIndex(null)}
                  >
                    <div>{label}</div>
                    {amountLine && <div style={{ fontSize: COLUMN_AMOUNT_FONT_PX }}>{amountLine}</div>}
                  </div>
                );
              });
            })()}

            {/* Minimap（スマホ幅では非表示） */}
            {!isCompactWidth && (
            <MinimapOverlay
              show={showMinimap}
              onShow={() => setShowMinimap(true)}
              onHide={() => setShowMinimap(false)}
              left={minimapLeft}
              minimapW={MINIMAP_W}
              minimapH={minimapH}
              canvasRef={minimapRef}
              navigate={minimapNavigate}
              dragging={minimapDragging}
            />
            )}

            {/* Font size controls（スマホ幅では設定ダイアログへ移動するため非表示） */}
            {!isCompactWidth && (
            <div
              data-pan-disabled="true"
              style={{
                position: 'absolute',
                left: fontControlLeft,
                bottom: showMinimap ? 8 : 16,
                zIndex: 12,
                display: 'flex',
                alignItems: 'flex-end',
                gap: 6,
                transition: 'left 0.2s ease',
              }}
            >
              {!showFontControls && (
                <button
                  type="button"
                  title="フォントサイズ設定"
                  aria-label="フォントサイズ設定"
                  aria-expanded={showFontControls}
                  onClick={(e) => { e.stopPropagation(); setShowFontControls(true); }}
                  style={{
                    width: FONT_CONTROL_BUTTON_PX,
                    height: FONT_CONTROL_BUTTON_PX,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.7)',
                    color: '#888',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {/* Material Icons: format_size */}
                  <svg xmlns="http://www.w3.org/2000/svg" height={FONT_CONTROL_ICON_PX} width={FONT_CONTROL_ICON_PX} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 4v3h5v12h3V7h5V4H9Zm-6 8h3v7h3v-7h3V9H3v3Z" />
                  </svg>
                </button>
              )}
              {showFontControls && (
                <div
                  role="group"
                  aria-label="基準フォントサイズ"
                  style={{
                    position: 'relative',
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.95)',
                    border: '1px solid #e0e0e0',
                    borderRadius: '6px 6px 0 6px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                    padding: '6px 10px',
                    color: '#333',
                    minHeight: FONT_CONTROL_BUTTON_PX,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {fontSizeControlsFragment}
                  <button
                    type="button"
                    title="フォントサイズ設定を閉じる"
                    aria-label="フォントサイズ設定を閉じる"
                    onClick={(e) => { e.stopPropagation(); setShowFontControls(false); }}
                    style={{
                      position: 'absolute',
                      bottom: -1,
                      right: -13,
                      zIndex: 12,
                      background: 'rgba(255,255,255,0.92)',
                      borderTop: '1px solid #e0e0e0',
                      borderRight: '1px solid #e0e0e0',
                      borderBottom: '1px solid #e0e0e0',
                      borderLeft: 'none',
                      borderRadius: '0 4px 4px 0',
                      width: 14,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="#aaa">
                      <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            )}

          {/* DOM tooltip — link hover */}
          {hoveredLink && !hoveredNode && !suppressHoverPopup && (() => {
            const tipW = Math.round(220 * fontScale);
            const tipH = Math.round(66 * fontScale);
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
                <div style={{ fontWeight: 600, fontSize: TOOLTIP_TITLE_FONT_PX, marginBottom: 5, textAlign: 'left' }}>{hoveredLink.source.name} → {hoveredLink.target.name}</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: TOOLTIP_VALUE_FONT_PX, fontWeight: 500, color: '#222' }}>{formatYen(hoveredLink.value)}</div>
                    <div style={{ fontSize: TOOLTIP_META_FONT_PX, color: '#555' }}>{Math.round(hoveredLink.value).toLocaleString()}円</div>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* DOM tooltip — node hover (sankey2スタイル: ノード上方・ノード色背景) */}
          {hoveredNode && layout && !suppressHoverPopup && (() => {
            const GAP = Math.round(8 * fontScale);
            const tipW = Math.round(240 * fontScale);
            const { cumShift: hoverCumShift = 0, topShift: hoverTopShift = 0, colFontPx: hoverColFontPx = mapLabelFontPx } = nodeShiftInfo.get(hoveredNode.id) ?? {};
            const nodeScreenH = (hoveredNode.y1 - hoveredNode.y0) * zoom;
            const screenCx = pan.x + getNodeScreenX0(hoveredNode) + screenNodeW / 2;
            const screenTop = pan.y + (MARGIN.top + hoveredNode.y0 + hoverCumShift + hoverTopShift) * zoom;
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
            // 会計区分バッジ（project-budget / project-spending のみ）
            let hoveredAccountBadge: { label: string; background: string } | null = null;
            if (t === 'project-budget' || t === 'project-spending') {
              const cat = t === 'project-budget'
                ? hoveredNode.accountCategory
                : hoveredNode.targetLinks.find(l => l.source.type === 'project-budget')?.source.accountCategory;
              hoveredAccountBadge = getAccountBadgeStyle(cat);
            }
            // 予算・支出が両方ある場合は2列グリッドで横並び、片方だけなら1列
            const both = budget != null && spending != null;
            const tipH = Math.round((both ? 88 : 76) * fontScale);
            // 大ノード: マウスY連動（カーソル上方）/ 小ノード: ラベル上端-GAPにポップアップ底辺を固定
            const labelFontPx = hoverColFontPx;
            const labelTopScreenY = screenTop + nodeScreenH / 2 - labelFontPx / 2;
            const cursorGap = Math.round(12 * fontScale);
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
                  <span style={{ fontSize: TOOLTIP_META_FONT_PX, color: '#888', flexShrink: 0, paddingTop: 1 }}>{label}</span>
                  <span style={{ fontSize: TOOLTIP_VALUE_FONT_PX, fontWeight: 500, color: '#222' }}>{formatYen(val)}</span>
                </div>
                <div style={{ fontSize: TOOLTIP_META_FONT_PX, color: '#555', wordBreak: 'break-all' }}>{Math.round(val).toLocaleString()}円</div>
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
                <div style={{ fontWeight: 600, fontSize: TOOLTIP_TITLE_FONT_PX, marginBottom: 5, color: '#111', textAlign: 'left' }}>
                  {hoveredNode.name}
                  {hoveredAccountBadge && (
                    <span style={{ display: 'inline-block', verticalAlign: '0.08em', marginLeft: 5, fontSize: Math.max(9, META_FONT_PX - 1), padding: '1px 5px', borderRadius: 8, fontWeight: 600, lineHeight: 1.35, background: hoveredAccountBadge.background, color: '#fff', whiteSpace: 'nowrap' }}>
                      {hoveredAccountBadge.label}
                    </span>
                  )}
                </div>
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
            const budgetAmt = (n: LayoutNode) =>
              n.type === 'project-budget' && n.rawValue != null ? n.rawValue : n.value;
            const colNodeTypes = ['total', 'ministry', 'project-budget', 'recipient'] as const;
            const nodes = hoveredColIndex === 0
              ? layout.nodes.filter(n => n.type === 'total')
              : layout.nodes.filter(n => n.type === colNodeTypes[hoveredColIndex]);
            const total = hoveredColIndex === 0
              ? (nodes[0] ? amt(nodes[0]) : 0)
              : hoveredColIndex === 2
                ? nodes.reduce((s, n) => s + budgetAmt(n), 0)
                : nodes.reduce((s, n) => s + amt(n), 0);
            const projectSpendingTotal = layout.nodes
              .filter(n => n.type === 'project-spending')
              .reduce((s, n) => s + amt(n), 0);
            const valueLine = (label: string, value: number) => (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: '#888', fontSize: TOOLTIP_META_FONT_PX }}>{label}</span>
                <span style={{ fontWeight: 500, fontSize: TOOLTIP_VALUE_FONT_PX, color: '#222' }}>{formatYen(value)}</span>
              </div>
            );
            const rawYenLine = (value: number) => (
              <div style={{ color: '#555', fontSize: TOOLTIP_META_FONT_PX, textAlign: 'right' }}>{Math.round(value).toLocaleString()}円</div>
            );
            return (
              <div style={{ position: 'absolute', left: mousePos.x + 12, top: mousePos.y + 16, background: 'rgba(255,255,255,0.97)', color: '#222', padding: '6px 10px', borderRadius: 6, fontSize: TOOLTIP_TITLE_FONT_PX, lineHeight: 1.5, pointerEvents: 'none', zIndex: 20, whiteSpace: 'nowrap', border: '1px solid #e0e0e0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                <div style={{ fontWeight: 600, fontSize: TOOLTIP_TITLE_FONT_PX, marginBottom: 2 }}>{COL_LABELS[hoveredColIndex]}</div>
                {hoveredColIndex === 2 ? (
                  <div style={{ display: 'grid', gap: 2 }}>
                    {valueLine('予算', total)}
                    {rawYenLine(total)}
                    {valueLine('支出', projectSpendingTotal)}
                    {rawYenLine(projectSpendingTotal)}
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 500, fontSize: TOOLTIP_VALUE_FONT_PX, color: '#222' }}>{formatYen(total)}</div>
                    <div style={{ color: '#555', fontSize: TOOLTIP_META_FONT_PX }}>{Math.round(total).toLocaleString()}円</div>
                  </>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Left side panel — node detail */}
      {selectedNodeId !== null && (
        <SidePanelChrome
          side="left"
          open={!isPanelCollapsed}
          onToggle={leftSidePanel.toggleCollapsed}
          width={effectiveSidePanelWidth}
          minWidth={SIDE_PANEL_WIDTH_MIN}
          maxWidth={SIDE_PANEL_WIDTH_MAX}
          onResizeStart={leftSidePanel.onResizeStart}
          isResizing={isResizingSidePanel}
          onResetWidth={leftSidePanel.resetWidth}
        >
          {/* Panel content */}
          {selectedNode && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header — fixed, never scrolls */}
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: PANEL_TITLE_FONT_PX, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
                      {selectedNode.name}
                    </div>
                    {selectedNode.type === 'recipient' && selectedNode.representativeCorporateNumber && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: META_FONT_PX, color: '#666' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', lineHeight: 1 }} title="法人番号（代表：内包する有効法人番号のうち最大金額のもの）">
                          <span style={{ lineHeight: 1 }}>法人番号 {selectedNode.representativeCorporateNumber}</span>
                          {(() => {
                            // 有効な法人番号のみ gBizINFO へリンク（検証・URL構築は共有ヘルパーに集約）
                            const links = externalCorporateLinks(selectedNode.representativeCorporateNumber);
                            if (!links) return null;
                            return (
                              <a
                                href={links.gbizinfo}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`gBizINFO で法人番号を確認: ${selectedNode.representativeCorporateNumber}`}
                                style={{ display: 'inline-flex', color: '#2563eb', flexShrink: 0 }}
                                onClick={e => e.stopPropagation()}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" height="13" width="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
                                  <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                                </svg>
                              </a>
                            );
                          })()}
                        </span>
                        {(selectedNode.corporateNumberCount ?? 0) >= 2 && (
                          <span
                            style={{ background: '#fef3c7', color: '#92400e', padding: '0 6px', borderRadius: 8, fontWeight: 600, whiteSpace: 'nowrap' }}
                            title={`この支出先名には${selectedNode.corporateNumberCount}件の法人番号が紐づいています（表記揺れ・誤記載・複数実体の可能性）`}
                          >
                            他{(selectedNode.corporateNumberCount ?? 1) - 1}件
                          </span>
                        )}
                      </div>
                    )}
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
                      const budgetValue = mainLabel === '予算額' ? mainValue : subLabel === '予算額' ? subValue : null;
                      const spendingValue = mainLabel === '支出額' ? mainValue : subLabel === '支出額' ? subValue : null;
                      const amountCellStyle: React.CSSProperties = {
                        // flex-basis をフォント連動にして、文字拡大時に2列が収まらなくなったら
                        // 自動で1列へ折り返す（1円単位のnowrap金額が隣セルへはみ出して重なるのを防ぐ）。
                        flex: `1 1 ${scaleSize(112)}px`,
                        minWidth: 0,
                      };
                      const amountLabelStyle: React.CSSProperties = {
                        display: 'block',
                        fontSize: META_FONT_PX,
                        color: '#aaa',
                        fontWeight: 400,
                        marginBottom: 1,
                      };
                      const amountValueStyle: React.CSSProperties = {
                        display: 'block',
                        fontSize: PANEL_PRIMARY_VALUE_FONT_PX,
                        fontWeight: 600,
                        color: '#222',
                        whiteSpace: 'nowrap',
                      };
                      const exactValueStyle: React.CSSProperties = {
                        display: 'block',
                        fontSize: META_FONT_PX,
                        color: '#999',
                        marginTop: 1,
                        whiteSpace: 'nowrap',
                      };
                      const renderHeaderAmount = (label: string, value: number) => (
                        <div style={amountCellStyle}>
                          <span style={amountLabelStyle}>{label}</span>
                          <span style={amountValueStyle}>{formatYen(value)}</span>
                          <span style={exactValueStyle}>{Math.round(value).toLocaleString()}円</span>
                        </div>
                      );
                      if (budgetValue !== null && spendingValue !== null) {
                        return (<>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 12, rowGap: 4, marginTop: 5 }}>
                            {renderHeaderAmount('予算額', budgetValue)}
                            {renderHeaderAmount('支出額', spendingValue)}
                          </div>
                          {rawMain !== null && (
                            <div style={{ fontSize: META_FONT_PX, color: '#bbb', marginTop: 3 }}>
                              <span style={{ fontSize: META_FONT_PX, color: '#ccc', marginRight: 4 }}>{rawMainLabel}</span>
                              {formatYen(rawMain)}
                              <span style={{ fontSize: META_FONT_PX, color: '#ccc', marginLeft: 4 }}>{Math.round(rawMain).toLocaleString()}円</span>
                            </div>
                          )}
                        </>);
                      }
                      return (<>
                        <div style={{ fontSize: PANEL_PRIMARY_VALUE_FONT_PX, fontWeight: 600, color: '#222', marginTop: 3 }}>
                          {mainLabel && <span style={{ fontSize: META_FONT_PX, color: '#aaa', fontWeight: 400, marginRight: 4 }}>{mainLabel}</span>}
                          {formatYen(mainValue)}
                        </div>
                        <div style={{ fontSize: META_FONT_PX, color: '#999', marginTop: 1 }}>{Math.round(mainValue).toLocaleString()}円</div>
                        {rawMain !== null && (
                          <div style={{ fontSize: META_FONT_PX, color: '#bbb', marginTop: 1 }}>
                            <span style={{ fontSize: META_FONT_PX, color: '#ccc', marginRight: 4 }}>{rawMainLabel}</span>
                            {formatYen(rawMain)}
                            <span style={{ fontSize: META_FONT_PX, color: '#ccc', marginLeft: 4 }}>{Math.round(rawMain).toLocaleString()}円</span>
                          </div>
                        )}
                        {subValue !== null && (
                          <div style={{ fontSize: PANEL_META_FONT_PX, color: '#777', marginTop: 4 }}>
                            <span style={{ fontSize: META_FONT_PX, color: '#aaa', marginRight: 4 }}>{subLabel}</span>
                            {formatYen(subValue)}
                            <span style={{ fontSize: META_FONT_PX, color: '#bbb', marginLeft: 4 }}>{Math.round(subValue).toLocaleString()}円</span>
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
                  <span style={{ background: getNodeColor(selectedNode), color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: META_FONT_PX, fontWeight: 500 }}>
                    {TYPE_LABELS[selectedNode.type] ?? selectedNode.type}
                  </span>
                  {selectedNode.aggregated && (
                    <span style={{ background: '#999', color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: META_FONT_PX, fontWeight: 500 }}>集約</span>
                  )}
                  {selectedNode.projectId != null && (
                    <span style={{ fontSize: META_FONT_PX, color: '#aaa' }}>PID:{selectedNode.projectId}</span>
                  )}
                  {selectedNode.ministry && selectedNode.type !== 'ministry' && (
                    <span style={{ fontSize: META_FONT_PX, color: '#666' }}>{selectedNode.ministry}</span>
                  )}
                </div>
              </div>

              {/* 政策評価 — 事業ノード（非集約）のみ。共有コンポーネント（再委託ビューと同型） */}
              {selectedNode && (selectedNode.type === 'project-budget' || selectedNode.type === 'project-spending')
                && !selectedNode.aggregated && selectedNode.projectId != null && (() => {
                const entry = policySummary?.items[String(selectedNode.projectId)];
                return (
                  <PolicyEvaluationBlock
                    pid={selectedNode.projectId}
                    year={year}
                    error={policyError}
                    view={entry ? {
                      overall: entry.o, proportionality: entry.x, necessity: entry.n,
                      recommendation: entry.r ? policySummary!.recommendations[entry.r] : null,
                      improvementAction: entry.a ? policySummary!.actions[entry.a] : null,
                      categoryLabel: entry.c ? policySummary!.categories[entry.c] : null,
                    } : null}
                    labelPx={PANEL_META_FONT_PX}
                    metaPx={META_FONT_PX}
                    onOpenDetail={() => openScoreDialog(selectedNode.projectId!)}
                    detailLoading={scoreDialogLoading}
                  />
                );
              })()}

              {/* 事業概要アコーディオン — project-budget / project-spending（非集約）のみ。共有コンポーネント */}
              {selectedNode && (selectedNode.type === 'project-budget' || selectedNode.type === 'project-spending') && !selectedNode.aggregated && selectedNode.projectId != null && (
                <ProjectOverviewSection
                  detail={projectDetailCache.get(`${year}-${selectedNode.projectId}`)}
                  projectName={selectedNode.name}
                  year={year}
                  subcontractHref={`/subcontracts/${selectedNode.projectId}?year=${year}`}
                  scaleFont={scaleFont}
                  expanded={isProjectDetailExpanded}
                  onToggle={() => setIsProjectDetailExpanded(v => !v)}
                  previewHeight={projectOverviewPreviewHeight}
                  onResizeStart={(e) => { e.preventDefault(); overviewResizeRef.current = { startY: e.clientY, startH: projectOverviewPreviewHeight }; setIsResizingOverview(true); }}
                  onResizeReset={() => setProjectOverviewPreviewHeight(PROJECT_OVERVIEW_PREVIEW_HEIGHT_DEFAULT)}
                  isLoading={isProjectDetailExpanded && projectDetailCache.get(`${year}-${selectedNode.projectId}`) === undefined}
                />
              )}


              {/* 再委託サマリ — project-budget / project-spending（非集約）のみ。/api/subcontracts から遅延取得 */}
              {selectedNode && (selectedNode.type === 'project-budget' || selectedNode.type === 'project-spending') && !selectedNode.aggregated && selectedNode.projectId != null && (() => {
                const sub = subcontractSummaryCache.get(`${year}-${selectedNode.projectId}`);
                if (sub === undefined) return null; // fetch中は非表示（パネルのちらつき防止）
                if (sub === null || sub.totalBlockCount === 0) return null; // 再委託データなし
                const subPid = selectedNode.projectId;
                const statChip: React.CSSProperties = {
                  border: '1px solid #e0e0e0', borderRadius: 4, padding: '1px 7px',
                  fontSize: META_FONT_PX, color: '#555', whiteSpace: 'nowrap',
                };
                return (
                  <div style={{ borderBottom: '1px solid #f0f0f0', padding: '7px 14px 9px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: PANEL_META_FONT_PX, fontWeight: 600, color: '#555' }}>再委託</span>
                      <a href={`/subcontracts/${subPid}?year=${year}`}
                        title="再委託フローを見る（同じタブで開きます）"
                        style={{ fontSize: META_FONT_PX, color: '#4a90d9', textDecoration: 'none', marginLeft: 'auto', flexShrink: 0 }}
                      >フロー ↗</a>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <span style={statChip}>ブロック {sub.totalBlockCount}</span>
                      <span style={statChip}>支出先 {sub.totalRecipientCount.toLocaleString()}</span>
                      <span style={statChip}>階層 {sub.maxDepth}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                      <TagChip kind="direct" fontSize={META_FONT_PX}>直接 {sub.directBlockCount}</TagChip>
                      {sub.subcontractBlockCount > 0 && <TagChip kind="subcontract" fontSize={META_FONT_PX}>再委託 {sub.subcontractBlockCount}</TagChip>}
                      {sub.separateOriginCount > 0 && <TagChip kind="separate-origin" fontSize={META_FONT_PX}>別財源 {sub.separateOriginCount}</TagChip>}
                    </div>
                  </div>
                );
              })()}

              {/* 予算・執行アコーディオン — project-budget / project-spending（非集約）のみ。共有コンポーネント */}
              {selectedProjectBudgetNode && (
                <BudgetExecutionSection
                  budgetSummary={selectedProjectBudgetNode.budgetSummary}
                  budgetBreakdown={selectedProjectBudgetNode.budgetBreakdown ?? []}
                  scaleFont={scaleFont}
                  expanded={isBudgetExecutionExpanded}
                  onToggleExpanded={() => setIsBudgetExecutionExpanded(v => !v)}
                  listHeight={budgetExecutionListHeight}
                  onResizeStart={(e) => { e.preventDefault(); budgetExecutionResizeRef.current = { startY: e.clientY, startH: budgetExecutionListHeight }; setIsResizingBudgetExecution(true); }}
                  onResizeReset={() => setBudgetExecutionListHeight(BUDGET_EXECUTION_LIST_HEIGHT_DEFAULT)}
                />
              )}

              {/* 省庁 / 事業 / 支出先 3タブ */}
              {panelSections && (() => {
                const tabBtnBase: React.CSSProperties = { flex: 1, padding: '6px 4px', fontSize: PANEL_META_FONT_PX, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', color: '#999' };
                const tabBtnActive: React.CSSProperties = { ...tabBtnBase, color: '#333', borderBottom: '2px solid #4a90d9' };
                type PanelItem = { id: string; name: string; value: number; projectId?: number; accountCategory?: string; aggregated?: boolean; budgetValue?: number; spendingValue?: number; recipientFlowValue?: number; recipientCount?: number; };
                const listButtonStyle = (item: PanelItem): React.CSSProperties => ({
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '5px 0',
                  borderBottom: '1px solid #f5f5f5',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  cursor: item.aggregated ? 'default' : 'pointer',
                  columnGap: 6,
                  rowGap: 2,
                  textAlign: 'left',
                });
                const listNameStyle = (item: PanelItem): React.CSSProperties => ({
                  flex: '1 1 150px',
                  minWidth: 0,
                  fontSize: PANEL_LIST_NAME_FONT_PX,
                  color: item.aggregated ? '#999' : '#333',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                });
                const listTitleRowStyle: React.CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flex: '0 0 100%',
                  minWidth: 0,
                };
                const listValueStyle: React.CSSProperties = {
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  alignItems: 'baseline',
                  gap: 8,
                  flex: '0 0 100%',
                  minWidth: 0,
                  fontSize: PANEL_LIST_VALUE_FONT_PX,
                  color: '#777',
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  textAlign: 'right',
                };
                const listMetaRightStyle: React.CSSProperties = {
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  alignItems: 'baseline',
                  gap: 8,
                  marginLeft: 'auto',
                  minWidth: 0,
                };
                const budgetSpendingStyle: React.CSSProperties = {
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  alignItems: 'baseline',
                  gap: 8,
                  minWidth: 0,
                };
                const amountPairLabelStyle: React.CSSProperties = {
                  color: '#aaa',
                  marginRight: 2,
                  whiteSpace: 'nowrap',
                };
                const amountPairValueStyle: React.CSSProperties = {
                  whiteSpace: 'nowrap',
                };
                const renderCompactAccountBadge = (cat?: string) => {
                  const badge = getAccountBadgeStyle(cat);
                  if (!badge) return null;
                  return (
                    <span style={{ background: badge.background, color: '#fff', padding: '1px 5px', borderRadius: 8, fontSize: Math.max(9, META_FONT_PX - 1), fontWeight: 600, lineHeight: 1.35, whiteSpace: 'nowrap' }}>
                      {badge.label}
                    </span>
                  );
                };
                const renderListTitle = (item: PanelItem, showAccountBadge = false) => (
                  <span style={listTitleRowStyle}>
                    <span title={item.name} style={listNameStyle(item)}>{item.name}</span>
                    {showAccountBadge && renderCompactAccountBadge(item.accountCategory)}
                  </span>
                );
                const renderListMeta = (item: PanelItem, value: React.ReactNode) => (
                  <span style={listValueStyle}>
                    <span style={listMetaRightStyle}>
                      {item.projectId != null && <span style={{ fontSize: META_FONT_PX, color: '#aaa', whiteSpace: 'nowrap' }}>PID:{item.projectId}</span>}
                      <span>{value}</span>
                    </span>
                  </span>
                );
                const renderBudgetSpendingMeta = (item: PanelItem) => (
                  renderListMeta(
                    item,
                    <span style={budgetSpendingStyle}>
                      {item.recipientFlowValue != null && (
                        <span>
                          <span style={amountPairLabelStyle}>対象支出</span>
                          <span style={amountPairValueStyle}>{formatYen(item.recipientFlowValue)}</span>
                        </span>
                      )}
                      <span>
                        <span style={amountPairLabelStyle}>予算</span>
                        <span style={amountPairValueStyle}>{formatYen(item.budgetValue ?? 0)}</span>
                      </span>
                      <span>
                        <span style={amountPairLabelStyle}>支出</span>
                        <span style={amountPairValueStyle}>{formatYen(item.spendingValue ?? item.value)}</span>
                      </span>
                    </span>
                  )
                );
                const renderFlatList = (items: PanelItem[], getValue?: (item: PanelItem) => number) => {
                  const getVal = getValue ?? ((item: PanelItem) => item.value);
                  if (items.length === 0) return <p style={{ fontSize: PANEL_META_FONT_PX, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                  return items.map((item) => (
                    <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                      style={listButtonStyle(item)}
                    >
                      {renderListTitle(item)}
                      {renderListMeta(item, formatYen(getVal(item)))}
                    </button>
                  ));
                };
                return (
                  <div style={{ borderTop: '1px solid #f0f0f0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #eee', flexShrink: 0, background: '#fff' }}>
                      <button type="button" style={panelTab === 'ministry' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('ministry')}>
                        省庁<span style={{ fontWeight: 400, fontSize: META_FONT_PX }}>({panelSections.ministries.length})</span>
                      </button>
                      <button type="button" style={panelTab === 'project' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('project')}>
                        事業<span style={{ fontWeight: 400, fontSize: META_FONT_PX }}>({panelSections.projects.length})</span>
                      </button>
                      <button type="button" style={panelTab === 'recipient' ? tabBtnActive : tabBtnBase} onClick={() => setPanelTab('recipient')}>
                        支出先<span style={{ fontWeight: 400, fontSize: META_FONT_PX }}>({panelSections.recipients.length})</span>
                      </button>
                    </div>
                    {/* Tab content */}
                    {/* スマホ縦では下端のオフセットコントロールに最終行が隠れるため、その実高ぶん下に余白を確保 */}
                    <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto', paddingBottom: isCompactWidth && !isLandscapeCompact ? offsetControlHeight + 24 : 10 }}>
                      {/* 省庁タブ */}
                      {panelTab === 'ministry' && (() => {
                        const items = panelSections.ministries;
                        if (items.length === 0) return <p style={{ fontSize: PANEL_META_FONT_PX, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                        return items.map((item) => (
                          <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                            style={listButtonStyle(item)}
                          >
                            {renderListTitle(item)}
                            {item.budgetValue != null
                              ? renderBudgetSpendingMeta(item)
                              : renderListMeta(item, formatYen(item.value))
                            }
                          </button>
                        ));
                      })()}
                      {/* 事業タブ */}
                      {panelTab === 'project' && (() => {
                        const items = panelSections.projects;
                        if (items.length === 0) return <p style={{ fontSize: PANEL_META_FONT_PX, color: '#aaa', margin: 0, padding: '6px 0' }}>なし</p>;
                        return items.map((item) => (
                          <button key={item.id} type="button" disabled={item.aggregated} onClick={() => handleConnectionClick(item.id)}
                            style={listButtonStyle(item)}
                          >
                            {renderListTitle(item, true)}
                            {item.budgetValue != null
                              ? renderBudgetSpendingMeta(item)
                              : renderListMeta(item, formatYen(item.value))
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
        </SidePanelChrome>
      )}


      {/* Search box — top left */}
      {/* zIndex は サイドパネル(25) より下。列ヘッダー(8)/年度(15)/設定ダイアログ(19) より上、
          かつ展開したフィルタを含めてサイドパネルの背面に回す（パネル展開時は横へ退避するため実害は少ない）。 */}
      <div
        ref={searchBoxRef}
        data-pan-disabled="true"
        style={{ position: 'absolute', top: 12, left: selectedNodeId !== null && !isPanelCollapsed ? effectiveSidePanelWidth + 12 : 12, zIndex: 20, width: SEARCH_BOX_WIDTH_PX, maxWidth: searchMaxWidth, transition: isResizingSidePanel ? 'none' : 'left 0.2s ease' }}
      >
        {/* Row 1: 検索セクション（input+sliders+toggle）とフィルタボタン */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {/* 検索セクション: input card（内部にsliders）+ toggle（TopNと同じ構造） */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Card: input + optional sliders（TopNのパネルdivに相当） */}
          <div style={{ background: 'rgba(255,255,255,0.95)', border: `1px solid ${searchRegexError ? '#e53935' : '#e0e0e0'}`, borderRadius: '6px 6px 0 6px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            {/* Input row */}
            <div style={{ position: 'relative' }}>
              {/* Search icon */}
              <span
                aria-hidden="true"
                style={{ position: 'absolute', left: SEARCH_INLINE_BUTTON_OFFSET_PX, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: SEARCH_ICON_BOX_PX, height: SEARCH_ICON_BOX_PX, pointerEvents: 'none' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height={SEARCH_ICON_PX} width={SEARCH_ICON_PX} viewBox="0 0 24 24" fill="#999">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </span>
              <input
                ref={searchInputRef}
                data-testid={testId('search-input')}
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
                placeholder="検索(2文字以上/PID)"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  paddingLeft: SEARCH_INPUT_PAD_LEFT_PX, paddingRight: SEARCH_INPUT_PAD_RIGHT_PX, paddingTop: SEARCH_INPUT_PAD_Y_PX, paddingBottom: SEARCH_INPUT_PAD_Y_PX,
                  fontSize: SEARCH_FONT_PX, border: 'none', borderRadius: 8,
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
                  position: 'absolute', right: searchQuery ? SEARCH_INLINE_BUTTON_OFFSET_PX + SEARCH_INLINE_BUTTON_GAP_PX : SEARCH_INLINE_BUTTON_OFFSET_PX, top: '50%', transform: 'translateY(-50%)',
                  background: searchUseRegex ? '#1a73e8' : 'transparent',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  color: searchUseRegex ? '#fff' : '#888',
                  fontSize: META_FONT_PX, fontFamily: 'monospace', fontWeight: 'bold',
                  lineHeight: 1, padding: `2px ${SEARCH_INLINE_BUTTON_PAD_X_PX}px`,
                }}
              >.*</button>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setDebouncedQuery(''); setShowSearchResults(false); searchInputRef.current?.focus(); }}
                  style={{ position: 'absolute', right: SEARCH_INLINE_BUTTON_OFFSET_PX, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: SEARCH_CLEAR_BUTTON_FONT_PX, lineHeight: 1, padding: `2px ${SEARCH_INLINE_BUTTON_PAD_X_PX}px` }}
                >✕</button>
              )}
            </div>{/* end input row */}

            {/* フィルタ（card内部 — TopNのshowTopNSliders && <> に相当） */}
            {showFilterPanel && (
              <div ref={filterPanelRef} style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* 会計区分フィルタ（コンボボックス） */}
                {(() => {
                  const acOptions = [
                    { label: '一般会計', value: acGeneral, setter: setAcGeneral },
                    { label: '特別会計', value: acSpecial, setter: setAcSpecial },
                    { label: '一般・特別', value: acBoth,  setter: setAcBoth    },
                    { label: 'なし',     value: acNone,    setter: setAcNone    },
                  ] as const;
                  const acAllSelected = acGeneral && acSpecial && acBoth && acNone;
                  const selectedLabels = acOptions.filter(o => o.value).map(o => o.label);
                  const acLabel = acAllSelected ? 'すべて' : selectedLabels.length === 1 ? selectedLabels[0] : `選択中 (${selectedLabels.length}/4)`;
                  const chevron = (
                    <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="#aaa"
                      style={{ transform: showAccountDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'block' }}>
                      <path d="M480-360 280-560h400L480-360Z"/>
                    </svg>
                  );
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} ref={accountDropdownRef}>
                      <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', width: 40, flexShrink: 0 }}>会計</span>
                      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                        <button type="button" ref={accountButtonRef}
                          onClick={() => {
                            if (accountButtonRef.current) {
                              const r = accountButtonRef.current.getBoundingClientRect();
                              setAccountDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
                            }
                            setShowAccountDropdown(v => !v);
                          }}
                          style={{ width: '100%', fontSize: CONTROL_SMALL_FONT_PX, border: '1px solid #ddd', borderRadius: 4, padding: '3px 20px 3px 5px', background: '#fafafa', color: acAllSelected ? '#aaa' : '#333', outline: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >{acLabel}</button>
                        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>{chevron}</span>
                        {showAccountDropdown && accountDropdownRect && createPortal(
                          <div style={{ position: 'fixed', top: accountDropdownRect.top, left: accountDropdownRect.left, width: accountDropdownRect.width, zIndex: 9999, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: accountDropdownRect.maxHeight, overflowY: 'auto' }}
                            onMouseDown={e => e.stopPropagation()}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                              <input type="checkbox" checked={acAllSelected}
                                onChange={() => { pendingHistoryAction.current = 'replace'; const v = !acAllSelected; setAcGeneral(v); setAcSpecial(v); setAcBoth(v); setAcNone(v); }}
                                style={{ width: 12, height: 12 }} />
                              <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#333' }}>すべて選択/解除</span>
                            </label>
                            {acOptions.map(({ label, value, setter }) => (
                              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={value}
                                  onChange={() => { pendingHistoryAction.current = 'replace'; setter(v => !v); }}
                                  style={{ width: 12, height: 12 }} />
                                <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#333' }}>{label}</span>
                              </label>
                            ))}
                          </div>,
                          // body直下ではなく検索ボックス(zIndex:20)内へportalし、サイドパネル(zIndex:25)の背面に収める
                          searchBoxRef.current ?? document.body
                        )}
                      </div>
                      {!acAllSelected && (
                        <button type="button" onClick={() => { pendingHistoryAction.current = 'replace'; setAcGeneral(true); setAcSpecial(true); setAcBoth(true); setAcNone(true); }}
                          style={{ fontSize: META_FONT_PX, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })()}
                {/* 省庁フィルタ（複数選択ドロップダウン） */}
                {(() => {
                  const ministryNodes = (graphData?.nodes ?? []).filter(n => n.type === 'ministry').sort((a, b) => b.value - a.value);
                  const allSelected = filterMinistryNames.length === 0;
                  const label = allSelected ? '全省庁' : filterMinistryNames.length === 1 ? filterMinistryNames[0] : `選択中 (${filterMinistryNames.length}/${ministryNodes.length})`;
                  const chevron = (
                    <svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="#aaa"
                      style={{ transform: showMinistryDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'block' }}>
                      <path d="M480-360 280-560h400L480-360Z"/>
                    </svg>
                  );
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} ref={ministryDropdownRef}>
                      <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', width: 40, flexShrink: 0 }}>省庁</span>
                      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                        <button type="button" ref={ministryButtonRef}
                          onClick={() => {
                            if (ministryButtonRef.current) {
                              const r = ministryButtonRef.current.getBoundingClientRect();
                              setMinistryDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.max(120, window.innerHeight - r.bottom - 16) });
                            }
                            setShowMinistryDropdown(v => !v);
                          }}
                          style={{ width: '100%', fontSize: CONTROL_SMALL_FONT_PX, border: '1px solid #ddd', borderRadius: 4, padding: '3px 20px 3px 5px', background: '#fafafa', color: allSelected ? '#aaa' : '#333', outline: 'none', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >{label}</button>
                        <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>{chevron}</span>
                        {showMinistryDropdown && ministryDropdownRect && createPortal(
                          <div style={{ position: 'fixed', top: ministryDropdownRect.top, left: ministryDropdownRect.left, width: ministryDropdownRect.width, zIndex: 9999, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: ministryDropdownRect.maxHeight, overflowY: 'auto' }}
                            onMouseDown={e => e.stopPropagation()}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                              <input type="checkbox" checked={allSelected} onChange={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames([]); }} style={{ width: 12, height: 12 }} />
                              <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#333' }}>すべて選択/解除</span>
                            </label>
                            {ministryNodes.map(n => (
                              <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}>
                                <input type="checkbox"
                                  checked={!allSelected && filterMinistryNames.includes(n.name)}
                                  onChange={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames(prev => prev.includes(n.name) ? prev.filter(m => m !== n.name) : [...prev, n.name]); }}
                                  style={{ width: 12, height: 12 }} />
                                <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#333' }}>{n.name}</span>
                              </label>
                            ))}
                          </div>,
                          // body直下ではなく検索ボックス(zIndex:20)内へportalし、サイドパネル(zIndex:25)の背面に収める
                          searchBoxRef.current ?? document.body
                        )}
                      </div>
                      {!allSelected && (
                        <button type="button" onClick={() => { pendingHistoryAction.current = 'replace'; setFilterMinistryNames([]); }}
                          style={{ fontSize: META_FONT_PX, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })()}
                {/* 事業名・支出先名 テキスト入力（それぞれ独立した正規表現トグル付き） */}
                {([
                  { key: 'project', label: '事業', value: filterProjectName, setValue: setFilterProjectName, useRegex: filterProjectNameRegex, setUseRegex: setFilterProjectNameRegex },
                  { key: 'recipient', label: '支出先', value: filterRecipientName, setValue: setFilterRecipientName, useRegex: filterRecipientNameRegex, setUseRegex: setFilterRecipientNameRegex },
                ] as const).map(({ key, label, value, setValue, useRegex, setUseRegex }) => {
                  const trimmed = value.trim();
                  let regexError = false;
                  if (useRegex && trimmed.length >= 1) {
                    if (trimmed.length > SEARCH_REGEX_MAX_LEN) regexError = true;
                    else { try { new RegExp(trimmed); } catch { regexError = true; } }
                  }
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', width: 40, flexShrink: 0 }}>{label}</span>
                      <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
                        <input
                          type="text"
                          value={value}
                          onChange={e => setValue(e.target.value)}
                          placeholder={useRegex ? '正規表現' : '部分一致'}
                          style={{ flex: 1, minWidth: 0, fontSize: CONTROL_SMALL_FONT_PX, border: `1px solid ${regexError ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 28px 3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                        />
                        <button
                          type="button"
                          title={useRegex ? '正規表現をオフ' : '正規表現で絞り込み'}
                          aria-label={useRegex ? '正規表現をオフ' : '正規表現で絞り込み'}
                          aria-pressed={useRegex}
                          onClick={() => setUseRegex(v => !v)}
                          style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', background: useRegex ? '#1a73e8' : 'transparent', border: 'none', borderRadius: 3, cursor: 'pointer', color: useRegex ? '#fff' : '#888', fontSize: META_FONT_PX, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1, padding: '2px 4px' }}
                        >.*</button>
                      </div>
                      {value && (
                        <button type="button" onClick={() => setValue('')}
                          style={{ fontSize: META_FONT_PX, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })}
                {/* 支出先: 再委託先を含む（OR判定・事業単位）+ 再委託階層（スライダ + 数値 + リピートボタン。） */}
                {(() => {
                  const cur = filterSubcontract ? Math.min(parseInt(filterSubcontract, 10), maxSubcontractDepth) : 1;
                  const commitDepth = (v: number) => {
                    pendingHistoryAction.current = 'replace';
                    const c = Math.max(1, Math.min(maxSubcontractDepth, Math.floor(v)));
                    setFilterSubcontract(c <= 1 ? '' : String(c));
                  };
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 44 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}
                        title="オンにすると、直接支出先または再委託先のどちらかに名前がマッチする事業を残します（支出先ノード自体は隠しません）">
                        <input
                          type="checkbox"
                          checked={filterRecipientIncludeSub}
                          onChange={e => { pendingHistoryAction.current = 'replace'; setFilterRecipientIncludeSub(e.target.checked); }}
                          style={{ width: 12, height: 12, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', whiteSpace: 'nowrap' }}>再委託先</span>
                      </label>
                      <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>階層</span>
                      <input
                        type="range" min={1} max={maxSubcontractDepth} step={1}
                        value={cur}
                        onChange={e => commitDepth(Number(e.target.value))}
                        aria-label="再委託ブロック階層の下限"
                        style={{ flex: 1, minWidth: 0, width: 0 }}
                      />
                      {subDepthEditing ? (
                        <input type="number" autoFocus min={1} max={maxSubcontractDepth} step={1}
                          value={subDepthInput}
                          onChange={e => setSubDepthInput(e.target.value)}
                          onBlur={() => { const v = Number(subDepthInput); if (!isNaN(v) && v >= 1) commitDepth(v); setSubDepthEditing(false); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                          style={{ width: 36, textAlign: 'center', border: '1px solid #ccc', borderRadius: 3, fontSize: CONTROL_SMALL_FONT_PX }}
                        />
                      ) : (
                        <button type="button" onClick={() => { setSubDepthInput(String(cur)); setSubDepthEditing(true); }}
                          title="クリックして直接入力"
                          style={{ color: cur > 1 ? '#333' : '#999', fontSize: CONTROL_SMALL_FONT_PX, background: 'transparent', border: 'none', cursor: 'text', padding: 0, minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                        >{cur}</button>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: 'stretch' }}>
                        {([[1, 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z', '深くする'], [-1, 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z', '浅くする']] as const).map(([delta, path, title]) => {
                          const step = () => commitDepth((filterSubcontract ? parseInt(filterSubcontract, 10) : 1) + delta);
                          return (
                            <button key={delta} type="button" title={title} aria-label={title}
                              {...subDepthRepeat(step)}
                              onClick={(e) => { if (e.detail === 0) step(); }}
                              style={{ flex: 1, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="#555"><path d={path} /></svg>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {/* 予算・支出 テキスト入力 */}
                {([
                  { label: '予算', minText: filterMinBudgetText, maxText: filterMaxBudgetText, setMin: setFilterMinBudgetText, setMax: setFilterMaxBudgetText },
                  { label: '支出', minText: filterMinSpendingText, maxText: filterMaxSpendingText, setMin: setFilterMinSpendingText, setMax: setFilterMaxSpendingText },
                ] as const).map(({ label, minText, maxText, setMin, setMax }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', width: 40, flexShrink: 0 }}>{label}</span>
                    <input type="text" value={minText} onChange={e => setMin(e.target.value)}
                      placeholder="例: 100億、50万"
                      style={{ flex: 1, minWidth: 0, fontSize: CONTROL_SMALL_FONT_PX, border: `1px solid ${parseAmountToYen(minText) !== null || !minText ? '#ddd' : '#e53935'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                    />
                    <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#aaa', flexShrink: 0 }}>~</span>
                    <input type="text" value={maxText} onChange={e => setMax(e.target.value)}
                      placeholder="例: 1兆、500億"
                      style={{ flex: 1, minWidth: 0, fontSize: CONTROL_SMALL_FONT_PX, border: `1px solid ${parseAmountToYen(maxText) !== null || !maxText ? '#ddd' : '#e53935'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                    />
                    {(minText || maxText) && (
                      <button type="button" onClick={() => { setMin(''); setMax(''); }}
                        style={{ fontSize: META_FONT_PX, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                    )}
                  </div>
                ))}
                {/* 政策評価スコアの足きり（0-100）。/quality の総合点・費用対内容・必要性と同じ値。
                    ラベルにマウスを乗せると軸の意味が出る */}
                {([
                  { label: '総合点', title: 'AI政策評価の総合点（0-100）。/quality の総合点と同じ値', range: filterScoreO, set: setFilterScoreO },
                  { label: '費用対', title: '費用対内容（0-100）。金額が活動の規模に見合っているか', range: filterScoreX, set: setFilterScoreX },
                  { label: '必要性', title: '必要性（0-100）。廃止したら誰が具体的に困るか', range: filterScoreN, set: setFilterScoreN },
                ] as const).map(({ label, title, range, set }) => {
                  const bad = (t: string) => {
                    const s = t.trim();
                    if (s === '') return false;
                    const v = Number(s);
                    return !Number.isFinite(v) || v < 0 || v > 100;
                  };
                  return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span title={title} style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#555', width: 40, flexShrink: 0, cursor: 'help' }}>{label}</span>
                      <input type="text" inputMode="numeric" value={range.min}
                        onChange={e => { pendingHistoryAction.current = 'replace'; set({ ...range, min: e.target.value }); }}
                        placeholder="下限 0"
                        style={{ flex: 1, minWidth: 0, fontSize: CONTROL_SMALL_FONT_PX, border: `1px solid ${bad(range.min) ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                      />
                      <span style={{ fontSize: CONTROL_SMALL_FONT_PX, color: '#aaa', flexShrink: 0 }}>~</span>
                      <input type="text" inputMode="numeric" value={range.max}
                        onChange={e => { pendingHistoryAction.current = 'replace'; set({ ...range, max: e.target.value }); }}
                        placeholder="上限 100"
                        style={{ flex: 1, minWidth: 0, fontSize: CONTROL_SMALL_FONT_PX, border: `1px solid ${bad(range.max) ? '#e53935' : '#ddd'}`, borderRadius: 4, padding: '3px 5px', background: '#fafafa', color: '#333', outline: 'none' }}
                      />
                      {(range.min || range.max) && (
                        <button type="button" onClick={() => { pendingHistoryAction.current = 'replace'; set(EMPTY_SCORE_RANGE); }}
                          style={{ fontSize: META_FONT_PX, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>{/* end card */}

          {/* トグルボタン（card外・下部 — TopNの構造と同一） */}
          {(() => {
            return (
              <button
                type="button"
                title={showFilterPanel ? 'フィルタ を隠す' : 'フィルタ を表示'}
                aria-pressed={showFilterPanel}
                onClick={() => setShowFilterPanel(s => !s)}
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.92)', borderTop: 'none', borderLeft: '1px solid #e0e0e0', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', borderRadius: '0 0 4px 4px', cursor: 'pointer', padding: '0 2px', marginTop: -1, userSelect: 'none' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#bbb">
                  <path d={showFilterPanel ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z' : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z'} />
                </svg>
              </button>
            );
          })()}
        </div>{/* end 検索セクション */}

        {/* フィルタ解除ボタン（常に同じ幅を占有し、非フィルタ時は非表示） */}
        <button
          type="button"
          onClick={clearAllFilters}
          title="フィルタを解除"
          aria-label="フィルタを解除"
          aria-hidden={!hasActiveFilters}
          tabIndex={hasActiveFilters ? 0 : -1}
          data-testid={testId('clear-filters')}
          data-pan-disabled
          style={{
            flexShrink: 0, width: FILTER_CLEAR_BUTTON_PX, height: FILTER_CLEAR_BUTTON_PX,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.95)', border: '1px solid #e0e0e0',
            borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            cursor: 'pointer', color: '#666', padding: 0,
            visibility: hasActiveFilters ? 'visible' : 'hidden',
            pointerEvents: hasActiveFilters ? 'auto' : 'none',
          }}
        >
            {/* Material Icons: filter_list_off */}
            <svg xmlns="http://www.w3.org/2000/svg" height={FILTER_CLEAR_ICON_PX} width={FILTER_CLEAR_ICON_PX} viewBox="0 -960 960 960" fill="currentColor">
              <path d="M791-55 55-791l57-57 736 736-57 57ZM633-440l-80-80h167v80h-87ZM433-640l-80-80h487v80H433Zm-33 400v-80h160v80H400ZM240-440v-80h166v80H240ZM120-640v-80h86v80h-86Z"/>
            </svg>
          </button>

        </div>{/* end Row 1 flex */}

        {/* Dropdown */}
        {showSearchResults && searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, minWidth: 0, maxWidth: searchMaxWidth, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20 }}>
            {/* Count header */}
            <div style={{ padding: '5px 10px', fontSize: META_FONT_PX, color: '#999', borderBottom: '1px solid #f0f0f0' }}>
              {searchResults.length}件{searchTotalPages > 1 ? `（${searchPage + 1} / ${searchTotalPages} ページ）` : ''}
            </div>
            {/* Scrollable list */}
            <div ref={searchDropdownRef} style={{ maxHeight: searchDropdownMaxH, overflowY: 'auto' }}>
              {searchPagedResults.map((node, i) => (
                <button
                  key={node.id}
                  data-testid={testId('search-result')}
                  type="button"
                  onClick={() => { handleSearchSelect(node.id); setSearchCursorIndex(-1); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: SEARCH_RESULT_GAP_PX, padding: `${SEARCH_RESULT_PAD_Y_PX}px ${SEARCH_RESULT_PAD_X_PX}px`, background: i === searchCursorIndex ? '#e8f0fe' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { if (i !== searchCursorIndex) e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i === searchCursorIndex ? '#e8f0fe' : 'transparent'; }}
                >
                  <span style={{ width: SEARCH_RESULT_SWATCH_PX, height: SEARCH_RESULT_SWATCH_PX, marginTop: Math.max(2, Math.round(PANEL_LIST_NAME_FONT_PX * 0.35)), borderRadius: 2, flexShrink: 0, background: node.budgetValue !== undefined ? `linear-gradient(to right, ${TYPE_COLORS['project-budget']} 44%, ${TYPE_COLORS['project-spending']} 56%)` : getNodeColor(node) }} />
                  <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: SEARCH_RESULT_GAP_PX, rowGap: 2 }}>
                    <span title={node.name} style={{ flex: '1 1 160px', minWidth: 0, fontSize: PANEL_LIST_NAME_FONT_PX, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'baseline', gap: SEARCH_RESULT_GAP_PX, fontSize: PANEL_LIST_VALUE_FONT_PX, color: '#999', whiteSpace: 'normal', overflowWrap: 'anywhere', flex: '0 0 100%', minWidth: 0, textAlign: 'right' }}>
                      {node.projectId != null && <span style={{ fontSize: META_FONT_PX, color: '#bbb', whiteSpace: 'nowrap' }}>PID:{node.projectId}</span>}
                      <span>{node.budgetValue !== undefined
                        ? <>予{formatYen(node.budgetValue)} / 支{formatYen(node.value)}</>
                        : formatYen(node.value)
                      }</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {/* Pagination footer */}
            {searchTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderTop: '1px solid #f0f0f0' }}>
                <button type="button" onClick={() => { setSearchPage(p => Math.max(p - 1, 0)); setSearchCursorIndex(-1); }} disabled={searchPage === 0}
                  style={{ fontSize: META_FONT_PX, padding: '2px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: 'transparent', cursor: searchPage === 0 ? 'default' : 'pointer', color: searchPage === 0 ? '#ccc' : '#555' }}>‹ 前へ</button>
                <button type="button" onClick={() => { setSearchPage(p => Math.min(p + 1, searchTotalPages - 1)); setSearchCursorIndex(-1); }} disabled={searchPage === searchTotalPages - 1}
                  style={{ fontSize: META_FONT_PX, padding: '2px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: 'transparent', cursor: searchPage === searchTotalPages - 1 ? 'default' : 'pointer', color: searchPage === searchTotalPages - 1 ? '#ccc' : '#555' }}>次へ ›</button>
              </div>
            )}
          </div>
        )}
        {/* No results */}
        {showSearchResults && meetsSearchMinLength(debouncedQuery.trim()) && searchResults.length === 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, minWidth: 0, maxWidth: searchMaxWidth, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: `${scaleSize(10)}px ${scaleSize(12)}px`, fontSize: PANEL_META_FONT_PX, color: '#999', zIndex: 20 }}>
            該当なし
          </div>
        )}
      </div>


      {/* 狭幅では TopN・オフセット操作を画面下部へ（クラスタには入れない） */}
      {isCompactWidth && offsetControlsBlock}

      {/* 右上クラスタ: ［ツール - 探索履歴 - 表示設定 - 年度 - ページ切替］。
          rs-vis の並び（ツール → 年度 → メニュー）に合わせつつ、marumie 固有の
          探索履歴と表示設定(⋮)を年度コンボの左に置く。
          AIチャットパネル展開時は rightControlsOffset ぶん左へ退避する。
          スマホ幅では表示設定とページ切替だけを残す（ツール・履歴・年度は
          それぞれ画面下部と設定ダイアログへ移す）。 */}
      <div
        data-pan-disabled="true"
        style={{
          position: 'absolute', top: 12, right: 12 + rightControlsOffset, zIndex: 200,
          display: 'flex', gap: 8, alignItems: 'flex-start',
          transition: isResizingAiPanel ? 'none' : 'right 0.2s ease',
        }}
      >
        {!isCompactWidth && offsetControlsBlock}

        {/* 探索履歴・発見メモ（IndexedDB のみ・サーバ送信なし）。
            公開ミラーでは NEXT_PUBLIC_FEATURE_EXPLORATION_HISTORY 未設定で非表示 */}
        {FEATURE_EXPLORATION_HISTORY && !isCompactWidth && (
          <ExplorationHistory
            getSnapshot={getExplorationSnapshot}
            onApply={applyExplorationEntry}
            // 他ページは text-xs(12px)。フォントスケール機能があるので倍率だけ合わせる
            fontPx={scaleFont(12)}
          />
        )}

        {/* 表示設定(⋮)。ダイアログはこの要素を基準に開く */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
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
            <div id="sankey-topn-settings" role="dialog" aria-label="表示設定" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowSettings(false); }} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 19, background: '#fff', border: '1px solid #ddd', borderRadius: 6, padding: '12px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', fontSize: CONTROL_SMALL_FONT_PX_DEFAULT, minWidth: 240, maxWidth: 'calc(100vw - 24px)', display: 'flex', flexDirection: 'column', gap: 10, colorScheme: 'light', color: '#333' }}>
              {/* スマホ幅: 検索ボックスに隠れるため移動した年度選択 */}
              {isCompactWidth && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#555', fontWeight: 600 }}>年度</span>
                  <select
                    data-testid={testId('year-select-settings')}
                    value={year}
                    onChange={e => handleYearChange(e.target.value as '2024' | '2025')}
                    style={{ fontSize: CONTROL_SMALL_FONT_PX_DEFAULT, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
                    data-pan-disabled
                  >
                    <option value="2025">2025年度</option>
                    <option value="2024">2024年度</option>
                  </select>
                </div>
              )}
              {/* スマホ幅: オフセットパネルから移動したTopNスライダー */}
              {isCompactWidth && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#555', fontWeight: 600 }}>表示件数（TopN）</span>
                  {topNSlidersFragment}
                </div>
              )}
              {/* スマホ幅: 左下から移動した基準フォントサイズ調整 */}
              {isCompactWidth && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8, borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#555', fontWeight: 600 }}>文字サイズ</span>
                  {fontSizeControlsFragment}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showLabels} onChange={e => { pendingHistoryAction.current = 'replace'; setShowLabels(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>すべてのノードラベルを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAggProject} onChange={e => { pendingHistoryAction.current = 'replace'; setShowAggProject(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>事業の集約ノードを表示</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={showAggRecipient} onChange={e => { pendingHistoryAction.current = 'replace'; setShowAggRecipient(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>支出先の集約ノードを表示</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#555' }}>事業ノードの並び順:</span>
                <select value={projectSortBy} onChange={e => { pendingHistoryAction.current = 'replace'; setProjectSortBy(e.target.value as 'budget' | 'spending'); }} style={{ fontSize: CONTROL_SMALL_FONT_PX_DEFAULT, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }} data-pan-disabled>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={filterOnMinistryClick} onChange={e => { pendingHistoryAction.current = 'replace'; setFilterOnMinistryClick(e.target.checked); }} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                <span style={{ color: '#555' }}>省庁ノード選択でフィルタ</span>
              </label>
            </div>
          </>
        )}
        </div>

        {/* 年度切替（rs-vis の並びに合わせて、ツール類の右・メニューの左）。
            スマホ幅では検索ボックスに隠れるため設定ダイアログ側に置く */}
        {!isCompactWidth && (
          <YearSelect
            value={year}
            onChange={y => handleYearChange(y as '2024' | '2025')}
            years={[2025, 2024]}
            theme="light"
            // 他ページは text-xs(12px)。フォントスケール機能があるので倍率だけ合わせる
            fontPx={scaleFont(12)}
            testId={testId('year-select')}
          />
        )}

        <PageNavMenu current="/sankey-svg" theme="light" />
      </div>

      {/* Zoom controls — bottom right (sankey2 style) */}
      <div style={{ position: 'absolute', bottom: 12, right: 12 + rightControlsOffset, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4, transition: isResizingAiPanel ? 'none' : 'right 0.2s ease' }}>
        {/* スクロールモード切替ボタン（狭幅では2本指パンで代替できるため非表示） */}
        {!isCompactWidth && (
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
        )}
        {/* + / vertical slider / -（狭幅ではピンチズームで代替できるため非表示） */}
        {!isCompactWidth && (
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Material Icons: add */}
          <button data-testid={testId('zoom-in')} aria-label="ズームイン" onClick={() => applyZoom(1.5)} title="ズームイン" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
          <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="range"
              aria-label="ズーム倍率"
              min={Math.log10(Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER))}
              max={Math.log10(Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER))}
              step={0.01}
              value={Math.log10(Math.max(Math.max(ZOOM_MIN_ABS, baseZoom * ZOOM_MIN_MULTIPLIER), Math.min(Math.min(ZOOM_MAX_ABS, baseZoom * ZOOM_MAX_MULTIPLIER), zoom)))}
              onChange={e => { const newK = Math.pow(10, parseFloat(e.target.value)); applyZoom(newK / zoom); }}
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
              title={`Zoom: ${Math.round(zoom / baseZoom * 100)}%`}
            />
          </div>
          {/* Material Icons: remove */}
          <button data-testid={testId('zoom-out')} aria-label="ズームアウト" onClick={() => applyZoom(1 / 1.5)} title="ズームアウト" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z"/></svg>
          </button>
        </div>
        )}
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
          <button data-testid={testId('reset-viewport')} aria-label="全体表示" onClick={resetViewport} title="全体表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z"/></svg>
          </button>
        </div>
        {/* 関連ノードのみ表示トグル — Pin状態のときのみ表示 */}
        {selectedNode && (
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {/* Material Icons: account_tree — 関連ノードのみ表示トグル */}
            <button
              data-testid={testId('focus-related-toggle')}
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

      {/* AIチャットパネル（右側）— BYOK（使用者キー）は全環境で使える。
          モード未設定時はパネル内にキー登録の導線を出す。
          公開ミラーでは NEXT_PUBLIC_FEATURE_AI_CHAT 未設定で非表示 */}
      {FEATURE_AI_CHAT && (
      <AiChatPanel
        open={showAiChat}
        onToggle={() => setShowAiChat(v => !v)}
        messages={aiChatMessages}
        sending={aiChatSending}
        progress={aiChatProgress}
        onSend={handleAiChatSend}
        onApplyResult={applyAiChatResult}
        onClear={handleNewChatSession}
        sessions={chatSessions}
        activeSessionId={chatSessionId}
        onSwitchSession={handleSwitchChatSession}
        onDeleteSession={handleDeleteChatSession}
        onRenameSession={handleRenameChatSession}
        onSaveReport={handleSaveReportMemo}
        width={effectiveAiPanelWidth}
        isCompactWidth={isCompactWidth}
        onResizeStart={e => {
          aiPanelResizeRef.current = { startX: e.clientX, startW: aiPanelWidth };
          setIsResizingAiPanel(true);
        }}
        isResizing={isResizingAiPanel}
        onResetWidth={() => setAiPanelWidth(SIDE_PANEL_WIDTH_DEFAULT)}
        mode={aiChatMode}
        byokModel={byokSettings?.model ?? null}
        defaultByokModel={DEFAULT_BYOK_MODEL}
        onSaveByok={handleSaveByok}
        onDeleteByok={handleDeleteByok}
        onTestByok={testOpenRouterKey}
      />
      )}

      {/* 品質スコア詳細ダイアログ（/quality と共通コンポーネント）
          containerRef 外の document.body に portal で出し、背面サンキー図の wheel/pan ハンドラに
          イベントが伝播しないようにする（そうしないとダイアログ内スクロールで背面が動く） */}
      {scoreDialogItem && createPortal(
        <ScoreDetailDialog
          item={scoreDialogItem}
          onClose={() => setScoreDialogItem(null)}
          year={year}
        />,
        document.body,
      )}
    </div>
  );
}
