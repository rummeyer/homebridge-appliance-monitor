import type { API, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';

import { showsRunning } from './config.ts';
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
 * What the accessory is called: "Kaffeemaschine Monitor", so the plugin's
 * accessory is told apart from the plug's own, which has the appliance's name.
 */
export const accessoryName = (device: DeviceConfig): string => `${device.name} Monitor`;

/** How long a short phase's switch stays on: long enough for an automation to see it. */
export const PULSE_MS = 2000;

/** How soon a switch tapped in the Home app is put back to what the appliance is doing. */
const PUT_BACK_MS = 300;

/**
 * One appliance in HomeKit, as switches to hang automations on:
 *
 * - **Running**, on while the appliance runs. It goes off only when the
 *   appliance finishes, so "when it turns off" is "when it is done";
 * - one switch per phase, on while the phase lasts, or for a moment once
 *   it is over, for one that is told apart by being short.
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
  readonly #phases = new Map<string, Service>();
  /** What each switch should show, by subtype, to put a tapped one back to. */
  readonly #truth = new Map<string, boolean>();
  /** Switches on for a moment, by subtype, until they go off again. */
  readonly #pulses = new Map<string, NodeJS.Timeout>();

  constructor(api: API, accessory: PlatformAccessory, device: DeviceConfig, state: CycleState) {
    this.#api = api;
    this.#accessory = accessory;
    const { Service } = api.hap;

    // Earlier versions showed sensors; Homebridge brings a cached accessory
    // back with every service it had, so they are removed here. Running may
    // be an occupancy sensor again, and is left to #service() below.
    for (const service of [...accessory.services]) {
      const sensor = service.UUID === Service.OccupancySensor.UUID || service.UUID === Service.ContactSensor.UUID;
      if (sensor && !(service.UUID === Service.OccupancySensor.UUID && service.subtype === 'running')) {
        accessory.removeService(service);
      }
    }

    // Homebridge sets the name of a new accessory; one from before is brought
    // up to date here. The Home app keeps a name given there.
    accessory.getService(Service.AccessoryInformation)?.updateCharacteristic(api.hap.Characteristic.Name, accessoryName(device));

    // Running as a switch, or as an occupancy sensor — a desk is taken or
    // free. Whichever it is not is removed, so changing it replaces it.
    const occupancy = device.runningAs === 'occupancy';
    this.#running = this.#service(Service.Switch, 'running', showsRunning(device) && !occupancy, `${device.name} Running`)
      ?? this.#service(Service.OccupancySensor, 'running', showsRunning(device) && occupancy, `${device.name} Occupancy`);
    if (!occupancy) {
      this.#service(Service.OccupancySensor, 'running', false, '');
    }
    // Earlier versions had a Finished switch too, on for a moment when the
    // appliance finished: the moment Running goes off, so it told nothing more.
    this.#service(Service.Switch, 'finished', false, '');

    const wanted = new Set<string>();
    for (const phase of device.phases ?? []) {
      const name = phase.name.trim();
      const subtype = `phase:${name}`;
      wanted.add(subtype);
      // Inside "Kaffeemaschine Monitor", "Bezug" says enough. Running keeps
      // the appliance's name: five switches called "Running" could not be
      // told apart as tiles or in automations.
      const service = this.#service(Service.Switch, subtype, phase.sensor !== false, name, `${device.name} ${name}`);
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
    for (const name of this.#phases.keys()) {
      this.setPhase(name, false);
    }
  }

  /** Running follows the state. */
  update(state: CycleState): void {
    this.#show('running', state === 'running');
  }

  /** A phase, on while it lasts. */
  setPhase(name: string, active: boolean): void {
    this.#show(`phase:${name}`, active);
  }

  /** A short phase, which is known only once it is over: on for a moment. */
  phaseHappened(name: string): void {
    if (this.#phases.has(name)) {
      this.#pulse(`phase:${name}`);
    }
  }

  #pulse(subtype: string): void {
    clearTimeout(this.#pulses.get(subtype));
    this.#show(subtype, true);
    this.#pulses.set(subtype, setTimeout(() => this.#show(subtype, false), PULSE_MS));
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

  #shown(subtype: string): Service | undefined {
    if (subtype === 'running') {
      return this.#running;
    }
    return this.#phases.get(subtype.slice('phase:'.length));
  }

  #show(subtype: string, on: boolean): void {
    this.#truth.set(subtype, on);
    const service = this.#shown(subtype);
    const { Characteristic, Service } = this.#api.hap;
    if (service?.UUID === Service.OccupancySensor.UUID) {
      service.updateCharacteristic(
        Characteristic.OccupancyDetected,
        on ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    } else {
      service?.updateCharacteristic(Characteristic.On, on);
    }
  }

  /**
   * A switch or sensor, added or brought back, or removed when not wanted.
   * `formerName` is what earlier versions called a new one, to be brought up
   * to date if it is still so called.
   */
  #service(type: WithUUID<typeof Service>, subtype: string, wanted: boolean, name: string, formerName?: string): Service | undefined {
    const { Characteristic, Service } = this.#api.hap;
    const existing = this.#accessory.getServiceById(type, subtype);
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
      service = this.#accessory.addService(type, name, subtype);
      if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      }
      service.setCharacteristic(Characteristic.ConfiguredName, name);
    } else if (formerName !== undefined && service.getCharacteristic(Characteristic.ConfiguredName).value === formerName) {
      service.setCharacteristic(Characteristic.ConfiguredName, name);
      service.setCharacteristic(Characteristic.Name, name);
    }
    if (type.UUID !== Service.Switch.UUID) {
      return service;
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
