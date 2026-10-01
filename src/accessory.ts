import type { API, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { showsFinished, showsRunning } from './config.ts';
import type { DeviceConfig } from './config.ts';
import type { CycleState } from './cycle.ts';

/** What Matter's BasicInformation tells about the plug, for the Home app's details page. */
export interface DeviceInfo {
  vendorName?: string;
  productName?: string;
  serialNumber?: string;
  softwareVersionString?: string;
}

/** How long the Finished switch stays on: long enough for an automation to see it. */
export const FINISHED_PULSE_MS = 2000;

/** How soon a switch tapped in the Home app is put back to what the appliance is doing. */
const PUT_BACK_MS = 300;

/**
 * One appliance in HomeKit, as switches to hang automations on:
 *
 * - **Running**, on while the appliance runs;
 * - one switch per phase, on while the phase lasts;
 * - **Finished**, which goes on for a moment when the appliance finishes, and
 *   off again by itself — an event, as a switch, because "when it turns on"
 *   is what an automation can wait for.
 *
 * Switches rather than sensors, at the owner's choice: an occupancy sensor
 * "detecting" a coffee being drawn read oddly, and the Home app tucks
 * sensors away. A switch can be tapped, though, and the plugin only
 * measures, so one tapped is put back to the truth straight away.
 */
export class ApplianceAccessory {
  readonly #api: API;
  readonly #accessory: PlatformAccessory;
  readonly #running: Service | undefined;
  readonly #finished: Service | undefined;
  readonly #phases = new Map<string, Service>();
  /** What each switch should show, by subtype, to put a tapped one back to. */
  readonly #truth = new Map<string, boolean>();
  #pulse: NodeJS.Timeout | undefined;

  constructor(api: API, accessory: PlatformAccessory, device: DeviceConfig, state: CycleState) {
    this.#api = api;
    this.#accessory = accessory;
    const { Service } = api.hap;

    // Earlier versions showed sensors; Homebridge brings a cached accessory
    // back with every service it had, so they are removed here.
    for (const service of [...accessory.services]) {
      if (service.UUID === Service.OccupancySensor.UUID || service.UUID === Service.ContactSensor.UUID) {
        accessory.removeService(service);
      }
    }

    this.#running = this.#switch('running', showsRunning(device), `${device.name} Running`);
    this.#finished = this.#switch('finished', showsFinished(device), `${device.name} Finished`);

    const wanted = new Set<string>();
    for (const phase of device.phases ?? []) {
      const name = phase.name.trim();
      const subtype = `phase:${name}`;
      wanted.add(subtype);
      const service = this.#switch(subtype, phase.sensor !== false, `${device.name} ${name}`);
      if (service) {
        this.#phases.set(name, service);
      }
    }
    for (const service of [...accessory.services]) {
      if (service.subtype?.startsWith('phase:') && !wanted.has(service.subtype)) {
        accessory.removeService(service);
      }
    }

    this.update(state);
    this.#show('finished', false);
    for (const name of this.#phases.keys()) {
      this.setPhase(name, false);
    }
  }

  /** Running follows the state; Finished is a pulse of its own (see finished()). */
  update(state: CycleState): void {
    this.#show('running', state === 'running');
  }

  /** Turns Finished on for a moment. */
  finished(): void {
    if (!this.#finished) {
      return;
    }
    clearTimeout(this.#pulse);
    this.#show('finished', true);
    this.#pulse = setTimeout(() => this.#show('finished', false), FINISHED_PULSE_MS);
  }

  /** A phase, on while it lasts. */
  setPhase(name: string, active: boolean): void {
    this.#show(`phase:${name}`, active);
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

  #service(subtype: string): Service | undefined {
    if (subtype === 'running') {
      return this.#running;
    }
    if (subtype === 'finished') {
      return this.#finished;
    }
    return this.#phases.get(subtype.slice('phase:'.length));
  }

  #show(subtype: string, on: boolean): void {
    this.#truth.set(subtype, on);
    this.#service(subtype)?.updateCharacteristic(this.#api.hap.Characteristic.On, on);
  }

  #switch(subtype: string, wanted: boolean, name: string): Service | undefined {
    const { Characteristic, Service } = this.#api.hap;
    const existing = this.#accessory.getServiceById(Service.Switch, subtype);
    if (!wanted) {
      if (existing) {
        this.#accessory.removeService(existing);
      }
      return undefined;
    }
    let service = existing;
    if (!service) {
      // Named once, when it is new. Renaming is done in the Home app, and a
      // name set on every start would undo it.
      service = this.#accessory.addService(Service.Switch, name, subtype);
      if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      }
      service.setCharacteristic(Characteristic.ConfiguredName, name);
    }
    // Restored services come back without handlers, so this is set every time.
    service.getCharacteristic(Characteristic.On).onSet((value: CharacteristicValue) => {
      const truth = this.#truth.get(subtype) ?? false;
      if (value !== truth) {
        setTimeout(() => service.updateCharacteristic(Characteristic.On, this.#truth.get(subtype) ?? false), PUT_BACK_MS);
      }
    });
    return service;
  }
}

/** HomeKit wants a firmware version as digits and dots: "1.3.0-s1" becomes "1.3.0". */
export function firmware(version: string | undefined): string | undefined {
  return version?.match(/^\d+(\.\d+){0,2}/)?.[0];
}
