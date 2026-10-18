# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.14.0] — 2026-10-18

### Changed

- **Idle** counts from when the appliance stops running, whatever it
  draws: a TV in a standby that reads 0 W is idle too, where 0.5 W or less
  used to count as off and stopped it. It goes off when the appliance runs
  again or the plug's relay is switched off, so an automation switching
  the plug off on Idle does so once. Counted from the end of a phase, it
  likewise keeps counting once the appliance has switched itself off.

## [1.13.1] — 2026-10-18

### Changed

- The dashboard keeps the plug picked for the power chart for the next
  visit, as it does the time, in the same browser; all plugs again if that
  plug is gone.
- New README screenshots of the settings and the dashboard, as of 1.13.0.

## [1.13.0] — 2026-10-18

### Changed

- The **Idle On** sensor is now called **Idle**, and its fields **Idle
  after** and **Idle counted from**. A sensor still called "… Idle On" in
  the Home app is renamed on start and keeps its automations; one renamed
  there keeps its name. The config keys stay `idleOnMinutes` and
  `idleOnFrom`.

### Fixed

- A plug that is unreachable, or has its relay switched off, no longer keeps
  a phase on: it counts as out of every range, and the phase ends after its
  hold. A standby phase from 0 W stayed on while the plug was gone, or
  switched off and reporting 0 W.
- The relay's state is read on connecting, not only on its next change.
- An unreachable appliance's dashboard tile shows – rather than what it
  drew last.

## [1.12.3] — 2026-10-17

### Changed

- New README screenshots of the dashboard in all three looks and of the
  settings, as of 1.12.2.

## [1.12.2] — 2026-10-17

### Fixed

- **Outlet** was missing from the Icon list in the settings; it is the
  first entry again, above the groups.
- The Icon field is always under the name: for an appliance sharing a
  bridge's pairing, the Device field now takes the pairing code's place
  next to Pairing.

## [1.12.1] — 2026-10-17

### Changed

- New README screenshots: the dashboard's Home look with the appliance
  icons, and the settings with the Icon list and Idle On's new hint.

## [1.12.0] — 2026-10-17

### Added

- **Icon** per appliance, under its name in the settings (`icon`): what
  its tile shows in the dashboard's Home look instead of an outlet. 64 to
  pick from, in groups — washing machine, dryer, TV, coffee machine, desk
  lamp, computer, car charger and more — from Material Symbols (Apache
  License 2.0), in the same filled, rounded look. HomeKit is not changed by
  it.

## [1.11.2] — 2026-10-17

### Fixed

- The hint under **Idle on after** said "On standby this long", which was
  wrong for an appliance counted from the end of a phase. It now says what
  Idle On counts: "This long after the end of Bezug", or "On this long
  without running".

### Changed

- The README tells how to switch an appliance off with a Home app
  automation on Idle On or Overtime.

## [1.11.1] — 2026-10-17

### Changed

- New Statistics screenshot in the README, with the bubble as of 1.11.0.

## [1.11.0] — 2026-10-17

### Changed

- The bubble over a row in the energy tables is grouped under two
  headings: **Last cycle** with its Energy, Running and Finished (a dash
  for each until the first cycle), and **Overall** with Estimated
  duration, Count and Standby.
- **Usual running time** is now **Estimated duration**, without "by how it
  starts" after a washing machine's lengths per programme.

### Added

- Where cycle lengths are all over the place, Estimated duration shows
  their median ("median 45 min, lengths vary") instead of nothing. Before
  the second cycle it says "still learning · 1 of 2 cycles".

## [1.10.2] — 2026-10-15

### Changed

- The bubble over a row in the energy tables is wider, so a washing
  machine's usual running times by programme fit on one line; on a narrow
  screen its values wrap instead of running off the edge.

## [1.10.1] — 2026-10-15

### Changed

- On the settings page, Idle On's two fields have a line of their own
  under In HomeKit, in the same columns as the fields above.

## [1.10.0] — 2026-10-15

### Added

- **Idle on counted from** a phase (`idleOnFrom`): Idle On turns on that
  many minutes after the phase last ended, while the plug still draws
  power, and off when the phase runs again or the plug draws nothing — 10
  minutes after the last coffee, for a coffee machine that keeps itself
  warm and so never stops running.

## [1.9.0] — 2026-10-15

### Added

- **Programmes told apart by how they start**: each cycle's first ten
  minutes are kept with its length, and from a running cycle's third
  minute on, the time left on the dashboard comes only from the cycles that
  started alike. A washing machine on quick and long programmes, which had
  no usual running time before, has one per programme; the Statistics tab
  lists them. The last 20 cycles are kept, up from 10.

## [1.8.1] — 2026-10-15

### Fixed

- Dates and times on the settings page and the dashboard are in English,
  like all their texts, with a 24-hour clock ("Thu 07:21"), whatever the
  browser's language; they followed the browser before ("Do., 07:21").

## [1.8.0] — 2026-10-15

### Added

- **Idle On**: an occupancy sensor, on once an appliance has drawn power
  for `idleOnMinutes` without running — left on standby — and off when it
  runs again or draws nothing. Marked on the dashboard as well.

### Changed

- Left On is now called **Overtime** (`overtimeMinutes`), as it is about
  running too long. `leftOnMinutes` is still read, and an existing Left On
  sensor becomes Overtime and keeps its automations.
- Shorter hints for these fields in the settings; the README explains them.

## [1.7.1] — 2026-10-15

### Fixed

- A part counted standby while the appliance it is part of was running,
  so a desk lamp could show standby while the desk, which measures it
  too, showed none. A part now counts standby only while its whole is
  not running either.

## [1.7.0] — 2026-10-15

### Changed

- The energy tables are narrower: last cycle, count and standby are no
  longer columns but in a bubble, shown on pointing anywhere in an
  appliance's row or tapping it, together with the usual running time. The columns left are the ones that add up to a total.
- A period no appliance has a figure for yet — Last Year, in the first
  year — is left out of the energy tables until one has.

### Added

- **Standby** in the statistics, on the Statistics tab and the dashboard:
  the share of what each appliance used while it was not running, and what
  that comes to in a year, worked out from the last 30 days. Counted from
  this version on.
- **Time left** on the dashboard: for an appliance whose cycles usually take
  about as long, its running tile says how long it has left, from the last
  ten cycles.
- **Left On** (`leftOnMinutes`): an occupancy sensor in HomeKit, on once the
  appliance has been running this many minutes in one go, and off when it
  finishes — for a notification about a TV on all night. Set under **In
  HomeKit** on the settings page; marked on the dashboard too.

## [1.6.4] — 2026-10-14

### Changed

- New README screenshots: the settings page with Part of, the Statistics tab
  and the dashboard with parts indented in italics under their appliance.

## [1.6.3] — 2026-10-14

### Changed

- **Part of** on the settings page offers *None* rather than a longer text
  that its field cut off.

## [1.6.2] — 2026-10-14

### Changed

- Running's **Not shown** on the settings page now says what it means: *Not
  in HomeKit — still on the dashboard*, which keeps its tile either way.
- The energy tables list each appliance's parts right under it, indented
  and in italics, and several parts by name; the note *part of …, not in
  the total* under their names is gone.

### Fixed

- The Statistics tab on the settings page counted parts in the total too.

## [1.6.1] — 2026-10-14

### Changed

- **Part of**: while the appliance it is part of is switched off or draws
  nothing, the part draws nothing too — on its tile, in its curve, its
  energy and its cycles — even if its own meter still reports a few tenths
  of a watt. Once the whole draws again, the part's own reading counts.

## [1.6.0] — 2026-10-14

### Added

- **Part of**: an appliance whose plug is measured by another one too — a
  lamp reporting its own watts, plugged into a metered socket strip — keeps
  its own row and tile but stays out of the total in the statistics, the
  Total tile and the Total chart, so it is not counted twice (`partOf`).

## [1.5.0] — 2026-10-14

### Added

- Matter bridges, and plugs with several channels: an appliance follows one
  device of the node (`deviceId`, its UniqueID, or `endpoint`), and further
  appliances share the bridge's pairing (`pairedWith`) instead of pairing it
  again. The log lists what measures power behind a pairing; the settings
  page offers it to choose from. Asked for, and tested with
  homebridge-shelly-matter, in #2.

## [1.4.6] — 2026-10-14

### Changed

- The Home look is titled **Home**, in the page and the browser tab, rather
  than "Zuhause": everything else on the page is English.
- New dashboard screenshots in the README.

## [1.4.5] — 2026-10-14

### Changed

- The Home look's phases are white on the chart, which reads better on its
  browns than black; on a running tile, white itself, they are dark grey.

## [1.4.4] — 2026-10-14

### Changed

- The Statistics tab of the settings page is headed **Energy**, as on the
  dashboard, instead of "Energy and counts".
- In the dashboard's Home look the phases are black, in the tiles and on
  the chart, rather than in colours that hardly read on its browns.

## [1.4.3] — 2026-10-14

### Changed

- The Statistics tab of the settings page leaves out the marks ¹ and * and
  their notes too, and "Saved every five minutes": the README says how a
  period a plug joined partway through is counted.

## [1.4.2] — 2026-10-14

### Changed

- The dashboard's statistics leave out the marks ¹ and *, whose notes it no
  longer shows. The settings page keeps both.

## [1.4.1] — 2026-10-14

### Changed

- Running is the accessory's primary service: shown as one tile in the Home
  app, an appliance takes the icon of its Running switch, outlet or sensor,
  not of a phase switch.

## [1.4.0] — 2026-10-14

### Added

- Running can be shown as an **outlet** (`runningAs: "outlet"`), on and in
  use while the appliance runs, for the outlet's icon in the Home app. Like
  the switch it only shows: tapping it switches nothing.

## [1.3.2] — 2026-10-14

### Changed

- The dashboard's statistics have no notes below them; what ¹ and * mean is
  in the README.

## [1.3.1] — 2026-10-14

### Changed

- The dashboard is drawn a fifth smaller, as if zoomed out twice, except on
  a phone.
- Its statistics are headed **Energy** instead of "Energy and counts".

## [1.3.0] — 2026-10-14

### Added

- The dashboard's power chart can show all plugs together: **Total** is the
  first in the list, and its tile can be clicked like the others.
- A third look for the dashboard, **Home**, after Apple's Home app: square
  glass tiles on a warm wallpaper, an outlet's icon in yellow, a white tile
  for what is running, the title *Zuhause* and a house as the tab's icon.
  All plugs together are called **Electricity** there, as in the Home app.

### Changed

- The dashboard opens in the Home look, on all plugs together and the last
  6 hours. Its button goes round Home, light and dark; following the system
  is left to a page without JavaScript.
- The Power tab of the settings page opens on "Last 6 hours".
- The dashboard's tiles are all the same size.

## [1.2.3] — 2026-10-07

### Changed

- New dashboard screenshots in the README, with the version and the round
  theme icon.

## [1.2.2] — 2026-10-07

### Added

- The dashboard shows the version of the plugin running.
- The settings page links to the dashboard while it is switched on, under
  **General**: `http://` with this machine's address on the network and the
  port.

## [1.2.1] — 2026-10-07

### Added

- **Dashboard** is now switched on and off with a checkbox of its own
  (`dashboard`), on port 8582 unless **Dashboard port** says otherwise. A
  config from 1.2.0 with only a port keeps its dashboard on.

## [1.2.0] — 2026-10-07

### Added

- **Dashboard**: with **Dashboard port** (`dashboardPort`) set, the plugin
  serves a read-only web page — no Homebridge login — with a tile per
  appliance (its power now, running for how long, the cycle so far, its
  phases), a Total tile, the power chart and the statistics. It updates
  itself, and has a light, dark and system switch. Nothing can be changed
  there. See [Dashboard](README.md#dashboard).

### Changed

- The Power and Statistics tabs and the dashboard share one implementation
  of the chart data, the statistics table and the chart's pointer.

## [1.1.3] — 2026-10-07

### Fixed

- A phase called "Milchschaum" fits its name field on the Power tab again,
  and "1000" its number field; both had been cut off since 1.1.1.

### Changed

- New screenshots in the README, with **On down**.

## [1.1.2] — 2026-10-07

### Changed

- The phase option is called **On down** now, on the settings page and in
  the config (`onDown`). A phase that still has `rampDown` (1.1.1) or
  `fromAbove` (1.1.0) keeps working, and the settings page writes it as
  `onDown` once the option is changed there.
- The checkboxes of a phase are spaced evenly.

## [1.1.1] — 2026-10-07

### Changed

- The phase option from 1.1.0 is called **Ramp down**, on the settings page
  (shorter than "From above") and in the config (`rampDown`). A phase that
  still has `fromAbove` keeps working, and the settings page writes it as
  `rampDown` once the option is changed there.
- The × that removes a phase is smaller, so that a phase's line fits the
  Homebridge window again.

## [1.1.0] — 2026-10-07

### Added

- **From above** per phase (`fromAbove`): the phase counts only when the
  draw falls into its range, not when it rises into it. A washing machine
  that has finished rests at the same few watts as one just switched on to
  be loaded; now only the first turns the phase on. After a restart the
  plugin reads the last 12 hours of the recording to know where the draw
  came from; with nothing there, the phase counts. The chart on the Power
  tab shows the phase the same way.

## [1.0.3] — 2026-10-07

### Changed

- `package.json` names `supports-hap` among its keywords, as Homebridge asks
  of a plugin up for verification. Nothing changes in how the plugin works.

## [1.0.2] — 2026-10-07

### Fixed

- A restart while the plugin was still connecting to its plugs no longer
  makes it forget the plugs it had not reached yet. They stayed paired but
  got no readings until they were paired again.

## [1.0.1] — 2026-10-06

### Fixed

- A **Polling interval** under 2 seconds no longer stops the plug from being
  watched at all: the plugin asks every 2 seconds instead and says so in the
  log. The Settings tab shows under the field that 2 is the least.

## [1.0.0] — 2026-10-06

The first stable release. Nothing changes in how the plugin works or in its
config, so an update from 0.18 needs no steps.

### Removed

- Moving the data folder from `outlet-monitor/`, the plugin's name while it
  was being tried out, to `appliance-monitor/`. Every setup since 0.6 has
  been moved already. (matter.js still keeps the fabric under the earlier
  name, so that plugs paired then stay paired.)

### Changed

- README for people setting the plugin up: requirements, a new
  **Installation** section and pairing come first, before how it works in
  detail; how to turn on the child bridge; that the plugs need to be in Apple
  Home first; a **Troubleshooting** section; the part-year example on the
  Statistics tab put right; **Forget** instead of editing `devices.json` by
  hand.
- Tidied the settings page and its backend: one helper for the buttons that
  ask SURE?, one for reading the plugin's files, one for waiting on the
  plugin; the running level before learning is worked out in one place.

## [0.18.4] — 2026-10-05

### Fixed

- The phases under the chart on the Power tab fit the width the Homebridge UI
  gives them: the headings line up with their fields, names like
  "Milchschaum" and the empty **Below** are no longer cut off, and **Switch**
  and **Count** sit side by side. An empty **Below** reads "none", on the
  Settings tab too.

### Changed

- README: the plugin also listens to the On/Off cluster of a plug with a
  relay; where learned values and the **Count** checkbox are; how the finish
  time follows from the longest pause. New screenshots of all three tabs.

## [0.18.3] — 2026-10-05

### Changed

- The Statistics tab shows a week or a month a plug was added in partway
  through, from the day it was added, marked ¹ like a part of a year. Until now
  those stayed empty until a whole one had been counted.

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

[Unreleased]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.14.0...HEAD
[1.14.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.13.1...v1.14.0
[1.13.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.12.3...v1.13.0
[1.12.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.12.2...v1.12.3
[1.12.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.12.1...v1.12.2
[1.12.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.12.0...v1.12.1
[1.12.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.11.2...v1.12.0
[1.11.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.11.1...v1.11.2
[1.11.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.10.2...v1.11.0
[1.10.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.10.1...v1.10.2
[1.10.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.6.4...v1.7.0
[1.6.4]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.6...v1.5.0
[1.4.6]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.4...v1.0.0
[0.18.4]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.3...v0.18.4
[0.18.3]: https://github.com/rummeyer/homebridge-appliance-monitor/compare/v0.18.2...v0.18.3
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
