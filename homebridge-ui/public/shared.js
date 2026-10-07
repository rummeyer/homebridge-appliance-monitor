/**
 * What the settings page and the dashboard both show, built once: numbers
 * as they are read, the statistics table, and the reading under the pointer
 * on the chart. Sets `window.ApplianceViews`.
 */
(function (root) {
  'use strict';

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

  /** A time on the chart: with the weekday when it spans days, with seconds when not. */
  const clock = (ms, long) =>
    new Date(ms).toLocaleString([], long
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
   * The statistics as a table, and the notes its marks need. `dates` puts
   * each period's dates under its name; `decorate(cell, name)` adds to the
   * first cell of a row, as the settings page does its reset checkbox.
   */
  function statisticsTable(table, { className = '', dates = false, decorate } = {}) {
    const element = document.createElement('table');
    element.className = className;
    const head = element.createTHead().insertRow();
    cell(head, 'Appliance', 'th');
    for (const period of table.periods) {
      const th = cell(head, period.label, 'th');
      if (dates) {
        const small = document.createElement('small');
        small.textContent = period.dates;
        th.append(small);
      }
    }
    cell(head, 'Last Cycle', 'th');
    cell(head, 'Count', 'th');

    const body = element.createTBody();
    for (const [index, { name, values, partial }] of table.rows.entries()) {
      const row = body.insertRow();
      const first = cell(row, name);
      decorate?.(first, name);
      values.forEach((value, column) => cell(row, `${kwh(value)}${value !== null && partial[column] ? ' ¹' : ''}`));
      const last = table.lastCycles?.[index];
      const lastCell = cell(row, last ? kwh(last.wattHours) : '–');
      if (last) {
        lastCell.title = `${clock(last.endedAt, true)} · ${duration(last.seconds)}`;
      }
      const { label, count } = table.counts[index];
      cell(row, `${count} × ${label}`);
    }
    const { total } = table;
    const foot = element.createTFoot().insertRow();
    cell(foot, 'Total');
    total.values.forEach((value, column) => {
      const marks = `${total.partial[column] ? ' ¹' : ''}${total.missing[column] ? ' *' : ''}`;
      cell(foot, value === null ? '' : `${kwh(value)}${marks}`);
    });
    cell(foot, ''); // last cycles of different appliances are no total
    cell(foot, ''); // counts of different things do not add up

    const shown = (flags) => total.values.some((value, column) => value !== null && flags[column]);
    const notes = [
      [total.partial, '¹ Only part of the period, from the day the plug was added.'],
      [total.missing, '* Without plugs not counted for the whole period.'],
    ].filter(([flags]) => shown(flags)).map(([, text]) => text);
    return { element, notes };
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

  root.ApplianceViews = { kwh, duration, clock, byName, statisticsTable, chartPointer };
})(typeof window !== 'undefined' ? window : globalThis);
