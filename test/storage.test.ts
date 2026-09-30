import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { csvLine, PowerRecorder } from '../src/recorder.ts';
import { NodeRegistry } from '../src/registry.ts';

const dir = mkdtempSync(join(tmpdir(), 'outlet-monitor-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('node IDs survive a restart at full 64-bit width', () => {
  const path = join(dir, 'sub', 'nodes.json');
  const big = 0xfedcba9876543210n;
  new NodeRegistry(path).set('Washer', big);

  const reloaded = new NodeRegistry(path);
  assert.equal(reloaded.get('Washer'), big);
  reloaded.delete('Washer');
  assert.equal(new NodeRegistry(path).get('Washer'), undefined);
});

test('a missing registry file is an empty registry', () => {
  assert.deepEqual(new NodeRegistry(join(dir, 'nope.json')).entries(), []);
});

test('the recording has a header once and one line per reading', () => {
  const path = join(dir, 'power.csv');
  const at = new Date('2026-09-30T12:00:00Z');
  new PowerRecorder(path).record('Washer', 1, 2.15, at);
  new PowerRecorder(path).record('Washer', 2, undefined, at);

  assert.equal(
    readFileSync(path, 'utf8'),
    'time,device,endpoint,watts\n' +
      '2026-09-30T12:00:00.000Z,Washer,1,2.15\n' +
      '2026-09-30T12:00:00.000Z,Washer,2,\n',
  );
});

test('a name with a comma or quote does not break the columns', () => {
  const at = new Date(0);
  assert.equal(csvLine(at, 'Bad, "oben"', 1, 1), '1970-01-01T00:00:00.000Z,"Bad, ""oben""",1,1\n');
});
