/**
 * Backend for the plugin's settings page in the Homebridge UI.
 *
 * Serves the Statistics tab — the energy each plug used in the last complete
 * day, week, month and year — and the Power tab: a plug's recorded power
 * draw and the levels it dwells at. All read from the files the plugin
 * writes rather than asked of the running plugin, which is a separate
 * process this page has no line to; what only it can do (learning,
 * forgetting) is asked of it through files too, see requests.ts. Energy is
 * written every five minutes, readings as they come.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { phaseSpans, thin } from '../dist/curve.js';
import { usablePhases } from '../dist/config.js';
import { shownCount } from '../dist/counts.js';
import { findDataDir } from '../dist/data-dir.js';
import { statistics } from '../dist/energy.js';
import { readJson } from '../dist/json-file.js';
import { runLevelAbove } from '../dist/learn.js';
import { LEARNING_DEFAULTS } from '../dist/monitor.js';
import { findLevels } from '../dist/phases.js';
import { readSamples } from '../dist/recorder.js';
import { applyResets, pendingResets, requestReset } from '../dist/resets.js';
import { addRequest, dropRequest, takeAnswer } from '../dist/requests.js';

/** Points drawn across the chart: about two per pixel of a wide settings page. */
const CHART_BUCKETS = 600;
const MAX_HOURS = 24 * 14;
/** How long to wait for the plugin to do a reset, which it looks for every five seconds. */
const RESET_WAIT_MS = 8000;
/** How long to wait for it to answer a request, which it also looks for every five seconds. */
const ANSWER_WAIT_MS = 12_000;

class ApplianceMonitorUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/statistics', (request) => this.statistics(request));
    this.onRequest('/curve', (request) => this.curve(request));
    this.onRequest('/paired', () => this.paired());
    this.onRequest('/learned', () => this.learned());
    this.onRequest('/reset', (request) => this.reset(request));
    this.onRequest('/learn', (request) => this.learn(request));
    this.onRequest('/forget', (request) => this.forget(request));
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

  /**
   * The thresholds each appliance uses unless the settings fix them, and
   * where each comes from — learned, found from standby, or the default —
   * for the Settings tab to show in its empty fields.
   */
  async learned() {
    if (!this.homebridgeStoragePath) {
      return {};
    }
    let records;
    try {
      records = readJson(join(findDataDir(this.homebridgeStoragePath), 'devices.json')) ?? {};
    } catch {
      return {};
    }
    const result = {};
    for (const [name, record] of Object.entries(records)) {
      const learned = record?.learned?.params;
      if (learned) {
        result[name] = {
          cycles: record.cycles ?? 1,
          runWatts: { value: learned.runWatts, from: 'learned' },
          startSeconds: { value: learned.startSeconds, from: 'default' },
          finishSeconds: { value: learned.finishSeconds, from: 'learned' },
        };
        continue;
      }
      const standby = record?.standbyWatts;
      result[name] = {
        cycles: 0,
        standbyWatts: standby ?? null,
        runWatts: typeof standby === 'number'
          ? { value: Math.max(LEARNING_DEFAULTS.runWatts, runLevelAbove(standby)), from: 'standby' }
          : { value: LEARNING_DEFAULTS.runWatts, from: 'default' },
        startSeconds: { value: LEARNING_DEFAULTS.startSeconds, from: 'default' },
        finishSeconds: { value: LEARNING_DEFAULTS.finishSeconds, from: 'default' },
      };
    }
    return result;
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

  /**
   * Resets the energy, last cycle and count of the appliances named. Asked
   * of the plugin, which holds them in memory; done here on the files if it
   * does not answer, because it is not running.
   */
  async reset(request) {
    const asked = Array.isArray(request?.names) ? request.names : [request?.name];
    const names = asked.map((name) => String(name ?? '').trim()).filter(Boolean);
    if (names.length === 0 || !this.homebridgeStoragePath) {
      throw new RequestError('No such appliance', { status: 400 });
    }
    const dir = findDataDir(this.homebridgeStoragePath);
    for (const name of names) {
      requestReset(dir, name);
    }
    for (const until = Date.now() + RESET_WAIT_MS; Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (pendingResets(dir).length === 0) {
        return { ok: true };
      }
    }
    applyResets(dir);
    return { ok: true };
  }

  /** Learns from a stretch marked on the Power tab as one cycle of the appliance. */
  async learn(request) {
    const name = String(request?.name ?? '').trim();
    const from = Number(request?.from);
    const to = Number(request?.to);
    if (!name || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new RequestError('Mark a stretch of the chart first', { status: 400 });
    }
    return this.ask({ name, action: 'learn', from: Math.round(from), to: Math.round(to) });
  }

  /** Forgets what an appliance has learned. */
  async forget(request) {
    const name = String(request?.name ?? '').trim();
    if (!name) {
      throw new RequestError('No such appliance', { status: 400 });
    }
    return this.ask({ name, action: 'forget' });
  }

  /**
   * Asks the running plugin and waits for its answer; see requests.ts. Only
   * it can do these, as it holds what was learned in memory.
   */
  async ask(request) {
    if (!this.homebridgeStoragePath) {
      throw new RequestError('No Homebridge storage folder', { status: 500 });
    }
    const dir = findDataDir(this.homebridgeStoragePath);
    const id = randomUUID();
    addRequest(dir, { id, ...request });
    for (const until = Date.now() + ANSWER_WAIT_MS; Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = takeAnswer(dir, id);
      if (result) {
        if (!result.ok) {
          throw new RequestError(result.message, { status: 409 });
        }
        return result;
      }
    }
    dropRequest(dir, id);
    throw new RequestError('The plugin did not answer. Is its child bridge running?', { status: 504 });
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
    const lastCycles = devices.map((device) => records[device.name]?.lastCycle ?? null);
    return { ...statistics(ledger, names, new Date()), counts, lastCycles };
  }
}

void new ApplianceMonitorUiServer();
