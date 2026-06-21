# DiamondTracker — Project Handoff

> **Status update:** **Phase A (the multi-file restructure, §6) is complete.** The app that this
> document describes as a single `diamondtracker.html` now lives split across `index.html`,
> `css/styles.css`, and `js/*.js` ES modules (see `README.md` for the layout). The architecture,
> features, and remaining debt below are otherwise unchanged — every module kept its public API.

> A single-file, offline-first softball/baseball scorekeeping web app (think GameChanger),
> built over ~14 sessions. This document is the complete context for continuing development
> in Claude Code. Paste it alongside `diamondtracker.html` and the `test*.js` files.

---

## 1. What the app does

DiamondTracker is a **mobile-first, single-file HTML/CSS/JS application** for scoring and
managing recreational softball/baseball. One person (a scorekeeper) records a game play-by-play
on their phone using an interactive diamond; the app derives full statistics, standings, awards,
spray charts, and visual replays from the recorded events. It also handles team management,
scheduling with RSVPs, and tournament brackets.

**Core design philosophy:**
- **No frameworks, no backend, no build step.** Pure HTML/CSS/vanilla JS in one file.
- **Offline-first.** All data in `localStorage`. Works with zero network.
- **Mobile-first.** Designed for one-handed phone use during a live game.
- **Event-sourced.** Every play is an immutable event appended to a log. *All* stats,
  scorebook entries, replays, undo, seasons, and awards are **derived** from that event
  log — there is no parallel bookkeeping to keep in sync.
- **Dark mode default**, with a "Stadium Lights" visual identity (deep night-stadium palette,
  clay/flame accent `#ff6b35`, generated SVG team crests and player avatars).

The intended user is a friend-group / rec-league organizer who wants polished, shareable
software for their games without paying for or depending on a SaaS product.

---

## 2. Completed features

### Live scorekeeping
- Interactive SVG **baseball diamond as the primary scoring surface** (large, central).
- **Tap-to-place hit location** → auto-detects one of 11 named field zones (P, C, 1B, 2B,
  SS, 3B, LF, LC, CF, RC, RF) from x/y geometry; arms via a "tap then mark the field" flow.
- **Smart play builder**: pick a hit type, then tap the field; runners auto-advance the
  standard amount with a "drag to adjust" suggestion banner.
- **Runner drag-and-drop**: press-hold a runner puck, drag to a base, release →
  **Safe / Out / Error / Fielder's Choice** prompt with correct stat effects. Tap-to-advance
  retained as a fallback.
- Pitch tracking (balls/strikes/fouls with auto-walk at 4, auto-K at 3, fouls cap at 2).
- All standard outcomes: 1B/2B/3B/HR, walk, error, steal, ground/fly out, strikeout,
  sac fly, fielder's choice, double play, generic out.
- Linescore (R/H/E per inning), 40-deep **undo**, end/save to archive.
- **Live box score** (classic layout): team R/H/E/LOB totals, batting box (AB/R/H/RBI/BB/SO/AVG),
  pitching box (IP/H/R/BB/SO/ERA). Updates live.

### Digital scorebook & replay
- Full play-by-play grouped by inning/half, with hit location shown per play.
- **Visual play replay**: tap any play → field shows gold ball-flight line + blue runner-movement
  arrows + final base occupancy, with prev/next navigation through the game.
- Each event snapshots `basesBefore`/`basesAfter`/`outsAfter`/`scoreAfter` at record time so
  replay is exact (not re-simulated).

### Teams & rosters
- Persistent teams with rosters (name, number, position, bats/throws).
- Player profiles / trading-card modal with career stats, milestones, pitching line, spray chart,
  season-by-season breakdown.
- Drag-and-drop **lineup builder** (batting order + defensive positions, slow-pitch Rover + EH supported).
- **Team logos**: upload via camera / photo library / file (`<input type=file accept=image/*>`),
  auto-cropped square + downscaled to 256px JPEG, stored as base64. Rendered everywhere via the
  single `Crest.team()` chokepoint, clipped into the shield silhouette.

### Statistics
- Batting: AVG/OBP/SLG/OPS, plus counting stats (H, 1B, 2B, 3B, HR, RBI, BB, K, SB, TB).
- Pitching: IP, BF, H, K, BB, ERA (RA-based approximation), WHIP.
- **Stats / Leaders hub** (dedicated STATS tab): 12 batting + 7 pitching leaderboard categories
  with batting/pitching toggle and "All N" full-list modals.
- **Spray charts** on actual field diagrams (player / team / opponent), auto-populated from
  located hits.

### Seasons & career
- Multiple seasons; each game stamped with `seasonId`. Active season chosen via a season manager.
- `league({seasonId})` scopes all stats; career = all seasons combined.
- Season chip bar on the stats hub. Career milestones (rec-tuned thresholds) as badges.

### Awards & records
- **Season awards** (auto-derived, season-scoped): MVP (OPS×√PA composite +HR/RBI),
  Offensive Player of the Year, Pitcher of the Year (lowest ERA), Most Improved (OPS jump vs
  prior season).
- **Team records**: Most Runs in a Game, Largest Margin of Victory, Longest Win Streak,
  Highest Team Avg.
- Third "🏆 Awards" toggle in the stats hub.

### Game MVP
- After a game ends, pick a Game MVP from any participant (auto-suggests top performer).
- **Template-generated recap** ("X earned Game MVP honors after going 4-for-4 with a home run
  and 5 RBI, helping lead Team to a 12-7 victory over Opp.") — *not* a real LLM yet; structured
  for a clean swap to an API call later.
- MVP badge on game review + player cards; **MVP leaderboard** on the awards screen.

### Scheduling & RSVPs
- Schedule of games / practices / tournaments / events, grouped by relative time
  (Today / Tomorrow / This Week / Next Week / month).
- Event editor (type, title, team, datetime, location, notes).
- **RSVPs**: per-event roster with one-tap In / Maybe / Out toggles and a summary tally.
  *Manager-entered* (single-device) — true self-service RSVPs need accounts/sync.
- "Up Next" surfaces the next events on the home dashboard.

### Tournaments & brackets
- **Single elimination** (standard seeding, auto-byes for non-power-of-2 fields), displayed as a
  scrollable horizontal bracket.
- **Round robin** (every team plays each other; live standings table by W/L/PCT/diff).
- **Double elimination** (winners bracket + grand final; losers routing is simplified — see debt).
- **Live advancement**: record a match score → winner flows into the next slot automatically;
  champion banner when the final resolves. Clearing a result rolls advancement back.

### App-wide
- Home dashboard (hero game card, league leaders, standings, recent results, up-next).
- Light/dark theme toggle, JSON export of all data, full reset.
- Bottom nav: HOME/LIVE, BOOK, TEAMS, STATS, MORE (Schedule + Tournaments live under MORE).

---

## 3. Unfinished features & planned enhancements

These were intentionally deferred — most require a backend (Supabase), which is the agreed next phase.

### Requires backend (the "cloud cluster")
- **User accounts & authentication.**
- **Roles & permissions**: admin / manager / scorekeeper / player / fan (enforced at the DB level).
- **Real-time multi-device sync** (e.g. one scorekeeper in the dugout, others following live).
- **Self-service RSVPs** (each player responds from their own device).
- **Public fan-facing live game page** (follow without refreshing).
- **Communication hub**: announcements, chat, push notifications.
- **Real AI features** (replace templates with actual LLM calls):
  - AI MVP summaries / game recaps.
  - Season stories, player/team reports.

### Local-feasible enhancements still open
- **Per-player Runs scored attribution.** The engine tracks *team* runs but not which individual
  runner crossed home, so the box score's batter "R" column shows "–". Fixing this completes
  batting lines and the box score.
- **Defensive notation & fielding stats**: 6-4-3 double plays, putouts/assists/errors per fielder,
  with the ball path shown on the replay field. (Lowest priority per the original owner; blocks
  Defensive Player of the Year and a true fielding box.)
- **Rookie of the Year** award (needs a per-player "first season" flag).
- **Link bracket matches to the live scorer** (currently bracket results are entered as final
  scores; "play this match live" would tie them together).
- **Rigorous double-elimination** losers-bracket routing.
- **Co-ed / courtesy-runner / pitch-arc rules**: currently *tracked & displayed* but not
  hard-enforced (situational; no clean automatic trigger).
- **MVP season vs tournament split** (currently season-only; tournaments don't feed MVP history yet).

### Architecture work agreed for the next phase
- **Multi-file restructure** (see roadmap §6). The single file is ~5,000 lines and past comfortable.
- Wire **Supabase** behind the existing `Store` abstraction.

---

## 4. Architecture & important implementation details

### File & size
- Everything lives in **`diamondtracker.html`** — ~4,984 lines / ~236 KB.
- Structure: `<style>` block (~730 lines CSS) → `<script>` block (~4,000 lines JS) → tiny HTML shell.
- Storage key: **`localStorage['diamondtracker.v1']`**. Data version field `_v` is currently **5**.

### Module map (all IIFEs returning a small public API)
| Module | Responsibility | Key exports |
|---|---|---|
| `Store` | localStorage persistence + migrations + pub/sub | `load, get, commit, sub` |
| `Engine` | game reducer over events; rules enforcement | `newGame, actions, currentBatter, battingTeam, fieldingTeam, isMercyOrDone, endHalfPublic, defaultRules, runLimitFor, runCapReached, RULE_PRESETS` |
| `Teams` | rosters, lineups, positions | `createTeam, addPlayer, byId, …` |
| `Crest` | SVG team crests (+ logo support) & player avatars | `team, player, initials, shade, readable` |
| `Field` | diamond geometry, zone detection, spray chart, replay field | `zoneFor, bigDiamond, sprayChart, replayField, …` |
| `Standings` | W/L/diff from game history (season-scopable) | `compute, teamRecord, recentResults` |
| `Stats` | all derived batting/pitching/leader/career/spray/box numbers | `league, playerBatting, playerPitching, leaders, pitchLeaders, leaderTable, seasonBreakdown, careerBatting, careerPitching, milestones, gameBox, sprayData, …` |
| `Awards` | MVP/POY/records derivation + MVP history | `seasonAwards, teamRecords, mvpHistory, playerMvpCount` |
| `Schedule` | events + RSVPs | `TYPES, create, update, remove, upcoming, past, byId, setRsvp, rsvpTally` |
| `Tournament` | bracket generation + advancement | `FORMATS, create, setResult, clearResult, standings, rounds, teamInSlot, winnerTeamId, …` |

The rest of the JS is the **UI / render layer**: top-level `render()` dispatches on `activeView`
(`score, book, history, teams, stats, schedule, tournaments, more`) to `renderX()` functions that
return HTML strings injected into `#app`. State lives in module-level `let`s
(`activeView, pendingPlay, statsMode, statsSeasonId, openTournamentId, …`). UI re-renders by
rebuilding HTML strings (no virtual DOM).

### Event-sourcing model (most important concept)
- A game has `events: []`. Every action appends one event via `pushEvent()`, the single chokepoint
  that also stamps `batterId, pitcherId, side, teamId`, base snapshots, outs, and score.
- `Stats.league()` / `tallyGame()` replay events to compute all numbers. Filtering events by
  `seasonId` gives seasons; by `playerId`/`teamId` gives splits; replaying one game gives the box score.
- **Why it matters:** adding seasons, awards, spray charts, and replay required *no* schema changes —
  just new filters/derivations over the same log. Keep this property when refactoring.

### Storage abstraction (the seam for Supabase)
- All persistence goes through `Store` (`_read`/`_write` internally, `load/get/commit/sub` publicly).
- `commit()` writes to localStorage and notifies subscribers (`sub`), which triggers `render()`.
- **Swapping to Supabase is meant to be a contained change inside `Store`** — the rest of the app
  only calls `Store.get()/commit()`. This was a deliberate session-1 decision.

### Data migrations
- `Store.migrate(s)` upgrades old saves forward and **must never crash on old data**. Current chain:
  - `_v<2`: ensure `teams`/`lineups`.
  - `_v<3`: introduce `seasons` + `currentSeasonId`; fold existing games into "Season 1".
  - `_v<4`: ensure `schedule`.
  - `_v<5`: ensure `tournaments`.
- When adding state, bump `_v` and add a migration step. New fields should default so prior games behave identically.

### Rules engine
- Each game carries a `rules` object (`defaultRules()` = standard baseball, no caps).
- Enforced live: **run limit per inning** (clamps runs in `addRun`, auto-retires the side on cap),
  **open final inning**, **configurable mercy** (in `isMercyOrDone`).
- Tracked-only: co-ed required, courtesy runners, pitch arc.
- Presets in `Engine.RULE_PRESETS` (standard, slowpitch, rec, coed, tournament).

### Visual / rendering
- SVG field uses a 0–100 viewBox; home plate at `[50,86]`, bases at 1B`[68,68]`, 2B`[50,58]`, 3B`[32,68]`.
- Runner drag pucks are an **HTML overlay** layered on the SVG (positioned by % matching base coords) —
  more reliable for touch than dragging SVG nodes. The overlay box is sized/centered to match the SVG.
- Crests/avatars are generated SVG; uploaded logos are clipped into the shield path.

### Testing & tooling (in the working dir, NOT shipped)
- **23 headless Node test files** `test*.js` (test3 unused). They regex-extract the `<script>` block,
  stub `localStorage`/`document`/`navigator`, `eval` it, and assert against the real modules.
  ~451 assertions total. Run pattern:
  ```
  for t in test test2 test4 test5 test6 test7 test8 test9 test10 test11 test12 \
           test13 test14 test15 test16 test17 test18 test19 test20 test21 test22 test23; do
    node $t.js
  done
  ```
- Syntax/brace check: extract `<script>` to `/tmp/script.js`, `node --check`, plus a brace-balance count.
- **Playwright screenshot scripts** `shoot*.py` (Chromium) render the file at 390×844 to verify visuals.
- Every session followed: read code → build in working dir → write headless tests on the logic →
  screenshot to verify visuals → full regression → ship.

---

## 5. Known bugs & technical debt

1. **Per-player Runs (R) not tracked.** Box-score batter "R" column renders "–"
   (`rbiRunsApprox()` returns a dash). Engine knows team runs, not who scored. *Highest-value fix*
   for stat completeness.
2. **ERA is RA-based**, not truly *earned* — the engine doesn't distinguish runs that scored via
   error. Fine for rec play; note it if precision matters.
3. **Double elimination losers bracket is simplified** — a single consolidation chain marked with
   `_placeholder`, not strict tournament-standard loser routing. Tracks the right teams for casual
   use; not rigorous. Winners bracket + seeding are correct.
4. **LOB in the box score is approximate** (`reached − scored`, floored at 0), not a precise
   stranded-runner count.
5. **Several engine actions are simplified**: `fieldersChoice`/`stolenBase` act on the lead runner
   only; `doublePlay` removes a lead runner + 2 outs without modeling specific runners. Adequate for
   scoring, not a full baserunning simulation.
6. **Tracked-only rules** (co-ed, courtesy runners, pitch arc) are displayed but not enforced.
7. **No real AI.** MVP summaries are string templates (`generateMvpSummary`). Intentional until backend.
8. **ID generation:** most IDs use `Math.random()` suffixes (collision-safe). Tournaments/schedule use
   a `Date.now()+'_'+seq` counter after a real bug was found where same-millisecond `Date.now()` IDs
   collided. **If you add any loop that mints IDs, use a counter or random suffix — never bare `Date.now()`.**
9. **Monolith size.** ~5,000 lines in one file is past comfortable for editing; this motivates the split.
10. **`file://` today vs. after split.** It currently runs by double-clicking the file. Once split into
    ES modules it must be served over `http://` (local server or GitHub Pages) due to CORS.

---

## 6. Development roadmap (next steps)

### Phase A — Multi-file restructure (do first; no new features)
Split `diamondtracker.html` into a conventional structure. Target layout:
```
/diamondtracker
├── index.html              # shell + <link>/<script type="module">
├── css/
│   └── styles.css          # the entire <style> block
├── js/
│   ├── storage.js          # Store + migrations  (the Supabase seam)
│   ├── engine.js           # Engine + rules
│   ├── teams.js            # Teams + lineups
│   ├── crest.js            # Crest (logos/avatars)
│   ├── field.js            # Field geometry/spray/replay
│   ├── stats.js            # Stats + Standings
│   ├── awards.js           # Awards + MVP
│   ├── schedule.js         # Schedule + RSVPs
│   ├── tournament.js       # brackets
│   ├── views.js            # render* screen functions
│   ├── interactions.js     # act(), runner drag, sheets, box score, MVP picker
│   └── app.js              # boot, render() dispatcher, nav, global state
├── assets/logos/           # (real once cloud storage exists; empty in local build)
└── data/                   # (seed/sample data — optional)
```
- Convert modules to ES modules (`export`/`import`). Keep each module's public API identical so the
  UI layer changes minimally.
- **Rewrite the test harness** to import modules directly instead of regex-extracting `<script>`
  (this gets *easier* after the split). Keep all assertions.
- Serve via a static server / GitHub Pages (CORS blocks `file://` module loading).
- **Acceptance:** all 23 test suites pass against the split modules; screenshots match.

### Phase B — Supabase backend (lightweight first)
- Stand up a Supabase project (Postgres + Auth + Realtime).
- **Start with live game sync only, no accounts** (mirrors the agreed "lightweight path"):
  one shared game-state row, realtime subscription, so multiple devices follow one live game.
- Implement entirely **behind `Store`** — add an async/remote backend while keeping `get/commit/sub`.
  Consider an offline cache + write-through so the app still works without network.
- **Acceptance:** two browsers see the same live game update in real time; offline still works.

### Phase C — Accounts, roles, fan page
- Auth + the five roles (admin/manager/scorekeeper/player/fan) with Row-Level Security.
- Self-service RSVPs. Public read-only **fan live-game page**. Push notifications.

### Phase D — Real AI + remaining stats
- Replace `generateMvpSummary` and add game recaps / season stories via real LLM calls
  (e.g. Anthropic API) — the template functions are already isolated for this swap.
- Close the local stat gaps: **per-player runs scored**, then **fielding stats / defensive notation**
  (unblocks the fielding box and Defensive Player of the Year).

### Guardrails for whoever continues
- Preserve **event-sourcing**: derive stats from `events`, don't add parallel counters.
- Keep persistence behind **`Store`**; that's the only place that should know about localStorage/Supabase.
- Every new state field → **bump `_v` + add a non-destructive migration**.
- Mint IDs with random or counter suffixes, never bare `Date.now()`.
- Re-run the full test suite + screenshots before shipping each change.
- Default new game-rule fields so existing saved games behave identically.

---

## Quick orientation for a new contributor
1. Open `diamondtracker.html`; read the module IIFEs top-to-bottom (Store → Engine → … → Tournament),
   then the `render()` dispatcher and `renderScore()` to see the live scorer.
2. Run the test suite (commands in §4) to confirm a green baseline.
3. Start with **Phase A** (the split) — it's the unlock for everything else and the file is large.
