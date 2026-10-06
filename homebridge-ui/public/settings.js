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
  .om-set-help { font-size: .78rem; opacity: .65; margin-top: .2rem; }
  .om-set-error { font-size: .78rem; color: #d64545; margin-top: .2rem; }
  /* Fixed widths for the checkboxes, as each row is a grid of its own and the
     heading row has none; narrow padding, so that "Milchschaum" fits in the
     768 pixels the Homebridge UI gives the page. */
  .om-set-phase { display: grid; grid-template-columns: minmax(6rem, 1.5fr) repeat(5, minmax(0, 1fr)) 4.25rem 4rem 2rem;
                  gap: .5rem; align-items: center; padding: .3rem 0; }
  .om-set-phase .form-control { padding-left: .5rem; padding-right: .5rem; }
  .om-set-phase.om-set-head { font-size: .78rem; opacity: .7; padding-bottom: 0; align-items: end; }
  .om-set-phase .form-check { margin: 0; white-space: nowrap; }
  /* As high as the fields beside it, square, the cross in the middle of it. A
     drawn cross rather than "×", which each font puts somewhere else; and
     !important, as the host's own button styles would win otherwise. */
  .om-set-x { width: 2rem !important; height: calc(1.8125rem + 2px) !important; padding: 0 !important;
              display: inline-flex !important; align-items: center !important; justify-content: center !important; }
  .om-set-x svg { display: block; width: .7rem; height: .7rem; }
  @media (max-width: 760px) {
    .om-set-phase { grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(128,128,128,.2); padding: .5rem 0; }
    .om-set-phase.om-set-head { display: none; }
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
    /** What each appliance uses where its thresholds are empty; see the server's /learned. */
    let inUse = (await homebridge.request('/learned').catch(() => null)) ?? {};

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

      const isPaired = pairedNames.has(device.name);

      return el('div', {},
        el('div', { class: 'om-set-section' },
          el('h6', {}, 'Appliance ', isPaired ? el('span', { class: 'om-set-badge' }, 'paired') : null),
          el('div', { class: 'om-set-grid' },
            field('Name', nameInput, 'Renaming means pairing again.', nameError(device.name ?? '')),
            field('Pairing code', codeInput,
              isPaired ? 'Paired; no longer needed.' : 'Home app: plug settings → Turn On Pairing Mode.',
              codeError(device.pairingCode ?? '')))),

        el('div', { class: 'om-set-section' },
          el('h6', {}, 'In HomeKit'),
          el('div', { class: 'om-set-grid' },
            field('Running',
              choice(!showing(device, 'running') ? 'none' : device.runningAs === 'occupancy' ? 'occupancy' : 'switch',
                [['switch', 'Switch — on while it runs'], ['occupancy', 'Occupancy sensor — taken while it draws'], ['none', 'Not shown']],
                (value) => {
                  setSwitch(device, 'running', value !== 'none');
                  setOrDrop(device, 'runningAs', value === 'occupancy' ? 'occupancy' : undefined);
                  changed();
                }),
              'Changing it replaces it in HomeKit, with its automations.'))),

        el('details', { class: 'om-set-more om-set-section', open: device.pollSeconds || hasThresholds(device) },
          el('summary', {}, 'More: Polling, Phases & Thresholds'),
          el('div', { class: 'om-set-section' },
            el('h6', {}, 'Polling'),
            el('div', { class: 'om-set-poll' },
              field('Polling interval (s)', number(device.pollSeconds, 'off, only listen', (value, input) => {
                setOrDrop(device, 'pollSeconds', numberOrUndefined(value));
                showError(input, pollError(device.pollSeconds));
                changed();
              }, MIN_POLL_SECONDS), 'For plugs that report seldom, like the Eve Energy.', pollError(device.pollSeconds)))),
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
          ['Name', 'From (W)', 'Below (W)', 'On after (s)', 'Off after (s)', 'Shorter than (s)', 'Switch', 'Count']
            .map((label) => el('th', {}, label)))),
        el('tbody', {}, phases.map((phase) => el('tr', {},
          el('td', {}, phase.name || '(no name)'),
          el('td', {}, phase.minWatts ?? '–'),
          el('td', {}, phase.maxWatts ?? 'none'),
          el('td', {}, phase.minSeconds ?? 5),
          el('td', {}, phase.holdSeconds ?? 30),
          el('td', {}, phase.maxSeconds ?? 'any'),
          el('td', {}, phase.sensor !== false ? 'yes' : 'no'),
          el('td', {}, phase.count === true ? 'yes' : 'no')))));
      return el('div', { class: 'om-set-section' },
        el('h6', {}, 'Phases'),
        phases.length ? table : null,
        el('div', { class: 'om-set-help' }, phases.length ? 'Changed on the Power tab.' : 'None yet. They are set up on the Power tab.'));
    }

    const deviceNamed = (name) => config.devices.find((d) => String(d.name ?? '').trim() === name);

    /** Draws the phases where the Power tab has them, after a change or for another appliance. */
    function drawPhases() {
      if (!phaseView) {
        return;
      }
      const device = deviceNamed(phaseView.name);
      phaseView.target.replaceChildren(device ? phasesSection(device) : '');
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
          labelled(text(phase.name, 'Heating', (value) => update((p) => { p.name = value; })), 'Name'),
          labelled(number(phase.minWatts, '', (value) => update((p) => setOrDrop(p, 'minWatts', numberOrUndefined(value)))), 'From (W)'),
          labelled(number(phase.maxWatts, 'none', (value) => update((p) => setOrDrop(p, 'maxWatts', numberOrUndefined(value)))), 'Below (W)'),
          labelled(number(phase.minSeconds, '5', (value) => update((p) => setOrDrop(p, 'minSeconds', numberOrUndefined(value), 5))), 'On after (s)'),
          labelled(number(phase.holdSeconds, '30', (value) => update((p) => setOrDrop(p, 'holdSeconds', numberOrUndefined(value), 30))), 'Off after (s)'),
          labelled(number(phase.maxSeconds, 'any', (value) => update((p) => setOrDrop(p, 'maxSeconds', numberOrUndefined(value)))), 'Shorter than (s)'),
          check(`${id}-sensor`, 'Switch', phase.sensor !== false, (on) => update((p) => setOrDrop(p, 'sensor', on, true))),
          labelled(check(`${id}-count`, 'Count', phase.count === true, (on) => update((p) => setOrDrop(p, 'count', on, false))),
            'Count on the Statistics tab instead of finished cycles'),
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
              el('span', {}, 'Name'), el('span', {}, 'From (W)'), el('span', {}, 'Below (W)'),
              el('span', {}, 'On after (s)'), el('span', {}, 'Off after (s)'),
              el('span', { title: 'Only draws shorter than this; the phase then goes on briefly once the draw is over.' }, 'Shorter than (s)'), el('span', {}), el('span', {}), el('span', {})),
            rows)
          : el('div', { class: 'om-set-help mb-2' }, 'None yet. A green marker on the chart is a good start.'),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary mt-2', onclick: () => addPhase({}) }, '+ Add phase'));
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
          }))));
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
