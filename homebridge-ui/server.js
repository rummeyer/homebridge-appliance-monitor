/**
 * Backend for the plugin's settings page in the Homebridge UI.
 *
 * Serves the Statistics tab: the energy each plug used in the last complete
 * day, week, month and year. Read from the file the plugin writes rather
 * than asked of the running plugin, which is a separate process this page
 * has no line to. The plugin writes every five minutes, so the numbers can
 * trail by that much — which matters only for a period that ended just now.
 */
import { join } from 'node:path';

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import { statistics } from '../dist/energy.js';
import { readJson } from '../dist/json-file.js';

class OutletMonitorUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/statistics', (request) => this.statistics(request));
    this.ready();
  }

  /** The table for the plugs named, in the order the page lists them. */
  async statistics(request) {
    const names = Array.isArray(request?.names) ? request.names.filter((name) => typeof name === 'string') : [];
    const dir = this.homebridgeStoragePath;
    let ledger = {};
    if (dir) {
      try {
        ledger = readJson(join(dir, 'outlet-monitor', 'energy.json')) ?? {};
      } catch {
        // A half-written or damaged file shows as nothing counted yet.
      }
    }
    return statistics(ledger, names, new Date());
  }
}

void new OutletMonitorUiServer();
