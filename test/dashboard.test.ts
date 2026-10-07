/**
 * The dashboard: shows what the plugin knows, and changes nothing.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { usableDashboardPort } from '../src/config.ts';
import { Dashboard } from '../src/dashboard.ts';
import type { LiveAppliance } from '../src/dashboard.ts';
import { PowerRecorder } from '../src/recorder.ts';

const dir = mkdtempSync(join(tmpdir(), 'appliance-monitor-dashboard-'));
const live: LiveAppliance[] = [
  { name: 'Washer', paired: true, reachable: true, watts: 1980, state: 'running', since: Date.now() - 600_000, phases: ['Heating'] },
];
const dashboard = new Dashboard({
  dataPath: dir,
  devices: () => [{ name: 'Washer', phases: [{ name: 'Heating', minWatts: 1500 }] }],
  live: () => live,
});
let base = '';

before(async () => {
  const recorder = new PowerRecorder(join(dir, 'power'));
  recorder.record('Washer', 1, 2, new Date(Date.now() - 20 * 60_000));
  recorder.record('Washer', 1, 1980, new Date(Date.now() - 10 * 60_000));
  writeFileSync(join(dir, 'devices.json'), JSON.stringify({ Washer: { counts: { finished: { count: 3, since: 0 } } } }));
  await dashboard.listen(0); // any free port
  base = `http://localhost:${dashboard.port}`;
});
after(() => {
  dashboard.close();
  rmSync(dir, { recursive: true, force: true });
});

test('the page and what it loads are served', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/dashboard.js', 'text/javascript'], ['/theme.js', 'text/javascript'], ['/chart.js', 'text/javascript'], ['/shared.js', 'text/javascript'], ['/icon.png', 'image/png']]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', new RegExp(`^${type}`), path);
  }
});

test('what an appliance does now', async () => {
  const body = await (await fetch(`${base}/api/live`)).json();
  assert.deepEqual(body.appliances, live);
});

test('its power, without the levels the settings page makes phases from', async () => {
  const body = await (await fetch(`${base}/api/curve?name=Washer&hours=1`)).json();
  assert.ok(body.points.length >= 1);
  assert.deepEqual(body.levels, []);
  assert.equal(body.phases[0].name, 'Heating');
});

test('only the power of a configured appliance', async () => {
  assert.equal((await fetch(`${base}/api/curve?name=..%2F..%2Fetc`)).status, 404);
});

test('the statistics, with what each counts', async () => {
  const body = await (await fetch(`${base}/api/statistics`)).json();
  assert.equal(body.rows[0].name, 'Washer');
  assert.deepEqual(body.counts[0], { label: 'Finished', count: 3, since: 0 });
});

test('nothing can be changed', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const response = await fetch(`${base}/api/statistics`, { method });
    assert.equal(response.status, 405, method);
  }
  assert.equal((await fetch(`${base}/config.json`)).status, 404);
});

test('a port that is no port means no dashboard, and says so', () => {
  assert.deepEqual(usableDashboardPort({ platform: 'x' }), { port: undefined });
  assert.deepEqual(usableDashboardPort({ platform: 'x', dashboardPort: 8582 }), { port: 8582 });
  for (const wrong of [0, 70000, 80.5, '8582']) {
    const { port, problem } = usableDashboardPort({ platform: 'x', dashboardPort: wrong as number });
    assert.equal(port, undefined);
    assert.ok(problem);
  }
});
