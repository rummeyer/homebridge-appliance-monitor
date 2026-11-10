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
import { aboutTheSame, Comparison, describeParams, fits, initialParams, modelPhases, ModelWatcher, sameRun } from './model.ts';
import type { Compared, ModelParams, ModelRun, Verdict } from './model.ts';
import type { LearnRequest } from './model-worker.ts';
import type { PhaseChange, PhaseConfig } from './phases.ts';

/** How often it learns again. */
const LEARN_EVERY_MS = 24 * 3_600_000;
/** How long after starting it first learns, with nothing saved: Homebridge has enough to do then. */
const FIRST_LEARN_MS = 2 * 60_000;
/** How long a run is kept to correct the other side's by, once over. */
const CORRECT_WITHIN_MS = 60_000;

export interface ShadowLog {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
}

/** The model's length of a phase the rules had differently, in seconds, where it would correct them. */
export type Correct = (phase: string, seconds: number, rules: number) => void;

export class ModelShadow {
  readonly #device: string;
  readonly #phases: PhaseConfig[];
  readonly #path: string;
  readonly #recordings: string;
  readonly #keepMs: number;
  readonly #log: ShadowLog;
  readonly #comparison = new Comparison();
  #watcher: ModelWatcher;
  #learnAt: number;
  #worker: Worker | undefined;
  readonly #correct: Correct | undefined;
  /** The runs over lately, each side's, not yet set against the other's. */
  #lately: { rules: ModelRun[]; model: ModelRun[] } = { rules: [], model: [] };

  constructor(device: string, phases: PhaseConfig[], dataPath: string, recordings: string, keepDays: number, log: ShadowLog, now = Date.now(), correct?: Correct) {
    this.#correct = correct;
    this.#device = device;
    this.#phases = modelPhases(phases);
    this.#path = join(dataPath, 'model', `${encodeURIComponent(device)}.json`);
    this.#recordings = recordings;
    this.#keepMs = keepDays * 86_400_000;
    this.#log = log;
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
  }

  /** A phase as the rules saw it. */
  rule(phase: string, change: PhaseChange): void {
    if (!this.#phases.some(({ name }) => name === phase)) {
      return;
    }
    const from = change.from ?? change.since;
    if (change.active && !change.short) {
      this.#comparison.opened(phase, from ?? change.at);
      return;
    }
    const until = change.until ?? change.at;
    if (from !== undefined && until >= from) {
      this.#comparison.rule({ phase, from, until });
      this.#lately.rules.push({ phase, from, until });
      this.#setAgainst();
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
      this.#comparison.model(run);
      this.#lately.model.push(run);
    }
    if (runs.length > 0) {
      this.#setAgainst();
    }
  }

  /**
   * Each run both sides have told, set against each other at once: where the
   * model would correct the rules, its length goes out after theirs, as a
   * coffee's that the heater hid the start of (10.11.2026: 21 s by the rules,
   * 25 by the model).
   */
  #setAgainst(): void {
    const seconds = (run: ModelRun) => Math.round((run.until - run.from) / 1000);
    for (const rule of [...this.#lately.rules]) {
      const run = this.#lately.model.find((each) => sameRun(each, rule));
      if (!run) {
        continue;
      }
      this.#lately.rules = this.#lately.rules.filter((each) => each !== rule);
      this.#lately.model = this.#lately.model.filter((each) => each !== run);
      if (this.#correct && seconds(run) !== seconds(rule) && this.#watcher.judge(rule.phase, rule, run).corrects) {
        this.#log.info(`${this.#device}: model correcting ${rule.phase}: ${seconds(run)} s, rules ${seconds(rule)} s`);
        this.#correct(rule.phase, (run.until - run.from) / 1000, (rule.until - rule.from) / 1000);
      }
    }
    const latest = Math.max(...this.#lately.rules.map(({ until }) => until), ...this.#lately.model.map(({ until }) => until));
    const kept = (run: ModelRun) => run.until >= latest - CORRECT_WITHIN_MS;
    this.#lately = { rules: this.#lately.rules.filter(kept), model: this.#lately.model.filter(kept) };
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
