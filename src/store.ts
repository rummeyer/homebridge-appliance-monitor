import type { CycleState } from './cycle.ts';
import { readJson, writeJson } from './json-file.ts';
import type { Learned } from './learn.ts';

/** What is kept per appliance across restarts. */
export interface DeviceRecord {
  /** What its cycles have taught, if any have been seen. */
  learned?: Learned;
  /** How many cycles that is from. */
  cycles?: number;
  /** Where it was, so that "finished" survives Homebridge restarting. */
  state?: CycleState;
  since?: number;
}

/**
 * Per-appliance memory, keyed by the name in config.json.
 *
 * Kept apart from the config on purpose: Homebridge owns config.json, and a
 * plugin writing to it races the settings page.
 */
export class DeviceStore {
  readonly #path: string;
  readonly #records: Record<string, DeviceRecord>;

  constructor(path: string) {
    this.#path = path;
    const data = readJson(path);
    this.#records = data !== null && typeof data === 'object' ? (data as Record<string, DeviceRecord>) : {};
  }

  get(name: string): DeviceRecord {
    return this.#records[name] ?? {};
  }

  update(name: string, change: Partial<DeviceRecord>): void {
    this.#records[name] = { ...this.get(name), ...change };
    writeJson(this.#path, this.#records);
  }

  /** Forgets what was learned, so the next cycle is learned afresh. */
  forget(name: string): void {
    const { state, since } = this.get(name);
    this.#records[name] = { state, since };
    writeJson(this.#path, this.#records);
  }
}
