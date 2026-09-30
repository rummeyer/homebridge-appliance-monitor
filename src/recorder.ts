import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HEADER = 'time,device,endpoint,watts\n';

/**
 * Appends power readings to a CSV file, one line per report.
 *
 * Synchronous on purpose: a plug reports at most every few seconds, and a line
 * that is on disk the moment it is logged survives Homebridge being stopped
 * halfway through a wash cycle.
 */
export class PowerRecorder {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      appendFileSync(path, HEADER);
    }
  }

  get path(): string {
    return this.#path;
  }

  record(device: string, endpoint: number, watts: number | undefined, at = new Date()): void {
    appendFileSync(this.#path, csvLine(at, device, endpoint, watts));
  }
}

/**
 * The endpoint is part of every line because a device with more than one
 * channel — a Shelly 2PM, a power strip — measures each on its own endpoint.
 */
export function csvLine(at: Date, device: string, endpoint: number, watts: number | undefined): string {
  return `${at.toISOString()},${csvField(device)},${endpoint},${watts ?? ''}\n`;
}

/** Quotes a field only when it has to be. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
