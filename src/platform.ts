import { join } from 'node:path';

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import { ApplianceAccessory } from './accessory.ts';
import {
  duplicateNames,
  isChildBridgeProcess,
  MATTER_LOG_LEVELS,
  parsePairingCode,
  resetOptions,
  validateDeviceConfig,
} from './config.ts';
import type { DeviceConfig, MatterLogLevel, OutletMonitorPlatformConfig } from './config.ts';
import type { CycleState, Transition } from './cycle.ts';
import type { Learned } from './learn.ts';
import { activePowerValues, describeNode, MatterController } from './matter.ts';
import type { AttributeReport } from './matter.ts';
import { DeviceMonitor } from './monitor.ts';
import { activePowerWatts, formatDuration, formatWatts, isActivePower } from './power.ts';
import { PowerRecorder } from './recorder.ts';
import { NodeRegistry } from './registry.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';
import { DeviceStore } from './store.ts';

/** How the states are called in the log, matching the sensors' default names. */
const STATE_NAMES: Record<CycleState, string> = { off: 'Off', running: 'Running', finished: 'Finished' };

/** How often time is let pass for the monitors, which see no readings while a machine is quiet. */
const TICK_MS = 5000;

interface Appliance {
  device: DeviceConfig;
  monitor: DeviceMonitor;
  accessory: ApplianceAccessory;
}

/**
 * Pairs the configured plugs, watches their power draw, and shows each
 * appliance in HomeKit as running or finished.
 */
export class OutletMonitorPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly config: OutletMonitorPlatformConfig;
  readonly api: API;
  readonly #dataPath: string;
  /** Accessories restored from Homebridge's cache, keyed by UUID. */
  readonly #cached = new Map<string, PlatformAccessory>();
  readonly #appliances = new Map<string, Appliance>();
  #controller: MatterController | undefined;
  #recorder: PowerRecorder | undefined;
  #store: DeviceStore | undefined;
  #ticker: NodeJS.Timeout | undefined;

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
      clearInterval(this.#ticker);
      void this.#controller?.stop();
    });
  }

  /** Homebridge replays cached accessories here before `didFinishLaunching`. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.#cached.set(accessory.UUID, accessory);
  }

  async #start(): Promise<void> {
    const devices = this.#validDevices();
    this.#prune(devices);
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
    this.#store = new DeviceStore(join(this.#dataPath, 'devices.json'));
    this.#ticker = setInterval(() => {
      const now = Date.now();
      for (const { monitor } of this.#appliances.values()) {
        monitor.tick(now);
      }
    }, TICK_MS);

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

    const appliance = this.#appliance(device);
    let described = false;
    await controller.connect(nodeId, {
      onState: (state) => {
        this.log.info(`${device.name}: ${state.toLowerCase().replace(/_/g, ' ')}`);
        appliance.accessory.setReachable(state === 'Connected');
      },
      onReady: (node) => {
        if (!described) {
          described = true;
          this.log.info(`${device.name}: structure`);
          for (const line of describeNode(node)) {
            this.log.info(`${device.name}:   ${line}`);
          }
          appliance.accessory.setInfo(node.basicInformation ?? {});
        }
        // A device reports changes only, so without this nothing would be
        // known until the first change after every (re)connection.
        for (const report of activePowerValues(node)) {
          this.#onAttribute(appliance, report);
        }
      },
      onAttribute: (report) => this.#onAttribute(appliance, report),
    });
  }

  /** The HomeKit accessory and the monitor for one plug, created once it is paired. */
  #appliance(device: DeviceConfig): Appliance {
    const store = this.#store!;
    const record = store.get(device.name);
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${device.name}`);

    let accessory = this.#cached.get(uuid);
    if (accessory) {
      accessory.displayName = device.name;
    } else {
      accessory = new this.api.platformAccessory(device.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.#cached.set(uuid, accessory);
    }

    const initial =
      record.state !== undefined && record.since !== undefined ? { state: record.state, since: record.since } : undefined;
    const handle = new ApplianceAccessory(this.api, accessory, device, initial?.state ?? 'off');
    this.api.updatePlatformAccessories([accessory]);

    const monitor = new DeviceMonitor(
      {
        reset: resetOptions(device),
        overrides: device.thresholds,
        learned: record.learned,
        cycles: record.cycles,
        initial,
      },
      {
        transition: (transition) => this.#onTransition(device, handle, transition),
        learned: (learned, cycles) => {
          store.update(device.name, { learned, cycles });
          this.#logLearned(device, learned, cycles);
        },
        resumed: (pauseSeconds) =>
          this.log.warn(
            `${device.name}: running again after ${formatDuration(pauseSeconds)} — that was a pause, ` +
              'not the end. Learning it, so that it is not mistaken for the end again.',
          ),
      },
    );

    if (record.learned) {
      this.#logLearned(device, record.learned, record.cycles ?? 1, 'using');
    } else {
      this.log.info(
        `${device.name}: learning. Run the appliance once; until then Finished comes ` +
          `up to ${formatDuration(monitor.params.finishSeconds)} after the end.`,
      );
    }

    const appliance = { device, monitor, accessory: handle };
    this.#appliances.set(device.name, appliance);
    return appliance;
  }

  #onAttribute(appliance: Appliance, report: AttributeReport): void {
    if (!isActivePower(report.clusterId, report.attributeId)) {
      return;
    }
    const { device, monitor } = appliance;
    const watts = activePowerWatts(report.value);
    this.log.debug(`${device.name}: ${formatWatts(watts)} (endpoint ${report.endpointId})`);
    this.#recorder?.record(device.name, report.endpointId, watts);
    monitor.reading(Date.now(), watts);
  }

  #onTransition(device: DeviceConfig, accessory: ApplianceAccessory, transition: Transition): void {
    accessory.update(transition.to);
    this.#store?.update(device.name, { state: transition.to, since: transition.at });

    const { cycle } = transition;
    if (transition.to === 'finished' && cycle) {
      this.log.info(
        `${device.name}: Finished — ran ${formatDuration(cycle.seconds)}, ` +
          `${(cycle.wattHours / 1000).toFixed(2)} kWh, peak ${formatWatts(cycle.peakWatts)}`,
      );
    } else {
      this.log.info(`${device.name}: ${STATE_NAMES[transition.to]}`);
    }
  }

  #logLearned(device: DeviceConfig, learned: Learned, cycles: number, verb = 'learned'): void {
    const { runWatts, offWatts, finishSeconds } = learned.params;
    const rest = learned.hasStandby
      ? `back to off below ${formatWatts(offWatts)} (it rests at ${formatWatts(learned.restWatts)})`
      : 'it drops to nothing by itself when done, so Finished stays until the next start';
    this.log.info(
      `${device.name}: ${verb} from ${cycles} cycle${cycles === 1 ? '' : 's'} — running above ${formatWatts(runWatts)}, ` +
        `finished after ${formatDuration(finishSeconds)} of quiet (longest pause ` +
        `${formatDuration(learned.longestPauseSeconds)}), ${rest}.`,
    );
  }

  /** Drops accessories whose plug was removed from config.json. */
  #prune(devices: DeviceConfig[]): void {
    const wanted = new Set(devices.map(({ name }) => this.api.hap.uuid.generate(`${PLUGIN_NAME}:${name}`)));
    const stale = [...this.#cached.entries()].filter(([uuid]) => !wanted.has(uuid));
    if (stale.length === 0) {
      return;
    }
    this.log.info(`Removing ${stale.length} accessory/accessories no longer in the config`);
    this.api.unregisterPlatformAccessories(
      PLUGIN_NAME,
      PLATFORM_NAME,
      stale.map(([, accessory]) => accessory),
    );
    for (const [uuid] of stale) {
      this.#cached.delete(uuid);
    }
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
