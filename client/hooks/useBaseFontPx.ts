'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * 基準フォントサイズ（baseFontPx）を localStorage に永続化する状態フック。
 *
 * サンキー（app/sankey-svg/page.tsx）の現行方式（URLパラメータには含めず localStorage のみで保持）を
 * そのまま踏襲する。ページごとに storageKey を分けて使うこと。
 */
export function useBaseFontPx(
  storageKey: string,
  defaultValue: number,
  min: number,
  max: number,
): [number, Dispatch<SetStateAction<number>>] {
  const [baseFontPx, setBaseFontPx] = useState(defaultValue);

  // Restore font size from localStorage on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
          setBaseFontPx(Math.min(max, Math.max(min, parsed)));
        }
      }
    } catch {
      // localStorage unavailable (private browsing etc.) — ignore
    }
    // 初回マウント時のみ復元する（min/max/storageKey の変化では再実行しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist font size to localStorage on change
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(baseFontPx));
    } catch {
      // ignore
    }
  }, [storageKey, baseFontPx]);

  return [baseFontPx, setBaseFontPx];
}
