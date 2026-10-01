import type { CycleState } from './cycle.ts';
import { readJson, writeJson } from './json-file.ts';
import type { Counted } from './counts.ts';
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
  /** While running: what the cycle has used so far, so that a restart does not lose it. */
  cycleWattHours?: number;
  cyclePeakWatts?: number;
  /** Whether everything the plug offers has been logged, which is done once. */
  described?: boolean;
  /** Standby found before anything was learned. See DeviceMonitor. */
  standbyWatts?: number;
  /** Finished cycles and ended phases, counted. See counts.ts. */
  counts?: Record<string, Counted>;
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

  /** Counts one more of something, starting the count if it is the first. */
  increment(name: string, key: string, at: number): void {
    const counts = { ...this.get(name).counts };
    const current = counts[key];
    counts[key] = { count: (current?.count ?? 0) + 1, since: current?.since ?? at };
    this.update(name, { counts });
  }
}
