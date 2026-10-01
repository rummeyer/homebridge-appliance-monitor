/**
 * The Settings tab: one appliance at a time, picked from a list.
 *
 * Homebridge's own form shows every plug's settings one under the other,
 * which with a dozen plugs is a long page to find one in. This shows a list
 * to pick from, and below it the one picked.
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
  .om-set-bar select { width: auto; min-width: 14rem; }
  .om-set-section { margin-bottom: 1.25rem; }
  .om-set-section > h6 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; margin-bottom: .5rem; }
  .om-set-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem 1rem; }
  .om-set-help { font-size: .78rem; opacity: .65; margin-top: .2rem; }
  .om-set-error { font-size: .78rem; color: #d64545; margin-top: .2rem; }
  .om-set-phase { display: grid; grid-template-columns: 2fr repeat(5, 1fr) 5.5rem 4.5rem 2rem; gap: .5rem; align-items: center;
                  padding: .3rem 0; }
  .om-set-phase.om-set-head { font-size: .78rem; opacity: .7; padding-bottom: 0; }
  .om-set-phase .form-check { margin: 0; white-space: nowrap; }
  @media (max-width: 760px) {
    .om-set-phase { grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(128,128,128,.2); padding: .5rem 0; }
    .om-set-phase.om-set-head { display: none; }
  }
  details.om-set-more > summary { cursor: pointer; font-size: .85rem; opacity: .8; margin-bottom: .75rem; }
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

  const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

  /**
   * Mounts the form in `container`. `homebridge` is the host's object; `paired`
   * the names of the plugs that are paired, for a mark in the list.
   */
  async function mount(container, { homebridge, paired = [] }) {
    let configs = await homebridge.getPluginConfig();
    if (!configs.length) {
      configs = [{ platform: PLATFORM, name: 'Appliance Monitor', devices: [] }];
    }
    const config = configs[0];
    config.devices = Array.isArray(config.devices) ? config.devices.filter((d) => d && typeof d === 'object') : [];
    const pairedNames = new Set(paired);

    let selected = config.devices.length ? sortedIndices()[0] : -1;
    let pending;

    /** Hands the config to Homebridge, a moment after the last change. */
    function changed() {
      // Earlier versions had a Finished switch; Running going off says the same.
      for (const device of config.devices) {
        delete device.finishedSwitch;
        delete device.finishedSensor;
      }
      clearTimeout(pending);
      pending = setTimeout(() => void homebridge.updatePluginConfig(configs), 250);
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

    function text(value, placeholder, onInput) {
      return el('input', { class: 'form-control form-control-sm', value: value ?? '', placeholder, oninput: (e) => onInput(e.target.value, e.target) });
    }

    function number(value, placeholder, onInput, min = 0) {
      return el('input', {
        class: 'form-control form-control-sm', type: 'number', min, step: 'any', inputmode: 'decimal',
        value: value ?? '', placeholder, oninput: (e) => onInput(e.target.value),
      });
    }

    function check(id, label, checked, onChange) {
      return el('div', { class: 'form-check' },
        el('input', { class: 'form-check-input', type: 'checkbox', id, checked, onchange: (e) => onChange(e.target.checked) }),
        el('label', { class: 'form-check-label', for: id }, label));
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
        return el('option', { value: index, selected: index === selected }, `${name}${pairedNames.has(name) ? '  ✓' : ''}`);
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
      // Asked twice on the button itself rather than with confirm(), which
      // the settings window's frame may not be allowed to show.
      let armed = null;
      const remove = el('button', {
        type: 'button', class: 'btn btn-outline-danger', disabled: selected < 0,
        title: selected < 0 ? '' : `Delete ${config.devices[selected]?.name}`,
        onclick: (event) => {
          const button = event.currentTarget;
          if (!armed) {
            button.textContent = 'SURE?';
            button.classList.replace('btn-outline-danger', 'btn-danger');
            armed = setTimeout(() => {
              armed = null;
              button.textContent = 'Delete';
              button.classList.replace('btn-danger', 'btn-outline-danger');
            }, 5000);
            return;
          }
          clearTimeout(armed);
          armed = null;
          config.devices.splice(selected, 1);
          selected = config.devices.length ? sortedIndices()[0] : -1;
          changed();
          render();
        },
      }, 'Delete');
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
        device.name = value;
        input.parentElement.querySelector('.om-set-error').textContent = nameError(value);
        input.parentElement.querySelector('.om-set-error').hidden = !nameError(value);
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
        const error = codeError(value);
        input.parentElement.querySelector('.om-set-error').textContent = error;
        input.parentElement.querySelector('.om-set-error').hidden = !error;
        changed();
      });

      const isPaired = pairedNames.has(device.name);

      return el('div', {},
        el('div', { class: 'om-set-section' },
          el('h6', {}, 'Appliance ', isPaired ? el('span', { class: 'om-set-badge' }, 'paired') : null),
          el('div', { class: 'om-set-grid' },
            field('Name', nameInput, 'Also the start of its switches\' names in HomeKit. Renaming it means pairing it again.', nameError(device.name ?? '')),
            field('Pairing code', codeInput,
              isPaired ? 'Paired; the code is no longer needed.' : 'In the Home app: the plug\'s settings → Turn On Pairing Mode. Valid for 15 minutes.',
              codeError(device.pairingCode ?? '')))),

        el('div', { class: 'om-set-section' },
          el('h6', {}, 'In HomeKit'),
          el('div', {},
            check('om-set-running', 'Running switch — on while it runs', showing(device, 'running'), (on) => { setSwitch(device, 'running', on); changed(); }),
            el('div', { class: 'om-set-help' },
              'One accessory per appliance, with a switch for Running and one for every phase, to hang automations on. "When Running turns off" is when the appliance is done. Without any switch, the plug is only counted in the statistics.'))),

        phasesSection(device),

        el('details', { class: 'om-set-more om-set-section', open: device.pollSeconds || hasThresholds(device) },
          el('summary', {}, 'More: asking for power, fixed thresholds'),
          el('div', { class: 'om-set-grid' },
            field('Ask for power every (s)', number(device.pollSeconds, 'only listen', (value) => {
              setOrDrop(device, 'pollSeconds', numberOrUndefined(value));
              changed();
            }, 2), 'For plugs that report seldom, like the Eve Energy (once a minute). Not needed for Shelly.'),
            ...[
              ['runWatts', 'Running above (W)', 'learned'],
              ['offWatts', 'Off at or below (W)', 'learned'],
              ['startSeconds', 'Running after (s above)', '60'],
              ['finishSeconds', 'Finished after (s quiet)', 'learned'],
            ].map(([key, label, placeholder]) => field(label, number(device.thresholds?.[key], placeholder, (value) => {
              const thresholds = { ...device.thresholds };
              setOrDrop(thresholds, key, numberOrUndefined(value));
              setOrDrop(device, 'thresholds', Object.keys(thresholds).length ? thresholds : undefined);
              changed();
            }))))));
    }

    /** Whether a switch is shown, reading the earlier sensor setting too. */
    const showing = (device, which) => (device[`${which}Switch`] ?? device[`${which}Sensor`]) !== false;
    /** Sets a switch, and drops the earlier sensor setting it replaces. */
    const setSwitch = (device, which, on) => {
      delete device[`${which}Sensor`];
      setOrDrop(device, `${which}Switch`, on, true);
    };

    const hasThresholds = (device) => device.thresholds && Object.values(device.thresholds).some((v) => v !== null && v !== undefined && v !== '');

    function phasesSection(device) {
      const phases = Array.isArray(device.phases) ? device.phases : [];
      const rows = phases.map((phase, index) => {
        const id = `om-set-phase-${index}`;
        const update = (mutate) => { mutate(phase); changed(); };
        const labelled = (input, label) => {
          input.setAttribute('aria-label', label);
          input.title = label;
          return input;
        };
        return el('div', { class: 'om-set-phase' },
          labelled(text(phase.name, 'Heating', (value) => update((p) => { p.name = value; })), 'Name'),
          labelled(number(phase.minWatts, '', (value) => update((p) => setOrDrop(p, 'minWatts', numberOrUndefined(value)))), 'From (W)'),
          labelled(number(phase.maxWatts, 'no limit', (value) => update((p) => setOrDrop(p, 'maxWatts', numberOrUndefined(value)))), 'Below (W)'),
          labelled(number(phase.minSeconds, '5', (value) => update((p) => setOrDrop(p, 'minSeconds', numberOrUndefined(value), 5))), 'On after (s)'),
          labelled(number(phase.holdSeconds, '30', (value) => update((p) => setOrDrop(p, 'holdSeconds', numberOrUndefined(value), 30))), 'Off after (s)'),
          labelled(number(phase.maxSeconds, 'any', (value) => update((p) => setOrDrop(p, 'maxSeconds', numberOrUndefined(value)))), 'Shorter than (s)'),
          check(`${id}-sensor`, 'Switch', phase.sensor !== false, (on) => update((p) => setOrDrop(p, 'sensor', on, true))),
          check(`${id}-count`, 'Count', phase.count === true, (on) => update((p) => setOrDrop(p, 'count', on, false))),
          el('button', {
            type: 'button', class: 'btn btn-sm btn-outline-danger', title: `Remove ${phase.name || 'this phase'}`,
            onclick: () => {
              phases.splice(index, 1);
              setOrDrop(device, 'phases', phases.length ? phases : undefined);
              changed();
              render();
            },
          }, '×'));
      });
      return el('div', { class: 'om-set-section' },
        el('h6', {}, 'Phases'),
        rows.length
          ? el('div', {},
            el('div', { class: 'om-set-phase om-set-head' },
              el('span', {}, 'Name'), el('span', {}, 'From (W)'), el('span', {}, 'Below (W)'),
              el('span', {}, 'On after (s)'), el('span', {}, 'Off after (s)'),
              el('span', { title: 'Only draws shorter than this are the phase; it then goes on for a moment once the draw is over. A rinse beside a coffee in the same range.' }, 'Shorter than (s)'), el('span', {}), el('span', {}), el('span', {})),
            rows)
          : el('div', { class: 'om-set-help mb-2' }, 'None. A phase is a range of power the appliance works in — heating, spinning, a coffee. The Curve tab finds them on the recorded curve.'),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-outline-primary mt-2',
          onclick: () => {
            device.phases = [...phases, { name: '' }];
            changed();
            render();
            [...container.querySelectorAll('.om-set-phase')].at(-1)?.querySelector('input')?.focus();
          },
        }, '+ Add phase'),
        el('div', { class: 'om-set-help' }, '"Count" shows how often the phase happened on the Statistics tab, instead of the finished cycles.'));
    }

    function general() {
      return el('details', { class: 'om-set-more om-set-section mt-4' },
        el('summary', {}, 'General'),
        el('div', { class: 'om-set-grid' },
          el('div', {},
            check('om-set-record', 'Record power readings', config.recordPower !== false, (on) => { setOrDrop(config, 'recordPower', on, true); changed(); }),
            el('div', { class: 'om-set-help' }, 'One file per day; the Curve tab needs it.')),
          field('Days of recordings to keep', number(config.recordDays, '14', (value) => {
            setOrDrop(config, 'recordDays', numberOrUndefined(value), 14);
            changed();
          }, 1)),
          field('matter.js log level', choice(config.matterLogLevel ?? 'warn', LOG_LEVELS, (value) => {
            setOrDrop(config, 'matterLogLevel', value, 'warn');
            changed();
          }))));
    }

    render();
    return {
      /** Picks up changes made elsewhere on the page, such as a phase added on the Curve tab. */
      async reload() {
        const name = config.devices[selected]?.name;
        configs = await homebridge.getPluginConfig();
        if (!configs.length) {
          configs = [{ platform: PLATFORM, name: 'Appliance Monitor', devices: [] }];
        }
        Object.assign(config, configs[0]);
        configs[0] = config;
        config.devices = Array.isArray(config.devices) ? config.devices : [];
        const found = config.devices.findIndex((d) => d.name === name);
        selected = found >= 0 ? found : config.devices.length ? sortedIndices()[0] : -1;
        render();
      },
      select(name) {
        const found = config.devices.findIndex((d) => d.name === name);
        if (found >= 0) {
          selected = found;
          render();
        }
      },
    };
  }

  root.ApplianceSettings = { mount, css };
})(typeof window !== 'undefined' ? window : globalThis);
