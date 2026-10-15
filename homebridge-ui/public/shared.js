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
    .om-bubble { position: fixed; z-index: 10000; max-width: 22rem; padding: .5rem .7rem; border-radius: .5rem;
                 background: rgba(28,28,30,.96); color: #f2f2f7; font: 400 .8rem/1.35 system-ui, -apple-system, sans-serif;
                 font-style: normal; text-align: left; white-space: normal; box-shadow: 0 4px 16px rgba(0,0,0,.3);
                 pointer-events: none; }
    .om-bubble[hidden] { display: none; }
    .om-bubble dl { display: grid; grid-template-columns: auto auto; gap: .1rem .8rem; margin: 0; }
    .om-bubble dt { color: #a1a1a6; font-weight: 400; }
    .om-bubble dd { margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }`;

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
   */
  function show(row, lines, x) {
    const box = theBubble();
    const list = document.createElement('dl');
    for (const [label, value] of lines) {
      const term = document.createElement('dt');
      term.textContent = label;
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
    row.setAttribute('aria-label', `${label}: ${lines.map(([key, value]) => `${key} ${value}`).join(', ')}`);
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

  /**
   * The statistics as a table. `dates` puts each period's dates under its
   * name; `decorate(cell, name)` adds to the first cell of a row, as the
   * settings page does its reset checkbox. A period counted only in part is
   * not marked: the README says how such a period is counted.
   */
  function statisticsTable(table, { className = '', dates = false, decorate } = {}) {
    const element = document.createElement('table');
    element.className = className;
    const head = element.createTHead().insertRow();
    cell(head, 'Appliance', 'th');
    // A period nobody has a figure for yet — last year, in the first year — is left out until someone has.
    const shown = table.periods.map((_, column) => table.rows.some(({ values }) => values[column] !== null));
    const shownOnly = (values) => values.filter((_, column) => shown[column]);
    for (const period of shownOnly(table.periods)) {
      const th = cell(head, period.label, 'th');
      if (dates) {
        const small = document.createElement('small');
        small.textContent = period.dates;
        th.append(small);
      }
    }

    const body = element.createTBody();
    for (const [index, { name, values, standby, partOf }] of table.rows.entries()) {
      const row = body.insertRow();
      const first = cell(row, name);
      // In italics, as not in the total, and indented under the appliance it
      // is part of, which comes right before it.
      if (partOf) {
        row.classList.add('part');
        first.style.setProperty('--depth', table.depths?.[index] ?? 1);
      }
      decorate?.(first, name);
      // What does not fit as a column: the last cycle, the count and standby.
      const last = table.lastCycles?.[index];
      const { label, count } = table.counts[index];
      const lines = last
        ? [['Last cycle', kwh(last.wattHours)], ['Running time', duration(last.seconds)], ['Finished', clock(last.endedAt, true)]]
        : [['Last cycle', 'none yet']];
      const typical = table.typicals?.[index];
      // Per kind of start, as a washing machine's programmes, when its cycles do not agree all together.
      const byStart = typical?.byStart ?? [];
      lines.push(['Usual running time', typical?.seconds ? `about ${duration(typical.seconds)}`
        : byStart.length > 0 ? `about ${byStart.map(duration).join(' or ')}, by how it starts`
          : (typical?.cycles ?? 0) < 2 ? 'after two cycles' : 'none: lengths vary']);
      lines.push(['Count', `${count} × ${label}`], ['Standby', standbyText(standby) ?? 'not counted yet']);
      addInfo(row, name, lines);
      shownOnly(values).forEach((value) => cell(row, kwh(value)));
    }
    const { total } = table;
    const foot = element.createTFoot().insertRow();
    cell(foot, 'Total');
    // Last cycles and counts of different appliances add up to nothing; standby does.
    if (standbyText(total.standby)) {
      addInfo(foot, 'Total', [['Standby', standbyText(total.standby)]]);
    }
    shownOnly(total.values).forEach((value) => cell(foot, kwh(value)));
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

  root.ApplianceViews = { LOCALE, kwh, duration, clock, byName, statisticsTable, chartPointer };
})(typeof window !== 'undefined' ? window : globalThis);
