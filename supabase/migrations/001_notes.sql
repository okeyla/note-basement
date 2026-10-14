-- QuickNote：備忘錄。和 QuickDrop 共用同一個 Supabase 專案，
-- 沿用它的 public.config（存密碼雜湊）與 public.auth_failures（限制密碼嘗試次數）。
-- 所有存取都經過 Edge Function「notes」（service role），
-- 所以資料表開啟 RLS 且不建立任何 policy，瀏覽器無法直接讀寫。

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content text not null default '',
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;
