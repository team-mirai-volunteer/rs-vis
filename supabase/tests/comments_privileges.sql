-- Run against an isolated database after schema.sql / migration.
begin;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.project_comments', 'transcript', 'SELECT')
      or has_column_privilege(r, 'public.project_comments', 'ip_hash', 'SELECT')
      or has_table_privilege(r, 'public.project_comments', 'INSERT') then
      raise exception 'Private comment access is enabled for %', r;
    end if;
    if not has_column_privilege(r, 'public.project_comments', 'body', 'SELECT')
      or not has_table_privilege(r, 'public.published_project_comments', 'SELECT') then
      raise exception 'Public comment access is missing for %', r;
    end if;
  end loop;
end $$;
rollback;
