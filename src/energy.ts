/**
 * Energy used per plug, per calendar day, and the totals the settings page
 * shows for the last complete day, week, month and year.
 *
 * Worked out from the power readings rather than read from the plug's own
 * meter: every plug that reports watts can be counted this way, and the
 * readings are already here. Readings are a step function — a plug reports
 * when its draw changes — so energy is the last reading times the time since.
 *
 * Days are local calendar days, as on an electricity bill. A day, week or
 * month is only shown once it has been counted from its first moment: a plug
 * first counted this afternoon has no "yesterday", and no "today" either
 * until tomorrow makes it yesterday. A year is the exception — waiting for a
 * whole one would leave the column empty for up to two years — so a year the
 * plug joined partway through is shown too, once it is over, and marked as
 * part of a year. Time Homebridge was not running is not counted, and does
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
  /** Local midnight at the start, and at the day after the end. */
  start: Date;
  end: Date;
}

/** The last complete day, week (Monday to Sunday), month and year before `now`. */
export function lastPeriods(now: Date): Period[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  // getDay() is 0 on Sunday; this Monday is 0–6 days back.
  const thisMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const thisYear = new Date(today.getFullYear(), 0, 1);
  const lastYear = new Date(today.getFullYear() - 1, 0, 1);

  return [
    { kind: 'day', label: 'Yesterday', start: yesterday, end: today },
    { kind: 'week', label: 'Last week', start: lastMonday, end: thisMonday },
    {
      kind: 'month',
      label: lastMonth.toLocaleString('en', { month: 'long', year: 'numeric' }),
      start: lastMonth,
      end: thisMonth,
    },
    { kind: 'year', label: String(lastYear.getFullYear()), start: lastYear, end: thisYear },
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

/** A year the plug was only counted for part of: from `since` to its end. */
export function partYearTotal(energy: DeviceEnergy, period: Period): number | undefined {
  if (period.kind !== 'year' || energy.since === 0 || energy.since >= period.end.getTime()) {
    return undefined;
  }
  return periodTotal({ ...energy, since: period.start.getTime() }, period);
}

export interface Statistics {
  periods: { kind: PeriodKind; label: string }[];
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
      const part = partYearTotal(energy, period);
      return part !== undefined ? { value: part, partial: true } : { value: null, partial: false };
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
  return { periods: periods.map(({ kind, label }) => ({ kind, label })), rows, total };
}
