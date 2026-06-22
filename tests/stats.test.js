import './helpers/env.js';
import { seedState } from './helpers/env.js';
import { Stats } from '../js/stats.js';
import * as F from './helpers/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A player p1 with a full batting line, pitched to by pit1.
function lineEvents() {
  const b = { batterId: 'p1', side: 'away', pitcherId: 'pit1' };
  return [
    F.single(b),
    F.double({ ...b, rbi: 1 }),
    F.walk(b),
    F.strikeout(b),
    F.out(b),
    F.sacFly(b), // rbi 1 by default
  ];
}

function seedOneGame() {
  return seedState({
    teams: [F.team({ id: 't1', name: 'Test', players: [{ id: 'p1', name: 'Pat', num: '7' }] })],
    history: [F.game({ id: 'g1', events: lineEvents(), awayRuns: 2, awayHits: 2 })],
  });
}

test('batting line aggregates PA/AB/H/RBI correctly', () => {
  seedOneGame();
  const b = Stats.playerBatting('p1');
  assert.equal(b.pa, 6);
  assert.equal(b.ab, 4, 'walk and sac fly are not at-bats');
  assert.equal(b.h, 2);
  assert.equal(b.b1, 1);
  assert.equal(b.b2, 1);
  assert.equal(b.tb, 3);
  assert.equal(b.bb, 1);
  assert.equal(b.k, 1);
  assert.equal(b.sf, 1);
  assert.equal(b.rbi, 2);
  assert.equal(b.games, 1);
});

test('rate stats derive from the line', () => {
  seedOneGame();
  const b = Stats.playerBatting('p1');
  assert.equal(Stats.avg(b), 2 / 4);
  assert.equal(Stats.obp(b), 3 / 6); // (H+BB)/(AB+BB+SF)
  assert.equal(Stats.slg(b), 3 / 4); // TB/AB
  assert.equal(Stats.ops(b), 3 / 6 + 3 / 4);
});

test('pitching line counts batters faced, outs and hits allowed', () => {
  seedOneGame();
  const p = Stats.playerPitching('pit1');
  assert.equal(p.bf, 6);
  assert.equal(p.h, 2);
  assert.equal(p.bb, 1);
  assert.equal(p.k, 1);
  assert.equal(p.outs, 3, 'K + out + sac fly');
  assert.equal(Stats.ipStr(p), '1.0');
});

test('league(false) excludes the live game', () => {
  const s = seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Pat' }] })],
    history: [],
  });
  s.game = F.game({ events: [F.single({ batterId: 'p1', side: 'away' })] });
  const withLive = Stats.league(true).bat.p1;
  const noLive = Stats.league(false).bat.p1;
  assert.ok(withLive && withLive.h === 1);
  assert.equal(noLive, undefined);
});

test('season filter scopes the tally', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Pat' }] })],
    history: [
      F.game({ id: 'g1', seasonId: 's1', events: [F.homer({ batterId: 'p1', side: 'away' })] }),
      F.game({ id: 'g2', seasonId: 's2', events: [F.homer({ batterId: 'p1', side: 'away' })] }),
    ],
  });
  assert.equal(Stats.playerBatting('p1', false, 's1').hr, 1);
  assert.equal(Stats.playerBatting('p1', false, null).hr, 2, 'career spans both seasons');
});

test('leaders ranks counting stats descending and resolves to teams', () => {
  seedState({
    teams: [F.team({ id: 't1', name: 'T', players: [
      { id: 'p1', name: 'Slugger' }, { id: 'p2', name: 'Singles' },
    ] })],
    history: [F.game({ events: [
      F.homer({ batterId: 'p1', side: 'away' }),
      F.homer({ batterId: 'p1', side: 'away' }),
      F.single({ batterId: 'p2', side: 'away' }),
    ] })],
  });
  const hr = Stats.leaderTable('bat', 'hr');
  assert.equal(hr[0].id, 'p1');
  assert.equal(hr[0].val, 2);
  assert.equal(hr[0].name, 'Slugger');
});

test('pitch leaders for ERA sort ascending (lower is better)', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'pa', name: 'Ace' }, { id: 'pb', name: 'Batting Practice' }] })],
    history: [F.game({ events: [
      // ace: 3 outs, 0 runs
      F.strikeout({ batterId: 'x', side: 'away', pitcherId: 'pa' }),
      F.out({ batterId: 'x', side: 'away', pitcherId: 'pa' }),
      F.out({ batterId: 'x', side: 'away', pitcherId: 'pa' }),
      // bp: 3 outs but gives up a homer
      F.homer({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
      F.out({ batterId: 'y', side: 'home', pitcherId: 'pb' }),
    ] })],
  });
  const era = Stats.pitchLeaders('era', { minOuts: 3 });
  assert.equal(era[0].id, 'pa', 'the scoreless pitcher ranks first');
});

test('gameBox splits batters by side and reports team totals', () => {
  const g = F.game({
    away: 'Visitors', home: 'Locals',
    awayRuns: 2, homeRuns: 0, awayHits: 2,
    events: lineEvents(),
  });
  seedState({ teams: [F.team({ players: [{ id: 'p1', name: 'Pat', num: '7' }] })], history: [] });
  const box = Stats.gameBox(g);
  assert.equal(box.sides.away.batters.length, 1);
  assert.equal(box.sides.away.batters[0].name, 'Pat');
  assert.equal(box.totals.away.r, 2);
  assert.equal(box.totals.away.h, 2);
  assert.ok(box.totals.away.lob >= 0);
});

test('spray data collects only located batted balls and filters by player', () => {
  seedState({
    teams: [],
    history: [F.game({ events: [
      F.single({ batterId: 'p1', side: 'away', hx: 40, hy: 30 }),
      F.out({ batterId: 'p1', side: 'away', hx: 60, hy: 20 }),
      F.single({ batterId: 'p2', side: 'away', hx: 50, hy: 50 }),
      F.walk({ batterId: 'p1', side: 'away' }), // no location -> ignored
    ] })],
  });
  assert.equal(Stats.sprayCount(), 3);
  assert.equal(Stats.sprayData({ playerId: 'p1' }).length, 2);
});

test('runs scored are credited to the player who crossed the plate', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Lead' }, { id: 'p2', name: 'Slug' }] })],
    history: [F.game({ events: [
      F.single({ batterId: 'p1', side: 'away' }), // p1 reaches base
      // p2 homers, driving in p1 and themselves
      F.homer({ batterId: 'p2', side: 'away', rbi: 2,
        scored: [{ id: 'p1', name: 'Lead' }, { id: 'p2', name: 'Slug' }] }),
    ] })],
  });
  assert.equal(Stats.playerBatting('p1').r, 1, 'the runner scores a run');
  assert.equal(Stats.playerBatting('p2').r, 1, 'the slugger scores on their own HR');
  assert.equal(Stats.playerBatting('p2').rbi, 2, 'and is credited two RBI');
});

test('gameBox surfaces per-player runs scored', () => {
  const g = F.game({
    away: 'V', home: 'L', awayRuns: 1,
    events: [
      F.single({ batterId: 'p1', side: 'away' }),
      F.homer({ batterId: 'p2', side: 'away', rbi: 1,
        scored: [{ id: 'p1', name: 'Lead' }] }),
    ],
  });
  seedState({ teams: [F.team({ players: [
    { id: 'p1', name: 'Lead' }, { id: 'p2', name: 'Slug' },
  ] })], history: [] });
  const box = Stats.gameBox(g);
  const lead = box.sides.away.batters.find((b) => b.id === 'p1');
  assert.equal(lead.line.r, 1);
});

test('gameLog returns per-game lines newest-first with opponent and result', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Pat' }] })],
    history: [
      F.game({ id: 'g1', created: 100, away: 'Aces', home: 'Foes', awayRuns: 5, homeRuns: 2,
        events: [F.homer({ batterId: 'p1', side: 'away', rbi: 1 })] }),
      F.game({ id: 'g2', created: 200, away: 'Foes', home: 'Aces', awayRuns: 9, homeRuns: 3,
        events: [F.single({ batterId: 'p1', side: 'home' }), F.out({ batterId: 'p1', side: 'home' })] }),
      F.game({ id: 'g3', created: 150, away: 'X', home: 'Y',  // p1 didn't play
        events: [F.single({ batterId: 'other', side: 'away' })] }),
    ],
  });
  const log = Stats.gameLog('p1', { limit: 10 });
  assert.equal(log.length, 2, 'only games p1 appeared in');
  assert.equal(log[0].gameId, 'g2', 'newest first');
  assert.equal(log[0].opp, 'Foes');         // p1 was home (Aces) in g2
  assert.equal(log[0].result, 'L');         // Aces 3, Foes 9
  assert.equal(log[0].bat.h, 1);
  assert.equal(log[1].gameId, 'g1');
  assert.equal(log[1].result, 'W');         // Aces 5, Foes 2 (p1 away)
  assert.equal(log[1].bat.hr, 1);
});

test('gameLog respects the limit', () => {
  const events = [F.single({ batterId: 'p1', side: 'away' })];
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Pat' }] })],
    history: [
      F.game({ id: 'a', created: 1, events }), F.game({ id: 'b', created: 2, events }),
      F.game({ id: 'c', created: 3, events }),
    ],
  });
  assert.equal(Stats.gameLog('p1', { limit: 2 }).length, 2);
});

test('rispBatting counts only plate appearances with a runner on 2nd/3rd', () => {
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Pat' }] })],
    history: [F.game({ events: [
      // RISP: runner on 2nd before the play -> hit counts
      F.single({ batterId: 'p1', side: 'away', basesBefore: [null, { name: 'R', id: 'r' }, null] }),
      // RISP: runner on 3rd -> out counts (AB, no hit)
      F.out({ batterId: 'p1', side: 'away', basesBefore: [null, null, { name: 'R', id: 'r' }] }),
      // bases empty -> ignored
      F.homer({ batterId: 'p1', side: 'away', basesBefore: [null, null, null] }),
      // runner only on 1st -> not scoring position -> ignored
      F.single({ batterId: 'p1', side: 'away', basesBefore: [{ name: 'R', id: 'r' }, null, null] }),
      // no snapshot -> ignored
      F.single({ batterId: 'p1', side: 'away' }),
    ] })],
  });
  const r = Stats.rispBatting('p1');
  assert.equal(r.ab, 2, 'two RISP at-bats');
  assert.equal(r.h, 1, 'one RISP hit');
  assert.equal(Stats.avg(r), 0.5);
});

test('milestones surface achieved career marks', () => {
  const events = [];
  for (let i = 0; i < 5; i++) events.push(F.homer({ batterId: 'p1', side: 'away' }));
  seedState({
    teams: [F.team({ players: [{ id: 'p1', name: 'Bomber' }] })],
    history: [F.game({ events })],
  });
  const m = Stats.milestones('p1');
  assert.ok(m.some((x) => x.label === '5 Home Runs'));
});
