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
import { baseFee, energyCost, notePrice, priceOn, readPrices, withPrice } from '../src/prices.ts';
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

const eur = (perKwh: number | null, perMonth: number | null) => ({ perKwh, perMonth, currency: 'EUR' });

test('a changed price holds from the next day; changed twice in a day, the last; the first holds for all before', () => {
  let history = withPrice([], eur(0.2856, 13.89), '2026-10-29');
  assert.deepEqual(history, [{ ...eur(0.2856, 13.89), from: '2026-10-29' }], 'the first, from today');
  assert.equal(priceOn(history, '2025-01-01')!.perKwh, 0.2856, 'and for everything before');
  assert.equal(withPrice([], eur(0.2856, 13.89), '2026-10-29', '2026-10-06')[0]!.from, '2026-10-06', 'from the first recording');
  assert.deepEqual(withPrice(history, eur(0.2856, 13.89), '2026-11-02'), history, 'the same again: nothing new');
  history = withPrice(history, eur(0.31, 13.89), '2026-11-02');
  assert.deepEqual(history.map(({ from, perKwh }) => [from, perKwh]), [['2026-10-29', 0.2856], ['2026-11-03', 0.31]]);
  assert.equal(priceOn(history, '2026-11-02')!.perKwh, 0.2856, 'today keeps the price it began with');
  assert.equal(priceOn(history, '2026-11-03')!.perKwh, 0.31);
  const again = withPrice(history, eur(0.3, 13.89), '2026-11-02');
  assert.deepEqual(again.map(({ from, perKwh }) => [from, perKwh]), [['2026-10-29', 0.2856], ['2026-11-03', 0.3]], 'the change waiting replaced');
  assert.deepEqual(withPrice(history, eur(0.2856, 13.89), '2026-11-02').map(({ from }) => from), ['2026-10-29'], 'changed back: nothing waits');
  assert.deepEqual(withPrice(history, eur(0.31, 13.89), '2026-12-31').at(-1)!.from, '2026-11-03', 'over the year end too');
  assert.deepEqual(withPrice([{ ...eur(0.3, 10), from: '2026-12-31' }], eur(0.4, 10), '2026-12-31').at(-1)!.from, '2027-01-01');
});

test('each day at its own price: energy before a change keeps the price it had', () => {
  const history = [{ ...eur(0.2, 12), from: '2026-10-01' }, { ...eur(0.3, 15), from: '2026-10-16' }];
  const energy = { since: 0, days: { '2026-10-14': 1000, '2026-10-15': 2000, '2026-10-16': 1000, '2026-10-17': 500 } };
  const october = { kind: 'month' as const, start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) };
  assert.equal(Math.round(energyCost(energy, october, history)! * 100) / 100, 1.05, '3 kWh at 20 cents, 1.5 at 30');
  // The fee: 15 days at 12 a month, 16 at 15, the month a month.
  assert.equal(Math.round(baseFee(october, history)! * 100) / 100, Math.round(((15 * 12 + 16 * 15) / 31) * 100) / 100);
  assert.equal(energyCost(energy, october, [{ ...eur(null, 12), from: '2026-10-01' }]), null, 'no price per kWh: no cost');
  assert.equal(energyCost(undefined, october, history), null);
});

test('the plugin notes the price it starts with, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-prices-'));
  try {
    assert.equal(notePrice(dir, eur(0.2856, 13.89), new Date(2026, 9, 29))!.from, '2026-10-29');
    assert.equal(notePrice(dir, eur(0.2856, 13.89), new Date(2026, 9, 30)), undefined, 'unchanged: nothing written');
    assert.equal(notePrice(dir, eur(0.31, 13.89), new Date(2026, 10, 2))!.from, '2026-11-03');
    assert.deepEqual(readPrices(dir).map(({ from }) => from), ['2026-10-29', '2026-11-03']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
