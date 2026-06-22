import './helpers/env.js';
import { RSVP } from '../js/rsvp.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => RSVP.detach());

// Mock Supabase client recording the last write and returning canned reads.
function mockClient(reads = {}) {
  const cap = { ops: [] };
  const client = {
    _cap: cap,
    from(table) {
      const ctx = { table, eqs: {} };
      const b = {
        select() { ctx.op = 'select'; return b; },
        upsert(row) { cap.ops.push({ op: 'upsert', table, row }); ctx.op = 'upsert'; ctx.row = row; return b; },
        delete() { cap.ops.push({ op: 'delete', table }); ctx.op = 'delete'; return b; },
        eq(col, v) { ctx.eqs[col] = v; if (ctx.op === 'delete') cap.ops[cap.ops.length - 1].eqs = ctx.eqs; return b; },
        async maybeSingle() { return { data: reads[table + ':one'] ?? null, error: null }; },
        then(resolve) { return resolve({ data: reads[table] ?? [], error: null }); }, // awaitable list
      };
      return b;
    },
  };
  return client;
}

test('inert until init with a client + signed-in uid', async () => {
  assert.equal(RSVP.ready(), false);
  await assert.rejects(() => RSVP.claimPlayer('p1'), /Sign in first/);
  assert.deepEqual(await RSVP.listClaims(), []);   // no client -> empty, no throw
});

test('claimPlayer upserts the (user, player) link', async () => {
  const c = mockClient();
  RSVP.init(c, () => 'user-1');
  await RSVP.claimPlayer('p7', 't1');
  const op = c._cap.ops.at(-1);
  assert.equal(op.table, 'diamondtracker_claims');
  assert.deepEqual(op.row, { user_id: 'user-1', player_id: 'p7', team_id: 't1' });
});

test('myClaim reads the caller\'s link', async () => {
  const c = mockClient({ 'diamondtracker_claims:one': { player_id: 'p7', team_id: 't1' } });
  RSVP.init(c, () => 'user-1');
  assert.deepEqual(await RSVP.myClaim(), { player_id: 'p7', team_id: 't1' });
});

test('setMyRsvp upserts my status for an event', async () => {
  const c = mockClient();
  RSVP.init(c, () => 'user-1');
  await RSVP.setMyRsvp('ev9', 'in', 'p7');
  const op = c._cap.ops.at(-1);
  assert.equal(op.table, 'diamondtracker_rsvps');
  assert.deepEqual(op.row, { event_id: 'ev9', user_id: 'user-1', player_id: 'p7', status: 'in' });
});

test('setMyRsvp(null) deletes my RSVP for the event', async () => {
  const c = mockClient();
  RSVP.init(c, () => 'user-1');
  await RSVP.setMyRsvp('ev9', null);
  const op = c._cap.ops.at(-1);
  assert.equal(op.op, 'delete');
  assert.deepEqual(op.eqs, { event_id: 'ev9', user_id: 'user-1' });
});

test('listRsvps returns rows for an event', async () => {
  const rows = [{ user_id: 'u1', player_id: 'p1', status: 'in' }];
  const c = mockClient({ 'diamondtracker_rsvps': rows });
  RSVP.init(c, () => 'u1');
  assert.deepEqual(await RSVP.listRsvps('ev9'), rows);
});

test('writes require a signed-in user', async () => {
  RSVP.init(mockClient(), () => null);   // client but no uid
  assert.equal(RSVP.ready(), false);
  await assert.rejects(() => RSVP.setMyRsvp('ev9', 'in'), /Sign in first/);
});

test('detach makes it inert again', () => {
  RSVP.init(mockClient(), () => 'u1');
  assert.equal(RSVP.ready(), true);
  RSVP.detach();
  assert.equal(RSVP.ready(), false);
});
