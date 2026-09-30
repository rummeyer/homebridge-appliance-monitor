/**
 * Phases against a coffee machine as described by its owner: it keeps warm
 * at 2–3 W, heats at 1000 W with the thermostat switching the element every
 * few seconds, and draws 300 W while a coffee runs through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { findLevels, PhaseTracker } from '../src/phases.ts';
import type { PhaseChange } from '../src/phases.ts';

const S = 1000;

/** [seconds, watts] changes, from 0. */
function coffeeMorning(): [number, number][] {
  const curve: [number, number][] = [[0, 0]];
  curve.push([60, 2.5]); // switched on
  // Heating up: element on 8 s, off 4 s, for three minutes.
  for (let t = 90; t < 270; t += 12) {
    curve.push([t, 1010], [t + 8, 2.8]);
  }
  curve.push([400, 305], [430, 2.6]); // a coffee
  curve.push([700, 990], [760, 2.5]); // reheating once
  curve.push([1000, 310], [1028, 2.4]); // another coffee
  curve.push([3600, 0]); // switched off
  return curve;
}

const samples = (curve: [number, number][]): Sample[] => curve.map(([seconds, watts]) => ({ at: seconds * S, watts }));

test('a coffee machine shows three levels: keeping warm, a coffee, heating', () => {
  const levels = findLevels(samples(coffeeMorning()), 3700 * S);
  assert.deepEqual(
    levels.map(({ watts }) => watts),
    [2.4, 310, 1000], // where it sat longest: 2.4 W after the second coffee
  );
  for (const [index, level] of levels.entries()) {
    assert.ok(level.minWatts < level.watts && level.watts < level.maxWatts, `${level.watts} W is inside its band`);
    const next = levels[index + 1];
    if (next) {
      assert.ok(level.maxWatts <= next.minWatts, 'bands do not overlap');
    }
  }
  assert.equal(levels[1]!.seconds, 58, 'two coffees, 30 and 28 seconds');
});

test('nothing at all, or only off, is no levels', () => {
  assert.deepEqual(findLevels([], 1000), []);
  assert.deepEqual(findLevels([{ at: 0, watts: 0 }], 3600 * S), []);
});

/** Plays a curve into a tracker, ticking every second. */
function track(tracker: PhaseTracker, curve: [number, number][], until: number): PhaseChange[] {
  const changes: PhaseChange[] = [];
  const keep = (change: PhaseChange | undefined) => change && changes.push(change);
  let next = 0;
  for (let t = 0; t <= until; t++) {
    while (next < curve.length && curve[next]![0] === t) {
      keep(tracker.reading(t * S, curve[next]![1]));
      next++;
    }
    keep(tracker.tick(t * S));
  }
  return changes;
}

test('heating is one phase however often the thermostat switches, and ends once it stops', () => {
  const heating = new PhaseTracker({ name: 'Heating', minWatts: 700, maxWatts: 1400 });
  const changes = track(heating, coffeeMorning(), 3700);
  assert.deepEqual(
    changes.map(({ active, at, since }) => [active, at / S, since === undefined ? undefined : since / S]),
    [
      [true, 95, undefined], // five seconds into the first burst
      [false, 296, 95], // half a minute after the last burst ended, at 266 s
      [true, 705, undefined], // reheating
      [false, 790, 705],
    ],
  );
});

test('each coffee is a phase of its own', () => {
  const coffee = new PhaseTracker({ name: 'Coffee', minWatts: 150, maxWatts: 700, holdSeconds: 10 });
  const changes = track(coffee, coffeeMorning(), 3700);
  assert.deepEqual(
    changes.map(({ active, at }) => [active, at / S]),
    [
      [true, 405],
      [false, 440],
      [true, 1005],
      [false, 1038],
    ],
  );
});

test('a moment in the band is not the phase', () => {
  const coffee = new PhaseTracker({ name: 'Coffee', minWatts: 150, maxWatts: 700, minSeconds: 5 });
  const changes = track(coffee, [[0, 2.5], [10, 300], [13, 2.5], [100, 300], [102, 2.5]], 200);
  assert.deepEqual(changes, []);
});

test('a phase with no upper end is everything from its lower one up', () => {
  const heating = new PhaseTracker({ name: 'Heating', minWatts: 700 });
  const changes = track(heating, [[0, 2.5], [10, 2200], [40, 2.5]], 100);
  assert.deepEqual(changes.map(({ active, at }) => [active, at / S]), [
    [true, 15],
    [false, 70],
  ]);
});
