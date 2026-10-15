/**
 * How long a cycle usually takes, for the dashboard to say how long the
 * running one has left.
 *
 * From the last few cycles: their median, but only if most of them are
 * close to it. A dishwasher that runs the same programme every night has a
 * usual length; a desk has none, and is better told nothing than something
 * wrong.
 *
 * A washing machine on quick washes and long ones by turns has none either,
 * taken all together — but its programmes start differently: one heats
 * straight away, another turns the drum for a quarter of an hour first. So
 * each cycle's first minutes are kept with its length, and once a running
 * cycle has gone a few minutes, only the cycles that started alike count.
 */

import type { Sample } from './learn.ts';
import type { DeviceRecord } from './store.ts';

/** How many cycles are kept: enough for a few of each programme. */
export const KEEP_CYCLES = 20;
/** Fewer than this tells nothing about what is usual. */
export const MIN_CYCLES = 2;
/** Close to the median: within this share of it. */
const CLOSE = 0.3;
/** How many of the cycles have to be close to it. */
const MOST = 2 / 3;

/**
 * How many first minutes of a cycle are kept. A washing machine's
 * programmes differ from the second minute on; later, the same programme
 * at another temperature heats for longer, and would look like another one.
 */
export const START_MINUTES = 10;
/** A running cycle is compared from this many minutes on. */
export const MIN_START_MINUTES = 3;
/** Starts at most this different are alike; see difference(). */
const ALIKE = 0.3;

/** A finished cycle: how long it ran, and what it drew in its first minutes, in W per minute. */
export interface Run {
  seconds: number;
  start?: number[];
}

/**
 * The last cycles. Kept since 1.9.0 with their starts; from 1.7.0 their
 * lengths only; before that only the last one, which is where an appliance
 * starts from.
 */
export function runsOf(record: DeviceRecord): Run[] {
  if (record.runs) {
    return record.runs;
  }
  return (record.durations ?? (record.lastCycle ? [record.lastCycle.seconds] : [])).map((seconds) => ({ seconds }));
}

/** The runs with one more, keeping the last KEEP_CYCLES. */
export const withRun = (runs: Run[], run: Run): Run[] => [...runs, run].slice(-KEEP_CYCLES);

/** The usual length in seconds of cycles this long, or undefined if there is none. */
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

/**
 * The mean draw of each whole minute from `startedAt` up to `until`, at
 * most START_MINUTES, from readings that hold until the next. Nothing when
 * the readings do not reach back to the start, as after a restart mid-cycle.
 */
export function startOf(samples: Sample[], startedAt: number, until: number): number[] | undefined {
  const first = samples.findIndex(({ at }) => at > startedAt) - 1;
  const from = first === -2 ? samples.length - 1 : first;
  if (from < 0) {
    return undefined;
  }
  const minutes = Math.min(START_MINUTES, Math.floor((until - startedAt) / 60_000));
  const means: number[] = [];
  let index = from;
  for (let minute = 0; minute < minutes; minute++) {
    const begin = startedAt + minute * 60_000;
    const end = begin + 60_000;
    let wattMs = 0;
    for (let at = begin; at < end; ) {
      while (index + 1 < samples.length && samples[index + 1]!.at <= at) {
        index++;
      }
      const next = index + 1 < samples.length ? Math.min(end, samples[index + 1]!.at) : end;
      wattMs += samples[index]!.watts * (next - at);
      at = next;
    }
    means.push(Math.round(wattMs / 60_000));
  }
  return means;
}

/**
 * How different two starts are, over the minutes both have: what they
 * differ by, as a share of what both drew — 0 for the same, 1 for nothing
 * in common. Undefined for too few minutes to tell.
 */
export function difference(a: number[], b: number[]): number | undefined {
  const minutes = Math.min(a.length, b.length);
  if (minutes < MIN_START_MINUTES) {
    return undefined;
  }
  let apart = 0;
  let drawn = 0;
  for (let minute = 0; minute < minutes; minute++) {
    apart += Math.abs(a[minute]! - b[minute]!);
    drawn += a[minute]! + b[minute]!;
  }
  return drawn > 0 ? apart / drawn : 0;
}

const alike = (a: number[] | undefined, b: number[]): boolean => a !== undefined && (difference(a, b) ?? 1) <= ALIKE;

/**
 * The usual length of a cycle that started as `start` did. Once there are
 * starts to compare with, only the cycles that started alike count — none
 * for a start not seen before, rather than the length of something else.
 * Before, all cycles count.
 */
export function usualSeconds(runs: Run[], start?: number[]): number | undefined {
  const known = runs.filter((run) => run.start);
  if (start && start.length >= MIN_START_MINUTES && known.length >= MIN_CYCLES) {
    return typicalSeconds(known.filter((run) => alike(run.start, start)).map(({ seconds }) => seconds));
  }
  return typicalSeconds(runs.map(({ seconds }) => seconds));
}

/**
 * The usual lengths of the kinds of cycle that start differently, shortest
 * first, for the Statistics tab: for a washing machine, one per programme it
 * runs often enough. Each cycle joins the first kind it starts like.
 */
export function usualByStart(runs: Run[]): number[] {
  const kinds: Run[][] = [];
  for (const run of runs.filter((each) => each.start && each.start.length >= MIN_START_MINUTES)) {
    const kind = kinds.find(([first]) => alike(first!.start, run.start!));
    if (kind) {
      kind.push(run);
    } else {
      kinds.push([run]);
    }
  }
  return kinds
    .map((kind) => typicalSeconds(kind.map(({ seconds }) => seconds)))
    .filter((seconds): seconds is number => seconds !== undefined)
    .sort((a, b) => a - b);
}
