/**
 * What the Power and Statistics tabs show, read from the files the plugin
 * writes. Shared by the settings page's backend and the dashboard, so the
 * two cannot drift apart.
 */
import { join } from 'node:path';

import { usablePhases, wholeOf, withParts } from './config.ts';
import type { DeviceConfig, Price } from './config.ts';
import { shownCount } from './counts.ts';
import { phaseSpans, sumSamples, thin } from './curve.ts';
import { dayKey, lastPeriods, statistics } from './energy.ts';
import type { DeviceEnergy, Statistics } from './energy.ts';
import { readJson } from './json-file.ts';
import { findLevels, RECALL_MS } from './phases.ts';
import { baseFee, energyCost, readPrices, withPrice } from './prices.ts';
import type { Level, PhaseConfig } from './phases.ts';
import { readSamples, readSeries } from './recorder.ts';
import type { DeviceRecord, LastCycle } from './store.ts';
import { medianSeconds, MIN_CYCLES, runsOf, usualByStart, usualSeconds } from './typical.ts';

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

/** All the plugs together over the last hours, thinned for drawing; no levels and no phases. */
export function totalCurve(dir: string | undefined, names: string[], hours: number, to = Date.now()): Curve {
  const from = to - hours * 3_600_000;
  const series = dir ? readSeries(join(dir, 'power'), names, from, to) : new Map<string, never[]>();
  const samples = sumSamples(names.map((name) => series.get(name) ?? []));
  return { from, to, points: thin(samples, from, to, CHART_BUCKETS), levels: [], spans: [] };
}

export interface StatisticsTable extends Statistics {
  /** How far below another appliance each row sits, as part of it; 0 for one on its own. */
  depths: number[];
  counts: { label: string; count: number; since: number | null }[];
  lastCycles: (LastCycle | null)[];
  /**
   * How long each usually runs: all its cycles together, or else per kind
   * of start (`byStart`, shortest first), as a washing machine's programmes;
   * null where they have no usual length, `cycles` saying whether that is
   * for too few. `median` is the median of all, close to it or not.
   */
  typicals: { seconds: number | null; cycles: number; byStart: number[]; median: number | null }[];
  /**
   * What the electricity cost, with pricing on: per row and period, each day
   * at the price that held then (see prices.ts), the total of the rows in
   * the total, and the fixed fee's share of each period.
   */
  price: { currency: string; costs: (number | null)[][]; totalCosts: (number | null)[]; baseFees: (number | null)[] } | null;
}

/**
 * The table for the plugs given, in that order but for each one's parts,
 * which come right after it, with what each has counted.
 */
export function statisticsTable(
  dir: string | undefined,
  given: Pick<DeviceConfig, 'name' | 'phases' | 'partOf'>[],
  now = new Date(),
  price?: Price,
): StatisticsTable {
  const ordered = withParts(given);
  const devices = ordered.map(({ device }) => device);
  const ledger = readData<Record<string, DeviceEnergy>>(dir, 'energy.json', {});
  const records = readData<Record<string, DeviceRecord>>(dir, 'devices.json', {});
  const counts = devices.map((device) => {
    const { key, label } = shownCount(usablePhases(device).phases);
    const counted = records[device.name]?.counts?.[key];
    return { label, count: counted?.count ?? 0, since: counted?.since ?? null };
  });
  const lastCycles = devices.map((device) => records[device.name]?.lastCycle ?? null);
  const typicals = devices.map((device) => {
    const runs = runsOf(records[device.name] ?? {});
    return {
      seconds: usualSeconds(runs) ?? null,
      cycles: Math.min(runs.length, MIN_CYCLES),
      byStart: usualByStart(runs),
      median: medianSeconds(runs.map(({ seconds }) => seconds)) ?? null,
    };
  });
  // Only a partOf that holds: one naming nothing, or going round, is counted.
  const plugs = devices.map((device) => {
    const partOf = wholeOf(device, devices);
    return partOf === undefined ? { name: device.name } : { name: device.name, partOf };
  });
  const table = statistics(ledger, plugs, now);
  // The price as set, as the plugin will note it once it starts with it: from tomorrow, or the first of all from always.
  const history = price ? withPrice(readPrices(dir), price, dayKey(now)) : [];
  const periods = lastPeriods(now);
  const costs = table.rows.map(({ name, values }) => periods.map((period, column) =>
    (values[column] === null ? null : energyCost(ledger[name], period, history))));
  const totalCosts = periods.map((_, column) => {
    const counted = table.rows.flatMap(({ partOf }, row) => (partOf || costs[row]![column] === null ? [] : [costs[row]![column]!]));
    return counted.length > 0 ? counted.reduce((sum, cost) => sum + cost, 0) : null;
  });
  return {
    ...table,
    counts,
    lastCycles,
    typicals,
    depths: ordered.map(({ depth }) => depth),
    price: price
      ? { currency: price.currency, costs, totalCosts, baseFees: periods.map((period) => baseFee(period, history)) }
      : null,
  };
}
