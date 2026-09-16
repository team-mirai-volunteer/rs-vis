/**
 * 事業への意見インタビュー（サーバーモード）。
 *
 * 訪問者が OpenRouter キーを登録していない環境でも、サイト提供 AI が有効なら
 * インタビュアーの発話と意見文の整形をサーバー側の LLM で行う。有効条件・接続先・モデルは
 * /api/ai/sankey-chat と同じ（app/api/ai/_lib/server-llm）。BYOK 利用時はこの API を経由せず、
 * 会話本文はサーバーへ届かない（プライバシー境界は InterviewDialog の文言と一致させる）。
 * 意見の保存・一覧は従来どおり app/api/projects/[pid]/comments。
 */
import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { serverErrorResponse } from '@/app/lib/api/api-notes';
import { appendUsageLog } from '@/app/lib/api/usage-log';
import { createServerLlmCaller, isServerAiEnabled, LlmUpstreamError, serverModel } from '@/app/api/ai/_lib/server-llm';
import {
  buildInterviewMessages,
  buildSummarizeMessages,
  parseSummarizedOpinion,
  type InterviewProjectContext,
} from '@/app/lib/comments/interview-prompt';
import { INTERVIEW_INPUT_MAX_CHARS, INTERVIEW_MAX_USER_TURNS, TRANSCRIPT_MAX_TURNS, type InterviewTurn } from '@/types/project-comments';

export interface InterviewApiRequest {
  kind: 'interview' | 'summarize';
  context: InterviewProjectContext;
  turns: InterviewTurn[];
}
export type InterviewApiResponse =
  | { kind: 'interview'; text: string; usage: { model: string } }
  | { kind: 'summarize'; body: string; stance: string | null; usage: { model: string } };

/** 疎通確認。無効な環境では機能の有無を明かさず 404 */
export async function GET() {
  if (!isServerAiEnabled()) notFound();
  return NextResponse.json({ enabled: true, model: serverModel() });
}

const MAX_PROJECT_NAME_CHARS = 200;
const MAX_ASSISTANT_TURN_CHARS = 2000;

function validate(input: unknown): { request?: InterviewApiRequest; error?: string } {
  if (!input || typeof input !== 'object') return { error: 'リクエストボディが不正です' };
  const raw = input as Partial<InterviewApiRequest>;
  if (raw.kind !== 'interview' && raw.kind !== 'summarize') return { error: 'kind は interview か summarize を指定してください' };
  const ctx = raw.context;
  if (!ctx || typeof ctx !== 'object' || typeof ctx.pid !== 'string' || typeof ctx.year !== 'string' || typeof ctx.projectName !== 'string') {
    return { error: 'context には pid・year・projectName を指定してください' };
  }
  if (ctx.projectName.length > MAX_PROJECT_NAME_CHARS || !/^\d{4}$/.test(ctx.year) || ctx.pid.length > 64) return { error: 'context の値が不正です' };
  if (!Array.isArray(raw.turns) || raw.turns.length > TRANSCRIPT_MAX_TURNS) return { error: `turns は${TRANSCRIPT_MAX_TURNS}件以内の配列で指定してください` };
  const turns: InterviewTurn[] = [];
  let userTurns = 0;
  for (const t of raw.turns) {
    const role = (t as InterviewTurn)?.role, content = (t as InterviewTurn)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return { error: 'turns の各要素は { role, content } で指定してください' };
    if (role === 'user') { userTurns++; if (content.length > INTERVIEW_INPUT_MAX_CHARS) return { error: `利用者の発言は${INTERVIEW_INPUT_MAX_CHARS}字以内です` }; }
    else if (content.length > MAX_ASSISTANT_TURN_CHARS) return { error: 'AI の発言が長すぎます' };
    turns.push({ role, content });
  }
  if (userTurns > INTERVIEW_MAX_USER_TURNS) return { error: `利用者の発言は${INTERVIEW_MAX_USER_TURNS}回以内です` };
  // detail 等の補助情報は LLM の文脈にだけ使う。型どおりのオブジェクトなら通し、それ以外は捨てる
  const context: InterviewProjectContext = {
    pid: ctx.pid, year: ctx.year, projectName: ctx.projectName,
    ...(typeof ctx.ministry === 'string' ? { ministry: ctx.ministry.slice(0, 100) } : {}),
    ...(ctx.detail && typeof ctx.detail === 'object' ? { detail: ctx.detail } : {}),
    ...(typeof ctx.budget === 'number' ? { budget: ctx.budget } : {}),
    ...(typeof ctx.execution === 'number' ? { execution: ctx.execution } : {}),
    ...(typeof ctx.score === 'number' ? { score: ctx.score } : {}),
    ...(Array.isArray(ctx.topRecipients) ? { topRecipients: ctx.topRecipients.slice(0, 10).filter(r => r && typeof r.name === 'string' && typeof r.amount === 'number') } : {}),
  };
  return { request: { kind: raw.kind, context, turns } };
}

export async function POST(req: Request) {
  if (!isServerAiEnabled()) notFound();
  try {
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'リクエストボディのJSONが不正です' }, { status: 400 }); }
    const { request, error } = validate(body);
    if (error || !request) return NextResponse.json({ error }, { status: 400 });

    const model = serverModel();
    const callLlm = createServerLlmCaller('ai/interview', undefined, req.signal);
    const started = Date.now();
    const logBase = { kind: 'ai_interview', model, step: request.kind, turns: request.turns.length, pid: request.context.pid };
    try {
      if (request.kind === 'interview') {
        const reply = await callLlm(buildInterviewMessages(request.context, request.turns), []);
        const text = (reply.content ?? '').trim() || 'すみません、うまく聞き取れませんでした。もう一度お話しいただけますか。';
        appendUsageLog({ ...logBase, outcome: 'text', latencyMs: Date.now() - started });
        const response: InterviewApiResponse = { kind: 'interview', text, usage: { model } };
        return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
      }
      const reply = await callLlm(buildSummarizeMessages(request.context, request.turns), []);
      const summary = parseSummarizedOpinion(reply.content);
      appendUsageLog({ ...logBase, outcome: 'summary', latencyMs: Date.now() - started });
      const response: InterviewApiResponse = { kind: 'summarize', body: summary.body, stance: summary.stance ?? null, usage: { model } };
      return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      if (e instanceof LlmUpstreamError || (e instanceof Error && e.name === 'TimeoutError')) {
        console.error('[ai/interview] upstream error:', e);
        appendUsageLog({ ...logBase, outcome: 'upstream_error', latencyMs: Date.now() - started });
        return NextResponse.json({ error: 'AIが応答できませんでした。時間をおいて再度お試しください' }, { status: 502 });
      }
      throw e;
    }
  } catch (e) {
    return serverErrorResponse('ai/interview', e);
  }
}
