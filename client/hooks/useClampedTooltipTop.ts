'use client';

/**
 * 図の中に absolute で置くツールチップの縦位置を、親（offsetParent）の下端からはみ出さないよう抑える。
 * 高さは中身（非同期に読み込む契約の概要など）で変わるので、ResizeObserver で追う。
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

const TOP_MARGIN = 4;
const BOTTOM_MARGIN = 8;

export function useClampedTooltipTop(ref: RefObject<HTMLElement | null>, desiredTop: number): number {
  const [size, setSize] = useState({ height: 0, parentHeight: Number.POSITIVE_INFINITY });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({
      height: el.offsetHeight,
      parentHeight: (el.offsetParent as HTMLElement | null)?.clientHeight ?? window.innerHeight,
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return Math.max(TOP_MARGIN, Math.min(desiredTop, size.parentHeight - size.height - BOTTOM_MARGIN));
}
