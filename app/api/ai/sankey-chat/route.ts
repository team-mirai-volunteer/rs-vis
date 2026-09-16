import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { runSankeyChatAgent, type LlmCaller } from '@/app/lib/ai/sankey-chat-agent';
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

import { createServerLlmCaller, isServerAiEnabled, LlmUpstreamError, newUsage, serverModel, type LlmUsage } from '@/app/api/ai/_lib/server-llm';

/** appendUsageLog 呼び出しの共通次元（非ストリーミング・ストリーミング両経路で使う） */
interface AiChatLogBase {
  kind: 'ai_chat';
  model: string;
  tokens: LlmUsage;
  turns: number;
  userText: string;
}

/** チャットパネルの表示可否をクライアントが判定するための疎通エンドポイント */
export async function GET() {
  if (!isServerAiEnabled()) notFound();
  return NextResponse.json({ enabled: true, model: serverModel() });
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
  if (!isServerAiEnabled()) notFound();
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

    const model = serverModel();
    // onRetry はリトライ待機の通知（ストリーム時のみ）、abortSignal はクライアント切断の伝播用
    const usage = newUsage();
    const buildCallLlm = (onRetry?: (waitMs: number) => void, abortSignal?: AbortSignal): LlmCaller =>
      createServerLlmCaller('ai/sankey-chat', onRetry, abortSignal, { usage });

    // 利用ログ（dev専用）の共通次元。userText は直近のユーザー発話（未充足需要の観測が主目的）
    const started = Date.now();
    const logBase: AiChatLogBase = {
      kind: 'ai_chat',
      model,
      // 参照で持たせる: appendUsageLog の JSON 化時点の累計トークンが記録される
      tokens: usage,
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
