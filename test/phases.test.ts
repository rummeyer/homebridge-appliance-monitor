/**
 * Phases against a coffee machine as described by its owner: it keeps warm
 * at 2–3 W, heats at 1000 W with the thermostat switching the element every
 * few seconds, and draws 300 W while a coffee runs through.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { findLevels, PhaseTracker, reportSeconds } from '../src/phases.ts';
import type { PhaseChange, PhaseConfig } from '../src/phases.ts';

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

test('by difference: a rinse and the shot after it are two draws, the heater beside the pump still held', () => {
  const pumpe = { name: 'Pumpe', minWatts: 40, maxWatts: 100, minSeconds: 4, holdSeconds: 15 };
  const span = (changes: PhaseChange[]) => changes.filter(({ active }) => !active).map(({ from, until }) => [from! / S, until! / S]);
  assert.deepEqual(span(track(new PhaseTracker(pumpe), rinseThenShot, 120)), [[10, 50]], 'held: one draw of 40 s');
  assert.deepEqual(
    span(track(new PhaseTracker({ ...pumpe, byDifference: true }), rinseThenShot, 120)),
    [[10, 24], [30, 50]],
    'the rinse ends 3 s after the 2 W, the shot is 20 s with the heater inside it',
  );
});

test('by difference: on after counts the heater beside the pump, so a coffee and a rinse split at one time', () => {
  const bezug = { name: 'Bezug', minWatts: 45, maxWatts: 100, minSeconds: 15, holdSeconds: 15, byDifference: true };
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

  // Without byDifference the heater seconds do not count: the same coffee is not one.
  assert.deepEqual(on({ ...bezug, byDifference: false }, coffee), [], 'the gap byDifference closes');
});

test('by difference: a heater warming up passes through the band in one reading, and is not the pump', () => {
  const pumpe = new PhaseTracker({ name: 'Pumpe', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, byDifference: true });
  // As the plug read it on 28.10.2026 at 09:16: 82 W for a second on the way up, the heater 6 s, then 2 W.
  const burst: [number, number][] = [[0, 2], [52, 82], [53, 1152], [54, 1217], [58, 240], [59, 2]];
  assert.deepEqual(track(pumpe, burst, 120).filter(({ active }) => active), [], 'no pump');
});

test('by difference: the pump stopping beneath the heater ends the draw, though the heater runs on', () => {
  const bezug = { name: 'Bezug', minWatts: 45, maxWatts: 100, minSeconds: 15, holdSeconds: 15, byDifference: true };
  const spuelen = { name: 'Spülen', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, maxSeconds: 15, byDifference: true };
  const pumpe = { name: 'Pumpe', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, byDifference: true };
  // 28.10.2026, 09:36: the pump alone 5 s, with the heater 6 s (1270 W), the heater alone 8 s more (1212 W).
  const rinse: [number, number][] = [[0, 3], [17, 44.4], [18, 57.6], [23, 1028], [24, 1275], [27, 1270], [28, 1254], [30, 1212.7], [36, 1211], [37, 536], [38, 5]];
  const changes = (phase: typeof bezug) => track(new PhaseTracker(phase), rinse, 120);
  assert.deepEqual(changes(bezug).filter(({ active }) => active), [], 'not a coffee');
  const rinsed = changes(spuelen).filter(({ active }) => active);
  assert.equal(rinsed.length, 1, 'a rinse');
  assert.equal((rinsed[0]!.until! - rinsed[0]!.from!) / S, 10, 'of 10 s, to the pump stopping: 1254 W at 28 s is it stopping within that second');
  const pump = changes(pumpe).find(({ active }) => !active)!;
  assert.equal((pump.until! - pump.from!) / S, 10, 'the shot timer ends with the pump, not the heater');

  // 09:37: the pump on after the heater has gone off is still the coffee, 21 s in all.
  const coffee: [number, number][] = [[0, 3], [44, 30], [45, 54], [52, 94], [53, 1180], [54, 1276], [59, 1268], [60, 829], [61, 54], [66, 17], [67, 3]];
  const brewed = track(new PhaseTracker(bezug), coffee, 120);
  assert.equal(brewed.filter(({ active }) => active).length, 1, 'a coffee');
  assert.equal((brewed.find(({ active }) => !active)!.until! - brewed[0]!.from!) / S, 21);
});

/** The coffee machine's phases as configured on 28.10.2026, all by difference. */
const coffeePhases = {
  bezug: { name: 'Bezug', minWatts: 45, maxWatts: 100, minSeconds: 15, holdSeconds: 15, byDifference: true },
  spuelen: { name: 'Spülen', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, maxSeconds: 15, byDifference: true },
  pumpe: { name: 'Pumpe', minWatts: 45, maxWatts: 100, minSeconds: 4, holdSeconds: 15, byDifference: true },
};

/** Each draw a phase took: when it went on, if live, and from when to when the draw was. */
function draws(phase: PhaseConfig, curve: [number, number][], until = 120): { on?: number; from: number; until: number }[] {
  const result: { on?: number; from: number; until: number }[] = [];
  let on: number | undefined;
  for (const change of track(new PhaseTracker(phase), curve, until)) {
    if (change.short) {
      result.push({ from: change.from! / S, until: change.until! / S });
    } else if (change.active) {
      on = change.at / S;
    } else {
      result.push({ on, from: change.from! / S, until: change.until! / S });
    }
  }
  return result;
}

test('by difference: a rinse started as the steam was opened, the heater beside them, is seen once the pump stops', () => {
  // As the plug read it on 28.10.2026 at 12:33: 8 W, the pump and the steam
  // coming on together, the heater beside them, the steam closed, the
  // pump stopping beneath the heater (1300 → 1245 W).
  const rinse: [number, number][] = [
    [0, 8.2], [1, 8.3], [2, 23.6], [3, 158.4], [4, 499], [5, 545.5], [6, 1551.3], [7, 1786.7], [8, 1415.2],
    [9, 1303.9], [10, 1302], [11, 1299.3], [13, 1276.3], [15, 1244.7], [16, 1243.1], [20, 10.2], [21, 4.8],
  ];
  assert.deepEqual(draws(coffeePhases.spuelen, rinse), [{ from: 2, until: 13 }], 'a rinse of 11 s');
  assert.deepEqual(draws(coffeePhases.bezug, rinse), [], 'not a coffee');
  assert.deepEqual(draws(coffeePhases.pumpe, rinse).map(({ from, until }) => until - from), [11], 'the shot timer told 11 s, once known');
});

test('by difference: a coffee drawn while the milk froths is the pump\'s step up beside the steam, and down again', () => {
  // The steam at 497 W, the pump 56 W beside it for 25 s, the heater coming
  // on beside both for 6 s, the steam closed 10 s after the pump stopped.
  const changes: [number, number][] = [[0, 5], [10, 497], [30, 520], [31, 553], [40, 1100], [41, 1787], [47, 553], [56, 497], [66, 8]];
  // A plug reporting every second, half a watt either way.
  const coffee = Array.from({ length: 67 }, (_, t): [number, number] => {
    const [at, watts] = changes.findLast(([at]) => at <= t)!;
    return [t, at === t ? watts : watts + (t % 2 ? 0.5 : -0.5)];
  });
  assert.deepEqual(draws(coffeePhases.bezug, coffee), [{ on: 45, from: 30, until: 56 }], 'a coffee of 26 s, on at 15 s into it');
  assert.deepEqual(draws(coffeePhases.spuelen, coffee), [], 'not a rinse');
});

test('by difference: the pump beside the steam, as the plug read it on 28.10.2026 at 09:39', () => {
  const froth: [number, number][] = [
    [0, 5], [5, 506], [6, 501.2], [9, 501.5], [10, 501.3], [11, 541], [12, 555.1], [13, 555.3], [14, 555.4], [15, 555.2],
    [17, 1114.6], [18, 1753.9], [19, 1763.1], [20, 1767.1], [21, 1720.6], [22, 1713.6], [23, 1712.6], [24, 1709.9], [30, 497], [31, 498], [40, 5],
  ];
  assert.deepEqual(draws(coffeePhases.spuelen, froth), [{ from: 11, until: 21 }], 'the pump for 10 s');
});

test('by difference: the heater coming on and off beside the steam is not the pump', () => {
  // 28.10.2026, 12:31–12:33: the steam, the heater beside it twice, a moment on the way each time.
  const froth: [number, number][] = [
    [0, 7.5], [1, 197.8], [2, 469.8], [3, 495], [4, 495.3], [5, 496], [10, 496.3], [11, 1466.7], [12, 1730.7], [13, 1728.6], [14, 1726.2],
    [16, 1683.3], [17, 600.1], [18, 497], [19, 497.2], [30, 497], [31, 1022.9], [32, 1734.7], [33, 1738.3], [36, 1312.1], [37, 520.2],
    [39, 506], [40, 498.4], [42, 497.7], [43, 499], [44, 96.3], [45, 8.4], [46, 8.2],
  ];
  for (const phase of Object.values(coffeePhases)) {
    assert.deepEqual(draws(phase, froth), [], phase.name);
  }
});

test('how often a plug\'s readings change while it draws: an Eve every 6 s however often asked, a Shelly every second', () => {
  // Asked every 2 s, its value changing every 6 s: each repeated three times.
  const eve = Array.from({ length: 90 }, (_, i) => ({ at: i * 2 * S, watts: 1200 + Math.floor(i / 3) }));
  assert.equal(reportSeconds(eve), 6);
  const shelly = Array.from({ length: 60 }, (_, i) => ({ at: i * S, watts: 1250 + (i % 2) }));
  assert.equal(reportSeconds(shelly), 1);
  // At rest a plug reports little, and that says nothing; nor do a few readings.
  assert.equal(reportSeconds(Array.from({ length: 60 }, (_, i) => ({ at: i * 30 * S, watts: 2 + (i % 2) / 10 }))), undefined);
  assert.equal(reportSeconds(shelly.slice(0, 10)), undefined);
});

test('by difference: settled at what the heater draws alone, the pump has stopped beneath it, though heater and pump were never a level', () => {
  // As the plug read it on 29.10.2026 at 08:29–08:30: a heater burst alone
  // at 1223 W, then a rinse of 6 s, the heater coming on a second before
  // the pump stopped and running on alone 8 s more.
  const rinse: [number, number][] = [
    [0, 2], [46, 1223.1], [47, 1225.2], [48, 1223.1], [49, 1220.3], [50, 1012], [51, 32], [52, 2],
    [62, 2], [82, 41.1], [83, 57.1], [86, 57], [87, 56.9], [88, 1222.3], [89, 1274.6], [90, 1226.9], [91, 1219.8],
    [92, 1217.4], [93, 1216], [94, 1215.7], [95, 1214.3], [96, 1214.2], [97, 1213.7], [98, 365], [99, 2],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, rinse), [], 'not a coffee');
  assert.deepEqual(draws(coffeePhases.spuelen, rinse), [{ from: 83, until: 88 }], 'a rinse, to the heater coming on');
});

test('by difference: one reading back in the band after the pump stopped, on the heater\'s way up, is not the pump again', () => {
  // As the plug read it on 29.10.2026 at 13:43: a heater burst alone, a rinse
  // of 5 s, 3 s at rest, the heater coming on through 53 W in one reading.
  const rinse: [number, number][] = [
    [0, 2], [1, 361.3], [2, 1258.3], [3, 1256.3], [4, 1254.2], [5, 1252.6], [6, 378.2], [7, 3.2], [8, 2],
    [9, 20.5], [10, 57.8], [12, 58.3], [13, 58.4], [14, 55.4], [15, 5.8], [16, 2.1], [17, 2], [18, 53.1],
    [19, 1166.7], [20, 1256.6], [21, 1253.4], [22, 1252], [23, 1250.4], [24, 956.9], [25, 3], [26, 2],
  ];
  assert.deepEqual(draws(coffeePhases.spuelen, rinse), [{ from: 10, until: 15 }], 'a rinse of 5 s, over at 15 s');
  const pump = track(new PhaseTracker(coffeePhases.pumpe), rinse, 60);
  assert.equal(pump.find(({ active }) => !active)!.until! / S, 15, 'the shot timer told the pump stopped at 15 s, and not taken back');
});

test('by difference: a reading at what the heater draws alone, held 1.5 s, is it alone though the heater goes off next', () => {
  // 29.10.2026, 13:45: a heater burst from rest, then the heater alone at
  // 1250 W, the pump beside it for 3 s, the heater alone for one reading
  // two seconds long, then off.
  const pump: [number, number][] = [
    [0, 5], [1, 4.9], [2, 1253], [3, 1252.4], [4, 1251.8], [5, 380], [6, 4.8], [10, 5],
    [20, 1252], [21, 1251.5], [22, 1250.7], [23, 1249.9], [24, 1298.7], [25, 1302.5], [26, 1280.2], [27, 1249.3], [29, 50.1], [30, 4.8], [31, 5],
  ];
  const changes = track(new PhaseTracker({ ...coffeePhases.pumpe, minSeconds: 2 }), pump, 60);
  const off = changes.find(({ active }) => !active)!;
  assert.deepEqual([off.from! / S, off.until! / S], [24, 26], 'the pump from 24 s to its fall at 26 s, not on to the heater going off');
});

test('by difference: a pump in the band alone just short of counting the time above, seen stopping beneath the heater, ran all along', () => {
  // As the plug read it on 30.10.2026 at 12:45: the pump alone 2 s, the
  // heater beside it 3 s (1320 W), the pump stopping beneath it (1266 W).
  const rinse: [number, number][] = [
    [0, 2], [3, 1.9], [9, 56.7], [10, 58.4], [11, 661.9], [12, 1319.8], [13, 1314.1], [14, 1265.8], [15, 1261.3],
    [16, 1259.5], [17, 1259.4], [18, 1259], [19, 1174.1], [20, 72.9], [21, 2.1], [22, 2],
  ];
  assert.deepEqual(draws(coffeePhases.spuelen, rinse), [{ from: 9, until: 14 }], 'a rinse of 5 s');
  assert.deepEqual(draws(coffeePhases.bezug, rinse), [], 'not a coffee');
});

test('by difference: a pump in the band alone just short of counting the time above, settling at what the heater draws alone, ran all along', () => {
  // As the plug read it on 2.11.2026 from 12:07:40, to the millisecond as it
  // may have come, the platform ticking every 5 s: heater bursts from rest,
  // the grinder, then a rinse of 14 s at 91.6 s — the pump alone 1.5 s, the
  // heater beside it (1288 W), the pump stopping beneath it at what it drew
  // alone (1234 W).
  const curve: [number, number][] = [
    [0.038, 1.8], [3.398, 1.7], [4.412, 1.8], [5.587, 1.9], [6.505, 1.8], [7.597, 1.9], [8.87, 304.5],
    [9.593, 1224.5], [10.684, 1241.1], [11.451, 1237], [12.259, 1235], [13.352, 1233.7], [14.176, 3.3],
    [16.104, 1.9], [19.754, 1.8], [20.613, 1.9], [21.197, 1.8], [22.558, 1.9], [23.246, 1.8], [29.406, 1.9],
    [30.781, 1.8], [34.172, 1.9], [36.694, 1.8], [41.362, 1.9], [43.438, 2], [44.134, 1.9], [48.022, 1.8],
    [49.395, 1.9], [52.009, 36.8], [53.072, 1136.6], [54.105, 1239.5], [55.547, 1237.2], [56.589, 1236],
    [57.428, 1235], [58.036, 301], [59.216, 297.8], [60.504, 295.7], [61.638, 294.5], [62.095, 298.7],
    [63.015, 295.6], [64.324, 297.9], [65.067, 151.5], [66.068, 2.8], [67.758, 1.9], [68.381, 2], [70.458, 1.9],
    [71.604, 2], [72.753, 1.9], [73.149, 2], [74.966, 1.9], [76.181, 2], [81.906, 1.9], [82.024, 2], [83.832, 1.9],
    [86.327, 2], [88.984, 1.9], [89.572, 2], [90.486, 12.8], [91.575, 56.4], [92.982, 57.4], [93.095, 422.3],
    [94.618, 1280.2], [95.426, 1291.7], [96.207, 1290.8], [97.993, 1287.8], [98.331, 1286.9], [99.669, 1286.8],
    [100.046, 1288.7], [101.084, 1287.9], [102.283, 1288], [103.317, 1288.1], [104.332, 1287.5], [105.494, 1267.9],
    [106.848, 1234.4], [107.673, 1233.8], [108.919, 1233.6], [110.136, 1233.3], [111.326, 1139.4], [112.705, 66],
    [113.067, 2.1], [114.204, 2], [115.291, 1.9], [117.134, 2], [118.813, 1.9], [119.036, 2]
  ];
  const run = (phase: PhaseConfig): PhaseChange[] => {
    const tracker = new PhaseTracker(phase);
    const changes: PhaseChange[] = [];
    const keep = (change: PhaseChange | undefined) => change && changes.push(change);
    let tick = 4.684;
    for (const [seconds, watts] of curve) {
      for (; tick < seconds; tick += 5) {
        keep(tracker.tick(tick * S));
      }
      keep(tracker.reading(seconds * S, watts));
    }
    for (; tick < 160; tick += 5) {
      keep(tracker.tick(tick * S));
    }
    return changes;
  };
  const rinse = run({ ...coffeePhases.spuelen, minSeconds: 3 });
  assert.equal(rinse.length, 1, 'a rinse');
  assert.deepEqual([rinse[0]!.from! / S, rinse[0]!.until! / S], [91.575, 105.494], 'from the pump starting to its step down beneath the heater');
  assert.deepEqual(run(coffeePhases.bezug), [], 'not a coffee');
});

test('by difference: the pump stopping as the heater goes off beside the steam, the draw falling straight to the steam alone', () => {
  // As the plug read it on 3.11.2026 from 14:25:13: the milk frothing at
  // 493 W, a rinse beside it with the heater on, the pump on again for 3 s,
  // then pump and heater off at once, down to the steam alone, and the
  // heater twice more beside the steam until it closed.
  const froth: [number, number][] = [
    [0, 1749.3], [1, 1118.5], [2, 506.9], [3, 492.7], [4, 493], [5, 492.9], [7, 493], [8, 493.3], [10, 492.9], [11, 492.2],
    [12, 492.1], [13, 492.3], [14, 492.4], [15, 492.7], [16, 493], [17, 492.9], [18, 492.4], [19, 492.9], [20, 493], [21, 492.6],
    [23, 492.4], [24, 523.1], [25, 548.9], [26, 703.7], [27, 1754.7], [28, 1806.8], [29, 1805.1], [30, 1803.2], [31, 1802.8], [32, 1801.8],
    [33, 1800.1], [34, 1785.5], [35, 1746.5], [36, 1745.7], [37, 1745.5], [38, 1744.8], [39, 1796.8], [41, 1797.6], [42, 1771.8], [43, 1743.4],
    [44, 870.5], [45, 507.5], [46, 492.7], [48, 492.4], [49, 492.2], [50, 492.4], [51, 492.5], [52, 492.7], [53, 492.8], [54, 1252.5],
    [55, 1737.7], [56, 1743.2], [57, 1741.3], [58, 1739.7], [59, 1740], [60, 1739.9], [61, 794.1], [62, 505.6], [63, 493.8], [64, 491.9],
    [65, 492], [66, 493.1], [67, 493.7], [68, 494], [69, 494.4], [70, 494.6], [71, 495.5], [72, 495.8], [74, 496.1], [75, 495.3],
    [76, 495], [77, 495.5], [78, 495.8], [79, 496.3], [80, 579.4], [81, 1676], [82, 1749.8], [84, 1747.9], [85, 1746.1], [86, 1507],
    [87, 532.8], [88, 506.4], [89, 497.7], [90, 497.4], [92, 497.2], [93, 497.5], [94, 497.7], [95, 497.2], [96, 497.8], [97, 498.1],
    [98, 498.3], [99, 498.1], [100, 498.2], [101, 498.5], [102, 498.2], [103, 498.3], [104, 498.4], [105, 498.7], [106, 155], [108, 8.9],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, froth, 140), [], 'not a coffee');
  assert.deepEqual(draws(coffeePhases.spuelen, froth, 140), [{ from: 24, until: 35 }], 'the rinse of 11 s; the pump\'s 3 s after it too short for one');
});

test('by difference: the pump stopping beneath the steam it started beside, the heater coming and going around it', () => {
  // As the plug read it on 4.11.2026 from 12:51:50: the milk frothing at
  // 497 W, held only a few seconds between the heater's bursts, a coffee
  // of 21 s beside it, then the milk on alone for half a minute.
  const froth: [number, number][] = [
    [0, 492.2], [1, 492.5], [2, 492.3], [3, 492.8], [4, 493], [5, 1060.4], [6, 1717.8], [7, 1722.6], [8, 1725.7], [9, 1725.1],
    [10, 1724.5], [11, 1723.8], [12, 504.8], [13, 499.9], [14, 497.1], [15, 497.6], [16, 497.1], [17, 497], [18, 506.6], [19, 550.8],
    [20, 552.1], [21, 551.8], [22, 551.5], [24, 551], [25, 551.1], [26, 1757.3], [27, 1772.2], [28, 1778.9], [29, 1778.6], [30, 1776.7],
    [31, 1774.9], [32, 1775.3], [33, 1774.7], [34, 1776.9], [35, 1777.1], [36, 1776], [37, 1448.1], [38, 577.4], [39, 559.9], [40, 498.7],
    [41, 497.1], [42, 497.3], [43, 497.5], [44, 497.6], [45, 497.4], [46, 497.7], [47, 1722.6], [48, 1726.8], [49, 1733.8], [50, 1726.8],
    [51, 1725.6], [52, 1728.4], [53, 1702.2], [54, 499.5], [56, 497.9], [57, 497.7], [58, 497.8], [59, 497.6], [60, 497.8], [61, 498],
    [62, 498.1], [64, 498.3], [65, 498.7], [66, 499.2], [67, 500.1], [68, 500.4], [69, 501], [70, 501.7], [71, 1488.2], [72, 1733.6],
    [73, 1734.5], [74, 1488.1], [75, 1247.5], [76, 1246.3], [77, 211.7], [78, 8.8],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, froth).map(({ from, until }) => ({ from, until })), [{ from: 19, until: 40 }], 'a coffee of 21 s, not of 55 until the milk stopped');

  // On 5.11.2026 from 08:24:25: back at the steam for a single reading, the
  // heater on beside it a second later.
  const brief: [number, number][] = [
    [0, 498.5], [1, 499.3], [2, 499.6], [3, 500.1], [4, 499.8], [5, 500.1], [6, 499.8], [8, 499.4], [9, 499.6], [10, 499.8],
    [13, 501.5], [14, 553.6], [15, 567.2], [16, 1621.3], [17, 1757.6], [18, 1760.3], [19, 1759.2], [20, 1757.4], [21, 1754.2], [22, 1754.1],
    [23, 1751.7], [24, 1752.2], [25, 1245.4], [26, 568.5], [27, 549.1], [28, 549], [30, 548.9], [31, 549.2], [32, 549.1], [34, 548.9],
    [35, 536.2], [36, 499.8], [37, 1688.4], [38, 1702.5], [40, 1708.9], [41, 1707.9], [42, 1697.9], [43, 1268.6], [44, 1175.7], [45, 8.3],
    [46, 8.1], [47, 8.2], [48, 8.1],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, brief).map(({ from, until }) => ({ from, until })), [{ from: 14, until: 36 }], 'a coffee of 22 s, not of 31');
});

test('by difference: the pump counted on above the band while the heater and the milk come and go, or started as the heater went off', () => {
  // As the plug read it on 6.11.2026 from 08:26:24: the pump alone, then the
  // heater beside it, the milk too, the heater off, and the pump stopping
  // beneath the milk 22 s after it started, never back in the band alone.
  const alone: [number, number][] = [
    [0, 3.1], [1, 2.9], [2, 2.8], [3, 2.9], [4, 57.7], [5, 57.6], [6, 57.8], [7, 57.1], [8, 172.2], [9, 1218], [10, 1270],
    [11, 1266.4], [12, 1263.7], [13, 1262.8], [14, 1694.1], [15, 1719.7], [16, 1728.3], [17, 1732.3], [18, 1732.2], [19, 1699.1],
    [20, 652.3], [21, 540.9], [22, 537], [23, 536.8], [25, 522.2], [26, 488.2], [27, 487.6], [28, 487.7], [29, 488.4],
    [30, 488.5], [31, 489.5], [32, 1675.6], [33, 1687.2], [34, 1691.6], [35, 1690.4], [36, 1688.2],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, alone).map(({ from, until }) => ({ from, until })), [{ from: 4, until: 26 }], 'a coffee of 22 s, not of 4');

  // From 13:24:16: the milk at 492 W, the heater beside it for 5 s, and as
  // it went off the pump on, 54 W above the milk until it stopped.
  const unseen: [number, number][] = [
    [0, 7.4], [3, 7.3], [5, 456.6], [6, 478.4], [7, 525.1], [8, 543.7], [9, 543.9], [10, 512.9], [11, 490.6], [12, 492],
    [13, 494], [14, 1541], [15, 1713.3], [16, 1718.8], [17, 1715.8], [18, 1715.6], [19, 1644.7], [20, 622.3], [21, 559.6],
    [22, 548.1], [23, 546.4], [24, 546.2], [26, 545], [27, 662.5], [28, 1709.8], [29, 1760.8], [30, 1769.5], [31, 1768.6],
    [32, 1767.4], [33, 1766.9], [34, 1766.7], [35, 1488.2], [37, 556.6], [38, 548.5], [39, 548.4], [40, 549.3], [41, 551],
    [42, 521.4], [43, 500.2], [44, 501.6], [45, 816.3], [46, 1711.5], [47, 1726.9], [48, 1247], [49, 1245.8], [50, 1245.6],
    [51, 1229.1], [52, 142.6], [53, 8.5], [54, 8.1], [55, 8],
  ];
  assert.deepEqual(draws(coffeePhases.bezug, unseen).map(({ from, until }) => ({ from, until })), [{ from: 19, until: 42 }], 'a coffee of 23 s, not none');
});

test('by difference: a step down by the band\'s size eight minutes into heating up is not a pump seen only as it stopped', () => {
  // As the plug read it on 31.10.2026 from 08:27: switched on into heating
  // at 1267 W, slowly down to 1250, then 39 W gone (1211 W) and off.
  const heating: [number, number][] = [[0, 2.8], [1, 2.6], [2, 922.9], [3, 1266.9]];
  for (let t = 4; t < 478; t++) {
    heating.push([t, 1266.9 - (t / 478) * 17 + (t % 2 ? 0.3 : -0.3)]);
  }
  heating.push([478, 1247.2], [479, 1211.4], [480, 1211.5], [481, 1212], [482, 1211.8], [483, 748], [484, 2.8], [485, 2.7]);
  for (const phase of Object.values(coffeePhases)) {
    assert.deepEqual(draws(phase, heating, 520), [], phase.name);
  }
});
