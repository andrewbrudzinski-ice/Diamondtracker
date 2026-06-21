import './helpers/env.js';
import { AI } from '../js/ai.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => globalThis.localStorage.clear());

// A fake fetch that records the request and returns a canned Claude response.
function fakeFetch(response, capture) {
  return async (url, opts) => {
    if (capture) { capture.url = url; capture.opts = opts; capture.body = JSON.parse(opts.body); }
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      async json() { return response.json; },
      async text() { return response.text || ''; },
    };
  };
}

test('isConfigured requires enabled + apiKey', () => {
  assert.equal(AI.isConfigured(null), false);
  assert.equal(AI.isConfigured({ enabled: true }), false);
  assert.equal(AI.isConfigured({ enabled: false, apiKey: 'sk' }), false);
  assert.equal(AI.isConfigured({ enabled: true, apiKey: 'sk-ant-123' }), true);
});

test('config read/write/clear round-trips', () => {
  assert.equal(AI.readConfig(), null);
  AI.writeConfig({ enabled: true, apiKey: 'sk-ant-xyz' });
  assert.equal(AI.readConfig().apiKey, 'sk-ant-xyz');
  AI.clearConfig();
  assert.equal(AI.readConfig(), null);
});

test('mvpPrompt frames a win and includes the facts', () => {
  const { system, prompt, maxTokens } = AI.mvpPrompt({
    name: 'Pat', num: '7', team: 'Aces', opponent: 'Foes',
    statLine: '3-4, 2 HR, 5 RBI', won: true, myRuns: 11, oppRuns: 4,
  });
  assert.match(system, /sports writer/i);
  assert.match(prompt, /Pat \(#7\)/);
  assert.match(prompt, /3-4, 2 HR, 5 RBI/);
  assert.match(prompt, /won 11-4 over Foes/);
  assert.equal(maxTokens, 400);
});

test('mvpPrompt frames a loss', () => {
  const { prompt } = AI.mvpPrompt({
    name: 'Sam', team: 'Aces', opponent: 'Foes',
    statLine: '2-4', won: false, myRuns: 3, oppRuns: 7,
  });
  assert.match(prompt, /fell 3-7 to Foes/);
});

test('recapPrompt includes the final and standouts', () => {
  const { prompt } = AI.recapPrompt({
    away: 'Aces', home: 'Foes', awayRuns: 7, homeRuns: 5,
    standouts: 'Pat 3-4, 2 HR; Sam 2-3',
  });
  assert.match(prompt, /Aces 7, Foes 5/);
  assert.match(prompt, /Standouts: Pat 3-4, 2 HR; Sam 2-3/);
});

test('complete posts to the Claude API with the right model, key and browser header', async () => {
  AI.writeConfig({ enabled: true, apiKey: 'sk-ant-secret' });
  const cap = {};
  const text = await AI.complete(
    { system: 'sys', prompt: 'hi', maxTokens: 256 },
    fakeFetch({ json: { content: [{ type: 'text', text: '  Big night for Pat.  ' }], stop_reason: 'end_turn' } }, cap),
  );
  assert.equal(text, 'Big night for Pat.', 'trims the returned text');
  assert.equal(cap.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(cap.opts.headers['x-api-key'], 'sk-ant-secret');
  assert.equal(cap.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(cap.body.model, 'claude-opus-4-8');
  assert.equal(cap.body.max_tokens, 256);
  assert.equal(cap.body.system, 'sys');
  assert.deepEqual(cap.body.messages, [{ role: 'user', content: 'hi' }]);
});

test('complete throws when not configured (caller falls back to template)', async () => {
  await assert.rejects(() => AI.complete({ system: 's', prompt: 'p' }, fakeFetch({ json: {} })),
    /not configured/);
});

test('complete surfaces API errors', async () => {
  AI.writeConfig({ enabled: true, apiKey: 'sk' });
  await assert.rejects(
    () => AI.complete({ system: 's', prompt: 'p' }, fakeFetch({ ok: false, status: 401, text: 'bad key' })),
    /401/);
});

test('complete treats a refusal stop_reason as an error', async () => {
  AI.writeConfig({ enabled: true, apiKey: 'sk' });
  await assert.rejects(
    () => AI.complete({ system: 's', prompt: 'p' },
      fakeFetch({ json: { content: [], stop_reason: 'refusal' } })),
    /declined/);
});

test('mvpSummary builds the prompt and returns the model text end-to-end', async () => {
  AI.writeConfig({ enabled: true, apiKey: 'sk' });
  const cap = {};
  const out = await AI.mvpSummary(
    { name: 'Pat', team: 'Aces', opponent: 'Foes', statLine: '3-4, HR', won: true, myRuns: 9, oppRuns: 2 },
    fakeFetch({ json: { content: [{ type: 'text', text: 'Pat carried the Aces.' }], stop_reason: 'end_turn' } }, cap),
  );
  assert.equal(out, 'Pat carried the Aces.');
  assert.match(cap.body.messages[0].content, /Stat line: 3-4, HR/);
});
