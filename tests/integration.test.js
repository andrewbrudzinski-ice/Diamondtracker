import './helpers/env.js';
import { seedState, Store } from './helpers/env.js';
import { Engine } from '../js/engine.js';
import { Stats } from '../js/stats.js';
import * as F from './helpers/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// End-to-end: play real plays through the Engine, then read the derived
// box score. This is the Session-2 acceptance check — the per-player "R"
// column must populate for games scored under the new engine.
test('Engine-scored game produces a box score with per-player runs', () => {
  const roster = [
    { id: 'a1', name: 'Andy', num: '1' },
    { id: 'a2', name: 'Beth', num: '2' },
    { id: 'a3', name: 'Cyd', num: '3' },
  ];
  seedState({
    teams: [F.team({ id: 't1', name: 'Aces', players: roster })],
    history: [],
  });
  const g = Engine.newGame({
    away: 'Aces', home: 'Foes', awayRoster: roster, homeRoster: [],
    awayPitcherId: null, homePitcherId: 'foe-p', awayTeamId: 't1',
  });
  Store.get().game = g;

  Engine.actions.single(g); // Andy on first
  Engine.actions.single(g); // Beth on first, Andy to second
  Engine.actions.homer(g);  // Cyd clears the bases — 3 runs in

  assert.equal(g.totals.away.r, 3);

  const box = Stats.gameBox(g);
  const byId = Object.fromEntries(box.sides.away.batters.map((b) => [b.id, b.line]));
  assert.equal(byId.a1.r, 1, 'Andy scored');
  assert.equal(byId.a2.r, 1, 'Beth scored');
  assert.equal(byId.a3.r, 1, 'Cyd scored on the homer');
  // sanity: team runs equal the sum of individual runs
  const totalR = box.sides.away.batters.reduce((n, b) => n + b.line.r, 0);
  assert.equal(totalR, g.totals.away.r);
});

test('pitch counts accumulate to the fielding pitcher in the box score', () => {
  const roster = [{ id: 'a1', name: 'Andy' }, { id: 'a2', name: 'Beth' }];
  seedState({ teams: [F.team({ id: 't1', name: 'Aces', players: roster })], history: [] });
  const g = Engine.newGame({ away: 'Aces', home: 'Foes', awayRoster: roster, homeRoster: [],
    homePitcherId: 'foe-p' });
  Store.get().game = g;
  // PA 1: ball, strike, single -> 3 pitches; PA 2: strike x3 -> 3 pitches
  Engine.actions.ball(g); Engine.actions.strike(g); Engine.actions.single(g);
  Engine.actions.strike(g); Engine.actions.strike(g); Engine.actions.strike(g);
  const box = Stats.gameBox(g);
  const pitcher = box.sides.home.pitchers.find((p) => p.id === 'foe-p');
  assert.equal(pitcher.line.pitches, 6, '3 + 3 pitches');
});

test('runs survive a persist + reload round-trip through the Store', () => {
  const roster = [{ id: 'a1', name: 'Andy' }, { id: 'a2', name: 'Beth' }];
  seedState({ teams: [F.team({ id: 't1', name: 'Aces', players: roster })], history: [] });
  const g = Engine.newGame({ away: 'Aces', home: 'Foes', awayRoster: roster, homeRoster: [] });
  Store.get().game = g;
  Engine.actions.single(g);
  Engine.actions.homer(g); // Andy + Beth score
  Store.commit();

  const reloaded = Store.load();
  const box = Stats.gameBox(reloaded.game);
  const total = box.sides.away.batters.reduce((n, b) => n + b.line.r, 0);
  assert.equal(total, 2, 'attribution persists across serialization');
});
