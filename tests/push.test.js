import './helpers/env.js';
import { Push } from '../js/push.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => { globalThis.localStorage.clear(); Push.detach(); });

test('isConfigured needs enabled + VAPID key + function URL', () => {
  assert.equal(Push.isConfigured(null), false);
  assert.equal(Push.isConfigured({ enabled: true, vapidPublicKey: 'k' }), false);
  assert.equal(Push.isConfigured({ enabled: false, vapidPublicKey: 'k', functionUrl: 'u' }), false);
  assert.equal(Push.isConfigured({ enabled: true, vapidPublicKey: 'k', functionUrl: 'u' }), true);
});

test('config round-trips', () => {
  Push.writeConfig({ enabled: true, vapidPublicKey: 'BPk', functionUrl: 'https://x/notify' });
  assert.equal(Push.readConfig().vapidPublicKey, 'BPk');
  Push.clearConfig();
  assert.equal(Push.readConfig(), null);
});

test('urlB64ToUint8Array decodes a url-safe base64 VAPID key', () => {
  // "hello" base64 = aGVsbG8=; url-safe without padding = aGVsbG8
  const arr = Push.urlB64ToUint8Array('aGVsbG8');
  assert.ok(arr instanceof Uint8Array);
  assert.deepEqual([...arr], [...Buffer.from('hello')]);
});

test('subRow flattens a PushSubscription.toJSON() with extras', () => {
  const sub = { toJSON: () => ({ endpoint: 'https://push/abc', keys: { p256dh: 'P', auth: 'A' } }) };
  const row = Push.subRow(sub, { user_id: 'u1', room: 'lions' });
  assert.deepEqual(row, { endpoint: 'https://push/abc', p256dh: 'P', auth: 'A', user_id: 'u1', room: 'lions' });
});

test('subRow tolerates a plain object subscription', () => {
  const row = Push.subRow({ endpoint: 'e', keys: { p256dh: 'P', auth: 'A' } });
  assert.equal(row.endpoint, 'e');
  assert.equal(row.p256dh, 'P');
});

test('notifyBody fills sensible defaults', () => {
  assert.deepEqual(Push.notifyBody({}), { title: 'DiamondTracker', body: '', url: '/', room: null });
  assert.deepEqual(Push.notifyBody({ title: 'Game on', body: 'Aces vs Foes', url: '/?x', room: 'lions' }),
    { title: 'Game on', body: 'Aces vs Foes', url: '/?x', room: 'lions' });
});

test('notify posts the body to the function with the anon key, when configured', async () => {
  Push.writeConfig({ enabled: true, vapidPublicKey: 'k', functionUrl: 'https://p/notify', anonKey: 'anon123' });
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { ok: true }; };
  const ok = await Push.notify({ title: 'Live', body: 'Top 1st', room: 'lions' }, fakeFetch);
  assert.equal(ok, true);
  assert.equal(captured.url, 'https://p/notify');
  assert.equal(captured.opts.headers.authorization, 'Bearer anon123');
  assert.deepEqual(JSON.parse(captured.opts.body), { title: 'Live', body: 'Top 1st', url: '/', room: 'lions' });
});

test('notify is a no-op (returns false) when not configured', async () => {
  let called = false;
  const ok = await Push.notify({ title: 'x' }, async () => { called = true; return { ok: true }; });
  assert.equal(ok, false);
  assert.equal(called, false);
});
