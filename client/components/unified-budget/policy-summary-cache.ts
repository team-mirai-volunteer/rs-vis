'use client';

/**
 * /api/policy-summary（年度ぶんの政策評価サマリ）の取得とキャッシュ。
 * サイドパネルの事業詳細（UnifiedProjectSections）と、項・目などの配下加重平均（UnifiedAggregateEvaluation）で共用する。
 * 取得失敗・404 は null をキャッシュし再試行しない。
 */

import { useEffect, useState } from 'react';
import type { PolicySummaryResponse } from '@/app/api/policy-summary/route';

const policyCache = new Map<string, PolicySummaryResponse | null>();

/** キー付きの遅延取得。undefined = 取得中、null = 無し/失敗。key が null なら取得しない（undefined のまま） */
export function useCached<T>(cache: Map<string, T | null>, key: string | null, url: string, extract: (data: unknown) => T | null): T | null | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (key === null || cache.has(key)) return;
    let cancelled = false;
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        cache.set(key, data == null ? null : extract(data));
      })
      .catch(() => cache.set(key, null))
      .finally(() => {
        if (!cancelled) force(v => v + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, key, url, extract]);
  return key === null ? undefined : cache.get(key);
}

const extractPolicy = (d: unknown) => d as PolicySummaryResponse;

/** RSシート年度の政策評価サマリ。null を渡すと取得しない（スコアの絞り込みが無いうちは読まない、など） */
export function usePolicySummary(rsSheetYear: number | string | null): PolicySummaryResponse | null | undefined {
  const year = rsSheetYear === null ? null : String(rsSheetYear);
  return useCached(policyCache, year, `/api/policy-summary?year=${year}`, extractPolicy);
}
