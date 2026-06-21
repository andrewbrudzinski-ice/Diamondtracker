# Live Sync (Phase B)

Share one game across devices in real time. **Optional and offline-first** — the
app works exactly as before with no network; sync is layered on top of the
local cache via the `Store` remote seam (`Store.setRemote` / `Store.hydrate`).

## How it works

- One row per **room code** in a Supabase table (`diamondtracker_state`) holds
  the whole app state as JSONB.
- `Store.commit()` writes the local cache (always) and then pushes to the room
  row. Supabase Realtime broadcasts the change; every device in the room
  receives it and mirrors the state. Last-write-wins (fine for one scorekeeper).
- The Supabase JS client is loaded lazily from a CDN only when you connect, so
  the default offline app pulls in **zero dependencies**.

## One-time setup

1. Create a free project at <https://supabase.com>.
2. In the project's **SQL editor**, run [`supabase/schema.sql`](../supabase/schema.sql)
   (creates the table, enables Realtime, and adds open RLS policies).
3. In **Project Settings → API**, copy your **Project URL** and **anon public key**.

## Connect a device

1. Open the app → **More → 📡 Live Sync**.
2. Paste the **Project URL** and **anon key**, choose a shared **room code**
   (e.g. `lions-2026`), and tap **Connect**.
3. Open the app on a second device, enter the **same room code** (and the same
   URL/key), and connect. Both now follow the same live game.

Credentials are stored only in that device's `localStorage` (key `dt.sync`) —
**never committed to the repo**.

## Security note (Phase B)

This is an **accounts-free** setup for a trusted group: anyone with the room
code + anon key can read and write the room. Per-user auth, roles, and
row-level ownership land in **Phase C** (Supabase Auth + RLS). Don't store
sensitive data in shared rooms.

## For developers

- Adapter: [`js/sync.js`](../js/sync.js) — `Sync.makeRemote(client, room)` returns
  a Store-compatible `{ pull, push, subscribe }`; `Sync.connect(cfg)` lazy-loads
  the client and builds it. `makeRemote` is unit-tested with a mock client
  (`tests/sync.test.js`) so the mapping is verified without a network.
- Wiring: `initSync()` in `js/app.js` connects on boot when configured and on
  save, calling `Store.setRemote()` + `Store.hydrate()`. All failures fall back
  to offline silently (status shown in the Live Sync sheet).
