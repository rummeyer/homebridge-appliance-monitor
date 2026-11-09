/**
 * The learned model against a made-up coffee machine: a heater at about
 * 1240 W switched by its thermostat, a pump at 56 W for rinses and coffees,
 * a frother at 494 W, each reading the sum, a little noisy, once a second.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { Comparison, fits, initialParams, learnModel, ModelWatcher } from '../src/model.ts';
import type { ModelRun } from '../src/model.ts';
import type { PhaseConfig } from '../src/phases.ts';

const S = 1000;

const PHASES: PhaseConfig[] = [
  { name: 'Heating', minWatts: 1000, minSeconds: 180 },
  { name: 'Coffee', minWatts: 45, maxWatts: 100, minSeconds: 15, byDifference: true },
  { name: 'Rinse', minWatts: 45, maxWatts: 100, minSeconds: 3, maxSeconds: 15, byDifference: true },
  { name: 'Milk', minWatts: 450, maxWatts: 550, minSeconds: 15 },
  { name: 'Standby', minWatts: 1, maxWatts: 5, onDown: true },
];

/** The same noise every run. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31 - 0.5;
  };
}

interface Session {
  samples: Sample[];
  coffee: { from: number; until: number };
  rinse: { from: number; until: number };
}

/**
 * A morning: heating up, a rinse, then a coffee with the heater coming on
 * beside the pump halfway and the frother running through its end.
 */
function morning(start: number, seed: number): Session {
  const random = noise(seed);
  const on = (from: number, until: number) => (t: number) => t >= from && t < until;
  const heater = (t: number) => (t < 200 ? t % 12 < 9 : on(250, 265)(t) || on(330, 345)(t));
  const rinse = on(220, 227);
  const pump = (t: number) => rinse(t) || on(240, 264)(t);
  const milk = on(255, 290);
  const samples: Sample[] = [];
  for (let t = 0; t < 400; t++) {
    let watts = 9;
    if (heater(t)) watts += 1240;
    if (pump(t)) watts += 56;
    if (milk(t)) watts += 494;
    if (heater(t) && (pump(t) || milk(t))) watts -= 20;
    samples.push({ at: start + t * S, watts: Math.round((watts + random() * 4) * 10) / 10 });
  }
  return { samples, rinse: { from: start + 220 * S, until: start + 227 * S }, coffee: { from: start + 240 * S, until: start + 264 * S } };
}

const DAY = 86_400_000;
const mornings = [0, 1, 2, 3, 4, 5].map((day) => morning(day * DAY, day + 1));
const recording = mornings.flatMap(({ samples }) => samples);
const params = learnModel(PHASES, recording);

test('the parts are learned from the readings alone: what each draws', () => {
  assert.equal(params.sessions, 6);
  const [heating, pump, milk] = params.parts;
  assert.equal(heating!.maxWatts, undefined, 'the phase with no upper end is a level');
  assert.ok(Math.abs(params.level - 1240) < 15, `heater about 1240 W, learned ${params.level}`);
  assert.ok(Math.abs(pump!.mean - 56) < 4, `pump about 56 W, learned ${pump!.mean}`);
  assert.ok(Math.abs(milk!.mean - 494) < 6, `frother about 494 W, learned ${milk!.mean}`);
  assert.ok(Math.abs(params.base.mean - 9) < 3, `standby about 9 W, learned ${params.base.mean}`);
  assert.equal(params.parts.length, 3, 'one part per band; the standby only counted coming down is left out');
});

test('learned with the phases as they are, and not once a band has changed', () => {
  assert.ok(fits(params, PHASES));
  assert.ok(!fits(params, PHASES.map((phase) => (phase.name === 'Milk' ? { ...phase, maxWatts: 600 } : phase))));
  assert.ok(fits(initialParams(PHASES, 2000), PHASES));
});

/** Plays a recording into a watcher, ticking every second, as Homebridge does. */
function watch(samples: Sample[], watcher: ModelWatcher): ModelRun[] {
  const runs: ModelRun[] = [];
  for (const [index, sample] of samples.entries()) {
    runs.push(...watcher.reading(sample.at, sample.watts));
    const next = samples[index + 1]?.at ?? sample.at + 400 * S;
    for (let at = sample.at + S; at < next; at += S) {
      runs.push(...watcher.tick(at));
    }
  }
  return runs;
}

test('a coffee with the heater coming on beside the pump and the frother through its end, as it came', () => {
  const day = morning(10 * DAY, 99);
  const runs = watch(day.samples, new ModelWatcher(PHASES, params));
  const coffee = runs.filter(({ phase }) => phase === 'Coffee');
  assert.equal(coffee.length, 1, JSON.stringify(runs));
  assert.ok(Math.abs(coffee[0]!.from - day.coffee.from) <= 2 * S, 'started as it did');
  assert.ok(Math.abs(coffee[0]!.until - day.coffee.until) <= 2 * S, 'and stopped as it did, not with the frother');
  const rinse = runs.filter(({ phase }) => phase === 'Rinse');
  assert.equal(rinse.length, 1);
  assert.ok(Math.abs(rinse[0]!.until - rinse[0]!.from - 7 * S) <= 2 * S, 'a rinse of 7 s');
  const milk = runs.filter(({ phase }) => phase === 'Milk');
  assert.equal(milk.length, 1);
  assert.ok(Math.abs(milk[0]!.until - milk[0]!.from - 35 * S) <= 2 * S, 'milk for 35 s');
});

test('a coffee is told a few seconds after it ends', () => {
  const day = morning(10 * DAY, 7);
  const watcher = new ModelWatcher(PHASES, params);
  let toldAt: number | undefined;
  for (const sample of day.samples) {
    if (watcher.reading(sample.at, sample.watts).some(({ phase }) => phase === 'Coffee')) {
      toldAt ??= sample.at;
    }
  }
  assert.ok(toldAt !== undefined);
  assert.ok(toldAt - day.coffee.until <= 4 * S, `told ${(toldAt - day.coffee.until) / S} s after`);
});

test('the rules and the model side by side, each pair once both have told it', () => {
  const comparison = new Comparison();
  comparison.rule({ phase: 'Coffee', from: 100 * S, until: 123 * S });
  comparison.model({ phase: 'Coffee', from: 101 * S, until: 128 * S });
  comparison.model({ phase: 'Rinse', from: 80 * S, until: 86 * S });
  comparison.rule({ phase: 'Rinse', from: 300 * S, until: 305 * S });
  comparison.rule({ phase: 'Milk', from: 130 * S, until: 160 * S });
  comparison.model({ phase: 'Milk', from: 131 * S, until: 160 * S });
  assert.deepEqual(comparison.settle(150 * S), [], 'too soon for either');
  assert.deepEqual(comparison.settle(300 * S), [
    { phase: 'Rinse', at: 80 * S, rules: undefined, model: 6, agree: false },
    { phase: 'Coffee', at: 100 * S, rules: 23, model: 27, agree: false },
    { phase: 'Milk', at: 130 * S, rules: 30, model: 29, agree: true },
  ]);
  assert.deepEqual(comparison.settle(500 * S), [{ phase: 'Rinse', at: 300 * S, rules: 5, model: undefined, agree: false }]);
});
