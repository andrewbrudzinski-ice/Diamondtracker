import { ShareCard } from '../js/sharecard.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('build returns an SVG with the teams, score and FINAL label', () => {
  const svg = ShareCard.build({
    away: 'Aces', home: 'Foes', awayRuns: 7, homeRuns: 3,
    final: true, date: 'Jun 22', mvp: 'Pat Casey',
    awayColor: '#ff0000', homeColor: '#00ff00',
  });
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox="0 0 1080 1080"/);
  assert.match(svg, /ACES/);
  assert.match(svg, /FOES/);
  assert.match(svg, />7<\/text>/);
  assert.match(svg, />3<\/text>/);
  assert.match(svg, /FINAL/);
  assert.match(svg, /MVP · PAT CASEY/);
  assert.match(svg, /#ff0000/);          // away color accent
  assert.match(svg, /DiamondTracker|Diamond<tspan/);
});

test('build shows LIVE when not final and escapes names', () => {
  const svg = ShareCard.build({ away: 'A & B', home: 'H', awayRuns: 1, homeRuns: 0, final: false });
  assert.match(svg, /LIVE/);
  assert.doesNotMatch(svg, /FINAL/);
  assert.match(svg, /A &amp; B/);
});

test('clip truncates long names', () => {
  assert.equal(ShareCard.clip('Short', 15), 'Short');
  assert.equal(ShareCard.clip('A really long team name here', 15).length, 15);
  assert.match(ShareCard.clip('A really long team name here', 15), /…$/);
});
