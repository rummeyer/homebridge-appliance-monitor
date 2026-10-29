/**
 * What electricity costs, on the Statistics tab: the price as set, each
 * period's share of the fixed fee, and the table sorted with an appliance's
 * parts kept under it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { usablePrice } from '../src/config.ts';
import { statisticsTable } from '../src/views.ts';

const scope: { ApplianceViews?: { money: (amount: number, currency: string) => string; sortedRows: (depths: number[], count: number, compare?: (a: number, b: number) => number) => number[] } } = {};
new Function('window', readFileSync(new URL('../homebridge-ui/public/shared.js', import.meta.url), 'utf8'))(scope);
const views = scope.ApplianceViews!;

test('a price as set: cents per kWh in the currency, a fee per month, EUR unless said otherwise', () => {
  const mine = usablePrice({ pricing: true, centsPerKwh: 28.56, baseFeePerMonth: 13.89, currency: 'EUR' })!;
  assert.deepEqual({ ...mine, perKwh: Math.round(mine.perKwh! * 1e6) / 1e6 }, { perKwh: 0.2856, perMonth: 13.89, currency: 'EUR' });
  assert.deepEqual(usablePrice({ pricing: true, centsPerKwh: 30 }), { perKwh: 0.3, perMonth: null, currency: 'EUR' });
  assert.deepEqual(usablePrice({ pricing: true, baseFeePerMonth: 10, currency: ' CHF ' }), { perKwh: null, perMonth: 10, currency: 'CHF' });
  assert.equal(usablePrice({ centsPerKwh: 28.56, baseFeePerMonth: 13.89 }), undefined, 'pricing off: no costs shown, the price kept');
  assert.equal(usablePrice({ pricing: true }), undefined, 'none set: no costs shown');
  assert.equal(usablePrice({ pricing: true, centsPerKwh: -1, baseFeePerMonth: Number.NaN }), undefined, 'nothing usable');
});

test('the fixed fee\'s share of each period: a day, a week, a month, a year', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-price-'));
  try {
    const { periods, price } = statisticsTable(dir, [{ name: 'Kaffeemaschine' }], new Date(2026, 9, 29), usablePrice({ pricing: true, centsPerKwh: 28.56, baseFeePerMonth: 13.89 }));
    assert.deepEqual(periods.map(({ kind }) => kind), ['day', 'week', 'month', 'year']);
    assert.equal(Math.round(price!.perKwh! * 1e6) / 1e6, 0.2856);
    assert.deepEqual(price!.baseFees.map((fee) => Math.round(fee! * 100) / 100), [0.46, 3.2, 13.89, 166.68]);
    assert.equal(statisticsTable(dir, [{ name: 'Kaffeemaschine' }]).price, null, 'without a price, none');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('an amount of money: two decimals, the currency after it', () => {
  assert.equal(views.money(1.786, 'EUR'), '1.79 EUR');
  assert.equal(views.money(166.68, 'EUR'), '166.68 EUR');
});

test('sorted, an appliance keeps its parts right under it, sorted among themselves', () => {
  // Arbeitsplatz with Schreibtisch and its lamp under it, then the coffee machine and the TV.
  const names = ['Arbeitsplatz', 'Schreibtisch', 'Schreibtischlampe', 'Arbeitsplatzlampe', 'Kaffeemaschine', 'Fernseher'];
  const depths = [0, 1, 2, 1, 0, 0];
  const kwh = [10, 6, 1, 2, 30, 5];
  assert.deepEqual(views.sortedRows(depths, 6), [0, 1, 2, 3, 4, 5], 'unsorted: as the settings list them');
  const most = views.sortedRows(depths, 6, (a, b) => kwh[b]! - kwh[a]!).map((index) => names[index]);
  assert.deepEqual(most, ['Kaffeemaschine', 'Arbeitsplatz', 'Schreibtisch', 'Schreibtischlampe', 'Arbeitsplatzlampe', 'Fernseher']);
  const byName = views.sortedRows(depths, 6, (a, b) => names[b]!.localeCompare(names[a]!)).map((index) => names[index]);
  assert.deepEqual(byName, ['Kaffeemaschine', 'Fernseher', 'Arbeitsplatz', 'Schreibtisch', 'Schreibtischlampe', 'Arbeitsplatzlampe'], 'Z to A, the parts too');
});
