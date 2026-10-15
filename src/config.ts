import type { PlatformConfig } from 'homebridge';
import { ManualPairingCodeCodec, QrPairingCodeCodec } from '@matter/main/types';

import type { CycleParams } from './cycle.ts';
import { DEFAULT_MIN_SECONDS } from './phases.ts';
import type { PhaseConfig } from './phases.ts';

/** One plug, as configured in Homebridge's config.json. */
export interface DeviceConfig {
  /**
   * What the plug is called in the log and in the recording.
   *
   * Also the key under which the plug's Matter node ID is remembered once it
   * is paired, so renaming a plug means pairing it again.
   */
  name: string;
  /**
   * The setup code the Home app shows under "Turn On Pairing Mode" — eleven
   * digits, with or without the dashes — or an `MT:` QR payload.
   *
   * Only needed until the plug is paired. The Home app keeps the pairing
   * window open for fifteen minutes, so Homebridge has to be restarted with
   * the code in place inside that time.
   */
  pairingCode?: string;
  /**
   * Another appliance whose pairing this one shares, instead of a pairing
   * code of its own: for a device behind a Matter bridge, which is paired
   * once and carries many devices. See bridged.ts.
   */
  pairedWith?: string;
  /**
   * Which device of a bridge — or channel of a plug with several — this
   * appliance follows: the bridged device's UniqueID, which stays when the
   * bridge renumbers its endpoints. Without it, every reading counts.
   */
  deviceId?: string;
  /** The same by endpoint number, for a device that has no UniqueID. */
  endpoint?: number;
  /**
   * Another appliance whose plug measures this one too: a lamp with a power
   * reading of its own, say, plugged into a metered socket strip. It keeps
   * its own figures, but is left out of every total, where it would
   * otherwise be counted twice.
   */
  partOf?: string;
  /** A Running switch in HomeKit, on while the appliance runs. On by default. */
  runningSwitch?: boolean;
  /**
   * How Running is shown: a switch (the default), an occupancy sensor, which
   * reads better for a desk — taken while it draws power, free when not — or
   * an outlet, for the outlet's icon. All three only show; tapping changes nothing.
   */
  runningAs?: RunningAs;
  /**
   * An Overtime sensor in HomeKit, which turns on once the appliance has
   * been running this many minutes in one go — a TV on all night, a long
   * day at a desk — and off when it finishes. None if not set.
   */
  overtimeMinutes?: number;
  /** What overtimeMinutes was called in 1.7.0, as Left On. */
  leftOnMinutes?: number;
  /**
   * An Idle On sensor in HomeKit, which turns on once the appliance has been
   * drawing power this many minutes without running — a PC asleep, a desk
   * left on overnight — and off when it runs again or draws nothing. None if not set.
   */
  idleOnMinutes?: number;
  /**
   * What Idle On counts from instead: the end of the last time this phase
   * ran — 10 minutes after the last coffee drawn, say, for a coffee machine
   * keeping itself warm, which never stops running. Off again when the
   * phase runs again or the plug draws nothing.
   */
  idleOnFrom?: string;
  /** What runningSwitch was called while it was a sensor. */
  runningSensor?: boolean;
  /**
   * The Finished switch of earlier versions, and the sensor before it. No
   * longer used: Running going off is the appliance finishing.
   */
  finishedSwitch?: boolean;
  finishedSensor?: boolean;
  /**
   * When Finished went back to Off, once a setting (`off-level`, `timeout`,
   * `next-start`). No longer used: with nothing in HomeKit telling the two
   * apart, it only decided when the log said Off.
   */
  finishedReset?: string;
  finishedResetMinutes?: number;
  /**
   * Fixed values instead of learned ones, each on its own. Anything left out
   * is learned from the appliance's cycles.
   */
  thresholds?: Partial<CycleParams>;
  /** What the appliance is doing inside a cycle, by power band. See phases.ts. */
  phases?: PhaseConfig[];
  /**
   * Ask the plug for its power this often, in seconds, as well as listening
   * for what it reports. For plugs that report too seldom to see something
   * short; each ask is a message over the network, so only where needed.
   */
  pollSeconds?: number;
}

export const MIN_POLL_SECONDS = 2;

export type RunningAs = 'switch' | 'occupancy' | 'outlet';
export const RUNNING_AS: readonly RunningAs[] = ['switch', 'occupancy', 'outlet'];

/** Whether the appliance has a Running switch; the earlier sensor setting counts too. */
export const showsRunning = (device: DeviceConfig): boolean => (device.runningSwitch ?? device.runningSensor) !== false;

/** Whether a device shows anything in HomeKit; one with nothing is only counted. */
export function showsInHomeKit(device: DeviceConfig): boolean {
  return (
    showsRunning(device) ||
    usableMinutes(device, 'overtime').minutes !== undefined ||
    usableMinutes(device, 'idleOn').minutes !== undefined ||
    usablePhases(device).phases.some((phase) => phase.sensor !== false)
  );
}

export type MatterLogLevel = 'debug' | 'info' | 'notice' | 'warn' | 'error';

export interface ApplianceMonitorPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
  /**
   * Write every power reading to a CSV file next to the pairing data.
   * On by default: the state machine that comes next is tuned on a recording
   * of a real wash cycle, and this is where that recording comes from.
   */
  recordPower?: boolean;
  /** How many days of recordings to keep, one file each. */
  recordDays?: number;
  /** How much of matter.js's own logging reaches the Homebridge log. */
  matterLogLevel?: MatterLogLevel;
  /**
   * A read-only page with each appliance's power and statistics, to be
   * opened in a browser without logging in to Homebridge. Off by default.
   */
  dashboard?: boolean;
  /** Its port; DEFAULT_DASHBOARD_PORT if not set. */
  dashboardPort?: number;
}

export const DEFAULT_DASHBOARD_PORT = 8582;

/**
 * The dashboard's port, or none when it is off, and why there is none if one
 * was asked for. On when switched on — or, as 1.2.0 had no switch, when only
 * a port is set. A port that is no port turns it off rather than costing the
 * plugin.
 */
export function usableDashboardPort(config: ApplianceMonitorPlatformConfig): { port: number | undefined; problem?: string } {
  const { dashboard, dashboardPort } = config;
  const portSet = dashboardPort !== undefined && dashboardPort !== null;
  if (!(dashboard ?? portSet)) {
    return { port: undefined };
  }
  if (!portSet) {
    return { port: DEFAULT_DASHBOARD_PORT };
  }
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) {
    return { port: undefined, problem: `dashboardPort ${String(dashboardPort)} is not a port from 1 to 65535; no dashboard` };
  }
  return { port: dashboardPort };
}

export const MATTER_LOG_LEVELS: readonly MatterLogLevel[] = ['debug', 'info', 'notice', 'warn', 'error'];

/** What a pairing code tells the controller: whom to look for, and the secret. */
export interface PairingData {
  passcode: number;
  identifier: { shortDiscriminator: number } | { longDiscriminator: number };
}

/**
 * Reads the code the Home app shows, or a QR payload.
 *
 * Returns undefined for anything that is not a valid code — the codecs check
 * the check digit and reject the trivial passcodes, so a typo is caught here
 * rather than after half a minute of discovery.
 */
export function parsePairingCode(code: string): PairingData | undefined {
  const trimmed = code.trim();
  try {
    if (/^MT:/i.test(trimmed)) {
      const [data] = QrPairingCodeCodec.decode(trimmed.toUpperCase());
      if (!data) {
        return undefined;
      }
      return { passcode: data.passcode, identifier: { longDiscriminator: data.discriminator } };
    }

    const digits = trimmed.replace(/[\s-]/g, '');
    if (!/^(\d{11}|\d{21})$/.test(digits)) {
      return undefined;
    }
    const data = ManualPairingCodeCodec.decode(digits);
    if (data.shortDiscriminator === undefined) {
      return undefined;
    }
    return { passcode: data.passcode, identifier: { shortDiscriminator: data.shortDiscriminator } };
  } catch {
    return undefined;
  }
}

/** Returns a message per problem, or none when the device can be used. */
export function validateDeviceConfig(device: unknown, index: number): string[] {
  if (device === null || typeof device !== 'object') {
    return [`devices[${index}] is not an object`];
  }
  const { name, pairingCode, thresholds, runningAs, pairedWith, deviceId, endpoint } = device as Partial<DeviceConfig>;
  const label = typeof name === 'string' && name.trim() ? `"${name}"` : `devices[${index}]`;
  const problems: string[] = [];

  if (typeof name !== 'string' || name.trim() === '') {
    problems.push(`${label} has no name`);
  }
  if (pairingCode !== undefined && pairingCode !== '') {
    if (typeof pairingCode !== 'string' || parsePairingCode(pairingCode) === undefined) {
      problems.push(`${label} has a pairing code that is not a valid Matter setup code`);
    }
  }
  if (pairedWith !== undefined && pairedWith !== null && (typeof pairedWith !== 'string' || !pairedWith.trim())) {
    problems.push(`${label} has a pairedWith that is no appliance name`);
  }
  if (deviceId !== undefined && deviceId !== null && typeof deviceId !== 'string') {
    problems.push(`${label} has a deviceId that is not text`);
  }
  if (endpoint !== undefined && endpoint !== null && (!Number.isInteger(endpoint) || endpoint < 0)) {
    problems.push(`${label} has an endpoint that is not an endpoint number`);
  }
  if (runningAs !== undefined && runningAs !== null && !RUNNING_AS.includes(runningAs)) {
    problems.push(`${label} has an unknown runningAs "${String(runningAs)}"`);
  }
  if (thresholds !== undefined && thresholds !== null) {
    for (const [key, value] of Object.entries(thresholds)) {
      if (value !== undefined && value !== null && (typeof value !== 'number' || !(value >= 0))) {
        problems.push(`${label} has a threshold ${key} that is not a number of 0 or more`);
      }
    }
  }
  return problems;
}

/**
 * How often to ask the plug, and why that differs from the config if it
 * does. Too short an interval is lengthened to the shortest allowed rather
 * than costing the whole plug, as a typo in the settings would otherwise
 * stop it being watched at all; one that is not a number means only
 * listening.
 */
export function usablePollSeconds(device: DeviceConfig): { pollSeconds: number | undefined; problem?: string } {
  const { name, pollSeconds } = device;
  if (pollSeconds === undefined || pollSeconds === null) {
    return { pollSeconds: undefined };
  }
  if (typeof pollSeconds !== 'number' || !Number.isFinite(pollSeconds)) {
    return { pollSeconds: undefined, problem: `"${name}" has a pollSeconds that is not a number; only listening` };
  }
  if (pollSeconds < MIN_POLL_SECONDS) {
    return {
      pollSeconds: MIN_POLL_SECONDS,
      problem: `"${name}" has pollSeconds ${pollSeconds}; asking every ${MIN_POLL_SECONDS} s, the shortest allowed`,
    };
  }
  return { pollSeconds };
}

/**
 * The phase Idle On counts from, if one is set and is one of the
 * appliance's phases, and why not if it was set but is not.
 */
export function usableIdleOnFrom(device: DeviceConfig, phases: PhaseConfig[]): { from: string | undefined; problem?: string } {
  const { name, idleOnFrom } = device;
  if (idleOnFrom === undefined || idleOnFrom === null || idleOnFrom === '') {
    return { from: undefined };
  }
  const from = typeof idleOnFrom === 'string' ? idleOnFrom.trim() : '';
  if (!phases.some((phase) => phase.name.trim() === from)) {
    return { from: undefined, problem: `"${name}" has an idleOnFrom that is none of its phases; Idle On counts from when it stops running` };
  }
  return { from };
}

/** The sensors that turn on after a time: running too long, or drawing power too long without running. */
export type TimedSensor = 'overtime' | 'idleOn';

export const TIMED_SENSORS: Record<TimedSensor, { key: 'overtimeMinutes' | 'idleOnMinutes'; label: string }> = {
  overtime: { key: 'overtimeMinutes', label: 'Overtime' },
  idleOn: { key: 'idleOnMinutes', label: 'Idle On' },
};

/**
 * After how many minutes the sensor turns on, if it is wanted, and why not
 * if it was set but is no number of minutes. Wrong costs only the sensor,
 * not the plug. Overtime is read from 1.7.0's leftOnMinutes too.
 */
export function usableMinutes(device: DeviceConfig, sensor: TimedSensor): { minutes: number | undefined; problem?: string } {
  const { key, label } = TIMED_SENSORS[sensor];
  const minutes = sensor === 'overtime' ? device.overtimeMinutes ?? device.leftOnMinutes : device[key];
  if (minutes === undefined || minutes === null) {
    return { minutes: undefined };
  }
  if (typeof minutes !== 'number' || !(minutes > 0) || !Number.isFinite(minutes)) {
    return { minutes: undefined, problem: `"${device.name}" has an ${key} that is not a number above 0; no ${label} sensor` };
  }
  return { minutes };
}

/**
 * The phases of a device that can be used, and why any others cannot.
 *
 * Checked apart from the device, because a phase that is wrong should cost
 * that phase, not the whole plug. And an entry with neither a name nor a
 * range is skipped without a word: the settings page offers an empty phase
 * under every plug, and may save it as it is.
 */
export function usablePhases(device: DeviceConfig): { phases: PhaseConfig[]; problems: string[] } {
  const phases: PhaseConfig[] = [];
  const problems: string[] = [];
  const list: unknown = device.phases;
  if (list === undefined || list === null) {
    return { phases, problems };
  }
  if (!Array.isArray(list)) {
    return { phases, problems: [`"${device.name}" has phases that are not a list`] };
  }
  const seen = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const { fromAbove, rampDown, ...rest } = (entry ?? {}) as Partial<PhaseConfig> & { fromAbove?: unknown; rampDown?: unknown };
    // What 1.1.1 called rampDown, and 1.1.0 fromAbove.
    const earlier = rampDown ?? fromAbove;
    const phase: Partial<PhaseConfig> = rest.onDown === undefined && earlier !== undefined
      ? { ...rest, onDown: earlier as boolean }
      : rest;
    const name = typeof phase.name === 'string' ? phase.name.trim() : '';
    const { minWatts, maxWatts } = phase;
    const hasRange = (minWatts !== undefined && minWatts !== null) || (maxWatts !== undefined && maxWatts !== null);
    if (!name && !hasRange) {
      continue;
    }
    const what = `"${device.name}" phase ${name ? `"${name}"` : index + 1}`;
    const wrong: string[] = [];
    if (!name) {
      wrong.push('has no name');
    } else if (seen.has(name)) {
      wrong.push('is there twice');
    }
    const open = maxWatts === undefined || maxWatts === null;
    if (typeof minWatts !== 'number' || !(minWatts >= 0)) {
      wrong.push('needs a "from" of 0 W or more');
    } else if (!open && !(typeof maxWatts === 'number' && maxWatts > minWatts)) {
      wrong.push('needs its "below" to be more than its "from", or empty for no upper end');
    }
    for (const key of ['minSeconds', 'holdSeconds'] as const) {
      const value = phase[key];
      if (value !== undefined && value !== null && (typeof value !== 'number' || !(value >= 0))) {
        wrong.push(`has a ${key} that is not a number of 0 or more`);
      }
    }
    const { maxSeconds } = phase;
    if (maxSeconds !== undefined && maxSeconds !== null) {
      if (typeof maxSeconds !== 'number' || !(maxSeconds > 0)) {
        wrong.push('has a maxSeconds that is not a number above 0');
      } else if (maxSeconds <= (typeof phase.minSeconds === 'number' ? phase.minSeconds : DEFAULT_MIN_SECONDS)) {
        wrong.push('needs its "shorter than" to be more than its "on after", or it never happens');
      }
    }
    for (const key of ['count', 'onDown'] as const) {
      const value = phase[key];
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        wrong.push(`has a ${key} that is not on or off`);
      }
    }
    if (wrong.length > 0) {
      problems.push(`${what} ${wrong.join(', and ')}`);
      continue;
    }
    seen.add(name);
    phases.push({
      ...phase,
      name,
      minWatts: minWatts!,
      maxWatts: typeof maxWatts === 'number' ? maxWatts : undefined,
      // Empty number fields arrive as null; those mean the default.
      minSeconds: typeof phase.minSeconds === 'number' ? phase.minSeconds : undefined,
      holdSeconds: typeof phase.holdSeconds === 'number' ? phase.holdSeconds : undefined,
      maxSeconds: typeof maxSeconds === 'number' ? maxSeconds : undefined,
    });
  }
  return { phases, problems };
}

/** Names must be unique: they are what a paired plug is remembered by. */
/**
 * Why an appliance cannot share the pairing it names, or nothing when it can:
 * the other has to be configured, and to have a pairing of its own.
 */
export function pairedWithProblem(device: DeviceConfig, devices: DeviceConfig[]): string | undefined {
  const { name, pairedWith } = device;
  if (pairedWith === undefined || pairedWith === null) {
    return undefined;
  }
  const owner = devices.find((other) => other.name === pairedWith.trim());
  if (!owner || owner === device) {
    return `"${name}" is paired with "${pairedWith}", which is no other appliance here`;
  }
  if (owner.pairedWith) {
    return `"${name}" is paired with "${pairedWith}", which is itself paired with "${owner.pairedWith}"; name that one instead`;
  }
  return undefined;
}

/**
 * What is wrong with an appliance's partOf, if anything: it has to name
 * another appliance here, and following it on must not lead back round.
 */
export function partOfProblem(device: DeviceConfig, devices: DeviceConfig[]): string | undefined {
  const { name, partOf } = device;
  if (partOf === undefined || partOf === null || partOf === '') {
    return undefined;
  }
  if (typeof partOf !== 'string') {
    return `"${name}" has a partOf that is no appliance name`;
  }
  const seen = new Set<DeviceConfig>([device]);
  for (let current = device; typeof current.partOf === 'string' && current.partOf.trim(); ) {
    const whole = devices.find((other) => other.name === current.partOf!.trim());
    if (!whole || whole === current) {
      return current === device
        ? `"${name}" is part of "${partOf}", which is no other appliance here`
        : undefined;
    }
    if (seen.has(whole)) {
      return `"${name}" is part of "${partOf}", which leads back round to "${whole.name}"`;
    }
    seen.add(whole);
    current = whole;
  }
  return undefined;
}

/** The appliance whose plug measures this one too, if its partOf holds. */
export function wholeOf(device: DeviceConfig, devices: DeviceConfig[]): string | undefined {
  if (typeof device.partOf !== 'string' || !device.partOf.trim() || partOfProblem(device, devices) !== undefined) {
    return undefined;
  }
  return device.partOf.trim();
}

/**
 * The appliances with each one's parts right after it, by name, and how
 * deep each sits: a lamp in a strip in a room meter is two below the room.
 * Otherwise in the order given.
 */
export function withParts<T extends DeviceConfig>(devices: T[]): { device: T; depth: number }[] {
  const ordered: { device: T; depth: number }[] = [];
  const add = (device: T, depth: number): void => {
    ordered.push({ device, depth });
    devices
      .filter((part) => wholeOf(part, devices) === device.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
      .forEach((part) => add(part, depth + 1));
  };
  for (const device of devices) {
    if (wholeOf(device, devices) === undefined) {
      add(device, 0);
    }
  }
  return ordered;
}

/** Whether an appliance counts in the totals: not when another plug measures it too. */
export function countsInTotal(device: DeviceConfig, devices: DeviceConfig[]): boolean {
  return wholeOf(device, devices) === undefined;
}

export function duplicateNames(devices: DeviceConfig[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of devices) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }
  return [...duplicates];
}

/**
 * Whether this process is a Homebridge child bridge.
 *
 * Homebridge strips `_bridge` from the config it hands a child bridge, so the
 * config cannot tell. The process title can: a child bridge is renamed to
 * `homebridge: <plugin name>`, the main process is plain `homebridge`.
 */
export const isChildBridgeProcess = (title: string = process.title): boolean => title.startsWith('homebridge: ');
