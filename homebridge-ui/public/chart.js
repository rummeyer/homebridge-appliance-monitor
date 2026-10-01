/**
 * The chart on the Power tab, drawn as an SVG string.
 *
 * Kept apart from the page, and free of the DOM, so that it can be drawn
 * outside a browser as well: the tests render it, and a picture of it can be
 * looked at without the Homebridge UI.
 *
 * Power is on a log scale, so that keeping warm at 2 W and heating at
 * 2000 W are both readable. Readings are a step function — a plug reports a
 * change, and the value holds until the next — and are drawn as steps.
 */
(function (root) {
  'use strict';

  const W = 1000;
  const PLOT_H = 300;
  const PAD = { left: 96, right: 78, top: 16, bottom: 30 };
  const STRIP_H = 20;
  const FLOOR = 0.5; // below this is off, drawn on the axis
  const PHASE_COLOURS = ['#e8833a', '#9b59b6', '#16a085', '#d64571', '#c9a227', '#2c7be5'];

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const STEPS = [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY];

  const escape = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** "2.4 W", "310 W", "1.2 kW". */
  function watts(value) {
    if (value >= 1000) {
      return `${Number((value / 1000).toFixed(value >= 10_000 ? 0 : 1))} kW`;
    }
    return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} W`;
  }

  /** Marks on whole minutes, hours or days, five to eight of them. */
  function timeMarks(from, to) {
    const span = to - from;
    const step = STEPS.find((s) => span / s <= 8) ?? STEPS[STEPS.length - 1];
    const first = new Date(from);
    if (step >= DAY) {
      first.setHours(0, 0, 0, 0);
    } else if (step >= HOUR) {
      first.setMinutes(0, 0, 0);
      first.setHours(Math.ceil(first.getHours() / (step / HOUR)) * (step / HOUR));
    } else {
      first.setSeconds(0, 0);
      first.setMinutes(Math.ceil(first.getMinutes() / (step / MINUTE)) * (step / MINUTE));
    }
    const marks = [];
    for (let at = first.getTime(); at <= to; at += step) {
      if (at >= from) {
        marks.push(at);
      }
    }
    const multiDay = span > 30 * HOUR;
    const label = (at) => {
      const date = new Date(at);
      if (step >= DAY) {
        return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
      }
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return multiDay ? `${date.toLocaleDateString([], { weekday: 'short' })} ${time}` : time;
    };
    return marks.map((at) => ({ at, label: label(at) }));
  }

  /** The stretches of time a step curve spent in [min, max). */
  function stretches(points, to, min, max) {
    const found = [];
    let start = null;
    for (let index = 0; index < points.length; index++) {
      const [at, value] = points[index];
      const inside = value >= min && value < max;
      if (inside && start === null) {
        start = at;
      } else if (!inside && start !== null) {
        found.push([start, at]);
        start = null;
      }
    }
    if (start !== null) {
      found.push([start, to]);
    }
    return found;
  }

  /**
   * The chart for a stretch of time.
   *
   * Returns the SVG and what the page needs to make it interactive: where a
   * moment is on the chart and back, and the reading at a moment.
   */
  function render({ from, to, points, levels = [], phases = [], spans = [] }) {
    const usable = phases
      .map((phase, index) => ({
        name: String(phase.name ?? ''),
        min: Number(phase.minWatts),
        max: phase.maxWatts == null || phase.maxWatts === '' ? Infinity : Number(phase.maxWatts),
        colour: PHASE_COLOURS[index % PHASE_COLOURS.length],
      }))
      .filter((phase) => phase.name && phase.min >= 0 && phase.max > phase.min);

    const peak = Math.max(10, ...points.map(([, value]) => value), ...usable.map((p) => (Number.isFinite(p.max) ? p.max : 0)));
    const logMin = Math.log10(FLOOR);
    const logMax = Math.log10(peak * 1.15);
    const plotW = W - PAD.left - PAD.right;
    const plotBottom = PAD.top + PLOT_H;
    const stripsTop = plotBottom + PAD.bottom;
    const height = stripsTop + (usable.length > 0 ? usable.length * STRIP_H + 6 : 0);

    const xOf = (at) => PAD.left + ((at - from) / (to - from)) * plotW;
    const yOf = (value) =>
      PAD.top + PLOT_H - ((Math.log10(Math.max(value, FLOOR)) - logMin) / (logMax - logMin)) * PLOT_H;
    const timeOf = (x) => from + ((Math.min(Math.max(x, PAD.left), W - PAD.right) - PAD.left) / plotW) * (to - from);
    const valueAt = (at) => {
      let value = null;
      for (const [time, reading] of points) {
        if (time > at) {
          break;
        }
        value = reading;
      }
      return value;
    };
    const f = (n) => Math.round(n * 10) / 10;

    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" class="om-chart" role="img">`,
      '<defs><linearGradient id="om-fill" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#2f80ed" stop-opacity="0.22"/>',
      '<stop offset="1" stop-color="#2f80ed" stop-opacity="0.02"/>',
      '</linearGradient></defs>',
      `<rect x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${PLOT_H}" class="om-plot"/>`,
    );

    // Grid: 1, 10, 100 W, 1 kW …, and the time marks.
    for (let decade = 0; 10 ** decade <= 10 ** logMax; decade++) {
      const y = f(yOf(10 ** decade));
      parts.push(
        `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y}" y2="${y}" class="om-grid"/>`,
        `<text x="${PAD.left - 8}" y="${y + 4}" text-anchor="end" class="om-tick">${watts(10 ** decade)}</text>`,
      );
    }
    for (const { at, label } of timeMarks(from, to)) {
      const x = f(xOf(at));
      parts.push(
        `<line x1="${x}" x2="${x}" y1="${PAD.top}" y2="${plotBottom}" class="om-grid"/>`,
        `<text x="${x}" y="${plotBottom + 18}" text-anchor="middle" class="om-tick">${escape(label)}</text>`,
      );
    }

    // Levels found in the curve, to pick from: a marker each in the margin to
    // the right, its band shown only while pointed at. Markers are pushed
    // apart where levels lie close together, and joined to theirs by a line.
    const markers = levels
      .map((level, index) => ({ level, index, y: yOf(level.watts) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < markers.length; i++) {
      markers[i].shown = Math.max(markers[i].y, (markers[i - 1].shown ?? markers[i - 1].y) + 18);
    }
    if (markers.length > 0) {
      markers[0].shown = markers[0].y;
    }
    for (const { level, index, y, shown } of markers) {
      const y1 = f(yOf(level.maxWatts));
      const y2 = f(yOf(level.minWatts));
      const label = watts(level.watts);
      const width = 12 + label.length * 7;
      const x = W - PAD.right + 10;
      parts.push(
        `<g class="om-level" data-level="${index}">`,
        `<title>${escape(`${label}: ${watts(level.minWatts)} to ${watts(level.maxWatts)}, ${Math.max(1, Math.round(level.seconds / 60))} min in all. Click to make it a phase.`)}</title>`,
        `<rect x="${PAD.left}" y="${y1}" width="${plotW}" height="${f(Math.max(3, y2 - y1))}" class="om-level-band"/>`,
        `<line x1="${W - PAD.right}" x2="${x}" y1="${f(y)}" y2="${f(shown)}" class="om-level-link"/>`,
        `<rect x="${f(x)}" y="${f(shown - 9)}" width="${width}" height="18" rx="9" class="om-level-pill"/>`,
        `<text x="${f(x + width / 2)}" y="${f(shown + 4)}" text-anchor="middle" class="om-level-label">${label}</text>`,
        '</g>',
      );
    }

    // Phases already set up, each in its colour. Two in the same range — a
    // coffee and a rinse, told apart by how long — have their names side by
    // side rather than on top of each other.
    const labels = [];
    for (const phase of usable) {
      const y1 = f(yOf(Number.isFinite(phase.max) ? phase.max : 10 ** logMax));
      const y2 = f(yOf(phase.min));
      const x = Math.max(PAD.left + 8, ...labels.filter((l) => Math.abs(l.y - y1) < 14).map((l) => l.end + 12));
      labels.push({ y: y1, end: x + phase.name.length * 7.5 });
      parts.push(
        `<rect x="${PAD.left}" y="${y1}" width="${plotW}" height="${f(Math.max(3, y2 - y1))}" fill="${phase.colour}" fill-opacity="0.07" stroke="${phase.colour}" stroke-opacity="0.55" stroke-dasharray="6 4" class="om-phase"/>`,
        `<text x="${f(x)}" y="${y1 + 14}" fill="${phase.colour}" class="om-phase-label">${escape(phase.name)}</text>`,
      );
    }

    // The curve, as steps, with the area under it.
    if (points.length > 0) {
      let line = '';
      for (const [index, [at, value]] of points.entries()) {
        line += index === 0 ? `M${f(xOf(at))},${f(yOf(value))}` : `H${f(xOf(at))}V${f(yOf(value))}`;
      }
      line += `H${f(xOf(to))}`;
      const area = `${line}V${plotBottom}H${f(xOf(points[0][0]))}Z`;
      parts.push(`<path d="${area}" fill="url(#om-fill)" class="om-area"/>`, `<path d="${line}" class="om-line"/>`);
    }

    // When each phase was on, under the chart: worked out by the server with
    // the phase's own rules where it can, else simply when the draw was in range.
    const spansOf = new Map(spans.map(({ name, spans: list }) => [name, list]));
    usable.forEach((phase, index) => {
      const y = stripsTop + index * STRIP_H;
      parts.push(`<rect x="${PAD.left}" y="${y + 2}" width="${plotW}" height="${STRIP_H - 4}" rx="4" class="om-strip"/>`);
      for (const [start, end] of spansOf.get(phase.name) ?? stretches(points, to, phase.min, phase.max)) {
        parts.push(
          `<rect x="${f(xOf(start))}" y="${y + 2}" width="${f(Math.max(3, xOf(end) - xOf(start)))}" height="${STRIP_H - 4}" rx="3" fill="${phase.colour}"><title>${escape(`${phase.name}: ${new Date(start).toLocaleTimeString()} – ${new Date(end).toLocaleTimeString()}`)}</title></rect>`,
        );
      }
      parts.push(`<text x="${PAD.left - 8}" y="${y + 13}" text-anchor="end" fill="${phase.colour}" class="om-strip-label">${escape(phase.name)}</text>`);
    });

    // Hover marker and the stretch being picked, moved by the page.
    parts.push(
      `<line x1="0" x2="0" y1="${PAD.top}" y2="${plotBottom}" class="om-hover" id="om-hover-line" visibility="hidden"/>`,
      `<g id="om-hover-tip" visibility="hidden"><rect rx="4" height="22" class="om-tip"/><text y="15" class="om-tip-text"></text></g>`,
      `<rect y="${PAD.top}" height="${PLOT_H}" width="0" class="om-pick" id="om-pick" visibility="hidden"/>`,
      '</svg>',
    );

    return { svg: parts.join(''), width: W, height, plotTop: PAD.top, plotBottom, xOf, timeOf, valueAt, watts };
  }

  /** Styles for the chart, light and dark alike. */
  const css = `
  .om-chart { width: 100%; height: auto; display: block; touch-action: none; user-select: none; }
  .om-chart text { font-size: 12px; font-family: inherit; }
  .om-plot { fill: rgba(128,128,128,.05); }
  .om-grid { stroke: rgba(128,128,128,.22); stroke-width: 1; }
  .om-tick { fill: currentColor; opacity: .65; }
  .om-line { fill: none; stroke: #2f80ed; stroke-width: 2.25; stroke-linejoin: round; }
  .om-level { cursor: pointer; }
  .om-level-band { fill: rgba(46,158,91,0); }
  .om-level:hover .om-level-band { fill: rgba(46,158,91,.18); }
  .om-level-pill { fill: rgba(46,158,91,.14); stroke: rgba(46,158,91,.55); }
  .om-level:hover .om-level-pill { fill: rgba(46,158,91,.32); }
  .om-level-link { stroke: rgba(46,158,91,.55); }
  .om-level-label { fill: #2e9e5b; font-weight: 600; font-size: 11px; pointer-events: none; }
  .om-strip-label { font-weight: 600; font-size: 11px; }
  .om-phase, .om-phase-label { pointer-events: none; }
  .om-phase-label { font-weight: 600; }
  .om-strip { fill: rgba(128,128,128,.12); }
  .om-hover { stroke: currentColor; stroke-opacity: .45; stroke-width: 1; pointer-events: none; }
  .om-tip { fill: rgba(30,30,30,.85); pointer-events: none; }
  .om-tip-text { fill: #fff; font-weight: 600; pointer-events: none; }
  .om-pick { fill: rgba(47,128,237,.16); stroke: rgba(47,128,237,.55); pointer-events: none; }
  `;

  root.ApplianceChart = { render, css, watts, timeMarks, stretches };
})(typeof window !== 'undefined' ? window : globalThis);
