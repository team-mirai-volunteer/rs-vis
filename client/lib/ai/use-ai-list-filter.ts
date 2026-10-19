'use client';

/**
 * 一覧型のページ（評価一覧・委託構造・バブル図）で AI ナビの結果を受け取り、絞り込み状態として持つフック。
 *
 * 行で判定できる条件はすぐ当て、判定できない条件（支出先名・支出額・再委託・会計区分）があれば
 * サーバー（/api/sankey/matches）で評価して事業 ID の集合に置き換える。その間はチップに「適用中」を出す。
 */
import { useCallback, useRef, useState } from 'react';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';
import { useAiResultHandler } from '@/client/lib/ai/result-handler';
import { aiListFilterFrom, resolveAiListFilterPids, type AiListFilter } from '@/client/lib/ai/list-filter';

export function useAiListFilter(label: '図' | '一覧' = '一覧'): { aiFilter: AiListFilter | null; clearAiFilter: () => void } {
  const [aiFilter, setAiFilter] = useState<AiListFilter | null>(null);
  // 連続して結果が来たとき、古い評価結果で新しい条件を上書きしない
  const latest = useRef(0);

  const apply = useCallback(async (result: SankeyChatResult) => {
    const seq = ++latest.current;
    const base = aiListFilterFrom(result);
    if (base.unsupported.length === 0) { setAiFilter(base); return; }
    setAiFilter({ ...base, resolving: true });
    const pids = await resolveAiListFilterPids(result.query);
    if (seq !== latest.current) return;
    setAiFilter(pids ? { ...base, resolvedPids: pids, unsupported: [], resolving: false } : { ...base, resolving: false });
  }, []);

  useAiResultHandler(useCallback((result: SankeyChatResult) => { void apply(result); }, [apply]), label);

  const clearAiFilter = useCallback(() => { latest.current++; setAiFilter(null); }, []);
  return { aiFilter, clearAiFilter };
}
