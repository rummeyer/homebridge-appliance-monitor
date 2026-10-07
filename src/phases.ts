/**
 * Phases: what an appliance is doing inside a cycle, told apart by power.
 *
 * A coffee machine heats at 1000 W, draws 300 W while a coffee runs through,
 * and keeps warm at 2 W; a washing machine heats at 2000 W and spins at 400.
 * These are bands, not thresholds — drawing a coffee is less than heating —
 * so a phase is a range of power and how long the draw has to be in it.
 *
 * findLevels() suggests the bands, from the levels a recorded curve dwells
 * at; the settings page shows them on the curve to pick from. PhaseTracker
 * follows one configured phase at run time.
 */
import type { Sample } from './learn.ts';

export interface PhaseConfig {
  name: string;
  minWatts: number;
  /** No upper end if left out: "heating is 1000 W and up". */
  maxWatts?: number;
  /** How long the draw has to be in the band, added up, before the phase is on. */
  minSeconds?: number;
  /**
   * How long it has to stay out of the band before the phase is off. A
   * heating element switched by a thermostat goes on and off every few
   * seconds, and the phase should not.
   */
  holdSeconds?: number;
  /** Show it in HomeKit, as a switch that is on while the phase lasts. On by default. */
  sensor?: boolean;
  /**
   * Count it on the Statistics tab, instead of the appliance's finished
   * cycles: a coffee drawn rather than a morning's use of the machine.
   */
  count?: boolean;
  /**
   * Only draws shorter than this, added up in the band, are the phase. A rinse
   * runs the same pump as a coffee, only for less time: a coffee on after ten
   * seconds and a rinse shorter than ten, in the same band, are one or the
   * other and never both.
   *
   * How long a draw was is only known once it is over, so such a phase is on
   * for a moment then, not while it lasts.
   */
  maxSeconds?: number;
  /**
   * Only when the draw falls into the band from above. A washing machine
   * finished rests at 3 W, and so does one just switched on to be loaded:
   * one came down from the wash, the other up from nothing. A draw that
   * rises into the band is not the phase, until it has left the band again.
   *
   * Where the draw came from before a restart is read back from the
   * recording (see recall); if that tells nothing, it counts as from above —
   * a false alarm is better than none.
   */
  fromAbove?: boolean;
}

export const DEFAULT_MIN_SECONDS = 5;
export const DEFAULT_HOLD_SECONDS = 30;

/**
 * How far back the recording is read for where the draw came from. A plug
 * reports changes only, so a machine resting since the morning has its last
 * reading there; before that, it counts as having come from above.
 */
export const RECALL_MS = 12 * 3_600_000;

export interface PhaseChange {
  active: boolean;
  at: number;
  /** When it went on, on the change that turns it off. */
  since?: number;
  /**
   * How long the draw was in the band, on the change that turns it off, or
   * on a short one: the time it took to come on included, the hold not.
   */
  inBandMs?: number;
  /**
   * A phase with maxSeconds that has happened: on now, for a moment, though
   * the draw was from `since` to `until`.
   */
  short?: boolean;
  until?: number;
}

/** One phase, on or off. Time is passed in, as for the state machine. */
export class PhaseTracker {
  readonly #phase: PhaseConfig;
  #active = false;
  #since = 0;
  #watts: number | undefined;
  #accountedAt: number | undefined;
  /** Time spent in the band since the draw first entered it, through to the phase's end. */
  #inMs = 0;
  #outSince: number | undefined;
  /** When the draw first entered the band, for a phase on or in the making. */
  #firstIn: number | undefined;
  /** Where the last reading out of the band was, if any. */
  #side: 'above' | 'below' | undefined;

  constructor(phase: PhaseConfig) {
    this.#phase = phase;
  }

  get name(): string {
    return this.#phase.name;
  }

  get active(): boolean {
    return this.#active;
  }

  /**
   * Readings from before a restart, oldest first, only to know where the draw
   * came from: what they turned on or off was dealt with back then.
   */
  recall(samples: { watts: number }[]): void {
    for (const { watts } of samples) {
      if (!this.#inBand(watts)) {
        this.#side = this.#sideOf(watts);
      }
    }
  }

  reading(at: number, watts: number | undefined): PhaseChange | undefined {
    this.#advance(at);
    if (watts === undefined) {
      return this.#check(at);
    }
    this.#watts = watts;
    if (!this.#inBand(watts)) {
      this.#side = this.#sideOf(watts);
    }
    if (this.#counts(watts)) {
      this.#outSince = undefined;
      this.#firstIn ??= at;
    } else {
      this.#outSince ??= at;
    }
    return this.#check(at);
  }

  tick(at: number): PhaseChange | undefined {
    this.#advance(at);
    return this.#check(at);
  }

  #inBand(watts: number): boolean {
    return watts >= this.#phase.minWatts && watts < (this.#phase.maxWatts ?? Infinity);
  }

  #sideOf(watts: number): 'above' | 'below' {
    return watts < this.#phase.minWatts ? 'below' : 'above';
  }

  /**
   * In the band, and as far as the phase goes: for one only from above, not
   * having risen into it. The side does not change while the draw stays in
   * the band, so neither does this.
   */
  #counts(watts: number): boolean {
    return this.#inBand(watts) && !(this.#phase.fromAbove && this.#side === 'below');
  }

  #advance(at: number): void {
    if (this.#watts !== undefined && this.#counts(this.#watts) && this.#accountedAt !== undefined) {
      this.#inMs += Math.max(0, at - this.#accountedAt);
    }
    this.#accountedAt = at;
  }

  #check(at: number): PhaseChange | undefined {
    const minMs = (this.#phase.minSeconds ?? DEFAULT_MIN_SECONDS) * 1000;
    const holdMs = (this.#phase.holdSeconds ?? DEFAULT_HOLD_SECONDS) * 1000;
    const outLong = this.#outSince !== undefined && at - this.#outSince >= holdMs;

    if (!this.#active) {
      if (outLong) {
        // The draw is over. For a short phase, that is when it is known;
        // otherwise a start in the making is forgotten.
        const short = this.#short(at, minMs);
        this.#inMs = 0;
        this.#firstIn = undefined;
        return short;
      }
      if (this.#phase.maxSeconds === undefined && this.#inMs >= minMs) {
        this.#active = true;
        this.#since = at;
        return { active: true, at };
      }
      return undefined;
    }
    if (outLong) {
      this.#active = false;
      const inBandMs = this.#inMs;
      this.#inMs = 0;
      this.#firstIn = undefined;
      return { active: false, at, since: this.#since, inBandMs };
    }
    return undefined;
  }

  #short(at: number, minMs: number): PhaseChange | undefined {
    const { maxSeconds } = this.#phase;
    if (maxSeconds === undefined || this.#firstIn === undefined) {
      return undefined;
    }
    if (this.#inMs < minMs || this.#inMs >= maxSeconds * 1000) {
      return undefined;
    }
    return { active: true, at, short: true, since: this.#firstIn, until: this.#outSince, inBandMs: this.#inMs };
  }
}

export interface Level {
  /** Where the draw mostly sat, in W. */
  watts: number;
  /** A band around it for a phase, not reaching into the next level's. */
  minWatts: number;
  maxWatts: number;
  /** How long the curve spent there. */
  seconds: number;
}

/** Below this the appliance is off, not at a level. */
const OFF_WATTS = 0.5;
/** Bins a tenth of a decade wide: 1.0, 1.26, 1.58, … W. */
const BINS_PER_DECADE = 10;
/** A level has to hold the draw this long in all; less is a transition passing through. */
const MIN_LEVEL_SECONDS = 15;

/**
 * The levels a curve dwells at, lowest first.
 *
 * Time at each power is gathered into bins on a log scale — a 2 W level and a
 * 2000 W one are both levels — and neighbouring bins that held the draw for
 * a while form one level. Short readings on the way between levels are too
 * brief to fill a bin and are left out.
 */
export function findLevels(samples: Sample[], until: number): Level[] {
  const bins = new Map<number, { ms: number; weighted: { watts: number; ms: number }[] }>();
  for (const [index, sample] of samples.entries()) {
    const end = samples[index + 1]?.at ?? until;
    const ms = end - sample.at;
    if (ms <= 0 || sample.watts < OFF_WATTS) {
      continue;
    }
    const bin = Math.floor(Math.log10(sample.watts) * BINS_PER_DECADE);
    const entry = bins.get(bin) ?? { ms: 0, weighted: [] };
    entry.ms += ms;
    entry.weighted.push({ watts: sample.watts, ms });
    bins.set(bin, entry);
  }

  const occupied = [...bins.entries()].filter(([, { ms }]) => ms >= 5000).sort(([a], [b]) => a - b);
  const groups: { first: number; last: number; weighted: { watts: number; ms: number }[] }[] = [];
  for (const [bin, { weighted }] of occupied) {
    const group = groups.at(-1);
    if (group && bin === group.last + 1) {
      group.last = bin;
      group.weighted.push(...weighted);
    } else {
      groups.push({ first: bin, last: bin, weighted: [...weighted] });
    }
  }

  const levels = groups
    .map(({ first, last, weighted }) => ({
      watts: weightedMedian(weighted),
      low: 10 ** (first / BINS_PER_DECADE),
      high: 10 ** ((last + 1) / BINS_PER_DECADE),
      seconds: Math.round(weighted.reduce((sum, { ms }) => sum + ms, 0) / 1000),
    }))
    .filter(({ seconds }) => seconds >= MIN_LEVEL_SECONDS);

  // Each band reaches a quarter of the way further in both directions, but
  // not past the geometric middle between it and its neighbour.
  return levels.map((level, index) => {
    const below = levels[index - 1];
    const above = levels[index + 1];
    let minWatts = level.low / 1.25;
    let maxWatts = level.high * 1.25;
    if (below) {
      minWatts = Math.max(minWatts, Math.sqrt(below.high * level.low));
    }
    if (above) {
      maxWatts = Math.min(maxWatts, Math.sqrt(level.high * above.low));
    }
    return {
      watts: nice(level.watts),
      minWatts: nice(Math.max(minWatts, OFF_WATTS)),
      maxWatts: nice(maxWatts),
      seconds: level.seconds,
    };
  });
}

function weightedMedian(values: { watts: number; ms: number }[]): number {
  const sorted = [...values].sort((a, b) => a.watts - b.watts);
  const half = sorted.reduce((sum, { ms }) => sum + ms, 0) / 2;
  let seen = 0;
  for (const { watts, ms } of sorted) {
    seen += ms;
    if (seen >= half) {
      return watts;
    }
  }
  return sorted.at(-1)?.watts ?? 0;
}

/** Two significant figures: 2.3 W, 310 W, 1300 W. */
function nice(watts: number): number {
  return watts <= 0 ? 0 : Number(watts.toPrecision(2));
}
