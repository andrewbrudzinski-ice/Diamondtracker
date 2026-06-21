import './helpers/env.js';
import { seedState, freshStore } from './helpers/env.js';
import { Stats } from '../js/stats.js';
import { Awards } from '../js/awards.js';
import * as F from './helpers/fixtures.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => freshStore());   // gameBox -> resolve() reads Store; needs a loaded state

// A game where AWAY bats (so HOME fields). Home roster carries positions so
// located outs can be attributed to fielders.
const homeRoster = [
  { id: 'p', name: 'Pitch', pos: 'P' },
  { id: 'c', name: 'Catch', pos: 'C' },
  { id: 'f3', name: 'Firstbase', pos: '1B' },
  { id: 'ss', name: 'Shortstop', pos: 'SS' },
  { id: 'cf', name: 'Center', pos: 'CF' },
];

function gameWith(events) {
  const g = F.game({ away: 'V', home: 'H', events });
  g.home.roster = homeRoster;          // fielding team
  g.away.roster = [];
  return g;
}

test('groundout to short credits SS an assist and 1B a putout', () => {
  const g = gameWith([F.out({ batterId: 'x', side: 'away', bbType: 'ground', zone: 'SS' })]);
  const box = Stats.gameBox(g);
  const byId = Object.fromEntries(box.sides.home.fielders.map((f) => [f.id, f.line]));
  assert.equal(byId.ss.a, 1);
  assert.equal(byId.f3.po, 1);
  assert.equal(byId.ss.po || 0, 0);
});

test('flyout to center credits CF a putout', () => {
  const g = gameWith([F.out({ batterId: 'x', side: 'away', bbType: 'fly', zone: 'CF' })]);
  const cf = Stats.gameBox(g).sides.home.fielders.find((f) => f.id === 'cf');
  assert.equal(cf.line.po, 1);
  assert.equal(cf.line.a, 0);
});

test('a gap zone (LC) is covered by the center fielder', () => {
  const g = gameWith([F.out({ batterId: 'x', side: 'away', bbType: 'fly', zone: 'LC' })]);
  const cf = Stats.gameBox(g).sides.home.fielders.find((f) => f.id === 'cf');
  assert.equal(cf.line.po, 1);
});

test('strikeout credits the catcher a putout', () => {
  const g = gameWith([F.strikeout({ batterId: 'x', side: 'away' })]);
  const c = Stats.gameBox(g).sides.home.fielders.find((f) => f.id === 'c');
  assert.equal(c.line.po, 1);
});

test('a located error charges the fielder an error', () => {
  const g = gameWith([F.error({ batterId: 'x', side: 'away', zone: 'SS' })]);
  const ss = Stats.gameBox(g).sides.home.fielders.find((f) => f.id === 'ss');
  assert.equal(ss.line.e, 1);
});

test('unlocated outs are not attributed to any fielder', () => {
  const g = gameWith([F.out({ batterId: 'x', side: 'away', bbType: 'ground' })]); // no zone
  assert.equal(Stats.gameBox(g).sides.home.fielders.length, 0);
});

test('fielders without positions (manual-entry rosters) get no credit', () => {
  const g = F.game({ events: [F.out({ batterId: 'x', side: 'away', bbType: 'fly', zone: 'CF' })] });
  g.home.roster = [{ id: 'n', name: 'NoPos' }]; // no pos
  assert.equal(Stats.gameBox(g).sides.home.fielders.length, 0);
});

test('fieldLeaders ranks by chances handled, errors as tiebreak', () => {
  seedState({
    teams: [F.team({ players: homeRoster })],
    history: [gameWith([
      F.out({ batterId: 'x', side: 'away', bbType: 'ground', zone: 'SS' }), // ss A, 1B PO
      F.out({ batterId: 'y', side: 'away', bbType: 'ground', zone: 'SS' }), // ss A, 1B PO
      F.out({ batterId: 'z', side: 'away', bbType: 'fly', zone: 'CF' }),    // cf PO
    ])],
  });
  const leaders = Stats.fieldLeaders({ minChances: 1 });
  // 1B has 2 PO, SS has 2 A — both 2 chances; CF has 1
  assert.ok(leaders.length >= 2);
  assert.equal(leaders[0].chances, 2);
  assert.equal(leaders[leaders.length - 1].id, 'cf');
});

test('Defensive Player of the Year is awarded from fielding chances', () => {
  seedState({
    teams: [F.team({ id: 't1', name: 'H', players: homeRoster })],
    history: [gameWith([
      F.out({ batterId: 'x', side: 'away', bbType: 'ground', zone: 'SS' }),
      F.out({ batterId: 'y', side: 'away', bbType: 'ground', zone: 'SS' }),
      F.out({ batterId: 'z', side: 'away', bbType: 'ground', zone: 'SS' }),
    ])],
  });
  const dpoy = Awards.seasonAwards(null).find((a) => a.title === 'Defensive Player of the Year');
  assert.ok(dpoy, 'a DPOY is awarded');
  // 1B handled 3 putouts (3 chances) vs SS 3 assists — tie on chances, both valid winners
  assert.ok(['f3', 'ss'].includes(dpoy.playerId));
});
