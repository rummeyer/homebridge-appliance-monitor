# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.2] — 2026-10-03

### Changed

- The section on the Settings tab reads **More: Polling, Phases & Thresholds**.

### Fixed

- The button that removes a phase shows a drawn cross, now in its middle in
  the Homebridge UI too; the "×" before sat where the font put it.

## [0.18.1] — 2026-10-03

### Changed

- On the Settings tab the phases are under **More**, with polling and the
  thresholds, each under its own heading.
- **Forget what was learned** is now just **Forget**, under Thresholds, as a
  smaller button; the README says what it forgets and what it keeps.

### Fixed

- The × that removes a phase sits in the middle of its button, which is as
  high as the fields beside it.

## [0.18.0] — 2026-10-03

### Changed

- Phases are edited on the Power tab only, below the chart, as the list the
  Settings tab had: one line per phase, × to remove one, **+ Add phase** for
  an empty line. A green level marker adds a line with its range. The chart
  follows a change a moment later.
- The Settings tab lists the phases in a table, to read.
- The **New phase** form on the Power tab is gone.

## [0.17.0] — 2026-10-03

### Changed

- The Power tab updates itself while it is open: every 5 seconds, or every
  30 seconds when it shows more than a day. It holds still while a stretch
  is marked. The **Reload** button is gone.

## [0.16.1] — 2026-10-02

### Changed

- **Forget what was learned** shows only when something has been learned.
- A click on the Power chart removes the marked stretch, and with it
  **Learn from this cycle**.
- New screenshots in the README, and the README covers the learned values
  shown in the settings. The dark screenshots are the light ones for now.

## [0.16.0] — 2026-10-02

### Added

- **Learn from this cycle** on the Power tab: drag across a whole cycle and
  the plugin learns from it at once, as from one it saw itself, instead of
  waiting for a first cycle with the slow defaults.
- **Forget what was learned** under More in the settings, to start again
  from the defaults.
- The empty threshold fields show the value in use and where it comes from:
  `38.4 learned`, `20.6 standby`, `60 default`; below them, how many cycles
  it was learned from.

### Changed

- On the Power tab, a phase is made by clicking a level marker only; dragging
  across the chart now marks a cycle to learn from. The two have panels of
  their own. Pointing at a marker shows no time line, and pressing on one
  starts no drag. Dragging no longer selects the text around the chart.
- Learning from a cycle that ends with nothing drawn after it — switched off
  at the plug — no longer takes 0 W for standby and puts the running level
  at 2 W. Standby is then taken from the highest steady low level inside the
  cycle (a computer asleep over lunch), or the running level stays as it is.
  For a cycle marked by hand, the reading before it is not taken for standby
  either, since the marked start is never exact.

## [0.15.1] — 2026-10-02

### Changed

- One **Reset data** button below the Statistics table instead of one per
  row: click it, tick the appliances to reset, click **Reset selected**, then
  **SURE?**. Left alone, it goes back with nothing ticked.
- The Statistics table has a proper header. The only tooltip left is on Last
  Cycle: when it finished and how long it ran. Its text is no longer
  greyed out by the Homebridge UI's table style.

## [0.15.0] — 2026-10-01

### Added

- **Last Cycle** on the Statistics tab: what each appliance used in its last
  cycle, from running to finished. Point at it for when it finished and how
  long it ran. Reset data empties it too.

## [0.14.2] — 2026-10-01

### Changed

- The thresholds under More read as two sentences to fill in: **Running**
  when above … W for at least … s, **Finished** when below that for … s.
  Empty fields show what applies instead in faint italics, so they are not
  taken for values.

## [0.14.1] — 2026-10-01

### Fixed

- A cycle running across a restart of Homebridge kept its start, but its
  energy and peak began again from nothing, so the "Finished" line in the log
  showed only what it used after the restart. Both are now saved with the
  state, every five minutes and on shutdown.

## [0.14.0] — 2026-10-01

### Added

- **Standby is found before anything is learned.** An appliance resting
  above the 5 W default running level, a computer at 9 W say, never finished
  and so never learned. Now the lowest level held steady for ten minutes (up
  to 25 W, and only once the appliance has drawn three times that) is taken
  as standby, and running starts at twice that until a cycle is learned.
- **A plug switched off ends the cycle at once**, on plugs with a relay such
  as the Eve Energy, without waiting out the quiet. Meters without a relay
  (Shelly Plug PM Gen3) finish by the quiet as before.

### Removed

- The **Off** state and its off level (`thresholds.offWatts`). It told an
  appliance switched off from one finished and on standby, which nothing in
  HomeKit showed; Running off was the same for both. An appliance is now
  running or not: when it finishes it is idle until it starts again. A phase
  tells apart what a machine does after it has finished, such as a display
  staying on. An `offWatts` in the config is ignored, and dropped when the
  settings page saves.

### Changed

- "Getting notified" in the README: notifications for an occupancy sensor,
  and an automation for a Running switch, such as a "Dryer is finished"
  message through homebridge-pushover-notification.
- Under More, "Ask for power every" is now **Polling interval**, on a line
  of its own, and the thresholds are a small table: **Running** (power above,
  for at least) and **Finished** (quiet for), each with a short hint.

## [0.13.0] — 2026-10-01

### Added

- **Reset data** on the Statistics tab, per appliance: empties its energy and
  its count, which start again from then. Click twice to confirm.

### Changed

- Shorter help texts on the settings page; the details are in the README.
- The Power tab opens on "Last 12 hours" instead of "Last 6 hours".

## [0.12.1] — 2026-10-01

### Added

- "Last 12 hours" on the Power tab.

## [0.12.0] — 2026-10-01

### Changed

- The appliance lists on Settings and Power are the same size, so switching
  tabs does not jump.

### Removed

- `finishedReset` and `finishedResetMinutes`, no longer offered since 0.9.0:
  with nothing in HomeKit telling Finished from Off, they only decided when
  the log said Off. Finished now always goes back to Off when the appliance
  is switched off, as it did by default. The settings page drops the old keys
  when it saves.

## [0.11.3] — 2026-10-01

### Changed

- Settings and Power stay on the same appliance: switching tabs opens the
  other on the one just picked.

## [0.11.2] — 2026-10-01

### Fixed

- An error while handling a reading or a tick — a full disk when saving, say —
  is logged instead of ending the child bridge. So is a failure to stop the
  Matter controller on shutdown, and a data folder from the plugin's earlier
  name that cannot be moved.

## [0.11.1] — 2026-10-01

### Fixed

- On the power chart, phases in the same range (a coffee and a rinse) have their
  names side by side instead of on top of each other.

### Changed

- The **Curve** tab is called **Power**: what it shows, next to Statistics.
- New screenshots in the README, which is brought up to date, and the
  settings say that the statistics do not depend on how many days of
  recordings are kept.

## [0.11.0] — 2026-10-01

### Added

- Running can be shown as an **occupancy sensor** instead of a switch, per
  appliance (`runningAs: "occupancy"`): a desk is taken while it draws power,
  free when not. Changing it replaces the switch or sensor in HomeKit.

## [0.10.3] — 2026-10-01

### Changed

- Phase switches are named after the phase alone, "Bezug" rather than
  "Kaffeemaschine Bezug", since they sit inside "Kaffeemaschine Monitor".
  Running keeps the appliance's name. A phase switch still called by the
  former default is renamed; one renamed in the Home app is left alone.

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

[Unreleased]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.2...HEAD
[0.18.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.1...v0.18.2
[0.18.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.11.3...v0.12.0
[0.11.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.3...v0.11.0
[0.10.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/rummeyer/homebridge-appliance-monitor/releases/tag/v0.6.0
