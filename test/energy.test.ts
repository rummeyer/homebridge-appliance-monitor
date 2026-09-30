/**
 * Energy per day and the settings page's table.
 *
 * Days are local, so the tests pin a time zone — one with summer time, to
 * catch a day that is 25 hours long. `node --test` runs each file in its own
 * process, and nothing has read the zone before this line.
 */
process.env.TZ = 'Europe/Berlin';

import assert from 'node:assert/strict';
import test from 'node:test';

import { EnergyMeter, lastPeriods, periodTotal, statistics } from '../src/energy.ts';
import type { DeviceEnergy } from '../src/energy.ts';

const H = 3_600_000;
const local = (text: string) => new Date(text).getTime(); // no Z: local time

test('a constant load between two readings is counted, split at midnight', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-09-30T22:00:00'), 100);
  meter.reading(local('2026-10-01T03:00:00'), 0);
  assert.deepEqual(meter.record.days, { '2026-09-30': 200, '2026-10-01': 300 });
  assert.equal(meter.record.since, local('2026-09-30T22:00:00'));
});

test('ticks count a quiet plug, which sends nothing while its draw does not change', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-10-01T10:00:00'), 19.5);
  meter.tick(local('2026-10-01T12:00:00'));
  assert.equal(meter.record.days['2026-10-01'], 39);
  meter.tick(local('2026-10-01T12:00:00'));
  assert.equal(meter.record.days['2026-10-01'], 39, 'the same moment twice is counted once');
});

test('the night summer time ends has 25 hours, and all of them are counted', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-10-25T00:00:00'), 100);
  meter.tick(local('2026-10-26T00:00:00'));
  assert.equal(meter.record.days['2026-10-25'], 2500);
});

test('no reading is no power: nothing is counted until the next one', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-10-01T10:00:00'), 50);
  meter.reading(local('2026-10-01T11:00:00'), undefined);
  meter.tick(local('2026-10-01T15:00:00'));
  assert.equal(meter.record.days['2026-10-01'], 50);
});

test('the periods are the last complete day, Monday-to-Sunday week, month and year', () => {
  const periods = lastPeriods(new Date(local('2026-10-07T15:30:00'))); // a Wednesday
  const shown = periods.map(({ kind, label, start, end }) => [
    kind,
    label,
    start.toDateString(),
    end.toDateString(),
  ]);
  assert.deepEqual(shown, [
    ['day', 'Yesterday', 'Tue Oct 06 2026', 'Wed Oct 07 2026'],
    ['week', 'Last week', 'Mon Sep 28 2026', 'Mon Oct 05 2026'],
    ['month', 'September 2026', 'Tue Sep 01 2026', 'Thu Oct 01 2026'],
    ['year', '2025', 'Wed Jan 01 2025', 'Thu Jan 01 2026'],
  ]);
});

test('on a Monday, last week is the one that ended last night', () => {
  const [, week] = lastPeriods(new Date(local('2026-10-05T08:00:00')));
  assert.equal(week!.start.toDateString(), 'Mon Sep 28 2026');
  assert.equal(week!.end.toDateString(), 'Mon Oct 05 2026');
});

test('a period is shown only if it was counted from its first moment', () => {
  const [day] = lastPeriods(new Date(local('2026-10-02T12:00:00')));
  const energy = (since: string): DeviceEnergy => ({
    since: local(since),
    days: { '2026-09-30': 100, '2026-10-01': 500, '2026-10-02': 50 },
  });
  assert.equal(periodTotal(energy('2026-10-01T19:46:00'), day!), undefined, 'started that evening');
  assert.equal(periodTotal(energy('2026-10-01T00:00:00'), day!), 500, 'from midnight is from the start');
  assert.equal(periodTotal(energy('2026-09-15T00:00:00'), day!), 500);
});

test('the table has a row per plug, and a total of what is there', () => {
  const now = new Date(local('2026-10-07T12:00:00'));
  const ledger: Record<string, DeviceEnergy> = {
    Washer: { since: local('2026-09-01T00:00:00'), days: { '2026-09-10': 1200, '2026-10-06': 800 } },
    Dryer: { since: local('2026-10-06T09:00:00'), days: { '2026-10-06': 2000 } },
  };
  const table = statistics(ledger, ['Washer', 'Dryer', 'Desk'], now);

  assert.deepEqual(
    table.periods.map(({ label }) => label),
    ['Yesterday', 'Last week', 'September 2026', '2025'],
  );
  const none = [false, false, false, false];
  assert.deepEqual(table.rows, [
    { name: 'Washer', values: [800, 0, 1200, null], partial: none },
    { name: 'Dryer', values: [null, null, null, null], partial: none },
    { name: 'Desk', values: [null, null, null, null], partial: none },
  ]);
  assert.deepEqual(table.total, {
    values: [800, 0, 1200, null],
    missing: [true, true, true, true],
    partial: none,
  });
});

test('a year the plug joined partway through is shown once it is over, marked as part', () => {
  const ledger: Record<string, DeviceEnergy> = {
    Washer: { since: local('2026-09-30T19:46:00'), days: { '2026-09-30': 100, '2026-12-31': 400, '2027-01-01': 9 } },
    Dryer: { since: local('2027-03-01T10:00:00'), days: { '2027-03-01': 50 } },
  };

  const during = statistics(ledger, ['Washer'], new Date(local('2026-12-31T12:00:00')));
  assert.equal(during.rows[0]!.values[3], null, 'not while 2026 is still going');

  const after = statistics(ledger, ['Washer', 'Dryer'], new Date(local('2027-01-02T08:00:00')));
  assert.equal(after.periods[3]!.label, '2026');
  assert.deepEqual(after.rows[0], {
    name: 'Washer',
    values: [9, 0, 400, 500], // December, and a week with nothing used
    partial: [false, false, false, true],
  });
  assert.deepEqual(after.rows[1]!.values, [null, null, null, null], 'a plug added after the year has none of it');
  assert.deepEqual(after.total.partial, [false, false, false, true]);
  assert.deepEqual(after.total.values[3], 500);
});

test('old days are dropped, recent ones kept', () => {
  const meter = new EnergyMeter({ since: 1, days: { '2024-01-01': 5, '2026-01-01': 7 } });
  meter.prune(local('2026-10-01T00:00:00'));
  assert.deepEqual(meter.record.days, { '2026-01-01': 7 });
});
