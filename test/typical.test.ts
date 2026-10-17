/**
 * How long an appliance's cycles usually take, for the time left on the
 * dashboard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { difference, KEEP_CYCLES, medianSeconds, runsOf, startOf, typicalSeconds, usualByStart, usualSeconds, withRun } from '../src/typical.ts';

test('cycles of about the same length have a usual one: their median', () => {
  assert.equal(typicalSeconds([3600, 3900, 3700]), 3700);
  assert.equal(typicalSeconds([3600, 4000]), 3800);
});

test('one cycle is not enough to say what is usual', () => {
  assert.equal(typicalSeconds([3600]), undefined);
  assert.equal(typicalSeconds(undefined), undefined);
});

test('one cycle out of line does not matter, but lengths all over the place have no usual one', () => {
  assert.equal(typicalSeconds([3600, 3700, 1200, 3650]), 3625);
  assert.equal(typicalSeconds([1800, 9600, 3600, 600, 7200]), undefined, 'a desk, or quick washes and long ones');
});

test('only the last cycles are kept', () => {
  let runs: { seconds: number }[] = [];
  for (let index = 1; index <= KEEP_CYCLES + 3; index++) {
    runs = withRun(runs, { seconds: index });
  }
  assert.equal(runs.length, KEEP_CYCLES);
  assert.equal(runs.at(-1)!.seconds, KEEP_CYCLES + 3);
});

test('an appliance from before starts from the lengths it has, or its last cycle', () => {
  const lastCycle = { startedAt: 0, endedAt: 3_600_000, seconds: 3600, wattHours: 800 };
  assert.deepEqual(runsOf({ lastCycle }), [{ seconds: 3600 }]);
  assert.deepEqual(runsOf({ lastCycle, durations: [3000, 3100] }), [{ seconds: 3000 }, { seconds: 3100 }], '1.7 and 1.8');
  assert.deepEqual(runsOf({ lastCycle, durations: [3000], runs: [] }), [], 'not after Forget');
  assert.deepEqual(runsOf({}), []);
});

test("a cycle's start is its mean draw per whole minute, from readings that hold until the next", () => {
  const t0 = 1_000_000;
  const samples = [
    { at: t0 - 5000, watts: 2 },
    { at: t0, watts: 100 },
    { at: t0 + 30_000, watts: 2000 },
    { at: t0 + 90_000, watts: 50 },
  ];
  assert.deepEqual(startOf(samples, t0, t0 + 3.5 * 60_000), [1050, 1025, 50], 'whole minutes only');
  assert.equal(startOf(samples, t0, t0 + 20 * 60_000)!.length, 10, 'the first ten at most');
  assert.deepEqual(startOf(samples, t0, t0 + 30_000), []);
  assert.equal(startOf(samples.slice(2), t0, t0 + 5 * 60_000), undefined, 'readings that do not reach back to the start');
});

// The first ten minutes of real washes: a long programme turns the drum
// first, a short one heats from the second minute.
const LONG = [29, 43, 44, 46, 46, 45, 45, 46, 44, 20];
const LONG_2 = [28, 52, 57, 58, 58, 59, 59, 59, 59, 23];
const SHORT = [27, 79, 2106, 2106, 351, 2142, 2142, 2142, 2142, 2142];
const SHORT_2 = [29, 40, 2122, 2135, 907, 2126, 2143, 2143, 2143, 2143];
const washes = [
  { seconds: 11_760, start: LONG },
  { seconds: 11_820, start: LONG_2 },
  { seconds: 5220, start: SHORT },
  { seconds: 5280, start: SHORT_2 },
];

test('how different two starts are, over the minutes both have', () => {
  assert.equal(difference(LONG, LONG), 0);
  assert.ok(difference(LONG, LONG_2)! < 0.15);
  assert.ok(difference(SHORT, SHORT_2)! < 0.1);
  assert.ok(difference(LONG, SHORT)! > 0.85);
  assert.ok(difference(LONG.slice(0, 3), SHORT)! > 0.85, 'told apart after three minutes');
  assert.equal(difference(LONG.slice(0, 2), SHORT), undefined, 'too soon to tell');
  assert.equal(difference([0, 0, 0], [0, 0, 0]), 0);
});

test("a washing machine's programmes have no usual length together, but each has one by how it starts", () => {
  assert.equal(usualSeconds(washes), undefined, 'not knowing how it started');
  assert.equal(usualSeconds(washes, SHORT.slice(0, 2)), undefined, 'too soon to tell');
  assert.equal(usualSeconds(washes, [27, 60, 2110]), 5250);
  assert.equal(usualSeconds(washes, [30, 48, 50, 52, 50]), 11_790);
  assert.equal(usualSeconds(washes, [1500, 1500, 1500]), undefined, 'a start not seen before');
  assert.deepEqual(usualByStart(washes), [5250, 11_790]);
});

test('cycles that agree keep their usual length, and a start alike but lengths apart has none', () => {
  const dryer = [3300, 3000, 2940].map((seconds) => ({ seconds, start: [110, 354, 362, 386, 405] }));
  assert.equal(usualSeconds(dryer), 3000);
  assert.equal(usualSeconds(dryer, [130, 400, 400, 410]), 3000);
  // The coffee machine: always the same heating up, then used for 23 minutes or 110.
  const coffee = [3420, 2160, 2100, 6600, 1380, 5700].map((seconds) => ({ seconds, start: [1193, 1191, 1189, 1187] }));
  assert.equal(usualSeconds(coffee, [1190, 1190, 1190]), undefined);
  assert.deepEqual(usualByStart(coffee), []);
  assert.equal(usualSeconds(washes.map(({ seconds }) => ({ seconds })), SHORT), undefined, 'no starts kept: all count');
});

test('lengths all over the place still have a median', () => {
  assert.equal(medianSeconds([1800, 9600, 3600, 600, 7200]), 3600);
  assert.equal(medianSeconds([600, 1800]), 1200);
  assert.equal(medianSeconds([3600]), undefined);
});
