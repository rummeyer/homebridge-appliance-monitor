import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** The plugin's folder in Homebridge's storage folder. */
export const DATA_DIR = 'appliance-monitor';

/**
 * What the folder was called before the plugin was named, while it was being
 * tried out as homebridge-outlet-monitor. A setup from then has its pairings
 * and what it learned there.
 */
const EARLIER_DATA_DIR = 'outlet-monitor';

/**
 * The plugin's folder, moved from its earlier name if that is all there is.
 * For the plugin itself, which owns the folder.
 */
export function takeDataDir(storagePath: string): string {
  const path = join(storagePath, DATA_DIR);
  const earlier = join(storagePath, EARLIER_DATA_DIR);
  if (!existsSync(path) && existsSync(earlier)) {
    try {
      renameSync(earlier, path);
    } catch {
      // Not movable (permissions, say): carry on in the folder as it is.
      return earlier;
    }
  }
  return path;
}

/**
 * The plugin's folder as it is now, without moving anything. For the
 * settings page, which may be opened before the plugin has started under its
 * new name.
 */
export function findDataDir(storagePath: string): string {
  const path = join(storagePath, DATA_DIR);
  const earlier = join(storagePath, EARLIER_DATA_DIR);
  return !existsSync(path) && existsSync(earlier) ? earlier : path;
}
