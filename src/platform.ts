import { join } from 'node:path';

import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import { accessoryName, ApplianceAccessory } from './accessory.ts';
import {
  duplicateNames,
  isChildBridgeProcess,
  showsInHomeKit,
  MATTER_LOG_LEVELS,
  usablePhases,
  usablePollSeconds,
  parsePairingCode,
  validateDeviceConfig,
} from './config.ts';
import type { DeviceConfig, MatterLogLevel, ApplianceMonitorPlatformConfig } from './config.ts';
import { cycleState } from './cycle.ts';
import type { CycleState, Transition } from './cycle.ts';
import { EnergyMeter } from './energy.ts';
import type { DeviceEnergy } from './energy.ts';
import { readJson, writeJson } from './json-file.ts';
import type { Learned } from './learn.ts';
import { activePowerValues, describeNode, MatterController, readActivePower } from './matter.ts';
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
  /** The last power in watts, to know whether the plug is drawing anything. */
  watts?: number;
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
          for (const tracker of appliance.phases) {
            this.#onPhase(appliance, tracker, tracker.tick(now));
          }
        });
      }
    }, TICK_MS);
    this.#energySaver = setInterval(() => this.#saveEnergy(), SAVE_ENERGY_MS);

    const registry = new NodeRegistry(join(this.#dataPath, 'nodes.json'));
    // One after the other: commissioning several plugs at once would open
    // several PASE sessions over the same border router for no gain.
    for (const device of devices) {
      if (this.#stopping) {
        return;
      }
      try {
        await this.#setUp(controller, registry, device);
      } catch (error) {
        this.log.error(`${device.name}: ${message(error)}`);
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
        valid.push({ ...named, phases, pollSeconds });
      }
    }
    for (const name of duplicateNames(valid)) {
      this.log.error(`More than one plug is called "${name}"; only the first is used.`);
    }
    return valid.filter((device, index) => valid.findIndex(({ name }) => name === device.name) === index);
  }

  async #setUp(controller: MatterController, registry: NodeRegistry, device: DeviceConfig): Promise<void> {
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

    const appliance = this.#appliance(device);
    const store = this.#store!;
    let introduced = false;
    let reachable: boolean | undefined;
    await controller.connect(nodeId, {
      onState: (state) => this.#safely(device.name, () => {
        const connected = state === 'Connected';
        // Only a change worth knowing about: lost after having been there, or
        // back after being lost. The steps in between (reconnecting,
        // waiting for discovery) and the start-up connect are left out.
        if (!this.#stopping && reachable !== undefined && connected !== reachable) {
          if (connected) {
            this.log.info(`${device.name}: reachable again`);
          } else if (state === 'Disconnected') {
            this.log.warn(`${device.name}: unreachable`);
          }
        }
        if (connected || state === 'Disconnected') {
          reachable = connected;
        }
      }),
      onReady: (node) => this.#safely(device.name, () => {
        // A device reports changes only, so without this nothing would be
        // known until the first change after every (re)connection.
        const current = activePowerValues(node);
        for (const report of current) {
          this.#onAttribute(appliance, report);
        }
        if (introduced) {
          return;
        }
        introduced = true;
        appliance.accessory?.setInfo(node.basicInformation ?? {});
        // Everything the plug offers, once: when it is new. After that it is
        // one line per start.
        if (!store.get(device.name).described) {
          for (const line of describeNode(node)) {
            this.log.info(`${device.name}:   ${line}`);
          }
          store.update(device.name, { described: true });
        }
        const watts = current.map(({ value }) => activePowerWatts(value)).find((value) => value !== undefined);
        this.log.info(
          [
            `${device.name}: ${node.basicInformation?.productName ?? 'connected'}`,
            formatWatts(watts),
            STATE_NAMES[appliance.monitor.state],
            this.#learnedSummary(appliance),
            ...(device.pollSeconds ? [`asked every ${device.pollSeconds} s`] : []),
          ].join(', '),
        );
        if (device.pollSeconds) {
          this.#poll(appliance, node, device.pollSeconds);
        }
      }),
      onAttribute: (report) => this.#safely(device.name, () => this.#onAttribute(appliance, report)),
    });
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
      readActivePower(node)
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

    const appliance = {
      device,
      monitor,
      accessory: handle,
      energy: new EnergyMeter(this.#ledger[device.name]),
      phases: this.#phaseTrackers(device),
    };
    this.#appliances.set(device.name, appliance);
    return appliance;
  }

  /**
   * A phase only from above has to know where the draw came from, which the
   * recording tells across a restart: a washing machine resting at 3 W is
   * not told again that it is being loaded.
   */
  #phaseTrackers(device: DeviceConfig): PhaseTracker[] {
    const trackers = (device.phases ?? []).map((phase) => new PhaseTracker(phase));
    if (this.#recorder && device.phases?.some(({ rampDown }) => rampDown)) {
      const now = Date.now();
      const samples = readSamples(this.#recorder.dir, device.name, now - RECALL_MS, now);
      for (const tracker of trackers) {
        tracker.recall(samples);
      }
    }
    return trackers;
  }

  #onAttribute(appliance: Appliance, report: AttributeReport): void {
    if (isOnOff(report.clusterId, report.attributeId)) {
      // A plug with a relay switched off: whatever ran there has finished.
      if (report.value === false && appliance.monitor.state === 'running') {
        this.log.debug(`${appliance.device.name}: plug switched off`);
        appliance.monitor.switchedOff(Date.now());
      }
      return;
    }
    if (!isActivePower(report.clusterId, report.attributeId)) {
      return;
    }
    const { device, monitor } = appliance;
    const now = Date.now();
    // A value read on purpose can also come back as a reported change; the
    // second one is not a new reading.
    const { last } = appliance;
    if (last && last.endpointId === report.endpointId && last.value === report.value && now - last.at < 1500) {
      return;
    }
    appliance.last = { endpointId: report.endpointId, value: report.value, at: now };
    const watts = activePowerWatts(report.value);
    if (watts !== undefined) {
      appliance.watts = watts;
    }
    this.#recorder?.record(device.name, report.endpointId, watts);
    monitor.reading(now, watts);
    appliance.energy.reading(now, watts);
    for (const tracker of appliance.phases) {
      this.#onPhase(appliance, tracker, tracker.reading(now, watts));
    }
  }

  #onPhase(appliance: Appliance, tracker: PhaseTracker, change: PhaseChange | undefined): void {
    if (!change) {
      return;
    }
    const { device } = appliance;
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
      this.#store?.update(name, { learned: undefined, cycles: undefined, standbyWatts: undefined });
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
      });
      this.log.info(
        `${device.name}: Finished${cycle.switchedOff ? ' (switched off)' : ''} — ran ${formatDuration(cycle.seconds)}, ` +
          `${(cycle.wattHours / 1000).toFixed(2)} kWh, peak ${formatWatts(cycle.peakWatts)}`,
      );
    } else {
      this.log.info(`${device.name}: ${STATE_NAMES[transition.to]}`);
    }
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
