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

interface AiResultContextValue {
  handler: AiResultHandler | null;
  register: (handler: AiResultHandler) => () => void;
}

const AiResultContext = createContext<AiResultContextValue | null>(null);

export function AiResultProvider({ children }: { children: ReactNode }) {
  const [handler, setHandler] = useState<AiResultHandler | null>(null);
  const register = useCallback((next: AiResultHandler) => {
    setHandler(() => next);
    return () => setHandler((current: AiResultHandler | null) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ handler, register }), [handler, register]);
  return <AiResultContext.Provider value={value}>{children}</AiResultContext.Provider>;
}

/** ページが結果の受け取り手を登録する。アンマウントで解除。handler は useCallback で安定させること */
export function useAiResultHandler(handler: AiResultHandler): void {
  const context = useContext(AiResultContext);
  const register = context?.register;
  useEffect(() => {
    if (!register) return;
    return register(handler);
  }, [register, handler]);
}

/** AI ナビが現在ページの受け取り手を得る（無ければ null） */
export function useAiResultDispatch(): AiResultHandler | null {
  return useContext(AiResultContext)?.handler ?? null;
}
