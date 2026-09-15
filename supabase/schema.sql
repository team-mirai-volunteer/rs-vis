-- 事業コメント機能（みらい議会ライク AI インタビュー）のスキーマ。
-- 設計: docs/tasks/20260828_1508_事業コメント機能（みらい議会ライク）設計.md
--
-- 適用方法（どちらか）:
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql      # .env の SUPABASE_DB_URL
--   Supabase ダッシュボード → SQL Editor に貼り付けて実行
-- 冪等（IF NOT EXISTS / CREATE OR REPLACE）なので再実行してよい。

create extension if not exists pgcrypto;

-- ── 公開意見 ──
create table if not exists public.project_comments (
  id          uuid primary key default gen_random_uuid(),
  pid         text not null,                       -- 予算事業ID（文字列）
  year        int  not null,                       -- 事業年度（2024 / 2025）
  body        text not null check (char_length(body) between 1 and 1000),
  transcript  jsonb,                               -- 旧インタビュー全文（非公開・新規投稿では保存しない）
  status      text not null default 'published' check (status in ('published', 'hidden')),
  ip_hash     text,                                -- ソルト付きハッシュ（レート制限・荒らし対応）
  created_at  timestamptz not null default now()
);

create index if not exists project_comments_list_idx
  on public.project_comments (pid, year, status, created_at desc);

-- ── レート制限（サーバレスでも効く DB ベースの簡易カウンタ） ──
create table if not exists public.rate_limits (
  ip_hash      text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (ip_hash, window_start)
);

-- 1時間窓でカウントを +1 し、上限以内なら true を返す（原子的）。
-- 古い窓の行は次回呼び出し時にまとめて掃除する。
create or replace function public.bump_rate_limit(p_ip_hash text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_count int;
begin
  delete from public.rate_limits where window_start < now() - interval '2 hours';

  insert into public.rate_limits (ip_hash, window_start, count)
  values (p_ip_hash, v_window, 1)
  on conflict (ip_hash, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- ── RLS ──
-- 書き込みは Next.js API Route（service role）からのみ。anon キーでの INSERT/UPDATE は開けない。
alter table public.project_comments enable row level security;
alter table public.rate_limits      enable row level security;

drop policy if exists "anon can read published comments" on public.project_comments;
create policy "anon can read published comments"
  on public.project_comments
  for select
  to anon, authenticated
  using (status = 'published');

-- RLS limits rows, not columns. Public roles never receive transcript/ip_hash.
revoke all on public.project_comments from public, anon, authenticated;
grant select (id, pid, year, body, status, created_at)
  on public.project_comments to anon, authenticated;
create or replace view public.published_project_comments
with (security_invoker = true) as
  select id, pid, year, body, created_at
  from public.project_comments where status = 'published';
revoke all on public.published_project_comments from public, anon, authenticated;
grant select on public.published_project_comments to anon, authenticated;

-- rate_limits はポリシー無し = service role 以外はアクセス不可
revoke all on public.rate_limits from anon, authenticated;
revoke execute on function public.bump_rate_limit(text, int) from public, anon, authenticated;
grant  execute on function public.bump_rate_limit(text, int) to service_role;
