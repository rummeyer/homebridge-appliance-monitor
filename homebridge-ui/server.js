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
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { usablePhases } from '../dist/config.js';
import { dataDir } from '../dist/data-dir.js';
import { LEARNING_DEFAULTS, unlearnedRunWatts } from '../dist/monitor.js';
import { applyResets, pendingResets, requestReset } from '../dist/resets.js';
import { addRequest, dropRequest, takeAnswer } from '../dist/requests.js';
import { chartHours, curve, readData, statisticsTable } from '../dist/views.js';

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
    this.onRequest('/address', () => this.address());
    this.onRequest('/learned', () => this.learned());
    this.onRequest('/reset', (request) => this.reset(request));
    this.onRequest('/learn', (request) => this.learn(request));
    this.onRequest('/forget', (request) => this.forget(request));
    this.ready();
  }

  /** The plugin's folder in the Homebridge storage, if Homebridge said where that is. */
  get dataDir() {
    return this.homebridgeStoragePath ? dataDir(this.homebridgeStoragePath) : undefined;
  }

  /** One of the plugin's JSON files; a missing or damaged one reads as empty. */
  readData(file, empty = {}) {
    return readData(this.dataDir, file, empty);
  }

  /** A plug's last hours, thinned for drawing, the levels found in them, and when its phases were on. */
  async curve(request) {
    // The phases come from the page, which has the settings as they are being
    // edited, unsaved ones included.
    const name = String(request?.name ?? '');
    const { phases } = usablePhases({ name, phases: Array.isArray(request?.phases) ? request.phases : [] });
    return curve(this.dataDir, name, chartHours(request?.hours), phases);
  }

  /**
   * The thresholds each appliance uses unless the settings fix them, and
   * where each comes from — learned, found from standby, or the default —
   * for the Settings tab to show in its empty fields.
   */
  async learned() {
    const result = {};
    for (const [name, record] of Object.entries(this.readData('devices.json'))) {
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
          ? { value: unlearnedRunWatts(standby), from: 'standby' }
          : { value: LEARNING_DEFAULTS.runWatts, from: 'default' },
        startSeconds: { value: LEARNING_DEFAULTS.startSeconds, from: 'default' },
        finishSeconds: { value: LEARNING_DEFAULTS.finishSeconds, from: 'default' },
      };
    }
    return result;
  }

  /**
   * This machine's address on the network, for the link to the dashboard,
   * which the plugin serves here, as this backend runs beside it.
   *
   * The one its default route leaves from, which a UDP socket "connected"
   * outwards tells without sending anything — not the first of all of them,
   * which may be a Docker bridge. Without a route, the first IPv4 address.
   */
  async address() {
    const routed = await new Promise((resolve) => {
      const socket = createSocket('udp4');
      const done = (address) => {
        socket.close();
        resolve(address);
      };
      socket.on('error', () => done(undefined));
      socket.connect(53, '192.0.2.1', () => done(socket.address().address));
    });
    if (routed && routed !== '0.0.0.0') {
      return routed;
    }
    return Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address ?? null;
  }

  /** The names of the plugs that are paired, for a mark in the Settings tab's list. */
  async paired() {
    return Object.keys(this.readData('nodes.json'));
  }

  /**
   * Resets the energy, last cycle and count of the appliances named. Asked
   * of the plugin, which holds them in memory; done here on the files if it
   * does not answer, because it is not running.
   */
  async reset(request) {
    const asked = Array.isArray(request?.names) ? request.names : [request?.name];
    const names = asked.map((name) => String(name ?? '').trim()).filter(Boolean);
    const dir = this.dataDir;
    if (names.length === 0 || !dir) {
      throw new RequestError('No such appliance', { status: 400 });
    }
    for (const name of names) {
      requestReset(dir, name);
    }
    if (!(await waitFor(RESET_WAIT_MS, () => pendingResets(dir).length === 0))) {
      applyResets(dir);
    }
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
    const dir = this.dataDir;
    if (!dir) {
      throw new RequestError('No Homebridge storage folder', { status: 500 });
    }
    const id = randomUUID();
    addRequest(dir, { id, ...request });
    const result = await waitFor(ANSWER_WAIT_MS, () => takeAnswer(dir, id));
    if (!result) {
      dropRequest(dir, id);
      throw new RequestError('The plugin did not answer. Is its child bridge running?', { status: 504 });
    }
    if (!result.ok) {
      throw new RequestError(result.message, { status: 409 });
    }
    return result;
  }

  /**
   * The table for the plugs named, in the order the page lists them, with
   * what each has counted. What each counts follows the settings as they are
   * being edited, which the page sends along.
   */
  async statistics(request) {
    const devices = Array.isArray(request?.devices)
      ? request.devices.filter((device) => typeof device?.name === 'string')
      : [];
    return statisticsTable(this.dataDir, devices);
  }
}

/**
 * Looks every quarter second until `check` gives something, for at most `ms`;
 * what it gave, or undefined.
 */
async function waitFor(ms, check) {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = check();
    if (result) {
      return result;
    }
  }
  return undefined;
}

void new ApplianceMonitorUiServer();
