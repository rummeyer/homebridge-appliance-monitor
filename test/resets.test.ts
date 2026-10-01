/**
 * Resets asked for by the settings page, and done on the files when the
 * plugin is not running to do them.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readJson, writeJson } from '../src/json-file.ts';
import { applyResets, clearResets, pendingResets, requestReset } from '../src/resets.ts';

test('resets asked for are pending until cleared', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resets-'));
  assert.deepEqual(pendingResets(dir), []);
  requestReset(dir, 'Coffee');
  requestReset(dir, 'Coffee');
  requestReset(dir, 'Dryer');
  assert.deepEqual(pendingResets(dir), ['Coffee', 'Dryer']);
  clearResets(dir);
  assert.deepEqual(pendingResets(dir), []);
});

test('applied on the files, a reset drops energy and counts and keeps what was learned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resets-'));
  writeJson(join(dir, 'energy.json'), { Coffee: { since: 1, days: { '2026-10-01': 5 } }, Dryer: { since: 1, days: {} } });
  writeJson(join(dir, 'devices.json'), {
    Coffee: { cycles: 3, counts: { finished: { count: 2, since: 1 } } },
    Dryer: { counts: { finished: { count: 1, since: 1 } } },
  });
  requestReset(dir, 'Coffee');
  applyResets(dir);
  assert.deepEqual(readJson(join(dir, 'energy.json')), { Dryer: { since: 1, days: {} } });
  assert.deepEqual(readJson(join(dir, 'devices.json')), {
    Coffee: { cycles: 3 },
    Dryer: { counts: { finished: { count: 1, since: 1 } } },
  });
  assert.deepEqual(pendingResets(dir), []);
});
