import assert from 'node:assert/strict';
import test from 'node:test';

import { phaseSpans, sumSamples, thin } from '../src/curve.ts';
import type { Sample } from '../src/learn.ts';

const S = 1000;

test('a short curve is drawn as it is', () => {
  const samples: Sample[] = [
    { at: 0, watts: 2 },
    { at: 10 * S, watts: 300 },
  ];
  assert.deepEqual(thin(samples, 0, 60 * S, 100), [
    [0, 2],
    [10 * S, 300],
  ]);
});

test('thinning a long curve keeps a half-minute spike among a day of readings', () => {
  const samples: Sample[] = [];
  for (let second = 0; second < 86_400; second += 2) {
    samples.push({ at: second * S, watts: 2 + (second % 7) / 10 });
  }
  samples.push({ at: 43_201 * S, watts: 310 }); // a coffee at noon
  samples.sort((a, b) => a.at - b.at);

  const points = thin(samples, 0, 86_400 * S, 500);
  assert.ok(points.length <= 1000, `${points.length} points`);
  assert.ok(points.some(([, watts]) => watts === 310), 'the coffee is still there');
  assert.deepEqual(
    points.map(([at]) => at),
    [...points.map(([at]) => at)].sort((a, b) => a - b),
    'in time order',
  );
});

test('phase spans follow the phase rules, not every moment in range', () => {
  // A heater switched by a thermostat: on 4 s every 45 s, after a real heat-up.
  const samples: Sample[] = [{ at: 0, watts: 2 }, { at: 10 * S, watts: 1190 }, { at: 400 * S, watts: 2 }];
  for (let t = 450; t < 900; t += 45) {
    samples.push({ at: t * S, watts: 1195 }, { at: (t + 4) * S, watts: 2 });
  }
  const [heating] = phaseSpans(samples, 0, 1000 * S, [{ name: 'Heating', minWatts: 1000, minSeconds: 60, holdSeconds: 30 }]);
  assert.deepEqual(heating, { name: 'Heating', spans: [[70 * S, 430 * S]] }, 'the heat-up once; the pulses not at all');
});

test('plugs added up: each holds what it last said, 0 W before its first reading', () => {
  const total = sumSamples([
    [{ at: 1000, watts: 2 }, { at: 3000, watts: 2000 }],
    [{ at: 2000, watts: 0.1 }, { at: 3000, watts: 5 }, { at: 4000, watts: 0.2 }],
  ]);
  assert.deepEqual(total, [
    { at: 1000, watts: 2 },
    { at: 2000, watts: 2.1 },
    { at: 3000, watts: 2005 }, // two readings at once are one step
    { at: 4000, watts: 2000.2 },
  ]);
  assert.deepEqual(sumSamples([]), []);
});
