-- AI ナビ（サイト提供 AI・/api/ai/sankey-chat）の対話ログ。
-- 設計: docs/tasks/20261019_0523_AIナビをヘッダーから全ページで呼べるようにする設計.md「対話ログの保存」
--
-- 保存するのはサーバー経由（サイト提供 AI）の会話だけ。BYOK（訪問者のキー・ブラウザ直）はサーバーを通らないので対象外。
-- 個人を特定する情報（IP・UA・Cookie）は持たない。運営・改善、政策の検討、不正対策に使い、原則 7 年で廃棄（プライバシーポリシー第6項）。
-- 書き込みは Next.js API Route（service role）からのみ。公開ロールには一切の権限を付けない。
--
-- 適用方法: psql "$SUPABASE_DB_URL" -f supabase/migrations/20261019_ai_nav_logs.sql
--           または Supabase ダッシュボード → SQL Editor。冪等なので再実行してよい。

create extension if not exists pgcrypto;

create table if not exists public.ai_nav_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  year        text not null,                        -- RS シート年度（'2024' / '2025'）
  page        text,                                 -- 質問したときに見ていたページ名（任意）
  model       text not null,                        -- 応答したモデル（既定モデル。保険モデルへ切り替えた場合も既定名）
  messages    jsonb not null,                       -- 会話の全文 [{role, content}]（末尾がユーザーの質問）
  response    jsonb,                                -- {message, result?, suggestions?}。上流エラー時は null
  outcome     text not null check (outcome in ('result', 'text', 'upstream_error')),
  tool_calls  int  not null default 0,
  cached      boolean not null default false,       -- 応答キャッシュから返したか（LLM を呼んでいない）
  latency_ms  int
);

-- 集計は日付順・結果の種類別が主（未充足需要 = outcome 'text' の質問文を読む）
create index if not exists ai_nav_logs_created_at_idx on public.ai_nav_logs (created_at desc);
create index if not exists ai_nav_logs_outcome_idx on public.ai_nav_logs (outcome, created_at desc);

-- RLS を有効にし、ポリシーを作らない = service role 以外は読めない・書けない
alter table public.ai_nav_logs enable row level security;
revoke all on table public.ai_nav_logs from anon, authenticated;
