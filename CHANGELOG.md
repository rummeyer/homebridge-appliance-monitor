# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

- Readings are recorded to a file per day under `power/`, kept for 14 days
  by default (`recordDays`), instead of one `power.csv` that grew without end.
- The log is shorter: one line per plug on start, the full list of what a
  plug offers only once when it is paired, no single readings, and matter.js's
  expected start-up warnings only with debug logging.
