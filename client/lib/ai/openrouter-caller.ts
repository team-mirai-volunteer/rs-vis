/**
 * BYOKクライアントモードの LlmCaller: ブラウザから OpenRouter を直接呼ぶ。
 *
 * サーバモード（app/api/ai/sankey-chat/route.ts の callOnce/buildCallLlm）と同じ
 * リトライ・タイムアウト規律を持つ:
 * - 429/5xx/choices欠落は1回だけリトライ（待機は Retry-After → 本文提案 → 既定10秒、上限30秒）
 * - 1呼び出し60秒タイムアウト
 * 使用者の API キーはこのモジュールに渡されるが、**自サイトのサーバへは一切送信しない**。
 * キーを console.log・エラーメッセージ・テレメトリに含めないこと。
 */
import type { LlmCaller, LlmMessage, LlmToolDef } from '@/app/lib/ai/chat-core';

export const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** キー情報エンドポイント（認証必須）。/api/v1/models は認証不要の公開APIのため接続テストに使えない（実測: 無効キーでも200） */
export const OPENROUTER_KEY_INFO_URL = 'https://openrouter.ai/api/v1/key';
/** サーバモード（route.ts）と同じ既定モデル */
export const DEFAULT_BYOK_MODEL = 'google/gemini-3.5-flash';

const LLM_TIMEOUT_MS = 60_000;
const RETRY_WAIT_MS = 10_000;
const RETRY_WAIT_MAX_MS = 30_000;

/** LLM API 側の失敗（HTTPエラー・タイムアウト・応答形式不正）。UI でエラーバブルに変換する */
export class LlmUpstreamError extends Error {}

class LlmRetryableError extends LlmUpstreamError {
  constructor(message: string, readonly waitMs: number) {
    super(message);
  }
}

export interface OpenRouterCallerOptions {
  apiKey: string;
  model: string;
  /** リトライ待機の発生を UI（進行表示）へ通知する */
  onRetry?: (waitMs: number) => void;
  /** ユーザー操作による中断（送信キャンセル等） */
  signal?: AbortSignal;
}

async function callOnce(opts: OpenRouterCallerOptions, messages: LlmMessage[], tools: LlmToolDef[]): Promise<LlmMessage> {
  const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: opts.signal ? AbortSignal.any([timeoutSignal, opts.signal]) : timeoutSignal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new LlmUpstreamError(`LLM API への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (res.status === 401 || res.status === 403) {
      throw new LlmUpstreamError('APIキーが拒否されました。キーの有効性・利用上限を OpenRouter のダッシュボードで確認してください');
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const suggestedSec = Number(/retry in ([0-9.]+)s/.exec(detail)?.[1]);
      const baseSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec
        : Number.isFinite(suggestedSec) && suggestedSec > 0
          ? Math.ceil(suggestedSec) + 1
          : RETRY_WAIT_MS / 1000;
      const waitMs = Math.min(baseSec * 1000, RETRY_WAIT_MAX_MS);
      throw new LlmRetryableError(`LLM API HTTP ${res.status}: ${detail}`, waitMs);
    }
    throw new LlmUpstreamError(`LLM API HTTP ${res.status}: ${detail}`);
  }
  const data = await res.json().catch(() => null) as { choices?: { message?: LlmMessage }[] } | null;
  const message = data?.choices?.[0]?.message;
  // HTTP 200 で choices が空になるプロバイダ固有の一過性障害が観測されている（hy3:free/Novita）
  if (!message) throw new LlmRetryableError('LLM API 応答に choices[0].message がありません', RETRY_WAIT_MS);
  return message;
}

export function createOpenRouterCaller(opts: OpenRouterCallerOptions): LlmCaller {
  return async (messages, tools) => {
    try {
      return await callOnce(opts, messages, tools);
    } catch (e) {
      if (!(e instanceof LlmRetryableError)) throw e;
      opts.onRetry?.(e.waitMs);
      await new Promise<void>((resolve, reject) => {
        const rejectAborted = () => reject(new DOMException('中断されました', 'AbortError'));
        if (opts.signal?.aborted) { rejectAborted(); return; }
        const timer = setTimeout(() => resolve(), e.waitMs);
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); rejectAborted(); }, { once: true });
      });
      return await callOnce(opts, messages, tools); // 2回目の失敗はそのまま上へ
    }
  };
}

/**
 * キーの接続テスト（設定UIの「テスト」ボタン用）。
 * キー情報エンドポイント（認証必須・無料・軽量）でキーの有効性を検証する。
 */
export async function testOpenRouterKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(OPENROUTER_KEY_INFO_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'キーが拒否されました（無効または失効）' };
    return { ok: false, error: `接続に失敗しました（HTTP ${res.status}）` };
  } catch {
    return { ok: false, error: '接続に失敗しました（ネットワークエラー）' };
  }
}
