-- ============================================================
-- DiamondTracker — Phase C accounts & roles (Supabase Auth + RLS)
-- Run this AFTER supabase/schema.sql, in the Supabase SQL editor.
--
-- This LOCKS DOWN writes to shared rooms: after running it, only
-- signed-in users whose role is admin/manager/scorekeeper can write
-- the state row. Anyone (even anonymous) can still READ, so fans can
-- follow live games. If you want the open, accounts-free Phase B
-- behavior back, re-run the write/update policies from schema.sql.
-- ============================================================

-- One profile row per auth user, holding their role.
create table if not exists public.diamondtracker_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'fan'
              check (role in ('admin','manager','scorekeeper','player','fan')),
  created_at  timestamptz not null default now()
);

alter table public.diamondtracker_profiles enable row level security;

-- Auto-create a profile (role 'fan') the moment a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.diamondtracker_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The caller's role, for use in the policies below. Defined before any
-- policy that references it.
create or replace function public.dt_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.diamondtracker_profiles where id = auth.uid()
$$;

-- Profiles are readable (to show names/roles in the app).
drop policy if exists "profiles read" on public.diamondtracker_profiles;
create policy "profiles read" on public.diamondtracker_profiles
  for select using (true);

-- Admins can change anyone's role (powers the in-app role editor). Non-admins
-- cannot update profiles at all, so no one can self-promote.
drop policy if exists "profiles admin update" on public.diamondtracker_profiles;
create policy "profiles admin update" on public.diamondtracker_profiles
  for update using (public.dt_role() = 'admin')
            with check (public.dt_role() = 'admin');

-- Tighten the shared-state table: keep open READ (fans follow live), but
-- restrict writes to the three writer roles. Replaces the open Phase B
-- insert/update policies from schema.sql.
drop policy if exists "dt anon write"  on public.diamondtracker_state;
drop policy if exists "dt anon update" on public.diamondtracker_state;
drop policy if exists "dt writers insert" on public.diamondtracker_state;
drop policy if exists "dt writers update" on public.diamondtracker_state;

create policy "dt writers insert" on public.diamondtracker_state
  for insert with check (public.dt_role() in ('admin','manager','scorekeeper'));

create policy "dt writers update" on public.diamondtracker_state
  for update using (public.dt_role() in ('admin','manager','scorekeeper'))
            with check (public.dt_role() in ('admin','manager','scorekeeper'));

-- ---- Bootstrap the first admin (run once, after you've signed in) ----
-- The in-app role editor needs at least one admin to exist first:
-- update public.diamondtracker_profiles set role = 'admin'
--   where email = 'you@example.com';
