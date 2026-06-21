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

-- Profiles are readable (to show names/roles); role changes are admin-only
-- (do them in the SQL editor or build an admin tool — see the promote snippet).
drop policy if exists "profiles read" on public.diamondtracker_profiles;
create policy "profiles read" on public.diamondtracker_profiles
  for select using (true);

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

-- The caller's role, for use in policies.
create or replace function public.dt_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.diamondtracker_profiles where id = auth.uid()
$$;

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

-- ---- Promote a user to a role (run after they've signed in once) ----
-- update public.diamondtracker_profiles set role = 'admin'
--   where email = 'you@example.com';
