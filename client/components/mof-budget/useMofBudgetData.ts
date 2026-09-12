'use client';

/**
 * MOF 予算全体ビューのデータ取得。
 *
 * 年度セレクタと `?year=` の両方から取得が走るため、素朴に fetch すると
 * 年度を続けて変えたときに応答の到着順が入れ替わり、最後に選んだ年度と
 * 違うものが表示される。世代番号で古い応答を捨てる。
 *
 * 2つのビューで同じ挙動にしたいので、ここに1本化して両ページから使う。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useMofBudgetData<T extends { metadata: { fiscalYear: number } }>(
  buildUrl: (year: number | null) => string,
  initialYear: number | null
) {
  const [data, setData] = useState<T | null>(null);
  const [year, setYear] = useState<number | null>(initialYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 最後に投げた取得の世代。応答が古ければ捨てる */
  const generation = useRef(0);
  /**
   * 最後に要求した年度。
   * `buildUrl` が変わった（絞り込み条件を変えた）ときの取り直しで、
   * URL の初期値ではなく画面で選んでいる年度を使うために持つ。
   */
  const requestedYear = useRef<number | null>(initialYear);
  /**
   * 最後に取りに行った URL。
   *
   * 「同じものを二度取りに行かない」の判定にこれを使う。年度だけで見ると、
   * 年度が確定したあとに予算種別や TopN を変えても取り直しが起きない
   * （年度は同じままなので「読み込み済み」と判定されてしまう）。
   */
  const lastUrl = useRef<string | null>(null);

  const fetchData = useCallback(
    async (target: number | null) => {
      const current = generation.current + 1;
      generation.current = current;
      requestedYear.current = target;
      const url = buildUrl(target);
      lastUrl.current = url;
      setLoading(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result: T = await response.json();
        if (generation.current !== current) return; // 後発の取得に追い越された
        // 年度を省いて投げた場合、応答で確定した年度を含む形を「取得済み」とする。
        // これをしないと、確定した年度が URL に書き戻された直後に同じものを取り直す
        lastUrl.current = buildUrl(result.metadata.fiscalYear);
        setData(result);
        setYear(result.metadata.fiscalYear);
        setError(null);
      } catch (err) {
        if (generation.current !== current) return;
        console.error('Failed to fetch data:', err);
        setError((err as Error).message);
      } finally {
        if (generation.current === current) setLoading(false);
      }
    },
    [buildUrl]
  );

  // URL の年度が変わったら、それを現在の年度として扱う
  useEffect(() => {
    requestedYear.current = initialYear;
  }, [initialYear]);

  // 初回と、URL の年度・絞り込み条件が変わったときに取り直す。
  //
  // 年度の指定が無いと既定年度を読み、その結果を URL に書き戻す。すると
  // `initialYear` が変わって同じものをもう一度取りに行くので、
  // これから投げる URL が最後に投げたものと同じなら取得しない。
  useEffect(() => {
    const target = initialYear ?? requestedYear.current;
    if (buildUrl(target) === lastUrl.current) return;
    fetchData(target);
  }, [buildUrl, fetchData, initialYear]);

  return { data, year, loading, error, fetchData };
}
