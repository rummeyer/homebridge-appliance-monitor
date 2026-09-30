import assert from 'node:assert/strict';
import test from 'node:test';

import { duplicateNames, hasSensors, isChildBridgeProcess, parsePairingCode, validateDeviceConfig } from '../src/config.ts';

// The CHIP test device's codes: discriminator 3840, passcode 20202021.
const MANUAL = '34970112332';
const QR = 'MT:Y.K90-Q000KA0648G00';

test('reads the eleven-digit code the Home app shows, however it is typed', () => {
  const expected = { passcode: 20202021, identifier: { shortDiscriminator: 15 } };
  assert.deepEqual(parsePairingCode(MANUAL), expected);
  assert.deepEqual(parsePairingCode('3497-011-2332'), expected);
  assert.deepEqual(parsePairingCode(' 3497 011 2332 '), expected);
});

test('reads a QR payload, which carries the full discriminator', () => {
  assert.deepEqual(parsePairingCode(QR), { passcode: 20202021, identifier: { longDiscriminator: 3840 } });
  assert.deepEqual(parsePairingCode(QR.toLowerCase()), parsePairingCode(QR));
});

test('a typo is caught by the check digit', () => {
  assert.equal(parsePairingCode('34970112333'), undefined);
  assert.equal(parsePairingCode('1234-567-8901'), undefined);
});

test('anything that is not a code is refused rather than thrown', () => {
  for (const code of ['', 'abc', '3497011233', 'MT:', 'MT:garbage']) {
    assert.equal(parsePairingCode(code), undefined, code);
  }
});

test('a device needs a name; a code is optional but has to be valid', () => {
  assert.deepEqual(validateDeviceConfig({ name: 'Washer' }, 0), []);
  assert.deepEqual(validateDeviceConfig({ name: 'Washer', pairingCode: '' }, 0), []);
  assert.deepEqual(validateDeviceConfig({ name: 'Washer', pairingCode: MANUAL }, 0), []);
  assert.equal(validateDeviceConfig({ name: ' ' }, 2).length, 1);
  assert.match(validateDeviceConfig({ name: 'Washer', pairingCode: '123' }, 0)[0]!, /"Washer".*pairing code/);
  assert.match(validateDeviceConfig(null, 3)[0]!, /devices\[3\]/);
});

test('duplicate names are reported once each', () => {
  const devices = [{ name: 'A' }, { name: 'B' }, { name: 'A' }, { name: 'A' }];
  assert.deepEqual(duplicateNames(devices), ['A']);
});

test('a child bridge is recognised by the title Homebridge gives its process', () => {
  assert.equal(isChildBridgeProcess('homebridge: homebridge-outlet-monitor'), true);
  assert.equal(isChildBridgeProcess('homebridge: child bridge'), true, 'before the plugin is known');
  assert.equal(isChildBridgeProcess('homebridge'), false);
  assert.equal(isChildBridgeProcess('node'), false);
});

test('phases need a name, once each, and a range that goes up', () => {
  const problems = (phases: unknown) => validateDeviceConfig({ name: 'Coffee', phases }, 0);
  assert.deepEqual(problems([{ name: 'Heating', minWatts: 700, maxWatts: 1400 }]), []);
  assert.deepEqual(problems([{ name: 'Heating', minWatts: 700, maxWatts: 1400, minSeconds: 3, holdSeconds: 20 }]), []);
  assert.match(problems([{ name: '', minWatts: 1, maxWatts: 2 }])[0]!, /phase 1 has no name/);
  assert.match(
    problems([
      { name: 'Heating', minWatts: 700, maxWatts: 1400 },
      { name: 'Heating', minWatts: 1, maxWatts: 2 },
    ])[0]!,
    /"Heating" is there twice/,
  );
  assert.match(problems([{ name: 'Brewing', minWatts: 400, maxWatts: 200 }])[0]!, /"Brewing" needs a power range/);
  assert.match(problems([{ name: 'Brewing', minWatts: 200, maxWatts: 400, holdSeconds: -1 }])[0]!, /holdSeconds/);
  assert.match(problems('Heating')[0]!, /not a list/);
});

test('a plug shows something in HomeKit unless every sensor is off', () => {
  assert.equal(hasSensors({ name: 'Lamp' }), true);
  assert.equal(hasSensors({ name: 'Lamp', runningSensor: false, finishedSensor: false }), false);
  assert.equal(
    hasSensors({
      name: 'Coffee',
      runningSensor: false,
      finishedSensor: false,
      phases: [{ name: 'Brewing', minWatts: 150, maxWatts: 700 }],
    }),
    true,
  );
  assert.equal(
    hasSensors({
      name: 'Coffee',
      runningSensor: false,
      finishedSensor: false,
      phases: [{ name: 'Brewing', minWatts: 150, maxWatts: 700, sensor: false }],
    }),
    false,
  );
});
