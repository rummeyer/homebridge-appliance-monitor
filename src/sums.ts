/**
 * A phase by sums, in hindsight: what the draw held, level by level, is either something on its
 * own or that and the phase on top of it. A coffee machine's pump draws 52 W; the milk frothing
 * with the pump beside it reads 555 W, the milk alone 502, the heater and the milk with the pump
 * 1757, without it 1704. Each level a step of the pump's size above another one held shortly
 * before or after had the pump in it, whatever else ran and whatever else switched at the same
 * moment. Nothing is known of what the other levels are: only that the phase adds its own step.
 *
 * The level beneath is often only seen after the phase has stopped — the milk on its own once the
 * coffee is through — so this tells the phase's length after it, as a correction of what the rules
 * said live (25.11.2026: a coffee of 23 s beside the milk and the heater, 4 s to the rules).
 * Played over the coffee machine's runs of 11.–25.11.2026, against a coffee of 20–23 s and a rinse
 * of 7–10 s: 52 of 58 shots as they were, against 42 of 52 by the rules alone.
 */
import type { Sample } from './learn.ts';

/** Readings this close are the draw holding at a level; the pump coming or going is 50 W. */
export const SUMS_STEADY_WATTS = 15;

/** How far apart in time a level and the one beneath it may be held: the heater drifts over minutes. */
export const SUMS_NEAR_MS = 90_000;

/** How much of the step either way still counts as it: a plug's readings wander by a few watts. */
export const SUMS_STEP_SHARE = 0.3;

/** A level held: from its first reading to its last, at their mean. */
export interface Held {
  from: number;
  to: number;
  watts: number;
  count: number;
}

/**
 * The levels the draw held, in order. A single reading between the two levels around it, a
 * second or less before the next, is a moment on the way between them, not a level.
 */
export function heldLevels(samples: Sample[]): Held[] {
  const levels: Held[] = [];
  for (const { at, watts } of samples) {
    const level = levels.at(-1);
    if (level && Math.abs(watts - level.watts) <= SUMS_STEADY_WATTS) {
      level.watts = (level.watts * level.count + watts) / (level.count + 1);
      level.count++;
      level.to = at;
    } else {
      levels.push({ from: at, to: at, watts, count: 1 });
    }
  }
  return levels.filter((level, index) => {
    const before = levels[index - 1];
    const after = levels[index + 1];
    return !(level.count === 1 && before && after &&
      (level.watts - before.watts) * (after.watts - level.watts) > 0 && after.from - level.from <= 1500);
  });
}

/**
 * The phase's own step, as the draw shows it: rising from below its band into it, from rest, as
 * the middle of those seen. Without one, the steps between two levels held, up or down, of the
 * band's size — the pump coming on or going off beside anything else; these may be something
 * else changing too, so only then. None if there were neither.
 */
export function ownStep(levels: Held[], minWatts: number, maxWatts: number): number | undefined {
  const fromRest: number[] = [];
  const beside: number[] = [];
  for (let index = 1; index < levels.length; index++) {
    const before = levels[index - 1]!;
    const level = levels[index]!;
    if (level.count < 2) {
      continue;
    }
    const step = Math.abs(level.watts - before.watts);
    if (before.watts < minWatts && level.watts >= minWatts && level.watts < maxWatts) {
      fromRest.push(level.watts - before.watts);
    } else if (before.count > 1 && step >= minWatts && step < maxWatts) {
      beside.push(step);
    }
  }
  const steps = (fromRest.length > 0 ? fromRest : beside).sort((a, b) => a - b);
  return steps.length > 0 ? steps[Math.floor(steps.length / 2)] : undefined;
}

/**
 * When the phase ran, by sums: from the first level with it on top to the first after without.
 * The levels are taken from the lowest up: one is the phase on top of a lower level held near
 * it in time that is not, or else on its own. Beneath, only a level of more than one reading: a
 * single one may be the heater on its way down, the last reading so far (17.11.2026: 1654 W as
 * the heater went off, the 1693 before it taken for the pump on top). Runs a moment apart are one.
 */
export function runsBySums(samples: Sample[], step: number): { from: number; until: number }[] {
  const levels = heldLevels(samples);
  const tolerance = Math.max(SUMS_STEADY_WATTS, step * SUMS_STEP_SHARE);
  const on = new Map<Held, boolean>();
  for (const level of [...levels].sort((a, b) => a.watts - b.watts)) {
    on.set(level, levels.some((other) => on.get(other) === false && other.count > 1 &&
      Math.abs(level.watts - other.watts - step) <= tolerance &&
      Math.min(Math.abs(other.from - level.to), Math.abs(level.from - other.to)) <= SUMS_NEAR_MS));
  }
  const runs: { from: number; until: number }[] = [];
  for (const [index, level] of levels.entries()) {
    if (!on.get(level)) {
      continue;
    }
    const until = levels[index + 1]?.from ?? level.to;
    const run = runs.at(-1);
    if (run && level.from - run.until <= 2500) {
      run.until = until;
    } else {
      runs.push({ from: level.from, until });
    }
  }
  return runs;
}

/** How much of the draw is kept to look back over: a coffee and the levels around it. */
export const SUMS_WINDOW_MS = 4 * 60_000;

/**
 * How long after a run ends, by the rules, the sums look at it: the level beneath is often
 * held only once the pump has stopped — the milk alone a few seconds after the coffee. Soon
 * enough for a display still showing the run's length.
 */
export const SUMS_DELAY_MS = 5000;

/** A run whose length the sums see otherwise than the rules told it. */
export interface SumsCorrection {
  phase: string;
  seconds: number;
  was: number;
}

/**
 * One appliance's draw of the last minutes, and the runs of its phases by difference that the
 * rules ended lately, to be looked at again by sums once the levels around them are known.
 */
export class HindsightSums {
  readonly #recent: Sample[] = [];
  #pending: { phase: string; minWatts: number; maxWatts: number; from: number; until: number; due: number }[] = [];
  /** Each phase's step, as last seen: a window without the phase rising from rest has none. */
  readonly #steps = new Map<string, number>();

  reading(at: number, watts: number): void {
    this.#recent.push({ at, watts });
    while (this.#recent.length > 0 && at - this.#recent[0]!.at > SUMS_WINDOW_MS) {
      this.#recent.shift();
    }
  }

  /** A run the rules ended: from entering the band to leaving it. */
  ended(phase: { name: string; minWatts: number; maxWatts?: number }, from: number, until: number, at: number): void {
    this.#pending.push({ phase: phase.name, minWatts: phase.minWatts, maxWatts: phase.maxWatts ?? Infinity, from, until, due: at + SUMS_DELAY_MS });
  }

  /** The runs due to be looked at by now, those the sums see otherwise. */
  due(now: number): SumsCorrection[] {
    const due = this.#pending.filter((run) => now >= run.due);
    if (due.length === 0) {
      return [];
    }
    this.#pending = this.#pending.filter((run) => now < run.due);
    const levels = heldLevels(this.#recent);
    const out: SumsCorrection[] = [];
    for (const run of due) {
      const step = ownStep(levels, run.minWatts, run.maxWatts) ?? this.#steps.get(run.phase);
      if (step === undefined) {
        continue;
      }
      this.#steps.set(run.phase, step);
      // The longest the sums see over it, a moment either way.
      const seen = runsBySums(this.#recent, step)
        .filter(({ from, until }) => until > run.from - 3000 && from < run.until + 3000)
        .map(({ from, until }) => Math.round((until - from) / 1000));
      if (seen.length === 0) {
        continue;
      }
      const seconds = Math.max(...seen);
      const was = Math.round((run.until - run.from) / 1000);
      if (Math.abs(seconds - was) >= 2) {
        out.push({ phase: run.phase, seconds, was });
      }
    }
    return out;
  }
}
