# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.2] — 2026-10-01

### Changed

- Deleting an appliance on the settings page asks on the button itself: the
  first click turns it into **SURE?**, the second deletes. Left alone, it is
  Delete again after five seconds.

## [0.10.1] — 2026-10-01

### Changed

- The accessory is called after the appliance followed by "Monitor" —
  "Kaffeemaschine Monitor" — to tell it apart from the plug's own accessory.

## [0.10.0] — 2026-10-01

### Added

- **Shorter than** per phase (`maxSeconds`): only draws shorter than this
  are the phase, to tell apart what draws the same power for different
  times — a coffee machine's rinse from a coffee. Such a phase goes on for a
  moment once the draw is over, when its length is known. The
  Curve tab shows it where the draw was.

### Removed

- The **Finished** switch. Running goes off only when the appliance finishes,
  so "when Running turns off" says the same, without a second switch. The
  Finished switch leaves the Home app on the first start of this version;
  automations hung on it have to be set up again on "Running turns off".
  Finished cycles are still counted on the Statistics tab.

### Fixed

- No more "could not ask for power" lines in the debug log when Homebridge
  shuts down.

## [0.9.0] — 2026-10-01

### Changed

- Each appliance is one accessory with switches instead of sensors, to hang
  automations on: Running on while it runs, a switch per phase on while the
  phase lasts, and Finished on for a moment when it finishes, then off by
  itself. A switch tapped in the Home app is put back straight away, since the
  plugin only measures. The sensors of earlier versions are removed; their
  settings (`runningSensor`, `finishedSensor`) still count, as
  `runningSwitch` and `finishedSwitch`.
- Finished going back to Off is no longer a setting, since Finished is now a
  moment in HomeKit.

## [0.8.0] — 2026-10-01

### Changed

- The Settings tab is the plugin's own form: pick an appliance from a list —
  sorted, paired ones ticked — and see only its settings, with its phases one
  row each. "+ Add" starts a new one with a name to change, "Delete" asks
  first. Only what differs from the default is written to the config.
- The Curve tab opens on the last six hours.
- The README shows the Settings, Curve and Statistics tabs, in light and dark.

## [0.7.0] — 2026-10-01

### Added

- The Statistics tab counts how often each appliance finished, or how often
  a phase ticked "Count in statistics" happened — coffees drawn rather than
  mornings the machine was on. All of them are counted all along, so ticking
  another phase loses nothing.
- An icon, and the usual badges at the top of the README.

## [0.6.1] — 2026-10-01

### Changed

- The Curve tab lists the plugs in alphabetical order.

## [0.6.0] — 2026-10-01

The first published version.

### Added

**Plugs**

- Pairs Matter plugs and power meters as a second controller, next to Apple
  Home, with the setup code from the Home app — over Thread or Wi-Fi, with no
  Bluetooth and no extra service to run. Tried with the Eve Energy (Thread) and
  the Shelly Plug PM Gen3 (Wi-Fi).
- Reads power from the standard Electrical Power Measurement cluster, which
  is where the Home app reads it; nothing vendor-specific.
- Asks a plug for its power every few seconds (`pollSeconds`), for plugs that
  report too seldom to see something short — the Eve Energy reports once a
  minute, a coffee runs through in half of one. A plug that draws nothing is
  not asked.

**Off, Running, Finished**

- Each appliance is Off, Running or Finished, shown in HomeKit as an
  occupancy sensor (Running) and a contact sensor that opens (Finished). Both
  can be turned off, and are renamed in the Home app.
- No thresholds to set: the plugin learns each appliance's resting level,
  running level, longest pause and off level from its first cycle, and
  refines them with every cycle after. A cycle that ended too early is caught
  when the machine runs again, and its pause learned.
- Finished goes back to Off when the appliance is switched off, after a set
  time, or when it runs again.
- Any threshold can be fixed in the settings instead of learned.
- The state survives a restart.

**Phases**

- Ranges of power an appliance works in — heating, spinning, a coffee or milk
  being frothed — each with an optional occupancy sensor. A phase may be open
  at the top ("1000 W and up"), and ends only once the draw has been out of
  range for a while, so a heater switched by a thermostat is one phase.

**Settings page**

- Curve tab: a plug's recorded power over the last hour to two weeks, the
  levels it dwells at, its phases each in a colour, and a bar per phase
  showing when it was on. Click a level, or drag across what the appliance
  did, to add it as a phase. Pointing at the chart shows the time and the
  reading.
- Statistics tab: the energy each plug used today, last week, last month and
  last year, with the total. Today counts from the first reading of the day;
  a week or a month is shown once it has been counted for all of it; a year
  once it is over, marked if the plug joined partway through.

**And**

- A plug with every sensor turned off is not in HomeKit, and is still
  counted in the statistics.
- Readings are recorded to a file per day under `appliance-monitor/power/`,
  kept for 14 days by default (`recordDays`).
- A short log: one line per plug on start, what a plug offers once when it is
  paired, then only what changes.

[Unreleased]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.2...HEAD
[0.10.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/rummeyer/homebridge-appliance-monitor/releases/tag/v0.6.0
