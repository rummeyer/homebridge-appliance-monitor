/**
 * The HomeKit side, against HAP-NodeJS itself rather than a stand-in, so the
 * characteristic values are the ones HomeKit will see.
 *
 * Homebridge brings a cached accessory back with every service it had, so
 * the tests build the accessory twice where it matters: once new, once
 * restored.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as hap from '@homebridge/hap-nodejs';
import type { API, PlatformAccessory } from 'homebridge';

import { ApplianceAccessory, firmware } from '../src/accessory.ts';
import type { DeviceConfig } from '../src/config.ts';

const { Characteristic, Service } = hap;
const api = { hap } as unknown as API;

/** A HAP accessory with the one thing PlatformAccessory adds that is used here. */
function platformAccessory(): PlatformAccessory {
  const accessory = new hap.Accessory('Washer', hap.uuid.generate('washer')) as unknown as PlatformAccessory;
  (accessory as { context: object }).context = {};
  return accessory;
}

const occupancy = (accessory: PlatformAccessory) =>
  accessory.getServiceById(Service.OccupancySensor, 'running')?.getCharacteristic(Characteristic.OccupancyDetected).value;
const contact = (accessory: PlatformAccessory) =>
  accessory.getServiceById(Service.ContactSensor, 'finished')?.getCharacteristic(Characteristic.ContactSensorState).value;
const name = (accessory: PlatformAccessory, type: typeof Service.ContactSensor, subtype: string) =>
  accessory.getServiceById(type, subtype)?.getCharacteristic(Characteristic.ConfiguredName).value;

test('Running occupies, Finished opens, Off does neither', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  assert.equal(occupancy(accessory), 0);
  assert.equal(contact(accessory), 0);

  handle.update('running');
  assert.equal(occupancy(accessory), 1);
  assert.equal(contact(accessory), 0);

  handle.update('finished');
  assert.equal(occupancy(accessory), 0);
  assert.equal(contact(accessory), 1, 'open: the Home app notifies on opening');
});

test('the sensors are named after the appliance when they are new', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  assert.equal(name(accessory, Service.OccupancySensor, 'running'), 'Washer Running');
  assert.equal(name(accessory, Service.ContactSensor, 'finished'), 'Washer Finished');
});

test('a rename in the Home app survives a restart', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = { name: 'Washer' };
  new ApplianceAccessory(api, accessory, device, 'off');
  accessory
    .getServiceById(Service.ContactSensor, 'finished')!
    .setCharacteristic(Characteristic.ConfiguredName, 'Waschmaschine fertig');

  new ApplianceAccessory(api, accessory, device, 'off');
  assert.equal(name(accessory, Service.ContactSensor, 'finished'), 'Waschmaschine fertig');
});

test('a sensor turned off in the config leaves a restored accessory', () => {
  const accessory = platformAccessory();
  new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  const restored = new ApplianceAccessory(api, accessory, { name: 'Washer', runningSensor: false }, 'finished');

  assert.equal(accessory.getServiceById(Service.OccupancySensor, 'running'), undefined);
  assert.equal(contact(accessory), 1);
  restored.update('running'); // and nothing breaks without it
});

test('an unreachable plug greys its sensors out', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  handle.setReachable(false);
  for (const [type, subtype] of [
    [Service.OccupancySensor, 'running'],
    [Service.ContactSensor, 'finished'],
  ] as const) {
    assert.equal(accessory.getServiceById(type, subtype)!.getCharacteristic(Characteristic.StatusActive).value, false);
  }
});

test('the plug describes itself on the details page', () => {
  const accessory = platformAccessory();
  const handle = new ApplianceAccessory(api, accessory, { name: 'Washer' }, 'off');
  handle.setInfo({ vendorName: 'Shelly', productName: 'Shelly Plug PM', serialNumber: 'ABC', softwareVersionString: '1.3.0-s1' });
  const info = accessory.getService(Service.AccessoryInformation)!;
  assert.equal(info.getCharacteristic(Characteristic.Manufacturer).value, 'Shelly');
  assert.equal(info.getCharacteristic(Characteristic.Model).value, 'Shelly Plug PM');
  assert.equal(info.getCharacteristic(Characteristic.FirmwareRevision).value, '1.3.0');
});

test('firmware versions are cut to what HomeKit accepts', () => {
  assert.equal(firmware('1.3.0-s1'), '1.3.0');
  assert.equal(firmware('3.5.0'), '3.5.0');
  assert.equal(firmware('v2'), undefined);
  assert.equal(firmware(undefined), undefined);
});

test('each phase is an occupancy sensor of its own, and a removed one goes', () => {
  const accessory = platformAccessory();
  const device: DeviceConfig = {
    name: 'Coffee',
    phases: [
      { name: 'Heating', minWatts: 700, maxWatts: 1400 },
      { name: 'Brewing', minWatts: 150, maxWatts: 700 },
      { name: 'Hidden', minWatts: 1, maxWatts: 5, sensor: false },
    ],
  };
  const handle = new ApplianceAccessory(api, accessory, device, 'off');
  const phase = (name: string) => accessory.getServiceById(Service.OccupancySensor, `phase:${name}`);

  assert.equal(phase('Heating')!.getCharacteristic(Characteristic.ConfiguredName).value, 'Coffee Heating');
  assert.equal(phase('Hidden'), undefined, 'no sensor where none is wanted');
  handle.setPhase('Heating', true);
  assert.equal(phase('Heating')!.getCharacteristic(Characteristic.OccupancyDetected).value, 1);
  assert.equal(phase('Brewing')!.getCharacteristic(Characteristic.OccupancyDetected).value, 0);

  new ApplianceAccessory(api, accessory, { ...device, phases: device.phases!.slice(1) }, 'off');
  assert.equal(phase('Heating'), undefined, 'removed from the config, removed from the accessory');
  assert.ok(phase('Brewing'));
});
