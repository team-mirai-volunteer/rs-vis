/**
 * AI ナビ（サイト提供 AI）の対話ログを Supabase に保存する（supabase/migrations/20261019_ai_nav_logs.sql）。
 *
 * - 保存するのはサーバー経由の会話だけ。BYOK はサーバーを通らないので対象外
 * - 個人を特定する情報は持たない（IP・UA・Cookie を保存しない）
 * - 保存の失敗で AI の応答を止めない（記録は副作用。失敗はログに出して握りつぶす）
 * - Supabase が未設定の環境（ローカルの既定・プレビュー）では何もしない
 */
import { getSupabaseAdmin } from '@/app/lib/comments/supabase-admin';
import type { SankeyChatMessage } from '@/types/sankey-ai-chat';
import type { SankeyChatAgentResult } from '@/app/lib/ai/chat-core';

export interface AiNavLogEntry {
  year: string;
  page?: string;
  model: string;
  messages: SankeyChatMessage[];
  /** 上流エラーのときは null */
  response: Pick<SankeyChatAgentResult, 'message' | 'result' | 'suggestions'> | null;
  outcome: 'result' | 'text' | 'upstream_error';
  toolCalls: number;
  cached: boolean;
  latencyMs: number;
}

/** 保存する（await しなくてよい。失敗しても throw しない） */
export async function recordAiNavLog(entry: AiNavLogEntry): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    const { error } = await db.from('ai_nav_logs').insert({
      year: entry.year,
      page: entry.page ?? null,
      model: entry.model,
      messages: entry.messages,
      response: entry.response,
      outcome: entry.outcome,
      tool_calls: entry.toolCalls,
      cached: entry.cached,
      latency_ms: entry.latencyMs,
    });
    if (error) console.error('[ai/nav-log] insert failed:', error.message);
  } catch (e) {
    console.error('[ai/nav-log] insert failed:', e);
  }
}

/** エージェントの結果から保存用の形を作る */
export function navLogResponse(result: SankeyChatAgentResult): AiNavLogEntry['response'] {
  return {
    message: result.message,
    ...(result.result ? { result: result.result } : {}),
    ...(result.suggestions ? { suggestions: result.suggestions } : {}),
  };
}
