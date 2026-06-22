-- ============================================================
-- DiamondTracker — Phase C: push subscriptions
-- Run this AFTER supabase/auth.sql, in the Supabase SQL editor.
--
-- Stores Web Push subscriptions. Each device upserts its own row
-- (keyed by endpoint). The notify Edge Function reads them with the
-- service-role key to fan out pushes; clients only write their own.
-- ============================================================

create table if not exists public.diamondtracker_push (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_id     uuid references auth.users(id) on delete cascade,
  room        text,
  created_at  timestamptz not null default now()
);
alter table public.diamondtracker_push enable row level security;

-- A client may write/replace/remove its own subscription. (Anon devices
-- have user_id = null; they can still insert their endpoint row.)
drop policy if exists "push insert" on public.diamondtracker_push;
drop policy if exists "push update" on public.diamondtracker_push;
drop policy if exists "push delete" on public.diamondtracker_push;
create policy "push insert" on public.diamondtracker_push
  for insert with check (user_id is null or auth.uid() = user_id);
create policy "push update" on public.diamondtracker_push
  for update using (user_id is null or auth.uid() = user_id)
            with check (user_id is null or auth.uid() = user_id);
create policy "push delete" on public.diamondtracker_push
  for delete using (user_id is null or auth.uid() = user_id);
-- No SELECT policy for clients — only the Edge Function (service role,
-- which bypasses RLS) reads subscriptions.
