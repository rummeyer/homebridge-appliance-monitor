import type { API, PlatformAccessory, Service } from 'homebridge';

import type { DeviceConfig } from './config.ts';
import type { CycleState } from './cycle.ts';

/** What Matter's BasicInformation tells about the plug, for the Home app's details page. */
export interface DeviceInfo {
  vendorName?: string;
  productName?: string;
  serialNumber?: string;
  softwareVersionString?: string;
}

/**
 * One appliance in HomeKit: "running" as an occupancy sensor, "finished" as a
 * contact sensor that opens.
 *
 * Sensors rather than switches: the Home app offers notifications for them
 * without an automation ("Washing machine Finished opened"), and nobody can
 * tap them into a state the appliance is not in.
 */
export class ApplianceAccessory {
  readonly #api: API;
  readonly #accessory: PlatformAccessory;
  readonly #running: Service | undefined;
  readonly #finished: Service | undefined;

  constructor(api: API, accessory: PlatformAccessory, device: DeviceConfig, state: CycleState) {
    this.#api = api;
    this.#accessory = accessory;
    const { Service } = api.hap;

    // Homebridge brings a cached accessory back with every service it had, so
    // one turned off in the config has to be removed, not just not built.
    this.#running = this.#sensor(
      Service.OccupancySensor,
      'running',
      device.runningSensor !== false,
      device.runningName?.trim() || `${device.name} Running`,
    );
    this.#finished = this.#sensor(
      Service.ContactSensor,
      'finished',
      device.finishedSensor !== false,
      device.finishedName?.trim() || `${device.name} Finished`,
    );
    this.update(state);
  }

  update(state: CycleState): void {
    const { Characteristic } = this.#api.hap;
    this.#running?.updateCharacteristic(
      Characteristic.OccupancyDetected,
      state === 'running'
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.#finished?.updateCharacteristic(
      Characteristic.ContactSensorState,
      state === 'finished'
        ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : Characteristic.ContactSensorState.CONTACT_DETECTED,
    );
  }

  /** Greys the sensors out in the Home app while the plug cannot be reached. */
  setReachable(reachable: boolean): void {
    const { Characteristic } = this.#api.hap;
    for (const service of [this.#running, this.#finished]) {
      service?.updateCharacteristic(Characteristic.StatusActive, reachable);
    }
  }

  setInfo(info: DeviceInfo): void {
    const { Characteristic, Service } = this.#api.hap;
    const service = this.#accessory.getService(Service.AccessoryInformation);
    if (!service) {
      return;
    }
    const set = (characteristic: typeof Characteristic.Manufacturer, value: string | undefined): void => {
      if (value?.trim()) {
        service.updateCharacteristic(characteristic, value.trim());
      }
    };
    set(Characteristic.Manufacturer, info.vendorName);
    set(Characteristic.Model, info.productName);
    set(Characteristic.SerialNumber, info.serialNumber);
    set(Characteristic.FirmwareRevision, firmware(info.softwareVersionString));
  }

  #sensor(
    type: typeof Service.OccupancySensor | typeof Service.ContactSensor,
    subtype: string,
    wanted: boolean,
    name: string,
  ): Service | undefined {
    const { Characteristic } = this.#api.hap;
    const existing = this.#accessory.getServiceById(type, subtype);
    if (!wanted) {
      if (existing) {
        this.#accessory.removeService(existing);
      }
      return undefined;
    }
    const service = existing ?? this.#accessory.addService(type, name, subtype);
    service.setCharacteristic(Characteristic.StatusActive, true);

    // The name is set when the sensor is new or the config names it
    // differently than last time — not on every start, which would undo a
    // rename in the Home app.
    const names = (this.#accessory.context.names ??= {}) as Record<string, string>;
    if (!existing || names[subtype] !== name) {
      service.setCharacteristic(Characteristic.Name, name);
      if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      }
      service.setCharacteristic(Characteristic.ConfiguredName, name);
      names[subtype] = name;
    }
    return service;
  }
}

/** HomeKit wants a firmware version as digits and dots: "1.3.0-s1" becomes "1.3.0". */
export function firmware(version: string | undefined): string | undefined {
  return version?.match(/^\d+(\.\d+){0,2}/)?.[0];
}
