/**
 * The dashboard page: reads what the plugin serves under /api and shows it,
 * again every few seconds. Nothing here writes; see dashboard.ts. The table
 * and the chart's pointer are the settings page's, from shared.js.
 */
(function () {
  'use strict';

  const LIVE_MS = 5000;
  /** The choice that is all plugs together; no plug name has a control character. */
  const TOTAL = '\u0001total';
  /** All plugs together, as the Home app calls it in the Home look. */
  const totalName = () => (document.documentElement.dataset.theme === 'home' ? 'Electricity' : 'Total');
  const STATS_MS = 60_000;
  const $ = (id) => document.getElementById(id);
  const { ApplianceChart, ApplianceViews } = window;
  const { LOCALE, byName, chartPointer, duration, kwh, statisticsTable } = ApplianceViews;
  const { watts } = ApplianceChart;

  const style = document.createElement('style');
  style.textContent = ApplianceChart.css;
  document.head.append(style);

  const get = async (path) => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  };

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  /** A plug, as the Home app draws an outlet; shown only in the Home look. */
  function icon(total) {
    const box = el('span', 'icon');
    box.setAttribute('aria-hidden', 'true');
    // A filled outlet, its holes in --hole: two slots and the earth below.
    box.innerHTML = total
      ? '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M13.2 2.5 5.6 13.1c-.4.6 0 1.4.7 1.4h4.6l-1.2 7c-.1.6.7.9 1 .4l7.6-10.6c.4-.6 0-1.4-.7-1.4H13l1.2-7c.1-.6-.7-.9-1-.4z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="currentColor"/><g style="fill: var(--hole)"><rect x="8.3" y="7.6" width="1.9" height="4.6" rx=".95"/><rect x="13.8" y="7.6" width="1.9" height="4.6" rx=".95"/><path d="M10.5 17v-1.1a1.5 1.5 0 0 1 3 0V17z"/></g></svg>';
    return box;
  }

  // ---- Remembered choice -----------------------------------------------------

  const remembered = (key, fallback) => {
    try {
      return localStorage.getItem(`appliance-monitor.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const remember = (key, value) => {
    try {
      localStorage.setItem(`appliance-monitor.${key}`, value);
    } catch {
      // A private window: forgotten on reload, which is fine.
    }
  };

  // ---- Now -------------------------------------------------------------------

  let names = [];

  /** Whether what a plug last said can be counted as what it draws now. */
  const current = (appliance) => appliance.paired && appliance.reachable !== false && typeof appliance.watts === 'number';

  /** All plugs together, and how many appliances run. One measured by another plug too is in that one already. */
  function totalTile(all) {
    const appliances = all.filter((appliance) => !appliance.partOf);
    const counted = appliances.filter(current);
    const running = appliances.filter((appliance) => current(appliance) && appliance.state === 'running').length;
    const tile = el('button', 'card tile total');
    tile.type = 'button';
    tile.dataset.name = TOTAL;
    tile.classList.toggle('chosen', $('plug').value === TOTAL);
    tile.classList.toggle('running', running > 0);
    tile.append(icon(true), el('div', 'name total-name', totalName()));
    tile.append(el('div', 'watts', counted.length > 0 ? watts(counted.reduce((sum, appliance) => sum + appliance.watts, 0)) : '–'));
    tile.append(el('div', 'state', running === 0 ? 'Nothing running' : `${running} running`));
    const missing = appliances.length - counted.length;
    if (missing > 0) {
      tile.append(el('div', 'detail', `Without ${missing} not reachable`));
    }
    tile.addEventListener('click', () => choose(TOTAL));
    return tile;
  }

  function tile(appliance, now) {
    const button = el('button', 'card tile');
    button.type = 'button';
    button.dataset.name = appliance.name;
    button.classList.toggle('chosen', appliance.name === $('plug').value);
    button.append(icon(false), el('div', 'name', appliance.name));

    let state;
    let detail;
    if (!appliance.paired) {
      button.classList.add('gone');
      state = 'Not connected yet';
    } else if (appliance.reachable === false) {
      button.classList.add('gone');
      state = 'Unreachable';
    } else if (appliance.state === 'running') {
      button.classList.add('running');
      state = appliance.since ? `Running for ${duration((now - appliance.since) / 1000)}` : 'Running';
      if (appliance.cycle) {
        // How long it has left, where its cycles have a usual length, rather than its peak.
        detail = [kwh(appliance.cycle.wattHours), remaining(appliance, now) ?? `peak ${watts(appliance.cycle.peakWatts)}`];
      }
    } else {
      button.classList.add('idle');
      state = 'Idle';
    }
    button.append(el('div', 'watts', typeof appliance.watts === 'number' ? watts(appliance.watts) : '–'));
    button.append(el('div', 'state', state));
    if (appliance.phases.length > 0 || appliance.overtime || appliance.idleOn) {
      const chips = el('div', 'chips');
      if (appliance.overtime) {
        chips.append(el('span', 'chip warn', 'Overtime'));
      }
      if (appliance.idleOn) {
        chips.append(el('span', 'chip warn', 'Idle on'));
      }
      for (const phase of appliance.phases) {
        chips.append(el('span', 'chip', phase));
      }
      button.append(chips);
    }
    if (appliance.at) {
      button.title = `Last reading ${new Date(appliance.at).toLocaleTimeString(LOCALE)}`;
    }
    if (detail) {
      // "so far" apart, for the Home look to leave out where the tile is small.
      const [used, peak] = detail;
      const line = el('div', 'detail');
      const first = el('span', '', used);
      first.append(el('span', 'so-far', ' so far'));
      line.append(first, el('span', '', peak));
      button.append(line);
    } else if (appliance.partOf) {
      button.append(el('div', 'detail', `Part of ${appliance.partOf}`));
    }
    button.addEventListener('click', () => choose(appliance.name));
    return button;
  }

  /** "35 min left", "about done", or "longer than usual", from how long its cycles usually take. */
  function remaining(appliance, now) {
    if (!appliance.typicalSeconds || !appliance.cycle?.startedAt) {
      return undefined;
    }
    const left = appliance.typicalSeconds - (now - appliance.cycle.startedAt) / 1000;
    if (left >= 90) {
      return `${duration(left)} left`;
    }
    // A cycle a few minutes over is about done; one well over is not like the others.
    return left > -0.15 * appliance.typicalSeconds ? 'about done' : 'longer than usual';
  }

  async function showLive() {
    let live;
    try {
      live = await get('api/live');
    } catch (error) {
      $('updated').textContent = `Plugin not answering (${error.message})`;
      $('updated').classList.add('error');
      return;
    }
    $('updated').classList.remove('error');
    $('updated').textContent = `Updated ${new Date(live.at).toLocaleTimeString(LOCALE)}`;
    $('version').textContent = live.version ? `Version ${live.version}` : '';
    const { appliances } = live;
    // The choice first, so the tiles mark it from the first time on.
    const fresh = appliances.map(({ name }) => name).sort(byName);
    if (fresh.join('\n') !== names.join('\n')) {
      names = fresh;
      fillPlugs();
    }
    $('tiles').replaceChildren(
      totalTile(appliances),
      ...appliances.map((appliance) => tile(appliance, live.at)),
    );
  }

  // ---- Power -----------------------------------------------------------------

  function fillPlugs() {
    const select = $('plug');
    // Every visit opens on all plugs together; only a change of plugs keeps the choice.
    const chosen = select.value || TOTAL;
    select.replaceChildren(...[[TOTAL, totalName()], ...names.map((name) => [name, name])].map(([value, text]) => {
      const option = el('option', '', text);
      option.value = value;
      return option;
    }));
    if (chosen === TOTAL || names.includes(chosen)) {
      select.value = chosen;
    }
    void showCurve();
  }

  function choose(name) {
    $('plug').value = name;
    for (const button of document.querySelectorAll('.tile[data-name]')) {
      button.classList.toggle('chosen', button.dataset.name === name);
    }
    void showCurve();
    $('chart').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  let curveTimer;
  let pointer = null;

  async function showCurve() {
    clearTimeout(curveTimer);
    const name = $('plug').value;
    const hours = Number($('hours').value);
    curveTimer = setTimeout(showCurve, hours > 24 ? 30_000 : LIVE_MS);
    const box = $('chart');
    if (!name) {
      return;
    }
    let curve;
    try {
      curve = await get(name === TOTAL
        ? `api/total?hours=${hours}`
        : `api/curve?name=${encodeURIComponent(name)}&hours=${hours}`);
    } catch (error) {
      if (!box.querySelector('svg')) {
        box.replaceChildren(el('div', 'muted empty', `Could not read the recording (${error.message}).`));
      }
      return;
    }
    if (name !== $('plug').value || hours !== Number($('hours').value)) {
      return; // moved on meanwhile
    }
    if (curve.points.length === 0) {
      box.replaceChildren(el('div', 'muted empty', name === TOTAL ? 'Nothing recorded in that time.' : 'Nothing recorded for this plug in that time.'));
      return;
    }
    const chart = ApplianceChart.render(curve);
    box.innerHTML = chart.svg;
    const svg = box.querySelector('svg');
    svg.setAttribute('aria-label', name === TOTAL ? 'Power of all plugs together' : `Power of ${name}`);
    const { toChart, hover } = chartPointer(svg, chart, curve);
    svg.addEventListener('pointermove', (event) => {
      pointer = toChart(event);
      hover(pointer);
    });
    svg.addEventListener('pointerleave', () => {
      pointer = null;
      hover(null);
    });
    hover(pointer);
  }

  // The name follows the look as soon as it is switched, not at the next update.
  new MutationObserver(() => {
    for (const element of document.querySelectorAll(`.total-name, option[value="${TOTAL}"]`)) {
      element.textContent = totalName();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  $('plug').addEventListener('change', () => choose($('plug').value));
  $('hours').addEventListener('change', () => {
    remember('hours', $('hours').value);
    void showCurve();
  });
  const hours = remembered('hours', '');
  if ([...$('hours').options].some((option) => option.value === hours)) {
    $('hours').value = hours;
  }

  // ---- Statistics ------------------------------------------------------------

  async function showStats() {
    let table;
    try {
      table = await get('api/statistics');
    } catch (error) {
      $('stats').replaceChildren(el('p', 'error', `Could not read the statistics (${error.message}).`));
      return;
    }
    if (table.rows.length === 0) {
      $('stats').replaceChildren(el('p', 'muted', 'No plugs configured.'));
      return;
    }
    $('stats').replaceChildren(statisticsTable(table, { dates: true }));
  }

  // ---- Refresh ---------------------------------------------------------------

  void showLive();
  void showStats();
  setInterval(() => {
    if (!document.hidden) {
      void showLive();
    }
  }, LIVE_MS);
  setInterval(() => {
    if (!document.hidden) {
      void showStats();
    }
  }, STATS_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void showLive();
      void showStats();
      void showCurve();
    }
  });
})();
