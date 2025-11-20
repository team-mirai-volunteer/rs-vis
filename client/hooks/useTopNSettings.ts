'use client';

import { useState, useEffect } from 'react';
import type { TopNValue, TopNSettingsKey } from '@/types/sankey';

/**
 * TopN設定をLocalStorageで管理するカスタムフック
 * @param key LocalStorageのキー
 * @param defaultValue デフォルト値
 * @returns [現在の値, 更新関数]
 */
export function useTopNSettings(
  key: TopNSettingsKey,
  defaultValue: TopNValue = 10
): [TopNValue, (value: TopNValue) => void] {
  const [topN, setTopNState] = useState<TopNValue>(defaultValue);
  const [isInitialized, setIsInitialized] = useState(false);

  // 初回マウント時にLocalStorageから読み込み
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = Number(saved);
        if ([5, 10, 20, 50].includes(parsed)) {
          setTopNState(parsed as TopNValue);
        }
      }
      setIsInitialized(true);
    }
  }, [key]);

  // 値更新時にLocalStorageに保存
  const setTopN = (value: TopNValue) => {
    setTopNState(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  };

  return [topN, setTopN];
}
