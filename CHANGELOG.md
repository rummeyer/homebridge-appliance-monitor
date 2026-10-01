# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Ask a plug for its power every few seconds (`pollSeconds`), for plugs that
  report too seldom to see something short, such as the Eve Energy's once a
  minute against a coffee's half a minute. A plug that draws nothing is not
  asked; the plug reports being switched on by itself.

### Fixed

- Learning took where an appliance rests from a single reading a minute
  after the end. On a coffee machine that was its fan running on after
  frothing milk, so keeping warm at 1.9 W was later taken for switched off.
  It now takes the middle of the ten minutes after the end, and sets "off"
  below the lowest the machine drew while on.
- A coffee machine's cycle was not learned from at all: the check that a
  cycle had real work in it looked at the median, and a coffee machine
  spends most of a cycle keeping warm. It now looks at the peak.

## [0.4.1] — 2026-09-30

The first published version.

### Added

- Pairs Matter plugs as a second controller, using the setup code from the
  Home app.
- On connecting, logs each plug's endpoints, device types and clusters, with
  the values of the power-measurement attributes.
- Logs every power reading from the standard ActivePower attribute, and
  records it with its endpoint to `power.csv`.
- Warns at startup when the plugin isn't running as a child bridge.
- Each appliance is Off, Running or Finished, shown in HomeKit as an
  occupancy sensor (Running) and a contact sensor that opens (Finished). Both
  can be turned off, and renamed in the Home app.
- Learns each appliance's running level, longest pause and off level from its
  first cycle, and refines them with every cycle after. A cycle that ended too
  early is caught when the machine runs again, and its pause learned.
- Finished goes back to Off when the appliance is switched off, after a set
  time, or when it runs again, as configured.
- Any threshold can be fixed in the settings instead of learned.
- The state survives a restart.
- A Statistics tab on the settings page shows the energy each plug used
  today, last week, last month and last year, with the total. Today counts
  from the first reading of the day; a week or a month is shown only if it has
  been counted for all of it; a year once it is over, marked if the plug
  joined partway through.
- Phases: ranges of power an appliance works in, such as heating, spinning or
  a coffee running through, each with an optional occupancy sensor. A phase
  ends only once the draw has been out of range for a while, so a heating
  element switched by a thermostat is one phase, not many.
- A Curve tab on the settings page shows a plug's recorded power with the
  levels it dwells at. Click a level, or drag across the chart over something
  the appliance did, to add it as a phase.
- A plug with every sensor turned off does not appear in HomeKit, and is
  still counted in the statistics.
- A phase can leave out its upper end: heating is 1000 W and up.
- A plug starts with no phases on the settings page. An empty phase, as the
  page may save, is skipped; a phase that is wrong is skipped with a warning,
  and costs only itself, not the plug.

- Readings are recorded to a file per day under `power/`, kept for 14 days
  by default (`recordDays`).
- A short log: one line per plug on start, the full list of what a plug
  offers only once when it is paired, then only what changes. matter.js's
  expected start-up warnings only show with debug logging.

[Unreleased]: https://github.com/rummeyer/homebridge-outlet-monitor/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/rummeyer/homebridge-outlet-monitor/releases/tag/v0.4.1
