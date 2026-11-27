/**
 * A phase by sums, against the coffee machine's own readings: the pump's 52 W on top of the milk
 * frothing and the heater, whatever else switched at the same moment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sample } from '../src/learn.ts';
import { heldLevels, HindsightSums, ownStep, runsBySums, SUMS_DELAY_MS } from '../src/sums.ts';
import type { SumsEvent } from '../src/sums.ts';

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

const pump = { name: 'Pumpe', minWatts: 45, maxWatts: 100 };

/** The sums fed reading by reading, as the plugin does, what they tell by then each time. */
function play(sums: HindsightSums, readings: Sample[], until?: number): { at: number; event: SumsEvent }[] {
  const out: { at: number; event: SumsEvent }[] = [];
  for (const { at, watts } of readings) {
    sums.reading(at, watts);
    out.push(...sums.due(at).map((event) => ({ at, event })));
  }
  for (let at = readings.at(-1)!.at + 1000; until !== undefined && at <= until; at += 1000) {
    out.push(...sums.due(at).map((event) => ({ at, event })));
  }
  return out;
}

test('a run the rules told short is corrected, once the levels around it are known', () => {
  const sums = new HindsightSums([pump]);
  const at = (time: string) => Date.parse(`2026-11-25T${time}+01:00`);
  // As the rules had it: on from the second reading in, beside the milk.
  const before = coffee.filter((sample) => sample.at < at('08:28:17'));
  play(sums, before);
  sums.rulesStarted('Pumpe', at('08:28:15'));
  play(sums, coffee.filter((sample) => sample.at >= at('08:28:17')));
  // As the rules had it: 4 s, from where the draw came down from the heater.
  sums.rulesEnded('Pumpe', at('08:28:34'), at('08:28:38'), at('08:28:41'));
  assert.deepEqual(sums.due(at('08:28:42')).filter(({ kind }) => kind === 'end'), []);
  assert.deepEqual(sums.due(at('08:28:41') + SUMS_DELAY_MS), [{ kind: 'end', phase: 'Pumpe', seconds: 23, was: 4 }]);
  // Told once.
  assert.deepEqual(sums.due(at('08:29:00')), []);
});

test('a run the sums see as the rules did is left as it was', () => {
  const sums = new HindsightSums([pump]);
  const at = (time: string) => Date.parse(`2026-11-25T${time}+01:00`);
  play(sums, coffee.filter((sample) => sample.at < at('08:28:17')));
  sums.rulesStarted('Pumpe', at('08:28:15'));
  play(sums, coffee.filter((sample) => sample.at >= at('08:28:17')));
  sums.rulesEnded('Pumpe', at('08:28:15'), at('08:28:38'), at('08:28:41'));
  assert.deepEqual(sums.due(at('08:28:50')), []);
});

// 27.11.2026: the milk, a rinse, the heater; then the pump and the heater on together, the milk
// beside them a moment later, the pump off beneath them both (from 08:17:50). The rules never saw
// it: the clock showed nothing of a rinse of 10 s.
const rinseBeneathMilk = day('2026-11-27', [
  ['08:15:25', 729.9], ['08:15:26', 196.4], ['08:15:27', 469.8], ['08:15:29', 488.5], ['08:15:31', 488.7], ['08:15:32', 489.3],
  ['08:15:33', 489.5], ['08:15:34', 489.8], ['08:15:35', 489.5], ['08:15:36', 489.3], ['08:15:37', 489.2], ['08:15:38', 489.3],
  ['08:15:40', 586.2], ['08:15:41', 1643.6], ['08:15:42', 1708], ['08:15:43', 1708.2], ['08:15:44', 1707.8], ['08:15:45', 1707],
  ['08:15:46', 1706.5], ['08:15:47', 1322.4], ['08:15:48', 513.7], ['08:15:49', 503], ['08:15:50', 501.1], ['08:15:51', 489.5],
  ['08:15:52', 488.9], ['08:15:53', 488.7], ['08:15:54', 489], ['08:15:55', 488.9], ['08:15:56', 488.7], ['08:15:57', 489.2],
  ['08:15:58', 489.1], ['08:15:59', 489], ['08:16:00', 488.9], ['08:16:01', 489.1], ['08:16:03', 489.2], ['08:16:04', 489.1],
  ['08:16:05', 489.4], ['08:16:06', 489.6], ['08:16:07', 1132.1], ['08:16:08', 1709.6], ['08:16:09', 1712.9], ['08:16:10', 1711.1],
  ['08:16:11', 1709.4], ['08:16:12', 1587.1], ['08:16:13', 553.2], ['08:16:14', 502.9], ['08:16:15', 502.7], ['08:16:16', 502.6],
  ['08:16:19', 502.7], ['08:16:20', 502.5], ['08:16:21', 502.1], ['08:16:22', 502.3], ['08:16:23', 502.4], ['08:16:24', 502.2],
  ['08:16:25', 502.1], ['08:16:26', 501.9], ['08:16:27', 502.1], ['08:16:28', 502.3], ['08:16:29', 502], ['08:16:30', 502.3],
  ['08:16:31', 502.6], ['08:16:32', 502.3], ['08:16:33', 502.6], ['08:16:34', 503.4], ['08:16:35', 705], ['08:16:37', 1714.4],
  ['08:16:38', 1714.6], ['08:16:39', 1492.4], ['08:16:40', 1232.6], ['08:16:41', 1231.5], ['08:16:42', 407.7], ['08:16:43', 8.4],
  ['08:16:44', 8.3], ['08:16:45', 8.4], ['08:16:46', 8.3], ['08:16:47', 8.4], ['08:16:51', 26], ['08:16:52', 63.5],
  ['08:16:53', 63.8], ['08:16:55', 63.5], ['08:16:56', 60.8], ['08:16:57', 1231], ['08:16:58', 1287.2], ['08:16:59', 1284.7],
  ['08:17:00', 1281.5], ['08:17:01', 1278.5], ['08:17:02', 1278.6], ['08:17:03', 1225.7], ['08:17:04', 1225.1], ['08:17:05', 1225.2],
  ['08:17:07', 1224.2], ['08:17:08', 1223.2], ['08:17:09', 1223.3], ['08:17:10', 1223.1], ['08:17:11', 1222.5], ['08:17:12', 1222.2],
  ['08:17:13', 1221.6], ['08:17:14', 1018.3], ['08:17:15', 4.9], ['08:17:16', 4.7], ['08:17:17', 4.8], ['08:17:19', 4.7],
  ['08:17:20', 4.8], ['08:17:21', 4.6], ['08:17:22', 4.7], ['08:17:23', 4.9], ['08:17:24', 5], ['08:17:25', 15.8],
  ['08:17:26', 1093], ['08:17:27', 1232.3], ['08:17:28', 1229.2], ['08:17:29', 1228.1], ['08:17:30', 1226.8], ['08:17:31', 1226],
  ['08:17:32', 1111], ['08:17:33', 59.2], ['08:17:34', 4.7], ['08:17:35', 5.1], ['08:17:36', 4.7], ['08:17:38', 4.6],
  ['08:17:39', 5], ['08:17:40', 4.6], ['08:17:41', 4.7], ['08:17:42', 5], ['08:17:43', 4.7], ['08:17:44', 4.8],
  ['08:17:45', 5.1], ['08:17:46', 4.7], ['08:17:47', 5.2], ['08:17:48', 8.1], ['08:17:49', 7.6], ['08:17:50', 977.4],
  ['08:17:51', 1236.6], ['08:17:52', 1289.3], ['08:17:53', 1755.9], ['08:17:54', 1764.6], ['08:17:55', 1764.8], ['08:17:56', 1764.4],
  ['08:17:57', 1734.8], ['08:17:58', 673.7], ['08:17:59', 562.9], ['08:18:00', 549.1], ['08:18:01', 548.7], ['08:18:02', 985.2],
  ['08:18:03', 1744.3], ['08:18:04', 1711.7], ['08:18:05', 1711.1], ['08:18:06', 1711.2], ['08:18:07', 1710.7], ['08:18:08', 1710.2],
  ['08:18:09', 1710.1], ['08:18:10', 1708.6], ['08:18:12', 1707.5], ['08:18:14', 1707.4], ['08:18:15', 974.9], ['08:18:16', 510.3],
  ['08:18:17', 501.3], ['08:18:18', 497.8], ['08:18:19', 498.3], ['08:18:20', 498.5],
]);

test('a run the rules never see is started by sums once its level is held beside the milk, and ended', () => {
  const sums = new HindsightSums([pump]);
  const told = play(sums, rinseBeneathMilk);
  const at = (time: string) => Date.parse(`2026-11-27T${time}+01:00`);
  const rinse = told.filter(({ at: when }) => when >= at('08:17:50'));
  assert.equal(rinse[0]!.event.kind, 'start');
  assert.ok(rinse[0]!.at <= at('08:17:55'), new Date(rinse[0]!.at).toISOString());
  const end = rinse.find(({ event }) => event.kind === 'end')!;
  assert.deepEqual(end.event, { kind: 'end', phase: 'Pumpe', seconds: 10 });
  assert.equal(rinse.length, 2);
  assert.ok(!sums.holdsStart('Pumpe'));
});

test('a run the rules take on after the sums started it is theirs to end', () => {
  const sums = new HindsightSums([pump]);
  const at = (time: string) => Date.parse(`2026-11-27T${time}+01:00`);
  const rinse = day('2026-11-27', [['08:16:50', 8.4], ['08:16:51', 8.3], ['08:16:52', 63.5], ['08:16:53', 63.8]]);
  const told = play(sums, rinse);
  assert.deepEqual(told.map(({ event }) => event), [{ kind: 'start', phase: 'Pumpe', seconds: 1 }]);
  sums.rulesStarted('Pumpe', at('08:16:52'));
  assert.ok(sums.holdsStart('Pumpe'));
  const after = play(sums, day('2026-11-27', [['08:16:55', 63.5], ['08:17:03', 63.4], ['08:17:04', 8.3], ['08:17:05', 8.4]]));
  sums.rulesEnded('Pumpe', at('08:16:52'), at('08:17:04'), at('08:17:07'));
  assert.ok(!sums.holdsStart('Pumpe'));
  assert.deepEqual([...after, ...play(sums, day('2026-11-27', [['08:17:20', 8.3]]), at('08:17:30'))].map(({ event }) => event), []);
});

test('a run the rules never saw, over before the sums could start it, is told at once', () => {
  // The levels beneath only known afterwards: the sums see it on only in hindsight.
  const sums = new HindsightSums([pump]);
  const at = (time: string) => Date.parse(`2026-11-27T${time}+01:00`);
  const readings = day('2026-11-27', [
    ['08:20:00', 5], ['08:20:01', 5], ['08:20:02', 1290], ['08:20:03', 1289], ['08:20:04', 1288], ['08:20:05', 1288], ['08:20:06', 1287],
    ['08:20:07', 1287], ['08:20:08', 1286], ['08:20:09', 1232], ['08:20:10', 1231], ['08:20:11', 1231], ['08:20:12', 1230], ['08:20:13', 5], ['08:20:14', 5],
  ]);
  const told = play(sums, readings, at('08:20:30'));
  sums.reading(at('08:20:31'), 5);
  const ends = told.filter(({ event }) => event.kind === 'end').map(({ event }) => event);
  assert.deepEqual(ends, [{ kind: 'end', phase: 'Pumpe', seconds: 7, missed: true }]);
});
