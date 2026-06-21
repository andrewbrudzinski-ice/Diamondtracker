# DiamondTracker

Single-page, offline-first softball/baseball scorekeeping web app (think GameChanger).
No frameworks, no backend, no build step — pure HTML/CSS/vanilla JS, all data in `localStorage`.

> **Read `HANDOFF.md`** for the full context (architecture, features, technical debt, roadmap).
> It describes the original single-file build; this repo is the result of **Phase A** (the
> multi-file restructure) from that roadmap.

## Project structure

```
diamondtracker/
├── index.html            # shell: links css/styles.css + <script type="module" src="js/app.js">
├── css/
│   └── styles.css        # the entire stylesheet ("Stadium Lights" identity)
└── js/
    ├── storage.js        # Store — localStorage persistence + migrations (the Supabase seam)
    ├── engine.js         # Engine — game reducer over events + rules
    ├── teams.js          # Teams — rosters, lineups, positions
    ├── crest.js          # Crest — generated SVG crests/avatars + uploaded logos
    ├── field.js          # Field — diamond geometry, zone detection, spray/replay
    ├── standings.js      # Standings — W/L/diff from history
    ├── stats.js          # Stats — all derived batting/pitching/leader/box numbers
    ├── awards.js         # Awards — MVP/POY/records + MVP history
    ├── schedule.js       # Schedule — events + RSVPs
    ├── tournament.js     # Tournament — brackets + advancement
    └── app.js            # UI layer: render() dispatcher, views, interactions, state, boot
```

The 10 library modules are ES modules (`export` / `import`). `app.js` imports them all and
contains the entire render/interaction/state layer. Because inline `on*=` HTML handlers execute
in global scope, `app.js` exposes the modules and UI functions on `window` (a single
`Object.assign(window, {…})` block, clearly marked).

## Run it

ES modules can't be loaded over `file://` (CORS), so serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Any static server (or GitHub Pages) works. All data persists in `localStorage` under the key
`diamondtracker.v1`.

**Installable (PWA):** served over HTTPS (e.g. GitHub Pages) the app ships a `manifest.json` +
service worker (`sw.js`), so it can be installed to the home screen and launches offline (the
app shell is cached; data is local already). Bump `CACHE` in `sw.js` to ship a new shell.

## Live Sync (optional, Phase B)

Share one game across devices in real time via Supabase — fully **opt-in and offline-first**
(the app is unchanged with no network). Set it up under **More → 📡 Live Sync**; the one-time
project/SQL/keys steps are in [`docs/SYNC.md`](docs/SYNC.md). Credentials live only in the
device's `localStorage`, never in the repo. The Supabase client is lazy-loaded from a CDN only
when you connect, so the default app has zero dependencies.

## Accounts & roles (optional, Phase C)

Sign-in (passwordless email magic link) with five roles — admin / manager /
scorekeeper / player / fan — on top of Live Sync's Supabase project. **Row-Level
Security enforces** who can write a shared room; fans/players are read-only. Set it
up under **More → 👤 Account**; the SQL and role-promotion steps are in
[`docs/AUTH.md`](docs/AUTH.md). Fully optional — the offline local app is unchanged.

## AI write-ups (optional, Phase D)

Generate Game MVP recaps with Claude (`claude-opus-4-8`) instead of the built-in template —
**opt-in and offline-first**. Enable under **More → ✨ AI Write-ups** with an Anthropic API key;
setup and the important client-side-key security note are in [`docs/AI.md`](docs/AI.md). The key
lives only in the device's `localStorage`, never in the repo, and calls go directly to Anthropic
via `fetch` (no SDK/build step).

## Tests

The library modules are covered by a unit-test suite that `import`s them directly (no DOM, no
network, no dependencies). It runs on Node's built-in test runner — there is nothing to install:

```bash
npm test
# equivalent to: node --test "tests/**/*.test.js"
```

```
tests/
├── helpers/
│   ├── env.js          # installs an in-memory localStorage shim; freshStore() / seedState()
│   └── fixtures.js     # builders for teams, games and play-by-play events
├── storage.test.js     # Store: defaults, persistence, listeners, every migration (v?→5)
├── engine.test.js      # Engine: hits, walks, outs, base advancement, run-limit & mercy rules
├── stats.test.js       # Stats: batting/pitching lines, rate stats, leaders, box, spray
├── standings.test.js   # Standings: W/L/T, run diff, sorting
├── awards.test.js      # Awards: MVP / Pitcher of the Year / team records / MVP history
├── schedule.test.js    # Schedule: CRUD, RSVPs, upcoming/past partition
├── tournament.test.js  # Tournament: seeding, bracket gen, advancement, round-robin standings
├── teams.test.js       # Teams: create/add/lineup
├── crest.test.js       # Crest: monogram, color math, SVG output
├── field.test.js       # Field: angle/zone geometry
└── integration.test.js # Engine -> Stats: per-player runs end-to-end (+ reload round-trip)
```

`tests/helpers/env.js` stands in a minimal `localStorage` so the ES modules import cleanly under
Node. The UI layer (`app.js`) is not unit-tested here — it requires a DOM; verify it by serving
the app and clicking through.

## Sanity checks

```bash
# syntax-check every module
for f in js/*.js; do node --check "$f" || echo "FAIL: $f"; done
```
