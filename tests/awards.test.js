import './helpers/env.js';
import { seedState } from './helpers/env.js';
import { Awards } from '../js/awards.js';
import * as F from './helpers/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('seasonAwards names an MVP from the best qualified hitter', () => {
  seedState({
    teams: [F.team({ id: 't1', name: 'T', players: [
      { id: 'star', name: 'Star', num: '1' },
      { id: 'sub', name: 'Sub', num: '2' },
    ] })],
    history: [F.game({ events: [
      F.homer({ batterId: 'star', side: 'away' }),
      F.homer({ batterId: 'star', side: 'away' }),
      F.double({ batterId: 'star', side: 'away', rbi: 1 }),
      F.out({ batterId: 'sub', side: 'away' }),
      F.out({ batterId: 'sub', side: 'away' }),
      F.out({ batterId: 'sub', side: 'away' }),
    ] })],
  });
  const awards = Awards.seasonAwards(null);
  const mvp = awards.find((a) => a.title === 'MVP');
  assert.ok(mvp, 'an MVP is awarded');
  assert.equal(mvp.playerId, 'star');
  assert.equal(mvp.teamName, 'T');
});

test('Pitcher of the Year goes to the lowest ERA among qualified arms', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'ace', name: 'Ace' }, { id: 'pb', name: 'BP' }] })],
    history: [F.game({ events: [
      F.strikeout({ batterId: 'x', side: 'away', pitcherId: 'ace' }),
      F.out({ batterId: 'x', side: 'away', pitcherId: 'ace' }),
      F.out({ batterId: 'x', side: 'away', pitcherId: 'ace' }),
      F.homer({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
    ] })],
  });
  const poy = Awards.seasonAwards(null).find((a) => a.title === 'Pitcher of the Year');
  assert.ok(poy);
  assert.equal(poy.playerId, 'ace');
});

test('teamRecords reports single-game extremes', () => {
  seedState({
    teams: [],
    history: [
      F.game({ id: 'g1', away: 'A', home: 'B', awayRuns: 12, homeRuns: 1 }),
      F.game({ id: 'g2', away: 'A', home: 'B', awayRuns: 3, homeRuns: 2 }),
    ],
  });
  const recs = Awards.teamRecords(null);
  const mostRuns = recs.find((r) => r.label === 'Most Runs in a Game');
  assert.equal(mostRuns.value, 12);
  assert.equal(mostRuns.team, 'A');
});

test('mvpHistory counts Game MVP awards per player', () => {
  seedState({
    teams: [F.team({ id: 't1', name: 'T', players: [{ id: 'p1', name: 'Pat' }] })],
    history: [
      F.game({ id: 'g1', mvpId: 'p1' }),
      F.game({ id: 'g2', mvpId: 'p1' }),
    ],
  });
  const hist = Awards.mvpHistory(null);
  assert.equal(hist[0].playerId, 'p1');
  assert.equal(hist[0].total, 2);
  assert.equal(Awards.playerMvpCount('p1'), 2);
});
