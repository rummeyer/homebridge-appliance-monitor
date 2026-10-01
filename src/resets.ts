/**
 * Resetting an appliance's statistics from the settings page.
 *
 * The page runs in a process of its own, and the plugin keeps the energy and
 * the counts in memory and writes them over the files as it goes; a page
 * that changed the files itself would be undone a few minutes later. So the
 * page asks, in a file of its own, and the plugin does it and removes the
 * file. When the plugin is not running, nobody would, and the page does it
 * on the files itself.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { readJson, writeJson } from './json-file.ts';

const RESETS_FILE = 'resets.json';

const resetsPath = (dir: string): string => join(dir, RESETS_FILE);

/** The appliances whose statistics are to be reset, if any have been asked for. */
export function pendingResets(dir: string): string[] {
  try {
    const data = readJson(resetsPath(dir));
    return Array.isArray(data) ? data.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

/** Asks for an appliance's statistics to be reset. */
export function requestReset(dir: string, name: string): void {
  const names = new Set(pendingResets(dir));
  names.add(name);
  writeJson(resetsPath(dir), [...names]);
}

/** Says the resets asked for have been done. */
export function clearResets(dir: string): void {
  rmSync(resetsPath(dir), { force: true });
}

/** Does the resets asked for on the files, for when the plugin is not running to do them. */
export function applyResets(dir: string): void {
  const names = pendingResets(dir);
  const edit = (file: string, change: (records: Record<string, Record<string, unknown>>) => void) => {
    const path = join(dir, file);
    const records = readJson(path);
    if (records !== null && typeof records === 'object') {
      change(records as Record<string, Record<string, unknown>>);
      writeJson(path, records);
    }
  };
  edit('energy.json', (ledger) => {
    for (const name of names) {
      delete ledger[name];
    }
  });
  edit('devices.json', (records) => {
    for (const name of names) {
      delete records[name]?.counts;
      delete records[name]?.lastCycle;
    }
  });
  clearResets(dir);
}
