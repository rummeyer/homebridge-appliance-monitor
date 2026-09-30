import type { PlatformConfig } from 'homebridge';
import { ManualPairingCodeCodec, QrPairingCodeCodec } from '@matter/main/types';

import type { CycleParams, ResetMode, ResetOptions } from './cycle.ts';

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
  /** Show "running" in HomeKit, as an occupancy sensor. On by default. */
  runningSensor?: boolean;
  /** Show "finished" in HomeKit, as a contact sensor that opens. On by default. */
  finishedSensor?: boolean;
  /** Names for the two sensors; default "<name> Running" and "<name> Finished". */
  runningName?: string;
  finishedName?: string;
  /** When "finished" goes back to off. See ResetMode. Default `off-level`. */
  finishedReset?: ResetMode;
  /** For the `timeout` reset. */
  finishedResetMinutes?: number;
  /**
   * Fixed values instead of learned ones, each on its own. Anything left out
   * is learned from the appliance's cycles.
   */
  thresholds?: Partial<CycleParams>;
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

export interface OutletMonitorPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
  /**
   * Write every power reading to a CSV file next to the pairing data.
   * On by default: the state machine that comes next is tuned on a recording
   * of a real wash cycle, and this is where that recording comes from.
   */
  recordPower?: boolean;
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
  const { name, pairingCode, finishedReset, finishedResetMinutes, thresholds } = device as Partial<DeviceConfig>;
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
