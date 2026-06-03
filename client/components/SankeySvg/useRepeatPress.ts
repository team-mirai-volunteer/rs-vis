'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';

// 複数の useRepeatPress インスタンスが同時に押下される場合に備え、参照カウントで
// 管理し、最初の抑止開始時に既存の body インラインスタイルを退避、最後の解除時に復元する。
const selectionSuppressionState = {
  depth: 0,
  userSelect: '',
  webkitUserSelect: '',
  webkitTouchCallout: '',
};

/** 押下中だけ全体のテキスト選択/コールアウト（モバイルの長押し）を抑止する */
function setSelectionSuppressed(on: boolean) {
  if (typeof document === 'undefined') return;
  const b = document.body;
  if (on) {
    if (selectionSuppressionState.depth++ === 0) {
      selectionSuppressionState.userSelect = b.style.userSelect;
      selectionSuppressionState.webkitUserSelect = b.style.getPropertyValue('-webkit-user-select');
      selectionSuppressionState.webkitTouchCallout = b.style.getPropertyValue('-webkit-touch-callout');
    }
    b.style.userSelect = 'none';
    b.style.setProperty('-webkit-user-select', 'none');
    b.style.setProperty('-webkit-touch-callout', 'none');
  } else {
    if (selectionSuppressionState.depth === 0 || --selectionSuppressionState.depth > 0) return;
    b.style.userSelect = selectionSuppressionState.userSelect;
    if (selectionSuppressionState.webkitUserSelect) b.style.setProperty('-webkit-user-select', selectionSuppressionState.webkitUserSelect);
    else b.style.removeProperty('-webkit-user-select');
    if (selectionSuppressionState.webkitTouchCallout) b.style.setProperty('-webkit-touch-callout', selectionSuppressionState.webkitTouchCallout);
    else b.style.removeProperty('-webkit-touch-callout');
    (typeof window !== 'undefined' ? window.getSelection?.() : null)?.removeAllRanges();
  }
}

export interface RepeatPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: SyntheticEvent) => void;
}

/**
 * 押し続けで step() を繰り返し実行するボタン用のイベントハンドラを生成するフック。
 * 返り値の関数に step を渡すと、その step を発火する一連のハンドラ（pointer/contextmenu）を返す。
 * 最初の発火後 400ms で連続実行（150ms 間隔）へ移行し、押下中はネイティブの
 * テキスト選択・コンテキストメニュー（モバイルの長押し）を抑止する。
 */
export function useRepeatPress(): (step: () => void, opts?: { stopPropagation?: boolean }) => RepeatPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); clearInterval(timerRef.current); timerRef.current = null; }
    setSelectionSuppressed(false);
  }, []);
  useEffect(() => {
    const onBlur = () => stop();
    window.addEventListener('blur', onBlur);
    return () => { stop(); window.removeEventListener('blur', onBlur); };
  }, [stop]);
  return useCallback((step: () => void, opts?: { stopPropagation?: boolean }): RepeatPressHandlers => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (opts?.stopPropagation) e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      stop();
      setSelectionSuppressed(true);
      step();
      timerRef.current = setTimeout(() => { timerRef.current = setInterval(step, 150); }, 400);
    },
    onPointerUp: (e) => { if (opts?.stopPropagation) e.stopPropagation(); stop(); },
    onPointerLeave: () => stop(),
    onPointerCancel: () => stop(),
    onContextMenu: (e) => e.preventDefault(),
  }), [stop]);
}
