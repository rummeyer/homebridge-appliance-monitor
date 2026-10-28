/**
 * The Settings tab: one appliance at a time, picked from a list.
 *
 * Homebridge's own form shows every plug's settings one under the other,
 * which with a dozen plugs is a long page to find one in. This shows a list
 * to pick from, and below it the one picked.
 *
 * An appliance's phases are only listed here; they are edited on the Power
 * tab, next to the chart they are found in. This module draws them there too
 * (`showPhases`), on the same config, so the two tabs cannot write over each
 * other.
 *
 * Changes go to Homebridge as they are made (`updatePluginConfig`), and are
 * saved with the Save button of the settings window, as with Homebridge's own
 * form. Only what differs from the default is written, so the config stays as
 * short as a hand-written one.
 */
(function (root) {
  'use strict';

  const PLATFORM = 'ApplianceMonitor';
  const NEW_NAME = 'New appliance';
  /** As MIN_POLL_SECONDS in config.ts. */
  const MIN_POLL_SECONDS = 2;
  const pollError = (seconds) =>
    (seconds !== undefined && seconds < MIN_POLL_SECONDS ? `At least ${MIN_POLL_SECONDS} s; shorter asks every ${MIN_POLL_SECONDS} s.` : '');
  /** As usableMinutes in config.ts. */
  /** What Idle counts: from the end of a phase, or from when it stops running. */
  const idleOnHelp = (device) => (device.idleOnFrom
    ? `This long after the end of ${device.idleOnFrom}, or of another phase after it.`
    : 'On this long without running.');
  const minutesError = (minutes) => (minutes !== undefined && !(minutes > 0) ? 'More than 0 minutes, or empty for none.' : '');
  /** As DEFAULT_DASHBOARD_PORT and usableDashboardPort in config.ts. */
  const DEFAULT_DASHBOARD_PORT = 8582;
  const dashboardOn = (config) => config.dashboard ?? (config.dashboardPort !== undefined && config.dashboardPort !== null);
  /** As DEFAULT_MQTT_URL and DEFAULT_MQTT_PREFIX in config.ts. */
  const DEFAULT_MQTT_URL = 'mqtt://localhost:1883';
  const DEFAULT_MQTT_PREFIX = 'appliance-monitor';
  const PAIRING_CODE = /^\s*((\d[\s-]*){11}|(\d[\s-]*){21}|MT:[0-9A-Z.\-]+)\s*$/i;
  const LOG_LEVELS = [
    ['error', 'Errors only'],
    ['warn', 'Warnings'],
    ['notice', 'Notices'],
    ['info', 'Info'],
    ['debug', 'Debug'],
  ];

  const css = `
  .om-set-bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
  .om-set-bar select { width: 14rem; max-width: 100%; }
  .om-set-section { margin-bottom: 1.25rem; }
  .om-set-section > h6 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; margin-bottom: .5rem; }
  .om-set-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem 1rem; }
  /* Rows of fewer fields, in the same columns as a full one. */
  .om-set-grid.om-set-rows { grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); }
  .om-set-rows + .om-set-rows { margin-top: .75rem; }
  .om-set-help { font-size: .78rem; opacity: .65; margin-top: .2rem; }
  .om-set-icon { display: flex; align-items: center; gap: .5rem; }
  .om-set-icon-preview { display: flex; flex: none; --hole: var(--bs-body-bg, #fff); }
  .om-set-error { font-size: .78rem; color: #d64545; margin-top: .2rem; }
  /* A phase in one line. Fixed widths for the checkboxes, as each row is a
     grid of its own and the heading row has none: each as wide as its label
     measured in the Homebridge UI, and a few pixels. The numbers without
     arrows, just wide enough for "1000"; the name gets whatever is left of the
     768 pixels the Homebridge UI gives the page. */
  .om-set-phase { display: grid; grid-template-columns: minmax(0, 1fr) repeat(5, 3.05rem) 5.2rem 6.4rem 4.35rem 4.05rem 1.4rem;
                  gap: .25rem; align-items: center; padding: .3rem 0; }
  .om-set-phase-switches { display: contents; }
  .om-set-phase input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  .om-set-phase input[type=number]::-webkit-inner-spin-button,
  .om-set-phase input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .om-set-phase .form-control { padding-left: .3rem; padding-right: .3rem; }
  .om-set-phase.om-set-head { font-size: .78rem; opacity: .7; padding-bottom: 0; align-items: end; }
  .om-set-phase .form-check { margin: 0; white-space: nowrap; padding-left: 1.25rem; }
  /* The label close to its box: a quarter of a rem instead of half; rem, as
     the box has a font size of its own. As
     specific as Bootstrap's own rule, which otherwise wins and pushes the box
     out of its column onto the field before it. */
  .om-set-phase .form-check .form-check-input { margin-left: -1.25rem; }
  /* Small and square, the cross in the middle of it. A
     drawn cross rather than "×", which each font puts somewhere else; and
     !important, as the host's own button styles would win otherwise. */
  .om-set-x { width: 1.4rem !important; height: 1.4rem !important; padding: 0 !important;
              display: inline-flex !important; align-items: center !important; justify-content: center !important; }
  .om-set-x svg { display: block; width: .55rem; height: .55rem; }
  .om-set-message { display: grid; grid-template-columns: minmax(7.125rem, 1fr) 6.5rem minmax(0, 2fr) minmax(0, 3fr) 1.4rem;
                    gap: .4rem; align-items: center; padding: .3rem 0; }
  .om-set-message .form-control { padding-left: .4rem; padding-right: .4rem; }
  .om-set-message.om-set-head { font-size: .78rem; opacity: .7; padding-bottom: 0; align-items: end; }
  @media (max-width: 760px) {
    .om-set-phase, .om-set-message { grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(128,128,128,.2); padding: .5rem 0; }
    .om-set-phase.om-set-head, .om-set-message.om-set-head { display: none; }
  }
  .om-set-poll { margin-bottom: 0; }
  .om-set-poll input { max-width: 13rem; }
  .om-set-rule { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .5rem; margin-bottom: .5rem; font-size: .9rem; }
  .om-set-rule strong { min-width: 4.5rem; }
  .om-set-rule .input-group { width: 9.5rem; }
  /* An empty field shows what applies instead, and must not pass for a value. */
  .om-set-more input::placeholder { font-style: italic; opacity: .45; }
  details.om-set-more > summary { cursor: pointer; font-size: .85rem; opacity: .8; margin-bottom: .75rem; }
  .om-set-small { font-size: .75rem; padding: .1rem .5rem; }
  .om-set-badge { font-size: .75rem; padding: .1rem .45rem; border-radius: .25rem; background: rgba(46,158,91,.18); color: #2e9e5b; }
  `;

  /** A tiny element builder: el('div', { class: 'x' }, child, 'text'). */
  function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key.startsWith('on')) {
        element.addEventListener(key.slice(2), value);
      } else if (key === 'class') {
        element.className = value;
      } else if (value === true) {
        element.setAttribute(key, '');
      } else {
        element.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat()) {
      if (child !== undefined && child !== null && child !== false) {
        element.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return element;
  }

  /** Sets a key, or removes it when the value is the default or empty. */
  function setOrDrop(object, key, value, fallback) {
    if (value === undefined || value === null || value === '' || value === fallback) {
      delete object[key];
    } else {
      object[key] = value;
    }
  }

  const numberOrUndefined = (text) => {
    const trimmed = String(text).trim();
    if (trimmed === '') {
      return undefined;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  };

  /** A cross drawn in the colour of the text, for a button that removes something. */
  function cross() {
    const template = document.createElement('template');
    template.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    return template.content.firstChild;
  }

  /**
   * Makes `button` ask "SURE?" on the first click and run `onSure` on a second
   * one within five seconds — asked on the button rather than with confirm(),
   * which the settings window's frame may not be allowed to show. `reset`
   * puts the button back, for an `onSure` that failed.
   */
  function askTwice(button, onSure) {
    const label = button.textContent;
    let armed = null;
    const reset = () => {
      clearTimeout(armed);
      armed = null;
      button.textContent = label;
      button.classList.replace('btn-danger', 'btn-outline-danger');
    };
    button.addEventListener('click', () => {
      if (!armed) {
        button.textContent = 'SURE?';
        button.classList.replace('btn-outline-danger', 'btn-danger');
        armed = setTimeout(reset, 5000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      void onSure(reset);
    });
    return button;
  }

  /** The plugin's config as Homebridge has it, or a new one. */
  async function loadConfigs(homebridge) {
    const configs = await homebridge.getPluginConfig();
    return configs.length ? configs : [{ platform: PLATFORM, name: 'Appliance Monitor', devices: [] }];
  }

  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

  /**
   * Mounts the form in `container`. `homebridge` is the host's object; `paired`
   * the names of the plugs that are paired, for a mark in the list.
   */
  async function mount(container, { homebridge, paired = [] }) {
    let configs = await loadConfigs(homebridge);
    const config = configs[0];
    config.devices = Array.isArray(config.devices) ? config.devices.filter((d) => d && typeof d === 'object') : [];
    const pairedNames = new Set(paired);
    /** Paired itself, or sharing the pairing of one that is. */
    const isPairedDevice = (device) => pairedNames.has(device.name) || Boolean(device.pairedWith && pairedNames.has(device.pairedWith));
    /** What measures power behind each pairing; see the server's /endpoints. */
    const metered = (await homebridge.request('/endpoints').catch(() => null)) ?? {};
    /** What each appliance uses where its thresholds are empty; see the server's /learned. */
    let inUse = (await homebridge.request('/learned').catch(() => null)) ?? {};
    /** Where this machine can be reached, for the link to the dashboard. */
    const address = await homebridge.request('/address').catch(() => null);

    let selected = config.devices.length ? sortedIndices()[0] : -1;
    let pending;
    /** Where the Power tab shows the phases, and of which appliance. */
    let phaseView = null; // { target, name, onChange }

    /** Hands the config to Homebridge, a moment after the last change. */
    function changed() {
      // Settings of earlier versions that are no longer used: the Finished
      // switch (Running going off says the same), when Finished ended, and
      // the off level.
      for (const device of config.devices) {
        for (const key of ['finishedSwitch', 'finishedSensor', 'finishedReset', 'finishedResetMinutes']) {
          delete device[key];
        }
        if (device.thresholds) {
          delete device.thresholds.offWatts;
          if (!Object.keys(device.thresholds).length) {
            delete device.thresholds;
          }
        }
      }
      clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        void homebridge.updatePluginConfig(configs);
      }, 250);
    }

    function sortedIndices() {
      return config.devices
        .map((device, index) => ({ name: String(device.name ?? ''), index }))
        .sort((a, b) => byName(a.name, b.name))
        .map(({ index }) => index);
    }

    function uniqueName(base) {
      const names = new Set(config.devices.map((d) => d.name));
      if (!names.has(base)) {
        return base;
      }
      for (let n = 2; ; n++) {
        if (!names.has(`${base} ${n}`)) {
          return `${base} ${n}`;
        }
      }
    }

    // ---- Building blocks ----------------------------------------------------

    function field(label, input, help, error) {
      return el('div', {}, el('label', { class: 'form-label mb-1' }, label), input,
        help ? el('div', { class: 'om-set-help' }, help) : null,
        el('div', { class: 'om-set-error', hidden: !error }, error ?? ''));
    }

    /** Shows `error` under the field of `input`, or hides it when there is none. */
    function showError(input, error) {
      const line = input.parentElement.querySelector('.om-set-error');
      line.textContent = error;
      line.hidden = !error;
    }

    function text(value, placeholder, onInput) {
      return el('input', { class: 'form-control form-control-sm', value: value ?? '', placeholder, oninput: (e) => onInput(e.target.value, e.target) });
    }

    function number(value, placeholder, onInput, min = 0) {
      return el('input', {
        class: 'form-control form-control-sm', type: 'number', min, step: 'any', inputmode: 'decimal',
        value: value ?? '', placeholder, oninput: (e) => onInput(e.target.value, e.target),
      });
    }

    function check(id, label, checked, onChange) {
      return el('div', { class: 'form-check' },
        el('input', { class: 'form-check-input', type: 'checkbox', id, checked, onchange: (e) => onChange(e.target.checked) }),
        el('label', { class: 'form-check-label', for: id }, label));
    }

    /** The names of an appliance's phases, as Idle may count from one. */
    function phaseNames(device) {
      return (device.phases ?? []).map((phase) => (phase.name ?? '').trim()).filter(Boolean);
    }

    function choice(value, options, onChange) {
      return el('select', { class: 'form-select form-select-sm', onchange: (e) => onChange(e.target.value) },
        options.map(([key, label]) => el('option', { value: key, selected: key === value }, label)));
    }

    // ---- The page -----------------------------------------------------------

    function render() {
      container.replaceChildren(bar(), selected >= 0 ? deviceForm(config.devices[selected]) : empty(), general());
    }

    function bar() {
      const list = el('select', {
        class: 'form-select', 'aria-label': 'Appliance',
        onchange: (e) => { selected = Number(e.target.value); render(); },
      }, sortedIndices().map((index) => {
        const name = config.devices[index].name || '(no name)';
        return el('option', { value: index, selected: index === selected }, `${name}${isPairedDevice(config.devices[index]) ? '  ✓' : ''}`);
      }));
      const add = el('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          config.devices.push({ name: uniqueName(NEW_NAME) });
          selected = config.devices.length - 1;
          changed();
          render();
          const name = container.querySelector('#om-set-name');
          name?.focus();
          name?.select();
        },
      }, '+ Add');
      const remove = askTwice(el('button', {
        type: 'button', class: 'btn btn-outline-danger', disabled: selected < 0,
        title: selected < 0 ? '' : `Delete ${config.devices[selected]?.name}`,
      }, 'Delete'), () => {
        config.devices.splice(selected, 1);
        selected = config.devices.length ? sortedIndices()[0] : -1;
        changed();
        render();
      });
      return el('div', { class: 'om-set-bar' }, config.devices.length ? list : null, add, remove);
    }

    function empty() {
      return el('p', { class: 'text-muted' }, 'No appliances yet. Add one with its plug\'s pairing code from the Home app.');
    }

    function deviceForm(device) {
      const others = new Set(config.devices.filter((d) => d !== device).map((d) => d.name));
      const nameError = (value) => (!value.trim() ? 'A name is needed.' : others.has(value.trim()) ? 'Another appliance has this name.' : '');
      const codeError = (value) => (value.trim() && !PAIRING_CODE.test(value) ? 'Not a Matter setup code: eleven digits, or MT:…' : '');

      const nameInput = text(device.name, NEW_NAME, (value, input) => {
        // Unlike a pairing, being part of it needs nothing redone, so it follows the rename.
        for (const other of config.devices) {
          if (other !== device && other.partOf && other.partOf === device.name) {
            other.partOf = value;
          }
        }
        device.name = value;
        showError(input, nameError(value));
        // Keep the list in step without rebuilding the field being typed in.
        const option = container.querySelector(`.om-set-bar option[value="${selected}"]`);
        if (option) {
          option.textContent = value || '(no name)';
        }
        changed();
      });
      nameInput.id = 'om-set-name';

      const codeInput = text(device.pairingCode, pairedNames.has(device.name) ? '' : '3497-011-2332', (value, input) => {
        setOrDrop(device, 'pairingCode', value.trim());
        showError(input, codeError(value));
        changed();
      });

      const isPaired = isPairedDevice(device);

      // A plug that publishes its readings itself, a Shelly say: a topic
      // instead of a pairing, so nothing of pairing is shown. Kept as ''
      // while chosen and not filled in yet.
      const viaMqtt = typeof device.mqttTopic === 'string';
      const topicError = (value) => (typeof value === 'string' && /[+#]/.test(value) ? 'One topic exactly: no + or #.' : '');
      const mqttFields = viaMqtt
        ? [
          field('Topic', text(device.mqttTopic, 'plug/power', (value, input) => {
            device.mqttTopic = value.trim();
            showError(input, topicError(value));
            changed();
          }), 'JSON with the watts, or a number.', topicError(device.mqttTopic)),
          field('Online topic', text(device.mqttOnlineTopic, 'plug/online', (value, input) => {
            setOrDrop(device, 'mqttOnlineTopic', value.trim());
            showError(input, topicError(value));
            changed();
          }), 'Optional: true/false, online/offline.', topicError(device.mqttOnlineTopic)),
          field('Watts key', text(device.mqttPowerKey, 'apower', (value) => {
            setOrDrop(device, 'mqttPowerKey', value.trim());
            changed();
          }), 'a.b for one inside another.'),
          field('Relay key', text(device.mqttRelayKey, 'output', (value) => {
            setOrDrop(device, 'mqttRelayKey', value.trim());
            changed();
          }), 'True while switched on.'),
        ]
        : [];

      // Behind a Matter bridge, paired once: the others share that pairing,
      // and each follows one device of it. Offered only where more than one
      // device measures, so a house of plain plugs sees nothing of it.
      const owners = config.devices
        .filter((d) => d !== device && d.name && !d.pairedWith && typeof d.mqttTopic !== 'string' && (metered[d.name]?.length ?? 0) > 1)
        .map((d) => d.name).sort(byName);
      // Where its readings come from, in one list: its own Matter pairing, a
      // bridge's it shares — offered only where more than one device
      // measures, so a house of plain plugs sees nothing of it — or a topic.
      const sources = [['own', 'Matter pairing'],
        ...owners.map((name) => [`with:${name}`, `Matter via ${name}`])];
      if (device.pairedWith && !owners.includes(device.pairedWith)) {
        sources.push([`with:${device.pairedWith}`, `Matter via ${device.pairedWith} (not found)`]);
      }
      sources.push(['mqtt', 'MQTT topic']);
      const readingsField = field('Readings from',
        choice(viaMqtt ? 'mqtt' : device.pairedWith ? `with:${device.pairedWith}` : 'own', sources, (value) => {
          if (value === 'mqtt') {
            device.mqttTopic = device.mqttTopic ?? '';
          } else {
            for (const key of ['mqttTopic', 'mqttOnlineTopic', 'mqttPowerKey', 'mqttRelayKey']) {
              delete device[key];
            }
          }
          // A bridge's device is the bridge's; the code stays, for going back.
          const owner = value.startsWith('with:') ? value.slice('with:'.length) : '';
          if (owner !== (device.pairedWith ?? '')) {
            for (const key of ['deviceId', 'endpoint']) {
              delete device[key];
            }
          }
          setOrDrop(device, 'pairedWith', owner);
          if (owner) {
            delete device.pairingCode;
          }
          changed();
          render();
        }),
        viaMqtt ? (config.mqtt === true ? 'Nothing to pair.' : 'MQTT is off: switch it on under General.')
          : device.pairedWith ? 'A bridge is paired once; the devices behind it share that pairing.'
            : 'Or a topic a plug publishes to.')
      const devices = metered[device.pairedWith || device.name] ?? [];
      const current = device.deviceId ?? (device.endpoint === undefined ? '' : `endpoint:${device.endpoint}`);
      const deviceOptions = [['', 'Every reading (a plug of its own)'],
        ...devices.map((d) => [d.uniqueId ?? `endpoint:${d.endpoint}`, `${d.name ?? 'Endpoint'} · endpoint ${d.endpoint}`])];
      if (current && !deviceOptions.some(([key]) => key === current)) {
        deviceOptions.push([current, `${current} (not found)`]);
      }
      const deviceField = !viaMqtt && (devices.length > 1 || current)
        ? field('Device',
          choice(current, deviceOptions, (value) => {
            const endpoint = value.startsWith('endpoint:') ? Number(value.slice('endpoint:'.length)) : undefined;
            setOrDrop(device, 'endpoint', endpoint);
            setOrDrop(device, 'deviceId', endpoint === undefined ? value : '');
            changed();
          }),
          'Which device behind the bridge this appliance follows.')
        : null;

      // For something measured twice: a lamp reporting its own watts, plugged
      // into a metered socket that is an appliance here too.
      const wholes = config.devices.filter((d) => d !== device && d.name).map((d) => d.name).sort(byName);
      const partOfOptions = [['', 'None'], ...wholes.map((name) => [name, `Part of ${name}`])];
      if (device.partOf && !wholes.includes(device.partOf)) {
        partOfOptions.push([device.partOf, `Part of ${device.partOf} (not found)`]);
      }
      const partOfField = wholes.length || device.partOf
        ? field('Part of',
          choice(device.partOf ?? '', partOfOptions, (value) => {
            setOrDrop(device, 'partOf', value);
            changed();
          }),
          'Its plug is also measured by another appliance here, so the totals leave it out.')
        : null;

      // The icon of its dashboard tile, shown next to the list as it is picked.
      const { ApplianceIcons } = window;
      const iconPreview = el('span', { class: 'om-set-icon-preview', 'aria-hidden': 'true' });
      iconPreview.innerHTML = ApplianceIcons.svg(device.icon, 22);
      const iconValue = ApplianceIcons.has(device.icon) ? device.icon ?? ApplianceIcons.DEFAULT : ApplianceIcons.DEFAULT;
      // In groups, as there are many; the outlet, the default, on its own first.
      const iconList = el('select', {
        class: 'form-select form-select-sm',
        onchange: (e) => {
          setOrDrop(device, 'icon', e.target.value === ApplianceIcons.DEFAULT ? undefined : e.target.value);
          iconPreview.innerHTML = ApplianceIcons.svg(e.target.value, 22);
          changed();
        },
      }, ApplianceIcons.groups.map(([group, icons]) => {
        const options = icons.map(([key, label]) => el('option', { value: key, selected: key === iconValue }, label));
        return group ? el('optgroup', { label: group }, options) : options;
      }).flat());
      const iconField = field('Icon', el('div', { class: 'om-set-icon' }, iconPreview, iconList), 'On its dashboard tile, in the Home look.');

      // What Idle counts, under its field; changes with what it counts from.
      const idleOnField = field('Idle after (min)', number(device.idleOnMinutes, 'off', (value, input) => {
        setOrDrop(device, 'idleOnMinutes', numberOrUndefined(value));
        showError(input, minutesError(device.idleOnMinutes));
        changed();
      }, 1), idleOnHelp(device), minutesError(device.idleOnMinutes));

      return el('div', {},
        el('div', { class: 'om-set-section' },
          el('h6', {}, 'Appliance ', viaMqtt ? el('span', { class: 'om-set-badge' }, 'MQTT') : isPaired ? el('span', { class: 'om-set-badge' }, 'paired') : null),
          // Two rows, so that the icon is always under the name: the
          // pairing first, with the device behind a bridge where no code is
          // needed, then the rest.
          el('div', { class: 'om-set-grid om-set-rows' },
            field('Name', nameInput, viaMqtt ? 'Its statistics go by it.' : 'Renaming means pairing again.', nameError(device.name ?? '')),
            readingsField,
            device.pairedWith ? deviceField : viaMqtt ? mqttFields[0] : field('Pairing code', codeInput,
              isPaired ? 'Paired; no longer needed.' : 'Home app: plug settings → Turn On Pairing Mode.',
              codeError(device.pairingCode ?? ''))),
          // The topic where the code would be; the rest of it on a row of its own.
          viaMqtt ? el('div', { class: 'om-set-grid om-set-rows' }, ...mqttFields.slice(1)) : null,
          el('div', { class: 'om-set-grid om-set-rows' },
            iconField,
            device.pairedWith || viaMqtt ? null : deviceField,
            partOfField)),

        el('div', { class: 'om-set-section' },
          el('h6', {}, 'In HomeKit'),
          el('div', { class: 'om-set-grid om-set-rows' },
            field('Running',
              choice(!showing(device, 'running') ? 'none' : ['occupancy', 'outlet'].includes(device.runningAs) ? device.runningAs : 'switch',
                [['switch', 'Switch — on while it runs'], ['outlet', 'Outlet — on while it runs'], ['occupancy', 'Occupancy sensor — taken while it draws'], ['none', 'Not in HomeKit — still on the dashboard']],
                (value) => {
                  setSwitch(device, 'running', value !== 'none');
                  setOrDrop(device, 'runningAs', ['occupancy', 'outlet'].includes(value) ? value : undefined);
                  changed();
                }),
              'Changing it replaces it in HomeKit, with its automations.'),
            // 1.7.0 called Overtime leftOnMinutes; changing it moves it over.
            field('Overtime after (min)', number(device.overtimeMinutes ?? device.leftOnMinutes, 'off', (value, input) => {
              delete device.leftOnMinutes;
              setOrDrop(device, 'overtimeMinutes', numberOrUndefined(value));
              showError(input, minutesError(device.overtimeMinutes));
              changed();
            }, 1), 'Running this long in one go.',
            minutesError(device.overtimeMinutes ?? device.leftOnMinutes))),
          // Idle's two fields on a line of their own: they belong together.
          el('div', { class: 'om-set-grid om-set-rows' },
            idleOnField,
            // Only for an appliance with phases: Idle may count from the end of one.
            phaseNames(device).length > 0 && field('Idle counted from',
              choice(phaseNames(device).includes(device.idleOnFrom) ? device.idleOnFrom : '',
                [['', 'Not running'], ...phaseNames(device).map((name) => [name, `End of ${name}`])],
                (value) => {
                  setOrDrop(device, 'idleOnFrom', value || undefined);
                  idleOnField.querySelector('.om-set-help').textContent = idleOnHelp(device);
                  changed();
                }),
              'For an appliance that keeps warm.'))),

        // Polling asks a Matter plug; over MQTT the plug sends by itself.
        el('details', { class: 'om-set-more om-set-section', open: (!viaMqtt && device.pollSeconds) || hasThresholds(device) },
          el('summary', {}, viaMqtt ? 'More: Phases & Thresholds' : 'More: Polling, Phases & Thresholds'),
          viaMqtt ? null : el('div', { class: 'om-set-section' },
            el('h6', {}, 'Polling'),
            el('div', { class: 'om-set-poll' },
              field('Polling interval (s)', number(device.pollSeconds, 'off, only listen', (value, input) => {
                setOrDrop(device, 'pollSeconds', numberOrUndefined(value));
                showError(input, pollError(device.pollSeconds));
                changed();
              }, MIN_POLL_SECONDS), 'For plugs that report seldom.', pollError(device.pollSeconds)))),
          phasesTable(device),
          el('div', { class: 'om-set-section' },
            el('h6', {}, 'Thresholds'),
            thresholdsTable(device))));
    }

    /**
     * The thresholds as two sentences to fill in: "Running when above … W for
     * at least … s", "Finished when below that for … s". Empty ones are learned.
     */
    function thresholdsTable(device) {
      const used = inUse[String(device.name ?? '').trim()];
      // An empty field shows the value used instead, and where it comes from.
      const shown = (key, fallback) => (used?.[key] ? `${used[key].value} ${used[key].from}` : fallback);
      const input = (key, fallback, unit, label) => {
        const element = number(device.thresholds?.[key], shown(key, fallback), (value) => {
          const thresholds = { ...device.thresholds };
          setOrDrop(thresholds, key, numberOrUndefined(value));
          setOrDrop(device, 'thresholds', Object.keys(thresholds).length ? thresholds : undefined);
          changed();
        });
        element.setAttribute('aria-label', label);
        return el('div', { class: 'input-group input-group-sm' }, element, el('span', { class: 'input-group-text' }, unit));
      };
      const words = (text) => el('span', {}, text);
      return el('div', {},
        el('div', { class: 'om-set-rule' },
          el('strong', {}, 'Running'), words('when above'),
          input('runWatts', 'learned', 'W', 'Running when above (W)'),
          words('for at least'),
          input('startSeconds', '60', 's', 'Running for at least (s)')),
        el('div', { class: 'om-set-rule' },
          el('strong', {}, 'Finished'), words('when below that for'),
          input('finishSeconds', 'learned', 's', 'Finished when below that for (s)')),
        el('div', { class: 'om-set-help' },
          `${!used ? 'Nothing learned yet.'
            : used.cycles > 0 ? `Learned from ${used.cycles} cycle${used.cycles === 1 ? '' : 's'}.`
            : used.standbyWatts != null ? `Nothing learned yet; standby found at ${used.standbyWatts} W.`
            : 'Nothing learned yet: defaults until the first cycle.'} `
          + 'Empty fields use the value shown.'),
        // Only with something to forget: a learned cycle, or standby found.
        used && (used.cycles > 0 || used.standbyWatts != null) ? forgetButton(device) : null);
    }

    /** Forgets what the appliance has learned, after a second click. */
    function forgetButton(device) {
      const button = el('button', { type: 'button', class: 'btn btn-outline-danger om-set-small mt-2' }, 'Forget');
      return askTwice(button, async (reset) => {
        button.disabled = true;
        try {
          const result = await homebridge.request('/forget', { name: String(device.name ?? '').trim() });
          homebridge.toast.success(result.message, `${device.name}: forgotten`);
          inUse = (await homebridge.request('/learned').catch(() => null)) ?? inUse;
          render();
        } catch (error) {
          homebridge.toast.error(error?.message ?? String(error), 'Not forgotten');
          button.disabled = false;
          reset();
        }
      });
    }

    /** Whether a switch is shown, reading the earlier sensor setting too. */
    const showing = (device, which) => (device[`${which}Switch`] ?? device[`${which}Sensor`]) !== false;
    /** Sets a switch, and drops the earlier sensor setting it replaces. */
    const setSwitch = (device, which, on) => {
      delete device[`${which}Sensor`];
      setOrDrop(device, `${which}Switch`, on, true);
    };

    const hasThresholds = (device) => device.thresholds && Object.values(device.thresholds).some((v) => v !== null && v !== undefined && v !== '');

    /** The phases, to read: they are edited on the Power tab. */
    function phasesTable(device) {
      const phases = Array.isArray(device.phases) ? device.phases : [];
      const table = el('table', { class: 'om-table' },
        el('thead', {}, el('tr', {},
          ['Name', 'From (W)', 'To (W)', 'On after (s)', 'Off after (s)', 'Shorter than (s)', 'On down', 'Off on drop', 'Switch', 'Count']
            .map((label) => el('th', {}, label)))),
        el('tbody', {}, phases.map((phase) => el('tr', {},
          el('td', {}, phase.name || '(no name)'),
          el('td', {}, phase.minWatts ?? '–'),
          el('td', {}, phase.maxWatts ?? 'none'),
          el('td', {}, phase.minSeconds ?? 5),
          el('td', {}, phase.holdSeconds ?? 30),
          el('td', {}, phase.maxSeconds ?? 'any'),
          el('td', {}, (phase.onDown ?? phase.rampDown ?? phase.fromAbove) === true ? 'yes' : 'no'),
          el('td', {}, (phase.offOnDrop ?? phase.offBelow) === true ? 'yes' : 'no'),
          el('td', {}, phase.sensor !== false ? 'yes' : 'no'),
          el('td', {}, phase.count === true ? 'yes' : 'no')))));
      return el('div', { class: 'om-set-section' },
        el('h6', {}, 'Phases'),
        phases.length ? table : null,
        el('div', { class: 'om-set-help' }, phases.length ? 'Changed on the Power tab.' : 'None yet. They are set up on the Power tab.'),
        Array.isArray(device.messages) && device.messages.length
          ? el('div', { class: 'om-set-help' }, `MQTT messages: ${device.messages.length}, also on the Power tab.`)
          : null);
    }

    const deviceNamed = (name) => config.devices.find((d) => String(d.name ?? '').trim() === name);

    /** Draws the phases where the Power tab has them, after a change or for another appliance. */
    function drawPhases() {
      if (!phaseView) {
        return;
      }
      const device = deviceNamed(phaseView.name);
      phaseView.target.replaceChildren(...(device ? [phasesSection(device), messagesSection(device)] : []));
    }

    /** Draws the MQTT messages again, for a phase renamed, added or removed, without touching the phase being typed in. */
    function drawMessages() {
      const device = phaseView && deviceNamed(phaseView.name);
      phaseView?.target.querySelector('.om-set-messages')?.replaceWith(device ? messagesSection(device) : '');
    }

    /** A phase changed: to Homebridge, and the chart redrawn with it. */
    function phasesChanged() {
      changed();
      phaseView?.onChange();
    }

    function phasesSection(device) {
      const phases = Array.isArray(device.phases) ? device.phases : [];
      const rows = phases.map((phase, index) => {
        const id = `om-set-phase-${index}`;
        const update = (mutate) => { mutate(phase); phasesChanged(); };
        const labelled = (input, label) => {
          input.setAttribute('aria-label', label);
          input.title = label;
          return input;
        };
        return el('div', { class: 'om-set-phase' },
          labelled(text(phase.name, 'Heating', (value) => {
            // Its messages go with it: they name the phase.
            const before = (phase.name ?? '').trim();
            for (const message of Array.isArray(device.messages) ? device.messages : []) {
              if (before && message.phase === before) {
                message.phase = value.trim();
              }
            }
            update((p) => { p.name = value; });
            drawMessages();
          }), 'Name'),
          labelled(number(phase.minWatts, '', (value) => update((p) => setOrDrop(p, 'minWatts', numberOrUndefined(value)))), 'From (W)'),
          labelled(number(phase.maxWatts, 'none', (value) => update((p) => setOrDrop(p, 'maxWatts', numberOrUndefined(value)))), 'To (W)'),
          labelled(number(phase.minSeconds, '5', (value) => update((p) => setOrDrop(p, 'minSeconds', numberOrUndefined(value), 5))), 'On after (s)'),
          labelled(number(phase.holdSeconds, '30', (value) => update((p) => setOrDrop(p, 'holdSeconds', numberOrUndefined(value), 30))), 'Off after (s)'),
          labelled(number(phase.maxSeconds, 'any', (value) => update((p) => setOrDrop(p, 'maxSeconds', numberOrUndefined(value)))), 'Shorter than (s)'),
          el('div', { class: 'om-set-phase-switches' },
            labelled(check(`${id}-down`, 'On down', (phase.onDown ?? phase.rampDown ?? phase.fromAbove) === true, (on) => update((p) => { delete p.fromAbove; delete p.rampDown; setOrDrop(p, 'onDown', on, false); })),
              'Only when the draw falls into the range, not when it rises into it'),
            labelled(check(`${id}-drop`, 'Off on drop', (phase.offOnDrop ?? phase.offBelow) === true, (on) => update((p) => { delete p.offBelow; setOrDrop(p, 'offOnDrop', on, false); })),
              'Runs hidden under something drawing more: above the range still on, off when the draw drops'),
            check(`${id}-sensor`, 'Switch', phase.sensor !== false, (on) => update((p) => setOrDrop(p, 'sensor', on, true))),
            labelled(check(`${id}-count`, 'Count', phase.count === true, (on) => update((p) => setOrDrop(p, 'count', on, false))),
              'Count on the Statistics tab instead of finished cycles')),
          el('button', {
            type: 'button', class: 'btn btn-sm btn-outline-danger om-set-x', title: `Remove ${phase.name || 'this phase'}`, 'aria-label': `Remove ${phase.name || 'this phase'}`,
            onclick: () => {
              phases.splice(index, 1);
              setOrDrop(device, 'phases', phases.length ? phases : undefined);
              phasesChanged();
              drawPhases();
            },
          }, cross()));
      });
      return el('div', { class: 'om-set-section' },
        el('h6', {}, 'Phases'),
        rows.length
          ? el('div', {},
            el('div', { class: 'om-set-phase om-set-head' },
              el('span', {}, 'Name'), el('span', {}, 'From (W)'), el('span', {}, 'To (W)'),
              el('span', {}, 'On after (s)'), el('span', {}, 'Off after (s)'),
              el('span', { title: 'Only draws shorter than this; the phase then goes on briefly once the draw is over.' }, 'Shorter than (s)'), el('span', {}), el('span', {}), el('span', {}), el('span', {}), el('span', {})),
            rows)
          : el('div', { class: 'om-set-help mb-2' }, 'None yet. A green marker on the chart is a good start.'),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary mt-2', onclick: () => addPhase({}) }, '+ Add phase'));
    }

    /**
     * MQTT messages sent when a phase starts or ends, one line each, apart
     * from the phases, whose line has no room left.
     */
    function messagesSection(device) {
      const names = phaseNames(device);
      const messages = Array.isArray(device.messages) ? device.messages : [];
      const rows = messages.map((message, index) => {
        const update = (mutate) => { mutate(message); changed(); };
        const labelled = (input, label) => {
          input.setAttribute('aria-label', label);
          input.title = label;
          return input;
        };
        // A phase since removed stays chosen, so that the line does not quietly change.
        const phases = names.includes(message.phase) || !message.phase ? names : [message.phase, ...names];
        return el('div', { class: 'om-set-message' },
          labelled(choice(message.phase ?? '', phases.map((name) => [name, names.includes(name) ? name : `${name} (gone)`]),
            (value) => update((m) => { m.phase = value; })), 'Phase'),
          labelled(choice(message.when ?? 'start', [['start', 'Starts'], ['end', 'Ends']], (value) => update((m) => { m.when = value; })), 'When'),
          labelled(text(message.topic, 'awtrix/cmd/notify', (value) => update((m) => { m.topic = value; })), 'Topic'),
          labelled(text(message.payload, '{"text":"{phase} {duration}"}', (value) => update((m) => setOrDrop(m, 'payload', value))), 'Payload'),
          el('button', {
            type: 'button', class: 'btn btn-sm btn-outline-danger om-set-x', title: 'Remove this message', 'aria-label': 'Remove this message',
            onclick: () => {
              messages.splice(index, 1);
              setOrDrop(device, 'messages', messages.length ? messages : undefined);
              changed();
              drawMessages();
            },
          }, cross()));
      });
      return el('div', { class: 'om-set-section om-set-messages' },
        el('h6', {}, 'MQTT messages'),
        config.mqtt === true ? null : el('div', { class: 'om-set-error mb-2' }, 'MQTT is off: switch it on under General on the Settings tab, or none are sent.'),
        rows.length
          ? el('div', {},
            el('div', { class: 'om-set-message om-set-head' },
              el('span', {}, 'Phase'), el('span', {}, 'When'), el('span', {}, 'Topic'), el('span', {}, 'Payload'), el('span', {})),
            rows)
          : null,
        el('div', { class: 'om-set-help' },
          'Sent once to any topic when a phase starts or ends — a command to a display, say. In the payload, {appliance}, {phase}, ',
          '{duration} (0:23) and {seconds} (23) are filled in: how long the draw was in the range, so far at the start.'),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-outline-primary mt-2', disabled: !names.length,
          onclick: () => {
            device.messages = [...messages, { phase: names[0], when: 'end', topic: '', payload: '' }];
            changed();
            drawMessages();
            [...phaseView.target.querySelectorAll('.om-set-message:not(.om-set-head)')].at(-1)?.querySelectorAll('input')[0]?.focus();
          },
        }, '+ Add message'));
    }

    /** A new line at the end of the phases, ready for its name. */
    function addPhase(values) {
      const device = phaseView && deviceNamed(phaseView.name);
      if (!device) {
        return;
      }
      device.phases = [...(Array.isArray(device.phases) ? device.phases : []), { name: '', ...values }];
      phasesChanged();
      drawPhases();
      [...phaseView.target.querySelectorAll('.om-set-phase')].at(-1)?.querySelector('input')?.focus();
    }

    function general() {
      showDashboardLinks(); // the config may have been read again
      return el('details', { class: 'om-set-more om-set-section mt-4' },
        el('summary', {}, 'General'),
        el('div', { class: 'om-set-grid' },
          el('div', {},
            check('om-set-record', 'Record power readings', config.recordPower !== false, (on) => { setOrDrop(config, 'recordPower', on, true); changed(); }),
            el('div', { class: 'om-set-help' }, 'Needed by the Power tab.')),
          field('Days of recordings to keep', number(config.recordDays, '14', (value) => {
            setOrDrop(config, 'recordDays', numberOrUndefined(value), 14);
            changed();
          }, 1)),
          field('matter.js log level', choice(config.matterLogLevel ?? 'warn', LOG_LEVELS, (value) => {
            setOrDrop(config, 'matterLogLevel', value, 'warn');
            changed();
          })),
          el('div', {},
            check('om-set-dashboard', 'Dashboard', dashboardOn(config), (on) => {
              // Written either way: with only a port, as 1.2.0 wrote it, it would count as on.
              config.dashboard = on;
              changed();
              showDashboardLinks();
            }),
            el('div', { class: 'om-set-help' }, 'A page with power and statistics, read only and without login.'),
            dashboardLinks),
          field('Dashboard port', number(config.dashboardPort, String(DEFAULT_DASHBOARD_PORT), (value) => {
            setOrDrop(config, 'dashboardPort', numberOrUndefined(value), DEFAULT_DASHBOARD_PORT);
            changed();
            showDashboardLinks();
          }, 1))),
        // MQTT on a line of its own: its three fields belong together.
        el('div', { class: 'om-set-grid mt-3' },
          el('div', {},
            check('om-set-mqtt', 'MQTT', config.mqtt === true, (on) => { setOrDrop(config, 'mqtt', on, false); changed(); }),
            el('div', { class: 'om-set-help' }, "Each appliance's state as topics: <prefix>/<name>/state, watts, phases and more.")),
          field('MQTT broker', text(config.mqttUrl, DEFAULT_MQTT_URL, (value) => {
            setOrDrop(config, 'mqttUrl', value.trim() || undefined, DEFAULT_MQTT_URL);
            changed();
          }), 'A login goes in it: mqtt://user:password@host:1883.'),
          field('MQTT topic prefix', text(config.mqttPrefix, DEFAULT_MQTT_PREFIX, (value) => {
            setOrDrop(config, 'mqttPrefix', value.trim() || undefined, DEFAULT_MQTT_PREFIX);
            changed();
          }))));
    }

    /**
     * Where the dashboard is, while it is switched on: this machine's address,
     * or the name the Homebridge UI was opened with if it has none. As the
     * settings say, which the plugin follows once restarted.
     */
    const dashboardLinks = el('div', { class: 'om-set-help' });
    function showDashboardLinks() {
      const port = Number.isInteger(config.dashboardPort) && config.dashboardPort >= 1 && config.dashboardPort <= 65535
        ? config.dashboardPort
        : DEFAULT_DASHBOARD_PORT;
      const host = address || window.location.hostname;
      const url = host && `http://${host}:${port}/`;
      dashboardLinks.replaceChildren(...(dashboardOn(config) && url ? [el('a', { href: url, target: '_blank', rel: 'noopener' }, url)] : []));
    }

    render();
    return {
      /** Picks up what the plugin learned meanwhile, and the config as Homebridge has it. */
      async reload() {
        // A change not yet handed over, made on the Power tab a moment ago,
        // would be lost in reading the config back.
        if (pending !== undefined) {
          clearTimeout(pending);
          pending = undefined;
          await homebridge.updatePluginConfig(configs);
        }
        inUse = (await homebridge.request('/learned').catch(() => null)) ?? inUse;
        const name = config.devices[selected]?.name;
        configs = await loadConfigs(homebridge);
        Object.assign(config, configs[0]);
        configs[0] = config;
        config.devices = Array.isArray(config.devices) ? config.devices : [];
        const found = config.devices.findIndex((d) => d.name === name);
        selected = found >= 0 ? found : config.devices.length ? sortedIndices()[0] : -1;
        render();
      },
      select(name) {
        const found = config.devices.findIndex((d) => String(d.name ?? '').trim() === name);
        if (found >= 0 && found !== selected) {
          selected = found;
          render();
        }
      },
      /** The appliance shown, for the Power tab to open on the same one. */
      selectedName() {
        return config.devices[selected]?.name;
      },
      /**
       * Shows the phases of the appliance `name` in `target`, for the Power
       * tab; `onChange` is called after each change to them.
       */
      showPhases(target, name, onChange) {
        phaseView = { target, name, onChange };
        drawPhases();
      },
      /** A new phase line with these values, such as a level's range clicked on the chart. */
      addPhase,
      /** The phases as being edited, saved or not, for the chart to show. */
      phasesOf(name) {
        const phases = deviceNamed(name)?.phases;
        return Array.isArray(phases) ? phases : [];
      },
    };
  }

  root.ApplianceSettings = { mount, css };
})(typeof window !== 'undefined' ? window : globalThis);
