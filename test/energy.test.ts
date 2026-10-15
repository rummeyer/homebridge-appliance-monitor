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

import { EnergyMeter, lastPeriods, periodTotal, standbyUse, statistics } from '../src/energy.ts';
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

test('the periods are today so far, and the last complete Monday-to-Sunday week, month and year', () => {
  const periods = lastPeriods(new Date(local('2026-10-07T15:30:00'))); // a Wednesday
  const shown = periods.map(({ kind, label, dates, start, end }) => [
    kind,
    label,
    dates,
    start.toDateString(),
    end.toDateString(),
  ]);
  assert.deepEqual(shown, [
    ['day', 'Today', '7 Oct 2026', 'Wed Oct 07 2026', 'Thu Oct 08 2026'],
    ['week', 'Last Week', '28 Sept – 4 Oct 2026', 'Mon Sep 28 2026', 'Mon Oct 05 2026'],
    ['month', 'Last Month', 'September 2026', 'Tue Sep 01 2026', 'Thu Oct 01 2026'],
    ['year', 'Last Year', '2025', 'Wed Jan 01 2025', 'Thu Jan 01 2026'],
  ]);
});

test('on a Monday, last week is the one that ended last night', () => {
  const [, week] = lastPeriods(new Date(local('2026-10-05T08:00:00')));
  assert.equal(week!.start.toDateString(), 'Mon Sep 28 2026');
  assert.equal(week!.end.toDateString(), 'Mon Oct 05 2026');
});

test('a period is shown only if it was counted from its first moment', () => {
  const [today] = lastPeriods(new Date(local('2026-10-02T12:00:00')));
  const energy = (since: string): DeviceEnergy => ({
    since: local(since),
    days: { '2026-09-30': 100, '2026-10-01': 500, '2026-10-02': 50 },
  });
  assert.equal(periodTotal(energy('2026-10-02T08:00:00'), today!), undefined, 'started this morning');
  assert.equal(periodTotal(energy('2026-10-02T00:00:00'), today!), 50, 'from midnight is from the start');
  assert.equal(periodTotal(energy('2026-09-15T00:00:00'), today!), 50, 'so far today');
});

test('the table has a row per plug, and a total of what is there', () => {
  const now = new Date(local('2026-10-07T12:00:00'));
  const ledger: Record<string, DeviceEnergy> = {
    Washer: { since: local('2026-09-01T00:00:00'), days: { '2026-09-10': 1200, '2026-10-06': 800, '2026-10-07': 300 } },
    Dryer: { since: local('2026-10-06T09:00:00'), days: { '2026-10-06': 2000 } },
    Lamp: { since: local('2026-10-07T11:00:00'), days: { '2026-10-07': 12 } },
  };
  const table = statistics(ledger, ['Washer', 'Dryer', 'Lamp', 'Desk'], now);

  assert.deepEqual(
    table.periods.map(({ label }) => label),
    ['Today', 'Last Week', 'Last Month', 'Last Year'],
  );
  const none = [false, false, false, false];
  assert.deepEqual(table.rows, [
    { name: 'Washer', values: [300, 0, 1200, null], partial: none, standby: null },
    { name: 'Dryer', values: [0, null, null, null], partial: none, standby: null }, // counted all of today, used nothing yet
    { name: 'Lamp', values: [12, null, null, null], partial: none, standby: null }, // added this morning: today from then
    { name: 'Desk', values: [null, null, null, null], partial: none, standby: null },
  ]);
  assert.deepEqual(table.total, {
    values: [312, 0, 1200, null],
    missing: [true, true, true, true],
    partial: none,
    standby: null,
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
  assert.equal(after.periods[3]!.dates, '2026');
  assert.deepEqual(after.rows[0], {
    name: 'Washer',
    values: [0, 0, 400, 500], // nothing yet today, a week with nothing used, December, part of 2026
    partial: [false, false, false, true],
    standby: null,
  });
  assert.deepEqual(after.rows[1]!.values, [null, null, null, null], 'a plug added after the year has none of it');
  assert.deepEqual(after.total.partial, [false, false, false, true]);
  assert.deepEqual(after.total.values[3], 500);
});

test('a week or a month the plug joined partway through is shown from then, marked as part', () => {
  const ledger: Record<string, DeviceEnergy> = {
    Washer: { since: local('2026-09-30T20:00:00'), days: { '2026-09-30': 100, '2026-10-01': 500, '2026-10-05': 7 } },
    Socket: { since: local('2026-10-02T08:00:00'), days: { '2026-10-02': 30 } },
  };
  const table = statistics(ledger, ['Washer', 'Socket'], new Date(local('2026-10-05T09:00:00')));

  assert.deepEqual(table.rows, [
    { name: 'Washer', values: [7, 600, 100, null], partial: [false, true, true, false], standby: null },
    { name: 'Socket', values: [0, 30, null, null], partial: [false, true, false, false], standby: null },
  ]);
  assert.deepEqual(table.total, {
    values: [7, 630, 100, null],
    missing: [false, false, true, true],
    partial: [false, true, true, false],
    standby: null,
  });
});

test('old days are dropped, recent ones kept', () => {
  const meter = new EnergyMeter({ since: 1, days: { '2024-01-01': 5, '2026-01-01': 7 } });
  meter.prune(local('2026-10-01T00:00:00'));
  assert.deepEqual(meter.record.days, { '2026-01-01': 7 });
});

test('a reset empties the days, and counts on from then', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-10-01T10:00:00'), 100);
  meter.tick(local('2026-10-01T12:00:00'));
  meter.reset(local('2026-10-01T12:00:00'));
  assert.deepEqual(meter.record.days, {});
  assert.equal(meter.record.since, local('2026-10-01T12:00:00'));
  meter.tick(local('2026-10-01T13:00:00'));
  assert.deepEqual(meter.record.days, { '2026-10-01': 100 });
});

test('an appliance that is part of another keeps its row but stays out of the total', () => {
  const ledger: Record<string, DeviceEnergy> = {
    Desk: { since: local('2026-10-01T00:00:00'), days: { '2026-10-05': 40 } },
    Lamp: { since: local('2026-10-05T08:00:00'), days: { '2026-10-05': 10 } },
  };
  const table = statistics(ledger, [{ name: 'Desk' }, { name: 'Lamp', partOf: 'Desk' }], new Date(local('2026-10-05T09:00:00')));

  assert.deepEqual(table.rows[1], {
    name: 'Lamp',
    values: [10, null, null, null],
    partial: [false, false, false, false],
    standby: null,
    partOf: 'Desk',
  });
  assert.equal(table.total.values[0], 40, 'the lamp is in the desk already');
  assert.deepEqual(table.total.missing, [false, false, true, true], 'the lamp having no week is no gap in the total');
});

test('what is used while the appliance is not running is counted as standby too', () => {
  const meter = new EnergyMeter();
  meter.reading(local('2026-10-01T08:00:00'), 10);
  assert.equal(meter.record.standby, undefined, 'not before the state is known');
  meter.running(local('2026-10-01T09:00:00'), false);
  assert.equal(meter.record.standbySince, local('2026-10-01T09:00:00'));
  meter.reading(local('2026-10-01T10:00:00'), 2000);
  meter.running(local('2026-10-01T10:00:00'), true);
  meter.reading(local('2026-10-01T11:00:00'), 10);
  meter.running(local('2026-10-01T11:30:00'), false);
  meter.tick(local('2026-10-01T12:30:00'));
  // 10 Wh from 9 to 10, then running until 11:30, then 10 Wh more.
  assert.deepEqual(meter.record.standby, { '2026-10-01': 20 });
  assert.equal(meter.record.days['2026-10-01'], 10 + 10 + 2000 + 5 + 10);
});

test('standby survives a restart, and a reset starts it again', () => {
  const meter = new EnergyMeter({
    since: 1,
    days: { '2026-10-01': 50 },
    standby: { '2026-10-01': 20 },
    standbySince: local('2026-10-01T09:00:00'),
  });
  assert.deepEqual(meter.record.standby, { '2026-10-01': 20 });
  meter.reading(local('2026-10-01T12:00:00'), 5);
  meter.running(local('2026-10-01T12:00:00'), false);
  meter.reset(local('2026-10-01T13:00:00'));
  assert.deepEqual(meter.record.standby, {});
  assert.equal(meter.record.standbySince, local('2026-10-01T13:00:00'));
});

test('standby is worked out over the last 30 days, or since it began, as a share and a year', () => {
  const energy: DeviceEnergy = {
    since: local('2026-09-01T00:00:00'),
    days: { '2026-09-01': 999, '2026-10-06': 300, '2026-10-07': 100 },
    standby: { '2026-10-06': 200, '2026-10-07': 40 },
    standbySince: local('2026-10-06T00:00:00'),
  };
  const now = new Date(local('2026-10-08T00:00:00'));
  assert.deepEqual(standbyUse(energy, now), { wattHours: 240, totalWattHours: 400, ms: 48 * H });

  const table = statistics({ Desk: energy }, ['Desk'], now);
  assert.equal(table.rows[0]!.standby!.share, 0.6);
  // 240 Wh in two days is 120 Wh a day.
  assert.equal(Math.round(table.rows[0]!.standby!.yearWattHours), Math.round(120 * 365.25));
  assert.deepEqual(table.total.standby, table.rows[0]!.standby);

  const late = new Date(local('2026-11-20T00:00:00'));
  assert.equal(standbyUse(energy, late)!.wattHours, 0, 'days older than 30 are left out');
  assert.equal(standbyUse(energy, new Date(local('2026-10-06T00:30:00'))), null, 'half an hour says nothing about a year');
  assert.equal(standbyUse({ since: 1, days: {} }, now), null, 'a file from before 1.7.0');
});
