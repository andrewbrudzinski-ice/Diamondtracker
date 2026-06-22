-- ============================================================
-- DiamondTracker — Phase C: account↔player linking + self-service RSVPs
-- Run this AFTER supabase/auth.sql, in the Supabase SQL editor.
--
-- Under auth.sql, only writer roles can touch the shared state row, so a
-- "player" can't write their own RSVP there. These two tables are
-- player-writable: each user owns (and can only write) their own rows.
-- Everyone can READ, so the scorekeeper's app can show who's coming.
-- ============================================================

-- Link an auth user to the roster player they are.
create table if not exists public.diamondtracker_claims (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  player_id   text not null,
  team_id     text,
  created_at  timestamptz not null default now()
);
alter table public.diamondtracker_claims enable row level security;

drop policy if exists "claims read"        on public.diamondtracker_claims;
drop policy if exists "claims self insert" on public.diamondtracker_claims;
drop policy if exists "claims self update" on public.diamondtracker_claims;
drop policy if exists "claims self delete" on public.diamondtracker_claims;
create policy "claims read"        on public.diamondtracker_claims for select using (true);
create policy "claims self insert" on public.diamondtracker_claims for insert with check (auth.uid() = user_id);
create policy "claims self update" on public.diamondtracker_claims for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "claims self delete" on public.diamondtracker_claims for delete using (auth.uid() = user_id);

-- One self-service RSVP per (event, user).
create table if not exists public.diamondtracker_rsvps (
  event_id    text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  player_id   text,
  status      text not null check (status in ('in','out','maybe')),
  updated_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.diamondtracker_rsvps enable row level security;

drop policy if exists "rsvps read"        on public.diamondtracker_rsvps;
drop policy if exists "rsvps self insert" on public.diamondtracker_rsvps;
drop policy if exists "rsvps self update" on public.diamondtracker_rsvps;
drop policy if exists "rsvps self delete" on public.diamondtracker_rsvps;
create policy "rsvps read"        on public.diamondtracker_rsvps for select using (true);
create policy "rsvps self insert" on public.diamondtracker_rsvps for insert with check (auth.uid() = user_id);
create policy "rsvps self update" on public.diamondtracker_rsvps for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rsvps self delete" on public.diamondtracker_rsvps for delete using (auth.uid() = user_id);

-- Realtime (optional): broadcast RSVP changes so the scorekeeper's tally
-- updates live. Safe to skip if you don't need it.
alter publication supabase_realtime add table public.diamondtracker_rsvps;
