/**
 * How long an appliance's cycles usually take, for the time left on the
 * dashboard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { durationsOf, KEEP_CYCLES, typicalSeconds, withDuration } from '../src/typical.ts';

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
  let durations: number[] = [];
  for (let index = 1; index <= KEEP_CYCLES + 3; index++) {
    durations = withDuration(durations, index);
  }
  assert.equal(durations.length, KEEP_CYCLES);
  assert.equal(durations.at(-1), KEEP_CYCLES + 3);
});

test('an appliance from before 1.7.0 starts from its last cycle', () => {
  const lastCycle = { startedAt: 0, endedAt: 3_600_000, seconds: 3600, wattHours: 800 };
  assert.deepEqual(durationsOf({ lastCycle }), [3600]);
  assert.deepEqual(durationsOf({ lastCycle, durations: [] }), [], 'not after Forget');
  assert.deepEqual(durationsOf({}), []);
});
