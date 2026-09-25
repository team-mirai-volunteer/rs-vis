-- 事業コメントの一覧を事業ID単位（年度をまたぐ）で取得するようにしたため、
-- (pid, status, created_at desc) の索引を追加する。旧索引 (pid, year, status, created_at desc) は
-- 年度で絞らない一覧の並び替えに使えないので置き換える。
create index if not exists project_comments_list_by_pid_idx
  on public.project_comments (pid, status, created_at desc);
drop index if exists public.project_comments_list_idx;
