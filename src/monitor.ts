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
import type { CycleParams, CycleState, Transition } from './cycle.ts';
import { learnFromCycle, merge } from './learn.ts';
import type { Learned, Sample } from './learn.ts';

export const LEARNING_DEFAULTS: CycleParams = {
  runWatts: 5,
  offWatts: 0.3,
  startSeconds: 60,
  finishSeconds: 1800,
};

/** How much of what came before a cycle is kept, to see the level it rose from. */
const BEFORE_MS = 10 * 60_000;
/** How long after finishing to keep watching before learning — to see where the machine rests. */
const AFTER_MS = 10 * 60_000;
/** A machine that runs for days (a PC, say) is not a cycle; stop collecting. */
const MAX_SAMPLES = 50_000;

export interface MonitorOptions {
  /** Values from the config, which win over learned ones. */
  overrides?: Partial<CycleParams>;
  learned?: Learned;
  cycles?: number;
  initial?: { state: CycleState; since: number };
}

export interface MonitorEvents {
  transition(transition: Transition): void;
  learned(learned: Learned, cycles: number): void;
  /** A cycle that looked finished started again before it was learned. */
  resumed(pauseSeconds: number): void;
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
  #pending: { startedAt: number; endedAt: number; learnAt: number } | undefined;

  constructor(options: MonitorOptions, events: MonitorEvents) {
    // Only real numbers override: an empty field in the settings page arrives
    // as undefined or null, and spreading that would wipe the learned value.
    this.#overrides = Object.fromEntries(
      Object.entries(options.overrides ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
    );
    this.#learned = options.learned;
    this.#cycles = options.cycles ?? 0;
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

  reading(at: number, watts: number | undefined): void {
    if (watts !== undefined) {
      this.#samples.push({ at, watts });
      this.#trim(at);
    }
    this.#handle(this.#machine.reading(at, watts), at);
  }

  tick(at: number): void {
    this.#handle(this.#machine.tick(at), at);
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
      if (transition.to === 'finished' && transition.cycle) {
        const { startedAt, seconds } = transition.cycle;
        this.#pending = {
          startedAt: this.#cycleStart ?? startedAt,
          endedAt: startedAt + seconds * 1000,
          learnAt: transition.at + AFTER_MS,
        };
      }
      this.#events.transition(transition);
    }

    if (this.#pending && at >= this.#pending.learnAt) {
      this.#learn(this.#pending);
      this.#pending = undefined;
      this.#cycleStart = undefined;
    }
  }

  #learn(cycle: { startedAt: number; endedAt: number }): void {
    const fresh = learnFromCycle(this.#samples, cycle, this.#machine.params);
    if (!fresh) {
      return;
    }
    this.#learned = merge(this.#learned, fresh);
    this.#cycles += 1;
    this.#machine.params = this.#params();
    this.#events.learned(this.#learned, this.#cycles);
  }

  #params(): CycleParams {
    return { ...(this.#learned?.params ?? LEARNING_DEFAULTS), ...this.#overrides };
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
