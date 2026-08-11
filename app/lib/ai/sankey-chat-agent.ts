/**
 * サンキーAIチャットのサーバモード・エントリポイント。
 *
 * BYOK対応（docs/ai-chat-architecture-guide.md）でエージェント本体は3層に分割された:
 * - chat-core.ts …… ループ・プロンプト・ツール定義（実行環境非依存の Pure 層）
 * - tool-shaping.ts …… ツール応答の整形・クランプ（両モード共有の Pure 層）
 * - tool-executor-server.ts …… サーバ実装（ローダ直呼び）
 * クライアントモードは client/lib/ai/ 配下（OpenRouter 直接 + 公開 API fetch）。
 *
 * 本ファイルは従来 API（/api/ai/sankey-chat）向けの互換エントリで、
 * コアにサーバ実装を束ねて従来シグネチャを維持する。
 */
import type { SankeyChatMessage, SankeyChatContext, SankeyChatProgressEvent } from '@/types/sankey-ai-chat';
import { runSankeyChatAgentCore, type LlmCaller, type SankeyChatAgentResult } from '@/app/lib/ai/chat-core';
import { serverToolExecutor } from '@/app/lib/ai/tool-executor-server';

export type { LlmCaller, LlmMessage, LlmToolCall, LlmToolDef, SankeyChatAgentResult } from '@/app/lib/ai/chat-core';

/** サーバモードでエージェントを実行する（ツール実行=ローダ直呼び） */
export async function runSankeyChatAgent(
  chatMessages: SankeyChatMessage[],
  context: SankeyChatContext,
  callLlm: LlmCaller,
  onProgress?: (ev: SankeyChatProgressEvent) => void,
): Promise<SankeyChatAgentResult> {
  return runSankeyChatAgentCore(chatMessages, context, callLlm, serverToolExecutor, onProgress);
}
