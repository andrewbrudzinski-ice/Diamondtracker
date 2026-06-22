# Push Notifications (Phase C, opt-in)

Get a push when a game goes live (and a final score). This is the one feature
that needs a **server** — a Supabase **Edge Function** sends Web Push to stored
subscriptions. Fully opt-in: with nothing configured, the app is unchanged.

Builds on Live Sync (same Supabase project) and the PWA service worker.

## How it works

- A device subscribes via the browser Push API and stores its subscription in
  `diamondtracker_push` (each device writes only its own row).
- When a writer starts/ends a game, the app calls the **notify** Edge Function,
  which reads subscriptions (service role) and sends a Web Push to each.
- The service worker (`sw.js`) shows the notification and, on tap, opens the
  app (the fan link, so it lands on the live view).

## One-time setup

1. **Run the SQL:** in the Supabase SQL editor, run
   [`supabase/push.sql`](../supabase/push.sql) (after `auth.sql`).
2. **Generate VAPID keys** (once):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Keep the **public** and **private** keys.
3. **Set function secrets** ([Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  \
                        VAPID_SUBJECT=mailto:you@example.com
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
4. **Deploy the function:**
   ```bash
   supabase functions deploy notify --no-verify-jwt
   ```
   (`--no-verify-jwt`: the app calls it with the anon key for a trusted friend
   group. Add your own auth check in `index.ts` if you need it.)
5. **Enable in the app:** More → 🔔 Notifications → paste the **VAPID public
   key** → Enable. Grant the browser permission prompt. (The function URL +
   anon key are taken from your Live Sync config; the key is stored only in
   `localStorage` as `dt.push`.)

## Triggers

The app pushes to the room when a **game starts** and when it **ends** (final
score), from the scorekeeper's device. To notify on schedule reminders or RSVPs,
call the function from a Supabase cron/DB trigger with the same body
(`{title, body, url, room}`).

## Requirements & caveats

- HTTPS (or installed PWA) — push requires a secure context and a registered
  service worker. iOS needs the app **installed to the Home Screen** first.
- `room` scopes the fan-out: pass it to target one room, omit for everyone.
- Dead subscriptions (404/410) are pruned automatically by the function.

## For developers

- Client: [`js/push.js`](../js/push.js) (`Push`) — config, `enable`/`disable`,
  `notify`, and pure helpers (`urlB64ToUint8Array`, `subRow`, `notifyBody`)
  unit-tested in `tests/push.test.js`. Service-worker `push`/`notificationclick`
  handlers in `sw.js`.
- Server: [`supabase/functions/notify/index.ts`](../supabase/functions/notify/index.ts)
  (Deno; `npm:web-push` + `npm:@supabase/supabase-js`).
- ⚠️ The browser subscription path and the Edge Function can't be exercised in
  the dev sandbox — verify on a real device against a deployed function.
