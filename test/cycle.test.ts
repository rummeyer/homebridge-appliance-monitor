/**
 * The state machine and the learning, against made-up but typical cycles.
 *
 * A device reports only when its draw changes, so the curves here are lists
 * of changes, and time between them passes in ticks — as it does in the
 * plugin, where nothing else would notice a machine going quiet.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CycleMachine, cycleState } from '../src/cycle.ts';
import type { Transition } from '../src/cycle.ts';
import { learnFromCycle } from '../src/learn.ts';
import type { Learned } from '../src/learn.ts';
import { DeviceMonitor, LEARNING_DEFAULTS } from '../src/monitor.ts';

const S = 1000;
const MIN = 60 * S;
const TICK = 10 * S;

/** [seconds from the start of the curve, watts] */
type Curve = [number, number][];

/**
 * A 40/60 °C wash: heating, a drum turning in bursts with short stops, one
 * long soak, a spin, then the display showing "End" at 1.2 W until the
 * machine is switched off.
 */
function wash(offAfterEndSeconds: number, restWatts = 1.2): { curve: Curve; startsAt: number; endsAt: number } {
  const curve: Curve = [
    [0, 0],
    [300, restWatts], // switched on, programme chosen
    [360, 2100], // heating
  ];
  let t = 360 + 15 * 60;
  for (let burst = 0; burst < 20; burst++) {
    curve.push([t, 150], [t + 45, 3]);
    t += 75;
  }
  curve.push([t, 1.5]); // soak: six minutes of next to nothing
  t += 6 * 60;
  for (let burst = 0; burst < 10; burst++) {
    curve.push([t, 180], [t + 45, 3]);
    t += 75;
  }
  curve.push([t, 420]); // spin
  t += 5 * 60;
  curve.push([t, restWatts]);
  const endsAt = t;
  curve.push([t + offAfterEndSeconds, 0]);
  return { curve, startsAt: 360, endsAt };
}

/** Feeds a curve, ticking in between, and collects what happened. */
function play(
  monitor: { reading(at: number, watts: number): void; tick(at: number): void },
  curve: Curve,
  from: number,
  until: number,
): void {
  let at = from;
  for (const [seconds, watts] of curve) {
    const when = from + seconds * S;
    for (at += TICK; at < when; at += TICK) {
      monitor.tick(at);
    }
    monitor.reading(when, watts);
    at = when;
  }
  for (at += TICK; at <= until; at += TICK) {
    monitor.tick(at);
  }
}

function recording(learned?: Learned) {
  const transitions: Transition[] = [];
  const lessons: Learned[] = [];
  const monitor = new DeviceMonitor(
    { learned },
    {
      transition: (transition) => transitions.push(transition),
      learned: (value) => lessons.push(value),
      resumed: () => {},
    },
  );
  const path = () => transitions.map(({ from, to }) => `${from}→${to}`);
  return { monitor, transitions, lessons, path };
}

test('an unlearned monitor sees one whole cycle, however long the pauses in it', () => {
  const { curve, startsAt, endsAt } = wash(45 * 60);
  const { monitor, transitions, path } = recording();
  play(monitor, curve, 0, (endsAt + 60 * 60) * S);

  assert.deepEqual(path(), ['idle→running', 'running→idle']);
  const [started, finished] = transitions;
  assert.equal(started!.startedAt, startsAt * S);
  assert.equal(finished!.at, endsAt * S + LEARNING_DEFAULTS.finishSeconds * S, 'half an hour after the end');
  assert.equal(finished!.cycle!.seconds, endsAt - startsAt);
  assert.ok(finished!.cycle!.wattHours > 500, `a heated wash uses real energy: ${finished!.cycle!.wattHours}`);
});

test('one cycle teaches the resting level and the longest pause', () => {
  const { curve, endsAt } = wash(45 * 60);
  const { monitor, lessons } = recording();
  play(monitor, curve, 0, (endsAt + 60 * 60) * S);

  assert.equal(lessons.length, 1);
  const [learned] = lessons;
  assert.equal(learned!.restWatts, 1.2);
  assert.equal(learned!.params.runWatts, 3.2, 'above resting, above the 3 W between bursts is fine either way');
  assert.equal(learned!.longestPauseSeconds, 390, 'the soak, and the stop before it');
  assert.equal(learned!.params.finishSeconds, 590, 'the soak and half again');
  assert.equal(monitor.params.finishSeconds, 590, 'and the monitor uses it from now on');
});

test('once learned, "finished" comes minutes after the end, not half an hour', () => {
  const first = wash(45 * 60);
  const { monitor, transitions, path } = recording();
  play(monitor, first.curve, 0, (first.endsAt + 60 * 60) * S);
  transitions.length = 0;

  const second = wash(20 * 60);
  const t0 = (first.endsAt + 60 * 60) * S;
  play(monitor, second.curve, t0, t0 + (second.endsAt + 30 * 60) * S);

  assert.deepEqual(path(), ['idle→running', 'running→idle']);
  assert.equal(transitions[1]!.at, t0 + (second.endsAt + 590) * S);
});

test('a machine that drops to nothing by itself finishes, and starts again', () => {
  const { curve, endsAt } = wash(0, 0);
  const learned = learnedFrom(wash(45 * 60));
  const { monitor, path } = recording(learned);
  play(monitor, curve, 0, (endsAt + 3 * 60 * 60) * S);
  assert.deepEqual(path(), ['idle→running', 'running→idle']);

  const again = wash(0, 0);
  const t0 = (endsAt + 3 * 60 * 60) * S;
  play(monitor, again.curve, t0, t0 + (again.endsAt + 20 * 60) * S);
  assert.deepEqual(path(), ['idle→running', 'running→idle', 'idle→running', 'running→idle']);
});

test('a cold wash — bursts of half a minute, no heating — still starts', () => {
  const curve: Curve = [[0, 1.2]];
  for (let burst = 0; burst < 40; burst++) {
    curve.push([60 + burst * 50, 120], [60 + burst * 50 + 25, 2]);
  }
  const { monitor, transitions, path } = recording();
  play(monitor, curve, 0, 40 * MIN);
  assert.deepEqual(path(), ['idle→running']);
  assert.equal(transitions[0]!.startedAt, 60 * S, 'from the first burst');
  assert.equal(transitions[0]!.at, (60 + 2 * 50 + 10) * S, 'once three bursts add up to a minute');
});

test('a short spike is not a start', () => {
  const machine = new CycleMachine(LEARNING_DEFAULTS);
  const seen = [
    ...machine.reading(0, 1),
    ...machine.reading(10 * S, 800), // door lock, pump for a moment
    ...machine.reading(40 * S, 1),
    ...machine.tick(5 * MIN),
  ];
  assert.deepEqual(seen, []);
  assert.equal(machine.state, 'idle');
});

test('a pause longer than learned is taken back when the machine resumes, and learned', () => {
  const tooShort: Learned = { ...learnedFrom(wash(45 * 60)) };
  tooShort.params = { ...tooShort.params, finishSeconds: 180 };
  tooShort.longestPauseSeconds = 60;
  const { curve, endsAt } = wash(45 * 60);
  const resumed: number[] = [];
  const lessons: Learned[] = [];
  const transitions: Transition[] = [];
  const monitor = new DeviceMonitor(
    { learned: tooShort },
    {
      transition: (transition) => transitions.push(transition),
      learned: (value) => lessons.push(value),
      resumed: (seconds) => resumed.push(seconds),
    },
  );
  play(monitor, curve, 0, (endsAt + 60 * 60) * S);

  assert.equal(resumed.length, 1, 'the soak ended a cycle that was not over');
  assert.equal(lessons.length, 1, 'learned once, from the whole cycle');
  assert.equal(lessons[0]!.params.finishSeconds, 590);
});

test('settings from the config win over learned values, and empty ones do not count', () => {
  const monitor = new DeviceMonitor(
    {
      learned: learnedFrom(wash(45 * 60)),
      overrides: { runWatts: 12, finishSeconds: undefined, startSeconds: null as unknown as number },
    },
    { transition: () => {}, learned: () => {}, resumed: () => {} },
  );
  assert.deepEqual(monitor.params, { runWatts: 12, startSeconds: 60, finishSeconds: 590 });
});

test('the off level of earlier versions is ignored, in the config and in what was learned', () => {
  const learned = learnedFrom(wash(45 * 60));
  const monitor = new DeviceMonitor(
    {
      learned: { ...learned, params: { ...learned.params, offWatts: 0.6 } as Learned['params'] },
      overrides: { offWatts: 3 } as Partial<Learned['params']>,
    },
    { transition: () => {}, learned: () => {}, resumed: () => {} },
  );
  assert.deepEqual(monitor.params, { runWatts: 3.2, startSeconds: 60, finishSeconds: 590 });
});

test('states saved by earlier versions: finished and off are both idle', () => {
  assert.equal(cycleState('finished'), 'idle');
  assert.equal(cycleState('off'), 'idle');
  assert.equal(cycleState('running'), 'running');
  assert.equal(cycleState(undefined), 'idle');
});

test('after a restart, a running machine finishes', () => {
  const seen: string[] = [];
  const monitor = new DeviceMonitor(
    {
      learned: learnedFrom(wash(45 * 60)),
      initial: { state: 'running', since: 0 },
    },
    { transition: ({ from, to }) => seen.push(`${from}→${to}`), learned: () => {}, resumed: () => {} },
  );
  monitor.reading(1 * MIN, 0);
  monitor.tick(1 * MIN + 590 * S);
  assert.deepEqual(seen, ['running→idle']);
});

test('nothing is learned from a blip that never really worked', () => {
  const samples = [
    { at: 0, watts: 1 },
    { at: 1 * MIN, watts: 2.5 },
    { at: 3 * MIN, watts: 1 },
  ];
  assert.equal(learnFromCycle(samples, { startedAt: 1 * MIN, endedAt: 3 * MIN }, LEARNING_DEFAULTS), undefined);
});

/** What a monitor learns from one cycle. */
function learnedFrom({ curve, endsAt }: ReturnType<typeof wash>): Learned {
  const { monitor, lessons } = recording();
  play(monitor, curve, 0, (endsAt + 60 * 60) * S);
  return lessons[0]!;
}

/**
 * The owner's coffee machine on the morning of 1 October 2026, as an Eve
 * Energy reported it: one reading a minute. Switched on and heated, kept
 * warm with one short reheat, a coffee, then milk frothed — full heat, and a
 * fan running on at 4.9 W — and switched off a few minutes later.
 */
const COFFEE_MORNING: Curve = [
  [0, 1199.6], [60, 1200.9], [120, 1194.1], [180, 1195], [240, 1192.7], [306, 1191.8], [366, 1191.4],
  [426, 1186.5], [486, 1197.9], [546, 2.8], [606, 1.9], [666, 1.8], [726, 1.9], [906, 2], [966, 1.8],
  [1026, 1.9], [1086, 882.6], [1146, 1.9], [1464, 1.8], [1524, 2], [1584, 1.9], [1890, 188.8],
  [1950, 2], [2022, 2.1], [2082, 1654.9], [2142, 1189.2], [2202, 4.9], [2262, 2.8], [2322, 2.9],
  [2382, 2.8], [2442, 0],
];

test("the owner's coffee machine: one cycle from switching on to the end of the frothing", () => {
  const { monitor, transitions, lessons, path } = recording();
  play(monitor, COFFEE_MORNING, 0, 2442 * S + 60 * MIN);

  assert.deepEqual(path(), ['idle→running', 'running→idle']);
  assert.equal(transitions[1]!.cycle!.seconds, 2202, 'from switching on to the end of the frothing');
  const [learned] = lessons;
  assert.equal(learned!.restWatts, 2.8, 'keeping warm, not the fan running on');
  assert.equal(learned!.params.runWatts, 5.6);
  assert.equal(learned!.longestPauseSeconds, 744, 'from the reheat to the coffee');
});

test('a plug switched off ends a running cycle at once, with no quiet to wait out', () => {
  const { monitor, transitions, path } = recording(learnedFrom(wash(45 * 60)));
  play(monitor, [[0, 0], [60, 2100]], 0, 10 * MIN);
  monitor.switchedOff(10 * MIN);
  assert.deepEqual(path(), ['idle→running', 'running→idle']);
  assert.equal(transitions[1]!.at, 10 * MIN);
  assert.equal(transitions[1]!.cycle!.switchedOff, true);
  monitor.switchedOff(11 * MIN);
  assert.equal(transitions.length, 2, 'switching off an idle plug changes nothing');
});

test('what follows a switch-off says nothing about standby, so the running level is kept', () => {
  const samples = [
    { at: 0, watts: 0 },
    { at: 1 * MIN, watts: 2000 },
    { at: 20 * MIN, watts: 0 },
  ];
  const learned = learnFromCycle(samples, { startedAt: 1 * MIN, endedAt: 20 * MIN }, LEARNING_DEFAULTS, true);
  assert.equal(learned!.params.runWatts, LEARNING_DEFAULTS.runWatts);
});

/** A computer: at work for an hour, then on standby at around 9.5 W. */
const DESK: Curve = [[0, 92], [20 * 60, 88.3], [40 * 60, 95], [60 * 60, 8.8], [61 * 60, 10.3], [62 * 60, 9.4]];

test('before learning, standby above 5 W is found, and the machine finishes on it', () => {
  const standby: [number, number][] = [];
  const transitions: Transition[] = [];
  const monitor = new DeviceMonitor(
    {},
    {
      transition: (transition) => transitions.push(transition),
      learned: () => {},
      resumed: () => {},
      standby: (watts, runWatts) => standby.push([watts, runWatts]),
    },
  );
  play(monitor, DESK, 0, (62 * 60) * S + 60 * MIN);
  assert.deepEqual(standby, [[10.3, 20.6]], 'the highest reading of the ten minutes it was held');
  assert.equal(monitor.standbyWatts, 10.3);
  assert.deepEqual(transitions.map(({ from, to }) => `${from}→${to}`), ['idle→running', 'running→idle']);
  // Found once it has been held for ten minutes; half an hour from then.
  assert.equal(transitions[1]!.at, 70 * MIN + LEARNING_DEFAULTS.finishSeconds * S);
});

test('one level alone is not standby: it may as well be the machine at work', () => {
  const { monitor } = recording();
  play(monitor, [[0, 92], [30 * 60, 95]], 0, 2 * 60 * MIN);
  assert.equal(monitor.standbyWatts, undefined);
  assert.equal(monitor.state, 'running');
});

test('drawing nothing is switched off, not standby', () => {
  const { monitor } = recording();
  play(monitor, [[0, 92], [20 * 60, 0]], 0, 2 * 60 * MIN);
  assert.equal(monitor.standbyWatts, undefined);
});

test('standby found before is used again after a restart', () => {
  const monitor = new DeviceMonitor({ standbyWatts: 10.3 }, { transition: () => {}, learned: () => {}, resumed: () => {} });
  assert.equal(monitor.params.runWatts, 20.6);
});

test('a running level from the config is not second-guessed by standby', () => {
  const { monitor: plain } = recording();
  const monitor = new DeviceMonitor(
    { overrides: { runWatts: 30 } },
    { transition: () => {}, learned: () => {}, resumed: () => {}, standby: () => assert.fail('no standby') },
  );
  play(monitor, DESK, 0, (62 * 60) * S + 20 * MIN);
  play(plain, DESK, 0, (62 * 60) * S + 20 * MIN);
  assert.equal(monitor.params.runWatts, 30);
  assert.equal(plain.params.runWatts, 20.6);
});
