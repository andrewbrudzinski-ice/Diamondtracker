import './helpers/env.js';
import { freshStore } from './helpers/env.js';
import { Crest } from '../js/crest.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('initials derives a two-letter monogram', () => {
  assert.equal(Crest.initials('John Smith'), 'JS');
  assert.equal(Crest.initials('Madonna'), 'MA');
  assert.equal(Crest.initials('  the quick brown fox '), 'TF');
  assert.equal(Crest.initials(''), '??');
});

test('shade returns a valid hex and clamps to range', () => {
  const lighter = Crest.shade('#808080', 0.5);
  const darker = Crest.shade('#808080', -0.5);
  assert.match(lighter, /^#[0-9a-f]{6}$/);
  assert.match(darker, /^#[0-9a-f]{6}$/);
  assert.equal(Crest.shade('#000000', 1), '#ffffff');
  assert.equal(Crest.shade('#ffffff', -1), '#000000');
});

test('readable picks dark text on light backgrounds and vice versa', () => {
  assert.equal(Crest.readable('#ffffff'), '#0a0d14');
  assert.equal(Crest.readable('#000000'), '#ffffff');
});

test('team crest is an SVG containing the monogram', () => {
  freshStore(); // logoFor reads Store
  const svg = Crest.team('Red Sox', '#bd3039', 64);
  assert.match(svg, /<svg/);
  assert.match(svg, /RS<\/text>/);
});

test('player avatar embeds the number when shown', () => {
  const svg = Crest.player('Pat Casey', '7', '#123456', true);
  assert.match(svg, /#7</);
  const noNum = Crest.player('Pat Casey', '7', '#123456', false);
  assert.doesNotMatch(noNum, /#7</);
});
