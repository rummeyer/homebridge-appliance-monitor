/**
 * Backend for the plugin's settings page in the Homebridge UI.
 *
 * Serves the Statistics tab — the energy each plug used in the last complete
 * day, week, month and year — and the Power tab: a plug's recorded power
 * draw, the levels it dwells at, and a power range for a stretch picked on
 * it. All read from the files the plugin writes rather than asked of the
 * running plugin, which is a separate process this page has no line to.
 * Energy is written every five minutes, readings as they come.
 */
import { join } from 'node:path';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { bandFor, phaseSpans, thin } from '../dist/curve.js';
import { usablePhases } from '../dist/config.js';
import { shownCount } from '../dist/counts.js';
import { findDataDir } from '../dist/data-dir.js';
import { statistics } from '../dist/energy.js';
import { readJson } from '../dist/json-file.js';
import { findLevels } from '../dist/phases.js';
import { readSamples } from '../dist/recorder.js';
import { applyResets, pendingResets, requestReset } from '../dist/resets.js';

/** Points drawn across the chart: about two per pixel of a wide settings page. */
const CHART_BUCKETS = 600;
const MAX_HOURS = 24 * 14;
/** How long to wait for the plugin to do a reset, which it looks for every five seconds. */
const RESET_WAIT_MS = 8000;

class ApplianceMonitorUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/statistics', (request) => this.statistics(request));
    this.onRequest('/curve', (request) => this.curve(request));
    this.onRequest('/band', (request) => this.band(request));
    this.onRequest('/paired', () => this.paired());
    this.onRequest('/reset', (request) => this.reset(request));
    this.ready();
  }

  get powerDir() {
    return this.homebridgeStoragePath ? join(findDataDir(this.homebridgeStoragePath), 'power') : undefined;
  }

  /** A plug's last hours, thinned for drawing, the levels found in them, and when its phases were on. */
  async curve(request) {
    const name = String(request?.name ?? '');
    const hours = Math.min(Math.max(Number(request?.hours) || 24, 1), MAX_HOURS);
    const to = Date.now();
    const from = to - hours * 3_600_000;
    const samples = this.powerDir ? readSamples(this.powerDir, name, from, to) : [];
    // The phases come from the page, which has the settings as they are being
    // edited, unsaved ones included.
    const { phases } = usablePhases({ name, phases: Array.isArray(request?.phases) ? request.phases : [] });
    return {
      from,
      to,
      points: thin(samples, from, to, CHART_BUCKETS),
      levels: findLevels(samples, to),
      spans: phaseSpans(samples, from, to, phases),
    };
  }

  /** The names of the plugs that are paired, for a mark in the Settings tab's list. */
  async paired() {
    if (!this.homebridgeStoragePath) {
      return [];
    }
    try {
      return Object.keys(readJson(join(findDataDir(this.homebridgeStoragePath), 'nodes.json')) ?? {});
    } catch {
      return [];
    }
  }

  /** The power range for a stretch picked on the chart, or null if the plug drew nothing then. */
  async band(request) {
    const name = String(request?.name ?? '');
    const from = Number(request?.from);
    const to = Number(request?.to);
    if (!this.powerDir || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return null;
    }
    return bandFor(readSamples(this.powerDir, name, from, to), from, to) ?? null;
  }

  /**
   * Resets an appliance's energy and count. Asked of the plugin, which holds
   * them in memory; done here on the files if it does not answer, because it
   * is not running.
   */
  async reset(request) {
    const name = String(request?.name ?? '').trim();
    if (!name || !this.homebridgeStoragePath) {
      throw new RequestError('No such appliance', { status: 400 });
    }
    const dir = findDataDir(this.homebridgeStoragePath);
    requestReset(dir, name);
    for (const until = Date.now() + RESET_WAIT_MS; Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (pendingResets(dir).length === 0) {
        return { ok: true };
      }
    }
    applyResets(dir);
    return { ok: true };
  }

  /** The table for the plugs named, in the order the page lists them, with what each has counted. */
  async statistics(request) {
    const devices = Array.isArray(request?.devices)
      ? request.devices.filter((device) => typeof device?.name === 'string')
      : [];
    const names = devices.map(({ name }) => name);
    const dir = this.homebridgeStoragePath ? findDataDir(this.homebridgeStoragePath) : undefined;
    // A missing, half-written or damaged file shows as nothing counted yet.
    const read = (file) => {
      try {
        return (dir && readJson(join(dir, file))) || {};
      } catch {
        return {};
      }
    };
    const ledger = read('energy.json');
    const records = read('devices.json');
    // What each appliance counts follows the settings as they are being
    // edited, which the page sends along.
    const counts = devices.map((device) => {
      const { key, label } = shownCount(usablePhases(device).phases);
      const counted = records[device.name]?.counts?.[key];
      return { label, count: counted?.count ?? 0, since: counted?.since ?? null };
    });
    return { ...statistics(ledger, names, new Date()), counts };
  }
}

void new ApplianceMonitorUiServer();
