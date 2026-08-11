/**
 * サンキーAIチャット（/api/ai/sankey-chat）の要求・応答型。
 *
 * クライアント（/sankey-svg のチャットパネル）とAPIの間で共有する。
 * サーバーはステートレスで、会話履歴はクライアントが毎回全量を送る。
 */
import type { SankeyQuery, ResolvedSankeyQuery } from '@/types/sankey-query';
import type { SankeyQuerySummary } from '@/app/lib/sankey-query';

/** 会話履歴の送信上限（サーバーは超過を400にする。クライアントは送信前に古い履歴を切り捨てる） */
export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_TOTAL_CHARS = 8000;

export type SankeyChatRole = 'user' | 'assistant';

export interface SankeyChatMessage {
  role: SankeyChatRole;
  content: string;
}

/** ページの現在状態。差分指示（「今の条件に環境省を追加」等）の解釈に使う */
export interface SankeyChatContext {
  year?: '2024' | '2025';
  /** 現在ページに適用中のクエリ（未フィルタなら省略可） */
  currentQuery?: SankeyQuery;
}

export interface SankeyChatRequest {
  messages: SankeyChatMessage[];
  context?: SankeyChatContext;
  /** true の場合 SSE で進行イベント（progress）を配信してから終端イベント（result/error）を返す。未指定=従来のJSON応答 */
  stream?: boolean;
}

/**
 * ストリーミング応答（stream: true）中に配信される進行イベント。
 * 判別可能ユニオン。日本語ラベルへの変換は UI 層（AiChatPanel）で行う。
 */
export type SankeyChatProgressEvent =
  | { kind: 'llm_round'; round: number }
  | { kind: 'tool'; tool: string; matched?: number; hits?: number }
  | { kind: 'retry'; waitMs: number };

/** AIが構築したフィルタ条件と、その適用結果のサマリ */
export interface SankeyChatResult {
  /** resolveSankeyQuery 済みの正規化クエリ（AIの生出力ではない） */
  query: ResolvedSankeyQuery;
  summary: SankeyQuerySummary;
  /** 曖昧語をどう解釈したかの1文（例:「『子育て』を事業名に『子育て|こども|保育』を含む事業と解釈しました」）。曖昧語がない要求では省略される */
  interpretation?: string;
}

export interface SankeyChatResponse {
  /** ユーザー向けの応答文（結果なしの聞き返し・解釈不能の返答を含む） */
  message: string;
  /** フィルタ条件が確定した場合のみ */
  result?: SankeyChatResult;
  /** 次に聞ける質問の提案（最大3件）。現在のツールで実際に答えられる問いのみ */
  suggestions?: string[];
  usage: {
    model: string;
    toolCalls: number;
  };
}
