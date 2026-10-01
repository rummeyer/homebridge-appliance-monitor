/**
 * Working out an appliance's thresholds from one cycle of its power draw.
 *
 * The cycle has already been found, with generous defaults: anything well
 * above a trickle is running, and it is over after half an hour of quiet.
 * What that cannot know, and this works out, is:
 *
 * - the level the machine rests at when it is on but not working, and so
 *   where "running" starts (runWatts);
 * - the longest pause inside the programme, and so how long a quiet spell
 *   has to last before it is the end (finishSeconds).
 *
 * Readings are a step function: a device reports when its draw changes, so
 * each reading holds until the next.
 */
import type { CycleParams } from './cycle.ts';

export interface Sample {
  at: number;
  watts: number;
}

export interface CycleWindow {
  /** When the draw first rose for good. */
  startedAt: number;
  /** When it last fell for good — the start of the final quiet spell. */
  endedAt: number;
}

export interface Learned {
  params: CycleParams;
  /** The level the machine rests at when finished, in W. */
  restWatts: number;
  /** The longest pause inside the cycle, in seconds. */
  longestPauseSeconds: number;
}

/** Below this, a draw is "nothing": plugs read a few tenths of a watt with no load. */
export const NOTHING_WATTS = 0.5;

/** Where running starts for a machine resting at this level: clearly above it. */
export const runLevelAbove = (restingWatts: number): number => round1(Math.max(restingWatts * 2, restingWatts + 2));
/** The stretch after the final drop that shows where the machine rests. */
const REST_WINDOW_MS = 10 * 60_000;

const MIN_FINISH_SECONDS = 120;
const MAX_FINISH_SECONDS = 3600;

/**
 * `switchedOff`: the cycle ended with the plug being switched off, so what
 * came after shows nothing about where the machine rests, and the running
 * level stays as it is. The pause is learned all the same.
 */
export function learnFromCycle(
  samples: Sample[],
  cycle: CycleWindow,
  current: CycleParams,
  switchedOff = false,
): Learned | undefined {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const before = sorted.filter(({ at }) => at < cycle.startedAt);
  const during = sorted.filter(({ at }) => at >= cycle.startedAt && at < cycle.endedAt);
  if (during.length === 0) {
    return undefined;
  }

  // Where it rests: the middle of what it drew after the end, not a single
  // reading — the first minute may still be a fan running on, and the user
  // may switch it off a few minutes later. Readings of nothing are left out;
  // if there are only those, it drops to nothing by itself.
  const after = sorted.filter(({ at }) => at >= cycle.endedAt && at < cycle.endedAt + REST_WINDOW_MS);
  const restingReadings = after.map(({ watts }) => watts).filter((watts) => watts >= NOTHING_WATTS);
  const restWatts =
    after.length === 0 ? (valueAt(sorted, cycle.endedAt) ?? 0) : restingReadings.length > 0 ? round1(median(restingReadings)) : 0;
  const levelBefore = before.length > 0 ? before[before.length - 1]!.watts : undefined;

  // Where running starts: clearly above anything the machine rests at.
  const resting = Math.max(restWatts, levelBefore ?? 0);
  const runWatts = switchedOff ? current.runWatts : runLevelAbove(resting);

  // A cycle worth learning from went well above that at some point. Not the
  // median: a coffee machine spends most of a cycle keeping warm.
  const peak = Math.max(...during.map(({ watts }) => watts));
  if (peak < runWatts * 2) {
    return undefined;
  }

  const longestPauseSeconds = Math.round(longestPause(sorted, cycle, runWatts) / 1000);
  const finishSeconds = clamp(
    roundTo(Math.max(longestPauseSeconds * 1.5, longestPauseSeconds + 120), 10),
    MIN_FINISH_SECONDS,
    MAX_FINISH_SECONDS,
  );

  return {
    params: { runWatts, startSeconds: current.startSeconds, finishSeconds },
    restWatts,
    longestPauseSeconds,
  };
}

/**
 * Folds a newly learned cycle into what was known.
 *
 * The pause only ever grows: a programme that pauses for eight minutes on
 * Mondays and five on Tuesdays needs eight. The levels follow the latest
 * cycle, which has seen the machine as it is now.
 */
export function merge(previous: Learned | undefined, next: Learned): Learned {
  if (!previous) {
    return next;
  }
  const longestPauseSeconds = Math.max(previous.longestPauseSeconds, next.longestPauseSeconds);
  return {
    ...next,
    longestPauseSeconds,
    params: {
      ...next.params,
      finishSeconds: Math.max(previous.params.finishSeconds, next.params.finishSeconds),
    },
  };
}

/**
 * The longest stretch below runWatts between the start and the final drop.
 *
 * A quiet stretch still going at the final drop is the end itself, not a
 * pause, so only stretches the machine came back from count.
 */
function longestPause(samples: Sample[], cycle: CycleWindow, runWatts: number): number {
  let longest = 0;
  let quietSince: number | undefined;
  for (const { at, watts } of samples) {
    if (at >= cycle.endedAt) {
      break;
    }
    const from = Math.max(at, cycle.startedAt);
    if (watts < runWatts) {
      quietSince ??= from;
    } else if (quietSince !== undefined) {
      longest = Math.max(longest, from - quietSince);
      quietSince = undefined;
    }
  }
  return longest;
}

/** The reading in effect at a moment: the last one at or before it. */
function valueAt(samples: Sample[], at: number): number | undefined {
  let value: number | undefined;
  for (const sample of samples) {
    if (sample.at > at) {
      break;
    }
    value = sample.watts;
  }
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const roundTo = (value: number, step: number): number => Math.ceil(value / step) * step;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
