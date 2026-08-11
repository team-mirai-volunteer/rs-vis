/**
 * BYOKクライアントモードのチャット実行（page.tsx から呼ぶ組み立て役）。
 *
 * エージェントコア（app/lib/ai/chat-core.ts）に、ブラウザ直接の OpenRouter 呼び出しと
 * 公開 API fetch のツール実行を束ねる。
 *
 * プライバシー境界（UI文言と一致させること）: APIキーと会話の本文は自サイトの
 * サーバへ送信されない。ただしツール実行時、LLM が組み立てた検索キーワード等の
 * 最小限のクエリは匿名の公開データ API へ送られる（会話全文は送られない）。
 */
import type { SankeyChatMessage, SankeyChatContext, SankeyChatProgressEvent } from '@/types/sankey-ai-chat';
import { runSankeyChatAgentCore, type SankeyChatAgentResult } from '@/app/lib/ai/chat-core';
import { createOpenRouterCaller } from '@/client/lib/ai/openrouter-caller';
import { createClientToolExecutor, type ClientGraphSource } from '@/client/lib/ai/client-tool-executor';
import type { ByokSettings } from '@/client/lib/ai/api-key-store';

export { LlmUpstreamError } from '@/client/lib/ai/openrouter-caller';

export interface ByokChatOptions {
  messages: SankeyChatMessage[];
  context: SankeyChatContext;
  settings: ByokSettings;
  getGraph: ClientGraphSource;
  onProgress?: (ev: SankeyChatProgressEvent) => void;
  signal?: AbortSignal;
}

export async function runByokChat(opts: ByokChatOptions): Promise<SankeyChatAgentResult> {
  const callLlm = createOpenRouterCaller({
    apiKey: opts.settings.apiKey,
    model: opts.settings.model,
    onRetry: waitMs => opts.onProgress?.({ kind: 'retry', waitMs }),
    signal: opts.signal,
  });
  const executor = createClientToolExecutor(opts.getGraph);
  return runSankeyChatAgentCore(opts.messages, opts.context, callLlm, executor, opts.onProgress);
}
