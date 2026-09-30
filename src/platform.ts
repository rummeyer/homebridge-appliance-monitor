import { join } from 'node:path';

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import {
  duplicateNames,
  isChildBridgeProcess,
  MATTER_LOG_LEVELS,
  parsePairingCode,
  validateDeviceConfig,
} from './config.ts';
import type { DeviceConfig, MatterLogLevel, OutletMonitorPlatformConfig } from './config.ts';
import { activePowerValues, describeNode, MatterController } from './matter.ts';
import type { AttributeReport } from './matter.ts';
import { activePowerWatts, formatWatts, isActivePower } from './power.ts';
import { PowerRecorder } from './recorder.ts';
import { NodeRegistry } from './registry.ts';

/**
 * First stage: pairs the configured plugs, describes what they offer, and
 * logs (and records) their power draw. Nothing appears in HomeKit yet.
 */
export class OutletMonitorPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly config: OutletMonitorPlatformConfig;
  readonly api: API;
  readonly #dataPath: string;
  #controller: MatterController | undefined;
  #recorder: PowerRecorder | undefined;

  // Plain fields rather than parameter properties, so that Node can run this
  // file directly — which is how the tests load it.
  constructor(log: Logging, config: OutletMonitorPlatformConfig, api: API) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.#dataPath = join(api.user.storagePath(), 'outlet-monitor');
    this.api.on('didFinishLaunching', () => {
      this.#start().catch((error: unknown) => {
        this.log.error(`Could not start the Matter controller: ${message(error)}`);
      });
    });
    this.api.on('shutdown', () => {
      void this.#controller?.stop();
    });
  }

  /** No accessories yet; Homebridge still requires the method. */
  configureAccessory(_accessory: PlatformAccessory): void {}

  async #start(): Promise<void> {
    const devices = this.#validDevices();
    if (devices.length === 0) {
      this.log.warn('No plugs configured — nothing to do. Add one under "devices".');
      return;
    }

    if (!isChildBridgeProcess()) {
      this.log.warn(
        'Not running as a child bridge. matter.js keeps process-wide state, and Homebridge 2 ' +
          'can load matter.js itself, so run this plugin as a child bridge.',
      );
    }

    const level = MATTER_LOG_LEVELS.includes(this.config.matterLogLevel as MatterLogLevel)
      ? (this.config.matterLogLevel as MatterLogLevel)
      : 'warn';
    const controller = new MatterController(this.log, join(this.#dataPath, 'matter'), level);
    await controller.start();
    this.#controller = controller;

    if (this.config.recordPower !== false) {
      this.#recorder = new PowerRecorder(join(this.#dataPath, 'power.csv'));
      this.log.info(`Recording power readings to ${this.#recorder.path}`);
    }

    const registry = new NodeRegistry(join(this.#dataPath, 'nodes.json'));
    // One after the other: commissioning several plugs at once would open
    // several PASE sessions over the same border router for no gain.
    for (const device of devices) {
      try {
        await this.#setUp(controller, registry, device);
      } catch (error) {
        this.log.error(`${device.name}: ${message(error)}`);
      }
    }
    this.#reportStrays(controller, registry, devices);
  }

  #validDevices(): DeviceConfig[] {
    const valid: DeviceConfig[] = [];
    for (const [index, device] of (this.config.devices ?? []).entries()) {
      const problems = validateDeviceConfig(device, index);
      for (const problem of problems) {
        this.log.error(`Ignoring plug: ${problem}`);
      }
      if (problems.length === 0) {
        valid.push({ ...device, name: device.name.trim() });
      }
    }
    for (const name of duplicateNames(valid)) {
      this.log.error(`More than one plug is called "${name}"; only the first is used.`);
    }
    return valid.filter((device, index) => valid.findIndex(({ name }) => name === device.name) === index);
  }

  async #setUp(controller: MatterController, registry: NodeRegistry, device: DeviceConfig): Promise<void> {
    let nodeId = registry.get(device.name);
    if (nodeId !== undefined && !controller.isCommissioned(nodeId)) {
      this.log.warn(`${device.name}: was paired as node ${nodeId}, but the controller no longer knows it.`);
      registry.delete(device.name);
      nodeId = undefined;
    }

    if (nodeId === undefined) {
      const pairing = device.pairingCode ? parsePairingCode(device.pairingCode) : undefined;
      if (!pairing) {
        this.log.warn(
          `${device.name}: not paired yet. In the Home app, open the plug's settings, choose ` +
            '"Turn On Pairing Mode", put the code in the config, and restart within 15 minutes.',
        );
        return;
      }
      this.log.info(`${device.name}: pairing — this can take a minute…`);
      try {
        nodeId = await controller.commission(pairing);
      } catch (error) {
        throw new Error(
          `pairing failed: ${message(error)}. Is the pairing window still open (15 minutes), ` +
            'and, for a device on Thread, does this machine have a route to the Thread network (see the README)?',
        );
      }
      registry.set(device.name, nodeId);
      this.log.info(`${device.name}: paired as node ${nodeId}. The pairing code can now be removed from the config.`);
    } else if (device.pairingCode) {
      this.log.debug(`${device.name}: already paired as node ${nodeId}; ignoring the pairing code.`);
    }

    let described = false;
    await controller.connect(nodeId, {
      onState: (state) => this.log.info(`${device.name}: ${state.toLowerCase().replace(/_/g, ' ')}`),
      onReady: (node) => {
        if (!described) {
          described = true;
          this.log.info(`${device.name}: structure`);
          for (const line of describeNode(node)) {
            this.log.info(`${device.name}:   ${line}`);
          }
        }
        // A device reports changes only, so without this the recording would
        // start at the first change after every (re)connection.
        for (const report of activePowerValues(node)) {
          this.#onAttribute(device, report);
        }
      },
      onAttribute: (report) => this.#onAttribute(device, report),
    });
  }

  #onAttribute(device: DeviceConfig, report: AttributeReport): void {
    if (!isActivePower(report.clusterId, report.attributeId)) {
      return;
    }
    const watts = activePowerWatts(report.value);
    this.log.info(`${device.name}: ${formatWatts(watts)} (endpoint ${report.endpointId})`);
    this.#recorder?.record(device.name, report.endpointId, watts);
  }

  /** Nodes on the fabric that no configured plug claims — usually a renamed plug. */
  #reportStrays(controller: MatterController, registry: NodeRegistry, devices: DeviceConfig[]): void {
    const names = new Set(devices.map(({ name }) => name));
    const claimed = new Set(
      registry
        .entries()
        .filter(([name]) => names.has(name))
        .map(([, id]) => id),
    );
    const strays = controller.commissionedNodes().filter((id) => !claimed.has(id));
    if (strays.length > 0) {
      this.log.warn(
        `Paired but not configured: node ${strays.join(', ')}. A plug that was renamed ` +
          'or removed from the config stays paired until it is removed in the Home app.',
      );
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
