/**
 * Energy used per plug, per calendar day, and the totals the settings page
 * shows for today so far and the last complete week, month and year.
 *
 * Worked out from the power readings rather than read from the plug's own
 * meter: every plug that reports watts can be counted this way, and the
 * readings are already here. Readings are a step function — a plug reports
 * when its draw changes — so energy is the last reading times the time since.
 *
 * Days are local calendar days, as on an electricity bill. Today is shown
 * from the plug's first reading of the day, so one added at noon shows its
 * afternoon. A week or a month is only shown if it has been counted from its
 * first moment. A year is shown once it is over even if the plug joined
 * partway through — waiting for a whole one would leave the column empty for
 * up to two years — and marked as part of a year. Time Homebridge was not running is not counted, and does
 * not make a period incomplete.
 */

export interface DeviceEnergy {
  /** When counting began, in ms. */
  since: number;
  /** Watt-hours per local day, keyed `YYYY-MM-DD`. */
  days: Record<string, number>;
}

/** Days are kept for a little over two years: enough for "last year" in January. */
const KEEP_DAYS = 800;

/** Counts one plug's energy into days. */
export class EnergyMeter {
  readonly #record: DeviceEnergy;
  #watts: number | undefined;
  #at: number | undefined;

  constructor(record?: DeviceEnergy) {
    this.#record = record ? { since: record.since, days: { ...record.days } } : { since: 0, days: {} };
  }

  /** What has been counted, to be saved. */
  get record(): DeviceEnergy {
    return this.#record;
  }

  reading(at: number, watts: number | undefined): void {
    this.tick(at);
    if (watts !== undefined && this.#record.since === 0) {
      this.#record.since = at;
    }
    this.#watts = watts;
    this.#at = at;
  }

  /** Counts up to now, so that a day ends with what was used in it. */
  tick(at: number): void {
    if (this.#watts !== undefined && this.#at !== undefined && at > this.#at) {
      addSpread(this.#record.days, this.#at, at, this.#watts);
    }
    if (this.#at !== undefined) {
      this.#at = Math.max(this.#at, at);
    }
  }

  /** Drops days too old to be in any period shown. */
  prune(now: number): void {
    const oldest = dayKey(new Date(now - KEEP_DAYS * 86_400_000));
    for (const key of Object.keys(this.#record.days)) {
      if (key < oldest) {
        delete this.#record.days[key];
      }
    }
  }
}

/** Adds constant power over a span to the days it covers, split at local midnight. */
function addSpread(days: Record<string, number>, from: number, to: number, watts: number): void {
  let start = from;
  while (start < to) {
    const date = new Date(start);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const end = Math.min(to, midnight);
    const key = dayKey(date);
    days[key] = (days[key] ?? 0) + (watts * (end - start)) / 3_600_000;
    start = end;
  }
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface Period {
  kind: PeriodKind;
  /** What the column is headed. */
  label: string;
  /** Which dates that is, for a tooltip: "28 Sep – 4 Oct 2026". */
  dates: string;
  /** Local midnight at the start, and at the day after the end. */
  start: Date;
  end: Date;
}

/** Today so far, and the last complete week (Monday to Sunday), month and year before `now`. */
export function lastPeriods(now: Date): Period[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  // getDay() is 0 on Sunday; this Monday is 0–6 days back.
  const thisMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const thisYear = new Date(today.getFullYear(), 0, 1);
  const lastYear = new Date(today.getFullYear() - 1, 0, 1);

  const lastSunday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
  const short = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return [
    {
      kind: 'day',
      label: 'Today',
      dates: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      start: today,
      end: tomorrow,
    },
    {
      kind: 'week',
      label: 'Last Week',
      dates: `${short(lastMonday)} – ${short(lastSunday)} ${lastSunday.getFullYear()}`,
      start: lastMonday,
      end: thisMonday,
    },
    {
      kind: 'month',
      label: 'Last Month',
      dates: lastMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      start: lastMonth,
      end: thisMonth,
    },
    { kind: 'year', label: 'Last Year', dates: String(lastYear.getFullYear()), start: lastYear, end: thisYear },
  ];
}

/** Watt-hours used in a period, or undefined if it was not counted from its start. */
export function periodTotal(energy: DeviceEnergy, period: Period): number | undefined {
  if (energy.since === 0 || energy.since > period.start.getTime()) {
    return undefined;
  }
  const from = dayKey(period.start);
  const to = dayKey(period.end);
  let total = 0;
  for (const [key, wattHours] of Object.entries(energy.days)) {
    if (key >= from && key < to) {
      total += wattHours;
    }
  }
  return total;
}

/** A period the plug was only counted for part of, from `since` on. */
function partTotal(energy: DeviceEnergy, period: Period): number | undefined {
  if (energy.since === 0 || energy.since >= period.end.getTime()) {
    return undefined;
  }
  return periodTotal({ ...energy, since: period.start.getTime() }, period);
}

export interface Statistics {
  periods: { kind: PeriodKind; label: string; dates: string }[];
  /**
   * Watt-hours per plug and period; null where the period is not complete.
   * `partial` marks a year the plug was only counted for part of.
   */
  rows: { name: string; values: (number | null)[]; partial: boolean[] }[];
  /**
   * The sum of each column over the plugs that have a value in it. `missing`
   * says some plug has none — one added later, say — so the sum leaves it
   * out; `partial` that it includes a part of a year.
   */
  total: { values: (number | null)[]; missing: boolean[]; partial: boolean[] };
}

/** The table on the settings page, for the plugs named, in that order. */
export function statistics(ledger: Record<string, DeviceEnergy>, names: string[], now: Date): Statistics {
  const periods = lastPeriods(now);
  const rows = names.map((name) => {
    const energy = ledger[name];
    const cells = periods.map((period) => {
      if (!energy) {
        return { value: null, partial: false };
      }
      const whole = periodTotal(energy, period);
      if (whole !== undefined) {
        return { value: whole, partial: false };
      }
      // Today from the first reading, unmarked: today is a part anyway. A
      // year once it is over, marked. A week or a month only whole.
      const part = period.kind === 'day' || period.kind === 'year' ? partTotal(energy, period) : undefined;
      if (part === undefined) {
        return { value: null, partial: false };
      }
      return { value: part, partial: period.kind === 'year' };
    });
    return { name, values: cells.map(({ value }) => value), partial: cells.map(({ partial }) => partial) };
  });
  const total = {
    values: periods.map((_, column) => {
      const present = rows.map(({ values }) => values[column]).filter((value) => value !== null);
      return present.length > 0 ? present.reduce((sum: number, value) => sum + value!, 0) : null;
    }),
    missing: periods.map((_, column) => rows.some(({ values }) => values[column] === null)),
    partial: periods.map((_, column) => rows.some(({ partial }) => partial[column])),
  };
  return { periods: periods.map(({ kind, label, dates }) => ({ kind, label, dates })), rows, total };
}
