import './helpers/env.js';
import { seedState, freshStore, Store } from './helpers/env.js';
import { Schedule } from '../js/schedule.js';
import * as F from './helpers/fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

test('create appends an event with sensible defaults', () => {
  freshStore();
  const e = Schedule.create({ title: 'Opening Day', type: 'game' });
  assert.ok(e.id);
  assert.equal(e.type, 'game');
  assert.deepEqual(e.rsvps, {});
  assert.equal(Schedule.all().length, 1);
});

test('two events created together get distinct ids', () => {
  freshStore();
  const a = Schedule.create({});
  const b = Schedule.create({});
  assert.notEqual(a.id, b.id, 'sequence suffix avoids same-ms collisions');
});

test('update mutates and remove deletes', () => {
  freshStore();
  const e = Schedule.create({ title: 'X' });
  Schedule.update(e.id, { title: 'Y' });
  assert.equal(Schedule.byId(e.id).title, 'Y');
  Schedule.remove(e.id);
  assert.equal(Schedule.byId(e.id), undefined);
});

test('upcoming and past partition by start time', () => {
  freshStore();
  Schedule.create({ title: 'future', start: iso(48 * 3600 * 1000) });
  Schedule.create({ title: 'past', start: iso(-48 * 3600 * 1000) });
  const up = Schedule.upcoming();
  const old = Schedule.past();
  assert.ok(up.some((e) => e.title === 'future'));
  assert.ok(old.some((e) => e.title === 'past'));
});

test('setRsvp and rsvpTally count roster responses', () => {
  seedState({
    teams: [F.team({ id: 't1', name: 'T', players: [
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
    ] })],
  });
  const e = Schedule.create({ teamId: 't1' });
  Schedule.setRsvp(e.id, 'p1', 'in');
  Schedule.setRsvp(e.id, 'p2', 'out');
  const tally = Schedule.rsvpTally(Schedule.byId(e.id));
  assert.equal(tally.in, 1);
  assert.equal(tally.out, 1);
  assert.equal(tally.pending, 1);
  assert.equal(tally.total, 3);
});

test('setRsvp with null clears a response', () => {
  seedState({ teams: [F.team({ id: 't1', players: [{ id: 'p1' }] })] });
  const e = Schedule.create({ teamId: 't1' });
  Schedule.setRsvp(e.id, 'p1', 'in');
  Schedule.setRsvp(e.id, 'p1', null);
  assert.equal(Store.get().schedule[0].rsvps.p1, undefined);
});
