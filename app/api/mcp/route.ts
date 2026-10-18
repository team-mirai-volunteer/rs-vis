/**
 * MCP サーバー（Streamable HTTP）。外部の AI（Claude Code・claude.ai など）がこのサイトのデータを引くための入口。
 *
 * ツールはチャットのエージェントと同じカタログ（app/lib/ai/mcp-tools.ts）で、実行はサーバー側の
 * ChatToolExecutor（ローダ直呼び）。LLM は呼ばないので従量課金は発生せず、本番でも常時有効にできる。
 * 認証はなし（公開データのみ）。状態は持たない（セッション無し。1 リクエスト = 1 ツール呼び出し）。
 *
 * 接続例（Claude Code）: `claude mcp add --transport http rs-vis https://rs-vis.team-mir.ai/api/mcp`
 * 動作確認: docs/api-guide.md の「MCP」を参照。
 */
import { createMcpHandler } from 'mcp-handler';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { executeToolCall } from '@/app/lib/ai/chat-core';
import { serverToolExecutor } from '@/app/lib/ai/tool-executor-server';
import { MCP_INSTRUCTIONS, MCP_TOOLS, resolveToolYear } from '@/app/lib/ai/mcp-tools';

const SERVER_INFO = { name: 'rs-vis', version: '0.1.0' };

const handler = createMcpHandler(
  server => {
    for (const tool of MCP_TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType) },
        async args => {
          const input = (args ?? {}) as Record<string, unknown>;
          const resolved = resolveToolYear(input);
          if ('error' in resolved) return { content: [{ type: 'text', text: JSON.stringify({ error: resolved.error }) }], isError: true };
          const { year, ...rest } = { ...input, year: resolved.year };
          try {
            const { payload } = await executeToolCall(tool.name, rest, serverToolExecutor, year);
            const isError = typeof payload === 'object' && payload !== null && ('error' in payload || 'errors' in payload);
            return { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) };
          } catch (e) {
            console.error(`[mcp] ${tool.name} failed:`, e);
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'ツールの実行に失敗しました。時間をおいて再度お試しください' }) }], isError: true };
          }
        },
      );
    }
  },
  { serverInfo: SERVER_INFO, instructions: MCP_INSTRUCTIONS },
);

export { handler as GET, handler as POST, handler as DELETE };
