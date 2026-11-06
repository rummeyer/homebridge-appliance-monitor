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
import { OFF_WATTS } from './power.ts';

export interface PhaseConfig {
  name: string;
  minWatts: number;
  /** No upper end if left out: "heating is 1000 W and up". */
  maxWatts?: number;
  /**
   * How long the draw has to be in the band, added up, before the phase is
   * on. With byDifference, time above the band counts too, from the draw entering
   * it until it falls below: see byDifference.
   */
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
   * Only draws shorter than this are the phase: from entering the band to
   * falling below it, a moment above it included — a coffee machine's heater
   * beside the pump. A rinse runs the same pump as a coffee, only for less
   * time: a coffee on after ten seconds and a rinse shorter than ten, in the
   * same band, are one or the other and never both.
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
  onDown?: boolean;
  /**
   * Off once the draw has been below the band for FORGET_BELOW_MS, the hold
   * then only for time above it. A coffee machine's pump with the heater
   * beside it reads above its band and may still be running; at the few
   * watts of keeping warm it has stopped — and a rinse a few seconds before
   * the coffee is not the coffee. Not for heating, whose thermostat drops
   * below the band while it lasts.
   *
   * For the same reason the time above the band counts towards minSeconds,
   * once the draw has been in the band for a moment and until it falls below:
   * the pump is running under the heater. Above the band, the draw is told by
   * its steps from one level to the next: a step up by as much as the band
   * is the pump starting beside the steam or the heater, a step down by
   * about as much the pump stopping beneath them (see STEADY_WATTS), and so
   * is settling back at what the heater lately drew alone (see ALONE_MS). On
   * after then measures the draw as Shorter than does — a coffee on after
   * fifteen seconds and a rinse shorter than fifteen in the same band are
   * one or the other, never both nor neither, whether the heater came on
   * beside the pump or not.
   */
  byDifference?: boolean;
}

export const DEFAULT_MIN_SECONDS = 5;
export const DEFAULT_HOLD_SECONDS = 30;

/**
 * Below the band this long, a phase not on yet is not in the making any more:
 * the next draw into the band starts afresh. A plug that reads every second
 * shows a coffee machine flushed a few seconds before the coffee, or a
 * moment's reading in the band as a heater switches off, apart from the pump
 * run after them. The hold is for a phase that is on.
 */
export const FORGET_BELOW_MS = 3000;

/**
 * With byDifference, how long the draw has to have been in the band itself before
 * time above it counts too: the pump running on its own for a moment, as it
 * does before the heater comes on beside it. A heater warming up passes
 * through the band in a single reading on its way up, and its burst above is
 * not the pump (28.10.2026: three of them started the shot timer).
 */
export const IN_BAND_BEFORE_ABOVE_MS = 2000;

/**
 * With byDifference, in the band alone at least this long, a draw then seen
 * stopping beneath something above the band — a step down by the band's
 * size — was the pump all along: its time above counts after all, though
 * short of IN_BAND_BEFORE_ABOVE_MS (30.10.2026: a rinse of 5 s, 2 s of it
 * alone and 3 s beneath the heater, was not seen). One reading on the
 * heater's way up is in the band for a second at most.
 */
export const IN_BAND_SEEN_MS = 1500;

/**
 * With byDifference, above the band: a step down from one level to the next
 * by this share of the band's lower end, and no more than its upper end, is
 * what was in the band stopping beneath what is above — the pump under the
 * heater, its 55 W gone from 1300. It counts as falling below the band then.
 * The heater alone drifts by a few watts at most while it runs (28.10.2026:
 * a rinse of 12 s with the heater on 8 s longer was taken for a 20 s
 * coffee). A step by much more is something else stopping: the steam
 * closed while the pump runs on.
 */
export const STOPPED_BENEATH_SHARE = 0.75;

/**
 * With byDifference, two readings this close are the draw holding at a
 * level, rather than a moment on the way between two: a plug averaging over
 * a second reads half the heater as it comes on. The heater drifts by a few
 * watts a second as it warms; the pump coming or going is 55 W.
 *
 * A step up between levels by as much as the band is the pump starting
 * beside what was drawn already, the steam say — a coffee drawn while the
 * milk froths. A step down by about as much, with nothing known to have
 * started, is the pump stopping having started unseen, at the same moment
 * as something else: the draw counts from the move into the level it
 * stopped beneath (28.10.2026: a rinse started as the steam was opened, the
 * heater coming on beside them both, was not seen at all).
 */
export const STEADY_WATTS = 15;

/** With byDifference, no new reading for this long is the draw holding at a level too: a plug may report changes only. */
export const SETTLED_MS = 2000;

/**
 * With byDifference, how long a level something else held on its own is
 * remembered: one reached from rest and left back to it, nothing in the
 * band beside it — the heater warming the water between two coffees. While
 * the draw counts, settling within half the band's lower end of it is that
 * alone, the pump stopped beneath it (29.10.2026: the pump stopped a second
 * after the heater came on, heater and pump never a level; the heater
 * alone after it counted on, and a rinse of 7 s was a coffee of 16).
 */
export const ALONE_MS = 10 * 60_000;

/**
 * With byDifference, the longest a pump seen only as it stops can have run:
 * a long coffee. A step down by the band's size after longer is something
 * else beneath the heater (31.10.2026: 39 W gone from it eight minutes into
 * heating up, taken for a pump run of 478 s — the shot timer ended the
 * heating display, and Idle switched the machine off before the coffee).
 */
export const UNSEEN_MAX_MS = 120_000;

/**
 * With byDifference, how many levels held while nothing counted are
 * remembered, besides the one reached from rest: the steam on its own, say.
 * While the draw counts, settling back at one of them is the pump stopped
 * beneath what runs on, however far the draw fell (3.11.2026: a rinse while
 * the milk frothed, the heater going off with the pump, the draw falling
 * from 1800 W straight to the steam's 493 — and the pump counted on beside
 * the steam for a minute, a coffee of 69 s).
 */
export const QUIET_LEVELS = 4;

/**
 * With byDifference, how long a level has to be held, nothing counting, to
 * be remembered as quiet: the steam for a while, not the heater's draw for
 * a moment with the pump started unseen beside it (2.11.2026: 1265 W for
 * 2 s, the heater drifting up as the pump came on, and a coffee of 20 s
 * taken for two rinses).
 */
export const QUIET_HELD_MS = 10_000;

/** A reading at what the heater draws alone, held this long, is that level: see #follow. */
export const ALONE_HELD_MS = 1500;

/**
 * A plug whose readings change this many seconds apart or more, while it
 * draws power, reports too seldom for byDifference: its readings are
 * averages, and the steps are lost in them. An Eve Energy measures every
 * 6 s, however often it is asked; a Shelly every second. The settings page
 * warns of it.
 */
export const SLOW_REPORT_SECONDS = 3;

/** Readings below this are left out of reportSeconds: resting, a plug reports little, whatever it could. */
const REPORT_WATTS = 20;

/** How many seconds apart a plug's readings typically change while it draws power; none if too few to tell. */
export function reportSeconds(samples: Sample[]): number | undefined {
  const gaps: number[] = [];
  let changedAt: number | undefined;
  let last: number | undefined;
  for (const { at, watts } of samples) {
    if (watts < REPORT_WATTS) {
      changedAt = undefined;
    } else if (watts !== last) {
      if (changedAt !== undefined) {
        gaps.push(at - changedAt);
      }
      changedAt = at;
    }
    last = watts;
  }
  if (gaps.length < 20) {
    return undefined;
  }
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]! / 1000);
}

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
  /**
   * When the draw first entered the band, and — on the change that turns it
   * off, or on a short one — when it last fell below it: how long it really
   * lasted, without the hold and with the time it took to come on. A moment
   * above the band before the fall belongs to it, as a coffee machine's
   * heater coming on beside the pump, but not one after it; a draw that
   * stayed above until the phase ended, when it last left the band.
   */
  from?: number;
  until?: number;
}

/** One phase, on or off. Time is passed in, as for the state machine. */
export class PhaseTracker {
  readonly #phase: PhaseConfig;
  #active = false;
  #since = 0;
  #watts: number | undefined;
  #accountedAt: number | undefined;
  /** Time counted towards minSeconds since the draw first entered the band, through to the phase's end. */
  #inMs = 0;
  /** Of that, the time actually in the band, without any above it: see IN_BAND_BEFORE_ABOVE_MS. */
  #inBandOnlyMs = 0;
  #outSince: number | undefined;
  /** When the draw fell below the band, or none came, since it was last in it. */
  #belowSince: number | undefined;
  /** When the draw first entered the band, for a phase on or in the making. */
  #firstIn: number | undefined;
  /** Where the last reading out of the band was, if any. */
  #side: 'above' | 'below' | undefined;
  /** With byDifference, the levels the draw holds at: see STEADY_WATTS. */
  #last: { at: number; watts: number } | undefined;
  /** Whether the last reading is at a level, the one before it as close. */
  #holding = false;
  /** When the draw last started moving from a level. */
  #movedAt: number | undefined;
  /** When the move into the present level started. */
  #levelFrom: number | undefined;
  /** What had counted towards minSeconds when the draw last started moving. */
  #countedAtMove = { inMs: 0, inBandOnlyMs: 0 };
  /** The level the draw left last: its last reading, when the move into it started, and the level left before it. */
  #left: { watts: number; from: number | undefined; before: number | undefined } | undefined;
  /** A level reached from rest with nothing counted, until it is known to have been left back to rest. */
  #restLevel: { watts: number; at: number } | undefined;
  /** The last level something else held alone: see ALONE_MS. */
  #alone: { watts: number; at: number } | undefined;
  /** Levels above the band held while nothing counted, the latest last: see QUIET_LEVELS. */
  #quiet: { watts: number; at: number }[] = [];
  /** The level held now, nothing counting at it, since when: quiet once held QUIET_HELD_MS. */
  #quietFrom: { watts: number; at: number } | undefined;
  /** With byDifference, the pump seen starting by a step up beside something else, and not stopped. */
  #beside = false;
  /** The level the pump was last seen starting beside, while the draw counts: see #backBeneath. */
  #beneath: number | undefined;

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
   * While the phase is on, when the draw fell below its range, if it has:
   * where it will have ended, unless the draw comes back into the range
   * before the hold is over. Known at once rather than after the hold — a
   * display can stop counting a coffee as the pump stops.
   */
  get until(): number | undefined {
    return this.#active ? this.#belowSince : undefined;
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
    const before = this.#watts;
    this.#watts = watts;
    const drawing = this.#firstIn !== undefined;
    const inBand = this.#inBand(watts);
    if (!inBand) {
      this.#side = this.#sideOf(watts);
    }
    if (this.#phase.byDifference) {
      this.#follow(at, watts);
    }
    if (this.#counts(watts) || this.#besideNow(watts)) {
      this.#outSince = undefined;
      this.#firstIn ??= at;
    } else {
      this.#outSince ??= at;
    }
    // Once below, the draw is over until it is back in the band: the heater
    // alone a few seconds later is not the pump again.
    if (watts < this.#phase.minWatts) {
      this.#belowSince ??= at;
      this.#beside = false;
      if (this.#restLevel !== undefined) {
        this.#alone = this.#restLevel;
        this.#restLevel = undefined;
      }
    } else if (inBand && (!this.#phase.byDifference || !drawing || (before !== undefined && this.#inBand(before)))) {
      // By difference, once the draw has fallen below, it is back on a second
      // reading in the band: one alone may be the heater on its way up
      // (29.10.2026: 53 W for a second, 3 s after a rinse, and the rinse
      // counted on beside the heater).
      this.#belowSince = undefined;
    }
    return this.#check(at);
  }

  /**
   * With byDifference, the steps of the draw from one level to the next:
   * the pump starting or stopping beside something else. See STEADY_WATTS.
   */
  #follow(at: number, watts: number): void {
    const last = this.#last;
    this.#last = { at, watts };
    if (last === undefined) {
      return;
    }
    // At what the heater draws alone while the pump counts, a reading held
    // ALONE_HELD_MS is that level, whatever comes next: the heater may go off
    // before a second reading (29.10.2026: a pump stopped beneath it unseen).
    if (!this.#holding && at - last.at >= ALONE_HELD_MS && this.#pumping() && this.#atAlone(last.watts, at)) {
      this.#settle(at, last.watts, last.at);
    }
    if (Math.abs(watts - last.watts) > STEADY_WATTS) {
      const back = this.#backBeneath(last.watts, watts);
      if (this.#holding || back) {
        this.#keepQuiet(last.at);
        this.#left = { watts: last.watts, from: this.#levelFrom, before: this.#left?.watts };
        this.#holding = false;
        this.#movedAt = at;
        this.#countedAtMove = { inMs: this.#inMs, inBandOnlyMs: this.#inBandOnlyMs };
      }
      if (back) {
        // Stopped there and then, whatever comes next.
        this.#settle(at, watts, at);
      }
      return;
    }
    if (!this.#holding) {
      this.#settle(at, watts, last.at);
    }
  }

  /**
   * A new level, from the reading before this one, at what it settled to:
   * the first may have been a moment on the way.
   */
  #settle(at: number, watts: number, firstAt: number): void {
    this.#holding = true;
    const movedAt = this.#movedAt ?? firstAt;
    this.#levelFrom = movedAt;
    const { minWatts } = this.#phase;
    const maxWatts = this.#phase.maxWatts ?? Infinity;
    const pumping = this.#pumping();
    const left = this.#left;
    if (this.#outSince !== undefined && this.#counting()) {
      // Above the band, the pump counting on: the hold is for the level held
      // now, a stop beneath it not seen. One moving on, another coming or
      // going beside it, is not the end (6.11.2026: a coffee of 22 s, the
      // pump started alone, then the heater and the milk, taken for 4 s).
      this.#outSince = movedAt;
    }
    if (left === undefined) {
      this.#quietAt(watts, at);
      return;
    }
    this.#restLevel = left.watts < minWatts && !pumping && watts >= maxWatts ? { watts, at } : undefined;
    if (pumping && this.#belowSince === undefined && watts >= maxWatts && this.#atAlone(watts, at)) {
      // Settled at what the heater draws alone: the pump stopped beneath it on the way.
      this.#stoppedBeneath(movedAt, left.watts - watts);
      return;
    }
    const step = watts - left.watts;
    // Back down from a burst, the heater on and off again, the pump may have
    // started on the way, its step lost in the fall: from where the draw was
    // before the burst (6.11.2026: a coffee of 23 s started as the heater went
    // off beside the milk, only its last 7 s seen).
    const beneath = -step >= maxWatts && left.before !== undefined ? left.before : left.watts;
    const rise = watts - beneath;
    if (rise >= minWatts && rise < maxWatts && watts >= maxWatts && !this.#beside) {
      // The pump starting beside what was drawn already.
      this.#beside = true;
      this.#beneath = beneath;
      this.#belowSince = undefined;
      this.#firstIn ??= movedAt;
      this.#inMs += at - movedAt;
      this.#inBandOnlyMs += at - movedAt;
    } else if (-step >= minWatts * STOPPED_BENEATH_SHARE && -step < maxWatts && left.watts >= maxWatts && watts >= minWatts) {
      if (pumping) {
        // The pump stopping beneath what runs on.
        this.#stoppedBeneath(movedAt, -step);
      } else if (left.from !== undefined && movedAt - left.from <= UNSEEN_MAX_MS) {
        // It stopped having started unseen, as something else did: since the move into the level it left.
        // That level had the pump in it, and was not quiet.
        this.#quiet = this.#quiet.filter((level) => Math.abs(level.watts - left.watts) >= minWatts / 2);
        this.#firstIn = left.from;
        this.#inMs += movedAt - left.from;
        this.#inBandOnlyMs += movedAt - left.from;
        this.#belowSince = movedAt;
      }
      this.#beside = false;
    }
    if (!pumping) {
      this.#quietAt(watts, at);
    }
  }

  /** A level settled at above the band, nothing counting there, not even the pump starting beside it: see QUIET_LEVELS. */
  #quietAt(watts: number, at: number): void {
    this.#quietFrom = this.#pumping() || watts < (this.#phase.maxWatts ?? Infinity) ? undefined : { watts, at };
  }

  /** The level left at *at*: quiet, if it was held long enough with nothing counting. */
  #keepQuiet(at: number): void {
    const level = this.#quietFrom;
    this.#quietFrom = undefined;
    if (level === undefined || this.#pumping() || at - level.at < QUIET_HELD_MS) {
      return;
    }
    const { minWatts } = this.#phase;
    this.#quiet = [...this.#quiet.filter((other) => Math.abs(other.watts - level.watts) >= minWatts / 2), { watts: level.watts, at }].slice(-QUIET_LEVELS);
  }

  /** The pump known to be running beside something else, from its steps. */
  #besideNow(watts: number): boolean {
    return this.#beside && watts >= this.#phase.minWatts;
  }

  /** A draw in the band, or beside something else, being counted. */
  #pumping(): boolean {
    return this.#beside || this.#firstIn !== undefined;
  }

  /** At what something else lately drew alone, the heater or the steam say: see ALONE_MS and QUIET_LEVELS. */
  #atAlone(watts: number, at: number): boolean {
    const near = (level: { watts: number; at: number } | undefined): boolean =>
      level !== undefined && at - level.at <= ALONE_MS && Math.abs(watts - level.watts) < this.#phase.minWatts / 2;
    return near(this.#alone) || this.#quiet.some(near);
  }

  /**
   * A step down by the band's size, straight back to what the pump was seen
   * starting beside: the pump stopping beneath it, though the draw may move
   * on a second later, the heater coming on. Nothing else stopping lands
   * there (4. and 5.11.2026: coffees of 21 s drawn while the milk frothed,
   * the milk's 497 W held under 10 s between the heater's bursts and not
   * known as quiet, taken for 55 and 31 s, until the milk stopped).
   */
  #backBeneath(from: number, to: number): boolean {
    const { minWatts } = this.#phase;
    const drop = from - to;
    return this.#pumping() && this.#belowSince === undefined && this.#beneath !== undefined &&
      Math.abs(to - this.#beneath) < minWatts / 2 &&
      drop >= minWatts * STOPPED_BENEATH_SHARE && drop < (this.#phase.maxWatts ?? Infinity);
  }

  /**
   * The pump stopped beneath what runs on, when the draw started moving, by
   * a step down of *drop*. Seen stopping beneath it — a drop of the band's
   * size — it ran from entering the band, the time above it too, though it
   * was in the band alone too short for that to count (see
   * IN_BAND_SEEN_MS); also when it settled at what the heater draws alone
   * (2.11.2026: a rinse of 14 s, the pump alone 1.7 s before the heater came
   * on beside it, was not seen).
   */
  #stoppedBeneath(movedAt: number, drop: number): void {
    const fresh = this.#belowSince === undefined;
    this.#stoppedAt(movedAt);
    const { minWatts } = this.#phase;
    const band = drop >= minWatts * STOPPED_BENEATH_SHARE && drop < (this.#phase.maxWatts ?? Infinity);
    if (fresh && band && this.#movedAt !== undefined && this.#firstIn !== undefined && this.#inBandOnlyMs >= IN_BAND_SEEN_MS) {
      this.#inMs = Math.max(this.#inMs, movedAt - this.#firstIn);
    }
  }

  /**
   * The pump stopped beneath what runs on, when the draw started moving: the
   * time counted since then taken back.
   */
  #stoppedAt(movedAt: number): void {
    this.#belowSince ??= movedAt;
    if (this.#belowSince === movedAt && this.#movedAt !== undefined) {
      ({ inMs: this.#inMs, inBandOnlyMs: this.#inBandOnlyMs } = this.#countedAtMove);
    }
    this.#beside = false;
  }

  /** A draw over or forgotten: the next one starts afresh. */
  #forget(): void {
    this.#inMs = 0;
    this.#inBandOnlyMs = 0;
    this.#beside = false;
    this.#beneath = undefined;
    this.#firstIn = undefined;
  }

  /**
   * Nothing in the band, whatever the plug reports: it is unreachable, or
   * its relay is off. The phase ends as on leaving the band, after its hold,
   * so that a moment's dropout does not end it.
   */
  none(at: number): PhaseChange | undefined {
    this.#advance(at);
    this.#watts = undefined;
    this.#outSince ??= at;
    this.#belowSince ??= at;
    this.#beside = false;
    this.#last = undefined;
    this.#holding = false;
    return this.#check(at);
  }

  tick(at: number): PhaseChange | undefined {
    this.#advance(at);
    const last = this.#last;
    if (this.#phase.byDifference && last !== undefined && !this.#holding && at - last.at >= SETTLED_MS) {
      this.#settle(at, last.watts, last.at);
    }
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
    return this.#inBand(watts) && !(this.#phase.onDown && this.#side === 'below');
  }

  #advance(at: number): void {
    if (this.#accountedAt !== undefined) {
      const elapsed = Math.max(0, at - this.#accountedAt);
      if (this.#watts !== undefined && this.#counts(this.#watts)) {
        this.#inBandOnlyMs += elapsed;
      }
      if (this.#counting()) {
        this.#inMs += elapsed;
      }
    }
    this.#accountedAt = at;
  }

  /**
   * Whether the time since the last reading counts towards minSeconds: in
   * the band, or — with byDifference — above it once the draw has been in it for
   * IN_BAND_BEFORE_ABOVE_MS and not yet fallen below, or since a step up by
   * as much as the band: something else drawing beside it.
   */
  #counting(): boolean {
    const watts = this.#watts;
    if (watts === undefined) {
      return false;
    }
    if (this.#counts(watts)) {
      return true;
    }
    if (!this.#phase.byDifference || this.#firstIn === undefined || this.#belowSince !== undefined) {
      return false;
    }
    return this.#besideNow(watts) || (this.#inBandOnlyMs >= IN_BAND_BEFORE_ABOVE_MS && watts >= (this.#phase.maxWatts ?? Infinity));
  }

  #check(at: number): PhaseChange | undefined {
    const minMs = (this.#phase.minSeconds ?? DEFAULT_MIN_SECONDS) * 1000;
    const holdMs = (this.#phase.holdSeconds ?? DEFAULT_HOLD_SECONDS) * 1000;
    const belowLong = this.#belowSince !== undefined && at - this.#belowSince >= FORGET_BELOW_MS;
    const outLong = this.#outSince !== undefined && at - this.#outSince >= holdMs;

    if (!this.#active) {
      // On first, should a draw only seen once it stopped be long enough
      // (see STEADY_WATTS): it ends on the next tick.
      if (this.#phase.maxSeconds === undefined && this.#inMs >= minMs) {
        this.#active = true;
        this.#since = at;
        return { active: true, at, from: this.#firstIn };
      }
      if (outLong || (belowLong && this.#firstIn !== undefined)) {
        // The draw is over. For a short phase, that is when it is known;
        // otherwise a start in the making is forgotten.
        const short = this.#short(at, minMs);
        this.#forget();
        return short;
      }
      return undefined;
    }
    if (outLong || (belowLong && this.#phase.byDifference)) {
      this.#active = false;
      const change = { active: false, at, since: this.#since, inBandMs: this.#inMs, from: this.#firstIn, until: this.#until() };
      this.#forget();
      return change;
    }
    return undefined;
  }

  #short(at: number, minMs: number): PhaseChange | undefined {
    const { maxSeconds } = this.#phase;
    if (maxSeconds === undefined || this.#firstIn === undefined) {
      return undefined;
    }
    // In the band long enough to count, and short from start to end, the time
    // above it included.
    const lasted = (this.#until() ?? at) - this.#firstIn;
    if (this.#inMs < minMs || lasted >= maxSeconds * 1000) {
      return undefined;
    }
    return { active: true, at, short: true, since: this.#firstIn, from: this.#firstIn, until: this.#until(), inBandMs: this.#inMs };
  }

  /** Where the draw ended, once it is over: see PhaseChange.until. */
  #until(): number | undefined {
    return this.#belowSince ?? this.#outSince;
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
