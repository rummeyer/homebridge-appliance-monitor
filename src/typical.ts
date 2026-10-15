/**
 * How long a cycle usually takes, for the dashboard to say how long the
 * running one has left.
 *
 * From the last few cycles: their median, but only if most of them are
 * close to it. A dishwasher that runs the same programme every night has a
 * usual length; a desk, or a washing machine on quick washes and long ones
 * by turns, has none, and is better told nothing than something wrong.
 */

import type { DeviceRecord } from './store.ts';

/** How many cycles are kept. */
export const KEEP_CYCLES = 10;
/** Fewer than this tells nothing about what is usual. */
export const MIN_CYCLES = 2;
/** Close to the median: within this share of it. */
const CLOSE = 0.3;
/** How many of the cycles have to be close to it. */
const MOST = 2 / 3;

/**
 * How long the last cycles ran. Kept since 1.7.0; before that only the last
 * one was, which is where an appliance starts from.
 */
export function durationsOf(record: DeviceRecord): number[] {
  return record.durations ?? (record.lastCycle ? [record.lastCycle.seconds] : []);
}

/** The durations with one more, keeping the last KEEP_CYCLES. */
export const withDuration = (durations: number[], seconds: number): number[] => [...durations, seconds].slice(-KEEP_CYCLES);

/** The usual length in seconds, or undefined if there is none. */
export function typicalSeconds(durations: number[] | undefined): number | undefined {
  const list = (durations ?? []).filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  if (list.length < MIN_CYCLES) {
    return undefined;
  }
  const sorted = [...list].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const close = list.filter((seconds) => Math.abs(seconds - median) <= median * CLOSE).length;
  return close >= list.length * MOST ? Math.round(median) : undefined;
}
