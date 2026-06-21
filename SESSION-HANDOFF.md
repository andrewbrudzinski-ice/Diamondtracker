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
- **Where we are:** **Phase A (multi-file restructure) is DONE and pushed** to branch
  `claude/vigilant-mayer-k9qsc9`. The old ~5,000-line single `index.html` is now split into
  `css/styles.css` + ES-module `js/*.js` files. No behavior changed.
- **What's next:** Phase B (Supabase live-sync), then C (accounts/roles/fan page), then
  D (real AI + remaining stats). Details in §4 below.
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
1. **Per-player Runs scored (R)** — engine tracks *team* runs, not who crossed home, so the box
   score batter "R" column shows "–". Fixing this completes batting lines. *Top stat fix.*
2. **Fielding stats / defensive notation** (6-4-3 DPs, PO/A/E per fielder) — unblocks the
   fielding box + Defensive Player of the Year. (Lowest priority per owner.)
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

### Session 1 — Land Phase A + restore the test harness
- Open a PR for `claude/vigilant-mayer-k9qsc9` → `main` and merge it (Phase A).
- **Rewrite the test suite to ES modules**: each `test*.js` should `import { Store, Engine, … }
  from '../js/…'` instead of regex-extracting `<script>`. Stub `localStorage`/`document`/
  `navigator` as before. Keep every assertion.
- **Acceptance:** all suites pass against the split modules; `node --check` clean; screenshots
  match the pre-split app.

### Session 2 — Per-player Runs scored (highest-value local fix)
- Extend the engine so each run is attributed to the **runner who scored** (stamp the scoring
  `playerId` on the run event / in the base-advance resolution).
- Bump `Store` `_v` (currently 5 → 6) with a **non-destructive migration** (old games keep
  team totals; batter R can stay "–" for legacy games or be back-derived if feasible).
- Wire it into `Stats.gameBox` / batting lines; replace the `rbiRunsApprox()` dash.
- **Acceptance:** box-score "R" column populates for new games; all existing tests still pass;
  add tests for run attribution.

### Session 3 — Phase B groundwork: make `Store` async-capable
- Refactor `Store` so `get/commit/sub` can sit in front of an **async/remote backend** without
  the UI noticing — e.g. keep an in-memory + localStorage cache with write-through, and an
  internal `_backend` interface. **No Supabase yet**; just the seam, fully working offline.
- **Acceptance:** app behaves identically offline; `Store` exposes a clean place to plug a
  remote backend; tests green.

### Session 4 — Phase B: Supabase live game sync (no accounts)
- Stand up a Supabase project (Postgres + Realtime). Start with **live game sync only**: one
  shared game-state row + a realtime subscription so multiple devices follow one live game.
- Implement entirely **behind `Store`** (offline cache + write-through; app still works with no
  network). Keep secrets/config out of the repo.
- **Acceptance:** two browsers see the same live game update in real time; offline still works.

### Session 5+ — Phase C (accounts, roles, fan page) & Phase D (real AI + fielding)
- **Phase C:** Supabase Auth + five roles (admin/manager/scorekeeper/player/fan) with
  Row-Level Security; self-service RSVPs; public read-only **fan live-game page**; push
  notifications.
- **Phase D:** replace `generateMvpSummary` template with real LLM calls (Anthropic API — use
  the latest Claude model; the template fn is already isolated for the swap) for MVP summaries,
  game recaps, season stories. Then close remaining stat gaps (**fielding stats / defensive
  notation** → fielding box + Defensive Player of the Year).

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
