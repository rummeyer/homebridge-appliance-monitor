# homebridge-outlet-monitor

Watches the power draw of **Matter smart plugs and power meters** so that
HomeKit can tell when the washing machine is running and when it is done.
Built for the **Eve Energy** and the **Shelly Plug PM Gen3** (a meter without a
relay), and meant for any Matter device the Home app shows watts for.

> **Status: first stage.** The plugin pairs the plugs, lists what they offer,
> and logs and records their power draw. The state machine and the HomeKit
> sensors come next, tuned on a recording of a real wash cycle.

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

The log says which endpoint reported. A device with more than one channel
measures each channel on its own endpoint.

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
   then its power readings. After that you can remove the code from the
   config.

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
    { "name": "Washing machine", "pairingCode": "3497-011-2332" }
  ],
  "recordPower": true,
  "matterLogLevel": "warn"
}
```

| Option | Default | |
| --- | --- | --- |
| `devices[].name` | — | Name in the log and the recording. |
| `devices[].pairingCode` | — | Setup code from the Home app, or an `MT:` QR payload. Only needed until paired. |
| `recordPower` | `true` | Append each reading to `outlet-monitor/power.csv`. |
| `matterLogLevel` | `warn` | How much of matter.js's own logging to show. |

## Files

All files are kept in the Homebridge storage folder, under `outlet-monitor/`:

- `matter/`: the controller's fabric, certificates and what it knows about
  the plugs. Deleting it unpairs everything, as far as the plugin is concerned.
- `nodes.json`: which configured name is which Matter node.
- `power.csv`: `time,device,endpoint,watts`, one line per reading.

On every start, matter.js logs warnings about the test vendor ID `0xFFF1` (see
above) and about Bluetooth not being enabled. Both are expected: a hobby
controller has no vendor ID of its own, and pairing here never uses Bluetooth.

## Licence

MIT
