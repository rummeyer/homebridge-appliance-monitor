import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_MQTT_PREFIX, DEFAULT_MQTT_URL, usableMessages, usableMqtt } from '../src/config.ts';
import type { DeviceConfig } from '../src/config.ts';
import type { LiveAppliance } from '../src/dashboard.ts';
import { clockDuration, fillMessage, phaseTopic, stateTopics, topicLevel, withoutLogin } from '../src/mqtt.ts';

const coffee: DeviceConfig = {
  name: 'Kaffeemaschine',
  phases: [
    { name: 'Aufheizen', minWatts: 1000 },
    { name: 'Bezug', minWatts: 30, maxWatts: 100 },
  ],
  overtimeMinutes: 60,
  idleOnMinutes: 15,
};

const live = (values: Partial<LiveAppliance>): LiveAppliance => ({ name: 'Kaffeemaschine', paired: true, phases: [], ...values });

test('MQTT is off unless switched on, and then uses the local broker and its own prefix', () => {
  assert.deepEqual(usableMqtt({ platform: 'x' }), {});
  assert.deepEqual(usableMqtt({ platform: 'x', mqttUrl: 'mqtt://broker:1883' }), {}, 'an address alone does not switch it on');
  assert.deepEqual(usableMqtt({ platform: 'x', mqtt: true }), { url: DEFAULT_MQTT_URL, prefix: DEFAULT_MQTT_PREFIX });
  assert.deepEqual(usableMqtt({ platform: 'x', mqtt: true, mqttUrl: ' mqtt://10.0.1.10:1883 ', mqttPrefix: 'home/appliances/' }), {
    url: 'mqtt://10.0.1.10:1883',
    prefix: 'home/appliances',
  });
});

test('a broker address or prefix that cannot work costs MQTT, not the plugin, and the password stays out of the log', () => {
  const { url, problem } = usableMqtt({ platform: 'x', mqtt: true, mqttUrl: 'http://user:secret@broker' });
  assert.equal(url, undefined);
  assert.match(problem!, /no broker address/);
  assert.doesNotMatch(problem!, /secret/);
  assert.match(usableMqtt({ platform: 'x', mqtt: true, mqttPrefix: 'home/#' }).problem!, /wildcard/);
  assert.match(usableMqtt({ platform: 'x', mqtt: true, mqttPrefix: '/home' }).problem!, /starts with \//);
  assert.equal(withoutLogin('mqtt://user:secret@broker:1883'), 'mqtt://broker:1883');
  assert.equal(withoutLogin('mqtt://broker:1883'), 'mqtt://broker:1883');
});

test('an appliance is its state, watts, reachability, each phase and the sensors it has', () => {
  const topics = stateTopics('am', coffee, live({ state: 'running', watts: 14.849, reachable: true, phases: ['Bezug'], idleOn: true }));
  assert.deepEqual(Object.fromEntries(topics), {
    'am/Kaffeemaschine/state': 'running',
    'am/Kaffeemaschine/watts': '14.8',
    'am/Kaffeemaschine/reachable': 'true',
    'am/Kaffeemaschine/phase/Aufheizen': 'OFF',
    'am/Kaffeemaschine/phase/Bezug': 'ON',
    'am/Kaffeemaschine/overtime': 'OFF',
    'am/Kaffeemaschine/idle': 'ON',
  });
});

test('what is not known yet is left out rather than guessed, and an unpaired appliance has nothing', () => {
  assert.deepEqual(stateTopics('am', coffee, live({ paired: false })).size, 0);
  const topics = stateTopics('am', { name: 'TV' }, live({ name: 'TV' }));
  assert.deepEqual(Object.fromEntries(topics), {}, 'no state, watts or reachability yet, no phases, no sensors set');
});

test('a name is one level of a topic, whatever it holds', () => {
  assert.equal(topicLevel(' Spülen '), 'Spülen');
  assert.equal(topicLevel('Licht/Flur'), 'Licht_Flur');
  assert.equal(topicLevel('A+B #1'), 'A_B _1');
  assert.equal(phaseTopic('am', 'Kaffeemaschine', 'Bezug/Spülen'), 'am/Kaffeemaschine/phase/Bezug_Spülen');
});

test('a duration reads like a clock, short enough for a pixel display', () => {
  assert.equal(clockDuration(0), '0:00');
  assert.equal(clockDuration(23.4), '0:23');
  assert.equal(clockDuration(725), '12:05');
  assert.equal(clockDuration(3725), '1:02:05');
  assert.equal(clockDuration(-3), '0:00');
});

test('a message gets its placeholders filled in, and a JSON payload keeps its own braces', () => {
  const values = { appliance: 'Kaffeemaschine', phase: 'Pumpe', seconds: 23.4 };
  assert.equal(fillMessage('{"text":"{phase} {duration}","durationMs":5000}', values), '{"text":"Pumpe 0:23","durationMs":5000}');
  assert.equal(fillMessage('{appliance}: {seconds} s {unknown}', values), 'Kaffeemaschine: 23 s {unknown}');
  assert.equal(fillMessage('', values), '');
});

test('messages are kept for a phase the appliance has, sent at its start or end, to a topic without wildcards', () => {
  const device = (messages: unknown): DeviceConfig => ({ ...coffee, messages: messages as DeviceConfig['messages'] });
  const phases = coffee.phases!;
  const good = { phase: 'Bezug', when: 'end', topic: 'awtrix/cmd/notify', payload: '{"text":"{duration}"}' };
  assert.deepEqual(usableMessages(device([good]), phases, true), { messages: [good], problems: [] });
  assert.deepEqual(usableMessages(device([{ ...good, phase: ' Bezug ', topic: ' awtrix/cmd/notify ' }]), phases, true).messages, [good]);
  assert.deepEqual(usableMessages(device([{ phase: 'Bezug', when: 'end', topic: '', payload: '' }]), phases, true), { messages: [], problems: [] },
    'an empty line from the settings page is skipped without a word');
  const { messages, problems } = usableMessages(device([
    good,
    { ...good, phase: 'Spülen' },
    { ...good, when: 'later' },
    { ...good, topic: 'awtrix/#' },
  ]), phases, true);
  assert.deepEqual(messages, [good], 'a wrong message costs only itself');
  assert.equal(problems.length, 3);
  assert.match(problems[0]!, /Spülen, which is none of its phases/);
  assert.match(problems[1]!, /neither at the start nor at the end/);
  assert.match(problems[2]!, /wildcard/);
});

test('messages without MQTT are none, and said so', () => {
  const { messages, problems } = usableMessages({ ...coffee, messages: [{ phase: 'Bezug', when: 'start', topic: 'x/y' }] }, coffee.phases!, false);
  assert.deepEqual(messages, []);
  assert.match(problems[0]!, /MQTT is off/);
});
