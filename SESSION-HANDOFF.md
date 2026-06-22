# DiamondTracker — Session Handoff & Roadmap

> **Paste this whole file into a new Claude Code session to continue the project.**
> It is self-contained: it explains what we're building, the current state of the code,
> and a concrete plan for the next several sessions. Deeper feature/architecture detail
> lives in `HANDOFF.md` (in the repo root) — a new session can read it on demand.

---

## 0. TL;DR for a fresh session

- **Repo:** `andrewbrudzinski-ice/diamondtracker` (GitHub).
- **What it is:** a mobile-first, offline-first, **no-framework / no-backend / no-build**
  softball & baseball scorekeeping web app (think a free, self-hosted GameChanger). Pure
  HTML/CSS/vanilla JS; all data in `localStorage`; event-sourced.
- **Where we are:** **Phase A merged to `main`** (PR #1). **Sessions 1 (test harness), 2
  (per-player Runs), and 3 (async-capable `Store`)** are DONE, plus a **4-round premium UI
  pass** (home, live scoring, native motion, depth) — see §4. A 95-assertion suite
  (`npm test`, Node's built-in runner) covers the library modules incl. the new Store seam.
- **What's next:** Phase B — Supabase live game sync. The `Store` seam is ready: implement a
  remote backend (`pull`/`push`/`subscribe`) and plug it in via `Store.setRemote(...)`; call
  `Store.hydrate()` after boot. Then C (accounts/roles/fan page), D (real AI + remaining stats).
- **How to run:** must be served over HTTP now (ES modules):
  `python3 -m http.server 8000` → open `http://localhost:8000/index.html`.
- **Golden rules:** keep event-sourcing; keep all persistence behind `Store`; bump `_v` +
  add a migration for every new state field; never mint IDs with bare `Date.now()`.

---

## 1. What we're building (the vision)

DiamondTracker lets **one scorekeeper record a game play-by-play on their phone** using an
interactive SVG diamond. From that immutable event log, the app **derives everything else**:
full batting/pitching stats, standings, leaderboards, season awards, spray charts, an exact
visual replay, and a digital scorebook. It also manages teams/rosters/lineups, scheduling with
RSVPs, and tournament brackets.

**Design philosophy (do not violate):**
- **No frameworks, no backend, no build step.** Vanilla JS, plain `<script type="module">`.
- **Offline-first.** Works with zero network; all state in `localStorage`.
- **Mobile-first**, one-handed use during a live game. Dark "Stadium Lights" identity
  (night-stadium palette, clay/flame accent `#ff6b35`, generated SVG crests/avatars).
- **Event-sourced.** Every play is an immutable event appended to `game.events`. *All* stats,
  scorebook, replay, undo, seasons, and awards are **derived** from that log — there is no
  parallel bookkeeping to keep in sync. Preserve this when adding features.

Target user: a friend-group / rec-league organizer who wants polished, shareable software
without paying for a SaaS.

A full inventory of **completed features** (live scoring, replay, teams, stats, seasons,
awards, MVP recaps, scheduling, tournaments) is in `HANDOFF.md §2`. It's all built and working.

---

## 2. Current state of the code (post Phase A)

### Actual file layout (as shipped on `claude/vigilant-mayer-k9qsc9`)
```
diamondtracker/
├── index.html            # slim shell: <link css/styles.css> + <script type="module" src="js/app.js">
├── css/
│   └── styles.css        # the entire stylesheet
├── js/
│   ├── storage.js        # Store      — localStorage persistence + migrations  (the Supabase seam)
│   ├── engine.js         # Engine     — game reducer over events + rules
│   ├── teams.js          # Teams      — rosters, lineups, positions      (imports Store)
│   ├── crest.js          # Crest      — generated SVG crests/avatars + logos (imports Store)
│   ├── field.js          # Field      — diamond geometry, zones, spray, replay (imports Crest)
│   ├── standings.js      # Standings  — W/L/diff from history           (imports Store)
│   ├── stats.js          # Stats      — all derived batting/pitching/box numbers (imports Store)
│   ├── awards.js         # Awards     — MVP/POY/records + MVP history    (imports Store, Stats)
│   ├── schedule.js       # Schedule   — events + RSVPs                   (imports Store)
│   ├── tournament.js     # Tournament — brackets + advancement           (imports Store)
│   └── app.js            # the ENTIRE UI layer: render() dispatcher, all renderX views,
│                         #   interactions (act, runner drag, sheets, box score, MVP picker),
│                         #   module-level state, and boot. Imports all 10 modules.
├── HANDOFF.md            # deep project context (features, debt, architecture)
├── README.md             # layout + how to run
└── SESSION-HANDOFF.md    # this file
```

> **Note — deviation from the original §6 plan:** `HANDOFF.md §6` proposed splitting the UI
> into `views.js` / `interactions.js` / `app.js` and merging `Standings` into `stats.js`. We
> instead kept each of the 10 original IIFE modules as its own file and put the **whole UI layer
> in a single `app.js`** (chosen deliberately to avoid a risky shared-state refactor). The 10
> library modules are now real ES modules (`export const X = (()=>{…})()`); `app.js` imports
> them all. Public APIs are unchanged.

### One thing to understand before editing `app.js`
Inline HTML handlers (`onclick="act('single')"`, `Sheet.close()`, etc.) execute in **global
scope**, but `app.js` is an ES module (its own scope). So `app.js` ends with a single, clearly
marked block:
```js
/* ---- expose globals for inline HTML event handlers ---- */
Object.assign(window, { Store, Engine, …, render, act, setView, Sheet, toast, /* …all UI fns */ });
```
**If you add a new top-level UI function that an inline `on*=` handler calls, add it to that
`Object.assign` list** or the handler will throw `X is not defined`. (Functions called only
from other JS don't need this — they're already in module scope.)

### How to run & verify
```bash
# run
python3 -m http.server 8000     # then open http://localhost:8000/index.html

# syntax check every module
for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done
```
Phase A was verified with headless Chromium (no console/page errors; nav + inline handlers
work) and by confirming the JS slices reconstruct **byte-for-byte** to the original.

### Test harness status (action needed)
The original 23 `test*.js` suites (~451 assertions) **regex-extracted the single `<script>`
block and `eval`'d it** — that approach no longer applies after the split and the test files
were not in this repo. **Rewriting them to `import` the modules directly is the first task of
the next session** (see §4, Session 1). The assertions themselves are unchanged in intent.

---

## 3. Known debt & open local-feasible work (from HANDOFF.md §3/§5)

Highest-value, no-backend-needed items:
1. ~~**Per-player Runs scored (R)**~~ — **DONE (Session 2).** Base occupants now carry identity
   as `{name,id}`; run-producing events stamp a `scored:[{id,name}]` list, and `Stats` credits
   each scorer's `r`. Legacy games (no `scored`) show R=0. *Top stat fix — completed.*
2. ~~**Fielding stats / defensive notation**~~ — **DONE.** PO/A/E are derived in `Stats` from
   each located out (the ball's `zone` → the fielding team's roster position), powering a
   Fielding box-score section and **Defensive Player of the Year**. Approximate (unlocated plays
   aren't attributed; errors only when the play has a zone), no engine change/migration.
3. **Rookie of the Year** (needs a per-player "first season" flag).
4. **Rigorous double-elimination** losers-bracket routing (currently simplified).
5. **Link bracket matches to the live scorer** ("play this match live").
6. **MVP season-vs-tournament split** (currently season-only).

Accepted approximations (fine for rec play): ERA is RA-based (not truly earned); LOB is
approximate; `fieldersChoice`/`stolenBase`/`doublePlay` act on the lead runner only; co-ed /
courtesy-runner / pitch-arc rules are tracked & displayed but not hard-enforced.

---

## 4. Planned sessions (the roadmap, broken into concrete units of work)

> Each session is sized to be shippable on its own: make the change, verify (node --check +
> serve + click through), commit, push. Keep the guardrails in §5.

### Session 1 — Land Phase A + restore the test harness  ✅ DONE
- Phase A merged to `main` via PR #1.
- Test suite rewritten as ES modules under `tests/` (Node's built-in runner, zero deps):
  `tests/helpers/env.js` installs an in-memory `localStorage` and `freshStore()`/`seedState()`;
  `tests/helpers/fixtures.js` builds teams/games/events. Run with `npm test`.
- **Result:** all suites pass against the split modules; `node --check` clean. (Browser
  screenshot pass deferred — no browser in the CI/remote env; verify visually when serving.)

### Session 2 — Per-player Runs scored  ✅ DONE
- **Base occupants now carry identity** as `{name,id}` objects (was a bare name string).
  `Engine.runnerName()` / `runnerKey()` read either shape (legacy strings tolerated).
- Run-producing actions (hit/homer/walk-forced/sacFly/stolenBase-of-home/error, plus the UI
  runner-advance/steal/drag-home paths) stamp **`ev.scored = [{id,name}, …]`** — the runners
  who crossed the plate (respecting the slow-pitch run cap, lead runners first).
- `Stats.tallyGame` credits each scorer's `bat[id].r`; box score shows `b.r` (the
  `rbiRunsApprox()` dash is gone).
- `Store` `_v` bumped **5 → 6** with a non-destructive migration (normalizes a live game's
  string bases to objects; finished history games keep string snapshots and show R=0).
- **Acceptance met:** R column populates for new games; full suite green (88 assertions),
  including engine run-attribution tests + an Engine→Stats integration test (incl. a
  persist/reload round-trip).

### Session 3 — Phase B groundwork: make `Store` async-capable  ✅ DONE
- `Store` now layers an optional **remote backend on top of** the localStorage cache (never in
  front), so the app is identical offline. `get/commit/sub` are unchanged for the UI.
- New API on `Store`:
  - `setRemote(backend)` / `getRemote()` — plug in / inspect the remote. Passing `null`
    detaches (and unsubscribes). A backend implements:
    `async pull() -> state|null`, `push(state)` (sync or Promise, fire-and-forget), and
    optional `subscribe(onState) -> unsubscribe` for live remote pushes.
  - `hydrate()` — async; pulls from the remote, **migrates**, caches, and notifies. No-op
    (resolves to current state) when no remote is set.
  - `commit()` — still writes to localStorage + notifies synchronously, then write-through to
    the remote; a failing/absent remote never breaks the offline path.
  - remote `subscribe` pushes are routed through `applyRemote` (migrate → cache → notify).
- **Acceptance met:** offline behavior identical; clean seam for Phase B; suite green (95,
  incl. 7 new seam tests: write-through, failing-push resilience, hydrate+migrate, subscribe,
  detach).

### Session 4 — Phase B: Supabase live game sync (no accounts)  ✅ DONE (code) · ⏳ needs a live project to verify
- `js/sync.js` (`Sync`) implements a Store-compatible remote over a Supabase table row keyed by
  a **room code** (whole-state JSONB, last-write-wins). `makeRemote(client,room)` →
  `{pull,push,subscribe}`; `connect(cfg)` lazy-loads the Supabase client from a CDN (zero deps
  until you opt in). Mock-client tests in `tests/sync.test.js`.
- Wired in `app.js`: `initSync()` connects on boot/save (offline-safe — failures fall back
  silently), via `Store.setRemote()` + `Store.hydrate()`. UI: **More → 📡 Live Sync** sheet
  (URL / anon key / room) with a status pill. Config lives only in `localStorage` (`dt.sync`),
  never in the repo.
- Setup: `supabase/schema.sql` (table + Realtime + open RLS) and `docs/SYNC.md`.
- **Remaining to fully verify (manual):** create a Supabase project, run the SQL, paste URL +
  anon key on two devices with the same room → confirm real-time mirroring. (Couldn't be run
  in the authoring env: no Supabase project + no browser.)
- **Note on model:** v1 shares the *whole* Store state (incl. teams/history), so it suits one
  scorekeeper + followers. If you want game-only sharing (so each device keeps its own
  teams/history), that's a focused follow-up to the adapter + a partial-state seam.

### Phase D (AI write-ups) — MVP recaps  ✅ DONE (code) · ⏳ needs an API key to verify live
- `js/ai.js` (`AI`) calls Claude (**`claude-opus-4-8`**) directly from the browser via `fetch`
  (no SDK/build), with the `anthropic-dangerous-direct-browser-access` header. `complete()` is
  refusal-aware; `mvpPrompt`/`recapPrompt` are pure prompt builders; `fetch` is injectable →
  mock-tested in `tests/ai.test.js` (no network).
- Wired in `app.js`: `setGameMvp()` writes the deterministic template instantly, then
  `enhanceMvpSummary()` upgrades it async (Claude → `Store.commit()` → re-render), tagged
  **✨ AI**; any failure keeps the template. Cached on the game (`mvpSummary`/`mvpSummaryAI`) so
  it isn't re-billed per render. UI: **More → ✨ AI Write-ups** sheet + a Regenerate button on
  the MVP card. Key in `localStorage` (`dt.ai`) only — never in the repo. Docs: `docs/AI.md`.
- **Remaining to verify (manual):** paste an Anthropic key, pick an MVP, confirm the recap.
- **Ready-to-wire follow-ups:** `recapPrompt`/`gameRecap` exist + are tested but only MVP is
  wired — add a "Generate recap" button on the box score / season views. **⚠️ Security:** the
  key is client-side; don't enable AI on a public deploy — proxy it once Phase C adds a backend.

### Phase C (accounts & roles) — core  ✅ DONE (code) · ⏳ needs a live project to verify
- `js/auth.js` (`Auth`) rides the same Supabase project as Live Sync (shares the client from
  `Sync.createClient`). Passwordless email magic-link sign-in; five roles
  (admin/manager/scorekeeper/player/fan) read from a `diamondtracker_profiles` row. Capability
  helpers (`canWrite`/`canManageTeams`/`isAdmin`) mirror RLS. Mock-client tests in
  `tests/auth.test.js`.
- Wired in `app.js`: `initSync()` shares one client with `Auth.init()`; `blockedByRole()`
  guards the write chokepoints (`act`/`withUndo`/`startGame`/`finishGame`) so fans/players are
  read-only; **More → 👤 Account** sheet (magic link, role chip, sign out); `Auth.onChange`
  re-renders. RLS schema `supabase/auth.sql` (profiles + signup trigger + writer-only
  insert/update; reads stay open for fans) and `docs/AUTH.md`.
- **Security:** RLS enforces writes server-side; client checks are UX only. **Remaining to
  verify (manual):** run `auth.sql`, enable Email auth + set Site/Redirect URLs, sign in,
  promote yourself to admin, confirm a fan is read-only.
- **Deferred:** push notifications (needs a service worker + push provider — a server piece,
  out of scope for the no-backend build); in-app role editor + self-service RSVPs.

### Phase C fan live-game page (#1)  ✅ DONE (code) · ⏳ needs a live project to verify
- Public, read-only viewer via a deep link `?fan=1&room=CODE&sb=<url>&k=<anon key>`. `app.js`
  `bootFan()` short-circuits the normal shell: creates a Supabase client from the link, sets a
  read-only remote (`Store.setRemote` + `hydrate`; the fan never commits, so never pushes), and
  `renderFan()` shows a live board + diamond + count + box score that auto-updates via the
  remote subscribe → `Store` notify → render. `render()` early-returns to `renderFan()` when
  `fanMode`. "📣 Copy fan link" button in the Live Sync sheet builds + copies the link.
- **Verify (manual):** connect a writer, copy the fan link, open it in another browser/device →
  watch the scoreboard update live with no sign-in.

### Phase D fielding (#3)  ✅ DONE
- `Stats` derives per-fielder **PO / A / E** from each located out: the event's `zone` maps to
  a position, resolved against the fielding team's roster (`g[side].roster[].pos`). Rules
  (approximate, rec-friendly): strikeout→C PO; flyout/sac→fielder PO; groundout→fielder A + 1B
  PO (or 1B unassisted); DP→A + two PO; FC→A + PO; located error→fielder E. Unlocated plays and
  position-less (manual) rosters aren't attributed. No engine change, no migration.
- `gameBox` returns `sides[].fielders`; `boxScoreHTML` shows a **Fielding** table (PO/A/E).
  `Stats.fieldLeaders()` ranks by chances (PO+A, errors as tiebreak) → **Defensive Player of
  the Year** in `Awards.seasonAwards`. Tests in `tests/fielding.test.js` (10).

### Post-roadmap extras (shipped)
- **AI game recaps** wired into the box score ("✨ Write game recap" → `enhanceGameRecap` →
  `AI.gameRecap`, cached as `recap`/`recapAI`). Season story still TODO.
- **PWA / installable:** `manifest.json` + `icon.svg` + `sw.js` (cache-first app shell,
  background refresh, same-origin only) registered at boot. Installs to home screen; launches
  offline. Bump `CACHE` in `sw.js` for a new shell.

### Post-roadmap extras (shipped, cont.)
- **In-app role editor** (Phase C follow-up): admins manage member roles from **More → Account
  → Manage roles** (`Auth.listProfiles`/`setRole`; `profiles admin update` RLS policy in
  `auth.sql`). Bootstrap the first admin via the SQL snippet, then everyone else in-app.

### Still open / nice-to-have
- ~~player game logs~~ **DONE** — `Stats.gameLog(playerId,{seasonId,includeLive,limit})` powers a
  tappable **Game Log** section on the player card (date · opp · result · AB/H/HR/RBI).
- ~~share card~~ **DONE** — `js/sharecard.js` builds a 1080² result SVG; `shareGameCard()` in
  app.js rasterizes it (canvas) → Web Share API or download. "📸 Share result" on the box score.
- ~~AI season story~~ **DONE** — `AI.seasonPrompt`/`seasonStory`; "✨ Write season story" on the
  Awards view per season (`enhanceSeasonStory`, cached as `season.story`/`storyAI`).
- ~~situational (RISP) splits~~ **DONE** — `Stats.rispBatting()` (derived from each play's
  `basesBefore`); "With RISP" line on the player card.
- Smaller: pitch counts (needs an engine change — only taken pitches emit events today). Push
  notifications (needs a server/service-worker).
- ~~Phase C self-service RSVPs~~ **DONE** — `js/rsvp.js` + `supabase/rsvp.sql`: player-writable
  `diamondtracker_claims` (account↔player) and `diamondtracker_rsvps` tables (RLS `auth.uid()=
  user_id`). UI: "Claim your player" in Account; "Your RSVP" In/Maybe/Out on each event (works
  for read-only roles). Mock-tested.
- Phase C: **push notifications** (needs a server/service-worker). Game-only sync mode (vs
  whole-state).

---

## 5. Guardrails for every session (do not skip)

- **Preserve event-sourcing.** Derive stats from `game.events`; never add parallel counters.
- **All persistence goes through `Store`.** It is the only module that should know about
  localStorage/Supabase. Phase B/C live inside `Store`, not scattered across the UI.
- **Every new state field → bump `Store` `_v` + add a migration** that never crashes on old
  data and defaults new fields so prior saved games behave identically.
- **Mint IDs with a random or counter suffix, never bare `Date.now()`** (same-millisecond
  collisions were a real bug — see HANDOFF.md §5.8).
- **New inline-handler UI functions must be added to the `Object.assign(window, {…})` block in
  `app.js`.**
- **Verify before shipping:** `node --check js/*.js`, serve over HTTP and click through the
  changed flow, run the test suite (once Session 1 restores it), screenshot if visuals changed.
- ES modules require **HTTP** (CORS blocks `file://`) — never tell the user to double-click the
  file anymore.

---

## 6. Quick orientation for a new contributor
1. Read this file, then skim `HANDOFF.md §2` (features) and `§4` (architecture).
2. Serve the app (`python3 -m http.server 8000`) and play one inning to see the live scorer.
3. Read the module files in dependency order: `storage.js → engine.js → teams/crest/field →
   standings/stats → awards → schedule → tournament`, then `app.js` (`render()` dispatcher →
   `renderScore()`).
4. Pick up at **Session 1** above.
