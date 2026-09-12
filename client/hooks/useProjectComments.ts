'use client';

/**
 * 事業コメント一覧の取得フック。再利用可能UI（client/components）から直接 API を叩かないための境界。
 * 機能無効（404）は「非表示」として扱い、エラーにしない。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProjectComment, ProjectCommentsResponse } from '@/types/project-comments';

export interface ProjectCommentsState {
  /** undefined = 読み込み中、null = 機能無効（UI ごと出さない） */
  comments: ProjectComment[] | null | undefined;
  total: number;
  nextCursor: string | null;
  error: string | null;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  /** 投稿後などに先頭から再取得 */
  refresh: () => Promise<void>;
}

async function fetchPage(pid: string, year: string, cursor: string | null): Promise<ProjectCommentsResponse | null> {
  const qs = new URLSearchParams({ year });
  if (cursor) qs.set('cursor', cursor);
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/comments?${qs}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`意見の取得に失敗しました（HTTP ${res.status}）`);
  return res.json() as Promise<ProjectCommentsResponse>;
}

export function useProjectComments(pid: string | null, year: string): ProjectCommentsState {
  const [comments, setComments] = useState<ProjectComment[] | null | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = useCallback(async () => {
    if (!pid) return;
    setError(null);
    try {
      const page = await fetchPage(pid, year, null);
      if (page === null) {
        setComments(null);
        setTotal(0);
        setNextCursor(null);
        return;
      }
      setComments(page.comments);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setComments([]);
      setError(e instanceof Error ? e.message : '意見の取得に失敗しました');
    }
  }, [pid, year]);

  useEffect(() => {
    let cancelled = false;
    setComments(undefined);
    if (!pid) return;
    fetchPage(pid, year, null)
      .then(page => {
        if (cancelled) return;
        if (page === null) { setComments(null); setTotal(0); setNextCursor(null); return; }
        setComments(page.comments);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch(e => {
        if (cancelled) return;
        setComments([]);
        setError(e instanceof Error ? e.message : '意見の取得に失敗しました');
      });
    return () => { cancelled = true; };
  }, [pid, year]);

  const loadMore = useCallback(async () => {
    if (!pid || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(pid, year, nextCursor);
      if (page) {
        setComments(prev => [...(prev ?? []), ...page.comments]);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '意見の取得に失敗しました');
    } finally {
      setLoadingMore(false);
    }
  }, [pid, year, nextCursor, loadingMore]);

  return { comments, total, nextCursor, error, loadingMore, loadMore, refresh };
}
