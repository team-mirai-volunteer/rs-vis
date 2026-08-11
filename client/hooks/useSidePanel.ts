'use client';

/**
 * サイドパネル（サンキー左ノード詳細・/subcontracts 右詳細）の chrome 状態管理フック。
 *
 * 幅・折りたたみ・リサイズドラッグ・ダブルクリック既定復帰・ビューポートクランプをまとめる。
 * 表示（JSX・スタイル）は client/components/SidePanelChrome.tsx に委譲する（本フックは状態のみ）。
 *
 * 幅系の既定値（400/200/800）と、実効幅クランプ時の反対側への最低余白(48px)は、
 * 元々 app/sankey-svg/page.tsx にローカル定義されていたものをここへ一元化した。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export const SIDE_PANEL_WIDTH_DEFAULT = 400;
export const SIDE_PANEL_WIDTH_MIN = 200;
export const SIDE_PANEL_WIDTH_MAX = 800;
// 実効幅クランプ時に反対側（サンキーなら地図、subcontractsなら図キャンバス）へ最低限残す
// 余白(px)。狭いビューポートでパネルが画面を埋め尽くすのを防ぐ。
export const SIDE_PANEL_VIEWPORT_RESERVE_PX = 48;

export interface UseSidePanelOptions {
  /** パネルの画面上の位置。リサイズドラッグの符号（幅が増減する方向）に影響する */
  side: 'left' | 'right';
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /**
   * 実効幅クランプに使うビューポート幅(px)。呼び出し側が既に幅を state で持っている場合
   * （サンキーの svgWidth 等）はそれを渡すと二重計測を避けられる。
   * 省略時は window.innerWidth を自前で追跡する（resize リスナ）。
   */
  viewportWidth?: number;
  initialCollapsed?: boolean;
}

export interface UseSidePanelResult {
  /** ユーザーがドラッグで設定した生の幅（クランプ前） */
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
  /** ビューポート幅でクランプ済みの実効幅。描画にはこちらを使う */
  effectiveWidth: number;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  toggleCollapsed: () => void;
  isResizing: boolean;
  /** リサイズハンドルの onMouseDown にそのまま渡す */
  onResizeStart: (e: React.MouseEvent) => void;
  /** 幅を既定値へ戻す（ダブルクリックハンドラにそのまま渡す） */
  resetWidth: () => void;
}

export function useSidePanel(options: UseSidePanelOptions): UseSidePanelResult {
  const {
    side,
    defaultWidth = SIDE_PANEL_WIDTH_DEFAULT,
    minWidth = SIDE_PANEL_WIDTH_MIN,
    maxWidth = SIDE_PANEL_WIDTH_MAX,
    viewportWidth,
    initialCollapsed = false,
  } = options;

  const [width, setWidth] = useState(defaultWidth);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // viewportWidth が渡されない呼び出し側向けに window.innerWidth を自前追跡
  const [trackedViewportWidth, setTrackedViewportWidth] = useState<number>(1200);
  useEffect(() => {
    if (viewportWidth !== undefined) return;
    const onResize = () => setTrackedViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewportWidth]);

  const effectiveViewportWidth = viewportWidth ?? trackedViewportWidth;
  const effectiveWidth = useMemo(() => {
    const maxForViewport = Math.max(0, effectiveViewportWidth - SIDE_PANEL_VIEWPORT_RESERVE_PX);
    const minForViewport = Math.min(minWidth, maxForViewport);
    return Math.min(maxForViewport, Math.max(minForViewport, width));
  }, [width, effectiveViewportWidth, minWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // アンカーは描画されている実効幅（クランプ後）。生の width を使うと、ビューポートで
    // クランプされている間は「見えない差分」を跨ぐまでドラッグが効かないデッドゾーンになる
    resizeRef.current = { startX: e.clientX, startW: effectiveWidth };
    setIsResizing(true);
  }, [effectiveWidth]);

  // ドラッグ中のみ window にリスナを張る。アンマウントやドラッグ終了時に確実に剥がす
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (ev: MouseEvent) => {
      const s = resizeRef.current;
      if (!s) return;
      const delta = ev.clientX - s.startX;
      const raw = side === 'left' ? s.startW + delta : s.startW - delta;
      setWidth(Math.max(minWidth, Math.min(maxWidth, raw)));
    };
    const onUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, side, minWidth, maxWidth]);

  const resetWidth = useCallback(() => setWidth(defaultWidth), [defaultWidth]);
  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), []);

  return {
    width, setWidth, effectiveWidth,
    collapsed, setCollapsed, toggleCollapsed,
    isResizing, onResizeStart, resetWidth,
  };
}
