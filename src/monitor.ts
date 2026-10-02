/**
 * One appliance: its state machine, and the learning that tunes it.
 *
 * Until a cycle has been learned, the machine runs on defaults that are
 * generous rather than quick: half an hour of quiet before a cycle is over,
 * so that no pause in a programme can split it. The first "finished" comes
 * late, and from then on on time.
 *
 * Like the state machine, this takes the time as an argument and sets no
 * timers of its own.
 */
import { CycleMachine } from './cycle.ts';
import type { CycleParams, CycleProgress, CycleState, SavedState, Transition } from './cycle.ts';
import {
  learnFromCycle,
  MAX_STANDBY_WATTS,
  merge,
  NOTHING_WATTS,
  runLevelAbove,
  STANDBY_HELD_MS as HELD_MS,
  STANDBY_STEADY_RATIO as STEADY_RATIO,
} from './learn.ts';
import type { Learned, Sample } from './learn.ts';

export const LEARNING_DEFAULTS: CycleParams = {
  runWatts: 5,
  startSeconds: 60,
  finishSeconds: 1800,
};

/** How much of what came before a cycle is kept, to see the level it rose from. */
export const BEFORE_MS = 10 * 60_000;
/** How long after finishing to keep watching before learning — to see where the machine rests. */
export const AFTER_MS = 10 * 60_000;
/** A machine that runs for days (a PC, say) is not a cycle; stop collecting. */
const MAX_SAMPLES = 50_000;
/** How far above standby a machine has to have been seen for the low level to be standby. */
const STANDBY_RATIO = 3;

export interface MonitorOptions {
  /** Values from the config, which win over learned ones. */
  overrides?: Partial<CycleParams>;
  learned?: Learned;
  cycles?: number;
  initial?: SavedState;
  /** The standby found before, which a restart would otherwise have to find again. */
  standbyWatts?: number;
}

export interface MonitorEvents {
  transition(transition: Transition): void;
  learned(learned: Learned, cycles: number): void;
  /** A cycle that looked finished started again before it was learned. */
  resumed(pauseSeconds: number): void;
  /** Standby found before anything was learned, and the running level now above it. */
  standby?(standbyWatts: number, runWatts: number): void;
}

export class DeviceMonitor {
  readonly #machine: CycleMachine;
  readonly #overrides: Partial<CycleParams>;
  readonly #events: MonitorEvents;

  #learned: Learned | undefined;
  #cycles: number;
  #samples: Sample[] = [];
  #cycleStart: number | undefined;
  /** A finished cycle, waiting to be learned from. */
  #pending: { startedAt: number; endedAt: number; learnAt: number; switchedOff: boolean } | undefined;
  /**
   * Before anything is learned: the lowest level held for a while, the
   * highest reading, and the standby they show. See #watchLevels.
   */
  #lowestHeld: number | undefined;
  #highest = 0;
  #standby: number | undefined;

  constructor(options: MonitorOptions, events: MonitorEvents) {
    // Only real numbers override: an empty field in the settings page arrives
    // as undefined or null, and spreading that would wipe the learned value.
    // And only thresholds still used: a config may have the off level of
    // earlier versions.
    this.#overrides = Object.fromEntries(
      Object.entries(options.overrides ?? {}).filter(
        ([key, value]) => key in LEARNING_DEFAULTS && typeof value === 'number' && Number.isFinite(value),
      ),
    );
    this.#learned = options.learned;
    this.#cycles = options.cycles ?? 0;
    this.#standby = options.standbyWatts;
    this.#lowestHeld = options.standbyWatts;
    this.#events = events;
    this.#machine = new CycleMachine(this.#params(), options.initial);
  }

  get state(): CycleState {
    return this.#machine.state;
  }

  get since(): number {
    return this.#machine.since;
  }

  get params(): CycleParams {
    return this.#machine.params;
  }

  /** Whether the params come from a learned cycle (or the config) rather than the defaults. */
  get isLearned(): boolean {
    return this.#learned !== undefined;
  }

  /** What the running cycle has used up to now; see CycleMachine.progress. */
  progress(at: number): CycleProgress | undefined {
    return this.#machine.progress(at);
  }

  /** The standby found before anything was learned, if any. */
  get standbyWatts(): number | undefined {
    return this.#standby;
  }

  reading(at: number, watts: number | undefined): void {
    if (watts !== undefined) {
      this.#samples.push({ at, watts });
      this.#trim(at);
      this.#highest = Math.max(this.#highest, watts);
    }
    this.#watchLevels(at);
    this.#handle(this.#machine.reading(at, watts), at);
  }

  tick(at: number): void {
    this.#watchLevels(at);
    this.#handle(this.#machine.tick(at), at);
  }

  /** The plug was switched off: see CycleMachine.switchedOff. */
  switchedOff(at: number): void {
    this.#handle(this.#machine.switchedOff(at), at);
  }

  /**
   * Finds standby before a cycle has been learned, from which the running
   * level would follow — and without which a machine resting above the
   * default running level (a computer at 9 W, say) never finishes, and so
   * never learns.
   *
   * Standby is the lowest level held steady for ten minutes, once the
   * machine has been seen drawing three times that: one level alone may as
   * well be the machine at work. Steady, and at most 25 W, so that the drum
   * of a washing machine turning in bursts is not taken for it. Drawing
   * nothing is not standby but switched off.
   */
  #watchLevels(at: number): void {
    if (this.#learned || 'runWatts' in this.#overrides) {
      return;
    }
    const range = heldRange(this.#samples, at, HELD_MS);
    if (
      range !== undefined &&
      range.lowest >= NOTHING_WATTS &&
      range.highest <= MAX_STANDBY_WATTS &&
      range.highest <= range.lowest * STEADY_RATIO &&
      // Clearly lower, not a reading or two less than before.
      (this.#lowestHeld === undefined || range.highest < this.#lowestHeld * 0.8)
    ) {
      this.#lowestHeld = range.highest;
    }
    const low = this.#lowestHeld;
    if (low === undefined || low === this.#standby || this.#highest < low * STANDBY_RATIO) {
      return;
    }
    this.#standby = low;
    this.#machine.retune(this.#params(), at);
    this.#events.standby?.(low, this.#machine.params.runWatts);
  }

  #handle(transitions: Transition[], at: number): void {
    for (const transition of transitions) {
      if (transition.to === 'running') {
        const startedAt = transition.startedAt ?? transition.at;
        if (this.#pending) {
          // Back before the learning window closed: that was a pause, not
          // the end. Keep it as one cycle, so that the pause is learned.
          this.#events.resumed(Math.round((startedAt - this.#pending.endedAt) / 1000));
          this.#cycleStart = this.#pending.startedAt;
          this.#pending = undefined;
        } else {
          this.#cycleStart = startedAt;
        }
      }
      if (transition.cycle) {
        const { startedAt, seconds } = transition.cycle;
        this.#pending = {
          startedAt: this.#cycleStart ?? startedAt,
          endedAt: startedAt + seconds * 1000,
          learnAt: transition.at + AFTER_MS,
          switchedOff: transition.cycle.switchedOff === true,
        };
      }
      this.#events.transition(transition);
    }

    if (this.#pending && at >= this.#pending.learnAt) {
      this.#learn(this.#pending, at);
      this.#pending = undefined;
      this.#cycleStart = undefined;
    }
  }

  /**
   * Learns from a cycle marked on the Power tab, from the recorded readings
   * around it — 10 minutes before and after, as for one seen here. Undefined
   * when there is nothing to learn: the stretch never went well above where
   * the machine rests.
   */
  learnFromMarked(samples: Sample[], cycle: { startedAt: number; endedAt: number }, at: number): Learned | undefined {
    const fresh = learnFromCycle(samples, cycle, this.#machine.params, { marked: true });
    if (!fresh) {
      return undefined;
    }
    this.#learned = merge(this.#learned, fresh);
    this.#cycles += 1;
    this.#machine.retune(this.#params(), at);
    this.#events.learned(this.#learned, this.#cycles);
    return this.#learned;
  }

  /** Forgets what was learned, standby included, and starts again from the defaults. */
  forget(at: number): void {
    this.#learned = undefined;
    this.#cycles = 0;
    this.#standby = undefined;
    this.#lowestHeld = undefined;
    this.#highest = 0;
    this.#pending = undefined;
    this.#machine.retune(this.#params(), at);
  }

  #learn(cycle: { startedAt: number; endedAt: number; switchedOff: boolean }, at: number): void {
    const fresh = learnFromCycle(this.#samples, cycle, this.#machine.params, { switchedOff: cycle.switchedOff });
    if (!fresh) {
      return;
    }
    this.#learned = merge(this.#learned, fresh);
    this.#cycles += 1;
    this.#machine.retune(this.#params(), at);
    this.#events.learned(this.#learned, this.#cycles);
  }

  #params(): CycleParams {
    const base = this.#learned?.params ?? {
      ...LEARNING_DEFAULTS,
      runWatts: Math.max(LEARNING_DEFAULTS.runWatts, this.#standby === undefined ? 0 : runLevelAbove(this.#standby)),
    };
    const { runWatts, startSeconds, finishSeconds } = { ...base, ...this.#overrides };
    return { runWatts, startSeconds, finishSeconds };
  }

  /**
   * Keeps what a cycle needs: from a while before it started. With no cycle
   * going, only the last while, and the reading in effect at its start.
   */
  #trim(now: number): void {
    const keepFrom = (this.#pending?.startedAt ?? this.#cycleStart ?? now) - BEFORE_MS;
    let first = 0;
    while (first < this.#samples.length - 1 && this.#samples[first + 1]!.at <= keepFrom) {
      first++;
    }
    if (first > 0) {
      this.#samples.splice(0, first);
    }
    if (this.#samples.length > MAX_SAMPLES) {
      this.#samples.splice(0, this.#samples.length - MAX_SAMPLES);
    }
  }
}

/**
 * The lowest and highest reading in effect over the last `windowMs`, or
 * undefined if the readings do not reach back that far.
 */
function heldRange(samples: Sample[], at: number, windowMs: number): { lowest: number; highest: number } | undefined {
  const from = at - windowMs;
  let lowest = Infinity;
  let highest = 0;
  for (let index = samples.length - 1; index >= 0; index--) {
    const sample = samples[index]!;
    if (sample.at > at) {
      continue;
    }
    lowest = Math.min(lowest, sample.watts);
    highest = Math.max(highest, sample.watts);
    if (sample.at <= from) {
      return { lowest, highest };
    }
  }
  return undefined;
}
