/**
 * What the settings page and the dashboard both show, built once: numbers
 * as they are read, the statistics table, and the reading under the pointer
 * on the chart. Sets `window.ApplianceViews`.
 */
(function (root) {
  'use strict';

  /** Dates and times in English, as every text here is, with a 24-hour clock; as in energy.ts. */
  const LOCALE = 'en-GB';

  /** kWh from Wh, with as many decimals as are worth reading; nothing for none. */
  const kwh = (wattHours) => {
    if (wattHours === null || wattHours === undefined) {
      return '';
    }
    const value = wattHours / 1000;
    return `${value.toFixed(value < 10 ? 2 : 1)} kWh`;
  };

  /** "45 min", "2 h 5 min". */
  const duration = (seconds) => {
    const minutes = Math.max(0, Math.round(seconds / 60));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  };

  /** Standby as a line: "8 % · about 7.6 kWh a year"; nothing when there is none to show. */
  const standbyText = (standby) => (standby && standby.share !== null
    ? `${Math.round(standby.share * 100)} % · about ${kwh(standby.yearWattHours)} a year`
    : undefined);

  // ---- The bubble over a row ---------------------------------------------------

  const BUBBLE_CSS = `
    tr.om-has-info:hover > td, tr.om-has-info.om-open > td { background-color: rgba(128,128,128,.12); }
    tr.om-has-info:focus-visible { outline: 2px solid rgba(128,128,128,.6); outline-offset: -2px; }
    .om-bubble { position: fixed; z-index: 10000; max-width: min(34rem, calc(100vw - 16px)); padding: .5rem .7rem; border-radius: .5rem;
                 background: rgba(28,28,30,.96); color: #f2f2f7; font: 400 .8rem/1.35 system-ui, -apple-system, sans-serif;
                 font-style: normal; text-align: left; white-space: normal; box-shadow: 0 4px 16px rgba(0,0,0,.3);
                 pointer-events: none; }
    .om-bubble[hidden] { display: none; }
    .om-bubble dl { display: grid; grid-template-columns: auto auto; gap: .1rem .8rem; margin: 0; }
    .om-bubble dt { color: #a1a1a6; font-weight: 400; }
    .om-bubble dd { margin: 0; font-variant-numeric: tabular-nums; }
    .om-bubble dt.om-heading { grid-column: 1 / -1; color: inherit; font-weight: 600; }
    .om-bubble dt.om-in { padding-left: .6rem; }
    .om-bubble dd + dt.om-heading { margin-top: .35rem; }`;

  let bubble;
  /** The row the bubble is open for. */
  let openFor;

  /** The one bubble on the page, made when first wanted, with its styles. */
  function theBubble() {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'om-bubble';
      bubble.hidden = true;
      bubble.setAttribute('role', 'tooltip');
      document.body.append(bubble);
      // A tap elsewhere, or Escape, closes one opened by a tap.
      document.addEventListener('pointerdown', (event) => {
        if (openFor && !openFor.contains(event.target)) {
          hide();
        }
      });
      document.addEventListener('keydown', (event) => event.key === 'Escape' && hide());
      window.addEventListener('scroll', () => hide(), true);
    }
    return bubble;
  }

  function hide() {
    openFor?.classList.remove('om-open');
    openFor = undefined;
    if (bubble) {
      bubble.hidden = true;
    }
  }

  /**
   * Shows `lines` ([label, value]) over `row`, at `x` across — where the
   * pointer is — or at the start of the row; below it where there is no room above.
   * A label without a value heads the lines up to the next one without.
   */
  function show(row, lines, x) {
    const box = theBubble();
    const list = document.createElement('dl');
    // Lines under a heading are indented.
    let grouped = false;
    for (const [label, value] of lines) {
      if (value === undefined) {
        grouped = true;
        const term = document.createElement('dt');
        term.className = 'om-heading';
        term.textContent = label;
        list.append(term);
        continue;
      }
      const term = document.createElement('dt');
      term.textContent = label;
      term.classList.toggle('om-in', grouped);
      const detail = document.createElement('dd');
      detail.textContent = value;
      list.append(term, detail);
    }
    box.replaceChildren(list);
    openFor?.classList.remove('om-open');
    openFor = row;
    row.classList.add('om-open');
    box.hidden = false;
    place(x);
  }

  function place(x) {
    if (!openFor || !bubble || bubble.hidden) {
      return;
    }
    const at = openFor.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const across = x ?? at.left + 24;
    const left = Math.min(Math.max(8, across - width / 2), window.innerWidth - width - 8);
    const top = at.top - height - 6 >= 8 ? at.top - height - 6 : at.bottom + 6;
    // The dashboard zooms the page, which scales a fixed position too: undo it.
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    bubble.style.left = `${left / zoom}px`;
    bubble.style.top = `${top / zoom}px`;
  }

  /** Shows `lines` on pointing anywhere in `row`, on tapping it, or on focusing it with the keyboard. */
  function addInfo(row, label, lines) {
    const box = theBubble();
    if (!document.getElementById('om-bubble-style')) {
      const style = document.createElement('style');
      style.id = 'om-bubble-style';
      style.textContent = BUBBLE_CSS;
      document.head.append(style);
    }
    row.classList.add('om-has-info');
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${label}: ${lines.map(([key, value]) => (value === undefined ? key : `${key} ${value}`)).join(', ')}`);
    row.addEventListener('pointerenter', (event) => event.pointerType === 'mouse' && show(row, lines, event.clientX));
    row.addEventListener('pointermove', (event) => event.pointerType === 'mouse' && openFor === row && place(event.clientX));
    row.addEventListener('pointerleave', (event) => event.pointerType === 'mouse' && hide());
    row.addEventListener('focus', () => show(row, lines));
    row.addEventListener('blur', hide);
    row.addEventListener('click', (event) => {
      // The settings page's reset checkbox sits in the row; a mouse has opened it already.
      if (event.target instanceof HTMLInputElement || event.pointerType === 'mouse') {
        return;
      }
      if (openFor === row && !box.hidden) {
        hide();
      } else {
        show(row, lines, event.clientX);
      }
    });
  }

  /** A time on the chart: with the weekday when it spans days, with seconds when not. */
  const clock = (ms, long) =>
    new Date(ms).toLocaleString(LOCALE, long
      ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
      : { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /** Plug names in the order a person would look for them: "Plug 2" before "Plug 10". */
  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

  function cell(row, text, tag = 'td') {
    const element = document.createElement(tag);
    element.textContent = text;
    row.append(element);
    return element;
  }

  /** An amount of money with two decimals and its currency after it: "1.79 EUR". */
  const money = (amount, currency) =>
    `${amount.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

  /** The column headers that sort, and the cost after each value. */
  const TABLE_CSS = `
    th.om-sort { cursor: pointer; user-select: none; white-space: nowrap; }
    th.om-sort .om-arrow { display: inline-block; width: 1em; margin-left: .2em; opacity: .35; font-size: .8em; }
    th.om-sort[aria-sort] .om-arrow { opacity: 1; }
    th.om-sort:hover .om-arrow { opacity: .8; }
    td .om-cost { opacity: .65; white-space: nowrap; }
    tfoot tr.om-fee td { font-weight: normal; }`;

  /**
   * How the statistics are sorted: by a column and which way, by name from A
   * to begin with. Kept in the browser, for the next time.
   */
  const SORT_KEY = 'appliance-monitor.statistics-sort';
  function savedSort() {
    try {
      const sort = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null');
      return sort && Number.isInteger(sort.column) && typeof sort.descending === 'boolean' ? sort : null;
    } catch {
      return null;
    }
  }
  function saveSort(sort) {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      // Not kept, as in a private window: sorted for now only.
    }
  }

  /**
   * The rows' indexes in the order to show them: each appliance with the ones
   * that are part of it right under it, sorted among themselves, and the
   * appliances sorted by `compare` — or as given, without one.
   */
  function sortedRows(depths, count, compare) {
    const children = (from, depth) => {
      const found = [];
      for (let index = from; index < count && (depths?.[index] ?? 0) >= depth; index++) {
        if ((depths?.[index] ?? 0) === depth) {
          found.push(index);
        }
      }
      return found;
    };
    const order = [];
    const visit = (indexes, depth) => {
      const sorted = compare ? [...indexes].sort(compare) : indexes;
      for (const index of sorted) {
        order.push(index);
        visit(children(index + 1, depth + 1), depth + 1);
      }
    };
    visit(children(0, 0), 0);
    return order;
  }

  /**
   * The statistics as a table. `dates` puts each period's dates under its
   * name; `decorate(cell, name)` adds to the first cell of a row, as the
   * settings page does its reset checkbox. A period counted only in part is
   * not marked: the README says how such a period is counted.
   *
   * With a price, each value has its cost after it, and the foot the fixed
   * fee and what it all cost. Sorted by name from A to begin with; a click on
   * a column's header sorts by it — the biggest first, names from A — and
   * again the other way; an appliance's parts stay under it.
   */
  function statisticsTable(table, { className = '', dates = false, decorate } = {}) {
    if (!document.getElementById('om-table-style')) {
      const style = document.createElement('style');
      style.id = 'om-table-style';
      style.textContent = TABLE_CSS;
      document.head.append(style);
    }
    // What each value cost, each day at the price that held then, worked out by the plugin.
    const price = table.price ?? null;
    const withCost = (row, wattHours, cost) => {
      const element = cell(row, kwh(wattHours));
      const text = wattHours !== null && cost !== null && cost !== undefined && price ? ` (${money(cost, price.currency)})` : '';
      if (text) {
        const small = document.createElement('span');
        small.className = 'om-cost';
        small.textContent = text;
        element.append(small);
      }
      return element;
    };

    const element = document.createElement('table');
    element.className = className;
    const head = element.createTHead().insertRow();
    // A period nobody has a figure for yet — last year, in the first year — is left out until someone has.
    const shown = table.periods.map((_, column) => table.rows.some(({ values }) => values[column] !== null));
    const shownOnly = (values) => values.filter((_, column) => shown[column]);

    // Column 0 is the name, 1 on the periods'.
    const BY_NAME = { column: 0, descending: false };
    let sort = savedSort() ?? BY_NAME;
    if (sort.column > 0 && !shown[sort.column - 1]) {
      sort = BY_NAME;
    }
    const headers = [];
    const sortable = (th, column) => {
      th.classList.add('om-sort');
      th.tabIndex = 0;
      const arrow = document.createElement('span');
      arrow.className = 'om-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      // Right after the name, before the dates under it.
      th.insertBefore(arrow, th.querySelector('small'));
      headers.push({ th, column, arrow });
      const click = () => {
        // The biggest first; names from A. Again, the other way.
        sort = sort.column === column ? { column, descending: !sort.descending } : { column, descending: column > 0 };
        saveSort(sort);
        fill();
      };
      th.addEventListener('click', click);
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          click();
        }
      });
    };
    sortable(cell(head, 'Appliance', 'th'), 0);
    table.periods.forEach((period, column) => {
      if (!shown[column]) {
        return;
      }
      const th = cell(head, period.label, 'th');
      if (dates) {
        const small = document.createElement('small');
        small.textContent = period.dates;
        th.append(small);
      }
      sortable(th, column + 1);
    });

    const body = element.createTBody();
    const rowFor = (index) => {
      const { name, values, standby, partOf } = table.rows[index];
      const row = document.createElement('tr');
      const first = cell(row, name);
      // In italics, as not in the total, and indented under the appliance it
      // is part of, which comes right before it.
      if (partOf) {
        row.classList.add('part');
        first.style.setProperty('--depth', table.depths?.[index] ?? 1);
      }
      decorate?.(first, name);
      // What does not fit as a column, in two groups: the last cycle — a dash
      // for each until there is one — and, overall, the estimated duration,
      // the count and standby.
      const last = table.lastCycles?.[index];
      const { label, count } = table.counts[index];
      const lines = [['Last cycle'],
        ['Energy', last ? kwh(last.wattHours) : '–'],
        ['Running', last ? duration(last.seconds) : '–'],
        ['Finished', last ? clock(last.endedAt, true) : '–']];
      const typical = table.typicals?.[index];
      // Per kind of start, as a washing machine's programmes, when its cycles
      // do not agree all together; or else, lengths all over the place, their median.
      const byStart = typical?.byStart ?? [];
      lines.push(['Overall'], ['Estimated duration', typical?.seconds ? `about ${duration(typical.seconds)}`
        : byStart.length > 0 ? `about ${byStart.map(duration).join(' or ')}`
          : typical?.median ? `median ${duration(typical.median)}, lengths vary`
            // Two: MIN_CYCLES in typical.ts.
            : `still learning · ${typical?.cycles ?? 0} of 2 cycles`]);
      lines.push(['Count', `${count} × ${label}`], ['Standby', standbyText(standby) ?? 'not counted yet']);
      addInfo(row, name, lines);
      const costs = shownOnly(price?.costs?.[index] ?? values.map(() => null));
      shownOnly(values).forEach((value, column) => withCost(row, value, costs[column]));
      return row;
    };
    const rows = table.rows.map((_, index) => rowFor(index));

    const fill = () => {
      for (const { th, column, arrow } of headers) {
        const on = sort.column === column;
        // Faint, the way a first click sorts.
        arrow.textContent = on ? (sort.descending ? '▼' : '▲') : (column > 0 ? '▼' : '▲');
        if (on) {
          th.setAttribute('aria-sort', sort.descending ? 'descending' : 'ascending');
        } else {
          th.removeAttribute('aria-sort');
        }
      }
      let compare;
      if (sort.column === 0) {
        compare = (a, b) => byName(table.rows[a].name, table.rows[b].name) * (sort.descending ? -1 : 1);
      } else {
        // None last, whichever way; the same by name from A.
        const of = (index) => table.rows[index].values[sort.column - 1];
        compare = (a, b) => (of(a) === null) - (of(b) === null) || (of(a) - of(b)) * (sort.descending ? -1 : 1)
          || byName(table.rows[a].name, table.rows[b].name);
      }
      body.replaceChildren(...sortedRows(table.depths, rows.length, compare).map((index) => rows[index]));
    };
    fill();

    const { total } = table;
    const foot = element.createTFoot();
    const totalRow = foot.insertRow();
    cell(totalRow, 'Total');
    // Last cycles and counts of different appliances add up to nothing; standby does.
    if (standbyText(total.standby)) {
      addInfo(totalRow, 'Total', [['Standby', standbyText(total.standby)]]);
    }
    const totalCosts = shownOnly(price?.totalCosts ?? total.values.map(() => null));
    shownOnly(total.values).forEach((value, column) => withCost(totalRow, value, totalCosts[column]));
    // The fixed fee, its share of each period, and with it what the electricity cost.
    if (price && price.baseFees.some((fee) => fee !== null)) {
      const fees = shownOnly(price.baseFees);
      const feeRow = foot.insertRow();
      feeRow.className = 'om-fee';
      cell(feeRow, 'Base fee');
      fees.forEach((fee) => cell(feeRow, fee === null ? '' : money(fee, price.currency)));
      if (price.totalCosts.some((cost) => cost !== null)) {
        const sumRow = foot.insertRow();
        cell(sumRow, 'Total cost');
        totalCosts.forEach((cost, column) => cell(sumRow, cost === null ? '' : money(cost + (fees[column] ?? 0), price.currency)));
      }
    }
    return element;
  }

  /**
   * The time line and the reading under the pointer on a chart drawn by
   * ApplianceChart. `toChart` turns a pointer event into chart coordinates,
   * `hover` shows what is there, or nothing for a point off the plot.
   */
  function chartPointer(svg, chart, curve) {
    const long = curve.to - curve.from > 36 * 3_600_000;
    const line = svg.querySelector('#om-hover-line');
    const tip = svg.querySelector('#om-hover-tip');
    const tipBox = tip.querySelector('rect');
    const tipText = tip.querySelector('text');
    const inPlot = (point) => Boolean(point)
      && point.x >= chart.xOf(curve.from) && point.x <= chart.xOf(curve.to)
      && point.y >= chart.plotTop && point.y <= chart.plotBottom;
    const toChart = (event) => {
      const box = svg.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) / box.width) * chart.width,
        y: ((event.clientY - box.top) / box.height) * chart.height,
      };
    };
    const hover = (point) => {
      if (!inPlot(point)) {
        line.setAttribute('visibility', 'hidden');
        tip.setAttribute('visibility', 'hidden');
        return;
      }
      const at = chart.timeOf(point.x);
      const value = chart.valueAt(at);
      line.setAttribute('x1', point.x);
      line.setAttribute('x2', point.x);
      line.setAttribute('visibility', 'visible');
      tipText.textContent = `${clock(at, long)}  ${value === null ? '–' : chart.watts(value)}`;
      const width = tipText.getComputedTextLength() + 16;
      const left = point.x + width + 12 > chart.xOf(curve.to) ? point.x - width - 8 : point.x + 8;
      tip.setAttribute('transform', `translate(${left},${chart.plotTop + 6})`);
      tipBox.setAttribute('width', width);
      tipText.setAttribute('x', 8);
      tip.setAttribute('visibility', 'visible');
    };
    return { toChart, inPlot, hover, long };
  }

  root.ApplianceViews = { LOCALE, kwh, money, duration, clock, byName, statisticsTable, sortedRows, chartPointer };
})(typeof window !== 'undefined' ? window : globalThis);
