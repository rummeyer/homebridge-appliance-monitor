/**
 * The state of one appliance, worked out from its power draw alone.
 *
 *   idle ──(above runWatts for startSeconds in all)──▶ running
 *   running ──(below runWatts for finishSeconds: finished)──▶ idle
 *
 * The two durations are the hysteresis. finishSeconds has to outlast the longest
 * pause inside a programme — a washing machine soaking, a dryer cooling down —
 * or one cycle is reported as two.
 *
 * Time is passed in rather than read from a clock, and nothing here sets a
 * timer: the owner calls tick() now and then. Devices report changes only, so
 * a machine that goes quiet sends nothing, and it is the ticks that notice
 * the quiet has lasted long enough.
 */

export type CycleState = 'idle' | 'running';

/**
 * A state as saved by any version. Earlier ones told a finished appliance
 * from one switched off; nothing in HomeKit did, and both are idle now.
 */
export function cycleState(saved: unknown): CycleState {
  return saved === 'running' ? 'running' : 'idle';
}

export interface CycleParams {
  /** At or above this, the appliance is working. */
  runWatts: number;
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

/** Where a machine was, as saved: its state, and for a running one what the cycle has used so far. */
export interface SavedState {
  state: CycleState;
  since: number;
  wattHours?: number;
  peakWatts?: number;
}

/** What a running cycle has used so far, to be saved with its state. */
export interface CycleProgress {
  wattHours: number;
  peakWatts: number;
}

export interface Transition {
  from: CycleState;
  to: CycleState;
  at: number;
  /** On `→ running`: when the draw first rose, which is some time before `at`. */
  startedAt?: number;
  /** On `running → idle`, the appliance having finished: when the cycle started, and what it used. */
  cycle?: {
    startedAt: number;
    seconds: number;
    wattHours: number;
    peakWatts: number;
    /** Ended by the plug being switched off, rather than by going quiet. */
    switchedOff?: boolean;
  };
}

export class CycleMachine {
  #params: CycleParams;

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

  #cycleStart = 0;
  #wattHours = 0;
  #peak = 0;

  constructor(params: CycleParams, initial?: SavedState) {
    this.#params = params;
    this.#state = initial?.state ?? 'idle';
    this.#since = initial?.since ?? 0;
    // A cycle running across a restart goes on adding to what it had used.
    if (this.#state === 'running') {
      this.#wattHours = initial?.wattHours ?? 0;
      this.#peak = initial?.peakWatts ?? 0;
    }
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

  /** What the running cycle has used up to now, or undefined when nothing runs. */
  progress(at: number): CycleProgress | undefined {
    if (this.#state !== 'running') {
      return undefined;
    }
    this.#accumulate(at);
    return { wattHours: this.#wattHours, peakWatts: this.#peak };
  }

  /**
   * New thresholds, from now on. The draw in effect is looked at again: a
   * plug that reports only changes would otherwise leave a machine now below
   * a raised running level running until its draw next changed.
   */
  retune(params: CycleParams, at: number): void {
    this.#params = params;
    if (this.#watts === undefined) {
      return;
    }
    if (this.#watts >= params.runWatts) {
      this.#belowSince = undefined;
    } else {
      this.#belowSince ??= at;
    }
  }

  /** A new reading. Undefined — "no measurement right now" — is ignored. */
  reading(at: number, watts: number | undefined): Transition[] {
    if (watts === undefined) {
      return this.tick(at);
    }
    this.#accumulate(at);
    this.#advance(at);

    if (watts >= this.#params.runWatts) {
      this.#candidateSince ??= at;
      this.#belowSince = undefined;
    } else {
      this.#belowSince ??= at;
    }

    this.#watts = watts;
    this.#readingAt = at;
    this.#peak = Math.max(this.#peak, watts);
    return this.tick(at);
  }

  /**
   * The plug was switched off: a running appliance has finished, now, with
   * no quiet spell to wait out — no pause in a programme switches the plug.
   */
  switchedOff(at: number): Transition[] {
    if (this.#state !== 'running') {
      return [];
    }
    this.#accumulate(at);
    const endedAt = this.#belowSince ?? at;
    const cycle = {
      startedAt: this.#cycleStart,
      seconds: Math.round((endedAt - this.#cycleStart) / 1000),
      wattHours: this.#wattHours,
      peakWatts: this.#peak,
      switchedOff: true,
    };
    this.#forgetCandidate();
    return [{ ...this.#go('idle', at), cycle }];
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
        return { ...this.#go('idle', at), cycle };
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
