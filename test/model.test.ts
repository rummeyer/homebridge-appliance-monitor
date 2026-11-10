/**
 * The learned model against a made-up coffee machine: a heater at about
 * 1240 W switched by its thermostat, a pump at 56 W for rinses and coffees,
 * a frother at 494 W, each reading the sum, a little noisy, once a second.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { aboutTheSame, Comparison, fits, initialParams, learnModel, ModelWatcher } from '../src/model.ts';
import type { ModelRun } from '../src/model.ts';
import type { PhaseConfig } from '../src/phases.ts';
import { ModelShadow } from '../src/shadow.ts';

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
  assert.ok(params.busy! > 1000 && params.addsUp! > 0.95, `its accounts add up: ${params.addsUp} of ${params.busy}`);
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
  const told = (compared: ReturnType<Comparison['settle']>) => compared.map(({ runs: _runs, ...rest }) => rest);
  const settled = comparison.settle(300 * S);
  assert.deepEqual(told(settled), [
    { phase: 'Rinse', at: 80 * S, rules: undefined, model: 6, agree: false },
    { phase: 'Coffee', at: 100 * S, rules: 23, model: 27, agree: false },
    { phase: 'Milk', at: 130 * S, rules: 30, model: 29, agree: true },
  ]);
  assert.deepEqual(settled[1]!.runs, { rules: { phase: 'Coffee', from: 100 * S, until: 123 * S }, model: { phase: 'Coffee', from: 101 * S, until: 128 * S } });
  assert.deepEqual(told(comparison.settle(500 * S)), [{ phase: 'Rinse', at: 300 * S, rules: 5, model: undefined, agree: false }]);
});

/** A watcher that has seen some mornings, with the model as ready as asked. */
function seen(ready: Partial<typeof params>, days = 4): { watcher: ModelWatcher; day: Session } {
  const watcher = new ModelWatcher(PHASES, { ...params, ...ready });
  let day = morning(20 * DAY, 30);
  for (let index = 0; index < days; index++) {
    day = morning((20 + index) * DAY, 30 + index);
    watch(day.samples, watcher);
  }
  return { watcher, day };
}

test('it would correct the rules where its account adds up and theirs does not: a coffee lost under the heater', () => {
  const { watcher, day } = seen({ sessions: 12, steady: 1 });
  const lost = { phase: 'Coffee', from: day.coffee.from, until: day.coffee.from + 12 * S };
  const verdict = watcher.judge('Coffee', lost, { phase: 'Coffee', from: day.coffee.from, until: day.coffee.until });
  assert.ok(verdict.corrects, verdict.reason);
  assert.match(verdict.reason, /^the rules' account off by (5\d|6\d) W over 1\d readings, the model's by \d W$/);
  const longer = watcher.judge('Coffee', { ...lost, until: day.coffee.until + 10 * S }, { phase: 'Coffee', from: day.coffee.from, until: day.coffee.until });
  assert.ok(longer.corrects, 'and a coffee the rules had go on too long');
});

test('it would leave the rules be where they saw the draw in its band and only let it pass, or rested between switchings on', () => {
  const { watcher, day } = seen({ sessions: 12, steady: 1 });
  // The heater, on for 9 s of every 12 while heating up: the rules' heating, its rests and all.
  const heating = { phase: 'Heating', from: day.samples[0]!.at, until: day.samples[0]!.at + 200 * S };
  assert.equal(watcher.judge('Heating', heating, { ...heating, until: heating.until - 3 * S }).corrects, false);
  // Rules without a heating there: they saw it in its band, too short for them.
  assert.equal(watcher.judge('Heating', undefined, { phase: 'Heating', from: day.samples[0]!.at + 250 * S, until: day.samples[0]!.at + 265 * S }).corrects, false);
});

test('the rules and the model side by side: a long phase the rules tell only once over, and runs overlapping that started apart', () => {
  const comparison = new Comparison();
  comparison.opened('Heating', 0);
  comparison.model({ phase: 'Heating', from: 0, until: 500 * S });
  assert.deepEqual(comparison.settle(700 * S), [], 'the rules still have it on');
  comparison.rule({ phase: 'Heating', from: 0, until: 1200 * S });
  comparison.rule({ phase: 'Coffee', from: 1309 * S, until: 1327 * S });
  comparison.model({ phase: 'Coffee', from: 1300 * S, until: 1325 * S });
  assert.deepEqual(comparison.settle(2000 * S).map(({ phase, rules, model }) => [phase, rules, model]), [['Heating', 1200, 500], ['Coffee', 18, 25]]);
});

test('it would leave the rules be while it is not ready', () => {
  const run = { phase: 'Coffee', from: 0, until: 10 * S };
  assert.deepEqual(seen({ sessions: 6 }, 1).watcher.judge('Coffee', run, undefined),
    { corrects: false, reason: 'learned from 6 sessions only, needs 10' });
  assert.deepEqual(seen({ sessions: 12, steady: 0 }, 1).watcher.judge('Coffee', run, undefined),
    { corrects: false, reason: 'not yet learned about the same twice running' });
  assert.deepEqual(seen({ sessions: 12, steady: 1, busy: 300 }, 1).watcher.judge('Coffee', run, undefined),
    { corrects: false, reason: 'learned from 300 readings with something on only, needs 600' });
  assert.deepEqual(seen({ sessions: 12, steady: 1, addsUp: 0.85 }, 1).watcher.judge('Coffee', run, undefined),
    { corrects: false, reason: 'its accounts add up for 85 % of the readings only, needs 90 %' });
});

test('learned about the same as before, or not', () => {
  assert.ok(aboutTheSame(params, learnModel(PHASES, recording.slice(400))));
  const milk = params.parts[2]!;
  assert.ok(!aboutTheSame(params, { ...params, parts: params.parts.map((part) => (part === milk ? { ...part, mean: part.mean + 30 } : part)) }));
  assert.ok(!aboutTheSame(params, { ...params, level: params.level + 80 }));
});

test('where the model would correct the rules, its length goes out after theirs, once', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'model-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'model'));
  writeFileSync(join(dir, 'model', 'Coffee%20machine.json'), JSON.stringify({ ...params, sessions: 12, steady: 1 }));
  const quiet = { info: () => {}, debug: () => {}, warn: () => {} };
  const corrected: [string, number, number][] = [];
  const shadow = new ModelShadow('Coffee machine', PHASES, dir, dir, 14, quiet, 0, (phase, seconds, rules) => corrected.push([phase, seconds, rules]));
  for (let index = 0; index < 4; index++) {
    const day = morning((20 + index) * DAY, 30 + index);
    for (const sample of day.samples) {
      shadow.reading(sample.at, sample.watts);
      shadow.tick(sample.at);
      if (sample.at === day.coffee.until + 2 * S) {
        // The rules lost the coffee's last 9 s under the heater and the frother, or not.
        const until = day.coffee.until - (index === 3 ? 9 * S : 0);
        shadow.rule('Coffee', { active: false, at: sample.at, since: day.coffee.from, from: day.coffee.from, until });
      }
    }
    for (let at = day.samples[day.samples.length - 1]!.at; at < day.samples[0]!.at + 1000 * S; at += S) {
      shadow.tick(at);
    }
  }
  shadow.stop();
  assert.equal(corrected.length, 1, JSON.stringify(corrected));
  const [phase, seconds, rules] = corrected[0]!;
  assert.equal(phase, 'Coffee');
  assert.equal(rules, 15);
  assert.ok(Math.abs(seconds - 24) <= 2, `the coffee's 24 s, corrected to ${seconds}`);
});
