# A coffee machine on an AWTRIX NG clock

`ShotTimer.be` is an app for an [AWTRIX NG](https://blueforcer.github.io/awtrix-ng/)
clock, a 52 × 16 Ulanzi TC002 or a 32 × 8 TC001. It shows what Appliance Monitor
knows about a coffee machine, from the plugin's [MQTT](../../README.md#mqtt)
topics:

| When | Line 1 | Line 2 |
|---|---|---|
| Heating up, until the first coffee | **HEATING**, heat waves over the cup | how long it has been on |
| Ready | how long it has been on (**ON**), every three seconds **HEATED** in red | when it is switched off (**OFF**), yellow in the last minute |
| The pump running | **SHOT** and the seconds, counted on the clock | **OFF** |
| After that, for 20 s | **SHOT** or **RINSE** and how long the pump ran, in green | **OFF** |

The shot takes over the display while it runs; the rest takes its turn in
the clock's rotation, and only while the machine is on. A coffee made while
it is still heating up ends the heating up: from then on line 2 is the
countdown to switching off.

On a TC001 the cup is 8 × 8 and there is one line beside it: the shot while
it runs and its result after, else the two lines taking turns every four
seconds, the one sliding down and the other coming up. Where a label and its
value do not both fit, the value stands alone.

## What it needs

**MQTT** switched on in Appliance Monitor, and the clock connected to the
same broker (its web UI, **Settings › MQTT**).

**Phases** on the coffee machine, set up on the Power tab. The app's
default topics use these names and a machine called `Kaffeemaschine`; every
topic can be set in the app's settings, under **Topics**.

| Phase | What | Example |
|---|---|---|
| Aufheizen | heating up | from 1000 W, on after 60 s |
| Pumpe | the pump, for a coffee or a rinse | 30–100 W, on after 1 s, off after 15 s |
| Spülen | a rinse: the pump for less than 10 s | 30–100 W, on after 2 s, shorter than 10 s |

**Optional: two MQTT messages** on the same machine, below the phases on the
Power tab, which start and end the shot timer with the plugin's own count:

| Phase | When | Topic | Payload |
|---|---|---|---|
| Pumpe | Starts | `shot-timer/start` | `{seconds}` |
| Pumpe | Ends | `shot-timer/end` | `{seconds}` |

Without them, leave **Shot start** and **Shot end** empty: the **Pump phase** topic then
starts and ends the shot, and the result is the clock's count. Set **Pump on
after** to the phase's "on after".

**When it is switched off** comes from the plugin's **Idle** and
**Overtime**: set them on the machine, and switch its plug off with a Home
automation on either. With Idle counted from the end of Pumpe, OFF shows
5:00 after each coffee and counts down; Overtime is the latest it can be.
Once the time is up, OFF stands alone in yellow until the plug is off — or
until the count starts again, when the pump ran just before.

**Optional: a thermometer** on the machine makes HEATED exact — heated is
whenever it is at least **Preheated from**, not once the heating phase has
ended. Any topic with degrees works; for a Zigbee sensor on a deCONZ gateway,
[deconz-mqtt](https://github.com/rummeyer/deconz-mqtt) publishes it as
`deconz/<name>/temperature`. Without one, leave **Temperature** empty.

## Installing

From the AWTRIX Hub: open [ShotTimer on the Hub](https://awtrix.de/script/n4Zx4bmvrpw8),
sign in, and press **Send to AWTRIX**. The clock's web UI then offers each
new version as an update.

By hand:

1. Open the clock's web UI, go to **Scripts**, and create a script called
   `ShotTimer`.
2. Paste [`ShotTimer.be`](ShotTimer.be) in and save.

Either way, press ⚙ on ShotTimer under **Apps** for its settings.

## Settings

**Topics**: each topic the app listens to, in full, so the machine, the
phases and the broker's prefix can be called anything. An empty one is not
listened to. `…` is `appliance-monitor/Kaffeemaschine`.

| Topic | Default | |
|---|---|---|
| State | `…/state` | |
| Since | `…/since` | |
| Watts | `…/watts` | Empty: the shot's count runs until the pump's end. |
| Heating phase | `…/phase/Aufheizen` | |
| Rinse phase | `…/phase/Spülen` | A pump run that turns out to be this phase shows as RINSE. |
| Idle at | `…/idle/at` | |
| Overtime at | `…/overtime/at` | |
| Shot start | `shot-timer/start` | Where the two messages above go. With either empty, the pump phase starts and ends the shot. |
| Shot end | `shot-timer/end` | |
| Pump phase | `…/phase/Pumpe` | Used without both shot topics. |
| Temperature | `deconz/Kaffeemaschine/temperature` | |

Version 4.0 brought these in place of the appliance topic and the phases'
names: after updating from an earlier one, set them again where yours differ.

| Setting | Default | |
|---|---|---|
| Pump on after | 1 s | The pump phase's "on after", used without both shot topics. |
| Preheated from | 38 °C | |
| Pump off below | 30 W | The count stops as soon as the plug reads less: neither pump nor heater runs. |
| Plug delay | 5 s | The Eve Energy reports an average over 6 seconds, so the pump started that much before the plugin saw it. 0 for a plug that reports at once. |
| Show result for | 20 s | |
| Stay on screen while on | off | On: the app holds the display the whole time the machine is on. |
| Colours | | Result, heating, heated. The cup is drawn as it is. |

## How exact it is

The count runs on the clock, every second. It starts when the plugin
first sees the pump, set back by the plug delay, and stops as soon as the
plug reads less than **Pump off below**. When the phase ends, the plugin's
own count — from the draw entering the pump's range to it last leaving it
— replaces it. Without the two messages the clock's count stays: it hangs on
when the plug's readings come, so it can be a few seconds off.

The heater often runs beside the pump during a coffee; the plug then reads
both together, about 1200 W, so the count goes on through it. A rinse right
before the heater starts looks the same, and its count runs on until the
phase ends and the plugin's shorter result replaces it.
