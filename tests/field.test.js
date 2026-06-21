import './helpers/env.js';
import { Field } from '../js/field.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('angleDeg is negative to the left and positive to the right of center', () => {
  assert.ok(Field.angleDeg(30, 66) < 0, 'pull-side left is negative');
  assert.ok(Field.angleDeg(70, 66) > 0, 'oppo-side right is positive');
  assert.equal(Math.round(Field.angleDeg(50, 20)), 0, 'straightaway center is ~0');
});

test('zoneFor classifies the canonical spots', () => {
  assert.equal(Field.zoneFor(50, 86).code, 'C', 'on the plate -> catcher');
  assert.equal(Field.zoneFor(50, 66).code, 'P', 'on the mound -> pitcher');
  assert.equal(Field.zoneFor(50, 20).code, 'CF', 'deep middle -> center field');
});

test('zoneFor separates infield corners by angle', () => {
  assert.equal(Field.zoneFor(25, 70).code, '3B');
  assert.equal(Field.zoneFor(72, 70).code, '1B');
});

test('zoneFor reads deep pulled balls as the corner outfield', () => {
  assert.equal(Field.zoneFor(15, 35).code, 'LF');
  assert.equal(Field.zoneFor(85, 35).code, 'RF');
});

test('zones carry an infield/outfield area tag', () => {
  assert.equal(Field.zoneFor(50, 66).area, 'infield');
  assert.equal(Field.zoneFor(50, 20).area, 'outfield');
});
