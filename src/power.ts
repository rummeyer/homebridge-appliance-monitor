/**
 * Where a device reports its power draw, and how to turn that into watts.
 *
 * Only the standard place: the Electrical Power Measurement cluster. It is
 * what the Home app reads to show watts for a Matter device, so any device
 * that shows watts there without Homebridge has it — Eve and Shelly alike,
 * and whether or not the device can switch.
 */

/** Electrical Power Measurement, Matter 1.3. */
export const ELECTRICAL_POWER_MEASUREMENT = 0x0090;
/** ActivePower, in milliwatts. Nullable: null means "not measured right now". */
export const ACTIVE_POWER = 0x0008;

export const isActivePower = (clusterId: number, attributeId: number): boolean =>
  clusterId === ELECTRICAL_POWER_MEASUREMENT && attributeId === ACTIVE_POWER;

/**
 * ActivePower in watts. The attribute is int64, so it arrives as a number or
 * a bigint; undefined when the device reports that it has no reading.
 */
export function activePowerWatts(value: unknown): number | undefined {
  if (typeof value === 'bigint') {
    return Number(value) / 1000;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value / 1000;
  }
  return undefined;
}

export const hex = (value: number, width = 4): string => `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;

/** Watts with as many decimals as are useful at that size. */
export const formatWatts = (watts: number | undefined): string =>
  watts === undefined ? 'no reading' : `${watts.toFixed(watts < 10 ? 2 : 1)} W`;

/** "45 s", "9 min 50 s", "1 h 23 min". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total} s`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
