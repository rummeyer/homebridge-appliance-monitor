/**
 * A read-only page for a browser on the home network: what each appliance
 * draws now, its power over the last hours, and the statistics. Without the
 * Homebridge login, so nothing here changes anything — it only answers GET,
 * and has nothing that writes.
 *
 * Served by the plugin itself rather than the settings page's backend, which
 * only runs while the Homebridge UI shows the settings; and the plugin knows
 * the live state, which the files say only after a while.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { DeviceConfig } from './config.ts';
import type { CycleProgress, CycleState } from './cycle.ts';
import { chartHours, curve, statisticsTable } from './views.ts';

/** What one appliance is doing right now. */
export interface LiveAppliance {
  name: string;
  /** Whether the plug is paired and set up here. */
  paired: boolean;
  /** Whether it is connected; unknown until the first connect. */
  reachable?: boolean;
  watts?: number;
  /** When the last reading came, in ms. */
  at?: number;
  state?: CycleState;
  /** Since when it is in that state, in ms. */
  since?: number;
  /** The phases it is in. */
  phases: string[];
  /** What the running cycle has used so far. */
  cycle?: CycleProgress;
}

export interface DashboardSource {
  /** The plugin's folder in the Homebridge storage. */
  dataPath: string;
  /** The appliances, in the order the settings list them. */
  devices(): DeviceConfig[];
  live(): LiveAppliance[];
}

const read = (path: string): Buffer => readFileSync(new URL(`../${path}`, import.meta.url));

/** The page's files, read when asked for: a few kilobytes, and seldom. */
const FILES: Record<string, { type: string; path: string }> = {
  '/': { type: 'text/html; charset=utf-8', path: 'web/index.html' },
  '/dashboard.js': { type: 'text/javascript; charset=utf-8', path: 'web/dashboard.js' },
  '/theme.js': { type: 'text/javascript; charset=utf-8', path: 'web/theme.js' },
  // The settings page's own, so both show the same.
  '/chart.js': { type: 'text/javascript; charset=utf-8', path: 'homebridge-ui/public/chart.js' },
  '/shared.js': { type: 'text/javascript; charset=utf-8', path: 'homebridge-ui/public/shared.js' },
  '/icon.png': { type: 'image/png', path: 'web/icon.png' },
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Its own scripts only; the chart's styles are put in by script.
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

export class Dashboard {
  readonly #source: DashboardSource;
  readonly #server: Server;

  constructor(source: DashboardSource) {
    this.#source = source;
    this.#server = createServer((request, response) => this.#handle(request, response));
  }

  /** Starts listening on every interface; fails if the port is taken. */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(port, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  /** The port it listens on, once it does. */
  get port(): number | undefined {
    const address = this.#server.address();
    return typeof address === 'object' && address ? address.port : undefined;
  }

  close(): void {
    this.#server.close();
    this.#server.closeAllConnections();
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Read only', { Allow: 'GET, HEAD' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://dashboard');
    try {
      const file = FILES[url.pathname];
      if (file) {
        send(response, 200, file.type, read(file.path));
        return;
      }
      const data = this.#data(url);
      if (data === undefined) {
        send(response, 404, 'text/plain; charset=utf-8', 'Not found');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(data));
    } catch {
      send(response, 500, 'text/plain; charset=utf-8', 'Could not read the data');
    }
  }

  #data(url: URL): unknown {
    const devices = this.#source.devices();
    switch (url.pathname) {
      case '/api/live':
        return { at: Date.now(), appliances: this.#source.live() };
      case '/api/statistics':
        return statisticsTable(this.#source.dataPath, devices);
      case '/api/curve': {
        // Only a configured appliance: the name goes on to a file name.
        const device = devices.find(({ name }) => name === url.searchParams.get('name'));
        if (!device) {
          return undefined;
        }
        const phases = device.phases ?? [];
        // No levels: they are for making phases, which is not done here.
        return { ...curve(this.#source.dataPath, device.name, chartHours(url.searchParams.get('hours')), phases), levels: [], phases };
      }
      default:
        return undefined;
    }
  }
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
  response.writeHead(status, { ...HEADERS, ...extra, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  response.end(response.req.method === 'HEAD' ? undefined : body);
}
