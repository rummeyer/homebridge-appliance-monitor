import { join } from 'node:path';

/** The plugin's folder in Homebridge's storage folder. */
export const DATA_DIR = 'appliance-monitor';

/** Where the plugin keeps its files, in Homebridge's storage folder `storagePath`. */
export const dataDir = (storagePath: string): string => join(storagePath, DATA_DIR);
