/**
 * What the Statistics tab counts for an appliance.
 *
 * Every finished cycle and every phase that ends is counted, all the time;
 * which of them is shown is chosen in the settings. So choosing another
 * loses nothing, and a phase chosen today has been counted since it was set
 * up.
 */
import type { PhaseConfig } from './phases.ts';

export const FINISHED = 'finished';

/** The key a phase is counted under. */
export const phaseKey = (name: string): string => `phase:${name}`;

export interface Counted {
  count: number;
  /** When counting began, in ms. */
  since: number;
}

/**
 * What to show: the first phase marked to be counted, or the finished
 * cycles if none is — or if the one marked has gone.
 */
export function shownCount(phases: PhaseConfig[]): { key: string; label: string } {
  const counted = phases.find((phase) => phase.count === true);
  return counted ? { key: phaseKey(counted.name), label: counted.name } : { key: FINISHED, label: 'Finished' };
}
