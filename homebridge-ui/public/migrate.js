/**
 * Settings saved under the names earlier versions gave them, brought up to
 * today's: the settings page does it as it opens, so that the next Save
 * writes them so. The plugin reads both, as currentDevice in config.ts does,
 * which this matches. Sets `window.ApplianceMigrate`.
 */
(function (root) {
  'use strict';

  /** Today's name, and what it was called before. */
  const DEVICE_KEYS = [
    ['overtimeMinutes', ['leftOnMinutes']], // Left On, 1.7.0
    ['idleMinutes', ['idleOnMinutes']], // Idle On, until 1.12
    ['idleFrom', ['idleOnFrom']],
    ['runningSwitch', ['runningSensor']], // when Running was a sensor
  ];
  const PHASE_KEYS = [
    ['onAfterSeconds', ['minSeconds']],
    ['offAfterSeconds', ['holdSeconds']],
    ['shorterThanSeconds', ['maxSeconds']],
  ];
  /** No longer used: the Finished switch (Running going off says the same), and when it ended. */
  const GONE_DEVICE_KEYS = ['finishedSwitch', 'finishedSensor', 'finishedReset', 'finishedResetMinutes'];
  /** Counts as switches, each with what it was called before: by difference over coming down. */
  const COUNTS_SWITCHES = [
    ['byDifference', ['byDifference', 'offOnDrop', 'offBelow']], // offOnDrop in 1.20, offBelow in 1.18 and 1.19
    ['comingDown', ['onDown', 'rampDown', 'fromAbove']], // rampDown in 1.1.1, fromAbove in 1.1.0
  ];

  /** Renames in place; whether anything changed. Today's name wins over an earlier one. */
  function rename(object, keys) {
    let changed = false;
    for (const [now, before] of keys) {
      for (const old of before) {
        if (old in object) {
          if (object[now] === undefined) {
            object[now] = object[old];
          }
          delete object[old];
          changed = true;
        }
      }
    }
    return changed;
  }

  function currentPhase(phase) {
    let changed = rename(phase, PHASE_KEYS);
    const switches = COUNTS_SWITCHES.flatMap(([, keys]) => keys).filter((key) => key in phase);
    if (switches.length > 0) {
      if (phase.counts === undefined) {
        const on = COUNTS_SWITCHES.find(([, keys]) => keys.some((key) => phase[key] === true));
        if (on) {
          phase.counts = on[0];
        }
      }
      for (const key of switches) {
        delete phase[key];
      }
      changed = true;
    }
    return changed;
  }

  /** A device's settings under today's names, changed in place; whether anything changed. */
  function currentDevice(device) {
    let changed = rename(device, DEVICE_KEYS);
    for (const key of GONE_DEVICE_KEYS) {
      if (key in device) {
        delete device[key];
        changed = true;
      }
    }
    // The off level of the thresholds, gone with the Finished switch.
    if (device.thresholds && typeof device.thresholds === 'object' && 'offWatts' in device.thresholds) {
      delete device.thresholds.offWatts;
      if (!Object.keys(device.thresholds).length) {
        delete device.thresholds;
      }
      changed = true;
    }
    for (const phase of Array.isArray(device.phases) ? device.phases : []) {
      if (phase && typeof phase === 'object' && currentPhase(phase)) {
        changed = true;
      }
    }
    return changed;
  }

  root.ApplianceMigrate = { currentDevice };
})(typeof window !== 'undefined' ? window : globalThis);
