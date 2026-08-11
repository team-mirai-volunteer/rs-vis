import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { runSankeyChatAgent, type LlmCaller, type LlmMessage, type LlmToolDef } from '@/app/lib/ai/sankey-chat-agent';
import { serverErrorResponse } from '@/app/lib/api/api-notes';
import { appendUsageLog } from '@/app/lib/api/usage-log';
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TOTAL_CHARS,
  type SankeyChatContext,
  type SankeyChatMessage,
  type SankeyChatProgressEvent,
  type SankeyChatRequest,
  type SankeyChatResponse,
} from '@/types/sankey-ai-chat';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** 品質スコア（scripts/score-project-quality-ai.py）と同じ既定モデル */
const DEFAULT_MODEL = 'google/gemini-3.5-flash';
/**
 * LLM 1呼び出しのタイムアウト。無料モデル（hy3:free等）は深掘りの長い生成で30秒を超える
 * ことがあるため既定60秒。SANKEY_AI_CHAT_LLM_TIMEOUT_MS で調整可能
 */
const LLM_TIMEOUT_MS = Number(process.env.SANKEY_AI_CHAT_LLM_TIMEOUT_MS) || 60_000;
/** 429/一過性障害のリトライ待機の既定値（上流が待機時間を提案しない場合） */
const RETRY_WAIT_MS = 10_000;
/** リトライ待機の上限。Gemini 無料枠は 10〜50 秒を提案してくるため、これを超える分は諦めて 502 にする */
const RETRY_WAIT_MAX_MS = 30_000;

/** LLM API 側の失敗（HTTPエラー・タイムアウト・応答形式不正）。502 に丸める */
class LlmUpstreamError extends Error {}

/** appendUsageLog 呼び出しの共通次元（非ストリーミング・ストリーミング両経路で使う） */
interface AiChatLogBase {
  kind: 'ai_chat';
  model: string;
  turns: number;
  userText: string;
}

/**
 * ローカル実験フェーズの本番抑制ガード（/api/sankey/query の isQueryApiEnabled と同型）。
 * LLM 呼び出しは従量課金のため、公開時はレートリミット等と入れ替えるまで Vercel 上では
 * 機能・理由を一切明かさない素の 404 を返す。判定は偽装不能な環境変数で行う。
 * 加えて API キーが無い環境では常に無効（キーなしでは機能しないため）。
 */
function isAiChatEnabled(): boolean {
  if (!chatApiKey()) return false;
  if (process.env.SANKEY_AI_CHAT_ENABLED === '1') return true;
  if (process.env.VERCEL === '1') return false; // Vercel 上は既定で無効
  return process.env.NODE_ENV !== 'production'; // ローカルでも production ビルドは既定無効
}

function chatModel(): string {
  return process.env.SANKEY_AI_CHAT_MODEL || DEFAULT_MODEL;
}

/**
 * 接続先は OpenAI 互換 chat.completions であれば差し替え可能。
 * 既定は OpenRouter。Gemini API 直（無料枠）を使う場合の例:
 *   SANKEY_AI_CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
 *   SANKEY_AI_CHAT_API_KEY=<Gemini APIキー>  SANKEY_AI_CHAT_MODEL=gemini-2.5-flash（google/ プレフィックスなし）
 */
function chatCompletionsUrl(): string {
  return process.env.SANKEY_AI_CHAT_BASE_URL || OPENROUTER_CHAT_COMPLETIONS_URL;
}

/** 接続先用キー。未指定なら OpenRouter のキーを使う（従来互換） */
function chatApiKey(): string | undefined {
  return process.env.SANKEY_AI_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
}

/** チャットパネルの表示可否をクライアントが判定するための疎通エンドポイント */
export async function GET() {
  if (!isAiChatEnabled()) notFound();
  return NextResponse.json({ enabled: true, model: chatModel() });
}

function validateMessages(input: unknown): { messages?: SankeyChatMessage[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'messages は1件以上の配列で指定してください' };
  }
  if (input.length > MAX_CHAT_MESSAGES) {
    return { error: `messages は直近${MAX_CHAT_MESSAGES}件以内で送信してください（受領件数: ${input.length}）` };
  }
  const messages: SankeyChatMessage[] = [];
  let totalChars = 0;
  for (const m of input) {
    const role = (m as SankeyChatMessage)?.role;
    const content = (m as SankeyChatMessage)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { error: 'messages の各要素は { role: "user" | "assistant", content: string } で指定してください' };
    }
    totalChars += content.length;
    messages.push({ role, content });
  }
  if (totalChars > MAX_CHAT_TOTAL_CHARS) {
    return { error: `messages の合計文字数が上限（${MAX_CHAT_TOTAL_CHARS}字）を超えています` };
  }
  if (messages[messages.length - 1].role !== 'user') {
    return { error: 'messages の末尾は user メッセージにしてください' };
  }
  return { messages };
}

function validateContext(input: unknown): SankeyChatContext {
  const context: SankeyChatContext = {};
  if (input === null || typeof input !== 'object') return context;
  const raw = input as SankeyChatContext;
  if (raw.year === '2024' || raw.year === '2025') context.year = raw.year;
  if (raw.currentQuery !== null && typeof raw.currentQuery === 'object' && !Array.isArray(raw.currentQuery)) {
    context.currentQuery = raw.currentQuery;
  }
  return context;
}

export async function POST(req: Request) {
  if (!isAiChatEnabled()) notFound();
  try {
    let body: SankeyChatRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'リクエストボディのJSONが不正です' }, { status: 400 });
    }

    const { messages, error } = validateMessages(body?.messages);
    if (error || !messages) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const context = validateContext(body?.context);
    const streamRequested = body?.stream === true;

    const model = chatModel();
    const url = chatCompletionsUrl();
    const apiKey = chatApiKey()!;

    /** リトライで回復しうる失敗（429・5xx・choices欠落）。それ以外の LlmUpstreamError と区別する */
    class LlmRetryableError extends LlmUpstreamError {
      constructor(message: string, readonly waitMs: number) {
        super(message);
      }
    }

    const callOnce = async (llmMessages: LlmMessage[], tools: LlmToolDef[], abortSignal?: AbortSignal): Promise<LlmMessage> => {
      const timeoutSignal = AbortSignal.timeout(LLM_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: llmMessages,
            tools,
            tool_choice: 'auto',
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
          // 無料枠のレート制限（RPM）や一過性の 5xx。待機時間は Retry-After ヘッダ →
          // 本文の提案（Gemini は "retry in 28.0s" 形式で返す）→ 既定値、の順で決める（上限あり）
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
    };

    /**
     * onRetry はリトライ待機の発生を呼び出し側（ストリーム時のみ）へ通知するフック。
     * abortSignal はクライアント切断の伝播用（ストリーム時のみ）: LLM fetch とリトライ待機の両方を即中断する
     */
    const buildCallLlm = (onRetry?: (waitMs: number) => void, abortSignal?: AbortSignal): LlmCaller => async (llmMessages, tools) => {
      try {
        return await callOnce(llmMessages, tools, abortSignal);
      } catch (e) {
        if (!(e instanceof LlmRetryableError)) throw e;
        console.warn(`[ai/sankey-chat] retryable upstream failure, retrying in ${e.waitMs}ms:`, e.message);
        onRetry?.(e.waitMs);
        await new Promise<void>((resolve, reject) => {
          const rejectAborted = () => reject(new DOMException('クライアントが切断しました', 'AbortError'));
          if (abortSignal?.aborted) { rejectAborted(); return; }
          const timer = setTimeout(() => resolve(), e.waitMs);
          abortSignal?.addEventListener('abort', () => { clearTimeout(timer); rejectAborted(); }, { once: true });
        });
        return await callOnce(llmMessages, tools, abortSignal); // 2回目の失敗はそのまま上へ（502 に丸まる）
      }
    };

    // 利用ログ（dev専用）の共通次元。userText は直近のユーザー発話（未充足需要の観測が主目的）
    const started = Date.now();
    const logBase: AiChatLogBase = {
      kind: 'ai_chat',
      model,
      turns: messages.length,
      userText: messages[messages.length - 1].content.slice(0, 200),
    };

    if (streamRequested) {
      return buildStreamResponse(messages, context, buildCallLlm, model, logBase, started, req.signal);
    }

    let agentResult;
    try {
      agentResult = await runSankeyChatAgent(messages, context, buildCallLlm());
    } catch (e) {
      if (e instanceof LlmUpstreamError || (e instanceof Error && e.name === 'TimeoutError')) {
        console.error('[ai/sankey-chat] upstream error:', e);
        appendUsageLog({ ...logBase, outcome: 'upstream_error', latencyMs: Date.now() - started });
        return NextResponse.json(
          { error: 'AIが応答できませんでした。時間をおいて再度お試しください' },
          { status: 502 },
        );
      }
      throw e;
    }

    appendUsageLog({
      ...logBase,
      // result なし = 聞き返し・解釈不能（未充足需要のシグナル）。text 行の userText を集計して活用する
      outcome: agentResult.result ? 'result' : 'text',
      ...(agentResult.result ? { projectCount: agentResult.result.summary.projects.count } : {}),
      toolCalls: agentResult.toolCalls,
      suggestions: agentResult.suggestions?.length ?? 0,
      interpretation: Boolean(agentResult.result?.interpretation),
      latencyMs: Date.now() - started,
    });

    const response: SankeyChatResponse = {
      message: agentResult.message,
      ...(agentResult.result ? { result: agentResult.result } : {}),
      ...(agentResult.suggestions ? { suggestions: agentResult.suggestions } : {}),
      usage: { model, toolCalls: agentResult.toolCalls },
    };
    // チャット応答はキャッシュ不可
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverErrorResponse('ai/sankey-chat', e);
  }
}

/**
 * SSE ストリーミング応答を組み立てる（stream: true 時のみ）。
 * progress イベント（llm_round/tool はエージェントの onProgress、retry は callLlm の onRetry 経由）を
 * 15秒間隔の ping コメント行と共に逐次配信し、終端は result / error イベントで締める。
 * usage-log の記録・応答形（SankeyChatResponse）は非ストリーミング経路と同一にする。
 * クライアント切断（reqSignal・ストリーム cancel）は aborter 経由で LLM fetch・リトライ待機に伝播し、
 * 上流失敗ではなくキャンセル（outcome: client_abort）として扱う。
 */
function buildStreamResponse(
  messages: SankeyChatMessage[],
  context: SankeyChatContext,
  buildCallLlm: (onRetry?: (waitMs: number) => void, abortSignal?: AbortSignal) => LlmCaller,
  model: string,
  logBase: AiChatLogBase,
  started: number,
  reqSignal: AbortSignal | undefined,
): Response {
  const encoder = new TextEncoder();
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const aborter = new AbortController();
  const onReqAbort = () => aborter.abort();
  reqSignal?.addEventListener('abort', onReqAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // クライアント切断後の enqueue 失敗は無視する（ループは finally で必ず終える）
        }
      };
      const finish = () => {
        if (pingTimer) clearInterval(pingTimer);
        reqSignal?.removeEventListener('abort', onReqAbort);
        try {
          controller.close();
        } catch {
          // 既に close/error 済みなら無視
        }
      };
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          if (pingTimer) clearInterval(pingTimer);
        }
      }, 15_000);

      (async () => {
        const callLlm = buildCallLlm(
          waitMs => send('progress', { kind: 'retry', waitMs } satisfies SankeyChatProgressEvent),
          aborter.signal,
        );
        const onProgress = (ev: SankeyChatProgressEvent) => send('progress', ev);
        try {
          const agentResult = await runSankeyChatAgent(messages, context, callLlm, onProgress);
          appendUsageLog({
            ...logBase,
            outcome: agentResult.result ? 'result' : 'text',
            ...(agentResult.result ? { projectCount: agentResult.result.summary.projects.count } : {}),
            toolCalls: agentResult.toolCalls,
            suggestions: agentResult.suggestions?.length ?? 0,
            interpretation: Boolean(agentResult.result?.interpretation),
            latencyMs: Date.now() - started,
          });
          const response: SankeyChatResponse = {
            message: agentResult.message,
            ...(agentResult.result ? { result: agentResult.result } : {}),
            ...(agentResult.suggestions ? { suggestions: agentResult.suggestions } : {}),
            usage: { model, toolCalls: agentResult.toolCalls },
          };
          send('result', response);
        } catch (e) {
          if (aborter.signal.aborted) {
            // クライアント切断によるキャンセル: 送信先はもういないためイベントは送らず、上流失敗として数えない
            console.log('[ai/sankey-chat] client aborted, agent loop stopped');
            appendUsageLog({ ...logBase, outcome: 'client_abort', latencyMs: Date.now() - started });
          } else if (e instanceof LlmUpstreamError || (e instanceof Error && e.name === 'TimeoutError')) {
            console.error('[ai/sankey-chat] upstream error (stream):', e);
            appendUsageLog({ ...logBase, outcome: 'upstream_error', latencyMs: Date.now() - started });
            send('error', { error: 'AIが応答できませんでした。時間をおいて再度お試しください' });
          } else {
            console.error('[ai/sankey-chat] unexpected error (stream):', e);
            send('error', { error: 'サーバーエラーが発生しました' });
          }
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      // クライアント切断: ping を止め、実行中のエージェントループ・LLM fetch・リトライ待機を中断する
      if (pingTimer) clearInterval(pingTimer);
      aborter.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
