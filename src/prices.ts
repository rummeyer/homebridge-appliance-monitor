/**
 * What electricity cost, day by day. The settings hold one price; the plugin
 * notes each change of it here, holding from the day after it starts with
 * it, so that energy used before keeps the price it had then — a list of
 * prices with dates nobody has to keep. Today is priced as it began; the
 * first price ever set holds from the first day anything was recorded.
 */
import { join } from 'node:path';

import type { Price } from './config.ts';
import { dayKey } from './energy.ts';
import type { DeviceEnergy, Period, PeriodKind } from './energy.ts';
import { readJson, writeJson } from './json-file.ts';

/** In the plugin's folder in the Homebridge storage. */
export const PRICES_FILE = 'prices.json';

/** A price as it held from a day on. */
export interface PriceChange extends Price {
  /** The local day it held from, `YYYY-MM-DD`. */
  from: string;
}

/** The months a period is, for its share of a fee per month: a day a twelfth of 365 days of a year. */
const MONTHS: Record<PeriodKind, number> = { day: 12 / 365, week: (7 * 12) / 365, month: 1, year: 12 };

const samePrice = (a: Price, b: Price) => a.perKwh === b.perKwh && a.perMonth === b.perMonth && a.currency === b.currency;

/**
 * The history with `price` holding from the day after `today` on: added when
 * it is not the one holding then already, replacing one waiting for
 * tomorrow — changed twice in a day, the last counts. The first price of
 * all holds from `first`, the first day anything was recorded, or today.
 */
export function withPrice(history: PriceChange[], price: Price, today: string, first = today): PriceChange[] {
  if (history.length === 0) {
    return [{ ...price, from: first < today ? first : today }];
  }
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const tomorrow = dayKey(new Date(year, month - 1, day + 1));
  const holding = history.filter(({ from }) => from <= today);
  const last = holding.at(-1) ?? history[0]!;
  return samePrice(last, price) ? holding : [...holding, { ...price, from: tomorrow }];
}

/** The price that held on a day: the last change from it or before, or before the first one, the first. */
export function priceOn(history: PriceChange[], day: string): PriceChange | undefined {
  let found = history[0];
  for (const change of history) {
    if (change.from <= day) {
      found = change;
    }
  }
  return found;
}

/** The first day anything was recorded, `YYYY-MM-DD`: the first price holds from it. */
export function firstRecordedDay(dir: string | undefined): string | undefined {
  try {
    const ledger = dir ? readJson(join(dir, 'energy.json')) as Record<string, DeviceEnergy> | undefined : undefined;
    const days = Object.values(ledger ?? {}).flatMap((energy) => Object.keys(energy?.days ?? {}));
    return days.length ? days.reduce((a, b) => (a < b ? a : b)) : undefined;
  } catch {
    return undefined;
  }
}

export function readPrices(dir: string | undefined): PriceChange[] {
  try {
    const data = dir ? readJson(join(dir, PRICES_FILE)) : undefined;
    return Array.isArray(data) ? (data as PriceChange[]).filter((change) => typeof change?.from === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Notes the price the plugin started with, if it changed: what it holds
 * from tomorrow. Returns the change noted, or none.
 */
export function notePrice(dir: string, price: Price, now = new Date()): PriceChange | undefined {
  const history = readPrices(dir);
  const first = firstRecordedDay(dir);
  // The first price holds from the first recording, as noted before this was so too.
  if (first && history[0] && history[0].from > first) {
    history[0] = { ...history[0], from: first };
    writeJson(join(dir, PRICES_FILE), history);
  }
  const updated = withPrice(history, price, dayKey(now), first);
  if (JSON.stringify(updated) === JSON.stringify(history)) {
    return undefined;
  }
  writeJson(join(dir, PRICES_FILE), updated);
  return updated.at(-1);
}

/** The local days of a period. */
function daysOf(period: Pick<Period, 'start' | 'end'>): string[] {
  const days: string[] = [];
  for (let day = new Date(period.start); day < period.end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    days.push(dayKey(day));
  }
  return days;
}

/** What the energy a plug used in a period cost, each day at its price; none without a price per kWh then. */
export function energyCost(energy: DeviceEnergy | undefined, period: Pick<Period, 'start' | 'end'>, history: PriceChange[]): number | null {
  if (!energy) {
    return null;
  }
  const from = dayKey(period.start);
  const to = dayKey(period.end);
  let cost = 0;
  for (const [day, wattHours] of Object.entries(energy.days)) {
    if (day >= from && day < to) {
      const perKwh = priceOn(history, day)?.perKwh;
      if (perKwh === null || perKwh === undefined) {
        return null;
      }
      cost += (wattHours / 1000) * perKwh;
    }
  }
  return cost;
}

/**
 * The fixed fee's share of a period: a day's, a week's, the month's or
 * twelve for a year, each day at the fee that held then. None where no fee
 * held at all.
 */
export function baseFee(period: Pick<Period, 'kind' | 'start' | 'end'>, history: PriceChange[]): number | null {
  const fees = daysOf(period).map((day) => priceOn(history, day)?.perMonth ?? null);
  if (fees.every((fee) => fee === null)) {
    return null;
  }
  return fees.reduce((sum: number, fee) => sum + ((fee ?? 0) * MONTHS[period.kind]) / fees.length, 0);
}
