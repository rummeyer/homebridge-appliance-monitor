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

test('an ended phase tells how long the draw was in the band, without the hold after it', () => {
  const coffee = new PhaseTracker({ name: 'Coffee', minWatts: 150, maxWatts: 700, holdSeconds: 10 });
  const ends = track(coffee, coffeeMorning(), 3700).filter(({ active }) => !active);
  assert.deepEqual(
    ends.map(({ inBandMs }) => inBandMs! / S),
    [30, 28],
  );
});

/** A rinse of 6 s, an espresso of 20 s, and another rinse, as the pump draws them. */
const rinseAndEspresso: [number, number][] = [[0, 3], [100, 48], [106, 3], [300, 50], [320, 3], [500, 47], [505, 3]];

test('a coffee and a rinse in the same band: the long draw is one, the short ones the other, never both', () => {
  const bezug = new PhaseTracker({ name: 'Bezug', minWatts: 30, maxWatts: 100, minSeconds: 10, holdSeconds: 15 });
  const spuelen = new PhaseTracker({ name: 'Spülen', minWatts: 30, maxWatts: 100, minSeconds: 2, holdSeconds: 15, maxSeconds: 10 });
  assert.deepEqual(
    track(bezug, rinseAndEspresso, 600).map(({ active, at }) => [active, at / S]),
    [[true, 310], [false, 335]],
  );
  assert.deepEqual(
    track(spuelen, rinseAndEspresso, 600).map(({ active, short, at, since, until, inBandMs }) =>
      [active, short, at / S, since! / S, until! / S, inBandMs! / S]),
    [
      // Known once it has been out of the band for the hold: then on, for a moment.
      [true, true, 121, 100, 106, 6],
      [true, true, 520, 500, 505, 5],
    ],
  );
});

test('a draw too short even for the short phase is neither', () => {
  const spuelen = new PhaseTracker({ name: 'Spülen', minWatts: 30, maxWatts: 100, minSeconds: 2, holdSeconds: 15, maxSeconds: 10 });
  assert.deepEqual(track(spuelen, [[0, 3], [100, 48], [101, 3]], 200), []);
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

/** A washing machine: switched on at 3 W to be loaded, washing at 20–2000 W, resting at 3 W once done. */
const washDay: [number, number][] = [[0, 0], [100, 3.2], [200, 25], [1000, 2100], [1300, 30], [2000, 4.2], [2002, 3.2], [3000, 0]];
const gewaschen = { name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, minSeconds: 25, holdSeconds: 15 };

test('a phase only from above is the machine resting once done, not switched on to be loaded', () => {
  assert.deepEqual(
    track(new PhaseTracker(gewaschen), washDay, 3100).map(({ active, at }) => [active, at / S]),
    [[true, 125], [false, 215], [true, 2025], [false, 3015]],
    'without it, both',
  );
  assert.deepEqual(
    track(new PhaseTracker({ ...gewaschen, onDown: true }), washDay, 3100).map(({ active, at }) => [active, at / S]),
    [[true, 2025], [false, 3015]],
  );
});

test('a draw that rose into the band counts once it has come down into it from above', () => {
  const phase = new PhaseTracker({ ...gewaschen, onDown: true });
  // Loaded at 3 W, the door opened again (10 W, above), back to 3 W.
  const changes = track(phase, [[0, 0], [10, 3], [100, 10], [105, 3]], 200);
  assert.deepEqual(changes.map(({ active, at }) => [active, at / S]), [[true, 130]]);
});

test('after a restart, the recording tells where the draw came from', () => {
  const loading = new PhaseTracker({ ...gewaschen, onDown: true });
  loading.recall([{ watts: 0 }, { watts: 3.2 }]);
  assert.deepEqual(track(loading, [[0, 3.2]], 100), [], 'risen from nothing before the restart');

  const done = new PhaseTracker({ ...gewaschen, onDown: true });
  done.recall([{ watts: 30 }, { watts: 4.2 }, { watts: 3.2 }]);
  assert.deepEqual(track(done, [[0, 3.2]], 100).map(({ active, at }) => [active, at / S]), [[true, 25]]);

  const unknown = new PhaseTracker({ ...gewaschen, onDown: true });
  assert.deepEqual(track(unknown, [[0, 3.2]], 100).map(({ active, at }) => [active, at / S]), [[true, 25]],
    'nothing recorded: a false alarm rather than none');
});
