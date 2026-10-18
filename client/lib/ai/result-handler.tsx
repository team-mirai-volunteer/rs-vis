'use client';

/**
 * AI ナビの結果をページが受け取るための登録制のハンドラ。
 *
 * AI ナビ（client/components/ai/AiAssistant.tsx）はヘッダーに 1 つだけあり、どのページでも開ける。
 * 結果（SankeyChatResult）をその場で適用できるページ（サンキー図）は `useAiResultHandler` で受け取り手を登録し、
 * 登録の無いページでは AI ナビが「サンキー図で見る」などのリンクで案内する。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SankeyChatResult } from '@/types/sankey-ai-chat';

export type AiResultHandler = (result: SankeyChatResult) => void;

/** 受け取り手と、結果が何に適用されるかの呼び名（「図」「一覧」）。文言とシステムプロンプトに使う */
export interface AiResultTarget {
  handler: AiResultHandler;
  /** 適用先の呼び名。サンキー図・バブル図は「図」、評価一覧・委託構造は「一覧」 */
  label: string;
}

interface AiResultContextValue {
  target: AiResultTarget | null;
  register: (target: AiResultTarget) => () => void;
}

const AiResultContext = createContext<AiResultContextValue | null>(null);

export function AiResultProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<AiResultTarget | null>(null);
  const register = useCallback((next: AiResultTarget) => {
    setTarget(next);
    return () => setTarget((current: AiResultTarget | null) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ target, register }), [target, register]);
  return <AiResultContext.Provider value={value}>{children}</AiResultContext.Provider>;
}

/**
 * ページが結果の受け取り手を登録する。アンマウントで解除。handler は useCallback で安定させること。
 * @param label 適用先の呼び名（既定「図」）。一覧型のページは「一覧」
 */
export function useAiResultHandler(handler: AiResultHandler, label = '図'): void {
  const context = useContext(AiResultContext);
  const register = context?.register;
  useEffect(() => {
    if (!register) return;
    return register({ handler, label });
  }, [register, handler, label]);
}

/** AI ナビが現在ページの受け取り手を得る（無ければ null） */
export function useAiResultTarget(): AiResultTarget | null {
  return useContext(AiResultContext)?.target ?? null;
}
