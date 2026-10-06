<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/icon.png" alt="" width="120" height="120">
</p>

<h1 align="center">homebridge-appliance-monitor</h1>

<p align="center">
  Your <b>washing machine, dryer and coffee machine</b> in the Apple Home app &mdash; <b>Running</b> or done, from their power draw through Matter smart plugs.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-appliance-monitor"><img src="https://img.shields.io/npm/v/homebridge-appliance-monitor?label=npm" alt="npm"></a>
  <a href="https://www.npmjs.com/package/homebridge-appliance-monitor"><img src="https://img.shields.io/npm/dt/homebridge-appliance-monitor" alt="Downloads"></a>
  <a href="https://github.com/rummeyer/homebridge-appliance-monitor/actions/workflows/build.yml"><img src="https://github.com/rummeyer/homebridge-appliance-monitor/actions/workflows/build.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rummeyer/homebridge-appliance-monitor/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="Licence"></a>
  <img src="https://img.shields.io/badge/homebridge-%E2%89%A5%202.0.0-purple" alt="Homebridge 2.0.0+">
  <img src="https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-green" alt="Node 22, 24 or 26">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/rummeyer"><img src="https://img.shields.io/badge/donate-Buy%20Me%20a%20Coffee-yellow" alt="Buy Me a Coffee"></a>
</p>

---

Watches the power draw of **Matter smart plugs and power meters** and tells
HomeKit while an appliance is **Running** and when it is done, and what
it is doing in between: heating, spinning, a coffee being drawn. Built for the
**Eve Energy** and the **Shelly Plug PM Gen3** (a meter without a relay), and
meant for any Matter device the Home app shows watts for.

There are no thresholds to work out: add the plug, run the appliance once, and
the plugin learns from that cycle what running, pausing and finished look like
for this machine.

## How it works

The plugin is a Matter controller of its own, built on
[matter.js](https://github.com/project-chip/matter.js). There's no extra
service to run and no Bluetooth. The plugs stay in Apple Home. The plugin joins
them as a second controller (Matter multi-admin) and subscribes to their power
readings: over Wi-Fi directly, or over Thread through the HomePod or Apple TV
that is already the border router. It only reads; it never switches anything.

What it needs is **ActivePower** (in milliwatts) from the standard
**Electrical Power Measurement** cluster (`0x0090`). That is where the Home app
reads its watts from, so a device that shows watts in the Home app without
Homebridge has it. On a plug with a relay it also listens to the standard
**On/Off** cluster (`0x0006`), to see the plug being switched off. There is
nothing vendor-specific.

## Requirements

- Homebridge 2 on Node.js 22, 24 or 26.
- **Run it as a child bridge.** matter.js keeps process-wide state, and
  Homebridge 2 can load matter.js itself. In the Homebridge UI, open the
  plugin's menu (⋮) → **Bridge Settings**, turn the child bridge on, and
  restart Homebridge.
- **The plugs set up in the Apple Home app**, which shows their watts. The
  plugin joins them as a second controller; they stay in Apple Home.
- **For devices on Thread, the Homebridge machine (a Raspberry Pi, say) needs
  a route to the Thread network.** The
  border routers (HomePod, Apple TV) announce it in their IPv6 router
  advertisements, as a /64 route via themselves. Without it, pairing finds the
  device and then times out.

  On Raspberry Pi OS Bookworm, NetworkManager handles router advertisements
  itself and takes the route without any setup. Check that it is there, and
  that a Thread device answers:

  ```sh
  ip -6 route | grep "proto ra"   # a …/64 via fe80::… of a HomePod or Apple TV
  avahi-browse -rt _matter._tcp   # Matter devices and their addresses
  ping -6 -c 3 <address of a Thread device>
  ```

  Without NetworkManager (dhcpcd, systemd-networkd), the kernel handles router
  advertisements and ignores these routes by default:

  ```sh
  # eth0 or wlan0, whichever faces the HomePod
  printf 'net.ipv6.conf.eth0.accept_ra=1\nnet.ipv6.conf.eth0.accept_ra_rt_info_max_plen=64\n' \
    | sudo tee /etc/sysctl.d/60-thread.conf
  sudo sysctl --system
  ```

## Installation

In the Homebridge UI, search the **Plugins** tab for **Appliance Monitor** and
install it. Or from a shell, in the Homebridge storage folder:

```sh
npm install homebridge-appliance-monitor
```

Then set it up as a child bridge (see [Requirements](#requirements)) and pair
the first plug.

## Pairing a plug

1. In the Home app, open the plug's settings and choose **Turn On Pairing
   Mode**. Copy the eleven-digit code. This works the same for every
   device.
2. In the plugin settings, click **+ Add**, give the appliance a name, paste
   the code, and save. The settings show one appliance at a time, picked from
   the list at the top; paired ones are ticked.
3. Restart the child bridge. The code is valid for 15 minutes; pairing
   takes up to a minute.
4. The log shows `paired as node …`, then the plug's endpoints and clusters,
   and that it is learning. After that you can remove the code from the
   config.
5. Run the appliance once. When the log shows `learned from 1 cycle`, it is
   set up. To skip the wait, mark a cycle on the Power tab; see
   [Learning](#learning).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/settings-dark.png">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/settings-light.png" alt="The Settings tab: an appliance picked from the list, with its polling interval, its phases and the thresholds it learned under More" width="760">
</picture>

A paired plug is remembered by its name, so renaming it means pairing it
again. Remove the old pairing from the Home app first, under the plug's
connected services.

### Why the Home app calls it "Matter Test"

Under the plug's connected services, the Home app lists this plugin as
**Matter Test**, not as Homebridge Appliance Monitor. The plugin does give the
plug that name (the fabric label, set again on every connection), but the Home
app appears to name other controllers by their vendor ID instead. This plugin
uses `0xFFF1`, the ID the Matter specification sets aside for testing and
self-built controllers, and the Home app shows that ID as "Matter Test".

A vendor ID of its own needs a membership of the Connectivity Standards
Alliance, and using another vendor's ID would pass the plugin off as someone
else's product. So the name stays. It changes nothing about how the plugin
works.

## Running and finished

An appliance is running or it is not:

- **Running**: working. It counts as a start once the draw has been above the
  running level for a minute in all. Added up, because a wash without heating
  is a drum turning in bursts of half a minute; a door lock or a pump running
  for a few seconds does not add up to a start.
- **Finished**, and so no longer running: the draw has stayed below the
  running level for longer than the longest pause in the programme. Or, on
  a plug with a relay such as the Eve Energy, the plug was switched off: that
  is the end straight away, since no pause in a programme switches the plug.
  A meter without a relay, such as the Shelly Plug PM Gen3, has no such
  state, and finishes by the quiet alone.

Whether it then sits on standby or is switched off at the plug makes no
difference. To tell something apart that the machine does after it has
finished, a display staying on or a door opened, set up a
[phase](#phases) for its power range.

In HomeKit, Running is a switch that is on while the appliance runs, or an
occupancy sensor for a desk. It goes off only when the appliance finishes, so
"when Running turns off" is "when it is done". See
[In the Home app](#in-the-home-app).

### Learning

A new appliance starts with generous defaults: running above 5 W, and
finished only after half an hour of quiet, so that no pause in a programme can
split one cycle into two. The first Finished therefore comes late.

Ten minutes after that first cycle, the plugin works out from its curve:

- the **level the machine rests at** when it is on but not working (the middle
  of the ten minutes after the end), and from it the **running level**,
  clearly above;
- the **longest pause** inside the programme, a soak or a cool-down, and from
  it how long a quiet spell has to last before it is the end (the pause and
  half again, and at least two minutes longer than the pause).

From then on Finished comes minutes after the end. Every further cycle
refines this, and a longer pause only ever lengthens the wait. If a cycle
does turn out to have ended too early (the machine runs again within ten
minutes), the plugin logs it, treats it as one cycle and learns the pause.

What was learned is logged, kept in `appliance-monitor/devices.json`, and
shown under **More** → Thresholds in the settings, in the empty fields: `38.4
learned`, `20.6 standby` or `60 default`. Any threshold can be set there
instead, each on its own; the rest are still learned.

An appliance whose standby is above 5 W, a computer at 9 W say, would never
drop below the default running level, and so never finish and never learn.
So, until a cycle has been learned, the plugin also looks for **standby**: the
lowest level held steady for ten minutes, at most 25 W, once the appliance has
been seen drawing at least three times that. Running then starts at twice
standby, and the log says so (`standby at 9.40 W — running above 18.8 W`).
To set it yourself instead, put the **Running** power under **More** in the
settings between standby and what it draws in use, and the **Finished** time
to how long it should wait before it counts as done.

**Learn from a cycle you mark.** To skip the wait for a first cycle, drag
across a whole cycle on the **Power** tab, from start to end, and click
**Learn from this cycle**. The plugin learns from it just as from one it saw
itself, and the answer says what it learned. A click on the chart removes the
marking.

**Forget.** If something was learned wrong, from a cycle that was not a
normal one say, **Forget** under **More** → Thresholds in the settings
starts that appliance again from the defaults. It throws away the learned
running level and finish time, the count of cycles they were learned from,
and the standby found; the next cycle is learned afresh, or mark one on the
Power tab. Thresholds you set yourself, the phases, the statistics and the
power recordings stay as they are. It takes effect at once, without a
restart, after a second click on the button to be sure. The button shows
only once something has been learned or standby found.

## Phases

Inside a cycle an appliance does different things, and many of them can be
told apart by power alone. A coffee machine keeps warm at 2 W, heats at
1000 W, and draws 300 W while a coffee runs through; a washing machine heats
at 2000 W and spins at 400. A **phase** is one of these: a range of power, and
how long the draw has to be in it.

Phases are ranges, not thresholds, because the order does not hold: drawing
a coffee is less than heating. And a phase ends only once the draw has been
out of its range for a while (30 seconds by default), because a heating
element switched by a thermostat goes on and off every few seconds.

The easiest way to set one up is the **Power** tab of the settings page. It
shows a plug's recorded power, from the last hour to the last two weeks, with
the levels the plug dwells at as green markers on the right, the phases set up
so far each in its colour, and a bar below for each phase showing when it was
on. It keeps itself up to date while it is open: every 5 seconds, or every
30 seconds when it shows more than a day. Pointing at the chart shows the
time and the reading there. Below the chart are the appliance's phases, one
line each. Click a marker to add that level as a new line, or **+ Add phase**
for an empty one; × removes one. (Dragging across the chart marks a cycle to
learn from; see [Learning](#learning).)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/power-dark.png">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/power-light.png" alt="The Power tab: a coffee machine's power over an hour, with its phases Aufheizen, Bezug, Spülen and Milchschaum, and a bar for each showing when it was on" width="760">
</picture>

Name the phase, adjust the range if you like, and save; the chart shows a
change to a phase a moment later. The Settings tab only lists the phases,
under **More**. Each phase can have a switch in HomeKit, on while it lasts
(**Switch**), and can be what the Statistics tab counts (**Count**); its start
and end are logged.

Some things differ not by power but by how long they last. Rinsing a coffee
machine runs the same pump as a coffee, for a few seconds rather than twenty.
Two phases in the same range tell them apart, here *Bezug* (a coffee drawn)
and *Spülen* (a rinse):

| Phase | Range | On after | Shorter than |
|---|---|---|---|
| Bezug | 30–100 W | 10 s | |
| Spülen | 30–100 W | 2 s | 10 s |

A draw of ten seconds or more turns Bezug on; a shorter one is a rinse, and
never turns Bezug on. How long a draw was is known only once it is over, so
a phase with **Shorter than** goes on for a moment then,
rather than while it lasts. Both times count the draw's time in the range,
not how long a switch was on; give both phases the same "off after", so they
see the same draws.

## In the Home app

Each appliance is one accessory, "Washing machine Monitor" say, to tell it
apart from the plug's own accessory, with a switch for each thing it can
tell, to hang automations on:

- **Running**: on while the appliance runs, and off once it has finished,
  never before. An automation "when Washing machine Running turns off" runs
  once per cycle, when it is done: a notification, a light, an announcement
  on the HomePod. For a desk, Running can be an **occupancy sensor**
  instead: taken while it draws power, free when not.
- **One switch per phase**: on while the phase lasts, "Bezug"
  say, or for a moment once it is over, for a phase with "shorter than".

The plugin only measures, so the switches only report: one tapped in the Home
app is put back to what the appliance is doing straight away, and an
automation never sees a state that is not true.

Running is on by default; it can be turned off in the settings, a phase's
switch too. A new phase switch is named after the phase, "Bezug" say, since
it sits inside the appliance's accessory; Running is named after the
appliance, "Waschmaschine Running", because several switches called just
"Running" could not be told apart. To call one something else, rename it in
the Home app; the plugin never sets the name again.

A plug with every switch turned off, a lamp say, does not appear in HomeKit at
all, and is still counted in the statistics.

### Getting notified

The Home app sends notifications for sensors, not for switches:

- **Occupancy sensor**: in the sensor's settings in the Home app, turn on
  **Notifications**.
- **Running switch**: an automation "when … Running turns off" that turns on
  something that notifies, or plays an announcement on a HomePod. Or show
  Running as an occupancy sensor instead, and use its notifications.

For a message on your phone, the
[homebridge-pushover-notification](https://www.npmjs.com/package/homebridge-pushover-notification)
plugin offers a switch per message that sends it through
[Pushover](https://pushover.net) when turned on, and turns itself off again:

```json
{
  "platform": "PushoverNotification",
  "user": "<your Pushover user key>",
  "token": "<your application token>",
  "messages": [
    { "name": "Dryer finished", "title": "Dryer", "message": "Dryer is finished" }
  ]
}
```

Then in the Home app add an automation: **When "Dryer Running" turns off**,
turn on "Dryer finished". Running goes off only once the dryer has finished,
so this sends one message per cycle. Phases work the same way: "when Bezug
turns off" for a coffee drawn.

## Statistics

The settings page has a **Statistics** tab with the energy each plug used
**Today** so far, and in the **Last Week** (Monday to Sunday), **Last Month**
and **Last Year**, one row per plug and the total below.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/stats-dark.png">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/stats-light.png" alt="The Statistics tab: energy per appliance today, last week, last month and last year, its last cycle, and a count per appliance" width="760">
</picture>

Today counts from a plug's first reading of the day, so a plug added at noon
shows its afternoon. A week, a month or a year a plug joined partway through
is shown from the day it was added, marked ¹ as only part of the period: a plug
added on Wednesday 30 September 2026 shows the 30th as last month,
Wednesday to Sunday as last week, and, from 1 January 2027, 30 September to
31 December as last year. Where some plugs have a value and others do not
yet, the total adds up those that have, and is marked with an asterisk.

The **Last Cycle** column shows what each appliance used in its last
cycle, from the moment it counted as running to the moment it finished.
Point at it for when it finished and how long it ran.

The **Count** column shows how often each appliance finished a cycle — or, if
one of its phases is ticked **Count** on the Power tab, how often that phase
happened: coffees drawn rather than mornings the machine was on. If several
are ticked, the first counts. Every finished cycle and every phase is counted
all along, so ticking another phase shows its count from when the phase was
set up, not from when it was ticked.

**Reset data** below the table empties the energy, last cycle and count of
the appliances you pick, which start again from then; what they have learned
is kept. Click it to show a checkbox per appliance, tick the ones to reset,
click **Reset selected**, then **SURE?**. Left alone for 20 seconds (5 at
SURE?), it goes back with nothing ticked. The running plugin does the reset
within a few seconds; if the child bridge is not running, the settings page
does it on the files itself.

The energy is worked out from the power readings, per local calendar day,
while Homebridge is running, and saved every five minutes. Time it was not
running is not counted. The
statistics keep only the total per plug and day, for a little over two years,
so they do not depend on how many days of recordings are kept.

## Plugs that report seldom

A plug decides itself how often it reports its power. The Shelly Plug PM
reports when the draw changes; the Eve Energy about once a minute. A minute
is fine for a wash cycle or for heating, but a coffee runs through in half a
minute and may fall between two reports, or show as a single one.

For such a plug, set **Polling interval** (under **More**), and the plugin asks it
on top of listening. The Eve Energy measures far more often than it reports,
so asking every 5 seconds gives a fresh reading every 5 seconds. Each ask is a
message over Thread or Wi-Fi, so keep it to the plugs that need it.

A plug that draws nothing is not asked: the appliance is off, and the plug
reports it being switched on by itself. The asking is left to the hours the
appliance is on.

## Configuration

Everything can be set on the plugin's settings page in the Homebridge UI; the
config it writes looks like this:

```json
{
  "platform": "ApplianceMonitor",
  "devices": [
    { "name": "Washing machine", "pairingCode": "3497-011-2332" },
    {
      "name": "Dryer",
      "thresholds": { "runWatts": 20 }
    },
    { "name": "Desk", "runningAs": "occupancy" }
  ],
  "recordPower": true,
  "matterLogLevel": "warn"
}
```

| Option | Default | |
| --- | --- | --- |
| `devices[].name` | — | The appliance. Its accessory is called "<name> Monitor", and its Running switch "<name> Running"; also the name in the log and the recordings. |
| `devices[].pairingCode` | — | Setup code from the Home app, or an `MT:` QR payload. Only needed until paired. |
| `devices[].runningSwitch` | `true` | Running in HomeKit, on while the appliance runs. |
| `devices[].runningAs` | `switch` | `switch`, or `occupancy` for an occupancy sensor (a desk, taken or free). Changing it replaces it in HomeKit, with any automation on it. |
| `devices[].thresholds.runWatts` | learned | Running above this, in W. |
| `devices[].thresholds.startSeconds` | `60` | Seconds above the running level, added up, before it counts as running. |
| `devices[].thresholds.finishSeconds` | learned | Seconds of quiet before it counts as finished. |
| `devices[].phases` | none | Phases: `name`, `minWatts`, and optionally `count` (show it as the appliance's count on the Statistics tab), `maxWatts` (none for no upper end, as for heating), `minSeconds` (in the range, added up, before it is on; 5), `holdSeconds` (out of it before it is off; 30), `maxSeconds` (only draws shorter than this, in the range; any; see [Phases](#phases)) and `sensor` (its switch in HomeKit; `true`). |
| `devices[].pollSeconds` | none | Ask the plug for its power this often, as well as listening for what it reports. See [Plugs that report seldom](#plugs-that-report-seldom). |
| `recordPower` | `true` | Write each reading to a file per day under `appliance-monitor/power/`. The Power tab needs it. |
| `recordDays` | `14` | How many days of those files to keep, for the Power tab. The statistics do not need them. |
| `matterLogLevel` | `warn` | How much of matter.js's own logging to show. |

## Files

All files are kept in the Homebridge storage folder, under `appliance-monitor/`:

- `matter/`: the controller's fabric, certificates and what it knows about
  the plugs. Deleting it unpairs everything, as far as the plugin is concerned.
- `nodes.json`: which configured name is which Matter node.
- `devices.json`: what each appliance has learned, the state it is in, so that
  a running appliance is still running after a restart, and its counts.
  To have an appliance learn afresh, use **Forget** in the settings (see
  [Learning](#learning)).
- `energy.json`: watt-hours per plug and day, for the Statistics tab, kept for
  a little over two years. Written every five minutes. Plugs removed from the
  config keep their history here.
- `resets.json`, `requests/` and `answers/`: what the settings page asked of
  the plugin (resetting statistics, learning from a marked cycle,
  forgetting), there only until it has been done.
- `power/`: one file per day, `time,device,endpoint,watts`, one line per
  reading. Older than `recordDays` is deleted.

## The log

On each start, one line per plug: what it is, what it draws, its state, and
whether it has learned yet. Everything a plug offers is listed once, when it
is paired. After that the log has the changes: Running, Finished, each
phase starting and ending (or, for a phase with "shorter than", having
happened), what was learned, and a plug that became unreachable or came back.
The single readings are in the recordings, not in the log.

matter.js warns on every start about the test vendor ID `0xFFF1` (see [Why the Home app calls it "Matter Test"](#why-the-home-app-calls-it-matter-test)),
about Bluetooth not being enabled, and, when pairing, about not checking the
plug's certificates against the Matter ledger. All of it is expected for a
controller like this one, so it only shows with Homebridge's debug logging.

## Troubleshooting

- **Pairing times out.** The code is valid for 15 minutes from **Turn On
  Pairing Mode**; get a fresh one and restart the child bridge. For a plug on
  Thread, check the route to the Thread network (see
  [Requirements](#requirements)).
- **`not paired yet` in the log.** There is no pairing code in the settings,
  or the plug was renamed: a paired plug is remembered by its name.
- **`Paired but not configured: node …`.** A plug was renamed or removed from
  the settings. Remove the plugin's pairing from the plug in the Home app,
  under its connected services.
- **Finished comes half an hour late.** Nothing has been learned yet: run the
  appliance once, or mark a cycle on the Power tab.
- **Finished never comes.** The appliance rests above the running level.
  Put the **Running** level under **More** → Thresholds between its standby
  and what it draws in use.
- **A setting changed in the config has no effect.** Restart the child
  bridge from the Homebridge UI; the plugin reads its config only on start.

## Licence

MIT
