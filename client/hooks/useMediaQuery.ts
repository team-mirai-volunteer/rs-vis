'use client';

/**
 * CSS メディアクエリの真偽を React state で追う。SSR と初回描画では false（レイアウトのズレを避けるため
 * クライアントで一致した時点で true になる）。
 *
 * 用途: 640px 未満（Tailwind の `sm` 未満 = スマホ）でサイドパネルをボトムシートにする、
 * 図のフィット計算からパネル幅を除く、など CSS だけでは切り替えられない振る舞いの分岐。
 * 見た目だけの分岐は `sm:` のクラスで書き、このフックは使わない。
 */
import { useEffect, useState } from 'react';

/** Tailwind の `sm` ブレークポイント（640px）未満 */
export const NARROW_QUERY = '(max-width: 639px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** スマホ幅（640px 未満）か */
export const useIsNarrow = () => useMediaQuery(NARROW_QUERY);
