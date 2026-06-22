// DiamondTracker — "notify" Edge Function (Supabase / Deno).
// Fans out a Web Push message to stored subscriptions.
//
// Deploy:
//   1) Generate VAPID keys once:  npx web-push generate-vapid-keys
//   2) Set function secrets:
//        supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  \
//                             VAPID_SUBJECT=mailto:you@example.com
//      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//   3) supabase functions deploy notify --no-verify-jwt
//      (--no-verify-jwt because the app calls it with the anon key for a
//       trusted friend group; add your own auth check if you need it.)
//
// Request body: { title, body, url, room }
//   - room set  → only subscriptions for that room
//   - room null → all subscriptions
//
// Dead subscriptions (404/410) are pruned automatically.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const PUB = Deno.env.get("VAPID_PUBLIC_KEY");
  const PRIV = Deno.env.get("VAPID_PRIVATE_KEY");
  const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!PUB || !PRIV) return new Response("VAPID keys not configured", { status: 500, headers: cors });
  webpush.setVapidDetails(SUBJECT, PUB, PRIV);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: { title?: string; body?: string; url?: string; room?: string | null };
  try { payload = await req.json(); } catch { return new Response("Bad JSON", { status: 400, headers: cors }); }

  let q = admin.from("diamondtracker_push").select("endpoint,p256dh,auth");
  if (payload.room) q = q.eq("room", payload.room);
  const { data: subs, error } = await q;
  if (error) return new Response(error.message, { status: 500, headers: cors });

  const msg = JSON.stringify({
    title: payload.title ?? "DiamondTracker",
    body: payload.body ?? "",
    url: payload.url ?? "/",
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try { await webpush.sendNotification(sub, msg); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await admin.from("diamondtracker_push").delete().in("endpoint", dead);

  return new Response(JSON.stringify({ sent, pruned: dead.length, total: subs?.length ?? 0 }),
    { headers: { ...cors, "content-type": "application/json" } });
});
