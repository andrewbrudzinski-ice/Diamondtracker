# Accounts & Roles (Phase C)

Add sign-in and role-based permissions on top of Live Sync. **Optional and
offline-first** — with no Supabase project configured, there are no accounts and
the local app is fully editable by anyone, exactly as before. Accounts use the
**same Supabase project as Live Sync** (set that up first — see [`SYNC.md`](SYNC.md)).

Sign-in is **passwordless** (email magic link). Each user has a role; **Row-Level
Security (RLS) is the real enforcement** — the app's UI checks just mirror it.

## Roles

| Role | Can do |
|---|---|
| **admin** | Everything; promotes other users' roles (in Supabase) |
| **manager** | Score/edit shared games; manage teams |
| **scorekeeper** | Score/edit shared games |
| **player** | Read-only in shared rooms (own RSVPs come later) |
| **fan** | Read-only — follow live games |

New sign-ins start as **fan** until promoted. `admin`/`manager`/`scorekeeper` are
the "writers" who can push changes to a shared room.

## One-time setup

1. Set up Live Sync first ([`SYNC.md`](SYNC.md)) — same project.
2. In the Supabase **SQL editor**, run [`supabase/auth.sql`](../supabase/auth.sql).
   This creates the `diamondtracker_profiles` table, auto-creates a `fan` profile
   on signup, and **locks down writes** to the shared state row (reads stay open
   so fans can follow). ⚠️ Until you do step 4, *everyone* is a fan and nobody can
   write the shared room.
3. **Email auth:** in Supabase → **Authentication → Providers**, ensure **Email**
   is enabled. Under **Authentication → URL Configuration**, set the **Site URL**
   (and add your GitHub Pages URL to **Redirect URLs**) so magic-link clicks return
   to the app.
4. **Promote yourself:** sign in once in the app (More → 👤 Account), then run:
   ```sql
   update public.diamondtracker_profiles set role = 'admin'
     where email = 'you@example.com';
   ```
   Sign out/in (or wait for the auth refresh) to pick up the new role.

## Using it

- **More → 👤 Account** → enter your email → **Send magic link** → click the link in
  your inbox. You return signed in; your role shows as a chip.
- Writers can score and edit; fans/players get a "Read-only" toast if they try to
  score a shared game. (Locally, with no project configured, there are no limits.)

## Security model

- **RLS enforces writes server-side.** Even if the client UI were bypassed, the
  `diamondtracker_state` write/update policies reject anyone whose role isn't a
  writer. The client `Auth.canWrite()` checks are UX only.
- Reads are intentionally open (anon `select`) so the upcoming public **fan
  live-game page** can show a room without a login.

## Public fan view

Share a **read-only** live view of a room — no sign-in needed (reads are open under
RLS). In the app → **More → 📡 Live Sync → 📣 Copy fan link**, then send the link.
It opens straight into a fan scoreboard that follows the game live (board, diamond,
count, box score) and updates automatically.

The link carries the room code plus the project URL and **anon** key
(`?fan=1&room=…&sb=…&k=…`). The anon key is public by design — RLS still blocks all
writes — but treat the link as "anyone with it can watch this room." Set your
Supabase **Site/Redirect URLs** so the link's origin is allowed.

## Not yet included (follow-ups)

- Self-service **RSVPs** by players, and an in-app **admin role editor** (today roles
  are set via SQL).
- **Push notifications** — deferred; needs a service worker + push provider
  (a server piece), out of scope for the no-backend build today.

## For developers

- Module: [`js/auth.js`](../js/auth.js) — `Auth.init(client)` attaches the shared
  Supabase client (from `Sync.createClient`), tracks session + role, and exposes
  `signInWithEmail`, `signOut`, `current()`, `onChange()`, and the capability
  helpers (`canWrite`/`canManageTeams`/`isAdmin`). Client injectable → mock-tested
  in `tests/auth.test.js` (no network).
- Wiring: `js/app.js` — `initSync()` shares one client with `Auth.init()`;
  `blockedByRole()` guards the write chokepoints (`act`, `withUndo`, `startGame`,
  `finishGame`); **More → 👤 Account** sheet; `Auth.onChange` re-renders on sign-in.
