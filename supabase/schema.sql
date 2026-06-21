-- ============================================================
-- DiamondTracker — Phase B live sync schema (Supabase / Postgres)
-- Run this once in the Supabase SQL editor for your project.
--
-- Model (v1, no accounts): one row per shared ROOM holds the whole
-- app state as JSONB. Devices in the same room read/write that row
-- and follow it over Realtime. Last-write-wins.
--
-- NOTE: this is an OPEN, accounts-free setup for a trusted friend
-- group — anyone with the room code + anon key can read/write the
-- room. Real auth + per-room ownership arrives in Phase C (RLS by
-- user/role). Do not store sensitive data here.
-- ============================================================

create table if not exists public.diamondtracker_state (
  id          text primary key,             -- the room code
  state       jsonb not null,               -- the entire Store state blob
  updated_at  timestamptz not null default now()
);

-- Realtime: broadcast row changes so subscribers get live updates.
alter publication supabase_realtime add table public.diamondtracker_state;

-- Row Level Security: enabled, with open policies for the anon role
-- (Phase B has no accounts). Tighten these in Phase C.
alter table public.diamondtracker_state enable row level security;

drop policy if exists "dt anon read"   on public.diamondtracker_state;
drop policy if exists "dt anon write"  on public.diamondtracker_state;
drop policy if exists "dt anon update" on public.diamondtracker_state;

create policy "dt anon read"   on public.diamondtracker_state
  for select using (true);
create policy "dt anon write"  on public.diamondtracker_state
  for insert with check (true);
create policy "dt anon update" on public.diamondtracker_state
  for update using (true) with check (true);
