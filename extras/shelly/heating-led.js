// Appliance Monitor: a coffee machine's heating up on a Shelly plug's LED
// ring. Red while it heats up, green once it is heated, off while the plug
// is switched off.
//
// Heated is a thermometer at PREHEATED or more, read since the machine was
// switched on, as the AWTRIX NG ShotTimer has it. Without one, or with one
// that has said nothing for QUIET_S since then, it is the heating phase
// having ended since, or, for a machine switched on still warm, the phase
// not having come on within NO_HEATING_S. Once green it stays green until
// the plug is switched off.
//
// Needs MQTT on the Shelly, on the broker Appliance Monitor publishes to.

let APPLIANCE = "appliance-monitor/Kaffeemaschine";
let HEATING_PHASE = "Aufheizen";
let TEMPERATURE = "deconz/Kaffeemaschine/temperature"; // "" for none
let PREHEATED = 38;
let QUIET_S = 15 * 60;
let NO_HEATING_S = 6 * 60;
let RED = [100, 0, 0];
let GREEN = [0, 100, 0];

let temperature = null;
let temperatureAt = null;
let onAt = 0;
let heating = false;
let heatingEnded = false;
let heated = false;
let shown = undefined;

function uptime() {
  return Shelly.getComponentStatus("sys").uptime;
}

function isOn() {
  return Shelly.getComponentStatus("switch", 0).output === true;
}

// The ring off while the plug is, as the plug shows a colour even with its
// "off" colour black; else following the relay in the colour given.
function setRing(colour) {
  if (shown === colour) {
    return;
  }
  shown = colour;
  if (colour === null) {
    Shelly.call("PLUGS_UI.SetConfig", { config: { leds: { mode: "off" } } });
  } else {
    Shelly.call("PLUGS_UI.SetConfig", { config: { leds: { mode: "switch", colors: { "switch:0": { on: { rgb: colour } } } } } });
  }
}

function show() {
  if (!isOn()) {
    setRing(null);
    return;
  }
  let sinceOn = uptime() - onAt;
  // A last value from before is no reading: the thermometer may have died hot.
  let measured = temperature !== null && temperatureAt !== null && temperatureAt >= onAt;
  let without = TEMPERATURE === "" || (!measured && sinceOn > QUIET_S);
  if ((measured && temperature >= PREHEATED) || (without && (heatingEnded || (!heating && sinceOn > NO_HEATING_S)))) {
    heated = true;
  }
  setRing(heated ? GREEN : RED);
}


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
    onAt = uptime();
    show();
  }
});

// Now and then, for the times above.
onAt = uptime();
Timer.set(30000, true, show);
show();
