import assert from 'node:assert/strict';
import test from 'node:test';

import {
  duplicateNames,
  isChildBridgeProcess,
  showsInHomeKit,
  parsePairingCode,
  usablePhases,
  usablePollSeconds,
  usableIdleOnFrom,
  usableMinutes,
  pairedWithProblem,
  partOfProblem,
  wholeOf,
  withParts,
  countsInTotal,
  validateDeviceConfig,
} from '../src/config.ts';
import type { PhaseConfig } from '../src/phases.ts';

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
  assert.deepEqual(validateDeviceConfig({ name: 'Coffee', mqttTopic: 'shelly/status/switch:0', mqttOnlineTopic: 'shelly/online', mqttPowerKey: 'apower' }, 0), []);
  assert.match(validateDeviceConfig({ name: 'Coffee', mqttTopic: 'shelly/#' }, 0)[0]!, /mqttTopic that is no MQTT topic/);
  assert.match(validateDeviceConfig({ name: 'Coffee', mqttOnlineTopic: '/shelly/online' }, 0)[0]!, /mqttOnlineTopic/);
  assert.match(validateDeviceConfig({ name: 'Coffee', mqttPowerKey: 3 }, 0)[0]!, /mqttPowerKey that is not text/);
});

test('duplicate names are reported once each', () => {
  const devices = [{ name: 'A' }, { name: 'B' }, { name: 'A' }, { name: 'A' }];
  assert.deepEqual(duplicateNames(devices), ['A']);
});

test('a child bridge is recognised by the title Homebridge gives its process', () => {
  assert.equal(isChildBridgeProcess('homebridge: homebridge-appliance-monitor'), true);
  assert.equal(isChildBridgeProcess('homebridge: child bridge'), true, 'before the plugin is known');
  assert.equal(isChildBridgeProcess('homebridge'), false);
  assert.equal(isChildBridgeProcess('node'), false);
});

test('phases need a name, once each, and a range that goes up; a wrong one costs only itself', () => {
  const check = (phases: unknown) => usablePhases({ name: 'Coffee', phases: phases as PhaseConfig[] });
  const heating = { name: 'Heating', minWatts: 700, maxWatts: 1400 };

  assert.deepEqual(check([heating]), {
    phases: [{ ...heating, minSeconds: undefined, holdSeconds: undefined, maxSeconds: undefined }],
    problems: [],
  });
  assert.deepEqual(check([{ ...heating, name: ' Heating ', minSeconds: 3, holdSeconds: null }]).phases, [
    { ...heating, minSeconds: 3, holdSeconds: undefined, maxSeconds: undefined },
  ]);

  const mixed = check([
    heating,
    { name: '', minWatts: 1, maxWatts: 2 },
    { name: 'Heating', minWatts: 1, maxWatts: 2 },
    { name: 'Brewing', minWatts: 400, maxWatts: 200 },
    { name: 'Rinse', minWatts: 200, maxWatts: 400, holdSeconds: -1 },
  ]);
  assert.deepEqual(mixed.phases.map(({ name }) => name), ['Heating']);
  assert.equal(mixed.problems.length, 4);
  assert.match(mixed.problems[0]!, /phase 2 has no name/);
  assert.match(mixed.problems[1]!, /"Heating" is there twice/);
  assert.match(mixed.problems[2]!, /"Brewing" needs its "below" to be more than its "from"/);
  assert.match(mixed.problems[3]!, /holdSeconds/);
  assert.match(check('Heating').problems[0]!, /not a list/);
});

test('the empty phase the settings page offers is skipped without a word', () => {
  assert.deepEqual(check0([{ sensor: true }, {}, null, { name: '  ', minWatts: null, maxWatts: null, sensor: true }]), {
    phases: [],
    problems: [],
  });
  assert.deepEqual(validateDeviceConfig({ name: 'Coffee', phases: [{ sensor: true }] }, 0), [], 'and the plug is fine');
});

const check0 = (phases: unknown) => usablePhases({ name: 'Coffee', phases: phases as PhaseConfig[] });

test('a plug shows something in HomeKit unless every switch is off', () => {
  assert.equal(showsInHomeKit({ name: 'Lamp' }), true);
  assert.equal(showsInHomeKit({ name: 'Lamp', runningSwitch: false, finishedSwitch: true }), false, 'Finished is gone');
  assert.equal(showsInHomeKit({ name: 'Lamp', runningSensor: false }), false);
  assert.equal(
    showsInHomeKit({
      name: 'Coffee',
      runningSensor: false,
      phases: [{ name: 'Brewing', minWatts: 150, maxWatts: 700 }],
    }),
    true,
  );
  assert.equal(
    showsInHomeKit({
      name: 'Coffee',
      runningSensor: false,
      phases: [{ name: 'Brewing', minWatts: 150, maxWatts: 700, sensor: false }],
    }),
    false,
  );
  assert.equal(
    showsInHomeKit({ name: 'Lamp', runningSensor: false, phases: [{ sensor: true } as PhaseConfig] }),
    false,
    'an empty phase is no sensor',
  );
});

test('a phase may leave out its upper end, not its lower one', () => {
  const check = (phase: object) => usablePhases({ name: 'Coffee', phases: [phase as PhaseConfig] });
  assert.deepEqual(check({ name: 'Heating', minWatts: 1000, minSeconds: 5, holdSeconds: 30, sensor: true }).phases, [
    { name: 'Heating', minWatts: 1000, maxWatts: undefined, minSeconds: 5, holdSeconds: 30, maxSeconds: undefined, sensor: true },
  ]);
  assert.match(check({ name: 'Heating', maxWatts: 1400 }).problems[0]!, /needs a "from"/);
});

test('Overtime and Idle need a number of minutes; anything else costs only the sensor', () => {
  assert.deepEqual(usableMinutes({ name: 'TV', overtimeMinutes: 240 }, 'overtime'), { minutes: 240 });
  assert.deepEqual(usableMinutes({ name: 'TV', leftOnMinutes: 240 }, 'overtime'), { minutes: 240 }, "1.7.0's name");
  assert.deepEqual(usableMinutes({ name: 'TV', overtimeMinutes: 300, leftOnMinutes: 240 }, 'overtime'), { minutes: 300 });
  assert.deepEqual(usableMinutes({ name: 'TV', idleOnMinutes: 30 }, 'idleOn'), { minutes: 30 });
  assert.deepEqual(usableMinutes({ name: 'TV', overtimeMinutes: 240 }, 'idleOn'), { minutes: undefined });
  assert.deepEqual(usableMinutes({ name: 'TV' }, 'overtime'), { minutes: undefined });
  assert.deepEqual(usableMinutes({ name: 'TV', idleOnMinutes: null as unknown as number }, 'idleOn'), { minutes: undefined });
  for (const wrong of [0, -5, 'long']) {
    const overtime = usableMinutes({ name: 'TV', overtimeMinutes: wrong as number }, 'overtime');
    assert.equal(overtime.minutes, undefined);
    assert.match(overtime.problem!, /no Overtime sensor/);
    const idleOn = usableMinutes({ name: 'TV', idleOnMinutes: wrong as number }, 'idleOn');
    assert.equal(idleOn.minutes, undefined);
    assert.match(idleOn.problem!, /idleOnMinutes .* no Idle sensor/);
  }
  assert.ok(showsInHomeKit({ name: 'TV', runningSwitch: false, overtimeMinutes: 240 }), 'a sensor is something to show');
  assert.ok(showsInHomeKit({ name: 'TV', runningSwitch: false, idleOnMinutes: 30 }));
});

test('Idle counts from the end of one of its phases, or else from when it stops running', () => {
  const phases = [{ name: 'Bezug', minWatts: 30 }, { name: 'Milchschaum', minWatts: 450 }];
  assert.deepEqual(usableIdleOnFrom({ name: 'Coffee', idleOnFrom: 'Bezug' }, phases), { from: 'Bezug' });
  assert.deepEqual(usableIdleOnFrom({ name: 'Coffee', idleOnFrom: ' Bezug ' }, phases), { from: 'Bezug' });
  assert.deepEqual(usableIdleOnFrom({ name: 'Coffee' }, phases), { from: undefined });
  assert.deepEqual(usableIdleOnFrom({ name: 'Coffee', idleOnFrom: '' }, phases), { from: undefined });
  for (const wrong of ['Espresso', 42]) {
    const { from, problem } = usableIdleOnFrom({ name: 'Coffee', idleOnFrom: wrong as string }, phases);
    assert.equal(from, undefined);
    assert.match(problem!, /none of its phases; Idle counts from when it stops running/);
  }
});

test('too short an interval for asking is lengthened, and does not cost the plug', () => {
  assert.deepEqual(usablePollSeconds({ name: 'Coffee', pollSeconds: 5 }), { pollSeconds: 5 });
  assert.deepEqual(usablePollSeconds({ name: 'Coffee', pollSeconds: null as unknown as number }), { pollSeconds: undefined });
  const short = usablePollSeconds({ name: 'Coffee', pollSeconds: 1 });
  assert.equal(short.pollSeconds, 2);
  assert.match(short.problem!, /asking every 2 s/);
  const odd = usablePollSeconds({ name: 'Coffee', pollSeconds: 'often' as unknown as number });
  assert.equal(odd.pollSeconds, undefined);
  assert.match(odd.problem!, /only listening/);
  assert.deepEqual(validateDeviceConfig({ name: 'Coffee', pollSeconds: 1 }, 0), []);
});

test('a phase marked to be counted keeps the mark; a mark that is not on or off is refused', () => {
  const check = (phase: object) => usablePhases({ name: 'Coffee', phases: [phase as PhaseConfig] });
  assert.equal(check({ name: 'Bezug', minWatts: 30, maxWatts: 100, count: true }).phases[0]!.count, true);
  assert.match(check({ name: 'Bezug', minWatts: 30, maxWatts: 100, count: 'yes' }).problems[0]!, /count/);
});

test('a phase may be on down only (rampDown in 1.1.1, fromAbove in 1.1.0); a mark that is not on or off is refused', () => {
  const check = (phase: object) => usablePhases({ name: 'Waschmaschine', phases: [phase as PhaseConfig] });
  assert.equal(check({ name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, onDown: true }).phases[0]!.onDown, true);
  assert.match(check({ name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, onDown: 'yes' }).problems[0]!, /onDown/);
  assert.equal(check({ name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, fromAbove: true }).phases[0]!.onDown, true, 'as 1.1.0 called it');
  assert.equal(check({ name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, rampDown: true }).phases[0]!.onDown, true, 'as 1.1.1 called it');
  assert.equal('fromAbove' in check({ name: 'Gewaschen', minWatts: 2, maxWatts: 4.5, fromAbove: true }).phases[0]!, false);
});

test('a phase may be only the short draws, if it can still come on before its limit', () => {
  const check = (phase: object) => usablePhases({ name: 'Coffee', phases: [phase as PhaseConfig] });
  assert.equal(check({ name: 'Spülen', minWatts: 30, minSeconds: 2, maxSeconds: 10 }).phases[0]!.maxSeconds, 10);
  assert.equal(check({ name: 'Spülen', minWatts: 30, maxSeconds: null }).phases[0]!.maxSeconds, undefined);
  assert.match(check({ name: 'Spülen', minWatts: 30, maxSeconds: 0 }).problems[0]!, /maxSeconds/);
  assert.match(check({ name: 'Spülen', minWatts: 30, maxSeconds: 5 }).problems[0]!, /shorter than/);
});

test('Running is a switch or an occupancy sensor, nothing else', () => {
  assert.deepEqual(validateDeviceConfig({ name: 'Desk', runningAs: 'occupancy' }, 0), []);
  assert.match(validateDeviceConfig({ name: 'Desk', runningAs: 'contact' }, 0)[0]!, /runningAs/);
});

test('the switches read the setting from when they were sensors, the new one winning', () => {
  assert.equal(showsInHomeKit({ name: 'Lamp', runningSwitch: false }), false);
  assert.equal(showsInHomeKit({ name: 'Lamp', runningSensor: false, runningSwitch: true }), true);
});

test('a device behind a bridge: the pairing it shares and the device it follows', () => {
  assert.deepEqual(validateDeviceConfig({ name: 'Dryer', pairedWith: 'Washer', deviceId: 'shelly-dryer' }, 0), []);
  assert.deepEqual(validateDeviceConfig({ name: 'Dryer', endpoint: 5 }, 0), []);
  assert.equal(validateDeviceConfig({ name: 'Dryer', pairedWith: ' ' }, 0).length, 1);
  assert.equal(validateDeviceConfig({ name: 'Dryer', deviceId: 5 }, 0).length, 1);
  assert.equal(validateDeviceConfig({ name: 'Dryer', endpoint: -1 }, 0).length, 1);
  assert.equal(validateDeviceConfig({ name: 'Dryer', endpoint: 1.5 }, 0).length, 1);
});

test('only a pairing of its own can be shared, by an appliance that is there', () => {
  const washer = { name: 'Washer', pairingCode: MANUAL };
  const dryer = { name: 'Dryer', pairedWith: 'Washer' };
  assert.equal(pairedWithProblem(dryer, [washer, dryer]), undefined);
  assert.equal(pairedWithProblem(washer, [washer, dryer]), undefined, 'one with a pairing of its own');
  assert.match(pairedWithProblem({ name: 'Dryer', pairedWith: 'Fridge' }, [washer])!, /no other appliance/);
  assert.match(pairedWithProblem({ name: 'Dryer', pairedWith: 'Dryer' }, [washer])!, /no other appliance/);
  const lamp = { name: 'Lamp', pairedWith: 'Dryer' };
  assert.match(pairedWithProblem(lamp, [washer, dryer, lamp])!, /itself paired with "Washer"/);
});

test('part of another appliance: named, not itself, and not round in a circle', () => {
  const desk = { name: 'Desk' };
  const lamp = { name: 'Lamp', partOf: 'Desk' };
  assert.equal(partOfProblem(lamp, [desk, lamp]), undefined);
  assert.equal(countsInTotal(lamp, [desk, lamp]), false);
  assert.equal(countsInTotal(desk, [desk, lamp]), true);
  assert.equal(wholeOf({ name: 'Lamp', partOf: ' Desk ' }, [desk, lamp]), 'Desk');
  assert.equal(wholeOf(desk, [desk, lamp]), undefined);

  assert.match(partOfProblem({ name: 'Lamp', partOf: 'Fridge' }, [desk])!, /no other appliance/);
  assert.match(partOfProblem({ name: 'Lamp', partOf: 'Lamp' }, [desk])!, /no other appliance/);
  assert.match(partOfProblem({ name: 'Lamp', partOf: 3 as unknown as string }, [desk])!, /no appliance name/);

  const a = { name: 'A', partOf: 'B' };
  const b = { name: 'B', partOf: 'A' };
  assert.match(partOfProblem(a, [a, b])!, /leads back round/);
  assert.equal(countsInTotal(a, [a, b]), true, 'a circle is counted rather than lost');
  assert.equal(wholeOf(a, [a, b]), undefined, 'nor is it switched off with the other');

  // A chain is fine: the lamp is in the strip, the strip in the room meter.
  const room = { name: 'Room' };
  const strip = { name: 'Strip', partOf: 'Room' };
  const bulb = { name: 'Bulb', partOf: 'Strip' };
  assert.equal(partOfProblem(bulb, [room, strip, bulb]), undefined);
  assert.equal(countsInTotal(bulb, [room, strip, bulb]), false);
});

test('parts come right after what they are part of, by name, and deeper', () => {
  const devices = [
    { name: 'Room' },
    { name: 'Washer' },
    { name: 'Lamp 10', partOf: 'Strip' },
    { name: 'Strip', partOf: 'Room' },
    { name: 'lamp 2', partOf: 'Strip' },
    { name: 'Lost', partOf: 'Nowhere' },
  ];
  assert.deepEqual(
    withParts(devices).map(({ device, depth }) => `${depth} ${device.name}`),
    ['0 Room', '1 Strip', '2 lamp 2', '2 Lamp 10', '0 Washer', '0 Lost'],
  );
});
