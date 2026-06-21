import './helpers/env.js';
import { Store, freshStore } from './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('defaultState seeds the expected shape', () => {
  const s = freshStore();
  assert.equal(s.game, null);
  assert.deepEqual(s.history, []);
  assert.deepEqual(s.teams, []);
  assert.deepEqual(s.lineups, []);
  assert.deepEqual(s.schedule, []);
  assert.deepEqual(s.tournaments, []);
  assert.equal(s.seasons.length, 1);
  assert.equal(s.currentSeasonId, s.seasons[0].id);
  assert.equal(s._v, 6);
});

test('get() returns the loaded state instance', () => {
  const s = freshStore();
  assert.equal(Store.get(), s);
});

test('commit persists to storage and a reload reads it back', () => {
  const s = freshStore();
  s.teams.push({ id: 't9', name: 'Persisted', color: '#fff', players: [] });
  Store.commit();
  const reloaded = Store.load();
  assert.equal(reloaded.teams.length, 1);
  assert.equal(reloaded.teams[0].name, 'Persisted');
});

test('sub() notifies listeners on commit and unsubscribes cleanly', () => {
  freshStore();
  let calls = 0, last = null;
  const off = Store.sub((st) => { calls++; last = st; });
  Store.commit();
  assert.equal(calls, 1);
  assert.equal(last, Store.get());
  off();
  Store.commit();
  assert.equal(calls, 1, 'listener should not fire after unsubscribe');
});

test('migrate: legacy state with no _v upgrades to the current version without data loss', () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('diamondtracker.v1', JSON.stringify({
    game: null,
    history: [{ id: 'g0', created: 100, totals: { away: { r: 1 }, home: { r: 2 } } }],
  }));
  const s = Store.load();
  assert.equal(s._v, 6);
  assert.equal(s.history.length, 1, 'existing history preserved');
  assert.ok(Array.isArray(s.teams));
  assert.ok(Array.isArray(s.lineups));
  assert.ok(Array.isArray(s.schedule));
  assert.ok(Array.isArray(s.tournaments));
  assert.equal(s.seasons.length, 1, 'a default season is created');
  // old game gets folded into the default season
  assert.equal(s.history[0].seasonId, s.currentSeasonId);
});

test('migrate: a v4 state gains tournaments (idempotent on the rest)', () => {
  globalThis.localStorage.clear();
  const sid = 's123';
  globalThis.localStorage.setItem('diamondtracker.v1', JSON.stringify({
    game: null, history: [], teams: [{ id: 't', name: 'X', players: [] }],
    lineups: [], seasons: [{ id: sid, name: 'Season 1', created: 1 }],
    currentSeasonId: sid, schedule: [{ id: 'ev1' }], _v: 4,
  }));
  const s = Store.load();
  assert.equal(s._v, 6);
  assert.deepEqual(s.tournaments, []);
  assert.equal(s.teams[0].name, 'X', 'untouched fields preserved');
  assert.equal(s.schedule[0].id, 'ev1');
  assert.equal(s.currentSeasonId, sid);
});

test('migrate v6: a live game\'s string bases become {name,id} objects', () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('diamondtracker.v1', JSON.stringify({
    game: { id: 'g', bases: ['Runner One', null, 'Runner Three'], events: [], totals: {} },
    history: [], teams: [], lineups: [],
    seasons: [{ id: 's', created: 1 }], currentSeasonId: 's',
    schedule: [], tournaments: [], _v: 5,
  }));
  const s = Store.load();
  assert.equal(s._v, 6);
  assert.deepEqual(s.game.bases[0], { name: 'Runner One', id: null });
  assert.equal(s.game.bases[1], null);
  assert.deepEqual(s.game.bases[2], { name: 'Runner Three', id: null });
});

test('migrate: already-current state is unchanged', () => {
  const fresh = freshStore();
  const sid = fresh.currentSeasonId;
  globalThis.localStorage.setItem('diamondtracker.v1', JSON.stringify(fresh));
  const s = Store.load();
  assert.equal(s._v, 6);
  assert.equal(s.currentSeasonId, sid);
});
