// Appliance Monitor: a coffee machine's heating up on a Shelly plug's LED
// ring. Red while it heats up, green once it is heated, off while the plug
// is switched off.
//
// Heated is a thermometer at PREHEATED or more, as the AWTRIX NG ShotTimer
// has it. Without one, or with one that has said nothing for QUIET_S, it is
// the heating phase having ended since the machine was switched on. Once
// green it stays green until the plug is switched off.
//
// Needs MQTT on the Shelly, on the broker Appliance Monitor publishes to.

let APPLIANCE = "appliance-monitor/Kaffeemaschine";
let HEATING_PHASE = "Aufheizen";
let TEMPERATURE = "deconz/Kaffeemaschine/temperature"; // "" for none
let PREHEATED = 38;
let QUIET_S = 15 * 60;
let RED = [100, 0, 0];
let GREEN = [0, 100, 0];

let temperature = null;
let temperatureAt = null;
let heating = false;
let heatingEnded = false;
let heated = false;
let shown = null;

function uptime() {
  return Shelly.getComponentStatus("sys").uptime;
}

function isOn() {
  return Shelly.getComponentStatus("switch", 0).output === true;
}

function setColour(rgb) {
  if (shown !== rgb) {
    shown = rgb;
    Shelly.call("PLUGS_UI.SetConfig", { config: { leds: { colors: { "switch:0": { on: { rgb: rgb } } } } } });
  }
}

function show() {
  // Off: red in waiting, so that switching on shows no green from before.
  if (!isOn()) {
    setColour(RED);
    return;
  }
  let quiet = temperature === null || uptime() - temperatureAt > QUIET_S;
  if ((temperature !== null && temperature >= PREHEATED) || (heatingEnded && quiet)) {
    heated = true;
  }
  setColour(heated ? GREEN : RED);
}

// The ring follows the relay by itself; off is dark.
Shelly.call("PLUGS_UI.SetConfig", { config: { leds: { mode: "switch", colors: { "switch:0": { off: { brightness: 0 } } } } } });

MQTT.subscribe(APPLIANCE + "/phase/" + HEATING_PHASE, function (topic, message) {
  // Only an end seen after its start: on subscribing, the last OFF comes too.
  if (message === "ON") {
    heating = true;
  } else if (message === "OFF" && heating && isOn()) {
    heatingEnded = true;
  }
  show();
});

if (TEMPERATURE !== "") {
  MQTT.subscribe(TEMPERATURE, function (topic, message) {
    let value = Number(message);
    if (message !== "" && !isNaN(value)) {
      temperature = value;
      temperatureAt = uptime();
      show();
    }
  });
}

// Switched on: heating up again, unless the thermometer says otherwise.
Shelly.addStatusHandler(function (event) {
  if (event.component === "switch:0" && event.delta.output !== undefined) {
    heating = false;
    heatingEnded = false;
    heated = false;
    temperatureAt = temperature === null ? null : uptime();
    show();
  }
});

// Now and then, for the thermometer going quiet.
Timer.set(30000, true, show);
show();
