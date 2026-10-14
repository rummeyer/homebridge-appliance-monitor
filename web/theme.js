/**
 * The Home look — as Apple's Home app, on a wallpaper — or light, or dark:
 * the switch in the dashboard's header. Home unless the viewer chose otherwise.
 *
 * Loaded in the head, not deferred, so the theme is set before the first
 * paint and the page does not flash another look. `data-theme` is what is
 * shown, `data-theme-pref` which icon the switch shows; both the same, but
 * without script neither is set, and the page follows the system's light
 * or dark.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const KEY = 'appliance-monitor.theme';
  const NAMES = { home: 'Home', light: 'Light', dark: 'Dark' };
  const ORDER = ['home', 'light', 'dark'];

  let stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // No storage, as in a private window: Home.
  }

  /** The tab's name and icon go with the look: Home and a house for the Home look. */
  const TAB = {
    home: { title: 'Home', icon: 'home.svg', type: 'image/svg+xml' },
    other: { title: 'Appliance Monitor', icon: 'icon.png', type: 'image/png' },
  };

  function set(theme) {
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-pref', theme);
    const tab = TAB[theme === 'home' ? 'home' : 'other'];
    document.title = tab.title;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && icon.getAttribute('href') !== tab.icon) {
      icon.type = tab.type;
      icon.setAttribute('href', tab.icon);
    }
  }

  set(ORDER.includes(stored) ? stored : 'home');

  function label(button) {
    const theme = root.getAttribute('data-theme');
    button.title = NAMES[theme];
    button.setAttribute('aria-label', `Switch between Home, light and dark mode (now ${NAMES[theme]})`);
  }

  /** Home is kept as no choice at all, so a later default would reach it. */
  function apply(theme, button) {
    set(theme);
    try {
      if (theme === 'home') {
        localStorage.removeItem(KEY);
      } else {
        localStorage.setItem(KEY, theme);
      }
    } catch {
      // Kept for this visit only.
    }
    label(button);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('[data-theme-switch]');
    if (!button) {
      return;
    }
    label(button);
    button.addEventListener('click', () => {
      const now = ORDER.indexOf(root.getAttribute('data-theme'));
      apply(ORDER[(now + 1) % ORDER.length], button);
    });
  });
})();
