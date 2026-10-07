/**
 * What the Power tab of the settings page draws.
 */
import type { Sample } from './learn.ts';
import { PhaseTracker } from './phases.ts';
import type { PhaseChange, PhaseConfig } from './phases.ts';

/**
 * A curve cut down to about `buckets` stretches, each drawn by its lowest and
 * highest reading in the order they came.
 *
 * Highest as well as lowest, because a coffee running through for half a
 * minute is one reading among thousands in a day, and averaging would lose
 * exactly the moments worth seeing.
 */
export function thin(samples: Sample[], from: number, to: number, buckets: number): [number, number][] {
  if (samples.length <= buckets * 2) {
    return samples.map(({ at, watts }) => [at, watts]);
  }
  const width = (to - from) / buckets;
  const points: [number, number][] = [];
  let index = 0;
  for (let bucket = 0; bucket < buckets && index < samples.length; bucket++) {
    const end = from + (bucket + 1) * width;
    let low: Sample | undefined;
    let high: Sample | undefined;
    for (; index < samples.length && (samples[index]!.at < end || bucket === buckets - 1); index++) {
      const sample = samples[index]!;
      if (!low || sample.watts < low.watts) {
        low = sample;
      }
      if (!high || sample.watts > high.watts) {
        high = sample;
      }
    }
    if (low && high) {
      const pair = low === high ? [low] : [low, high].sort((a, b) => a.at - b.at);
      for (const { at, watts } of pair) {
        points.push([at, watts]);
      }
    }
  }
  return points;
}

/**
 * When each phase would have been on, worked out the way the plugin does it
 * — with its minimum and its hold — rather than when the draw was merely in
 * range. A thermostat switching a heater for a few seconds every minute is
 * in range dozens of times and on, as a phase, not once.
 */
export function phaseSpans(
  samples: Sample[],
  from: number,
  to: number,
  phases: PhaseConfig[],
  /** Readings before `from`, for where the draw came from; see PhaseTracker.recall. */
  earlier: Sample[] = [],
): { name: string; spans: [number, number][] }[] {
  // Ticks a second apart over an hour, coarser over days: what moves a phase
  // on or off is time passing, and a few seconds are lost in a week's width.
  const step = Math.max(1000, Math.round((to - from) / 50_000 / 1000) * 1000);
  return phases.map((phase) => {
    const tracker = new PhaseTracker(phase);
    tracker.recall(earlier);
    const spans: [number, number][] = [];
    let on: number | undefined;
    const take = (change: PhaseChange | undefined) => {
      if (change?.short) {
        // Drawn where the draw was, not where the switch went on for a moment.
        spans.push([change.since!, change.until ?? change.at]);
      } else if (change?.active) {
        on = change.at;
      } else if (change && on !== undefined) {
        spans.push([on, change.at]);
        on = undefined;
      }
    };
    let index = 0;
    for (let at = from; at <= to; at += step) {
      while (index < samples.length && samples[index]!.at <= at) {
        take(tracker.reading(samples[index]!.at, samples[index]!.watts));
        index++;
      }
      take(tracker.tick(at));
    }
    if (on !== undefined) {
      spans.push([on, to]);
    }
    return { name: phase.name, spans };
  });
}
