/**
 * 事業コメント API
 *   GET  /api/projects/[pid]/comments?limit=20&cursor=<createdAt>  公開済み意見の一覧（事業ID単位・年度をまたぐ）
 *   POST /api/projects/[pid]/comments  { year, body, transcript }              同意確定時の保存
 *
 * 機能は Supabase の env（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）が揃っている
 * ときだけ有効。無い環境では素の 404（機能の存在を明かさない）。
 * LLM はBYOKでクライアント側が実行するため、この API は LLM を呼ばない。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { notFound } from 'next/navigation';
import { parseYear, serverErrorResponse } from '@/app/lib/api/api-notes';
import { getProjectDetail } from '@/app/lib/api/project-details-loader';
import { getSupabaseAdmin, hashClientIp, isCommentsEnabled } from '@/app/lib/comments/supabase-admin';
import { consumeRateLimit, insertComment, listPublishedComments } from '@/app/lib/comments/comments-store';
import { screenCommentBody } from '@/app/lib/comments/screening';
import {
  COMMENT_BODY_MAX_CHARS,
  COMMENT_RATE_LIMIT_PER_HOUR,
  INTERVIEW_INPUT_MAX_CHARS,
  TRANSCRIPT_MAX_TURNS,
  type InterviewTurn,
  type PostProjectCommentRequest,
  type PostProjectCommentResponse,
} from '@/types/project-comments';

/** 一覧は短時間だけ CDN キャッシュ（投稿直後の反映を優先） */
const LIST_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';

function isValidPid(pid: string): boolean {
  return /^\d{1,12}$/.test(pid);
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '0.0.0.0';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pid: string }> }) {
  if (!isCommentsEnabled()) notFound();
  try {
    const { pid } = await params;
    if (!isValidPid(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });
    // 旧クライアントが付ける ?year= は無視する（一覧は事業ID単位）
    const limitRaw = Number(req.nextUrl.searchParams.get('limit'));
    const cursor = req.nextUrl.searchParams.get('cursor');

    const db = getSupabaseAdmin()!;
    const result = await listPublishedComments(db, pid, {
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
      cursor: cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : null,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': LIST_CACHE_CONTROL } });
  } catch (e) {
    return serverErrorResponse('projects/comments GET', e);
  }
}

function validateTranscript(input: unknown): InterviewTurn[] | null {
  if (!Array.isArray(input) || input.length > TRANSCRIPT_MAX_TURNS) return null;
  const turns: InterviewTurn[] = [];
  for (const t of input) {
    const role = (t as InterviewTurn)?.role;
    const content = (t as InterviewTurn)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    // assistant 発言は LLM 生成のため入力上限より長くなりうる。保存サイズだけ抑える
    turns.push({ role, content: content.slice(0, role === 'user' ? INTERVIEW_INPUT_MAX_CHARS : 2000) });
  }
  return turns;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ pid: string }> }) {
  if (!isCommentsEnabled()) notFound();
  try {
    const { pid } = await params;
    if (!isValidPid(pid)) return NextResponse.json({ error: 'pid が不正です' }, { status: 400 });

    let body: PostProjectCommentRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'リクエストボディのJSONが不正です' }, { status: 400 });
    }
    const year = parseYear(typeof body?.year === 'string' ? body.year : null);
    if (!year) return NextResponse.json({ error: 'year が不正です' }, { status: 400 });
    if (typeof body?.body !== 'string' || body.body.trim().length === 0 || body.body.length > COMMENT_BODY_MAX_CHARS) {
      return NextResponse.json({ error: `body は1〜${COMMENT_BODY_MAX_CHARS}字の文字列で指定してください` }, { status: 400 });
    }
    const transcript = validateTranscript(body?.transcript ?? []);
    if (!transcript) return NextResponse.json({ error: 'transcript の形式が不正です' }, { status: 400 });
    // 相手の発言が1つも無い transcript（ボタン連打・API 直叩き）は受け付けない
    if (!transcript.some(t => t.role === 'user')) {
      return NextResponse.json({ error: 'インタビューを経た意見のみ投稿できます' }, { status: 400 });
    }
    if (!getProjectDetail(year, pid)) {
      return NextResponse.json({ error: `Project not found: ${pid}` }, { status: 404 });
    }

    const db = getSupabaseAdmin()!;
    const ipHash = await hashClientIp(clientIp(req));
    const allowed = await consumeRateLimit(db, ipHash, COMMENT_RATE_LIMIT_PER_HOUR);
    if (!allowed) {
      return NextResponse.json(
        { error: `投稿が多すぎます。1時間あたり${COMMENT_RATE_LIMIT_PER_HOUR}件までです` },
        { status: 429, headers: { 'Retry-After': '3600' } },
      );
    }

    const text = body.body.trim();
    const screening = screenCommentBody(text);
    const status = screening.ok ? 'published' : 'hidden';
    const id = await insertComment(db, { pid, year: Number(year), body: text, transcript, status, ipHash });

    const response: PostProjectCommentResponse = {
      id,
      status,
      ...(screening.ok ? {} : { reason: screening.reason }),
    };
    return NextResponse.json(response, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverErrorResponse('projects/comments POST', e);
  }
}
