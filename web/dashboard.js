/**
 * The dashboard page: reads what the plugin serves under /api and shows it,
 * again every few seconds. Nothing here writes; see dashboard.ts. The table
 * and the chart's pointer are the settings page's, from shared.js.
 */
(function () {
  'use strict';

  const LIVE_MS = 5000;
  const STATS_MS = 60_000;
  const $ = (id) => document.getElementById(id);
  const { ApplianceChart, ApplianceViews } = window;
  const { byName, chartPointer, duration, kwh, statisticsTable } = ApplianceViews;
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

  /** All plugs together, and how many appliances run. */
  function totalTile(appliances) {
    const counted = appliances.filter(current);
    const running = appliances.filter((appliance) => current(appliance) && appliance.state === 'running').length;
    const tile = el('div', 'card tile total');
    tile.append(el('div', 'name', 'Total'));
    tile.append(el('div', 'watts', counted.length > 0 ? watts(counted.reduce((sum, appliance) => sum + appliance.watts, 0)) : '–'));
    tile.append(el('div', 'state', running === 0 ? 'Nothing running' : `${running} running`));
    const missing = appliances.length - counted.length;
    if (missing > 0) {
      tile.append(el('div', 'detail', `Without ${missing} not reachable`));
    }
    return tile;
  }

  function tile(appliance, now) {
    const button = el('button', 'card tile');
    button.type = 'button';
    button.dataset.name = appliance.name;
    button.classList.toggle('chosen', appliance.name === $('plug').value);
    button.append(el('div', 'name', appliance.name));

    let state;
    let detail = '';
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
        detail = `${kwh(appliance.cycle.wattHours)} so far · peak ${watts(appliance.cycle.peakWatts)}`;
      }
    } else {
      button.classList.add('idle');
      state = 'Idle';
    }
    button.append(el('div', 'watts', typeof appliance.watts === 'number' ? watts(appliance.watts) : '–'));
    button.append(el('div', 'state', state));
    if (appliance.phases.length > 0) {
      const chips = el('div', 'chips');
      for (const phase of appliance.phases) {
        chips.append(el('span', 'chip', phase));
      }
      button.append(chips);
    }
    if (appliance.at) {
      button.title = `Last reading ${new Date(appliance.at).toLocaleTimeString()}`;
    }
    if (detail) {
      button.append(el('div', 'detail', detail));
    }
    button.addEventListener('click', () => choose(appliance.name));
    return button;
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
    $('updated').textContent = `Updated ${new Date(live.at).toLocaleTimeString()}`;
    const { appliances } = live;
    $('tiles').replaceChildren(
      totalTile(appliances),
      ...appliances.map((appliance) => tile(appliance, live.at)),
    );
    const fresh = appliances.map(({ name }) => name).sort(byName);
    if (fresh.join('\n') !== names.join('\n')) {
      names = fresh;
      fillPlugs();
    }
  }

  // ---- Power -----------------------------------------------------------------

  function fillPlugs() {
    const select = $('plug');
    const chosen = select.value || remembered('plug', '');
    select.replaceChildren(...names.map((name) => {
      const option = el('option', '', name);
      option.value = name;
      return option;
    }));
    if (names.includes(chosen)) {
      select.value = chosen;
    }
    void showCurve();
  }

  function choose(name) {
    $('plug').value = name;
    remember('plug', name);
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
      curve = await get(`api/curve?name=${encodeURIComponent(name)}&hours=${hours}`);
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
      box.replaceChildren(el('div', 'muted empty', 'Nothing recorded for this plug in that time.'));
      return;
    }
    const chart = ApplianceChart.render(curve);
    box.innerHTML = chart.svg;
    const svg = box.querySelector('svg');
    svg.setAttribute('aria-label', `Power of ${name}`);
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
      $('notes').replaceChildren();
      return;
    }
    const { element, notes } = statisticsTable(table, { dates: true });
    $('stats').replaceChildren(element);
    $('notes').replaceChildren(...[...notes, 'Energy is saved every five minutes.'].map((text) => el('p', '', text)));
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
