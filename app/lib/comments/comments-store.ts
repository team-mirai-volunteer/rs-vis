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
}

/** 公開済み意見を新しい順に返す（cursor = この created_at より前） */
export async function listPublishedComments(
  db: SupabaseClient,
  pid: string,
  year: number,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<ProjectCommentsResponse> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

  let query = db
    .from('project_comments')
    .select('id, body, created_at', { count: 'exact' })
    .eq('pid', pid)
    .eq('year', year)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit + 1); // 次ページ有無の判定用に1件多く取る
  if (opts.cursor) query = query.lt('created_at', opts.cursor);

  const { data, error, count } = await query;
  if (error) throw new Error(`project_comments の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as CommentRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const comments: ProjectComment[] = page.map(r => ({ id: r.id, body: r.body, createdAt: r.created_at }));
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
      // Interview history is transient: posting the summary does not authorize
      // retaining the user's full conversation (which may contain personal data).
      transcript: null,
      status: input.status,
      ip_hash: input.ipHash,
    })
    .select('id')
    .single();
  if (error) throw new Error(`project_comments への保存に失敗しました: ${error.message}`);
  return (data as { id: string }).id;
}
