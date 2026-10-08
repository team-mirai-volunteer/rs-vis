'use client';

/**
 * ポインタのそばに出すフロートの left/top を返す。フロート自身と親要素（offsetParent）の大きさを測り、
 * 右 → 左 → 下 → 上の順で、ポインタを隠さない置き場所を選ぶ（計算は app/lib/float-position.ts）。
 * 初回は大きさが 0 なので、測れるまでは右に出す。
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { floatPlacement, type FloatPlacement } from '@/app/lib/float-position';

export function useFloatPosition(ref: RefObject<HTMLElement | null>, x: number, y: number, sideOffsetY: number): FloatPlacement {
  const [size, setSize] = useState({ width: 0, height: 0, parentWidth: Number.POSITIVE_INFINITY, parentHeight: Number.POSITIVE_INFINITY });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const parent = el.offsetParent as HTMLElement | null;
      setSize({ width: el.offsetWidth, height: el.offsetHeight, parentWidth: parent?.clientWidth ?? window.innerWidth, parentHeight: parent?.clientHeight ?? window.innerHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.offsetParent) observer.observe(el.offsetParent);
    return () => observer.disconnect();
  }, [ref]);
  return floatPlacement({ x, y, ...size, sideOffsetY });
}
