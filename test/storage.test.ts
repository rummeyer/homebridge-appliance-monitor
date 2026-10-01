process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { findDataDir, takeDataDir } from '../src/data-dir.ts';
import { csvLine, parseLine, PowerRecorder, readSamples } from '../src/recorder.ts';
import { NodeRegistry } from '../src/registry.ts';

const dir = mkdtempSync(join(tmpdir(), 'appliance-monitor-'));
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

test('the recording is a file per local day, with a header once', () => {
  const power = join(dir, 'power-days');
  const recorder = new PowerRecorder(power);
  recorder.record('Washer', 1, 2.15, new Date('2026-09-30T21:59:00Z')); // 23:59 in Berlin
  recorder.record('Washer', 2, undefined, new Date('2026-09-30T22:01:00Z')); // 00:01 the next day
  new PowerRecorder(power).record('Washer', 1, 3, new Date('2026-09-30T22:02:00Z'));

  assert.deepEqual(readdirSync(power).sort(), ['2026-09-30.csv', '2026-10-01.csv']);
  assert.equal(
    readFileSync(join(power, '2026-10-01.csv'), 'utf8'),
    'time,device,endpoint,watts\n' +
      '2026-09-30T22:01:00.000Z,Washer,2,\n' +
      '2026-09-30T22:02:00.000Z,Washer,1,3\n',
  );
});

test('days older than kept are deleted when a new day starts', () => {
  const power = join(dir, 'power-prune');
  const recorder = new PowerRecorder(power, 3);
  for (const day of ['2026-09-01', '2026-09-27', '2026-09-28', 'notes']) {
    writeFileSync(join(power, day.includes('-') ? `${day}.csv` : day), '');
  }
  recorder.record('Washer', 1, 1, new Date('2026-09-30T10:00:00Z'));
  assert.deepEqual(readdirSync(power).sort(), ['2026-09-28.csv', '2026-09-30.csv', 'notes']);
});

test("a device's readings come back in order, starting with the one in effect", () => {
  const power = join(dir, 'power-read');
  const recorder = new PowerRecorder(power);
  const at = (text: string) => new Date(text);
  recorder.record('Coffee', 2, 2.5, at('2026-09-30T20:00:00Z'));
  recorder.record('Bad, "oben"', 1, 99, at('2026-09-30T23:00:00Z'));
  recorder.record('Coffee', 2, 1000, at('2026-10-01T05:00:00Z'));
  recorder.record('Coffee', 2, undefined, at('2026-10-01T05:00:30Z'));
  recorder.record('Coffee', 2, 3, at('2026-10-01T05:01:00Z'));

  const from = Date.parse('2026-10-01T04:00:00Z');
  const to = Date.parse('2026-10-01T06:00:00Z');
  assert.deepEqual(readSamples(power, 'Coffee', from, to), [
    { at: from, watts: 2.5 },
    { at: Date.parse('2026-10-01T05:00:00Z'), watts: 1000 },
    { at: Date.parse('2026-10-01T05:01:00Z'), watts: 3 },
  ]);
  assert.deepEqual(readSamples(power, 'Bad, "oben"', 0, to), [{ at: Date.parse('2026-09-30T23:00:00Z'), watts: 99 }]);
  assert.deepEqual(readSamples(join(dir, 'nothing-here'), 'Coffee', from, to), []);
});

test('lines read back as written, and anything else is skipped', () => {
  const at = new Date('2026-10-01T05:00:00Z');
  assert.deepEqual(parseLine(csvLine(at, 'Bad, "oben"', 1, 2.5).trimEnd()), {
    at: at.getTime(),
    device: 'Bad, "oben"',
    endpoint: 1,
    watts: 2.5,
  });
  assert.equal(parseLine('time,device,endpoint,watts'), undefined);
  assert.equal(parseLine(''), undefined);
  assert.equal(parseLine('garbage'), undefined);
});

test('a name with a comma or quote does not break the columns', () => {
  const at = new Date(0);
  assert.equal(csvLine(at, 'Bad, "oben"', 1, 1), '1970-01-01T00:00:00.000Z,"Bad, ""oben""",1,1\n');
});

test('a setup from before the plugin was named keeps its folder, moved to the new name', () => {
  const storage = join(dir, 'storage-earlier');
  mkdirSync(join(storage, 'outlet-monitor', 'matter'), { recursive: true });
  writeFileSync(join(storage, 'outlet-monitor', 'nodes.json'), '{"Washer":"1"}');

  assert.equal(findDataDir(storage), join(storage, 'outlet-monitor'), 'the settings page looks where it is');
  assert.equal(takeDataDir(storage), join(storage, 'appliance-monitor'));
  assert.equal(readFileSync(join(storage, 'appliance-monitor', 'nodes.json'), 'utf8'), '{"Washer":"1"}');
  assert.equal(existsSync(join(storage, 'outlet-monitor')), false);
  assert.equal(findDataDir(storage), join(storage, 'appliance-monitor'), 'and after the move, where it went');
});

test('a new setup gets the new folder, and an existing one is left alone', () => {
  const storage = join(dir, 'storage-new');
  mkdirSync(storage, { recursive: true });
  assert.equal(takeDataDir(storage), join(storage, 'appliance-monitor'));

  mkdirSync(join(storage, 'appliance-monitor'), { recursive: true });
  mkdirSync(join(storage, 'outlet-monitor'), { recursive: true });
  takeDataDir(storage);
  assert.ok(existsSync(join(storage, 'outlet-monitor')), 'not moved over a folder that is already there');
});
