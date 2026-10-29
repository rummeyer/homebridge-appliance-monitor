<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/icon.png" alt="" width="120" height="120">
</p>

<h1 align="center">homebridge-appliance-monitor</h1>

<p align="center">
  Your <b>washing machine, dryer and coffee machine</b> in the Apple Home app &mdash; <b>Running</b> or done, from their power draw through Matter smart plugs.
</p>

<p align="center">
  <a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins"><img src="https://img.shields.io/badge/_-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge" alt="Verified by Homebridge"></a>
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
meant for any Matter device the Home app shows watts for: also a light that
reports its own draw, such as the Dyson Solarcycle Morph through
[homebridge-dyson-solarcycle-morph](https://github.com/rummeyer/homebridge-dyson-solarcycle-morph).
A plug that publishes its power over MQTT, such as a Shelly Plug S Gen3
whose Matter side has no power reading, works too: see
[Readings over MQTT](#readings-over-mqtt).

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

What it measures goes to HomeKit, and, if you want, to a read-only
[dashboard](#dashboard) in the browser and to an [MQTT](#mqtt) broker, for a
display, Node-RED or Home Assistant.

What it needs is **ActivePower** (in milliwatts) from the standard
**Electrical Power Measurement** cluster (`0x0090`). That is where the Home app
reads its watts from, so a device that shows watts in the Home app without
Homebridge has it. On a plug with a relay it also listens to the standard
**On/Off** cluster (`0x0006`), to see the plug being switched off. There is
nothing vendor-specific. A plug read over [MQTT](#readings-over-mqtt) is not
paired at all; the plugin listens to the topic it publishes to.

## Requirements

- Homebridge 2 on Node.js 22, 24 or 26.
- **Run it as a child bridge.** matter.js keeps process-wide state, and
  Homebridge 2 can load matter.js itself. In the Homebridge UI, open the
  plugin's menu (⋮) → **Bridge Settings**, turn the child bridge on, and
  restart Homebridge.
- **The plugs set up in the Apple Home app**, which shows their watts. The
  plugin joins them as a second controller; they stay in Apple Home. A plug read
  over [MQTT](#readings-over-mqtt) needs an MQTT broker instead.
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
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/settings-light.png" alt="The Settings tab: an appliance picked from the list, with where its readings come from (here an MQTT topic, with its online topic and keys), its dashboard icon, Part of, how it shows in HomeKit, its Overtime time, on a line of its own its Idle time and what it counts from, and under More its phases, with what each counts, and the thresholds it learned" width="760">
</picture>

A paired plug is remembered by its name, so renaming it means pairing it
again. Remove the old pairing from the Home app first, under the plug's
connected services.

To give an appliance another plug, put the new plug's code in place of the
old one and restart: the new plug is paired, and the old pairing let go only
once that worked. A plug that was another appliance's before, and is paired
already, is found too: the log then says which node it was. A plug read over
MQTT is set up with **Readings from** instead; see
[Readings over MQTT](#readings-over-mqtt).

### Behind a Matter bridge

A Matter bridge — homebridge-shelly-matter, say, with several metering
Shellys behind it — is paired once and carries many devices. So is a plug
with several channels, each measuring on its own endpoint. Without a choice,
every reading of the node would count towards one appliance; so each
appliance chooses its device.

1. **Get the bridge's pairing code.** If the bridge is already in the Home
   app, use **Turn On Pairing Mode** on it there, as for a plug. If it is
   not, use its own setup code: for a Homebridge Matter bridge, in the
   bridge's settings in the Homebridge UI, or in the log, under *Matter
   commissioning information*. The log lists such a code for every Matter
   bridge and accessory Homebridge runs, so take the one under the right
   name. A bridge only for this plugin need not be in the Home app at all;
   one that is shows its devices there as well, as tiles of their own.
2. **Pair it with one appliance:** **+ Add**, a name, the code, save, and
   restart the child bridge. The log shows `paired as node …`, then what
   measures power behind the bridge, by name, endpoint and UniqueID, and a
   warning that all of it counts as one appliance until a device is chosen.
3. **Choose the devices.** Reopen the plugin settings: the appliance now
   has a **Device** field listing them. Choose its own. For each further
   device, **+ Add** an appliance, set **Readings from** to *Matter via*
   the first one — no code of its own — and choose its **Device**. Save, and
   restart the child bridge once more.
4. The log now says, for each, `follows <device> (endpoint …, id …)`. An
   appliance whose device is not found says so, with the list to choose
   from, and counts nothing rather than everything.

The choice is kept by the bridged device's UniqueID, which stays when the
bridge renumbers its endpoints; a device without one is chosen by endpoint
number. The fields appear only where more than one device measures power,
so a plain plug shows none of this. In config.json, `"pairedWith"` names the
appliance that paired the bridge, and `"deviceId"` is the UniqueID as the
log shows it — Homebridge makes up random ones — or `"endpoint"` the number:

```json
"devices": [
  { "name": "Waschmaschine", "pairingCode": "3497-011-2332", "deviceId": "Qk2v8RfJpX0aLm3TzN7cYw5uHd1eGbSo" },
  { "name": "Trockner", "pairedWith": "Waschmaschine", "deviceId": "Vt9hB4xMnK6pZq2RjL8wEy0sFa3cUdGi" }
]
```

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

In HomeKit, Running is a switch that is on while the appliance runs, an
outlet if you prefer its icon, or an occupancy sensor for a desk. It goes off only when the appliance finishes, so
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
element switched by a thermostat goes on and off every few seconds. A plug
that is unreachable, or has its relay switched off, counts as out of every
range: a standby phase from 0 W is not on while nothing is known, nor while
the plug reports 0 W because it is switched off.

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
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/power-light.png" alt="The Power tab: a coffee machine's power over twelve hours, with its phases Aufheizen, Bezug, Spülen, Pumpe and Milchschaum and a bar for each showing when it was on; below, each phase in one line — Bezug, Spülen and Pumpe counting by difference — and the MQTT messages for the shot timer" width="760">
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
a phase with **Shorter than** goes on for a moment then, three seconds after
the draw fell below the range, rather than while it lasts. "On after" counts
the draw's time in the range; "Shorter than" the time from it entering the
range to falling below, so a moment above it — the heater beside the pump —
does not make a coffee a rinse. Give both phases the same "off after", so
they see the same draws.

A phase that is not on yet forgets the draw making it once the draw has been
below the range for three seconds. A plug that reads every second shows a
rinse just before the coffee, or one reading in the range as a heater
switches off, apart from the coffee after them.

### What a phase counts

Most phases count every draw in their range. Two kinds of appliance need
more, and **Counts** beside each phase says which:

| Counts | | For |
|---|---|---|
| **Always** | every draw in the range | most phases |
| **Coming down** | only a draw that comes **down** into the range, not one that rises into it | a rest after a run: a washing machine done, not one just switched on |
| **By difference** | also a draw **hidden under something bigger**, seen as the difference it makes, over when that is gone | a pump under a heater: a coffee or a rinse |

#### Coming down: a rest after a run

Some differ by the direction the draw came from. A washing machine that has
finished rests at a few watts, and so does one just switched on to be
loaded: one came down from the wash, the other up from nothing. With
**Counts: Coming down** a phase counts only the first:

| Phase | Range | On after | Counts |
|---|---|---|---|
| Gewaschen | 2–4.5 W | 25 s | Coming down |

When the draw rises into the range (0 W → 3 W, the machine switched on), the
phase stays off until the draw has left the range again. When it falls into
it (20 W → 3 W, the wash over), the phase goes on as usual. After a restart
the plugin looks up in the recording of the last 12 hours where the draw came
from, so a machine standing there to be loaded does not count as done just
because Homebridge restarted. If there is nothing to look up there (no
recording, or nothing in the last 12 hours), the phase does count: a false
alarm is better than none. A draw that dips above the range and back, a
door lock or a display lighting up while the machine is loaded, also counts
as from above. The chart on the Power tab shows the phase the same way.

#### By difference: something running under something bigger

Sometimes what a phase is about runs hidden under something drawing much
more. A coffee machine's pump draws about 55 W — but while it runs, the
heater often comes on beside it at 1200 W, and the plug then reads 1270 W:
far above the pump's range, though the pump has not stopped. With
**Counts: By difference** a phase reads the draw as the pump does — the pump
seen as the difference it makes:

- **Above the range, it is still on.** The time counts towards "on after",
  and it does not end the phase.
- **It is over when its difference is gone** — whichever way the pump stops:
  - the draw falls **below the range**, for three seconds, as to the few watts
    of keeping warm; or
  - **above the range, it steps down by about the range's lower end** — the
    pump's 55 W gone from 1270, though the heater runs on at 1212. A step
    down by much more is something else stopping: the steam closed while the
    pump runs on.
- **It may start beside something else too.** Above the range, a **step up by
  as much as the range** from one level to the next is the pump starting
  beside what was running already — a coffee drawn while the milk froths, the
  steam at 497 W and the pump taking it to 553.
- **Back at what the heater draws alone, it has stopped.** The heater's own
  level is remembered from its last burst from rest: should the draw settle
  there again while the pump counts, the pump stopped beneath it on the way,
  though heater and pump were never a level together.
- **Started unseen, it is still seen as it stops.** A pump that started at
  the same moment as something else — a rinse as the steam is opened — shows
  only as its step down. It is then counted from the move into the level it
  stopped beneath, and is on and over in one go: the shot timer told its time
  at the end.
- **The heater alone is not the pump.** Time above the range counts only once
  the draw has been in the range on its own for two seconds, or after a step
  up by as much as the range: a heater warming up passes through it in a
  single reading on its way up, and steps by far more.

A level is two readings within 15 W of each other, or one that holds for two
seconds: a plug that averages over a second reads half the heater as it comes
on, a moment on the way and not a level. It wants a plug that reports about
every second, as a Shelly does. With a plug that reports only every few
seconds, as an Eve Energy does, choose **Always**: its readings are averages
over those seconds, and the steps By difference looks for are lost in them.

A rinse and then a coffee, as the plug read them one morning:

| | Pump alone | Pump and heater | Heater alone | Measured |
|---|---|---|---|---|
| Rinse | 58 W, 5 s | 1270 W, 6 s | 1212 W, 8 s | **10 s** — the pump, not the heater after it |
| Coffee | 57 W, 8 s | 1270 W, 7 s | – | **21 s**, the pump on alone after the heater |

So "on after" and "shorter than" measure the same thing — the pump from
start to stop — and two phases in the same range split every draw at one
time: a coffee *on after* 15 s and a rinse *shorter than* 15 s are one or the
other, never both and never neither. Choose it for both, and for a phase a
shot timer follows. Not for heating: its thermostat drops below the range while
it lasts, which is not the end of it.

## In the Home app

Each appliance is one accessory, "Washing machine Monitor" say, to tell it
apart from the plug's own accessory, with a switch for each thing it can
tell, to hang automations on:

- **Running**: on while the appliance runs, and off once it has finished,
  never before. An automation "when Washing machine Running turns off" runs
  once per cycle, when it is done: a notification, a light, an announcement
  on the HomePod. For a desk, Running can be an **occupancy sensor**
  instead: taken while it draws power, free when not. Or an **outlet**, on
  and in use while the appliance runs, for the outlet's icon. Switch and
  outlet only show: tapping one switches nothing, and it goes back.
  Do not put the Running outlet into a group with the real plug in the Home
  app: the group shows on whenever the plug is, which is always, and tapping
  the group switches the real plug off, mid-cycle.
- **One switch per phase**: on while the phase lasts, "Bezug"
  say, or for a moment once it is over, for a phase with "shorter than".
- **Overtime**, if set: an occupancy sensor that turns on once the
  appliance has been running for a given time in one go — a TV on all
  night, more than ten hours at a desk — and off when it finishes. Set
  **Overtime after** under **In HomeKit** in the settings
  (`overtimeMinutes`; 1.7.0's `leftOnMinutes` still works, and its Left On
  sensor becomes Overtime with its automations).
- **Idle**, if set: an occupancy sensor that turns on once the
  appliance has not run for a given time, whatever it draws — a PC
  asleep, a TV in standby, at 1 W or at 0 W — and off when it runs again
  or the plug's relay is switched off. Set **Idle after**
  (`idleOnMinutes`; until 1.12 the sensor was called Idle On, and one
  still so called is renamed, with its automations). On a plug without
  a relay, such as the Shelly Plug PM, it stays on until the appliance runs
  again. A part counts as running while what it is part of runs, so a
  desk lamp is not idle while the desk is in use.

  An appliance that keeps itself warm, as a coffee machine does, never
  stops running while it is on. For one with phases, Idle can count
  from the end of a phase instead: **Idle counted from** **End of
  Bezug** (`idleOnFrom`) turns it on 10 minutes, say, after the last
  coffee drawn, whether the machine still keeps warm or has switched
  itself off — and off with the next coffee, or once the plug is switched
  off. While another of its phases is on, such as heating up or frothing
  milk, Idle waits, and counts again from when that ends: a machine that
  pumps for a moment as it is switched on is not switched off while it
  heats up.

  Turn on the notifications of either in the Home app.

  Either can also **switch the appliance off**, by a Home app automation
  that turns off the plug itself, which is in the Home app too: **When
  "Kaffeemaschine Idle" detects occupancy**, turn off the Kaffeemaschine
  plug — an hour after the last coffee, with **Idle after** 60 and
  counted from **End of Bezug**. Idle counts only once a coffee has
  been drawn, so a machine still heating up is left alone. For one
  switched on and then forgotten, with no coffee at all, add Overtime the
  same way: **When "Kaffeemaschine Overtime" detects occupancy**, turn it
  off — after two hours on, say, whatever happened. A TV the same way with
  Idle alone: **When "Fernseher Idle" detects occupancy**, turn off the
  Fernseher plug, 30 minutes after it was last watched, in standby or not.

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
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/stats-light.png" alt="The Statistics tab: energy per appliance today, last week and last month, with the bubble open on the Kaffeemaschine — its last cycle, and overall its estimated duration, count and standby; two lamps that are part of another appliance indented in italics under it" width="760">
</picture>

Today counts from a plug's first reading of the day, so a plug added at noon
shows its afternoon. A week, a month or a year a plug joined partway through
is shown from the day it was added: a plug added on Wednesday 30 September
2026 shows the 30th as last month, Wednesday to Sunday as last week, and,
from 1 January 2027, 30 September to 31 December as last year. Where some
plugs have a value and others do not yet, the total adds up those that have.
The tables do not mark either; keep it in mind for a plug added recently. A period no plug has
a figure for yet, Last Year in the first year, is left out until one has.

**What it cost.** With **Pricing** on under **General** and a **Price per
kWh** set — in cents, 28.56 for 28.56 ct — each value has its cost after it: *4.54 kWh (1.30 EUR)*.
A **Base fee per month** adds two lines under the total: the fee's share of
each period — a day's, a week's, the month, twelve for the year, a day
being a twelfth of 365 days of a year — and the **Total cost** with it.
**Currency** is written after each amount, EUR if left empty.

**A changed price** holds from the day after Homebridge restarts with it;
what was used until then keeps the price it had. Nothing to set for it: the
plugin notes each price it starts with in `prices.json`, next to its other
data, and prices each day at the price that held then — the fee too, each
day its share. Changed twice in a day, the last counts. The first price of
all holds from the first day anything was recorded. **General** lists the prices
noted so far, and says when a change is waiting to be noted.

**Sorted by a column.** The table begins sorted by name, from A to Z. A
click on a column's header sorts by it: a period with the biggest first, to
find what used the most last week; the names from A. Another click turns it
round. An appliance's parts stay right under it, sorted among themselves. The browser keeps the choice for the next visit; the dashboard
sorts the same way.

**Something measured twice** is counted once. A lamp that reports its own
watts over Matter, plugged into a metered socket strip that is an appliance
here too, is in the strip's figures already. Set the lamp's **Part of** to
the strip: it keeps its own row, right under the strip's, indented and in
italics (several parts by name), and its own tile, but the total in the
table, the Total tile and the Total chart leave it out. While the strip is
switched off or draws nothing, the lamp draws nothing either, whatever its
own meter last said — some report their last few tenths of a watt on after
losing power; once the strip draws again, the lamp's own reading counts
again. Chains work too, a lamp in a strip in a room meter. A **Part of** naming no appliance, or leading back round to the
one it is set on, is ignored with a warning in the log, and the appliance is
counted.

Two Dyson lamps, say, behind one Homebridge Matter bridge, both plugged into
a metered desk socket that is an appliance of its own:

```json
"devices": [
  { "name": "Desk", "pairingCode": "MT:Y.K9042C00KA0648G00" },
  { "name": "Desk Lamp", "pairingCode": "3497-011-2332", "deviceId": "Qk2v8RfJpX0aLm3TzN7cYw5uHd1eGbSo", "partOf": "Desk" },
  { "name": "Reading Lamp", "pairedWith": "Desk Lamp", "deviceId": "Vt9hB4xMnK6pZq2RjL8wEy0sFa3cUdGi", "partOf": "Desk" }
]
```

The settings page has it as **Part of**, under the appliance's name and
pairing; it lists the other appliances.

The columns are what adds up to a total. What is only the appliance's own
shows in a bubble on pointing anywhere in its row, or tapping it on a
phone. Under **Last cycle**:

- **Energy**: what it used in its last cycle, from the moment it counted as
  running to the moment it finished.
- **Running**: how long that cycle ran.
- **Finished**: when it finished.

A dash stands for each until the first cycle. Under **Overall**:

- **Estimated duration**: how long its cycles usually take, as on the
  dashboard's tiles: the median of the last 20, if most of them are close
  to it. A washing machine on quick and long programmes has none taken all
  together, but one per programme, told apart by how its cycles start —
  "about 1 h 28 min or 3 h 16 min". Where lengths are all over the place,
  as at a desk or a coffee machine used for a quarter of an hour or two, it
  shows their median, "median 45 min, lengths vary" — the median rather
  than the average, so that one session left on overnight does not pull it
  far off. The dashboard does not count down from that. Until the second
  cycle it is "still learning · 1 of 2 cycles".
- **Count**: how often it finished a cycle — or, if one of its phases is
  ticked **Count** on the Power tab, how often that phase happened: coffees
  drawn rather than mornings the machine was on. If several are ticked, the
  first counts. Every finished cycle and every phase is counted all along,
  so ticking another phase shows its count from when the phase was set up,
  not from when it was ticked.
- **Standby**: how much of what it used went on while it was not running —
  standby, or resting between uses — as a share, and what that comes to in
  a year at the same rate. It is worked out from the last 30 days, or from
  when it began to be counted (from 1.7.0 on, and again after a reset), and
  shows once an hour has been counted. A TV at 60 % that comes to 20 kWh a
  year is a plug worth switching off at night. The **Total** row has it
  for all appliances together. A part counts standby only while what it
  is part of is not running either: a desk lamp's standby is then always
  within the desk's.

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

## Dashboard

A web page with every appliance at a glance, for a tablet on the wall or a
phone on the sofa, without logging in to Homebridge. It opens in the **Home**
look, after Apple's Home app:

<img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/dashboard-home.png" alt="The dashboard in the Home look: square glass tiles on a warm wallpaper, each with its icon — a fan, a washing machine, a dryer, a desk, a computer, a coffee machine, a TV and more — Electricity with what all plugs draw together, the running Fernseher as a white tile, two lamps marked as part of another appliance, the power chart of all plugs and the statistics" width="760">

- a tile per appliance with what it draws **now**, whether it is running and
  for how long, what the cycle has used so far, and the phases it is in;
  for one whose cycles usually take about as long, **how long it has
  left** — after two cycles of about the same length. Each cycle's first
  ten minutes are kept with its length, and from a running cycle's third
  minute on only the cycles that started alike count: a washing machine
  that heats straight away is on its quick programme, one that turns the
  drum first on its long one, and it knows which after a few washes of
  each. A start not seen before, or a desk, whose cycles start alike but
  last any time, has no usual length and shows its peak instead.
  **Overtime** and **Idle** are marked too. An unreachable plug's tile says
  **Unreachable** and shows – rather than what it drew last;
- a tile with what all plugs draw together — **Electricity** in the Home
  look, as the Home app calls it, and **Total** in light and dark, without
  unreachable plugs;
- the **power chart** of all plugs together, or of the appliance picked —
  click its tile, or pick it from the list. It opens on all plugs and the
  last 6 hours; the plug and the time picked are kept for the next visit,
  in this browser;
- the **statistics**, as on the Statistics tab.

It updates itself every few seconds. On a phone, the tiles are two side by
side:

<img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/dashboard-home-phone.png" alt="The Home look on a phone: two tiles side by side, each with its icon" width="300">

### Home, light and dark

The button at the top right switches the look, round the three:

| Button | Look |
| --- | --- |
| house | **Home**, as Apple's Home app: square glass tiles on a wallpaper, a white tile for what is running, titled *Home*, with a house as the browser tab's icon |
| sun | **Light** |
| moon | **Dark** |

In the Home look each tile has an icon in a circle, as the Home app has.
An outlet unless another is picked as **Icon**, under the appliance's name
in the settings (`icon`): 64 others, in groups — a washing machine, a
dryer, a TV, a coffee machine, a desk lamp, a computer, a car charger and
so on. They are only for the dashboard; HomeKit shows the appliance as
before.

The page opens in Home. A browser that was switched to light or dark keeps
it on the next visit, until it is switched back. Without JavaScript the page
follows the system's light or dark mode.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/dashboard-dark.png">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-appliance-monitor/main/docs/screenshots/dashboard-light.png" alt="The dashboard in the light look, or the dark one where GitHub is dark: a tile per appliance with its power now, a Total tile, the power chart of all plugs, and the statistics table" width="760">
</picture>

### Turning it on

The plugin serves the page itself. It is off until switched on:

1. On the plugin's settings page, open **General** and tick **Dashboard**.
   It is on port 8582 unless **Dashboard port** says otherwise (any free
   port; the Homebridge UI itself is usually on 8581). In config.json this is
   `"dashboard": true`, and `"dashboardPort": 8582` for another port.
2. Save, and **restart the child bridge** in the Homebridge UI — the plugin
   only reads its settings when it starts.
3. Open `http://<your Homebridge machine>:8582/`, for example
   `http://raspberrypi.local:8582/`.

The log says `Dashboard on port 8582` when it is up. If the port is taken,
the log says so, and the plugin runs on without the dashboard. Untick
**Dashboard** and restart to turn it off again.

### Read only, and no login

Nothing can be changed on the page: it has no settings, no learning and no
resetting, and the plugin answers nothing but reading there. It also has no
login, so anyone who can reach the port can see your appliances and what
they use. Keep it on your home network, and do not forward the port to the
internet.

## MQTT

The plugin can also publish each appliance's state to an MQTT broker, such
as Mosquitto, for whatever else listens on your network: a pixel display
such as an AWTRIX clock, Node-RED, Home Assistant. Nothing sent to it
changes anything; what it listens to is the readings of a plug that
publishes them itself, see [Readings over MQTT](#readings-over-mqtt).

| Topic | Value |
|---|---|
| `appliance-monitor/status` | `online`, or `offline` once the plugin is gone |
| `appliance-monitor/<name>/state` | `running` or `idle` |
| `appliance-monitor/<name>/since` | when that state began, in Unix seconds: `1792481235`; running, when the draw rose |
| `appliance-monitor/<name>/watts` | what it draws, to a tenth of a watt: `14.9` |
| `appliance-monitor/<name>/reachable` | `true` or `false`; while `false`, `watts` is the last reading |
| `appliance-monitor/<name>/relay` | `ON` or `OFF`, how the plug is switched, for a plug with a relay once it has said |
| `appliance-monitor/<name>/phase/<phase>` | `ON` or `OFF`, for each phase; a phase with "shorter than" is `ON` for a moment once it is over |
| `appliance-monitor/<name>/phase/<phase>/until` | while the phase is on, when the draw fell below its range, in Unix seconds — at once, before its "off after" is over; empty while the draw is in it or above, or the phase is off |
| `appliance-monitor/<name>/overtime` | `ON` or `OFF`, if Overtime is set |
| `appliance-monitor/<name>/overtime/at` | when Overtime turns on (or did), in Unix seconds; empty while it is not counting |
| `appliance-monitor/<name>/idle` | `ON` or `OFF`, if Idle is set |
| `appliance-monitor/<name>/idle/at` | the same for Idle: with a Home automation switching the plug off on Idle, when it goes off |

Every value is retained, so a listener that connects later has the current
ones at once, and sent only when it changes. `<name>` is the appliance's
name as in the settings, with any `/`, `+` or `#` in it turned into `_`:
`appliance-monitor/Kaffeemaschine/phase/Bezug`.

To turn it on, open **General** on the plugin's settings page, tick
**MQTT**, and restart the child bridge. The broker is `mqtt://localhost:1883`
unless **MQTT broker** says otherwise; a login goes in the address,
`mqtt://user:password@host:1883`, and is never written to the log.
**MQTT topic prefix** replaces `appliance-monitor`. If the broker is not
there, the plugin runs on, says so once, and tries again every 10 seconds.

### Messages of your own

The plugin can also send a message of your own, to any topic, when a phase
starts or ends: a notification on a pixel clock when the coffee is done, say.
Add them on the **Power** tab, under **MQTT messages** below the phases, one
line each: the phase, whether it starts or ends, the topic, and the payload.
In the payload, these are filled in:

| Placeholder | |
|---|---|
| `{appliance}` | the appliance's name |
| `{phase}` | the phase's name |
| `{duration}` | how long the draw was in the range, as on a clock: `0:23`, `12:05`, `1:02:05` |
| `{seconds}` | the same in seconds: `23` |

The duration runs from the draw entering the range to it falling below it:
without the "off after" the phase waits before going off, and with any
moment out of the range in between. A draw above the range at the end
still counts, as a coffee machine's heater coming on beside the pump; one
that stays above until the phase goes off ends where it left the range. At the start it is the time so far,
which is the "on after". A phase with "shorter than" is known only once it
is over, so its start and end messages go out together then.

For an [AWTRIX NG](https://blueforcer.github.io/awtrix-ng/) clock whose
MQTT prefix is `awtrix`, a notification of how long the pump ran:

| Phase | When | Topic | Payload |
|---|---|---|---|
| Pumpe | Ends | `awtrix/cmd/notify` | `{"text":"Pumpe {duration}","durationMs":5000}` |

Messages are sent once and not retained, and are lost while the broker is
away. They need MQTT switched on.

### A coffee machine on an AWTRIX NG clock

[extras/awtrix-ng](extras/awtrix-ng) has an app for an AWTRIX NG clock that
puts the topics above together for a coffee machine: heating up, how long
it has been on, when it is switched off, and a shot timer that counts while
the pump runs.
It is also on the [AWTRIX Hub](https://awtrix.de/script/n4Zx4bmvrpw8).

With a plug that reports only every few seconds, as an Eve Energy does, the
shot timer works too, the pump's phase counting **Always**: it starts once
the pump has been in its range for "on after" — with an Eve, within its six
seconds — and stops when "off after" is over, the hold that bridges the
heater coming on beside the pump, showing then how long the pump was in its
range. A Shelly, reporting every second, makes it start with the pump and
stop with it, to the second.

### Readings over MQTT

A plug that publishes its power over MQTT needs no Matter pairing: a
Shelly, whose Matter side may offer only its relay and no power reading
(the Plug S Gen3 does). On the **Settings** tab, set **Readings from** to
**MQTT topic** and give the topic, and the plugin listens to it instead.
The payload is a number of watts, or a JSON object with them under
**Watts key** (`apower`, a Shelly's) and the relay under **Relay key**
(`output`): `{"apower":1231.4,"output":true}`. An **Online topic** saying
`true`/`false` or `online`/`offline` tells when the plug is gone; a
Shelly's `<id>/online` does, set by the broker when it drops off. Without
one it counts as connected from its first reading. It needs MQTT switched
on, on the same broker.

A Shelly's own status messages, on `<id>/status/switch:0` once **Generic
status update over MQTT** is on, leave out small changes: a pump of 50 W
beside a heater of 1200 W never shows. [extras/shelly/power-mqtt.js](extras/shelly/power-mqtt.js)
is a script for the Shelly that asks every second and sends whatever
changed to `<id>/power`. In the Shelly's web UI, under **Scripts**, create
one, paste it in, save, start it and turn on **Run on startup**. Then:

| Readings from | Topic | Online topic |
|---|---|---|
| MQTT topic | `shellyplugsg3-…/power` | `shellyplugsg3-…/online` |

For a coffee machine on a Shelly with an LED ring, such as the Plug S Gen3,
[extras/shelly/heating-led.js](extras/shelly/heating-led.js) shows its heating
up there: red while it heats up, green once it is heated, dark while the plug
is off. Heated is a thermometer at 38 °C or more, read since switching on,
as on the AWTRIX NG clock. Without one, or one that has said nothing for 15
minutes, it is the heating phase having ended, or not having come on within
6 minutes for a machine switched on still warm. The topics and phase name
are at the top of the script.

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
| `devices[].pairingCode` | — | Setup code from the Home app, or an `MT:` QR payload. Needed to pair; kept, it lets the plug be renamed later. |
| `devices[].mqttTopic` | | Readings over MQTT instead of a pairing: the topic with the watts. See [Readings over MQTT](#readings-over-mqtt). |
| `devices[].mqttPowerKey` | `apower` | Where the watts are in a JSON payload; `a.b` for one inside another. |
| `devices[].mqttRelayKey` | `output` | Where the relay is, `true` while switched on. |
| `devices[].mqttOnlineTopic` | | A topic saying whether the plug is connected: `true`/`false` or `online`/`offline`. |
| `devices[].runningSwitch` | `true` | Running in HomeKit, on while the appliance runs. |
| `devices[].pairedWith` | | Another appliance whose pairing this one shares: a device behind a Matter bridge. See [Behind a Matter bridge](#behind-a-matter-bridge). |
| `devices[].deviceId` | | Which device behind the bridge it follows, by UniqueID. Without it, every reading of the node counts. |
| `devices[].endpoint` | | The same by endpoint number, for a device without UniqueID. |
| `devices[].icon` | `outlet` | The icon of its tile in the dashboard's Home look: `tv`, `washer`, `dryer`, `coffee`, `desk-lamp`, `computer` and others — the settings page lists them all. Not shown in HomeKit. |
| `devices[].partOf` | | Another appliance whose plug also measures this one. It keeps its own figures but stays out of the totals, and draws nothing while that one is off. See [Statistics](#statistics). |
| `devices[].runningAs` | `switch` | `switch`, `outlet` for the outlet's icon, or `occupancy` for an occupancy sensor (a desk, taken or free). Changing it replaces it in HomeKit, with any automation on it. |
| `devices[].overtimeMinutes` | none | An Overtime occupancy sensor, on once the appliance has been running this many minutes in one go. Read from `leftOnMinutes` too. See [In the Home app](#in-the-home-app). |
| `devices[].idleOnMinutes` | none | An Idle occupancy sensor, on once the appliance has not run for this many minutes, whatever it draws; off when it runs again or the plug's relay is switched off. See [In the Home app](#in-the-home-app). |
| `devices[].idleOnFrom` | none | A phase's name: Idle counts from the end of the last time that phase ran instead, held while another phase is on and counted again from its end. For an appliance that keeps itself warm. |
| `devices[].thresholds.runWatts` | learned | Running above this, in W. |
| `devices[].thresholds.startSeconds` | `60` | Seconds above the running level, added up, before it counts as running. |
| `devices[].thresholds.finishSeconds` | learned | Seconds of quiet before it counts as finished. |
| `devices[].phases` | none | Phases: `name`, `minWatts`, and optionally `count` (show it as the appliance's count on the Statistics tab), `maxWatts` (none for no upper end, as for heating), `minSeconds` (in the range, added up, before it is on; 5), `holdSeconds` (out of it before it is off; 30), `maxSeconds` (only draws shorter than this, from entering the range to falling below it; any; see [Phases](#phases)), `onDown` (*Counts: Coming down* — only when the draw falls into the range, not when it rises into it; `false`), `byDifference` (*Counts: By difference* — also while something bigger runs on top, started or stopped by a step of its size beside it, over when its difference is gone; see [By difference](#by-difference-something-running-under-something-bigger); `false`, read from `offOnDrop` and `offBelow` as 1.18 to 1.20 called it; not together with `onDown`) and `sensor` (its switch in HomeKit; `true`). |
| `devices[].messages` | none | MQTT messages of your own: `phase`, `when` (`start` or `end`), `topic` and `payload`, with `{appliance}`, `{phase}`, `{duration}` and `{seconds}` filled in. See [Messages of your own](#messages-of-your-own). |
| `devices[].pollSeconds` | none | Ask the plug for its power this often, as well as listening for what it reports; at least 2 (less is taken as 2). See [Plugs that report seldom](#plugs-that-report-seldom). |
| `recordPower` | `true` | Write each reading to a file per day under `appliance-monitor/power/`. The Power tab needs it. |
| `recordDays` | `14` | How many days of those files to keep, for the Power tab. The statistics do not need them. |
| `matterLogLevel` | `warn` | How much of matter.js's own logging to show. |
| `dashboard` | `false` | Serve a read-only page with the power and statistics, without login. See [Dashboard](#dashboard). |
| `dashboardPort` | `8582` | Its port. |
| `mqtt` | `false` | Publish each appliance's state to an MQTT broker. See [MQTT](#mqtt). |
| `mqttUrl` | `mqtt://localhost:1883` | The broker; a login goes in it, `mqtt://user:password@host:1883`. |
| `mqttPrefix` | `appliance-monitor` | The first level of every topic. |
| `pricing` | `false` | Show what the electricity cost on the statistics, from the three below. |
| `centsPerKwh` | none | What a kWh costs, in cents: the statistics show what each value cost. See [Statistics](#statistics). |
| `baseFeePerMonth` | none | The fixed fee per month: its share of each period under the total, and the total cost with it. |
| `currency` | `EUR` | Written after each amount. |

## Files

All files are kept in the Homebridge storage folder, under `appliance-monitor/`:

- `matter/`: the controller's fabric, certificates and what it knows about
  the plugs. Deleting it unpairs everything, as far as the plugin is concerned.
- `nodes.json`: which configured name is which Matter node, and the pairing
  code it was paired with.
- `endpoints.json`: what measures power behind each pairing, for choosing a
  device behind a bridge.
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
- **`not paired yet` in the log, or pairing fails after a rename.** A paired
  plug is remembered by its name, and by its pairing code if that was still in
  the settings when it was renamed: then it keeps its pairing and statistics
  under the new name. Without the code, give it its old name back, or pair it
  again.
- **`Paired but not configured: node …`.** A plug was renamed without its
  pairing code, or removed from the settings. Remove the plugin's pairing from
  the plug in the Home app, under its connected services.
- **Finished comes half an hour late.** Nothing has been learned yet: run the
  appliance once, or mark a cycle on the Power tab.
- **Finished never comes.** The appliance rests above the running level.
  Put the **Running** level under **More** → Thresholds between its standby
  and what it draws in use.
- **A setting changed in the config has no effect.** Restart the child
  bridge from the Homebridge UI; the plugin reads its config only on start.

## Licence

MIT. The dashboard's appliance icons, all but the outlet, are
[Material Symbols](https://github.com/google/material-design-icons) by
Google, under the Apache License 2.0; the dryer is put together from two of
them.
