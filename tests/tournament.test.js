import './helpers/env.js';
import { freshStore } from './helpers/env.js';
import { Tournament } from '../js/tournament.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T4 = ['t1', 't2', 't3', 't4'];

test('seedOrder produces standard bracket seeding', () => {
  assert.deepEqual(Tournament.seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(Tournament.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('nextPow2 rounds up to the next power of two', () => {
  assert.equal(Tournament.nextPow2(3), 4);
  assert.equal(Tournament.nextPow2(4), 4);
  assert.equal(Tournament.nextPow2(5), 8);
});

test('single-elim with 4 teams builds two semis and a final', () => {
  freshStore();
  const t = Tournament.create({ name: 'Cup', format: 'single', teamIds: T4 });
  const round1 = t.matches.filter((m) => m.round === 1);
  const round2 = t.matches.filter((m) => m.round === 2);
  assert.equal(round1.length, 2);
  assert.equal(round2.length, 1);
  // final references the winners of the two semis
  assert.equal(round2[0].a.from, 'winner');
  assert.equal(round2[0].b.from, 'winner');
});

test('recording results advances winners and crowns a champion', () => {
  freshStore();
  const t = Tournament.create({ name: 'Cup', format: 'single', teamIds: T4 });
  const [semi1, semi2] = t.matches.filter((m) => m.round === 1);
  const final = t.matches.find((m) => m.round === 2);

  Tournament.setResult(t.id, semi1.id, 7, 3); // semi1 A advances
  Tournament.setResult(t.id, semi2.id, 2, 9); // semi2 B advances

  const w1 = Tournament.teamInSlot(final.a, t.matches);
  const w2 = Tournament.teamInSlot(final.b, t.matches);
  assert.equal(w1, Tournament.teamInSlot(semi1.a, t.matches));
  assert.equal(w2, Tournament.teamInSlot(semi2.b, t.matches));

  Tournament.setResult(t.id, final.id, 5, 4);
  assert.equal(t.champion, w1, 'final winner is the champion');
});

test('round robin generates every pairing and ranks standings', () => {
  freshStore();
  const t = Tournament.create({ name: 'RR', format: 'roundrobin', teamIds: ['a', 'b', 'c'] });
  assert.equal(t.matches.length, 3, 'C(3,2) = 3 matches');
  Tournament.setResult(t.id, t.matches[0].id, 10, 0); // a beats b
  Tournament.setResult(t.id, t.matches[1].id, 10, 0); // a beats c
  Tournament.setResult(t.id, t.matches[2].id, 5, 4);  // b beats c
  const st = Tournament.standings(t);
  assert.equal(st[0].teamId, 'a');
  assert.equal(st[0].w, 2);
});

test('clearResult undoes a recorded match', () => {
  freshStore();
  const t = Tournament.create({ name: 'Cup', format: 'single', teamIds: T4 });
  const semi = t.matches.find((m) => m.round === 1);
  Tournament.setResult(t.id, semi.id, 7, 3);
  assert.equal(semi.winner, 'a');
  Tournament.clearResult(t.id, semi.id);
  assert.equal(semi.winner, null);
  assert.equal(semi.scoreA, null);
});
