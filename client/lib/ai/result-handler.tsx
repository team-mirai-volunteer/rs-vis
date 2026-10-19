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
  /** ページが AI に見せる「いまの画面の状態」の要約（財政余力の計算結果など）。無ければ null */
  pageState: string | null;
  setPageState: (text: string | null) => void;
}

/** ページの状態として AI に渡す要約の上限（文字）。プロンプトに入るので短く保つ */
export const AI_PAGE_STATE_MAX = 4000;

const AiResultContext = createContext<AiResultContextValue | null>(null);

export function AiResultProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<AiResultTarget | null>(null);
  const [pageState, setPageStateRaw] = useState<string | null>(null);
  const register = useCallback((next: AiResultTarget) => {
    setTarget(next);
    return () => setTarget((current: AiResultTarget | null) => (current === next ? null : current));
  }, []);
  const setPageState = useCallback((text: string | null) => setPageStateRaw(text ? text.slice(0, AI_PAGE_STATE_MAX) : null), []);
  const value = useMemo(() => ({ target, register, pageState, setPageState }), [target, register, pageState, setPageState]);
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

/**
 * ページが「いまの画面の状態」を AI に見せる。計算結果や選択中の条件を短い日本語（または JSON）の要約にして渡す。
 * アンマウントで消える。要約は useMemo で安定させること（変わるたびに更新される）。
 * サイト提供 AI ではこの要約がサーバー経由で LLM に渡る（会話と同じ扱い）。個人情報を入れない。
 */
export function useAiPageState(summary: string | null): void {
  const context = useContext(AiResultContext);
  const setPageState = context?.setPageState;
  useEffect(() => {
    if (!setPageState) return;
    setPageState(summary);
    return () => setPageState(null);
  }, [setPageState, summary]);
}

/** AI ナビが現在ページの状態の要約を得る（無ければ null） */
export function useAiPageStateText(): string | null {
  return useContext(AiResultContext)?.pageState ?? null;
}

/** AI ナビが現在ページの受け取り手を得る（無ければ null） */
export function useAiResultTarget(): AiResultTarget | null {
  return useContext(AiResultContext)?.target ?? null;
}
