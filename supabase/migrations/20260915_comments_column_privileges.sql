-- Apply before publishing the application update. Existing private data remain
-- stored, but anonymous and authenticated API callers cannot select them.
begin;
revoke all on public.project_comments from public, anon, authenticated;
grant select (id, pid, year, body, status, created_at)
  on public.project_comments to anon, authenticated;
create or replace view public.published_project_comments
with (security_invoker = true) as
  select id, pid, year, body, created_at
  from public.project_comments where status = 'published';
revoke all on public.published_project_comments from public, anon, authenticated;
grant select on public.published_project_comments to anon, authenticated;
commit;
