/**
 * AIインタビューの実行。
 *
 * BYOK: LLM は訪問者自身の OpenRouter キーで直接呼ぶ（client/lib/ai/openrouter-caller と同じ規律・
 * 同じ IndexedDB 保存キー）。インタビューの本文・キーは自サイトのサーバへ送らない。
 * サーバーモード（settings が null）: サイト提供 AI が有効な環境では /api/ai/interview で
 * サーバー側の LLM を使う。この場合は会話本文がサーバーを経由する（画面の文言で明示する）。
 * 意見の保存は両モード共通で、本人が公開に同意した最終の本文と transcript だけを送る（submitOpinion）。
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
  buildOpeningQuestion,
  buildSummarizeMessages,
  parseSummarizedOpinion,
  type InterviewProjectContext,
  type SummarizedOpinion,
} from '@/app/lib/comments/interview-prompt';

import { LlmUpstreamError } from '@/client/lib/ai/openrouter-caller';
export { LlmUpstreamError };
export type { InterviewProjectContext } from '@/app/lib/comments/interview-prompt';

interface RunOptions {
  /** null ならサーバーモード（/api/ai/interview） */
  settings: ByokSettings | null;
  signal?: AbortSignal;
  onRetry?: (waitMs: number) => void;
}

/** サイト提供 AI でインタビューできるか（環境変数で有効な場合のみ 200） */
export async function isServerInterviewEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/ai/interview', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function callServer<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch('/api/ai/interview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new LlmUpstreamError(data?.error ?? `AIが応答できませんでした（HTTP ${res.status}）`);
  return data as T;
}

/** 次のインタビュアー発話を得る。turns が空なら冒頭の問いかけを定型文で返し、LLM は呼ばない */
export async function nextInterviewerTurn(
  ctx: InterviewProjectContext,
  turns: InterviewTurn[],
  opts: RunOptions,
): Promise<string> {
  if (turns.length === 0) return buildOpeningQuestion(ctx);
  if (!opts.settings) {
    const r = await callServer<{ text: string }>({ kind: 'interview', context: ctx, turns }, opts.signal);
    return r.text;
  }
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
  if (!opts.settings) {
    const r = await callServer<{ body: string; stance: string | null }>({ kind: 'summarize', context: ctx, turns }, opts.signal);
    return { body: r.body, stance: r.stance ?? undefined } as SummarizedOpinion;
  }
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
