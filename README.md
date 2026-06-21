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

## Sanity checks

```bash
# syntax-check every module
for f in js/*.js; do node --check "$f" || echo "FAIL: $f"; done
```

> Note: the original regex-based `test*.js` harness (which extracted the single `<script>` block)
> no longer applies after the split. Per the roadmap it should be rewritten to `import` the
> modules directly — those assertions are unchanged in intent, just sourced from the module files.
