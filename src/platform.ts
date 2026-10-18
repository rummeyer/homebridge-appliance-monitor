import { join } from 'node:path';

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import { accessoryName, ApplianceAccessory } from './accessory.ts';
import { chosenEndpoints, describeDevice, meteredDevices } from './bridged.ts';
import type { MeteredDevice } from './bridged.ts';
import {
  duplicateNames,
  isChildBridgeProcess,
  showsInHomeKit,
  MATTER_LOG_LEVELS,
  usableDashboardPort,
  TIMED_SENSORS,
  usableIdleOnFrom,
  usableMinutes,
  usablePhases,
  usablePollSeconds,
  pairedWithProblem,
  partOfProblem,
  countsInTotal,
  wholeOf,
  parsePairingCode,
  validateDeviceConfig,
} from './config.ts';
import type { DeviceConfig, MatterLogLevel, ApplianceMonitorPlatformConfig, TimedSensor } from './config.ts';
import { cycleState } from './cycle.ts';
import { Dashboard } from './dashboard.ts';
import type { LiveAppliance } from './dashboard.ts';
import type { CycleState, Transition } from './cycle.ts';
import { EnergyMeter } from './energy.ts';
import type { DeviceEnergy } from './energy.ts';
import { readJson, writeJson } from './json-file.ts';
import type { Learned } from './learn.ts';
import { currentValues, describeNode, endpointTree, MatterController, readActivePower } from './matter.ts';
import type { AttributeReport } from './matter.ts';
import type { PairedNode } from '@project-chip/matter.js/device';
import { FINISHED, phaseKey } from './counts.ts';
import { dataDir } from './data-dir.ts';
import { AFTER_MS, BEFORE_MS, DeviceMonitor } from './monitor.ts';
import { PhaseTracker, RECALL_MS } from './phases.ts';
import type { PhaseChange } from './phases.ts';
import { activePowerWatts, formatDuration, formatWatts, isActivePower, isOnOff } from './power.ts';
import { PowerRecorder, readSamples } from './recorder.ts';
import { answer, takeRequests } from './requests.ts';
import type { PluginRequest } from './requests.ts';
import { clearResets, pendingResets } from './resets.ts';
import { NodeRegistry } from './registry.ts';
import { runsOf, usualSeconds, withRun } from './typical.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';
import { DeviceStore } from './store.ts';

/** How the states are called in the log, matching the sensors' default names. */
const STATE_NAMES: Record<CycleState, string> = { idle: 'Idle', running: 'Running' };

/** How often time is let pass for the monitors, which see no readings while a machine is quiet. */
const TICK_MS = 5000;
/** How often the energy counted so far is written down. */
const SAVE_ENERGY_MS = 5 * 60_000;

interface Appliance {
  device: DeviceConfig;
  monitor: DeviceMonitor;
  /** None for a plug with every sensor turned off, which is only counted. */
  accessory: ApplianceAccessory | undefined;
  energy: EnergyMeter;
  phases: PhaseTracker[];
  /** The last reading taken in, to drop the same one arriving twice. */
  last?: { endpointId: number; value: unknown; at: number };
  /**
   * The last power in watts, to know whether the plug is drawing anything.
   * Nothing for a part while its whole draws nothing; see #unpowered.
   */
  watts?: number;
  /** The last reading as the plug gave it, to go back to once the whole is on again. */
  measured?: { endpointId: number; watts: number | undefined };
  /** Whether the plug's relay was last reported switched off. */
  relayOff?: boolean;
  /** Whether the plug is connected; unknown until it first is, or is not. */
  reachable?: boolean;
  /** Which of Overtime and Idle are on. */
  timed: Partial<Record<TimedSensor, boolean>>;
  /** Since when it has drawn power without running; see #idleSince. */
  idleSince?: number;
  /**
   * The endpoints whose readings are this appliance's: all of them for a
   * plug of its own, those of the device it chose behind a bridge. Until the
   * node has been read, none for an appliance that chose one; see bridged.ts.
   */
  accept: Set<number> | 'all';
}

/** At or below this a plug draws nothing, and is not asked; see #poll. */
const IDLE_WATTS = 0.5;

/**
 * Pairs the configured plugs, watches their power draw, and shows each
 * appliance in HomeKit as running or finished.
 */
export class ApplianceMonitorPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly config: ApplianceMonitorPlatformConfig;
  readonly api: API;
  readonly #dataPath: string;
  /** Accessories restored from Homebridge's cache, keyed by UUID. */
  readonly #cached = new Map<string, PlatformAccessory>();
  readonly #appliances = new Map<string, Appliance>();
  #controller: MatterController | undefined;
  #recorder: PowerRecorder | undefined;
  #store: DeviceStore | undefined;
  #ticker: NodeJS.Timeout | undefined;
  #energySaver: NodeJS.Timeout | undefined;
  #dashboard: Dashboard | undefined;
  /** The plugs configured and usable, in the order of the settings. */
  #devices: DeviceConfig[] = [];
  /** Set on shutdown, when every plug disconnecting is expected and not worth a line. */
  #stopping = false;
  readonly #pollers: NodeJS.Timeout[] = [];
  /** Energy per plug as last saved, including plugs no longer configured, whose history is kept. */
  #ledger: Record<string, DeviceEnergy> = {};

  // Plain fields rather than parameter properties, so that Node can run this
  // file directly — which is how the tests load it.
  constructor(log: Logging, config: ApplianceMonitorPlatformConfig, api: API) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.#dataPath = dataDir(api.user.storagePath());
    this.api.on('didFinishLaunching', () => {
      this.#start().catch((error: unknown) => {
        this.log.error(`Could not start the Matter controller: ${message(error)}`);
      });
    });
    this.api.on('shutdown', () => {
      this.#stopping = true;
      clearInterval(this.#ticker);
      for (const poller of this.#pollers) {
        clearInterval(poller);
      }
      clearInterval(this.#energySaver);
      this.#dashboard?.close();
      this.#saveEnergy();
      this.#controller?.stop().catch((error: unknown) => {
        this.log.debug(`Could not stop the Matter controller cleanly: ${message(error)}`);
      });
    });
  }

  /**
   * Runs what a timer or a Matter event calls for. An error thrown there — a
   * full disk when saving, say — would otherwise go uncaught and end the
   * child bridge; here it is logged, and the next reading carries on.
   */
  #safely(what: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.log.error(`${what}: ${message(error)}`);
    }
  }

  /** Homebridge replays cached accessories here before `didFinishLaunching`. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.#cached.set(accessory.UUID, accessory);
  }

  async #start(): Promise<void> {
    const devices = this.#validDevices();
    this.#devices = devices;
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
      const days = Number.isInteger(this.config.recordDays) && this.config.recordDays! > 0 ? this.config.recordDays : undefined;
      this.#recorder = new PowerRecorder(join(this.#dataPath, 'power'), days);
      this.log.debug(`Recording power readings to ${this.#recorder.dir}`);
    }
    this.#store = new DeviceStore(join(this.#dataPath, 'devices.json'));
    const ledger = readJson(this.#energyPath);
    this.#ledger = ledger !== null && typeof ledger === 'object' ? (ledger as Record<string, DeviceEnergy>) : {};
    this.#ticker = setInterval(() => {
      const now = Date.now();
      this.#safely('Resetting statistics', () => this.#reset(now));
      for (const request of takeRequests(this.#dataPath)) {
        this.#safely(`${request.name}: ${request.action}`, () => this.#onRequest(request, now));
      }
      for (const appliance of this.#appliances.values()) {
        this.#safely(appliance.device.name, () => {
          appliance.monitor.tick(now);
          appliance.energy.tick(now);
          this.#checkTimed(appliance, now);
          for (const tracker of appliance.phases) {
            this.#onPhase(appliance, tracker, tracker.tick(now));
          }
        });
      }
    }, TICK_MS);
    this.#energySaver = setInterval(() => this.#saveEnergy(), SAVE_ENERGY_MS);
    await this.#startDashboard();

    const registry = new NodeRegistry(join(this.#dataPath, 'nodes.json'));
    // One after the other: commissioning several plugs at once would open
    // several PASE sessions over the same border router for no gain. An
    // appliance paired with another comes along with that one: behind a
    // bridge, which is paired once.
    for (const device of devices.filter(({ pairedWith }) => !pairedWith)) {
      if (this.#stopping) {
        return;
      }
      const sharing = devices.filter(({ pairedWith }) => pairedWith?.trim() === device.name);
      try {
        await this.#setUp(controller, registry, device, sharing);
      } catch (error) {
        this.log.error(`${[device, ...sharing].map(({ name }) => name).join(', ')}: ${message(error)}`);
      }
    }
    if (!this.#stopping) {
      this.#reportStrays(controller, registry, devices);
    }
  }

  #validDevices(): DeviceConfig[] {
    const valid: DeviceConfig[] = [];
    for (const [index, device] of (this.config.devices ?? []).entries()) {
      const problems = validateDeviceConfig(device, index);
      for (const problem of problems) {
        this.log.error(`Ignoring plug: ${problem}`);
      }
      if (problems.length === 0) {
        const named = { ...device, name: device.name.trim() };
        const { phases, problems: phaseProblems } = usablePhases(named);
        for (const problem of phaseProblems) {
          this.log.warn(`Ignoring phase: ${problem}`);
        }
        const { pollSeconds, problem } = usablePollSeconds(named);
        if (problem) {
          this.log.warn(problem);
        }
        const { minutes: overtimeMinutes, problem: overtimeProblem } = usableMinutes(named, 'overtime');
        const { minutes: idleOnMinutes, problem: idleOnProblem } = usableMinutes(named, 'idleOn');
        const { from: idleOnFrom, problem: fromProblem } = usableIdleOnFrom(named, phases);
        for (const problem of [overtimeProblem, idleOnProblem, fromProblem].filter(Boolean)) {
          this.log.warn(problem!);
        }
        valid.push({ ...named, phases, pollSeconds, overtimeMinutes, idleOnMinutes, idleOnFrom, leftOnMinutes: undefined });
      }
    }
    for (const name of duplicateNames(valid)) {
      this.log.error(`More than one plug is called "${name}"; only the first is used.`);
    }
    const unique = valid.filter((device, index) => valid.findIndex(({ name }) => name === device.name) === index);
    const usable = unique.filter((device) => {
      const problem = pairedWithProblem(device, unique);
      if (problem) {
        this.log.error(`Ignoring plug: ${problem}`);
      }
      return !problem;
    });
    // Not a reason to drop the plug: it is then counted in the totals, as it
    // was before the setting existed.
    for (const device of usable) {
      const problem = partOfProblem(device, usable);
      if (problem) {
        this.log.warn(`${problem}, so it is counted in the totals.`);
      }
    }
    return usable;
  }

  async #setUp(controller: MatterController, registry: NodeRegistry, device: DeviceConfig, sharing: DeviceConfig[] = []): Promise<void> {
    let nodeId = registry.get(device.name);
    // While shutting down, the closing controller reports every node as
    // unknown; forgetting the pairings then would orphan the plugs.
    if (this.#stopping) {
      return;
    }
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
    }

    const appliances = [device, ...sharing].map((each) => this.#appliance(each));
    const names = appliances.map(({ device: { name } }) => name).join(', ');
    const store = this.#store!;
    const introduced = new Set<Appliance>();
    let reachable: boolean | undefined;
    await controller.connect(nodeId, {
      onState: (state) => this.#safely(names, () => {
        const connected = state === 'Connected';
        // Only a change worth knowing about: lost after having been there, or
        // back after being lost. The steps in between (reconnecting,
        // waiting for discovery) and the start-up connect are left out.
        if (!this.#stopping && reachable !== undefined && connected !== reachable) {
          if (connected) {
            this.log.info(`${names}: reachable again`);
          } else if (state === 'Disconnected') {
            this.log.warn(`${names}: unreachable`);
          }
        }
        if (connected || state === 'Disconnected') {
          reachable = connected;
          for (const appliance of appliances) {
            appliance.reachable = connected;
            if (!connected) {
              this.#nothingDrawn(appliance, Date.now());
            }
          }
        }
      }),
      onReady: (node) => this.#safely(names, () => {
        // Which device behind a bridge is whose: found again on every
        // connection, as a bridge may have renumbered its endpoints.
        const metered = meteredDevices(endpointTree(node));
        this.#saveMetered(device.name, metered);
        // Everything the plug offers, once: when it is new.
        if (!store.get(device.name).described) {
          for (const line of describeNode(node)) {
            this.log.info(`${device.name}:   ${line}`);
          }
          store.update(device.name, { described: true });
        }
        // A device reports changes only, so without this nothing would be
        // known until the first change after every (re)connection.
        const current = currentValues(node);
        for (const appliance of appliances) {
          this.#safely(appliance.device.name, () => {
            this.#choose(appliance, metered, !introduced.has(appliance));
            for (const report of current) {
              this.#onAttribute(appliance, report);
            }
            if (introduced.has(appliance)) {
              return;
            }
            introduced.add(appliance);
            appliance.accessory?.setInfo(node.basicInformation ?? {});
            const { accept } = appliance;
            const watts = current
              .filter(({ endpointId, clusterId, attributeId }) => (accept === 'all' || accept.has(endpointId)) && isActivePower(clusterId, attributeId))
              .map(({ value }) => activePowerWatts(value))
              .find((value) => value !== undefined);
            const { name, pollSeconds } = appliance.device;
            this.log.info(
              [
                `${name}: ${node.basicInformation?.productName ?? 'connected'}`,
                formatWatts(watts),
                STATE_NAMES[appliance.monitor.state],
                this.#learnedSummary(appliance),
                ...(pollSeconds ? [`asked every ${pollSeconds} s`] : []),
              ].join(', '),
            );
            if (pollSeconds) {
              this.#poll(appliance, node, pollSeconds);
            }
          });
        }
      }),
      onAttribute: (report) => {
        for (const appliance of appliances) {
          this.#safely(appliance.device.name, () => this.#onAttribute(appliance, report));
        }
      },
    });
  }

  /**
   * Which endpoints an appliance takes its readings from, and a word in the
   * log where that needs one: a device chosen that is not there, or several
   * measuring and none chosen. Told once per start, not on every reconnect.
   */
  #choose(appliance: Appliance, metered: MeteredDevice[], tell: boolean): void {
    const { device } = appliance;
    appliance.accept = chosenEndpoints(metered, device);
    if (!tell) {
      return;
    }
    const list = metered.map(describeDevice).join('; ');
    if (appliance.accept !== 'all') {
      const chosen = metered.find(({ endpoints }) => [...endpoints].some((number) => (appliance.accept as Set<number>).has(number)));
      if (chosen) {
        this.log.info(`${device.name}: follows ${describeDevice(chosen)}`);
      } else {
        this.log.warn(
          `${device.name}: ${device.deviceId ? `no device with id ${device.deviceId}` : `no endpoint ${device.endpoint}`} ` +
            `measures power here, so nothing is counted. There are: ${list || 'none'}.`,
        );
      }
    } else if (metered.length > 1) {
      this.log.warn(
        `${device.name}: ${metered.length} devices measure power here, and all of them count as one appliance. ` +
          `Choose one on the settings page, or set deviceId: ${list}.`,
      );
    }
  }

  /** What measures power behind each pairing, for the settings page to choose from; see bridged.ts. */
  #saveMetered(owner: string, metered: MeteredDevice[]): void {
    const path = join(this.#dataPath, 'endpoints.json');
    const all = (readJson(path) as Record<string, MeteredDevice[]> | null) ?? {};
    if (JSON.stringify(all[owner]) === JSON.stringify(metered)) {
      return;
    }
    all[owner] = metered;
    writeJson(path, all);
  }

  /**
   * Asks the plug for its power every few seconds. One ask at a time: on a
   * slow Thread hop a read can take longer than the interval, and asks would
   * pile up. Failures are expected while the plug is unreachable and only go
   * to the debug log.
   *
   * Not while it draws nothing: an appliance that is switched off has nothing
   * short to catch, and the plug reports it being switched on by itself —
   * within a minute even for an Eve, which is fine for something that then
   * heats for minutes. That leaves the asking to the hours it is on.
   */
  #poll(appliance: Appliance, node: PairedNode, seconds: number): void {
    let busy = false;
    const timer = setInterval(() => {
      if (busy || this.#stopping || !node.isConnected) {
        return;
      }
      if (appliance.watts !== undefined && appliance.watts <= IDLE_WATTS) {
        return;
      }
      busy = true;
      readActivePower(node, appliance.accept === 'all' ? undefined : appliance.accept)
        .then((reports) => {
          for (const report of reports) {
            this.#safely(appliance.device.name, () => this.#onAttribute(appliance, report));
          }
        })
        .catch((error: unknown) => {
          // Shutting down fails the ask in flight; that is no news.
          if (!this.#stopping) {
            this.log.debug(`${appliance.device.name}: could not ask for power: ${message(error)}`);
          }
        })
        .finally(() => {
          busy = false;
        });
    }, seconds * 1000);
    this.#pollers.push(timer);
  }

  /** The read-only page, if it is switched on; see dashboard.ts. Without it the plugin runs on. */
  async #startDashboard(): Promise<void> {
    const { port, problem } = usableDashboardPort(this.config);
    if (problem) {
      this.log.warn(problem);
    }
    if (port === undefined || this.#stopping) {
      return;
    }
    const dashboard = new Dashboard({
      dataPath: this.#dataPath,
      devices: () => this.#devices,
      live: () => this.#live(),
    });
    try {
      await dashboard.listen(port);
    } catch (error) {
      this.log.error(`Could not open the dashboard on port ${port}: ${message(error)}`);
      return;
    }
    this.#dashboard = dashboard;
    this.log.info(`Dashboard on port ${port}, read only: http://<this machine>:${port}/`);
  }

  /** What each appliance is doing now, for the dashboard. */
  #live(): LiveAppliance[] {
    const now = Date.now();
    return this.#devices.map((device) => {
      const { name } = device;
      const partOf = countsInTotal(device, this.#devices) ? {} : { partOf: device.partOf!.trim() };
      // The page knows the icons, and shows an outlet for one it does not.
      const icon = typeof device.icon === 'string' && device.icon ? { icon: device.icon } : {};
      const appliance = this.#appliances.get(name);
      if (!appliance) {
        return { name, paired: false, phases: [], ...partOf, ...icon };
      }
      const { monitor } = appliance;
      const record = this.#store?.get(name) ?? {};
      const cycle = monitor.progress(now);
      const typical = usualSeconds(runsOf(record), cycle && monitor.startOf(cycle.startedAt, now));
      return {
        ...partOf,
        ...icon,
        name,
        paired: true,
        reachable: appliance.reachable,
        watts: appliance.watts,
        at: appliance.last?.at,
        state: monitor.state,
        since: record.since,
        phases: appliance.phases.filter(({ active }) => active).map(({ name: phase }) => phase),
        cycle,
        ...(typical === undefined ? {} : { typicalSeconds: typical }),
        ...(appliance.timed.overtime ? { overtime: true } : {}),
        ...(appliance.timed.idleOn ? { idleOn: true } : {}),
      };
    });
  }

  /** "learning", or "learned from 3 cycles". */
  #learnedSummary({ device }: Appliance): string {
    const { learned, cycles } = this.#store?.get(device.name) ?? {};
    if (!learned) {
      return 'learning';
    }
    const count = cycles ?? 1;
    return `learned from ${count} cycle${count === 1 ? '' : 's'}`;
  }

  /** The HomeKit accessory and the monitor for one plug, created once it is paired. */
  #appliance(device: DeviceConfig): Appliance {
    const store = this.#store!;
    const record = store.get(device.name);
    const initial =
      record.state !== undefined && record.since !== undefined
        ? {
            state: cycleState(record.state),
            since: record.since,
            wattHours: record.cycleWattHours,
            peakWatts: record.cyclePeakWatts,
          }
        : undefined;

    let handle: ApplianceAccessory | undefined;
    if (showsInHomeKit(device)) {
      const uuid = this.#uuid(device.name);
      let accessory = this.#cached.get(uuid);
      if (accessory) {
        accessory.displayName = accessoryName(device);
      } else {
        accessory = new this.api.platformAccessory(accessoryName(device), uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.#cached.set(uuid, accessory);
      }
      handle = new ApplianceAccessory(this.api, accessory, device, initial?.state ?? 'idle');
      this.api.updatePlatformAccessories([accessory]);
    }

    const monitor = new DeviceMonitor(
      {
        overrides: device.thresholds,
        learned: record.learned,
        cycles: record.cycles,
        initial,
        standbyWatts: record.standbyWatts,
      },
      {
        transition: (transition) => this.#onTransition(device, handle, transition),
        learned: (learned, cycles) => {
          store.update(device.name, { learned, cycles });
          this.#logLearned(device, learned, cycles);
        },
        standby: (standbyWatts, runWatts) => {
          store.update(device.name, { standbyWatts });
          this.log.info(
            `${device.name}: standby at ${formatWatts(standbyWatts)} — running above ${formatWatts(runWatts)} ` +
              'until a cycle has been learned',
          );
        },
        resumed: (pauseSeconds) =>
          this.log.warn(
            `${device.name}: running again after ${formatDuration(pauseSeconds)} — that was a pause, ` +
              'not the end. Learning it, so that it is not mistaken for the end again.',
          ),
      },
    );

    const energy = new EnergyMeter(this.#ledger[device.name]);
    const appliance = {
      device,
      monitor,
      accessory: handle,
      energy,
      phases: this.#phaseTrackers(device),
      // Nothing yet for one that chose a device, until the node says where it is.
      accept: device.deviceId || device.endpoint !== undefined ? new Set<number>() : 'all' as const,
      timed: {},
      idleSince: record.idleSince,
    };
    this.#appliances.set(device.name, appliance);
    this.#tellRunning(Date.now());
    return appliance;
  }

  /**
   * A phase only from above has to know where the draw came from, which the
   * recording tells across a restart: a washing machine resting at 3 W is
   * not told again that it is being loaded.
   */
  #phaseTrackers(device: DeviceConfig): PhaseTracker[] {
    const trackers = (device.phases ?? []).map((phase) => new PhaseTracker(phase));
    if (this.#recorder && device.phases?.some(({ onDown }) => onDown)) {
      const now = Date.now();
      const samples = readSamples(this.#recorder.dir, device.name, now - RECALL_MS, now);
      for (const tracker of trackers) {
        tracker.recall(samples);
      }
    }
    return trackers;
  }

  #onAttribute(appliance: Appliance, report: AttributeReport): void {
    // Behind a bridge, the other devices' readings and switches are theirs.
    if (appliance.accept !== 'all' && !appliance.accept.has(report.endpointId)) {
      return;
    }
    if (isOnOff(report.clusterId, report.attributeId)) {
      if (typeof report.value === 'boolean') {
        appliance.relayOff = !report.value;
      }
      if (appliance.relayOff) {
        this.#nothingDrawn(appliance, Date.now());
      }
      // A plug with a relay switched off: whatever ran there has finished.
      if (report.value === false && appliance.monitor.state === 'running') {
        this.log.debug(`${appliance.device.name}: plug switched off`);
        appliance.monitor.switchedOff(Date.now());
      }
      this.#passOn(appliance, Date.now());
      return;
    }
    if (!isActivePower(report.clusterId, report.attributeId)) {
      return;
    }
    const now = Date.now();
    // A value read on purpose can also come back as a reported change; the
    // second one is not a new reading.
    const { last } = appliance;
    if (last && last.endpointId === report.endpointId && last.value === report.value && now - last.at < 1500) {
      return;
    }
    appliance.last = { endpointId: report.endpointId, value: report.value, at: now };
    appliance.measured = { endpointId: report.endpointId, watts: activePowerWatts(report.value) };
    this.#take(appliance, now);
  }

  /**
   * Takes in the plug's last reading — as nothing while it is part of
   * another appliance that draws nothing, as it cannot then draw anything
   * itself: a lamp behind a socket strip switched off, whose own meter may
   * still report its last few tenths of a watt.
   */
  #take(appliance: Appliance, now: number): void {
    const { device, monitor, measured } = appliance;
    if (!measured) {
      return;
    }
    const watts = measured.watts !== undefined && this.#unpowered(appliance) ? 0 : measured.watts;
    if (watts !== undefined) {
      appliance.watts = watts;
    }
    this.#recorder?.record(device.name, measured.endpointId, watts);
    monitor.reading(now, watts);
    appliance.energy.reading(now, watts);
    if (appliance.relayOff || appliance.reachable === false) {
      this.#nothingDrawn(appliance, now);
    } else {
      for (const tracker of appliance.phases) {
        this.#onPhase(appliance, tracker, tracker.reading(now, watts));
      }
    }
    this.#passOn(appliance, now);
  }

  /**
   * The plug is unreachable, or its relay is off: whatever it reports, a
   * standby phase from 0 W is not on, as nothing can be drawn or nothing is
   * known to be.
   */
  #nothingDrawn(appliance: Appliance, now: number): void {
    for (const tracker of appliance.phases) {
      this.#onPhase(appliance, tracker, tracker.none(now));
    }
  }

  /** Whether the appliance this one is part of is switched off or draws nothing. */
  #unpowered(appliance: Appliance): boolean {
    const whole = wholeOf(appliance.device, this.#devices);
    const of = whole === undefined ? undefined : this.#appliances.get(whole);
    return of !== undefined && (of.relayOff === true || (of.watts !== undefined && of.watts <= IDLE_WATTS));
  }

  /**
   * Whether what an appliance's plug draws now is standby or not: not while
   * it runs, nor while what it is part of runs — its draw is in that one's
   * running then, so a part's standby stays within its whole's.
   */
  #runsWithin(appliance: Appliance): boolean {
    const seen = new Set<string>();
    for (let at: Appliance | undefined = appliance; at && !seen.has(at.device.name); ) {
      if (at.monitor.state === 'running') {
        return true;
      }
      seen.add(at.device.name);
      const whole = wholeOf(at.device, this.#devices);
      at = whole === undefined ? undefined : this.#appliances.get(whole);
    }
    return false;
  }

  /** Tells every meter whether its appliance counts as running, on any change of state. */
  #tellRunning(at: number): void {
    for (const appliance of this.#appliances.values()) {
      appliance.energy.running(at, this.#runsWithin(appliance));
    }
  }

  /** Tells the parts of an appliance when it goes off or on again. */
  #passOn(whole: Appliance, now: number): void {
    for (const part of this.#appliances.values()) {
      if (wholeOf(part.device, this.#devices) !== whole.device.name || part.measured?.watts === undefined) {
        continue;
      }
      const unpowered = this.#unpowered(part);
      if (part.watts === (unpowered ? 0 : part.measured.watts)) {
        continue;
      }
      if (unpowered && part.monitor.state === 'running') {
        part.monitor.switchedOff(now);
      }
      this.#safely(part.device.name, () => this.#take(part, now));
    }
  }

  /**
   * Overtime: on once the appliance has been running for its overtimeMinutes
   * in one go, off when it finishes. Idle: on once it has drawn power for
   * its idleOnMinutes without running, off when it runs again or draws
   * nothing. Looked at on every tick, as nothing else happens while a TV
   * runs on all night.
   */
  #checkTimed(appliance: Appliance, now: number): void {
    this.#setTimed(appliance, 'overtime', now, appliance.monitor.progress(now)?.startedAt, 'running');
    if (appliance.device.idleOnMinutes !== undefined) {
      const { idleOnFrom } = appliance.device;
      const doing = idleOnFrom === undefined ? 'not running' : `on, no ${idleOnFrom}`;
      this.#setTimed(appliance, 'idleOn', now, this.#idleSince(appliance, now), doing);
    }
  }

  /**
   * Since when the appliance has not run — or, with idleOnFrom, since that
   * phase last ended — kept over a restart. Whatever it draws: a TV in a
   * standby that reads 0 W has not run either. A part does not count while
   * its whole runs: what it draws then is in that one's running. Over once
   * the plug's relay is switched off, so that switching it off by
   * automation is done once; left as it was while nothing is known.
   */
  #idleSince(appliance: Appliance, now: number): number | undefined {
    const { device, watts, reachable, relayOff } = appliance;
    if (relayOff) {
      this.#setIdleSince(appliance, undefined);
      return undefined;
    }
    if (watts === undefined || reachable === false) {
      return appliance.idleSince;
    }
    if (device.idleOnFrom !== undefined) {
      // Started by the phase ending, and over when it starts again, in #onPhase.
      return appliance.idleSince;
    }
    const idle = !this.#runsWithin(appliance);
    this.#setIdleSince(appliance, idle ? appliance.idleSince ?? now : undefined);
    return appliance.idleSince;
  }

  #setIdleSince(appliance: Appliance, since: number | undefined): void {
    if (since !== appliance.idleSince) {
      appliance.idleSince = since;
      this.#store?.update(appliance.device.name, { idleSince: since });
    }
  }

  #setTimed(appliance: Appliance, sensor: TimedSensor, now: number, since: number | undefined, doing: string): void {
    const { device } = appliance;
    const minutes = device[TIMED_SENSORS[sensor].key];
    if (minutes === undefined) {
      return;
    }
    const on = since !== undefined && now - since >= minutes * 60_000;
    if (on === (appliance.timed[sensor] ?? false)) {
      return;
    }
    appliance.timed[sensor] = on;
    appliance.accessory?.setTimed(sensor, on);
    if (on) {
      this.log.info(`${device.name}: ${doing} for ${formatDuration((now - since!) / 1000)} — ${TIMED_SENSORS[sensor].label}`);
    }
  }

  #onPhase(appliance: Appliance, tracker: PhaseTracker, change: PhaseChange | undefined): void {
    if (!change) {
      return;
    }
    const { device } = appliance;
    // Idle counting from this phase: from when it ends, not while it lasts.
    if (device.idleOnMinutes !== undefined && device.idleOnFrom === tracker.name.trim() && !appliance.relayOff) {
      this.#setIdleSince(appliance, change.active && !change.short ? undefined : change.at);
    }
    if (change.short) {
      appliance.accessory?.phaseHappened(tracker.name);
      this.#store?.increment(device.name, phaseKey(tracker.name), change.at);
      this.log.info(`${device.name}: ${tracker.name}, ${formatDuration((change.inBandMs ?? 0) / 1000)} in range`);
      return;
    }
    appliance.accessory?.setPhase(tracker.name, change.active);
    if (change.active) {
      this.log.info(`${device.name}: ${tracker.name}`);
    } else {
      this.#store?.increment(device.name, phaseKey(tracker.name), change.at);
      const lasted = change.since === undefined ? '' : ` after ${formatDuration((change.at - change.since) / 1000)}`;
      this.log.info(`${device.name}: ${tracker.name} ended${lasted}`);
    }
  }

  get #energyPath(): string {
    return join(this.#dataPath, 'energy.json');
  }

  /** Writes what each plug has used, for the Statistics tab of the settings page. */
  #saveEnergy(always = false): void {
    if (this.#appliances.size === 0 && !always) {
      return;
    }
    const now = Date.now();
    for (const { device, energy, monitor } of this.#appliances.values()) {
      energy.tick(now);
      energy.prune(now);
      this.#ledger[device.name] = energy.record;
      // And what a running cycle has used so far, for its line in the log
      // when it finishes after a restart.
      const progress = monitor.progress(now);
      if (progress) {
        this.#safely(device.name, () =>
          this.#store?.update(device.name, { cycleWattHours: progress.wattHours, cyclePeakWatts: progress.peakWatts }));
      }
    }
    try {
      writeJson(this.#energyPath, this.#ledger);
    } catch (error) {
      this.log.warn(`Could not save the energy statistics: ${message(error)}`);
    }
  }

  /** Does what the settings page asked for, and answers it; see requests.ts. */
  #onRequest(request: PluginRequest, now: number): void {
    const { name } = request;
    const reply = (ok: boolean, text: string) => answer(this.#dataPath, request.id, { ok, message: text });
    const appliance = this.#appliances.get(name);
    if (!appliance) {
      reply(false, `${name} is not running here yet: is it paired?`);
      return;
    }
    if (request.action === 'forget') {
      appliance.monitor.forget(now);
      this.#store?.update(name, { learned: undefined, cycles: undefined, standbyWatts: undefined, runs: [] });
      this.log.info(`${name}: forgot what was learned — learning again from the next cycle`);
      reply(true, 'Forgotten. It learns again from the next cycle.');
      return;
    }
    if (!this.#recorder) {
      reply(false, 'Turn on "Record power readings" first: learning needs the recording.');
      return;
    }
    const samples = readSamples(this.#recorder.dir, name, request.from - BEFORE_MS, request.to + AFTER_MS);
    const learned = appliance.monitor.learnFromMarked(samples, { startedAt: request.from, endedAt: request.to }, now);
    if (!learned) {
      reply(false, 'Nothing to learn there: the draw never went well above where the appliance rests.');
      return;
    }
    this.log.info(`${name}: that was learned from a cycle marked on the Power tab`);
    // What is used now: a threshold fixed in the settings wins over a learned one.
    const { runWatts, finishSeconds } = appliance.monitor.params;
    reply(true, `Running above ${formatWatts(runWatts)}, finished after ${formatDuration(finishSeconds)} below it.`);
  }

  /** Resets the statistics the settings page asked to; see resets.ts. */
  #reset(now: number): void {
    const names = pendingResets(this.#dataPath);
    if (names.length === 0) {
      return;
    }
    for (const name of names) {
      this.#appliances.get(name)?.energy.reset(now);
      delete this.#ledger[name];
      const record = this.#store?.get(name);
      if (record?.counts || record?.lastCycle) {
        this.#store!.update(name, { counts: undefined, lastCycle: undefined });
      }
      this.log.info(`${name}: statistics reset`);
    }
    this.#saveEnergy(true);
    clearResets(this.#dataPath);
  }

  #onTransition(device: DeviceConfig, accessory: ApplianceAccessory | undefined, transition: Transition): void {
    accessory?.update(transition.to);
    const appliance = this.#appliances.get(device.name);
    this.#tellRunning(transition.at);
    if (appliance) {
      this.#checkTimed(appliance, transition.at);
    }
    this.#store?.update(device.name, {
      state: transition.to,
      since: transition.at,
      cycleWattHours: undefined,
      cyclePeakWatts: undefined,
    });

    const { cycle } = transition;
    if (cycle) {
      this.#store?.increment(device.name, FINISHED, transition.at);
      this.#store?.update(device.name, {
        lastCycle: { startedAt: cycle.startedAt, endedAt: transition.at, seconds: cycle.seconds, wattHours: cycle.wattHours },
        runs: withRun(runsOf(this.#store.get(device.name)), {
          seconds: cycle.seconds,
          ...this.#startOf(appliance, cycle.startedAt, cycle.startedAt + cycle.seconds * 1000),
        }),
      });
      this.log.info(
        `${device.name}: Finished${cycle.switchedOff ? ' (switched off)' : ''} — ran ${formatDuration(cycle.seconds)}, ` +
          `${(cycle.wattHours / 1000).toFixed(2)} kWh, peak ${formatWatts(cycle.peakWatts)}`,
      );
    } else {
      this.log.info(`${device.name}: ${STATE_NAMES[transition.to]}`);
    }
  }

  /** A finished cycle's first minutes, if the readings reach back to its start. */
  #startOf(appliance: Appliance | undefined, startedAt: number, endedAt: number): { start?: number[] } {
    const start = appliance?.monitor.startOf(startedAt, endedAt);
    return start && start.length > 0 ? { start } : {};
  }

  #logLearned(device: DeviceConfig, learned: Learned, cycles: number): void {
    const { runWatts, finishSeconds } = learned.params;
    this.log.info(
      `${device.name}: learned from ${cycles} cycle${cycles === 1 ? '' : 's'} — running above ${formatWatts(runWatts)} ` +
        `(it rests at ${formatWatts(learned.restWatts)}), finished after ${formatDuration(finishSeconds)} of quiet ` +
        `(longest pause ${formatDuration(learned.longestPauseSeconds)}).`,
    );
  }

  #uuid(name: string): string {
    return this.api.hap.uuid.generate(`${PLUGIN_NAME}:${name}`);
  }

  /** Drops accessories whose plug was removed from config.json, or shows nothing any more. */
  #prune(devices: DeviceConfig[]): void {
    const wanted = new Set(devices.filter(showsInHomeKit).map(({ name }) => this.#uuid(name)));
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
