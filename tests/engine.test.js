import './helpers/env.js';
import { Engine } from '../js/engine.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const A = [
  { id: 'a1', name: 'A1', num: '1' }, { id: 'a2', name: 'A2', num: '2' },
  { id: 'a3', name: 'A3', num: '3' }, { id: 'a4', name: 'A4', num: '4' },
];
const H = [
  { id: 'h1', name: 'H1', num: '1' }, { id: 'h2', name: 'H2', num: '2' },
];

function makeGame(rules) {
  return Engine.newGame({
    away: 'Away', home: 'Home',
    awayRoster: A, homeRoster: H,
    awayPitcherId: 'apit', homePitcherId: 'hpit',
    rules,
  });
}
const last = (g) => g.events[g.events.length - 1];

test('newGame initializes a clean top-of-1st state', () => {
  const g = makeGame();
  assert.equal(g.inning, 1);
  assert.equal(g.half, 'top');
  assert.equal(g.outs, 0);
  assert.deepEqual(g.bases, [null, null, null]);
  assert.deepEqual(g.totals.away, { r: 0, h: 0, e: 0 });
  assert.equal(g.rules.preset, 'standard');
});

test('single puts the batter on first and records a hit', () => {
  const g = makeGame();
  Engine.actions.single(g);
  assert.deepEqual(g.bases, ['A1', null, null]);
  assert.equal(g.totals.away.h, 1);
  assert.equal(g.totals.away.r, 0);
  assert.equal(g.battingIndex.top, 1, 'batting order advances');
  const e = last(g);
  assert.equal(e.type, 'hit');
  assert.equal(e.bases, 1);
  assert.equal(e.rbi, 0);
});

test('event snapshot stamps batter, side and fielding pitcher', () => {
  const g = makeGame();
  Engine.actions.single(g);
  const e = last(g);
  assert.equal(e.side, 'away');
  assert.equal(e.batterId, 'a1');
  assert.equal(e.batter, 'A1');
  assert.equal(e.pitcherId, 'hpit', 'pitcher is the fielding (home) pitcher');
  assert.deepEqual(e.scoreAfter, { away: 0, home: 0 });
});

test('solo home run scores one run with one RBI', () => {
  const g = makeGame();
  Engine.actions.homer(g);
  assert.deepEqual(g.bases, [null, null, null]);
  assert.equal(g.totals.away.r, 1);
  assert.equal(last(g).rbi, 1);
});

test('grand slam clears the bases for four runs', () => {
  const g = makeGame();
  g.bases = ['X', 'Y', 'Z'];
  Engine.actions.homer(g);
  assert.equal(g.totals.away.r, 4);
  assert.deepEqual(g.bases, [null, null, null]);
  assert.equal(last(g).rbi, 4);
});

test('walk with a runner on first is a clean force, no run', () => {
  const g = makeGame();
  g.bases = ['R1', null, null];
  Engine.actions.walkBtn(g);
  assert.deepEqual(g.bases, ['A1', 'R1', null]);
  assert.equal(g.totals.away.r, 0);
  assert.equal(last(g).type, 'walk');
});

test('bases-loaded walk forces in exactly one run', () => {
  const g = makeGame();
  g.bases = ['R1', 'R2', 'R3'];
  Engine.actions.walkBtn(g);
  assert.equal(g.totals.away.r, 1);
  assert.deepEqual(g.bases, ['A1', 'R1', 'R2']);
});

test('four balls draws a walk automatically', () => {
  const g = makeGame();
  Engine.actions.ball(g); Engine.actions.ball(g);
  Engine.actions.ball(g); Engine.actions.ball(g);
  assert.deepEqual(g.bases, ['A1', null, null]);
  assert.equal(last(g).type, 'walk');
});

test('three strikes is a strikeout and an out', () => {
  const g = makeGame();
  Engine.actions.strike(g); Engine.actions.strike(g); Engine.actions.strike(g);
  assert.equal(g.outs, 1);
  assert.equal(last(g).type, 'k');
});

test('foul does not produce a third strike', () => {
  const g = makeGame();
  Engine.actions.strike(g); Engine.actions.strike(g);
  Engine.actions.foul(g);
  assert.equal(g.strikes, 2);
  assert.equal(g.outs, 0);
});

test('three outs flips top to bottom of the same inning', () => {
  const g = makeGame();
  Engine.actions.out(g); Engine.actions.out(g); Engine.actions.out(g);
  assert.equal(g.half, 'bottom');
  assert.equal(g.inning, 1);
  assert.equal(g.outs, 0);
  assert.deepEqual(g.bases, [null, null, null]);
});

test('completing the bottom half advances the inning', () => {
  const g = makeGame();
  Engine.actions.out(g); Engine.actions.out(g); Engine.actions.out(g); // -> bottom 1
  Engine.actions.out(g); Engine.actions.out(g); Engine.actions.out(g); // -> top 2
  assert.equal(g.half, 'top');
  assert.equal(g.inning, 2);
});

test('sac fly scores the runner from third and records an out', () => {
  const g = makeGame();
  g.bases = [null, null, 'R3'];
  Engine.actions.sacFly(g);
  assert.equal(g.totals.away.r, 1);
  assert.equal(g.outs, 1);
  assert.deepEqual(g.bases, [null, null, null]);
  assert.equal(last(g).type, 'sac');
  assert.equal(last(g).rbi, 1);
});

test('error advances the batter without recording an out', () => {
  const g = makeGame();
  Engine.actions.error(g);
  assert.equal(g.outs, 0);
  assert.equal(g.totals.home.e, 1, 'charged to the fielding team');
  assert.deepEqual(g.bases, ['A1', null, null]);
  assert.equal(last(g).type, 'error');
});

test('stolen base advances the lead runner; from third it scores', () => {
  const g1 = makeGame();
  g1.bases = [null, 'R2', null];
  Engine.actions.stolenBase(g1);
  assert.deepEqual(g1.bases, [null, null, 'R2']);
  assert.equal(g1.totals.away.r, 0);

  const g2 = makeGame();
  g2.bases = [null, null, 'R3'];
  Engine.actions.stolenBase(g2);
  assert.deepEqual(g2.bases, [null, null, null]);
  assert.equal(g2.totals.away.r, 1);
});

test('double play records two outs', () => {
  const g = makeGame();
  g.bases = ['R1', null, null];
  Engine.actions.doublePlay(g);
  assert.equal(g.outs, 2);
  assert.equal(last(g).type, 'dp');
});

test("fielder's choice puts the batter on first and retires the lead runner", () => {
  const g = makeGame();
  g.bases = [null, null, 'R3'];
  Engine.actions.fieldersChoice(g);
  assert.equal(g.outs, 1);
  assert.deepEqual(g.bases, ['A1', null, null]);
  assert.equal(last(g).type, 'fc');
});

test('manual run adds a run', () => {
  const g = makeGame();
  Engine.actions.manualRun(g);
  assert.equal(g.totals.away.r, 1);
  assert.equal(last(g).type, 'run');
});

// ---- slow-pitch run-limit rules --------------------------------
test('run limit caps runs in a non-final inning', () => {
  const g = makeGame({ runLimitPerInning: 5, openFinalInning: true });
  for (let i = 0; i < 8; i++) Engine.actions.manualRun(g);
  assert.equal(g.totals.away.r, 5, 'capped at the per-inning limit');
});

test('standard rules have no run cap', () => {
  const g = makeGame();
  for (let i = 0; i < 8; i++) Engine.actions.manualRun(g);
  assert.equal(g.totals.away.r, 8);
});

test('reaching the run cap on a hit retires the side', () => {
  const g = makeGame({ runLimitPerInning: 5, openFinalInning: true });
  for (let i = 0; i < 5; i++) Engine.actions.manualRun(g);
  assert.ok(Engine.runCapReached(g));
  Engine.actions.single(g); // hit while capped -> capOut -> endHalf
  assert.equal(g.half, 'bottom');
  assert.equal(g.outs, 0);
});

test('final inning is uncapped when openFinalInning is set', () => {
  const g = makeGame({ runLimitPerInning: 5, openFinalInning: true });
  g.inning = g.innings; // final inning
  assert.equal(Engine.runLimitFor(g), 0);
});

// ---- mercy / game-over detection -------------------------------
test('regulation walk-off: home leading after the top of an extra frame is done', () => {
  const g = makeGame();
  g.inning = g.innings + 1; g.half = 'top';
  g.totals.home.r = 5; g.totals.away.r = 2;
  assert.equal(Engine.isMercyOrDone(g), true);
});

test('a tie after regulation is not done', () => {
  const g = makeGame();
  g.inning = g.innings + 1; g.half = 'top';
  g.totals.home.r = 4; g.totals.away.r = 4;
  assert.equal(Engine.isMercyOrDone(g), false);
});

test('configured mercy rule triggers on a large lead at the half', () => {
  const g = makeGame({ mercyEnabled: true, mercyRuns: 10, mercyAfterInning: 4 });
  g.inning = 4; g.half = 'top';
  g.totals.away.r = 12; g.totals.home.r = 1;
  g.outs = 0; g.balls = 0; g.strikes = 0;
  assert.equal(Engine.isMercyOrDone(g), true);
});

test('RULE_PRESETS expose the documented presets', () => {
  assert.ok(Engine.RULE_PRESETS.standard);
  assert.ok(Engine.RULE_PRESETS.slowpitch);
  assert.equal(Engine.RULE_PRESETS.slowpitch.rules.runLimitPerInning, 5);
});
