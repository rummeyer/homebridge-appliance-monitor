import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { FINISHED, phaseKey, shownCount } from '../src/counts.ts';
import { DeviceStore } from '../src/store.ts';

const dir = mkdtempSync(join(tmpdir(), 'appliance-monitor-counts-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('with no phase ticked, the finished cycles are shown', () => {
  assert.deepEqual(shownCount([]), { key: FINISHED, label: 'Finished' });
  assert.deepEqual(shownCount([{ name: 'Heating', minWatts: 1000 }]), { key: FINISHED, label: 'Finished' });
});

test('a ticked phase is shown instead, the first if several are', () => {
  const phases = [
    { name: 'Aufheizen', minWatts: 1000 },
    { name: 'Bezug', minWatts: 30, maxWatts: 100, count: true },
    { name: 'Milchschaum', minWatts: 400, maxWatts: 700, count: true },
  ];
  assert.deepEqual(shownCount(phases), { key: phaseKey('Bezug'), label: 'Bezug' });
});

test('counts add up across restarts, each from when it began', () => {
  const path = join(dir, 'devices.json');
  const store = new DeviceStore(path);
  store.update('Coffee', { state: 'running', since: 5 });
  store.increment('Coffee', phaseKey('Bezug'), 100);
  store.increment('Coffee', phaseKey('Bezug'), 200);
  store.increment('Coffee', FINISHED, 300);

  const reloaded = new DeviceStore(path).get('Coffee');
  assert.deepEqual(reloaded.counts, {
    [phaseKey('Bezug')]: { count: 2, since: 100 },
    [FINISHED]: { count: 1, since: 300 },
  });
  assert.equal(reloaded.state, 'running', 'the rest of the record is left as it was');
});

test('forgetting what was learned keeps the counts', () => {
  const store = new DeviceStore(join(dir, 'forget.json'));
  store.increment('Washer', FINISHED, 1);
  store.forget('Washer');
  assert.equal(store.get('Washer').counts?.[FINISHED]?.count, 1);
});
