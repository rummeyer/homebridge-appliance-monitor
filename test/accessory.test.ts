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

import { ApplianceAccessory, FINISHED_PULSE_MS, firmware } from '../src/accessory.ts';
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

test('one accessory with a switch each for Running, Finished and every phase', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(
    api,
    accessory,
    { name: 'Coffee', phases: [{ name: 'Heating', minWatts: 1000 }, { name: 'Brewing', minWatts: 30, maxWatts: 100 }] },
    'off',
  );
  assert.deepEqual(
    accessory.services.filter((s) => s.UUID === Service.Switch.UUID).map((s) => s.subtype),
    ['running', 'finished', 'phase:Heating', 'phase:Brewing'],
  );
  assert.equal(name(accessory, 'running'), 'Coffee Running');
  assert.equal(name(accessory, 'phase:Brewing'), 'Coffee Brewing');
});

test('Running is on while the appliance runs', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  assert.equal(on(accessory, 'running'), false);
  handle.update('running');
  assert.equal(on(accessory, 'running'), true);
  handle.update('finished');
  assert.equal(on(accessory, 'running'), false);
});

test('Finished goes on for a moment, then off by itself', async () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'running');
  assert.equal(on(accessory, 'finished'), false);
  handle.finished();
  assert.equal(on(accessory, 'finished'), true, 'on, for an automation "when it turns on"');
  await wait(FINISHED_PULSE_MS + 100);
  assert.equal(on(accessory, 'finished'), false);
});

test('a phase is on while it lasts', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Coffee', phases: [{ name: 'Brewing', minWatts: 30, maxWatts: 100 }] }, 'off');
  handle.setPhase('Brewing', true);
  assert.equal(on(accessory, 'phase:Brewing'), true);
  handle.setPhase('Brewing', false);
  assert.equal(on(accessory, 'phase:Brewing'), false);
});

test('a switch tapped in the Home app goes back to what the appliance is doing', async () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
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

  new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  assert.equal(accessory.getService(Service.OccupancySensor), undefined);
  assert.equal(accessory.getService(Service.ContactSensor), undefined);
  assert.ok(switchOf(accessory, 'running'));
});

test('a switch turned off in the config, or a phase removed, leaves a restored accessory', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Coffee', phases: [{ name: 'Heating', minWatts: 1000 }] };
  new ApplianceAccessory(api, accessory, device, 'off');
  new ApplianceAccessory(api, accessory, { ...device, runningSwitch: false, phases: [] }, 'off');
  assert.equal(switchOf(accessory, 'running'), undefined);
  assert.equal(switchOf(accessory, 'phase:Heating'), undefined);
  assert.ok(switchOf(accessory, 'finished'));
});

test('the setting from when these were sensors still counts', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'Lamp', runningSensor: false, finishedSensor: false }, 'off');
  assert.equal(switchOf(accessory, 'running'), undefined);
  assert.equal(switchOf(accessory, 'finished'), undefined);
});

test('a rename in the Home app survives a restart', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Washer' };
  new ApplianceAccessory(api, accessory, device, 'off');
  switchOf(accessory, 'finished')!.setCharacteristic(Characteristic.ConfiguredName, 'Waschmaschine fertig');
  new ApplianceAccessory(api, accessory, device, 'off');
  assert.equal(name(accessory, 'finished'), 'Waschmaschine fertig');
});

test('the plug describes itself on the details page', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
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
