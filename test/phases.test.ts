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
      // Known once it has been below the band for a few seconds: then on, for a moment.
      [true, true, 109, 100, 106, 6],
      [true, true, 508, 500, 505, 5],
    ],
  );
});

test('a flush a few seconds before the coffee is not part of it, read every second', () => {
  // A morning on a plug that reads every second: flushed with the heater on,
  // the heater alone, then the coffee with the heater beside the pump.
  const pumpe = new PhaseTracker({ name: 'Pumpe', minWatts: 40, maxWatts: 100, minSeconds: 4, holdSeconds: 15 });
  const curve: [number, number][] = [[0, 3], [2, 1288], [8, 59], [10, 3], [14, 1235], [21, 3], [22, 58], [29, 1281], [38, 55], [46, 4]];
  assert.deepEqual(
    track(pumpe, curve, 80).map(({ active, at, from, until }) => [active, at / S, from! / S, until === undefined ? null : until / S]),
    [[true, 26, 22, null], [false, 61, 22, 46]],
  );
});

test('the pump with the heater beside it is not a rinse: short is from start to end, the time above counted', () => {
  const spuelen = new PhaseTracker({ name: 'Spülen', minWatts: 40, maxWatts: 100, minSeconds: 4, holdSeconds: 15, maxSeconds: 10 });
  // A reading in the band as the steam's heater switches off, then the pump for 19 s, 12 of them beside the heater.
  assert.deepEqual(track(spuelen, [[0, 3], [27, 99.5], [28, 8], [33, 58], [40, 1300], [51, 874], [52, 16]], 100), []);
  // A rinse of 5 s alone is one, known a few seconds after.
  assert.deepEqual(
    track(spuelen, [[0, 3], [10, 58], [15, 3]], 60).map(({ short, at, since, until }) => [short, at / S, since! / S, until! / S]),
    [[true, 18, 10, 15]],
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

test('a plug gone unreachable or switched off ends a phase after its hold, as nothing is known to be drawn, and a dropout does not', () => {
  const standby = new PhaseTracker({ name: 'Standby', minWatts: 0, maxWatts: 1.3 });
  assert.equal(standby.reading(0, 0.8), undefined);
  assert.deepEqual(standby.tick(10 * S), { active: true, at: 10 * S, from: 0 });
  // Back within the hold: still the same standby.
  assert.equal(standby.none(100 * S), undefined);
  assert.equal(standby.reading(110 * S, 0.8), undefined);
  assert.equal(standby.tick(200 * S), undefined);
  assert.ok(standby.active);
  // Gone for good: over half a minute later, however long the last reading was in the band.
  assert.equal(standby.none(300 * S), undefined);
  assert.equal(standby.tick(320 * S), undefined);
  assert.deepEqual(standby.tick(330 * S), { active: false, at: 330 * S, since: 10 * S, inBandMs: 290 * S, from: 0, until: 300 * S }, 'the dropout not counted as in the band');
  assert.equal(standby.tick(3600 * S), undefined, 'and stays off while unreachable');
});

test('a phase says when the draw entered and left its range, for how long it really lasted', () => {
  // A coffee: pump at 55 W with a heater burst in the middle, as the Eve reads it.
  const tracker = new PhaseTracker({ name: 'Pumpe', minWatts: 30, maxWatts: 100, minSeconds: 1, holdSeconds: 15 });
  const changes = track(tracker, [[0, 2], [10, 55], [16, 1200], [22, 55], [34, 2]], 80);
  assert.equal(changes.length, 2);
  const [on, off] = changes;
  assert.equal(on!.active, true);
  assert.equal(on!.from, 10 * S, 'the draw entered the range at 10 s');
  assert.equal(off!.active, false);
  assert.equal(off!.from, 10 * S);
  assert.equal(off!.until, 34 * S, 'left it at 34 s, the hold not counted, the heater burst inside');
  assert.equal(off!.at, 49 * S, 'though the phase went off only after the hold');
});

test('a phase that ends above its range lasts until the draw falls below it', () => {
  // The coffee of 24 October: the heater on beside the pump for its last seconds, read as 1209 W.
  const tracker = new PhaseTracker({ name: 'Pumpe', minWatts: 30, maxWatts: 100, minSeconds: 1, holdSeconds: 15 });
  const curve: [number, number][] = [[0, 2], [6, 51], [12, 1208], [18, 56], [24, 1262], [30, 690], [36, 45], [42, 134], [48, 1209], [54, 2]];
  const off = track(tracker, curve, 120).find(({ active }) => !active);
  assert.equal(off!.from, 6 * S);
  assert.equal(off!.until, 54 * S, 'the pump ran until the draw fell to 2 W, not until it last left the range at 42 s');
});

test('the heater coming on after the pump has stopped is not the pump', () => {
  // The coffee of 25 October, 20 s: the pump with the heater beside it, then the pump
  // alone, then down to 6 W, and the heater alone six seconds later.
  const tracker = new PhaseTracker({ name: 'Pumpe', minWatts: 30, maxWatts: 100, minSeconds: 1, holdSeconds: 15 });
  const curve: [number, number][] = [[0, 6], [6, 59], [12, 1260], [18, 1246], [24, 56], [30, 6], [36, 1206], [42, 6]];
  const off = track(tracker, curve, 120).find(({ active }) => !active);
  assert.equal(off!.from, 6 * S);
  assert.equal(off!.until, 30 * S, 'the pump stopped when the draw fell to 6 W, not when the heater did at 42 s');
});

test('while the phase is on, it says at once when the draw fell below it, and forgets it when the draw is back', () => {
  const tracker = new PhaseTracker({ name: 'Pumpe', minWatts: 40, maxWatts: 100, minSeconds: 1, holdSeconds: 15 });
  tracker.reading(0, 2);
  assert.equal(tracker.until, undefined, 'not while it is off');
  tracker.reading(6 * S, 55);
  tracker.tick(7 * S);
  assert.equal(tracker.active, true);
  assert.equal(tracker.until, undefined, 'in the range');
  tracker.reading(12 * S, 1230);
  assert.equal(tracker.until, undefined, 'above it, as the heater beside the pump');
  tracker.reading(18 * S, 2);
  assert.equal(tracker.until, 18 * S);
  tracker.reading(24 * S, 1190);
  assert.equal(tracker.until, 18 * S, 'the heater alone after it does not take it back');
  tracker.reading(30 * S, 55);
  assert.equal(tracker.until, undefined, 'the pump again');
  tracker.reading(36 * S, 2);
  tracker.tick(51 * S);
  assert.equal(tracker.active, false);
  assert.equal(tracker.until, undefined, 'not once it is off');
});

test('a draw that stays above the range until the phase ends: the phase lasted until it left it', () => {
  const tracker = new PhaseTracker({ name: 'Pumpe', minWatts: 30, maxWatts: 100, minSeconds: 1, holdSeconds: 15 });
  const off = track(tracker, [[0, 2], [10, 55], [20, 1200], [60, 2]], 120).find(({ active }) => !active);
  assert.equal(off!.until, 20 * S);
  assert.equal(off!.at, 35 * S);
});

/**
 * As the plug read it on 2026-10-27: a rinse of 7 s with the heater after it,
 * the machine at 2 W, then a coffee of 20 s with the heater beside the pump,
 * all within the pump's 15 s hold.
 */
const rinseThenShot: [number, number][] = [
  [0, 3], [10, 58], [16, 1245], [24, 2], [30, 57], [35, 1290], [44, 57], [50, 2],
];

test('off below: a rinse and the shot after it are two draws, the heater beside the pump still held', () => {
  const pumpe = { name: 'Pumpe', minWatts: 40, maxWatts: 100, minSeconds: 4, holdSeconds: 15 };
  const span = (changes: PhaseChange[]) => changes.filter(({ active }) => !active).map(({ from, until }) => [from! / S, until! / S]);
  assert.deepEqual(span(track(new PhaseTracker(pumpe), rinseThenShot, 120)), [[10, 50]], 'held: one draw of 40 s');
  assert.deepEqual(
    span(track(new PhaseTracker({ ...pumpe, offBelow: true }), rinseThenShot, 120)),
    [[10, 24], [30, 50]],
    'the rinse ends 3 s after the 2 W, the shot is 20 s with the heater inside it',
  );
});

test('off below: on after counts the heater beside the pump, so a coffee and a rinse split at one time', () => {
  const bezug = { name: 'Bezug', minWatts: 45, maxWatts: 100, minSeconds: 15, holdSeconds: 15, offBelow: true };
  const spuelen = { name: 'Spülen', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, maxSeconds: 15 };
  const on = (phase: typeof bezug | typeof spuelen, curve: [number, number][]) =>
    track(new PhaseTracker(phase), curve, 120).filter(({ active }) => active).map(({ at, short }) => [at / S, short ?? false]);

  // A coffee of 20 s, the heater on top of the pump for 9 of them: 11 s in the band, 20 s in all.
  const coffee: [number, number][] = [[0, 2], [10, 57], [15, 1290], [24, 57], [30, 2]];
  assert.deepEqual(on(bezug, coffee), [[25, false]], 'a coffee, live at 15 s into it');
  assert.deepEqual(on(spuelen, coffee), [], 'not a rinse');

  // The pump alone for 12 s, no heater: a rinse, and not a coffee.
  const rinse: [number, number][] = [[0, 2], [10, 57], [22, 2]];
  assert.deepEqual(on(bezug, rinse), [], 'not a coffee');
  assert.deepEqual(on(spuelen, rinse), [[25, true]], 'a rinse, known 3 s after it');

  // Without offBelow the heater seconds do not count: the same coffee is not one.
  assert.deepEqual(on({ ...bezug, offBelow: false }, coffee), [], 'the gap offBelow closes');
});
