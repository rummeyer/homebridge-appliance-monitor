/**
 * The Curve tab's chart. It runs in the browser, so it is plain JavaScript;
 * here it is loaded the way the page loads it, as a script that sets
 * `window.OutletChart`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const S = 1000;
const MIN = 60 * S;

type Chart = {
  render(data: object): { svg: string; height: number; valueAt(at: number): number | null; timeOf(x: number): number; xOf(at: number): number };
  watts(value: number): string;
  timeMarks(from: number, to: number): { at: number; label: string }[];
};

const scope: { OutletChart?: Chart } = {};
new Function('window', readFileSync(new URL('../homebridge-ui/public/chart.js', import.meta.url), 'utf8'))(scope);
const chart = scope.OutletChart!;

const curve = {
  from: 0,
  to: 60 * MIN,
  points: [
    [0, 2],
    [10 * MIN, 1190],
    [20 * MIN, 2],
    [30 * MIN, 50],
  ],
  levels: [{ watts: 2, minWatts: 1.3, maxWatts: 4, seconds: 1800 }],
};

test('watts read as a person would say them', () => {
  assert.equal(chart.watts(2.36), '2.4 W');
  assert.equal(chart.watts(310.4), '310 W');
  assert.equal(chart.watts(1190), '1.2 kW');
});

test('the reading at a moment is the last one before it', () => {
  const { valueAt } = chart.render(curve);
  assert.equal(valueAt(5 * MIN), 2);
  assert.equal(valueAt(15 * MIN), 1190);
  assert.equal(valueAt(59 * MIN), 50);
});

test('a moment and its place on the chart go both ways', () => {
  const { xOf, timeOf } = chart.render(curve);
  assert.equal(Math.round(timeOf(xOf(25 * MIN))), 25 * MIN);
});

test('every phase gets a bar below, and a name from the config cannot inject markup', () => {
  const plain = chart.render(curve);
  const withPhases = chart.render({
    ...curve,
    phases: [
      { name: 'Heating', minWatts: 1000 },
      { name: '<script>x</script>', minWatts: 30, maxWatts: 100 },
    ],
    spans: [{ name: 'Heating', spans: [[10 * MIN, 20 * MIN]] }],
  });
  assert.equal(withPhases.height - plain.height, 46, 'two bars');
  assert.ok(!withPhases.svg.includes('<script>'), 'escaped');
  assert.ok(withPhases.svg.includes('&lt;script&gt;'));
  assert.ok(withPhases.svg.includes('data-level="0"'), 'the level is there to click');
});

test('time marks fall on whole minutes or hours, five to eight of them', () => {
  const from = new Date(2026, 9, 1, 8, 7, 30).getTime();
  const hour = chart.timeMarks(from, from + 60 * MIN);
  assert.ok(hour.length >= 5 && hour.length <= 8, `${hour.length} marks`);
  assert.ok(hour.every(({ at }) => new Date(at).getSeconds() === 0 && new Date(at).getMinutes() % 10 === 0));
  const day = chart.timeMarks(from, from + 24 * 60 * MIN);
  assert.ok(day.every(({ at }) => new Date(at).getMinutes() === 0), 'on the hour');
});
