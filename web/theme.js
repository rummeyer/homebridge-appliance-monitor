/**
 * Light, dark, or as the system says: the switch in the dashboard's header.
 *
 * Loaded in the head, not deferred, so the theme is set before the first
 * paint and a dark page does not flash light. `data-theme` is what the
 * viewer chose, absent while following the system, so the media query keeps
 * its say; `data-theme-pref` is which of the three the switch shows.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const KEY = 'appliance-monitor.theme';
  const NAMES = { auto: 'System', light: 'Light', dark: 'Dark' };

  let stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // No storage, as in a private window: the system decides.
  }
  const initial = stored === 'light' || stored === 'dark' ? stored : 'auto';
  root.setAttribute('data-theme-pref', initial);
  if (initial !== 'auto') {
    root.setAttribute('data-theme', initial);
  }

  /**
   * Round the three, but first away from what is on screen: from following a
   * light system, a click goes to dark, not to light, which would look the same.
   * The system is asked each time, as it can change with the page open.
   */
  function next(pref) {
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const away = systemDark ? 'light' : 'dark';
    if (pref === 'auto') {
      return away;
    }
    if (pref === away) {
      return systemDark ? 'dark' : 'light';
    }
    return 'auto';
  }

  function label(button) {
    const pref = root.getAttribute('data-theme-pref') || 'auto';
    button.title = NAMES[pref];
    button.setAttribute('aria-label', `Switch between light, dark and system mode (now ${NAMES[pref]})`);
  }

  /** Following the system is kept as no choice at all, not as a snapshot of it. */
  function apply(pref, button) {
    root.setAttribute('data-theme-pref', pref);
    try {
      if (pref === 'auto') {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, pref);
      }
    } catch {
      // Kept for this visit only.
    }
    if (pref === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', pref);
    }
    label(button);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('[data-theme-switch]');
    if (!button) {
      return;
    }
    label(button);
    button.addEventListener('click', () => apply(next(root.getAttribute('data-theme-pref') || 'auto'), button));
  });
})();
