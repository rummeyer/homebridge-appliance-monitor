/**
 * What the Power and Statistics tabs show, read from the files the plugin
 * writes. Shared by the settings page's backend and the dashboard, so the
 * two cannot drift apart.
 */
import { join } from 'node:path';

import { usablePhases } from './config.ts';
import type { DeviceConfig } from './config.ts';
import { shownCount } from './counts.ts';
import { phaseSpans, thin } from './curve.ts';
import { statistics } from './energy.ts';
import type { DeviceEnergy, Statistics } from './energy.ts';
import { readJson } from './json-file.ts';
import { findLevels, RECALL_MS } from './phases.ts';
import type { Level, PhaseConfig } from './phases.ts';
import { readSamples } from './recorder.ts';
import type { DeviceRecord, LastCycle } from './store.ts';

/** Points drawn across the chart: about two per pixel of a wide page. */
export const CHART_BUCKETS = 600;
export const MAX_HOURS = 24 * 14;

/** One of the plugin's JSON files; a missing, half-written or damaged one reads as empty. */
export function readData<T extends object>(dir: string | undefined, file: string, empty: T): T {
  try {
    return ((dir && (readJson(join(dir, file)) as T | null)) || empty);
  } catch {
    return empty;
  }
}

/** Hours asked for, as a number the chart can show: 1 to two weeks, 24 if it is no number. */
export const chartHours = (hours: unknown): number => Math.min(Math.max(Number(hours) || 24, 1), MAX_HOURS);

export interface Curve {
  from: number;
  to: number;
  points: [number, number][];
  levels: Level[];
  spans: ReturnType<typeof phaseSpans>;
}

/** A plug's last hours, thinned for drawing, the levels found in them, and when its phases were on. */
export function curve(dir: string | undefined, name: string, hours: number, phases: PhaseConfig[], to = Date.now()): Curve {
  const powerDir = dir && join(dir, 'power');
  const from = to - hours * 3_600_000;
  const samples = powerDir ? readSamples(powerDir, name, from, to) : [];
  // Where the draw came from before the chart begins, for a phase only on the way down.
  const earlier = powerDir && phases.some(({ onDown }) => onDown)
    ? readSamples(powerDir, name, from - RECALL_MS, from - 1)
    : [];
  return {
    from,
    to,
    points: thin(samples, from, to, CHART_BUCKETS),
    levels: findLevels(samples, to),
    spans: phaseSpans(samples, from, to, phases, earlier),
  };
}

export interface StatisticsTable extends Statistics {
  counts: { label: string; count: number; since: number | null }[];
  lastCycles: (LastCycle | null)[];
}

/** The table for the plugs given, in that order, with what each has counted. */
export function statisticsTable(dir: string | undefined, devices: Pick<DeviceConfig, 'name' | 'phases'>[], now = new Date()): StatisticsTable {
  const ledger = readData<Record<string, DeviceEnergy>>(dir, 'energy.json', {});
  const records = readData<Record<string, DeviceRecord>>(dir, 'devices.json', {});
  const counts = devices.map((device) => {
    const { key, label } = shownCount(usablePhases(device).phases);
    const counted = records[device.name]?.counts?.[key];
    return { label, count: counted?.count ?? 0, since: counted?.since ?? null };
  });
  const lastCycles = devices.map((device) => records[device.name]?.lastCycle ?? null);
  return { ...statistics(ledger, devices.map(({ name }) => name), now), counts, lastCycles };
}
