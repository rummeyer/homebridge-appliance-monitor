/**
 * Which readings belong to which appliance on a node with several devices
 * measuring power: a Matter bridge, or a plug with several channels.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { chosenEndpoints, describeDevice, meteredDevices } from '../src/bridged.ts';
import type { EndpointInfo } from '../src/bridged.ts';

/**
 * A bridge as homebridge-shelly-matter might show it: the aggregator on 1,
 * a washer measuring on its own endpoint, a dryer measuring on one below
 * its own, and a lamp that measures nothing.
 */
const bridge: EndpointInfo[] = [
  { number: 0, metering: false },
  { number: 1, parent: 0, metering: false },
  { number: 3, parent: 1, metering: true, bridged: { uniqueId: 'shelly-washer', name: 'Washer' } },
  { number: 4, parent: 1, metering: false, bridged: { uniqueId: 'shelly-dryer', name: 'Dryer' } },
  { number: 5, parent: 4, metering: true },
  { number: 6, parent: 1, metering: false, bridged: { uniqueId: 'hue-lamp', name: 'Lamp' } },
];

test('a bridge: each device that measures, with the endpoints that are its own', () => {
  assert.deepEqual(meteredDevices(bridge), [
    { endpoint: 3, endpoints: [3], uniqueId: 'shelly-washer', name: 'Washer' },
    { endpoint: 4, endpoints: [4, 5], uniqueId: 'shelly-dryer', name: 'Dryer' },
  ]);
});

test('a plug of its own: the endpoint that measures, nothing to choose', () => {
  // An Eve Energy: the relay on 1, the power on 2.
  const eve: EndpointInfo[] = [
    { number: 0, metering: false },
    { number: 1, parent: 0, metering: false },
    { number: 2, parent: 0, metering: true },
  ];
  const devices = meteredDevices(eve);
  assert.deepEqual(devices, [{ endpoint: 2, endpoints: [2], uniqueId: undefined, name: undefined }]);
  assert.equal(chosenEndpoints(devices, {}), 'all', 'chosen nothing: every reading counts, as before');
});

test('chosen by UniqueID, found again after the bridge renumbered', () => {
  assert.deepEqual(chosenEndpoints(meteredDevices(bridge), { deviceId: 'shelly-dryer' }), new Set([4, 5]));
  const renumbered = bridge.map((info) => ({
    ...info,
    number: info.number >= 3 ? info.number + 10 : info.number,
    parent: info.parent !== undefined && info.parent >= 3 ? info.parent + 10 : info.parent,
  }));
  assert.deepEqual(chosenEndpoints(meteredDevices(renumbered), { deviceId: 'shelly-dryer' }), new Set([14, 15]));
});

test('chosen by endpoint, for a device without UniqueID: its own number or one below it', () => {
  // A Shelly Plus 2PM: two channels, each measuring on its own endpoint.
  const twoChannels: EndpointInfo[] = [
    { number: 0, metering: false },
    { number: 1, parent: 0, metering: true },
    { number: 2, parent: 0, metering: true },
  ];
  assert.deepEqual(chosenEndpoints(meteredDevices(twoChannels), { endpoint: 2 }), new Set([2]));
  assert.deepEqual(chosenEndpoints(meteredDevices(bridge), { endpoint: 5 }), new Set([4, 5]));
});

test('a device chosen that is not there takes nothing, rather than everything', () => {
  assert.deepEqual(chosenEndpoints(meteredDevices(bridge), { deviceId: 'gone' }), new Set());
  assert.deepEqual(chosenEndpoints(meteredDevices(bridge), { endpoint: 6 }), new Set(), 'the lamp measures nothing');
});

test('described for the log', () => {
  assert.equal(describeDevice(meteredDevices(bridge)[0]!), 'Washer (endpoint 3, id shelly-washer)');
  assert.equal(describeDevice({ endpoint: 2, endpoints: [2] }), 'Endpoint (endpoint 2)');
});
