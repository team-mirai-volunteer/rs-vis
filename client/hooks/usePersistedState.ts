'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * 状態をlocalStorageで永続化する汎用フック（useTopNSettingsと同じ方針: 初回マウント時に
 * 読み込み、更新のたびに書き込む）。SSR時はデフォルト値のまま描画し、マウント後に
 * localStorageの値があれば差し替える（初回レンダーとの不一致はハイドレーション後の
 * 1回だけなので実害は小さい）。
 *
 * 書き込みはstateのuseEffectで行う（stateのupdater関数の中でlocalStorage.setItemを
 * 呼ばない）。Reactの開発時StrictModeはupdater関数を2回呼ぶことがあり、副作用を
 * updater内に置くと書き込みが重複したり、ハイドレーション未完了の初期値を誤って
 * 保存してしまう恐れがあるため。
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setState(JSON.parse(raw) as T);
    } catch {
      // 壊れた値・アクセス不可（プライベートモード等）は無視してデフォルト値のまま
    }
    setHydrated(true);
    // key変更時の再読み込みは想定しない（呼び出し側は固定キーで使う）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // ハイドレーション（localStorageからの読み込み）が終わるまでは書き込まない。
    // 先に書いてしまうと、まだ読み込んでいないデフォルト値で既存の保存値を上書きしてしまう
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // 保存できなくても致命的ではないので無視
    }
  }, [key, state, hydrated]);

  return [state, setState];
}
