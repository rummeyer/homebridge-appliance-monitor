import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVE_POWER, activePowerWatts, ELECTRICAL_POWER_MEASUREMENT, formatWatts, isActivePower } from '../src/power.ts';

test('only ActivePower of Electrical Power Measurement is a power reading', () => {
  assert.equal(isActivePower(ELECTRICAL_POWER_MEASUREMENT, ACTIVE_POWER), true);
  assert.equal(isActivePower(ELECTRICAL_POWER_MEASUREMENT, 0x0004), false, 'Voltage');
  assert.equal(isActivePower(0x0006, 0x0000), false, 'OnOff');
});

test('ActivePower is in milliwatts, as number or as int64 bigint', () => {
  assert.equal(activePowerWatts(2150), 2.15);
  assert.equal(activePowerWatts(2_000_000n), 2000);
  assert.equal(activePowerWatts(0), 0);
});

test('a null ActivePower is a report without a reading, not zero watts', () => {
  assert.equal(activePowerWatts(null), undefined);
  assert.equal(activePowerWatts(Number.NaN), undefined);
});

test('watts are shown with sensible precision', () => {
  assert.equal(formatWatts(0.4), '0.40 W');
  assert.equal(formatWatts(2150.04), '2150.0 W');
  assert.equal(formatWatts(undefined), 'no reading');
});
