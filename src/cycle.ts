/**
 * The state of one appliance, worked out from its power draw alone.
 *
 *   off ──(above runWatts for startSeconds in all)──▶ running
 *   running ──(below runWatts for finishSeconds)──▶ finished
 *   finished ──(reset, see below)──▶ off
 *   finished ──(above runWatts for startSeconds in all)──▶ running
 *
 * The two durations are the hysteresis in time, the gap between offWatts and
 * runWatts the hysteresis in power. finishSeconds has to outlast the longest
 * pause inside a programme — a washing machine soaking, a dryer cooling down —
 * or one cycle is reported as two.
 *
 * Time is passed in rather than read from a clock, and nothing here sets a
 * timer: the owner calls tick() now and then. Devices report changes only, so
 * a machine that goes quiet sends nothing, and it is the ticks that notice
 * the quiet has lasted long enough.
 */

export type CycleState = 'off' | 'running' | 'finished';

export interface CycleParams {
  /** At or above this, the appliance is working. */
  runWatts: number;
  /**
   * At or below this, the appliance is switched off rather than finished and
   * waiting. Only used by the `off-level` reset.
   */
  offWatts: number;
  /**
   * How long the draw has to be at or above runWatts, added up, to count as
   * a start — with no quiet stretch longer than this in between.
   *
   * Added up rather than in one go because a wash without heating is a drum
   * turning in bursts of half a minute, and would never start otherwise. A
   * door lock or a pump running for a few seconds still does not add up.
   */
  startSeconds: number;
  /** How long the draw has to stay below runWatts to count as the end. */
  finishSeconds: number;
}

/**
 * When `finished` goes back to `off`.
 *
 * - `off-level`: when the draw falls to offWatts — the machine is switched
 *   off, or its door opened and its display went dark. Only once it has been
 *   seen above offWatts while finished: a machine that drops to nothing by
 *   itself at the end has no level to fall from, and stays finished until it
 *   is started again.
 * - `timeout`: a set number of minutes after finishing.
 * - `next-start`: not until it runs again.
 */
export type ResetMode = 'off-level' | 'timeout' | 'next-start';

export interface ResetOptions {
  mode: ResetMode;
  /** For `timeout`. */
  minutes: number;
}

export interface Transition {
  from: CycleState;
  to: CycleState;
  at: number;
  /** On `→ running`: when the draw first rose, which is some time before `at`. */
  startedAt?: number;
  /** On `running → finished`: when the cycle started, and what it used. */
  cycle?: { startedAt: number; seconds: number; wattHours: number; peakWatts: number };
}

/** A switched-off machine flickers between levels for a moment; wait this long. */
const OFF_SETTLE_MS = 30_000;

export class CycleMachine {
  #params: CycleParams;
  readonly #reset: ResetOptions;

  #state: CycleState;
  #since: number;

  #watts: number | undefined;
  #readingAt: number | undefined;
  /** Since when the draw has been continuously below runWatts. */
  #belowSince: number | undefined;
  /** A start in the making: when the draw first rose, and how long it has been up since. */
  #candidateSince: number | undefined;
  #upMs = 0;
  #accountedAt: number | undefined;
  #offSince: number | undefined;
  /** Whether the machine has been seen above offWatts since it finished. */
  #standbySeen = false;

  #cycleStart = 0;
  #wattHours = 0;
  #peak = 0;

  constructor(params: CycleParams, reset: ResetOptions, initial?: { state: CycleState; since: number }) {
    this.#params = params;
    this.#reset = reset;
    this.#state = initial?.state ?? 'off';
    this.#since = initial?.since ?? 0;
    // After a restart the machine may be anywhere; a finished one is assumed
    // to be waiting, so that switching it off still resets it.
    this.#standbySeen = this.#state === 'finished';
    this.#cycleStart = this.#since;
  }

  get state(): CycleState {
    return this.#state;
  }

  /** When the current state began. */
  get since(): number {
    return this.#since;
  }

  get params(): CycleParams {
    return this.#params;
  }

  set params(params: CycleParams) {
    this.#params = params;
  }

  /** A new reading. Undefined — "no measurement right now" — is ignored. */
  reading(at: number, watts: number | undefined): Transition[] {
    if (watts === undefined) {
      return this.tick(at);
    }
    this.#accumulate(at);
    this.#advance(at);

    const { runWatts, offWatts } = this.#params;
    if (watts >= runWatts) {
      this.#candidateSince ??= at;
      this.#belowSince = undefined;
    } else {
      this.#belowSince ??= at;
    }
    if (watts <= offWatts) {
      this.#offSince ??= at;
    } else {
      this.#offSince = undefined;
      if (this.#state === 'finished') {
        this.#standbySeen = true;
      }
    }

    this.#watts = watts;
    this.#readingAt = at;
    this.#peak = Math.max(this.#peak, watts);
    return this.tick(at);
  }

  /** Lets time pass without a reading. */
  tick(at: number): Transition[] {
    this.#advance(at);
    const transitions: Transition[] = [];
    // A start can follow a finish in the same tick when a new programme
    // begins right away, so keep going until nothing changes.
    for (let step = 0; step < 3; step++) {
      const transition = this.#step(at);
      if (!transition) {
        break;
      }
      transitions.push(transition);
    }
    return transitions;
  }

  #step(at: number): Transition | undefined {
    const { startSeconds, finishSeconds } = this.#params;

    if (this.#state !== 'running') {
      if (this.#candidateSince !== undefined && this.#upMs >= startSeconds * 1000) {
        const startedAt = this.#candidateSince;
        this.#cycleStart = startedAt;
        this.#wattHours = 0;
        this.#peak = this.#watts ?? 0;
        this.#forgetCandidate();
        return { ...this.#go('running', at), startedAt };
      }
    }

    if (this.#state === 'running') {
      if (this.#belowSince !== undefined && at - this.#belowSince >= finishSeconds * 1000) {
        this.#accumulate(at);
        const cycle = {
          startedAt: this.#cycleStart,
          seconds: Math.round((this.#belowSince - this.#cycleStart) / 1000),
          wattHours: this.#wattHours,
          peakWatts: this.#peak,
        };
        this.#standbySeen = (this.#watts ?? 0) > this.#params.offWatts;
        return { ...this.#go('finished', at), cycle };
      }
      return undefined;
    }

    if (this.#state === 'finished') {
      const { mode, minutes } = this.#reset;
      if (mode === 'timeout' && at - this.#since >= minutes * 60_000) {
        return this.#go('off', at);
      }
      if (
        mode === 'off-level' &&
        this.#standbySeen &&
        this.#offSince !== undefined &&
        at - this.#offSince >= OFF_SETTLE_MS
      ) {
        return this.#go('off', at);
      }
    }
    return undefined;
  }

  /** Adds up time spent above runWatts, and drops a start that went quiet for too long. */
  #advance(at: number): void {
    const { runWatts, startSeconds } = this.#params;
    if (this.#watts !== undefined && this.#watts >= runWatts && this.#accountedAt !== undefined) {
      this.#upMs += Math.max(0, at - this.#accountedAt);
    }
    this.#accountedAt = at;
    if (this.#belowSince !== undefined && at - this.#belowSince > startSeconds * 1000) {
      this.#forgetCandidate();
    }
  }

  #forgetCandidate(): void {
    this.#candidateSince = undefined;
    this.#upMs = 0;
  }

  #go(to: CycleState, at: number): Transition {
    const from = this.#state;
    this.#state = to;
    this.#since = at;
    return { from, to, at };
  }

  /** Energy between the last reading and now, at the last reading's power. */
  #accumulate(at: number): void {
    if (this.#state === 'running' && this.#watts !== undefined && this.#readingAt !== undefined) {
      this.#wattHours += (this.#watts * Math.max(0, at - this.#readingAt)) / 3_600_000;
      this.#readingAt = at;
    }
  }
}
