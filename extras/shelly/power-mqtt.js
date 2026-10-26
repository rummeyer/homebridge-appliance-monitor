// Appliance Monitor: a Shelly plug's power and relay over MQTT, as soon as
// they change. The Shelly's own status messages leave out small changes,
// a pump of 50 W beside a heater of 1200 W say, so this asks every second and
// sends whatever changed, and every 30 s what is, to <prefix>/power:
//
//     {"apower":1231.4,"output":true}
//
// In Appliance Monitor: Readings from MQTT topic, Topic <prefix>/power,
// Online topic <prefix>/online. <prefix> is the Shelly's MQTT topic prefix,
// its device id unless changed.

let topic = Shelly.getComponentConfig("mqtt").topic_prefix + "/power";
let last = null;
let sentAt = 0;

Timer.set(1000, true, function () {
  if (!MQTT.isConnected()) {
    return;
  }
  let status = Shelly.getComponentStatus("switch", 0);
  let now = Shelly.getComponentStatus("sys").uptime;
  let message = JSON.stringify({ apower: status.apower, output: status.output });
  if (message !== last || now - sentAt >= 30) {
    MQTT.publish(topic, message, 0, false);
    last = message;
    sentAt = now;
  }
});
