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

/** A level is current while its last reading is this recent: a plug may report changes only. */
export const SETTLED_GAP_MS = 2500;

/**
 * How long after a run's end the sums still correct it: the level beneath shows within seconds.
 * Later, the levels at the far end of the draw kept are cut off, and what they were on top of.
 */
export const SUMS_CORRECT_MS = 20_000;

/** The shortest run the rules never saw that the sums tell: a rinse is 7 s, the pump's pre-runs less. */
export const SUMS_MISSED_MIN_MS = 5000;

/** The longest run the sums tell: a long coffee. Longer is the heater drifting, not the pump. */
export const SUMS_MAX_MS = 120_000;

/** What the sums tell of a phase, for its start and end messages. */
export type SumsEvent =
  /** On by sums as the rules do not see it yet: on top of the level beneath, `seconds` ago. */
  | { kind: 'start'; phase: string; seconds: number }
  /**
   * Over: a run started by sums, or one the rules never saw (`missed`, its start told with it),
   * or one whose length the sums see otherwise than told (`was`).
   */
  | { kind: 'end'; phase: string; seconds: number; was?: number; missed?: boolean };

/** A run the sums told, from its start; `ended` once its end was told, `rules` once the rules took it. */
interface Told {
  from: number;
  until?: number;
  seconds?: number;
  rules?: boolean;
}

interface SumsPhase {
  name: string;
  minWatts: number;
  maxWatts: number;
  step?: number;
  /** The rules' run on now, from when. */
  rulesFrom?: number;
  /** The rules' runs lately, to tell the ones they never saw. */
  rulesRuns: { from: number; until: number }[];
  /** Runs the rules ended, to be looked at again once the levels around them are known. */
  pending: { from: number; until: number; due: number }[];
  told: Told[];
}

/**
 * One appliance's draw of the last minutes, and its phases by difference that send messages,
 * told by sums beside the rules: a run started live once the level it makes is held, should the
 * rules not have it — the pump coming on beside the heater, the milk, both, which the rules see
 * only as it stops, if at all; a run the rules never saw told once it is over; and a run whose
 * length the sums see otherwise corrected, once the levels around it are known.
 */
export class HindsightSums {
  readonly #recent: Sample[] = [];
  readonly #phases = new Map<string, SumsPhase>();

  constructor(phases: { name: string; minWatts: number; maxWatts?: number }[]) {
    for (const { name, minWatts, maxWatts } of phases) {
      this.#phases.set(name, { name, minWatts, maxWatts: maxWatts ?? Infinity, rulesRuns: [], pending: [], told: [] });
    }
  }

  reading(at: number, watts: number): void {
    this.#recent.push({ at, watts });
    while (this.#recent.length > 0 && at - this.#recent[0]!.at > SUMS_WINDOW_MS) {
      this.#recent.shift();
    }
  }

  /** The rules have the phase on, the draw having entered the band at `from`. */
  rulesStarted(name: string, from: number): void {
    const phase = this.#phases.get(name);
    if (!phase) {
      return;
    }
    phase.rulesFrom = from;
    // A run the sums started already is the rules' from now on: they end it.
    const live = phase.told.find((run) => run.until === undefined && !run.rules);
    if (live) {
      live.rules = true;
    }
  }

  /**
   * The rules have the phase off: from entering the band to leaving it. `counted` false for a
   * run known too short once it ended, not the phase after all: not looked at again.
   */
  rulesEnded(name: string, from: number, until: number, at: number, counted = true): void {
    const phase = this.#phases.get(name);
    if (!phase) {
      return;
    }
    phase.rulesFrom = undefined;
    phase.rulesRuns.push({ from, until });
    if (counted) {
      phase.pending.push({ from, until, due: at + SUMS_DELAY_MS });
    }
    // A run the sums started is the rules' once they end it, though they had it on only now.
    for (const run of phase.told) {
      if (run.until === undefined) {
        run.rules = true;
        run.until = until;
        run.seconds = Math.round((until - run.from) / 1000);
      }
    }
  }

  /** Whether the sums started a run of the phase still on: the rules' start is not told again. */
  holdsStart(name: string): boolean {
    return this.#phases.get(name)?.told.some((run) => run.until === undefined) ?? false;
  }

  /** What the sums tell by now. */
  due(now: number): SumsEvent[] {
    const levels = heldLevels(this.#recent);
    const out: SumsEvent[] = [];
    for (const phase of this.#phases.values()) {
      const own = ownStep(levels, phase.minWatts, phase.maxWatts);
      if (own !== undefined && own >= phase.minWatts) {
        phase.step = own;
      }
      this.#forget(phase, now);
      if (phase.step === undefined) {
        continue;
      }
      const runs = runsBySums(this.#recent, phase.step);
      out.push(...this.#live(phase, levels, runs, now), ...this.#over(phase, runs, now), ...this.#corrected(phase, runs, now));
    }
    return out;
  }

  /**
   * A run on now by sums, the rules not having it: its level held for a second reading, on top
   * of the one beneath. Not where it would be one told already.
   */
  #live(phase: SumsPhase, levels: Held[], runs: { from: number; until: number }[], now: number): SumsEvent[] {
    const last = levels.at(-1);
    const run = runs.at(-1);
    if (phase.rulesFrom !== undefined || !last || !run || last.count < 2 || run.until !== last.to || now - last.to > SETTLED_GAP_MS ||
      phase.told.some((told) => told.until === undefined || told.until > run.from - 3000)) {
      return [];
    }
    phase.told.push({ from: run.from });
    return [{ kind: 'start', phase: phase.name, seconds: Math.round((now - run.from) / 1000) }];
  }

  /**
   * Runs over by sums, the level beneath held SUMS_DELAY_MS since: the end of one started by
   * sums, and one the rules never saw, of a rinse's length at least, its start told with it.
   */
  #over(phase: SumsPhase, runs: { from: number; until: number }[], now: number): SumsEvent[] {
    const out: SumsEvent[] = [];
    const near = (a: { from: number; until?: number }, b: { from: number; until: number }) =>
      (a.until ?? now) > b.from - 3000 && a.from < b.until + 3000;
    for (const run of runs) {
      const ms = run.until - run.from;
      if (run.until > now - SUMS_DELAY_MS || ms > SUMS_MAX_MS) {
        continue;
      }
      const seconds = Math.round(ms / 1000);
      const told = phase.told.find((t) => near(t, run));
      if (told) {
        if (told.until === undefined && !told.rules) {
          told.until = run.until;
          told.seconds = seconds;
          out.push({ kind: 'end', phase: phase.name, seconds });
        } else if (!told.rules && told.seconds !== undefined && Math.abs(seconds - told.seconds) >= 2 &&
          run.from <= told.from + 3000 && run.until >= told.until! && now - told.until! <= SUMS_CORRECT_MS) {
          // The same run, once more of it is known as the level beneath it shows.
          out.push({ kind: 'end', phase: phase.name, seconds, was: told.seconds });
          told.until = run.until;
          told.seconds = seconds;
        }
        continue;
      }
      const rules = phase.rulesRuns.some((r) => near(r, run)) || (phase.rulesFrom !== undefined && phase.rulesFrom < run.until + 3000);
      // Only lately over: at the far end of the draw kept, a run is cut off, and told already.
      if (rules || ms < SUMS_MISSED_MIN_MS || now - run.until > SUMS_CORRECT_MS) {
        continue;
      }
      phase.told.push({ from: run.from, until: run.until, seconds });
      out.push({ kind: 'end', phase: phase.name, seconds, missed: true });
    }
    // Started by sums and not seen on since, the level beneath gone too: over, as long as it held.
    for (const told of phase.told) {
      if (told.until === undefined && !told.rules && !runs.some((run) => near(told, run)) && now - told.from > SUMS_DELAY_MS) {
        told.until = now;
        told.seconds = 0;
        out.push({ kind: 'end', phase: phase.name, seconds: 0 });
      }
    }
    return out;
  }

  /** The rules' runs due to be looked at by now, those the sums see otherwise. */
  #corrected(phase: SumsPhase, runs: { from: number; until: number }[], now: number): SumsEvent[] {
    const due = phase.pending.filter((run) => now >= run.due);
    if (due.length === 0) {
      return [];
    }
    phase.pending = phase.pending.filter((run) => now < run.due);
    const out: SumsEvent[] = [];
    for (const run of due) {
      // The longest the sums see over it, a moment either way.
      const seen = runs
        .filter(({ from, until }) => until > run.from - 3000 && from < run.until + 3000 && until - from <= SUMS_MAX_MS)
        .map(({ from, until }) => Math.round((until - from) / 1000));
      if (seen.length === 0) {
        continue;
      }
      const seconds = Math.max(...seen);
      const was = Math.round((run.until - run.from) / 1000);
      if (Math.abs(seconds - was) >= 2) {
        out.push({ kind: 'end', phase: phase.name, seconds, was });
      }
    }
    return out;
  }

  /** What is older than the draw kept is forgotten. */
  #forget(phase: SumsPhase, now: number): void {
    const old = (until: number | undefined) => until !== undefined && now - until > 2 * SUMS_WINDOW_MS;
    phase.rulesRuns = phase.rulesRuns.filter(({ until }) => !old(until));
    phase.told = phase.told.filter(({ until }) => !old(until));
  }
}
