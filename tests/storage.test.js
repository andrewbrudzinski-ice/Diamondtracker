import './helpers/env.js';
import { Store, freshStore } from './helpers/env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// the remote backend is a module-level singleton; detach before each test
beforeEach(() => Store.setRemote(null));

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

// ---- Phase B seam: async-capable remote backend ----
test('with no remote, commit still persists locally (offline path intact)', () => {
  const s = freshStore();
  s.teams.push({ id: 't', name: 'Solo', players: [] });
  Store.commit();
  assert.equal(JSON.parse(globalThis.localStorage.getItem('diamondtracker.v1')).teams.length, 1);
});

test('commit writes through to a configured remote', () => {
  freshStore();
  const pushed = [];
  Store.setRemote({ push: (st) => pushed.push(st) });
  Store.get().teams.push({ id: 't', name: 'Synced', players: [] });
  Store.commit();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].teams[0].name, 'Synced');
  // and the local cache was written regardless
  assert.equal(JSON.parse(globalThis.localStorage.getItem('diamondtracker.v1')).teams.length, 1);
});

test('a failing remote push never breaks the local commit', () => {
  freshStore();
  Store.setRemote({ push: () => { throw new Error('network down'); } });
  Store.get().history.push({ id: 'g' });
  assert.doesNotThrow(() => Store.commit());
  assert.equal(Store.get().history.length, 1);
});

test('hydrate adopts remote state, migrates it, and notifies listeners', async () => {
  freshStore();
  let notified = null;
  Store.sub((st) => { notified = st; });
  // remote returns a legacy (v4) payload to prove migration runs on pull
  Store.setRemote({
    pull: async () => ({
      game: null, history: [{ id: 'remote-g' }], teams: [], lineups: [],
      seasons: [{ id: 's', created: 1 }], currentSeasonId: 's', schedule: [], _v: 4,
    }),
  });
  const s = await Store.hydrate();
  assert.equal(s.history[0].id, 'remote-g');
  assert.equal(s._v, 6, 'pulled state is migrated to current version');
  assert.equal(notified, s, 'listeners are notified of the hydrated state');
});

test('hydrate is a safe no-op with no remote', async () => {
  const s = freshStore();
  const out = await Store.hydrate();
  assert.equal(out, s);
});

test('a remote subscribe push updates the store and notifies', () => {
  freshStore();
  let pushFn = null;
  let notified = null;
  Store.sub((st) => { notified = st; });
  Store.setRemote({ subscribe: (onState) => { pushFn = onState; return () => { pushFn = null; }; } });
  assert.equal(typeof pushFn, 'function', 'Store wired itself to the remote subscription');
  pushFn({ game: null, history: [{ id: 'live' }], teams: [], lineups: [],
    seasons: [{ id: 's', created: 1 }], currentSeasonId: 's', schedule: [], tournaments: [], _v: 6 });
  assert.equal(Store.get().history[0].id, 'live');
  assert.equal(notified, Store.get());
});

test('setRemote(null) detaches the remote subscription', () => {
  freshStore();
  let unsubscribed = false;
  Store.setRemote({ subscribe: () => () => { unsubscribed = true; } });
  Store.setRemote(null);
  assert.equal(unsubscribed, true);
  assert.equal(Store.getRemote(), null);
});
