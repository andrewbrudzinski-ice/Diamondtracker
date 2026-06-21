import './helpers/env.js';
import { seedState } from './helpers/env.js';
import { Teams } from '../js/teams.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('createTeam yields a uniquely-id\'d record with defaults', () => {
  const a = Teams.createTeam('Sluggers', '#abc');
  const b = Teams.createTeam();
  assert.equal(a.name, 'Sluggers');
  assert.equal(a.color, '#abc');
  assert.deepEqual(a.players, []);
  assert.notEqual(a.id, b.id);
  assert.equal(b.name, 'New Team');
});

test('addPlayer appends with id and defaulted fields', () => {
  const t = Teams.createTeam('T');
  Teams.addPlayer(t, { name: 'Pat', num: '7', pos: 'SS' });
  Teams.addPlayer(t, {});
  assert.equal(t.players.length, 2);
  assert.equal(t.players[0].name, 'Pat');
  assert.equal(t.players[0].pos, 'SS');
  assert.equal(t.players[1].pos, 'BN', 'defaults to bench');
  assert.notEqual(t.players[0].id, t.players[1].id);
});

test('byId resolves a team from the store', () => {
  const t = Teams.createTeam('Findme');
  seedState({ teams: [t] });
  assert.equal(Teams.byId(t.id).name, 'Findme');
  assert.equal(Teams.byId('nope'), undefined);
});

test('createLineup seeds the batting order from non-bench players', () => {
  const t = Teams.createTeam('T');
  Teams.addPlayer(t, { name: 'Starter', pos: 'SS' });
  Teams.addPlayer(t, { name: 'Benchwarmer', pos: 'BN' });
  seedState({ teams: [t] });
  const lineup = Teams.createLineup(t.id, 'Game 1');
  assert.equal(lineup.teamId, t.id);
  assert.equal(lineup.order.length, 1, 'bench players are excluded from the order');
  assert.equal(lineup.order[0], t.players[0].id);
});

test('POSITIONS includes the slow-pitch Rover slot', () => {
  assert.ok(Teams.POSITIONS.some((p) => p.code === 'RV'));
});
