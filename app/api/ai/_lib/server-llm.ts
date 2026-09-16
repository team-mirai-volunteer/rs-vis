/**
 * サイト提供 AI（サーバーモード）の共通部品。
 *
 * 有効判定・接続先・モデル・LLM 呼び出し（タイムアウト／429・5xx の 1 回リトライ）を
 * /api/ai/sankey-chat と /api/ai/interview で共有する。有効条件は 1 か所に集約し、
 * 「サンキー図の AI が使える環境では事業への意見インタビューも使える」を保証する。
 *
 * LLM 呼び出しは従量課金のため、公開時はレートリミット等と入れ替えるまで Vercel 上では
 * 既定で無効（SANKEY_AI_CHAT_ENABLED=1 で明示的に有効化）。判定は偽装不能な環境変数で行う。
 */
import type { LlmCaller, LlmMessage, LlmToolDef } from '@/app/lib/ai/chat-core';

export const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** サーバー側 LLM の既定モデル（コスト制約）。SANKEY_AI_CHAT_MODEL で差し替え可能 */
export const DEFAULT_SERVER_MODEL = 'openai/gpt-5.6-luna';
/** 推論モデルの思考量。コストと応答時間を抑えるため既定 low（SANKEY_AI_CHAT_REASONING_EFFORT で変更。'none' で送らない） */
export const DEFAULT_REASONING_EFFORT = 'low';
export function reasoningEffort(): 'low' | 'medium' | 'high' | null {
  const v = process.env.SANKEY_AI_CHAT_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}
/** LLM 1 呼び出しのタイムアウト。無料モデルは長い生成で 30 秒を超えることがあるため既定 60 秒 */
export const LLM_TIMEOUT_MS = Number(process.env.SANKEY_AI_CHAT_LLM_TIMEOUT_MS) || 60_000;
/** 429/一過性障害のリトライ待機の既定値（上流が待機時間を提案しない場合） */
export const RETRY_WAIT_MS = 10_000;
/** リトライ待機の上限。Gemini 無料枠は 10〜50 秒を提案してくるため、超える分は諦めて 502 にする */
export const RETRY_WAIT_MAX_MS = 30_000;

/** LLM API 側の失敗（HTTP エラー・タイムアウト・応答形式不正）。ルートでは 502 に丸める */
export class LlmUpstreamError extends Error {}
/** リトライで回復しうる失敗（429・5xx・choices 欠落） */
export class LlmRetryableError extends LlmUpstreamError {
  constructor(message: string, readonly waitMs: number) {
    super(message);
  }
}

export function isServerAiEnabled(): boolean {
  if (!serverApiKey()) return false;
  if (process.env.SANKEY_AI_CHAT_ENABLED === '1') return true;
  if (process.env.VERCEL === '1') return false; // Vercel 上は既定で無効
  return process.env.NODE_ENV !== 'production'; // ローカルでも production ビルドは既定無効
}

export function serverModel(): string {
  return process.env.SANKEY_AI_CHAT_MODEL || DEFAULT_SERVER_MODEL;
}

/**
 * 接続先は OpenAI 互換 chat.completions であれば差し替え可能。既定は OpenRouter。
 * Gemini API 直（無料枠）を使う場合の例:
 *   SANKEY_AI_CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 *   SANKEY_AI_CHAT_API_KEY=<Gemini APIキー>  SANKEY_AI_CHAT_MODEL=gemini-2.5-flash（google/ プレフィックスなし）
 */
export function serverCompletionsUrl(): string {
  return process.env.SANKEY_AI_CHAT_BASE_URL || OPENROUTER_CHAT_COMPLETIONS_URL;
}

/** 接続先用キー。未指定なら OpenRouter のキーを使う（従来互換） */
export function serverApiKey(): string | undefined {
  return process.env.SANKEY_AI_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
}

/** 1 回の LLM 呼び出し。ツール無しの単純対話（インタビュー等）は tools を空にする */
async function callOnce(llmMessages: LlmMessage[], tools: LlmToolDef[], abortSignal?: AbortSignal): Promise<LlmMessage> {
  const url = serverCompletionsUrl();
  const apiKey = serverApiKey()!;
  const model = serverModel();
  const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: llmMessages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        // OpenRouter の推論制御。対応しないモデルでは無視される
        ...(reasoningEffort() ? { reasoning: { effort: reasoningEffort() } } : {}),
        temperature: 0.2,
      }),
      // クライアント切断（abortSignal）でも上流呼び出しを即中断する（従量課金の無駄呼び出し防止）
      signal: abortSignal ? AbortSignal.any([timeoutSignal, abortSignal]) : timeoutSignal,
    });
  } catch (e) {
    throw new LlmUpstreamError(`LLM API への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (res.status === 429 || res.status >= 500) {
      // 待機時間は Retry-After ヘッダ → 本文の提案（Gemini は "retry in 28.0s" 形式）→ 既定値、の順（上限あり）
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const suggestedSec = Number(/retry in ([0-9.]+)s/.exec(detail)?.[1]);
      const baseSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec
        : Number.isFinite(suggestedSec) && suggestedSec > 0
          ? Math.ceil(suggestedSec) + 1
          : RETRY_WAIT_MS / 1000;
      throw new LlmRetryableError(`LLM API HTTP ${res.status}: ${detail}`, Math.min(baseSec * 1000, RETRY_WAIT_MAX_MS));
    }
    throw new LlmUpstreamError(`LLM API HTTP ${res.status}: ${detail}`);
  }
  const data = await res.json().catch(() => null) as { choices?: { message?: LlmMessage }[] } | null;
  const message = data?.choices?.[0]?.message;
  // HTTP 200 で choices が空になるプロバイダ固有の一過性障害が観測されている
  if (!message) throw new LlmRetryableError('LLM API 応答に choices[0].message がありません', RETRY_WAIT_MS);
  return message;
}

/**
 * リトライ 1 回付きの LLM 呼び出し関数を作る。
 * onRetry はリトライ待機の通知（ストリーム時の progress 用）、abortSignal はクライアント切断の伝播用
 */
export function createServerLlmCaller(tag: string, onRetry?: (waitMs: number) => void, abortSignal?: AbortSignal): LlmCaller {
  return async (llmMessages, tools) => {
    try {
      return await callOnce(llmMessages, tools, abortSignal);
    } catch (e) {
      if (!(e instanceof LlmRetryableError)) throw e;
      console.warn(`[${tag}] retryable upstream failure, retrying in ${e.waitMs}ms:`, e.message);
      onRetry?.(e.waitMs);
      await new Promise<void>((resolve, reject) => {
        const rejectAborted = () => reject(new DOMException('クライアントが切断しました', 'AbortError'));
        if (abortSignal?.aborted) { rejectAborted(); return; }
        const timer = setTimeout(() => resolve(), e.waitMs);
        abortSignal?.addEventListener('abort', () => { clearTimeout(timer); rejectAborted(); }, { once: true });
      });
      return await callOnce(llmMessages, tools, abortSignal); // 2 回目の失敗はそのまま上へ（502 に丸まる）
    }
  };
}
