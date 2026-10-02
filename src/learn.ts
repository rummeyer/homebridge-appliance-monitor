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
 * level stays as it is. The pause is learned all the same. `marked`: marked
 * by hand on the Power tab, so its start is not exact.
 */
export function learnFromCycle(
  samples: Sample[],
  cycle: CycleWindow,
  current: CycleParams,
  { switchedOff = false, marked = false }: { switchedOff?: boolean; marked?: boolean } = {},
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
  // What it rose from. Not for a cycle marked by hand, whose start is never
  // exact: the reading before may already be the machine at work, or booting.
  const levelBefore = before.length > 0 && !marked ? before[before.length - 1]!.watts : undefined;

  // Where running starts: clearly above anything the machine rests at. A
  // machine that drew nothing after, and before — switched off at the plug,
  // say — showed its standby, if at all, inside the cycle: a computer asleep
  // over lunch. Failing that, the level already in use stays, rather than
  // dropping to just above nothing and taking standby for running.
  const outside = Math.max(restWatts, levelBefore ?? 0);
  const resting = outside >= NOTHING_WATTS ? outside : steadyStandby(sorted, cycle);
  const runWatts = switchedOff || resting === undefined ? current.runWatts : runLevelAbove(resting);

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
    // The standby the running level was set above, wherever it was seen.
    restWatts: resting ?? restWatts,
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

/** How long a level has to be held, and how steady and small, to be standby. */
export const STANDBY_HELD_MS = 10 * 60_000;
export const STANDBY_STEADY_RATIO = 1.5;
export const MAX_STANDBY_WATTS = 25;

/**
 * The highest level held steady for ten minutes inside a cycle and small
 * enough to be standby, or undefined if there is none: a washing machine's
 * drum turning in bursts is neither steady nor small. The highest, since
 * running has to start above every level the machine rests at — a computer
 * asleep at 5 W and with its screens off at 10 W rests at both.
 */
function steadyStandby(samples: Sample[], cycle: CycleWindow): number | undefined {
  const inside = samples.filter(({ at }) => at >= cycle.startedAt && at < cycle.endedAt);
  let best: number | undefined;
  for (let first = 0; first < inside.length; first++) {
    const from = inside[first]!.at;
    let lowest = Infinity;
    let highest = 0;
    for (let index = first; index < inside.length; index++) {
      const sample = inside[index]!;
      lowest = Math.min(lowest, sample.watts);
      highest = Math.max(highest, sample.watts);
      if (highest > lowest * STANDBY_STEADY_RATIO) {
        break;
      }
      const until = inside[index + 1]?.at ?? cycle.endedAt;
      if (until - from >= STANDBY_HELD_MS) {
        if (lowest >= NOTHING_WATTS && highest <= MAX_STANDBY_WATTS && (best === undefined || highest > best)) {
          best = highest;
        }
        break;
      }
    }
  }
  return best === undefined ? undefined : round1(best);
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
