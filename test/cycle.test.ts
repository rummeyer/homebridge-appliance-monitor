/**
 * The state machine and the learning, against made-up but typical cycles.
 *
 * A device reports only when its draw changes, so the curves here are lists
 * of changes, and time between them passes in ticks — as it does in the
 * plugin, where nothing else would notice a machine going quiet.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CycleMachine } from '../src/cycle.ts';
import type { ResetOptions, Transition } from '../src/cycle.ts';
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

function recording(reset: ResetOptions = { mode: 'off-level', minutes: 0 }, learned?: Learned) {
  const transitions: Transition[] = [];
  const lessons: Learned[] = [];
  const monitor = new DeviceMonitor(
    { reset, learned },
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

  assert.deepEqual(path(), ['off→running', 'running→finished', 'finished→off']);
  const [started, finished, off] = transitions;
  assert.equal(started!.startedAt, startsAt * S);
  assert.equal(finished!.at, endsAt * S + LEARNING_DEFAULTS.finishSeconds * S, 'half an hour after the end');
  assert.equal(finished!.cycle!.seconds, endsAt - startsAt);
  assert.ok(finished!.cycle!.wattHours > 500, `a heated wash uses real energy: ${finished!.cycle!.wattHours}`);
  assert.equal(off!.at, (endsAt + 45 * 60) * S + 30 * S, 'off half a minute after being switched off');
});

test('one cycle teaches the resting level, the longest pause and the off level', () => {
  const { curve, endsAt } = wash(45 * 60);
  const { monitor, lessons } = recording();
  play(monitor, curve, 0, (endsAt + 60 * 60) * S);

  assert.equal(lessons.length, 1);
  const [learned] = lessons;
  assert.equal(learned!.restWatts, 1.2);
  assert.equal(learned!.hasStandby, true);
  assert.equal(learned!.params.runWatts, 3.2, 'above resting, above the 3 W between bursts is fine either way');
  assert.equal(learned!.longestPauseSeconds, 390, 'the soak, and the stop before it');
  assert.equal(learned!.params.finishSeconds, 590, 'the soak and half again');
  assert.equal(learned!.params.offWatts, 0.6, 'halfway between resting and switched off');
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

  assert.deepEqual(path(), ['off→running', 'running→finished', 'finished→off']);
  assert.equal(transitions[1]!.at, t0 + (second.endsAt + 590) * S);
  assert.equal(transitions[2]!.at, t0 + (second.endsAt + 20 * 60 + 30) * S, 'off when switched off');
});

test('a machine that drops to nothing by itself stays finished until the next start', () => {
  const { curve, endsAt } = wash(0, 0);
  const learned = learnedFrom(wash(45 * 60));
  const { monitor, path } = recording({ mode: 'off-level', minutes: 0 }, learned);
  play(monitor, curve, 0, (endsAt + 3 * 60 * 60) * S);
  assert.deepEqual(path(), ['off→running', 'running→finished']);

  const again = wash(0, 0);
  const t0 = (endsAt + 3 * 60 * 60) * S;
  play(monitor, again.curve, t0, t0 + (again.endsAt + 20 * 60) * S);
  assert.deepEqual(path(), ['off→running', 'running→finished', 'finished→running', 'running→finished']);
});

test('the timeout reset clears "finished" after the set minutes, whatever the draw', () => {
  const { curve, endsAt } = wash(5 * 60 * 60);
  const { monitor, transitions, path } = recording({ mode: 'timeout', minutes: 20 }, learnedFrom(wash(45 * 60)));
  play(monitor, curve, 0, (endsAt + 2 * 60 * 60) * S);
  assert.deepEqual(path(), ['off→running', 'running→finished', 'finished→off']);
  assert.equal(transitions[2]!.at - transitions[1]!.at, 20 * MIN);
});

test('the next-start reset leaves "finished" alone, even when switched off', () => {
  const { curve, endsAt } = wash(15 * 60);
  const { monitor, path } = recording({ mode: 'next-start', minutes: 0 }, learnedFrom(wash(45 * 60)));
  play(monitor, curve, 0, (endsAt + 2 * 60 * 60) * S);
  assert.deepEqual(path(), ['off→running', 'running→finished']);
});

test('a cold wash — bursts of half a minute, no heating — still starts', () => {
  const curve: Curve = [[0, 1.2]];
  for (let burst = 0; burst < 40; burst++) {
    curve.push([60 + burst * 50, 120], [60 + burst * 50 + 25, 2]);
  }
  const { monitor, transitions, path } = recording();
  play(monitor, curve, 0, 40 * MIN);
  assert.deepEqual(path(), ['off→running']);
  assert.equal(transitions[0]!.startedAt, 60 * S, 'from the first burst');
  assert.equal(transitions[0]!.at, (60 + 2 * 50 + 10) * S, 'once three bursts add up to a minute');
});

test('a short spike is not a start', () => {
  const machine = new CycleMachine(LEARNING_DEFAULTS, { mode: 'off-level', minutes: 0 });
  const seen = [
    ...machine.reading(0, 1),
    ...machine.reading(10 * S, 800), // door lock, pump for a moment
    ...machine.reading(40 * S, 1),
    ...machine.tick(5 * MIN),
  ];
  assert.deepEqual(seen, []);
  assert.equal(machine.state, 'off');
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
    { reset: { mode: 'off-level', minutes: 0 }, learned: tooShort },
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
      reset: { mode: 'off-level', minutes: 0 },
      learned: learnedFrom(wash(45 * 60)),
      overrides: { runWatts: 12, finishSeconds: undefined, offWatts: null as unknown as number },
    },
    { transition: () => {}, learned: () => {}, resumed: () => {} },
  );
  assert.deepEqual(monitor.params, { runWatts: 12, offWatts: 0.6, startSeconds: 60, finishSeconds: 590 });
});

test('after a restart, a finished machine can still be switched off', () => {
  const seen: string[] = [];
  const monitor = new DeviceMonitor(
    {
      reset: { mode: 'off-level', minutes: 0 },
      learned: learnedFrom(wash(45 * 60)),
      initial: { state: 'finished', since: 0 },
    },
    { transition: ({ from, to }) => seen.push(`${from}→${to}`), learned: () => {}, resumed: () => {} },
  );
  assert.equal(monitor.state, 'finished');
  monitor.reading(1 * MIN, 0);
  monitor.tick(2 * MIN);
  assert.deepEqual(seen, ['finished→off']);
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
