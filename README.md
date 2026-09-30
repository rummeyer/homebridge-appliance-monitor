# homebridge-outlet-monitor

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

- the **level the machine rests at** when it is on but not working, and from it
  the **running level**, clearly above;
- the **longest pause** inside the programme, a soak or a cool-down, and from
  it how long a quiet spell has to last before it is the end (the pause and
  half again, at least two minutes);
- the **off level**, halfway between resting and switched off.

From then on Finished comes minutes after the end. Every further cycle
refines this, and a longer pause only ever lengthens the wait. If a cycle
does turn out to have ended too early (the machine runs again within ten
minutes), the plugin logs it, treats it as one cycle and learns the pause.

What was learned is logged and kept in `outlet-monitor/devices.json`. Any
threshold can be fixed in the settings instead, each on its own; the rest are
still learned.

## In the Home app

Each appliance is one accessory with two sensors:

- **Running**: an occupancy sensor, occupied while the appliance runs.
- **Finished**: a contact sensor, open while it is finished. The Home app can
  notify you when it opens, with no automation needed.

Both are on by default and can be turned off or renamed in the settings. The
default names are the appliance's name followed by "Running" and "Finished".
A rename in the Home app is kept. While a plug cannot be reached, its sensors
are shown as not responding.

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
**Matter Test**, not as Homebridge Outlet Monitor. The plugin does give the
plug that name (the fabric label, set again on every connection), but the Home
app appears to name other controllers by their vendor ID instead. This plugin
uses `0xFFF1`, the ID the Matter specification sets aside for testing and
self-built controllers, and the Home app shows that ID as "Matter Test".

A vendor ID of its own needs a membership of the Connectivity Standards
Alliance, and using another vendor's ID would pass the plugin off as someone
else's product. So the name stays. It changes nothing about how the plugin
works.

## Configuration

```json
{
  "platform": "OutletMonitor",
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
| `devices[].runningName` | `<name> Running` | Its name. |
| `devices[].finishedSensor` | `true` | Show the Finished contact sensor. |
| `devices[].finishedName` | `<name> Finished` | Its name. |
| `devices[].finishedReset` | `off-level` | Finished goes back to Off: `off-level` when switched off, `timeout` after a set time, `next-start` only when it runs again. |
| `devices[].finishedResetMinutes` | `60` | The time for `timeout`. |
| `devices[].thresholds.runWatts` | learned | Running above this, in W. |
| `devices[].thresholds.offWatts` | learned | Switched off at or below this, in W. |
| `devices[].thresholds.startSeconds` | `60` | Seconds above the running level, added up, before it counts as running. |
| `devices[].thresholds.finishSeconds` | learned | Seconds of quiet before it counts as finished. |
| `recordPower` | `true` | Append each reading to `outlet-monitor/power.csv`. |
| `matterLogLevel` | `warn` | How much of matter.js's own logging to show. |

## Files

All files are kept in the Homebridge storage folder, under `outlet-monitor/`:

- `matter/`: the controller's fabric, certificates and what it knows about
  the plugs. Deleting it unpairs everything, as far as the plugin is concerned.
- `nodes.json`: which configured name is which Matter node.
- `devices.json`: what each appliance has learned, and the state it is in, so
  that Finished survives a restart. Remove an appliance's `learned` entry
  (with the child bridge stopped) to have it learn afresh.
- `power.csv`: `time,device,endpoint,watts`, one line per reading.

On every start, matter.js logs warnings about the test vendor ID `0xFFF1` (see
above) and about Bluetooth not being enabled. Both are expected: a hobby
controller has no vendor ID of its own, and pairing here never uses Bluetooth.

## Licence

MIT
