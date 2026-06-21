import './helpers/env.js';
import { freshStore } from './helpers/env.js';
import { Sync } from '../js/sync.js';
import { Store } from '../js/storage.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => { globalThis.localStorage.clear(); Store.setRemote(null); });

// A minimal in-memory stand-in for the Supabase client surface the adapter uses.
function mockClient() {
  const rows = new Map();          // id -> { state }
  const subs = [];                 // realtime listeners
  let lastChannel = null;
  const api = {
    rows, subs,
    from() {
      const q = { _id: null, _state: null };
      const builder = {
        select() { return builder; },
        eq(_col, v) { q._id = v; return builder; },
        async maybeSingle() { return { data: rows.get(q._id) || null, error: null }; },
        async upsert(row) {
          rows.set(row.id, { state: row.state });
          // emit a realtime change to subscribers (as Supabase would)
          subs.forEach(s => s.cb({ new: { id: row.id, state: row.state } }));
          return { error: null };
        },
      };
      return builder;
    },
    channel(name) {
      lastChannel = { name, cb: null, removed: false };
      const ch = {
        on(_evt, _filter, cb) { lastChannel.cb = cb; return ch; },
        subscribe() { subs.push(lastChannel); return ch; },
        _meta: lastChannel,
      };
      return ch;
    },
    removeChannel(ch) { const m = ch._meta || ch; m.removed = true; const i = subs.indexOf(m); if (i >= 0) subs.splice(i, 1); },
    _lastChannel: () => lastChannel,
  };
  return api;
}

test('isConfigured requires enabled + url + key + room', () => {
  assert.equal(Sync.isConfigured(null), false);
  assert.equal(Sync.isConfigured({ enabled: true, url: 'u', anonKey: 'k' }), false);
  assert.equal(Sync.isConfigured({ enabled: false, url: 'u', anonKey: 'k', room: 'r' }), false);
  assert.equal(Sync.isConfigured({ enabled: true, url: 'u', anonKey: 'k', room: 'r' }), true);
});

test('config read/write/clear round-trips through localStorage', () => {
  assert.equal(Sync.readConfig(), null);
  Sync.writeConfig({ enabled: true, url: 'u', anonKey: 'k', room: 'lions' });
  assert.equal(Sync.readConfig().room, 'lions');
  Sync.clearConfig();
  assert.equal(Sync.readConfig(), null);
});

test('remote.pull returns the stored state or null', async () => {
  const c = mockClient();
  const remote = Sync.makeRemote(c, 'room1');
  assert.equal(await remote.pull(), null);
  c.rows.set('room1', { state: { hello: 'world' } });
  assert.deepEqual(await remote.pull(), { hello: 'world' });
});

test('remote.push upserts the whole state under the room id', async () => {
  const c = mockClient();
  const remote = Sync.makeRemote(c, 'room1');
  await remote.push({ a: 1 });
  assert.deepEqual(c.rows.get('room1').state, { a: 1 });
});

test('remote.subscribe delivers realtime row changes and unsubscribes', async () => {
  const c = mockClient();
  const remote = Sync.makeRemote(c, 'room1');
  const seen = [];
  const off = remote.subscribe((st) => seen.push(st));
  await remote.push({ n: 1 });          // upsert emits a change
  assert.deepEqual(seen, [{ n: 1 }]);
  off();
  assert.equal(c._lastChannel().removed, true);
  await remote.push({ n: 2 });          // no longer listening
  assert.equal(seen.length, 1);
});

test('end-to-end through Store: a remote push mirrors into the store', async () => {
  freshStore();
  const c = mockClient();
  const remote = Sync.makeRemote(c, 'room1');
  Store.setRemote(remote);              // wires Store -> remote.subscribe
  // simulate another device's commit landing in the shared row
  await remote.push({ game: null, history: [{ id: 'shared' }], teams: [], lineups: [],
    seasons: [{ id: 's', created: 1 }], currentSeasonId: 's', schedule: [], tournaments: [], _v: 6 });
  assert.equal(Store.get().history[0].id, 'shared', 'incoming room state mirrored locally');
  Store.setRemote(null);
});
