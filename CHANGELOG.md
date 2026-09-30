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
  can be turned off and renamed.
- Learns each appliance's running level, longest pause and off level from its
  first cycle, and refines them with every cycle after. A cycle that ended too
  early is caught when the machine runs again, and its pause learned.
- Finished goes back to Off when the appliance is switched off, after a set
  time, or when it runs again, as configured.
- Any threshold can be fixed in the settings instead of learned.
- The state survives a restart.
