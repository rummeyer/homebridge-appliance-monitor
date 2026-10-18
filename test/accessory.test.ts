/**
 * The HomeKit side, against HAP-NodeJS itself rather than a stand-in, so the
 * characteristic values are the ones HomeKit will see.
 *
 * Homebridge brings a cached accessory back with every service it had, so
 * the tests build the accessory twice where it matters: once new, once
 * restored.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import * as hap from '@homebridge/hap-nodejs';
import type { API, PlatformAccessory } from 'homebridge';

import { ApplianceAccessory, PULSE_MS, firmware } from '../src/accessory.ts';
import type { DeviceConfig } from '../src/config.ts';

const { Characteristic, Service } = hap;
const api = { hap } as unknown as API;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** See the note in cycle.test.ts: unref'd timers alone let the run end early. */
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

/** A HAP accessory with the one thing PlatformAccessory adds that is used here. */
function platformAccessory(): PlatformAccessory {
  const accessory = new hap.Accessory('Washer', hap.uuid.generate('washer')) as unknown as PlatformAccessory;
  (accessory as { context: object }).context = {};
  return accessory;
}

const switchOf = (accessory: PlatformAccessory, subtype: string) => accessory.getServiceById(Service.Switch, subtype);
const on = (accessory: PlatformAccessory, subtype: string) =>
  switchOf(accessory, subtype)?.getCharacteristic(Characteristic.On).value;
const name = (accessory: PlatformAccessory, subtype: string) =>
  switchOf(accessory, subtype)?.getCharacteristic(Characteristic.ConfiguredName).value;

test('one accessory with a switch each for Running and every phase', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(
    api,
    accessory,
    { name: 'Coffee', phases: [{ name: 'Heating', minWatts: 1000 }, { name: 'Brewing', minWatts: 30, maxWatts: 100 }] },
    'idle',
  );
  assert.deepEqual(
    accessory.services.filter((s) => s.UUID === Service.Switch.UUID).map((s) => s.subtype),
    ['running', 'phase:Heating', 'phase:Brewing'],
  );
  assert.equal(name(accessory, 'running'), 'Coffee Running');
  assert.equal(accessory.getService(Service.AccessoryInformation)!.getCharacteristic(Characteristic.Name).value, 'Coffee Monitor');
  assert.equal(name(accessory, 'phase:Brewing'), 'Brewing', 'inside "Coffee Monitor", the phase alone');
});

test('Running is on while the appliance runs', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'idle');
  assert.equal(on(accessory, 'running'), false);
  handle.update('running');
  assert.equal(on(accessory, 'running'), true);
  handle.update('idle');
  assert.equal(on(accessory, 'running'), false);
});

test('a phase is on while it lasts', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Coffee', phases: [{ name: 'Brewing', minWatts: 30, maxWatts: 100 }] }, 'idle');
  handle.setPhase('Brewing', true);
  assert.equal(on(accessory, 'phase:Brewing'), true);
  handle.setPhase('Brewing', false);
  assert.equal(on(accessory, 'phase:Brewing'), false);
});

test('a short phase goes on for a moment once it is known, then off by itself', async () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(
    api,
    accessory,
    { name: 'Coffee', phases: [{ name: 'Rinse', minWatts: 30, maxWatts: 100, maxSeconds: 10 }] },
    'idle',
  );
  handle.phaseHappened('Rinse');
  assert.equal(on(accessory, 'phase:Rinse'), true);
  await wait(PULSE_MS + 100);
  assert.equal(on(accessory, 'phase:Rinse'), false);
});

test('a switch tapped in the Home app goes back to what the appliance is doing', async () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'idle');
  handle.update('running');
  const running = switchOf(accessory, 'running')!.getCharacteristic(Characteristic.On);
  await running.handleSetRequest(false);
  await wait(500);
  assert.equal(running.value, true, 'still running, so back on');
});

test('the sensors of earlier versions leave a restored accessory', () => {
  const accessory = platformAccessory();
  accessory.addService(Service.OccupancySensor, 'Washer Running', 'running');
  accessory.addService(Service.ContactSensor, 'Washer Finished', 'finished');
  accessory.addService(Service.OccupancySensor, 'Coffee Heating', 'phase:Heating');

  new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'idle');
  assert.equal(accessory.getService(Service.OccupancySensor), undefined);
  assert.equal(accessory.getService(Service.ContactSensor), undefined);
  assert.ok(switchOf(accessory, 'running'));
});

test('a switch turned off in the config, or a phase removed, leaves a restored accessory', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Coffee', phases: [{ name: 'Heating', minWatts: 1000 }, { name: 'Bezug', minWatts: 30 }] };
  new ApplianceAccessory(api, accessory, device, 'idle');
  new ApplianceAccessory(api, accessory, { ...device, runningSwitch: false, phases: [{ name: 'Bezug', minWatts: 30 }] }, 'idle');
  assert.equal(switchOf(accessory, 'running'), undefined);
  assert.equal(switchOf(accessory, 'phase:Heating'), undefined);
  assert.ok(switchOf(accessory, 'phase:Bezug'));
});

test('the Finished switch of earlier versions leaves a restored accessory', () => {
  const accessory = platformAccessory();
  accessory.addService(Service.Switch, 'Washer Finished', 'finished');
  new ApplianceAccessory(api, accessory, { name: 'Washer', finishedSwitch: true }, 'idle');
  assert.equal(switchOf(accessory, 'finished'), undefined);
  assert.ok(switchOf(accessory, 'running'));
});

test('the setting from when these were sensors still counts', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'Lamp', runningSensor: false }, 'idle');
  assert.equal(switchOf(accessory, 'running'), undefined);
});

test('Running can be an occupancy sensor, taken while it runs; changing it replaces the switch', () => {
  const accessory = platformAccessory();
  const desk: DeviceConfig = { name: 'Desk' };
  new ApplianceAccessory(api, accessory, desk, 'idle');
  assert.ok(switchOf(accessory, 'running'));

  const handle = new ApplianceAccessory(api, accessory, { ...desk, runningAs: 'occupancy' }, 'running');
  assert.equal(switchOf(accessory, 'running'), undefined, 'the switch is gone');
  const sensor = accessory.getServiceById(Service.OccupancySensor, 'running')!;
  const detected = () => sensor.getCharacteristic(Characteristic.OccupancyDetected).value;
  assert.equal(sensor.getCharacteristic(Characteristic.ConfiguredName).value, 'Desk Occupancy');
  assert.equal(detected(), Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
  handle.update('idle');
  assert.equal(detected(), Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);

  new ApplianceAccessory(api, accessory, desk, 'idle');
  assert.equal(accessory.getServiceById(Service.OccupancySensor, 'running'), undefined, 'and back');
  assert.ok(switchOf(accessory, 'running'));

  new ApplianceAccessory(api, accessory, { ...desk, runningAs: 'occupancy', runningSwitch: false }, 'idle');
  assert.equal(accessory.getServiceById(Service.OccupancySensor, 'running'), undefined, 'not shown at all');
  assert.equal(switchOf(accessory, 'running'), undefined);
});

test('Overtime and Idle are occupancy sensors of their own, kept on a restored accessory and removed when not wanted', () => {
  const accessory = platformAccessory();
  const tv: DeviceConfig = { name: 'TV', overtimeMinutes: 240, idleOnMinutes: 30 };
  const handle = new ApplianceAccessory(api, accessory, tv, 'running');
  const sensor = (subtype: string) => accessory.getServiceById(Service.OccupancySensor, subtype);
  const detected = (subtype: string) => sensor(subtype)!.getCharacteristic(Characteristic.OccupancyDetected).value;
  assert.equal(sensor('left-on')!.getCharacteristic(Characteristic.ConfiguredName).value, 'TV Overtime');
  assert.equal(sensor('idle-on')!.getCharacteristic(Characteristic.ConfiguredName).value, 'TV Idle');
  assert.equal(detected('left-on'), Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
  handle.setTimed('overtime', true);
  assert.equal(detected('left-on'), Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
  assert.equal(detected('idle-on'), Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED, 'each on its own');
  handle.setTimed('idleOn', true);
  assert.equal(detected('idle-on'), Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
  assert.ok(switchOf(accessory, 'running'), 'Running stays as it was');

  new ApplianceAccessory(api, accessory, tv, 'idle');
  assert.ok(sensor('left-on') && sensor('idle-on'), 'restored');
  new ApplianceAccessory(api, accessory, { name: 'TV', idleOnMinutes: 30 }, 'idle');
  assert.equal(sensor('left-on'), undefined, 'gone once not set');
  assert.ok(sensor('idle-on'));
  new ApplianceAccessory(api, accessory, { name: 'TV' }, 'idle');
  assert.equal(sensor('idle-on'), undefined);
});

test("1.7.0's Left On becomes Overtime, keeping its automations, and its name unless renamed", () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'TV', overtimeMinutes: 240 }, 'idle');
  const sensor = accessory.getServiceById(Service.OccupancySensor, 'left-on')!;
  sensor.setCharacteristic(Characteristic.ConfiguredName, 'TV Left On');
  new ApplianceAccessory(api, accessory, { name: 'TV', leftOnMinutes: 240 }, 'idle');
  assert.equal(accessory.getServiceById(Service.OccupancySensor, 'left-on'), sensor, 'the same service');
  assert.equal(sensor.getCharacteristic(Characteristic.ConfiguredName).value, 'TV Overtime');
  sensor.setCharacteristic(Characteristic.ConfiguredName, 'Telly on too long');
  new ApplianceAccessory(api, accessory, { name: 'TV', overtimeMinutes: 240 }, 'idle');
  assert.equal(sensor.getCharacteristic(Characteristic.ConfiguredName).value, 'Telly on too long');
});

test('Idle On, as it was called until 1.12, becomes Idle, keeping its automations, and its name unless renamed', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'TV', idleOnMinutes: 30 }, 'idle');
  const sensor = accessory.getServiceById(Service.OccupancySensor, 'idle-on')!;
  sensor.setCharacteristic(Characteristic.ConfiguredName, 'TV Idle On');
  new ApplianceAccessory(api, accessory, { name: 'TV', idleOnMinutes: 30 }, 'idle');
  assert.equal(accessory.getServiceById(Service.OccupancySensor, 'idle-on'), sensor, 'the same service');
  assert.equal(sensor.getCharacteristic(Characteristic.ConfiguredName).value, 'TV Idle');
  sensor.setCharacteristic(Characteristic.ConfiguredName, 'Telly forgotten');
  new ApplianceAccessory(api, accessory, { name: 'TV', idleOnMinutes: 30 }, 'idle');
  assert.equal(sensor.getCharacteristic(Characteristic.ConfiguredName).value, 'Telly forgotten');
});

test('Running can be an outlet, on and in use while it runs, put back when tapped', async () => {
  const accessory = platformAccessory();
  const washer: DeviceConfig = { name: 'Washer' };
  new ApplianceAccessory(api, accessory, washer, 'idle');
  const handle = new ApplianceAccessory(api, accessory, { ...washer, runningAs: 'outlet' }, 'running');
  assert.equal(switchOf(accessory, 'running'), undefined, 'the switch is gone');
  const outlet = accessory.getServiceById(Service.Outlet, 'running')!;
  assert.equal(outlet.getCharacteristic(Characteristic.ConfiguredName).value, 'Washer Running');
  assert.equal(outlet.isPrimaryService, true, 'the icon of the accessory as one tile');
  assert.equal(outlet.getCharacteristic(Characteristic.On).value, true);
  assert.equal(outlet.getCharacteristic(Characteristic.OutletInUse).value, true);

  // Tapped off in the Home app while it runs: it shows the truth again, and
  // nothing is switched, as the outlet only shows.
  await outlet.getCharacteristic(Characteristic.On).handleSetRequest(false);
  await wait(500);
  assert.equal(outlet.getCharacteristic(Characteristic.On).value, true);

  handle.update('idle');
  assert.equal(outlet.getCharacteristic(Characteristic.On).value, false);
  assert.equal(outlet.getCharacteristic(Characteristic.OutletInUse).value, false);

  new ApplianceAccessory(api, accessory, { ...washer, runningAs: 'occupancy' }, 'idle');
  assert.equal(accessory.getServiceById(Service.Outlet, 'running'), undefined, 'replaced');
  assert.ok(accessory.getServiceById(Service.OccupancySensor, 'running'));
});

test('a phase switch still called by its former default name is shortened; one renamed is left alone', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Coffee', phases: [{ name: 'Bezug', minWatts: 30 }, { name: 'Spülen', minWatts: 30 }] };
  const bezug = accessory.addService(Service.Switch, 'Coffee Bezug', 'phase:Bezug');
  bezug.addOptionalCharacteristic(Characteristic.ConfiguredName);
  bezug.setCharacteristic(Characteristic.ConfiguredName, 'Coffee Bezug');
  const spuelen = accessory.addService(Service.Switch, 'Coffee Spülen', 'phase:Spülen');
  spuelen.addOptionalCharacteristic(Characteristic.ConfiguredName);
  spuelen.setCharacteristic(Characteristic.ConfiguredName, 'Rinse');
  new ApplianceAccessory(api, accessory, device, 'idle');
  assert.equal(name(accessory, 'phase:Bezug'), 'Bezug');
  assert.equal(name(accessory, 'phase:Spülen'), 'Rinse');
});

test('a rename in the Home app survives a restart', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Washer' };
  new ApplianceAccessory(api, accessory, device, 'idle');
  switchOf(accessory, 'running')!.setCharacteristic(Characteristic.ConfiguredName, 'Waschmaschine läuft');
  new ApplianceAccessory(api, accessory, device, 'idle');
  assert.equal(name(accessory, 'running'), 'Waschmaschine läuft');
});

test('the plug describes itself on the details page', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'idle');
  handle.setInfo({ vendorName: 'Shelly', productName: 'Shelly Plug PM', serialNumber: 'ABC', softwareVersionString: '1.3.0-s1' });
  const info = accessory.getService(Service.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(Characteristic.Manufacturer).value, 'Shelly');
  assert.equal(info.getCharacteristic(Characteristic.FirmwareRevision).value, '1.3.0');
});

test('firmware versions are cut to what HomeKit accepts', () => {
  assert.equal(firmware('1.3.0-s1'), '1.3.0');
  assert.equal(firmware('v2'), undefined);
  assert.equal(firmware(undefined), undefined);
});
