'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** 狭幅（タッチ端末想定）での既定値。保存済み設定がある場合は使わない。
      SSR とのハイドレーション不整合を避けるため、初期 state ではなく復元 effect 内で適用する */
  compactOptions?: { maxWidth: number; defaultValue: number },
): [number, Dispatch<SetStateAction<number>>] {
  const [baseFontPx, setBaseFontPx] = useState(defaultValue);
  // 復元・自動既定値の適用では localStorage に書かない（画面幅由来の値を恒久化しないため）。
  // ユーザーがコントロールから変更したときだけ true になる。
  const userChangedRef = useRef(false);

  const setBaseFontPxByUser: Dispatch<SetStateAction<number>> = useCallback(v => {
    userChangedRef.current = true;
    setBaseFontPx(v);
  }, []);

  // Restore font size from localStorage on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
          setBaseFontPx(Math.min(max, Math.max(min, parsed)));
          return;
        }
      }
      if (compactOptions && window.innerWidth <= compactOptions.maxWidth) {
        setBaseFontPx(Math.min(max, Math.max(min, compactOptions.defaultValue)));
      }
    } catch {
      // localStorage unavailable (private browsing etc.) — ignore
    }
    // 初回マウント時のみ復元する（min/max/storageKey の変化では再実行しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist font size to localStorage on user-initiated change
  useEffect(() => {
    if (!userChangedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, String(baseFontPx));
    } catch {
      // ignore
    }
  }, [storageKey, baseFontPx]);

  return [baseFontPx, setBaseFontPxByUser];
}
