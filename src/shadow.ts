/**
 * The learned model watching beside the rules: it decides nothing, it says
 * in the log where it saw a phase differently. See model.ts.
 *
 * It learns from the recording once a day, in a worker thread, and keeps
 * what it learned next to the pairing data so that a restart need not wait
 * for it. Changing a phase's band starts it over from the settings.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { readJson, writeJson } from './json-file.ts';
import { aboutTheSame, Comparison, describeParams, fits, initialParams, modelPhases, ModelWatcher, partOf } from './model.ts';
import type { Compared, ModelParams, ModelRun, Verdict } from './model.ts';
import type { LearnRequest } from './model-worker.ts';
import type { PhaseChange, PhaseConfig } from './phases.ts';

/** How often it learns again. */
const LEARN_EVERY_MS = 24 * 3_600_000;
/** How long after starting it first learns, with nothing saved: Homebridge has enough to do then. */
const FIRST_LEARN_MS = 2 * 60_000;
/** A run the model holds live, off this long by its likeliest way: over. */
const LIVE_OFF_MS = 3000;
/** Two starts of a phase this close are the same run's. */
const SAME_START_MS = 1000;

export interface ShadowLog {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
}

/**
 * A phase's start or end messages sent by the model: at its start, how long
 * it has been on already; at its end, how long it lasted.
 */
export type Send = (phase: string, when: 'start' | 'end', seconds: number) => void;

/** What is known live of a phase. */
interface Live {
  /** Whether the model tells its start live, as a shot timer counts from it. */
  told: boolean;
  /** Since when the rules have it on, while they do. */
  rules?: number;
  /** When its part was last off by the likeliest way. */
  offAt: number;
  /**
   * The run the model holds: since when, when its part was last on, and first off after. One the
   * rules started it takes over without telling its start again.
   */
  started?: { since: number; onAt: number; offAt?: number; bareOffAt?: number };
  /** Whether the model ended the run the rules have on still: their end is not told again. */
  endedLive?: boolean;
  /** From when the run the rules ended last was: not to be started again. */
  ended: number;
  /** From when the latest run started, by either: a correction of one before it comes too late. */
  latest: number;
  /** How long the run the model ended itself lasted, in seconds: not to be corrected to the same. */
  sent?: number;
}

export class ModelShadow {
  readonly #device: string;
  readonly #phases: PhaseConfig[];
  readonly #path: string;
  readonly #recordings: string;
  readonly #keepMs: number;
  readonly #log: ShadowLog;
  readonly #comparison = new Comparison();
  readonly #send: Send | undefined;
  readonly #live = new Map<string, Live>();
  #watcher: ModelWatcher;
  #learnAt: number;
  #worker: Worker | undefined;

  constructor(device: string, phases: PhaseConfig[], dataPath: string, recordings: string, keepDays: number, log: ShadowLog, now = Date.now(), send?: Send, live: string[] = []) {
    this.#device = device;
    this.#phases = modelPhases(phases);
    this.#path = join(dataPath, 'model', `${encodeURIComponent(device)}.json`);
    this.#recordings = recordings;
    this.#keepMs = keepDays * 86_400_000;
    this.#log = log;
    this.#send = send;
    for (const { name, maxSeconds } of this.#phases) {
      // A phase only shown for a moment once over is not started live.
      const told = live.includes(name) && maxSeconds === undefined;
      this.#live.set(name, { told, offAt: -Infinity, ended: -Infinity, latest: -Infinity });
    }
    const saved = readSaved(this.#path);
    if (saved && fits(saved, this.#phases)) {
      this.#watcher = new ModelWatcher(this.#phases, saved);
      this.#learnAt = savedAt(this.#path) + LEARN_EVERY_MS;
      log.info(`${device}: model watching, ${describeParams(saved)}`);
    } else {
      this.#watcher = new ModelWatcher(this.#phases, initialParams(this.#phases, 0));
      this.#learnAt = now + FIRST_LEARN_MS;
      log.info(`${device}: model watching, learning from the recording shortly`);
    }
  }

  reading(at: number, watts: number): void {
    this.#told(this.#watcher.reading(at, watts));
    if (this.#send && !this.#watcher.unready()) {
      const likeliest = this.#watcher.likeliest();
      // The level part on, what it draws not known yet: a part that came on with it or after is
      // only what it draws more than last time, not seen (15.11.2026: a cold heater 50 W above
      // the morning's warm one, taken for the pump beside it, a shot of 16 s on the clock).
      const level = this.#watcher.levelUnknown() ? likeliest.find((each) => each.part === this.#watcher.levelPart) : undefined;
      for (const phase of this.#phases.filter(({ name }) => this.#live.get(name)!.told)) {
        const part = partOf(this.#watcher.params, phase);
        const since = likeliest.find((each) => each.part === part)?.since;
        const unseen = level !== undefined && part !== level.part && since !== undefined && since >= level.since;
        this.#startLive(phase, unseen ? undefined : since, at, !likeliest.some((each) => each.part === this.#watcher.levelPart));
      }
    }
  }

  /**
   * Whether the rules' start of a phase is to be held back: the model started
   * it live already, as early or earlier, and a shot timer counting from that
   * is not to count back.
   */
  holdsStart(phase: string, from: number): boolean {
    const started = this.#live.get(phase)?.started;
    return started !== undefined && started.since <= from + SAME_START_MS;
  }

  /**
   * Whether the rules' end of a phase is to be held back, and their until with
   * it: the model started the run live and has its part on still. The rules
   * lose a pump whose heater comes back on beside it (11.11.2026: a 24 s shot
   * ended as a 7 s rinse 5 s before the pump stopped); the model ends it.
   */
  holdsEnd(phase: string, at: number): boolean {
    const live = this.#live.get(phase);
    return live?.endedLive === true || (live?.started !== undefined && at - live.started.onAt < LIVE_OFF_MS);
  }

  /** Where the run the model holds went off by the likeliest way, while it is. */
  until(phase: string): number | undefined {
    return this.#live.get(phase)?.started?.offAt;
  }

  /**
   * A phase told live: the moment the likeliest way has its part on for its
   * on after, from where it started — under the heater, where the rules see
   * it late (10.11.2026: 11 s), as alone. Never from before the part was last
   * off by it as it went: what it later takes for on all along, a pump under
   * the heater after a rinse, may not have been (9.11.2026: 17 s early).
   * `on` is since when the part is on by it, if it is; `bare` whether the
   * level part is off by it, the heater not hiding the rest.
   */
  #startLive(phase: PhaseConfig, on: number | undefined, at: number, bare: boolean): void {
    const live = this.#live.get(phase.name)!;
    const { started } = live;
    if (on === undefined) {
      live.offAt = at;
      if (started) {
        started.offAt ??= at;
        if (bare) {
          started.bareOffAt ??= at;
        }
      }
      // Over: its end, or a shot timer counts on. Also where the rules have it on still, a pump
      // with the frother beside it they lose the end of (16.11.2026: a 24 s shot ending 67 s in),
      // seen off with the heater off only: under the heater beside the frother the model loses
      // the pump for a moment (5.11.2026: a 30 s shot ended 4 s in).
      const over = live.rules === undefined
        ? started && at - started.onAt >= LIVE_OFF_MS
        : started?.bareOffAt !== undefined && at - started.bareOffAt >= LIVE_OFF_MS;
      if (started && over) {
        const seconds = (started.offAt! - started.since) / 1000;
        live.started = undefined;
        live.endedLive = live.rules !== undefined;
        live.sent = Math.round(seconds);
        const still = live.endedLive ? ', the rules having it on still' : '';
        this.#log.info(`${this.#device}: model ended ${phase.name} after ${live.sent} s${still}`);
        this.#send!(phase.name, 'end', seconds);
      }
      return;
    }
    const since = Math.max(on, live.offAt);
    if (started && started.since <= since + SAME_START_MS) {
      started.onAt = at;
      started.offAt = undefined;
      started.bareOffAt = undefined;
      return;
    }
    // Not one ended already, nor before its on after.
    if (since <= live.ended + SAME_START_MS || live.endedLive || at - since < (phase.minSeconds ?? 5) * 1000) {
      return;
    }
    // Where the rules had it as early: theirs, told already, the model holds from where they started.
    if (live.rules !== undefined && live.rules <= since + SAME_START_MS) {
      live.started = { since: live.rules, onAt: at };
      return;
    }
    live.started = { since, onAt: at };
    live.sent = undefined;
    live.latest = Math.max(live.latest, since);
    const ahead = live.rules === undefined ? 'before the rules' : `${Math.round((live.rules - since) / 1000)} s before the rules had it`;
    this.#log.info(`${this.#device}: model started ${phase.name} ${Math.round((at - since) / 1000)} s ago, ${ahead}`);
    this.#send!(phase.name, 'start', (at - since) / 1000);
  }

  /** A phase as the rules saw it. */
  rule(phase: string, change: PhaseChange): void {
    if (!this.#live.has(phase)) {
      return;
    }
    const from = change.from ?? change.since ?? change.at;
    const live = this.#live.get(phase)!;
    live.latest = Math.max(live.latest, from);
    if (change.active && !change.short) {
      this.#comparison.opened(phase, from);
      live.rules = from;
      if (!live.started) {
        live.sent = undefined;
      }
      return;
    }
    live.ended = Math.max(live.started?.since ?? -Infinity, from);
    live.rules = undefined;
    live.endedLive = undefined;
    if (!this.holdsEnd(phase, change.at)) {
      live.started = undefined;
    }
    const until = change.until ?? change.at;
    if (until >= from) {
      const rule = { phase, from, until };
      this.#correct(rule, this.#comparison.rule(rule));
    }
  }

  tick(at: number): void {
    this.#told(this.#watcher.tick(at));
    for (const compared of this.#comparison.settle(at)) {
      if (compared.agree) {
        this.#log.debug(`${this.#device}: model watching, ${describe(compared)}`);
      } else {
        const verdict = this.#watcher.judge(compared.phase, compared.runs.rules, compared.runs.model);
        this.#log.info(`${this.#device}: model watching, ${describe(compared, verdict)}`);
      }
    }
    if (at >= this.#learnAt && !this.#worker) {
      this.#learn(at);
    }
  }

  stop(): void {
    void this.#worker?.terminate();
  }

  #told(runs: ModelRun[]): void {
    for (const run of runs) {
      const rule = this.#comparison.model(run);
      if (rule) {
        this.#correct(rule, run);
      }
    }
  }

  /**
   * A run both sides have told, as soon as the second has: the length the
   * clock shows goes out again where it is not the better one's. That is the
   * model's where it would correct the rules, as a coffee's the heater hid the
   * start of (10.11.2026: 21 s by the rules, 25 by the model), else the rules',
   * as where the model ended it live a guess too long (9.11.2026: 28 s, settled
   * 23 as the rules had it). Not while the model holds it, nor once another
   * has started: it would be taken for that one's.
   */
  #correct(rule: ModelRun, run: ModelRun | undefined): void {
    const seconds = (each: ModelRun) => Math.round((each.until - each.from) / 1000);
    const live = this.#live.get(rule.phase)!;
    const newer = live.latest > Math.max(rule.until, run?.until ?? -Infinity);
    if (!this.#send || !run || newer || live.started) {
      return;
    }
    const shown = live.sent ?? seconds(rule);
    const better = seconds(run) === seconds(rule) || this.#watcher.judge(rule.phase, rule, run).corrects ? run : rule;
    if (seconds(better) === shown) {
      return;
    }
    const by = better === run ? 'model' : 'rules';
    this.#log.info(`${this.#device}: model correcting ${rule.phase}: ${seconds(better)} s by the ${by}, was ${shown} s`);
    this.#send(rule.phase, 'end', (better.until - better.from) / 1000);
  }

  #learn(now: number): void {
    this.#learnAt = now + LEARN_EVERY_MS;
    const request: LearnRequest = { dir: this.#recordings, device: this.#device, phases: this.#phases, from: now - this.#keepMs, to: now };
    // The sources run directly in the tests, the built files in Homebridge.
    const file = import.meta.url.endsWith('.ts') ? './model-worker.ts' : './model-worker.js';
    const worker = new Worker(new URL(file, import.meta.url), { workerData: request });
    this.#worker = worker;
    worker.once('message', (params: ModelParams) => {
      if (params.sessions === 0) {
        this.#log.debug(`${this.#device}: model watching, nothing recorded to learn from yet`);
        return;
      }
      const before = this.#watcher.params;
      params.steady = before.sessions > 0 && aboutTheSame(before, params) ? (before.steady ?? 0) + 1 : 0;
      try {
        writeJson(this.#path, params);
      } catch (error) {
        this.#log.warn(`${this.#device}: could not save the model: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.#watcher = new ModelWatcher(this.#phases, params);
      this.#log.info(`${this.#device}: model watching, ${describeParams(params)}`);
    });
    worker.once('error', (error) => this.#log.warn(`${this.#device}: could not learn the model: ${error.message}`));
    worker.once('exit', () => {
      this.#worker = undefined;
    });
  }
}

/** What was learned before, if anything readable. */
function readSaved(path: string): ModelParams | undefined {
  try {
    const saved = readJson(path) as ModelParams | undefined;
    return saved && Array.isArray(saved.parts) ? saved : undefined;
  } catch {
    return undefined;
  }
}

function savedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

const clock = (at: number): string => new Date(at).toTimeString().slice(0, 8);
const lasted = (seconds: number | undefined): string => (seconds === undefined ? 'none' : `${seconds} s`);

/**
 * "Bezug 08:28:53: rules 23 s, model 27 s", and where they differ whether the
 * model would have corrected the rules: "— would correct: the rules' account
 * off by 54 W over 4 readings, the model's by 2 W".
 */
export function describe({ phase, at, rules, model }: Compared, verdict?: Verdict): string {
  const line = `${phase} ${clock(at)}: rules ${lasted(rules)}, model ${lasted(model)}`;
  return verdict ? `${line} — ${verdict.corrects ? 'would correct' : 'would leave it'}: ${verdict.reason}` : line;
}
