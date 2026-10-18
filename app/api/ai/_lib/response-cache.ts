/**
 * サイト提供 AI（/api/ai/sankey-chat）の応答キャッシュ。
 *
 * 同じ会話（全文）・同じ年度・同じデータ版・同じページ文脈なら、24 時間は LLM を呼ばずに前回の応答を返す。
 * Next.js のデータキャッシュ（unstable_cache）を使うので、Vercel ではインスタンス間で共有され、コールドスタートでも消えない。
 * 保存するのは成功した応答だけ。「解釈できなかった」と上流エラーは保存しない（次回やり直せるように）。
 * 応答は公開データについての AI の答えで、ユーザー固有の情報は含まない。BYOK（ブラウザ直）の会話はサーバーを通らないので対象外。
 */
import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import type { SankeyChatContext, SankeyChatMessage } from '@/types/sankey-ai-chat';
import { PROMPT_VERSION, type SankeyChatAgentResult } from '@/app/lib/ai/chat-core';
import { loadSankeyGraph } from '@/app/lib/api/sankey-graph-loader';
import { SANKEY_QUERY_DEFAULTS } from '@/app/lib/sankey-query';

/** 保持期間（秒）。データは日次より頻繁には変わらない */
export const RESPONSE_CACHE_TTL_SEC = 24 * 60 * 60;
export const RESPONSE_CACHE_TAG = 'ai-chat-response';

/** 保存しない応答を外へ運ぶための例外（unstable_cache は throw された呼び出しを保存しない） */
class UncacheableResult extends Error {
  constructor(readonly result: SankeyChatAgentResult) {
    super('uncacheable');
  }
}

/**
 * データの版。グラフの件数・総額とデプロイの commit で表す（データ JSON を差し替えると変わる）。
 * 生成日時はグラフの metadata に無いので、件数と総額で代用する
 */
function dataVersion(year: SankeyChatContext['year']): string {
  const y = year ?? SANKEY_QUERY_DEFAULTS.year;
  const m = loadSankeyGraph(y).metadata;
  return `${process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}:${y}:${m.projectCount}:${m.recipientCount}:${m.totalBudget}`;
}

/** 会話の全文・文脈・データ版から鍵を作る（SHA-256。unstable_cache の鍵は短い文字列が望ましい） */
export function responseCacheKey(messages: SankeyChatMessage[], context: SankeyChatContext): string {
  const payload = JSON.stringify({
    messages: messages.map(m => [m.role, m.content.trim()]),
    year: context.year ?? SANKEY_QUERY_DEFAULTS.year,
    currentQuery: context.currentQuery ?? null,
    page: context.page ?? null,
    version: dataVersion(context.year),
    prompt: PROMPT_VERSION,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * `run` の結果をキャッシュ越しに返す。`cached` は保存済みの応答を返したか。
 * `isCacheable` が false を返した結果は保存せずそのまま返す。`run` が throw したときは保存せず伝播する。
 */
export async function runWithResponseCache(
  key: string,
  run: () => Promise<SankeyChatAgentResult>,
  isCacheable: (result: SankeyChatAgentResult) => boolean,
): Promise<{ result: SankeyChatAgentResult; cached: boolean }> {
  const started = Date.now();
  const cachedRun = unstable_cache(
    async () => {
      const result = await run();
      if (!isCacheable(result)) throw new UncacheableResult(result);
      return { result, computedAt: Date.now() };
    },
    [RESPONSE_CACHE_TAG, key],
    { revalidate: RESPONSE_CACHE_TTL_SEC, tags: [RESPONSE_CACHE_TAG] },
  );
  try {
    const value = await cachedRun();
    return { result: value.result, cached: value.computedAt < started };
  } catch (e) {
    if (e instanceof UncacheableResult) return { result: e.result, cached: false };
    throw e;
  }
}
