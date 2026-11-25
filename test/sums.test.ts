/**
 * A phase by sums, against the coffee machine's own readings: the pump's 52 W on top of the milk
 * frothing and the heater, whatever else switched at the same moment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { heldLevels, HindsightSums, ownStep, runsBySums, SUMS_DELAY_MS } from '../src/sums.ts';

const day = (date: string, readings: [string, number][]): Sample[] =>
  readings.map(([time, watts]) => ({ at: Date.parse(`${date}T${time}+01:00`), watts }));
const seconds = (runs: { from: number; until: number }[]) => runs.map(({ from, until }) => (until - from) / 1000);

// 25.11.2026: a rinse as the milk started, then a coffee of 23 s beside the milk and the heater.
// The rules saw a rinse of 6 s and one of 4.
const coffee = day('2026-11-25', [
  ['08:27:28', 1.9], ['08:27:31', 860.7], ['08:27:32', 1227.8], ['08:27:33', 1225.9], ['08:27:34', 1224.2], ['08:27:35', 914.6],
  ['08:27:36', 19], ['08:27:37', 1.9], ['08:27:41', 1.8], ['08:27:48', 2.8], ['08:27:49', 5.8], ['08:27:50', 8.1],
  ['08:27:51', 7.6], ['08:27:52', 7.3], ['08:27:53', 30.3], ['08:27:54', 319.4], ['08:27:55', 530], ['08:27:57', 546.3],
  ['08:27:58', 547.1], ['08:27:59', 801.7], ['08:28:00', 1754], ['08:28:01', 1761.7], ['08:28:02', 1760.7], ['08:28:03', 1757.6],
  ['08:28:04', 1756.7], ['08:28:05', 1730.7], ['08:28:06', 1704.3], ['08:28:07', 1703.1], ['08:28:08', 1702.7], ['08:28:09', 1702.3],
  ['08:28:10', 1702.6], ['08:28:11', 1703.8], ['08:28:13', 1453.1], ['08:28:14', 507], ['08:28:15', 552.2], ['08:28:16', 554.3],
  ['08:28:17', 554.6], ['08:28:18', 554.9], ['08:28:19', 555.3], ['08:28:20', 555.2], ['08:28:21', 1758.6], ['08:28:22', 1760.3],
  ['08:28:23', 1758.6], ['08:28:24', 1755.5], ['08:28:25', 1755.7], ['08:28:26', 1755.5], ['08:28:27', 1755], ['08:28:28', 1754.8],
  ['08:28:29', 1755.4], ['08:28:31', 1757.3], ['08:28:32', 1757.1], ['08:28:33', 1757.7], ['08:28:34', 1598.4], ['08:28:35', 566.7],
  ['08:28:36', 554.7], ['08:28:37', 553], ['08:28:38', 510.9], ['08:28:39', 501.8], ['08:28:40', 501.4], ['08:28:42', 501.8],
  ['08:28:43', 1266], ['08:28:44', 1705.4],
]);

test('the pump on top of the milk and the heater, by sums: a rinse, then the coffee of 23 s', () => {
  assert.deepEqual(seconds(runsBySums(coffee, 52)), [9, 23]);
});

test("the pump's step, from its own steps beside the milk and the heater", () => {
  const step = ownStep(heldLevels(coffee), 45, 100)!;
  assert.ok(step > 50 && step < 56, String(step));
});

test("the pump's step from rest, before any beside something else", () => {
  const rinse = day('2026-11-25', [['09:00:00', 2], ['09:00:01', 2.1], ['09:00:02', 57], ['09:00:03', 56.5], ['09:00:04', 56.8], ['09:00:09', 2]]);
  assert.equal(Math.round(ownStep(heldLevels(rinse), 45, 100)!), 55);
});

// 17.11.2026: the pump on beside the milk, the heater coming on with it, off beneath it, the heater
// going off as the readings so far end: its moment on the way down is no level beneath.
test('a single reading on the way down is no level the pump stood on', () => {
  const rinse = day('2026-11-17', [
    ['08:17:42', 228.5], ['08:17:43', 468.9], ['08:17:44', 478.1], ['08:17:45', 488.6], ['08:17:46', 489.3], ['08:17:48', 489.7],
    ['08:17:51', 489.7], ['08:17:52', 544.3], ['08:17:53', 544.6], ['08:17:55', 544.1], ['08:17:56', 1087.2], ['08:17:57', 1740],
    ['08:17:58', 1747.5], ['08:17:59', 1752.9], ['08:18:01', 1748.2], ['08:18:02', 1717.7], ['08:18:03', 1694.7], ['08:18:05', 1694.2],
    ['08:18:07', 1691.8], ['08:18:09', 1690.5], ['08:18:10', 1653.7],
  ]);
  assert.deepEqual(seconds(runsBySums(rinse, 54)), [11]);
});

test('a run the rules told short is corrected, once the levels around it are known', () => {
  const sums = new HindsightSums();
  for (const { at, watts } of coffee) {
    sums.reading(at, watts);
  }
  const at = (time: string) => Date.parse(`2026-11-25T${time}+01:00`);
  const pump = { name: 'Pumpe', minWatts: 45, maxWatts: 100 };
  // As the rules had it: 4 s, from where the draw came down from the heater.
  sums.ended(pump, at('08:28:34'), at('08:28:38'), at('08:28:41'));
  assert.deepEqual(sums.due(at('08:28:42')), []);
  assert.deepEqual(sums.due(at('08:28:41') + SUMS_DELAY_MS), [{ phase: 'Pumpe', seconds: 23, was: 4 }]);
  // Told once.
  assert.deepEqual(sums.due(at('08:29:00')), []);
});

test('a run the sums see as the rules did is left as it was', () => {
  const sums = new HindsightSums();
  for (const { at, watts } of coffee) {
    sums.reading(at, watts);
  }
  const at = (time: string) => Date.parse(`2026-11-25T${time}+01:00`);
  sums.ended({ name: 'Pumpe', minWatts: 45, maxWatts: 100 }, at('08:28:15'), at('08:28:38'), at('08:28:41'));
  assert.deepEqual(sums.due(at('08:28:50')), []);
});
