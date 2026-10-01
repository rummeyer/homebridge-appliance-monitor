import type { PlatformConfig } from 'homebridge';
import { ManualPairingCodeCodec, QrPairingCodeCodec } from '@matter/main/types';

import type { CycleParams, ResetMode, ResetOptions } from './cycle.ts';
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
  /** A Running switch in HomeKit, on while the appliance runs. On by default. */
  runningSwitch?: boolean;
  /** What runningSwitch was called while it was a sensor. */
  runningSensor?: boolean;
  /**
   * The Finished switch of earlier versions, and the sensor before it. No
   * longer used: Running going off is the appliance finishing.
   */
  finishedSwitch?: boolean;
  finishedSensor?: boolean;
  /**
   * When the state goes from finished back to off. See ResetMode. No longer
   * offered in the settings, since HomeKit only shows Running; it only
   * decides when the log says Off.
   */
  finishedReset?: ResetMode;
  /** For the `timeout` reset. */
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

/** Whether the appliance has a Running switch; the earlier sensor setting counts too. */
export const showsRunning = (device: DeviceConfig): boolean => (device.runningSwitch ?? device.runningSensor) !== false;

/** Whether a device shows anything in HomeKit; one with nothing is only counted. */
export function showsInHomeKit(device: DeviceConfig): boolean {
  return (
    showsRunning(device) ||
    usablePhases(device).phases.some((phase) => phase.sensor !== false)
  );
}

export const RESET_MODES: readonly ResetMode[] = ['off-level', 'timeout', 'next-start'];
export const DEFAULT_RESET_MINUTES = 60;

/** The reset a device asked for, with the defaults filled in. */
export function resetOptions(device: DeviceConfig): ResetOptions {
  return {
    mode: device.finishedReset ?? 'off-level',
    minutes: device.finishedResetMinutes ?? DEFAULT_RESET_MINUTES,
  };
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
  const { name, pairingCode, finishedReset, finishedResetMinutes, thresholds, pollSeconds } = device as Partial<DeviceConfig>;
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
  if (finishedReset !== undefined && !RESET_MODES.includes(finishedReset)) {
    problems.push(`${label} has an unknown finishedReset "${String(finishedReset)}"`);
  }
  if (
    finishedResetMinutes !== undefined &&
    (typeof finishedResetMinutes !== 'number' || !(finishedResetMinutes > 0))
  ) {
    problems.push(`${label} needs finishedResetMinutes above 0`);
  }
  if (
    pollSeconds !== undefined &&
    pollSeconds !== null &&
    (typeof pollSeconds !== 'number' || !(pollSeconds >= MIN_POLL_SECONDS))
  ) {
    problems.push(`${label} needs pollSeconds of ${MIN_POLL_SECONDS} or more, or none`);
  }
  if (thresholds !== undefined && thresholds !== null) {
    for (const [key, value] of Object.entries(thresholds)) {
      if (value !== undefined && value !== null && (typeof value !== 'number' || !(value >= 0))) {
        problems.push(`${label} has a threshold ${key} that is not a number of 0 or more`);
      }
    }
    const { runWatts, offWatts } = thresholds;
    if (typeof runWatts === 'number' && typeof offWatts === 'number' && offWatts >= runWatts) {
      problems.push(`${label} has an off level (${offWatts} W) that is not below the running level (${runWatts} W)`);
    }
  }
  return problems;
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
    const phase = (entry ?? {}) as Partial<PhaseConfig>;
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
    if (phase.count !== undefined && phase.count !== null && typeof phase.count !== 'boolean') {
      wrong.push('has a count that is not on or off');
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
