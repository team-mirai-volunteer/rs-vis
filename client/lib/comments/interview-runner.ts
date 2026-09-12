/**
 * AIインタビューの実行（BYOK・ブラウザ側）。
 *
 * LLM は訪問者自身の OpenRouter キーで直接呼ぶ（client/lib/ai/openrouter-caller と同じ規律・
 * 同じ IndexedDB 保存キー）。インタビューの本文・キーは自サイトのサーバへ送らない。
 * サーバへ送るのは、本人が公開に同意した最終の意見本文と transcript だけ（submitOpinion）。
 */
import type { ProjectDetail } from '@/types/project-details';
import type {
  InterviewTurn,
  PostProjectCommentRequest,
  PostProjectCommentResponse,
} from '@/types/project-comments';
import type { ByokSettings } from '@/client/lib/ai/api-key-store';
import { createOpenRouterCaller } from '@/client/lib/ai/openrouter-caller';
import {
  buildInterviewMessages,
  buildSummarizeMessages,
  parseSummarizedOpinion,
  type InterviewProjectContext,
  type SummarizedOpinion,
} from '@/app/lib/comments/interview-prompt';

export { LlmUpstreamError } from '@/client/lib/ai/openrouter-caller';
export type { InterviewProjectContext } from '@/app/lib/comments/interview-prompt';

interface RunOptions {
  settings: ByokSettings;
  signal?: AbortSignal;
  onRetry?: (waitMs: number) => void;
}

/** 次のインタビュアー発話を得る（turns が空なら冒頭の問いかけ） */
export async function nextInterviewerTurn(
  ctx: InterviewProjectContext,
  turns: InterviewTurn[],
  opts: RunOptions,
): Promise<string> {
  const callLlm = createOpenRouterCaller({
    apiKey: opts.settings.apiKey,
    model: opts.settings.model,
    onRetry: opts.onRetry,
    signal: opts.signal,
  });
  const reply = await callLlm(buildInterviewMessages(ctx, turns), []);
  const text = (reply.content ?? '').trim();
  return text || 'すみません、うまく聞き取れませんでした。もう一度お話しいただけますか。';
}

/** インタビュー記録を公開用の意見文に整形する */
export async function summarizeOpinion(
  ctx: InterviewProjectContext,
  turns: InterviewTurn[],
  opts: RunOptions,
): Promise<SummarizedOpinion> {
  const callLlm = createOpenRouterCaller({
    apiKey: opts.settings.apiKey,
    model: opts.settings.model,
    onRetry: opts.onRetry,
    signal: opts.signal,
  });
  const reply = await callLlm(buildSummarizeMessages(ctx, turns), []);
  return parseSummarizedOpinion(reply.content);
}

/** 事業概要（/api/project-details）を取得。無ければ null */
export async function fetchProjectDetailForInterview(pid: string, year: string): Promise<ProjectDetail | null> {
  try {
    const res = await fetch(`/api/project-details/${encodeURIComponent(pid)}?year=${encodeURIComponent(year)}`);
    if (!res.ok) return null;
    return await res.json() as ProjectDetail;
  } catch {
    return null;
  }
}

export class SubmitOpinionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** 本人同意後の投稿。成功時は保存結果（published / hidden）を返す */
export async function submitOpinion(
  pid: string,
  payload: PostProjectCommentRequest,
): Promise<PostProjectCommentResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null) as (PostProjectCommentResponse & { error?: string }) | null;
  if (!res.ok) {
    throw new SubmitOpinionError(data?.error ?? `投稿に失敗しました（HTTP ${res.status}）`, res.status);
  }
  return data as PostProjectCommentResponse;
}
