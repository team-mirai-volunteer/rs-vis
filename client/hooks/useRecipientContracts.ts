'use client';

/**
 * 支出先の契約の概要（/api/recipient-contracts）をホバー中だけ取得する。
 * ノードの上をポインタが横切るたびに叩かないよう、同じ対象に HOVER_DELAY_MS とどまってから取りに行く。
 * 結果は年度・名前・事業の組でキャッシュする。
 */
import { useEffect, useState } from 'react';
import type { RecipientContractsResponse } from '@/app/lib/recipient-contracts';
import { RECIPIENT_CONTRACTS_MAX_PIDS } from '@/app/lib/recipient-contracts';

const HOVER_DELAY_MS = 150;
const cache = new Map<string, RecipientContractsResponse | null>();

/**
 * @param year RS シート年度。null なら取得しない
 * @param name 支出先名
 * @param pids 支出元の事業（金額の大きい順）。先頭から上限件数だけ使う
 * @returns undefined = 取得前・取得中、null = 取得できない、それ以外 = 結果
 */
export function useRecipientContracts(year: number | string | null, name: string | null, pids: readonly (string | number)[]): RecipientContractsResponse | null | undefined {
  const usable = year !== null && !!name && pids.length > 0;
  const key = usable ? `${year}|${name}|${pids.slice(0, RECIPIENT_CONTRACTS_MAX_PIDS).join(',')}` : null;
  const [, force] = useState(0);
  useEffect(() => {
    if (key === null || cache.has(key)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ year: String(year), name: name!, pids: pids.slice(0, RECIPIENT_CONTRACTS_MAX_PIDS).join(',') });
      fetch(`/api/recipient-contracts?${qs}`)
        .then(res => (res.ok ? res.json() as Promise<RecipientContractsResponse> : null))
        .then(data => { cache.set(key, data); })
        .catch(() => { cache.set(key, null); })
        .finally(() => { if (!cancelled) force(v => v + 1); });
    }, HOVER_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // key が year / name / pids を含むので key だけで十分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? undefined : cache.get(key);
}
