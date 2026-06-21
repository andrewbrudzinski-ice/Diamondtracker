import './helpers/env.js';
import { seedState } from './helpers/env.js';
import { Standings } from '../js/standings.js';
import * as F from './helpers/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function seedSeason() {
  seedState({
    teams: [F.team({ id: 't1', name: 'A', color: '#111' })],
    history: [
      F.game({ id: 'g1', away: 'A', home: 'B', awayRuns: 5, homeRuns: 3 }), // A wins
      F.game({ id: 'g2', away: 'B', home: 'A', awayRuns: 2, homeRuns: 7 }), // A wins
      F.game({ id: 'g3', away: 'A', home: 'C', awayRuns: 4, homeRuns: 4 }), // tie
    ],
  });
}

test('compute tallies W/L/T, run diff and win pct', () => {
  seedSeason();
  const table = Standings.compute();
  const a = table.find((r) => r.name === 'A');
  assert.equal(a.w, 2);
  assert.equal(a.l, 0);
  assert.equal(a.t, 1);
  assert.equal(a.rf, 16); // 5 + 7 + 4
  assert.equal(a.ra, 9);  // 3 + 2 + 4
  assert.equal(a.diff, 7);
  assert.equal(a.pct, (2 + 0.5) / 3);
});

test('compute sorts by win pct then run differential', () => {
  seedSeason();
  const table = Standings.compute();
  assert.equal(table[0].name, 'A', 'best record is first');
});

test('compute attaches saved team color when names match', () => {
  seedSeason();
  const a = Standings.compute().find((r) => r.name === 'A');
  assert.equal(a.color, '#111');
});

test('teamRecord returns a zeroed record for unknown teams', () => {
  seedSeason();
  const r = Standings.teamRecord('Nobody');
  assert.deepEqual({ w: r.w, l: r.l, games: r.games }, { w: 0, l: 0, games: 0 });
});
