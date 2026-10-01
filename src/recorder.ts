import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { dayKey } from './energy.ts';
import type { Sample } from './learn.ts';

const HEADER = 'time,device,endpoint,watts\n';
const FILE = /^(\d{4}-\d{2}-\d{2})\.csv$/;

export const DEFAULT_RECORD_DAYS = 14;

/**
 * Appends power readings to CSV files, one line per report and one file per
 * local day, and deletes the files older than it keeps.
 *
 * One file per day rather than one growing file: with every plug in the
 * house reporting, that one file would fill an SD card in time. Two weeks is
 * plenty for the Power tab of the settings page, which reads them back.
 *
 * Synchronous on purpose: a plug reports at most every few seconds, and a line
 * that is on disk the moment it is logged survives Homebridge being stopped
 * halfway through a wash cycle.
 */
export class PowerRecorder {
  readonly #dir: string;
  readonly #keepDays: number;
  #today: string | undefined;

  constructor(dir: string, keepDays = DEFAULT_RECORD_DAYS) {
    this.#dir = dir;
    this.#keepDays = keepDays;
    mkdirSync(dir, { recursive: true });
  }

  get dir(): string {
    return this.#dir;
  }

  record(device: string, endpoint: number, watts: number | undefined, at = new Date()): void {
    const day = dayKey(at);
    const path = join(this.#dir, `${day}.csv`);
    if (day !== this.#today) {
      this.#today = day;
      if (!existsSync(path)) {
        appendFileSync(path, HEADER);
      }
      this.#prune(at);
    }
    appendFileSync(path, csvLine(at, device, endpoint, watts));
  }

  #prune(now: Date): void {
    const oldest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.#keepDays + 1));
    for (const name of readdirSync(this.#dir)) {
      const day = FILE.exec(name)?.[1];
      if (day !== undefined && day < oldest) {
        rmSync(join(this.#dir, name), { force: true });
      }
    }
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

/**
 * One device's readings between two moments, read back from the day files.
 *
 * Starts with the last reading before `from`, if there is one, moved to
 * `from`: readings are a step function, and without it a curve would begin
 * blank until the plug next reported a change. Readings without a value are
 * left out.
 */
export function readSamples(dir: string, device: string, from: number, to: number): Sample[] {
  const first = dayKey(new Date(from - 86_400_000));
  const last = dayKey(new Date(to));
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((name) => {
        const day = FILE.exec(name)?.[1];
        return day !== undefined && day >= first && day <= last;
      })
      .sort();
  } catch {
    return [];
  }

  let before: Sample | undefined;
  const samples: Sample[] = [];
  for (const name of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const row = parseLine(line);
      if (!row || row.device !== device || row.watts === undefined) {
        continue;
      }
      if (row.at < from) {
        before = { at: row.at, watts: row.watts };
      } else if (row.at <= to) {
        samples.push({ at: row.at, watts: row.watts });
      }
    }
  }
  samples.sort((a, b) => a.at - b.at);
  if (before && (samples.length === 0 || samples[0]!.at > from)) {
    samples.unshift({ at: from, watts: before.watts });
  }
  return samples;
}

/** A line as csvLine writes it, or undefined for the header or anything else. */
export function parseLine(line: string): { at: number; device: string; endpoint: number; watts: number | undefined } | undefined {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.replace(/\r$/, ''));
  if (fields.length !== 4) {
    return undefined;
  }
  const at = Date.parse(fields[0]!);
  const endpoint = Number(fields[2]);
  if (Number.isNaN(at) || !Number.isInteger(endpoint)) {
    return undefined;
  }
  const watts = fields[3] === '' ? undefined : Number(fields[3]);
  return { at, device: fields[1]!, endpoint, watts: watts !== undefined && Number.isFinite(watts) ? watts : undefined };
}
