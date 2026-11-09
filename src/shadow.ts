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
import { Comparison, describeParams, fits, initialParams, modelPhases, ModelWatcher } from './model.ts';
import type { Compared, ModelParams, ModelRun } from './model.ts';
import type { LearnRequest } from './model-worker.ts';
import type { PhaseChange, PhaseConfig } from './phases.ts';

/** How often it learns again. */
const LEARN_EVERY_MS = 24 * 3_600_000;
/** How long after starting it first learns, with nothing saved: Homebridge has enough to do then. */
const FIRST_LEARN_MS = 2 * 60_000;

export interface ShadowLog {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
}

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

  constructor(device: string, phases: PhaseConfig[], dataPath: string, recordings: string, keepDays: number, log: ShadowLog, now = Date.now()) {
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
    if (!this.#phases.some(({ name }) => name === phase) || (change.active && !change.short)) {
      return;
    }
    const from = change.from ?? change.since;
    if (from !== undefined) {
      this.#comparison.rule({ phase, from, until: change.until ?? change.at });
    }
  }

  tick(at: number): void {
    this.#told(this.#watcher.tick(at));
    for (const compared of this.#comparison.settle(at)) {
      const line = `${this.#device}: model watching, ${describe(compared)}`;
      if (compared.agree) {
        this.#log.debug(line);
      } else {
        this.#log.info(line);
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
    }
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

/** "Bezug 08:28:53: rules 23 s, model 27 s". */
export function describe({ phase, at, rules, model }: Compared): string {
  return `${phase} ${clock(at)}: rules ${lasted(rules)}, model ${lasted(model)}`;
}
