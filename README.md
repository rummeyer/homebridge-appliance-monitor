# homebridge-appliance-monitor

Watches the power draw of **Matter smart plugs and power meters** and tells
HomeKit when the washing machine is **Running** and when it is **Finished**.
Built for the **Eve Energy** and the **Shelly Plug PM Gen3** (a meter without a
relay), and meant for any Matter device the Home app shows watts for.

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

It reads one thing: **ActivePower** (in milliwatts) from the standard
**Electrical Power Measurement** cluster (`0x0090`). That is where the Home app
reads its watts from, so a device that shows watts in the Home app without
Homebridge has it. There is nothing vendor-specific.

## Off, Running, Finished

Each appliance is in one of three states:

- **Off**: resting, or switched off.
- **Running**: working. It counts as a start once the draw has been above the
  running level for a minute in all. Added up, because a wash without heating
  is a drum turning in bursts of half a minute; a door lock or a pump running
  for a few seconds does not add up to a start.
- **Finished**: the draw has stayed below the running level for longer than
  the longest pause in the programme.

What takes Finished back to Off is up to you:

- **When the appliance is switched off** (the default): the draw falls from
  the level the machine rests at when done, a lit display for instance, to
  its off level. An appliance that drops to nothing by itself at the end has
  no such level; it stays Finished until it runs again.
- **After a set time.**
- **Only when it runs again.**

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
  half again, at least two minutes);
- the **off level**: half the lowest the machine drew while it was on,
  pauses included, so that keeping warm is never taken for switched off.

From then on Finished comes minutes after the end. Every further cycle
refines this, and a longer pause only ever lengthens the wait. If a cycle
does turn out to have ended too early (the machine runs again within ten
minutes), the plugin logs it, treats it as one cycle and learns the pause.

What was learned is logged and kept in `appliance-monitor/devices.json`. Any
threshold can be fixed in the settings instead, each on its own; the rest are
still learned.

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

The easiest way to set one up is the **Curve** tab of the settings page. It
shows a plug's recorded power, from the last hour to the last two weeks, with
the levels the plug dwells at as green markers on the right, the phases set up
so far each in its colour, and a bar below for each phase showing when it was
on. Pointing at the chart shows the time and the reading there.

- click a marker to make that level a phase, or
- drag across the chart over something the appliance did (a coffee at
  7:02, a spin) to take the range it drew then.

Name the phase, adjust the range if you like, add it, and save. Each phase
can have an occupancy sensor in HomeKit, occupied while it lasts, and its
start and end are logged.



Each appliance is one accessory with these sensors:

- **Running**: an occupancy sensor, occupied while the appliance runs.
- **Finished**: a contact sensor, open while it is finished. The Home app can
  notify you when it opens, with no automation needed.
- One occupancy sensor for each phase, if it has any.

Running and Finished are on by default, and each sensor can be turned off in
the settings. A new sensor is named after the appliance, followed by
"Running", "Finished" or the phase's name: "Coffee machine Heating", say. To
call it something else, rename it in the Home app; the plugin never sets the
name again. While a plug cannot be reached, its sensors are shown as not
responding.

A plug with every sensor turned off, a lamp say, does not appear in HomeKit at
all, and is still counted in the statistics.

## Statistics

The settings page has a **Statistics** tab with the energy each plug used
**Today** so far, and in the **Last Week** (Monday to Sunday), **Last Month**
and **Last Year**, one row per plug and the total below. Point at a heading
for its dates.

Today counts from a plug's first reading of the day, so a plug added at noon
shows its afternoon. A week or a month is shown only if a plug has been
counted for all of it, and left empty until then. A year is shown once it is over even if the plug joined partway
through, marked ¹ as part of a year: a plug added in September 2026 shows its
2026 from the 1st of January 2027. Where some plugs have a value and others do
not yet, the total adds up those that have, and is marked with an asterisk.

The energy is worked out from the power readings, per local calendar day,
while Homebridge is running. Time it was not running is not counted.

## Requirements

- Homebridge 2 on Node.js 22, 24 or 26.
- **Run it as a child bridge.** matter.js keeps process-wide state, and
  Homebridge 2 can load matter.js itself.
- **For devices on Thread, the Pi needs a route to the Thread network.** The
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

## Pairing a plug

1. In the Home app, open the plug's settings and choose **Turn On Pairing
   Mode**. Copy the eleven-digit code. This works the same for every
   device.
2. In the plugin settings, add a plug with a name and that code, and save.
3. Restart the child bridge. The code is valid for 15 minutes.
4. The log shows `paired as node …`, then the plug's endpoints and clusters,
   and that it is learning. After that you can remove the code from the
   config.
5. Run the appliance once. When the log shows `learned from 1 cycle`, it is
   set up.

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

## Plugs that report seldom

A plug decides itself how often it reports its power. The Shelly Plug PM
reports when the draw changes; the Eve Energy about once a minute. A minute
is fine for a wash cycle or for heating, but a coffee runs through in half a
minute and may fall between two reports, or show as a single one.

For such a plug, set **Ask for power every (seconds)**, and the plugin asks it
on top of listening. The Eve Energy measures far more often than it reports,
so asking every 5 seconds gives a fresh reading every 5 seconds. Each ask is a
message over Thread or Wi-Fi, so keep it to the plugs that need it.

A plug that draws nothing is not asked: the appliance is off, and the plug
reports it being switched on by itself. The asking is left to the hours the
appliance is on.

## Configuration

```json
{
  "platform": "ApplianceMonitor",
  "devices": [
    { "name": "Washing machine", "pairingCode": "3497-011-2332" },
    {
      "name": "Dryer",
      "runningSensor": false,
      "finishedReset": "timeout",
      "finishedResetMinutes": 30,
      "thresholds": { "runWatts": 20 }
    }
  ],
  "recordPower": true,
  "matterLogLevel": "warn"
}
```

| Option | Default | |
| --- | --- | --- |
| `devices[].name` | — | Name of the accessory, and of the sensors, log lines and recording. |
| `devices[].pairingCode` | — | Setup code from the Home app, or an `MT:` QR payload. Only needed until paired. |
| `devices[].runningSensor` | `true` | Show the Running occupancy sensor. |
| `devices[].finishedSensor` | `true` | Show the Finished contact sensor. |
| `devices[].finishedReset` | `off-level` | Finished goes back to Off: `off-level` when switched off, `timeout` after a set time, `next-start` only when it runs again. |
| `devices[].finishedResetMinutes` | `60` | The time for `timeout`. |
| `devices[].thresholds.runWatts` | learned | Running above this, in W. |
| `devices[].thresholds.offWatts` | learned | Switched off at or below this, in W. |
| `devices[].thresholds.startSeconds` | `60` | Seconds above the running level, added up, before it counts as running. |
| `devices[].thresholds.finishSeconds` | learned | Seconds of quiet before it counts as finished. |
| `devices[].phases` | none | Phases: `name`, `minWatts`, and optionally `maxWatts` (none for no upper end, as for heating), `minSeconds` (in the range, added up, before it is on; 5), `holdSeconds` (out of it before it is off; 30) and `sensor` (`true`). |
| `devices[].pollSeconds` | none | Ask the plug for its power this often, as well as listening for what it reports. See below. |
| `recordPower` | `true` | Write each reading to a file per day under `appliance-monitor/power/`. The Curve tab needs it. |
| `recordDays` | `14` | How many days of those files to keep. |
| `matterLogLevel` | `warn` | How much of matter.js's own logging to show. |

## Files

All files are kept in the Homebridge storage folder, under `appliance-monitor/`:

- `matter/`: the controller's fabric, certificates and what it knows about
  the plugs. Deleting it unpairs everything, as far as the plugin is concerned.
- `nodes.json`: which configured name is which Matter node.
- `devices.json`: what each appliance has learned, and the state it is in, so
  that Finished survives a restart. Remove an appliance's `learned` entry
  (with the child bridge stopped) to have it learn afresh.
- `energy.json`: watt-hours per plug and day, for the Statistics tab. Written
  every five minutes. Plugs removed from the config keep their history here.
- `power/`: one file per day, `time,device,endpoint,watts`, one line per
  reading. Older than `recordDays` is deleted.

## The log

On each start, one line per plug: what it is, what it draws, its state, and
whether it has learned yet. Everything a plug offers is listed once, when it
is paired. After that the log has the changes: Running, Finished, Off, each
phase starting and ending, what was learned, and a plug that became
unreachable or came back. The single readings are in the recordings, not in
the log.

matter.js warns on every start about the test vendor ID `0xFFF1` (see above),
about Bluetooth not being enabled, and, when pairing, about not checking the
plug's certificates against the Matter ledger. All of it is expected for a
controller like this one, so it only shows with Homebridge's debug logging.

## Licence

MIT
