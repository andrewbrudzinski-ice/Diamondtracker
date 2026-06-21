import './helpers/env.js';
import { Auth } from '../js/auth.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => Auth.detach());

// Mock Supabase client: a session + a profiles row keyed by user id.
function mockClient({ user = null, role = 'fan' } = {}) {
  let authCb = null;
  return {
    _setUser(u) { authCb && authCb('SIGNED_IN', u ? { user: u } : null); },
    auth: {
      async getSession() { return { data: { session: user ? { user } : null } }; },
      onAuthStateChange(cb) { authCb = cb; return { data: { subscription: {} } }; },
      async signInWithOtp(args) { this._otp = args; return { error: null }; },
      async signOut() { return { error: null }; },
    },
    from() {
      const b = { _id: null,
        select() { return b; },
        eq(_c, v) { b._id = v; return b; },
        async maybeSingle() { return { data: role ? { role } : null, error: null }; } };
      return b;
    },
  };
}

test('capability model matches the role matrix', () => {
  for (const r of ['admin', 'manager', 'scorekeeper']) assert.equal(Auth.canWrite(r), true);
  for (const r of ['player', 'fan']) assert.equal(Auth.canWrite(r), false);
  assert.equal(Auth.canManageTeams('manager'), true);
  assert.equal(Auth.canManageTeams('scorekeeper'), false);
  assert.equal(Auth.isAdmin('admin'), true);
  assert.equal(Auth.isAdmin('manager'), false);
});

test('signed-out is the default and every capability is moot', () => {
  const s = Auth.current();
  assert.equal(s.signedIn, false);
  assert.equal(s.role, null);
});

test('init with no session leaves the user signed out', async () => {
  await Auth.init(mockClient({ user: null }));
  assert.equal(Auth.current().signedIn, false);
});

test('init with a session loads the user and their role', async () => {
  await Auth.init(mockClient({ user: { id: 'u1', email: 'a@b.com' }, role: 'scorekeeper' }));
  const s = Auth.current();
  assert.equal(s.signedIn, true);
  assert.equal(s.email, 'a@b.com');
  assert.equal(s.role, 'scorekeeper');
  assert.equal(Auth.canWrite(s.role), true);
});

test('a signed-in user with no profile row defaults to fan', async () => {
  await Auth.init(mockClient({ user: { id: 'u2', email: 'c@d.com' }, role: null }));
  assert.equal(Auth.current().role, 'fan');
  assert.equal(Auth.canWrite(Auth.current().role), false);
});

test('onChange fires on auth transitions', async () => {
  const c = mockClient({ user: null });
  let seen = null;
  Auth.onChange((s) => { seen = s; });
  await Auth.init(c);
  c._setUser({ id: 'u3', email: 'e@f.com' });
  await new Promise((r) => setTimeout(r, 0)); // let the async _apply settle
  assert.equal(seen.signedIn, true);
  assert.equal(seen.email, 'e@f.com');
});

test('signInWithEmail sends a magic link via the client', async () => {
  const c = mockClient({ user: null });
  await Auth.init(c);
  await Auth.signInWithEmail('player@team.com', 'https://app.example/');
  assert.equal(c.auth._otp.email, 'player@team.com');
  assert.equal(c.auth._otp.options.emailRedirectTo, 'https://app.example/');
});

test('signInWithEmail rejects when no client is attached', async () => {
  await assert.rejects(() => Auth.signInWithEmail('x@y.com'), /Connect Live Sync first/);
});

test('signOut returns to the signed-out state', async () => {
  await Auth.init(mockClient({ user: { id: 'u4', email: 'g@h.com' }, role: 'admin' }));
  assert.equal(Auth.current().signedIn, true);
  await Auth.signOut();
  assert.equal(Auth.current().signedIn, false);
  assert.equal(Auth.current().role, null);
});

test('detach clears state', async () => {
  await Auth.init(mockClient({ user: { id: 'u5', email: 'i@j.com' }, role: 'manager' }));
  Auth.detach();
  assert.equal(Auth.current().signedIn, false);
});

// Mock client for the admin role-editor methods (list + update).
function adminClient(profiles) {
  const cap = {};
  const client = {
    _cap: cap,
    auth: {
      async getSession() { return { data: { session: { user: { id: 'admin1', email: 'admin@x.com' } } } }; },
      onAuthStateChange() { return { data: { subscription: {} } }; },
      async signOut() { return { error: null }; },
    },
    from() {
      const b = {
        select() { return b; },
        order() { return { data: profiles, error: null }; },          // list
        async maybeSingle() { return { data: { role: 'admin' }, error: null }; }, // role lookup
        update(patch) { cap.patch = patch; return b; },
        async eq(_c, v) { cap.id = v; return { error: null }; },        // update target
      };
      return b;
    },
  };
  return client;
}

test('listProfiles returns the rows ordered by the client', async () => {
  const rows = [{ id: 'u1', email: 'a@x.com', role: 'fan' }, { id: 'u2', email: 'b@x.com', role: 'scorekeeper' }];
  await Auth.init(adminClient(rows));
  assert.deepEqual(await Auth.listProfiles(), rows);
});

test('setRole updates the targeted profile and validates the role', async () => {
  const c = adminClient([]);
  await Auth.init(c);
  await Auth.setRole('u2', 'manager');
  assert.deepEqual(c._cap.patch, { role: 'manager' });
  assert.equal(c._cap.id, 'u2');
  await assert.rejects(() => Auth.setRole('u2', 'superuser'), /Invalid role/);
});

test('setRole on yourself refreshes local role', async () => {
  const c = adminClient([]);
  await Auth.init(c);              // signed in as admin1
  let seen = null;
  Auth.onChange((s) => { seen = s; });
  await Auth.setRole('admin1', 'manager');
  assert.equal(Auth.current().role, 'manager');
  assert.equal(seen.role, 'manager');
});
