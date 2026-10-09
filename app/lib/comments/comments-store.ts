/**
 * project_comments の読み書き（サーバ専用・service role）。HTTP や React はここに置かない。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InterviewTurn, ProjectComment, ProjectCommentsResponse } from '@/types/project-comments';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

interface CommentRow {
  id: string;
  body: string;
  created_at: string;
  year: number;
}

/**
 * 公開済み意見を新しい順に返す（cursor = この created_at より前）。
 * 事業IDは年度をまたいで同じ事業を指すため、年度では絞らず事業ID単位でまとめる（各行の year は出典として返す）。
 */
export async function listPublishedComments(
  db: SupabaseClient,
  pid: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<ProjectCommentsResponse> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

  let query = db
    .from('project_comments')
    .select('id, body, created_at, year', { count: 'exact' })
    .eq('pid', pid)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit + 1); // 次ページ有無の判定用に1件多く取る
  if (opts.cursor) query = query.lt('created_at', opts.cursor);

  const { data, error, count } = await query;
  if (error) throw new Error(`project_comments の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as CommentRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const comments: ProjectComment[] = page.map(r => ({ id: r.id, body: r.body, createdAt: r.created_at, year: r.year }));
  return {
    comments,
    total: count ?? comments.length,
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

/** レート制限を消費し、上限内なら true */
export async function consumeRateLimit(db: SupabaseClient, ipHash: string, limitPerHour: number): Promise<boolean> {
  const { data, error } = await db.rpc('bump_rate_limit', { p_ip_hash: ipHash, p_limit: limitPerHour });
  if (error) throw new Error(`rate_limits の更新に失敗しました: ${error.message}`);
  return data === true;
}

/** 意見を保存し id を返す */
export async function insertComment(
  db: SupabaseClient,
  input: {
    pid: string;
    year: number;
    body: string;
    transcript: InterviewTurn[];
    status: 'published' | 'hidden';
    ipHash: string;
  },
): Promise<string> {
  const { data, error } = await db
    .from('project_comments')
    .insert({
      pid: input.pid,
      year: input.year,
      body: input.body,
      // 対話ログは非公開で保存し、運営・政策の検討・不正対策に使う（みらい議会と同じ扱い。
      // 利用規約 第4条・プライバシーポリシー 2 項で明示し、投稿をもって同意とみなす）。
      // 公開ロールには列権限が無いので transcript が外に出ることはない
      transcript: input.transcript,
      status: input.status,
      ip_hash: input.ipHash,
    })
    .select('id')
    .single();
  if (error) throw new Error(`project_comments への保存に失敗しました: ${error.message}`);
  return (data as { id: string }).id;
}
