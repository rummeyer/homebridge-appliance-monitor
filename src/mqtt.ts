/**
 * Each appliance's state as MQTT topics, for whatever listens on the home
 * network: a display such as AWTRIX, Node-RED, Home Assistant. Published to
 * a broker the owner runs — Mosquitto, say — only when a value changes, and
 * retained, so that a listener connecting later has the current values at once.
 *
 *     <prefix>/status                  online, or offline once the plugin is gone
 *     <prefix>/<name>/state            running | idle
 *     <prefix>/<name>/since            1792481234, Unix time in seconds the state began;
 *                                      running, when the draw rose
 *     <prefix>/<name>/watts            14.9
 *     <prefix>/<name>/reachable        true | false
 *     <prefix>/<name>/relay            ON | OFF, the plug's relay, for a plug that has one
 *     <prefix>/<name>/phase/<phase>    ON | OFF; a short phase is ON for a moment
 *     <prefix>/<name>/phase/<phase>/until  Unix seconds the draw fell below the phase's
 *                                      range while it is on; empty while in it, above it, or off
 *     <prefix>/<name>/overtime         ON | OFF, if Overtime is set
 *     <prefix>/<name>/overtime/at      Unix seconds it turns on, or did; empty while not counting
 *     <prefix>/<name>/idle             ON | OFF, if Idle is set
 *     <prefix>/<name>/idle/at          the same for Idle
 *
 * Besides, each appliance may have messages of its own, sent to any topic
 * when one of its phases starts or ends — a command to a display — not
 * retained, as they are events rather than states.
 *
 * Nothing sent to the plugin changes anything, as it only measures. What it
 * listens to is a plug's readings, for one that publishes them itself rather
 * than being paired over Matter: a Shelly, say; see parseReading.
 */
import { connect } from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { Logging } from 'homebridge';

import { usableMinutes } from './config.ts';
import type { DeviceConfig } from './config.ts';
import type { LiveAppliance } from './dashboard.ts';

const ON = 'ON';
const OFF = 'OFF';

/** How long to wait before connecting again after the broker went away. */
const RECONNECT_MS = 10_000;

/** A broker's address for the log, without the password a URL may hold. */
export const withoutLogin = (url: string): string => url.replace(/\/\/[^@/]*@/, '//');

/** A name as one level of a topic: "/" would make two, "+" and "#" are wildcards. */
export const topicLevel = (name: string): string => name.trim().replace(/[/+#\0]/g, '_');

/** Where an appliance's topics are: <prefix>/<name>. */
export const applianceTopic = (prefix: string, name: string): string => `${prefix}/${topicLevel(name)}`;

export const phaseTopic = (prefix: string, name: string, phase: string): string =>
  `${applianceTopic(prefix, name)}/phase/${topicLevel(phase)}`;

/** "0:23", "12:05", "1:02:05": short enough for a pixel display. */
export function clockDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
}

/**
 * A message's payload with its placeholders filled in: {appliance},
 * {phase}, {duration} ("0:23") and {seconds} ("23"), the time from the draw
 * entering the range to it leaving it — so far, at the start. Anything else
 * in braces, a JSON object's, stays as it is.
 */
export function fillMessage(payload: string, values: { appliance: string; phase: string; seconds: number }): string {
  const filled: Record<string, string> = {
    appliance: values.appliance,
    phase: values.phase,
    duration: clockDuration(values.seconds),
    seconds: String(Math.max(0, Math.round(values.seconds))),
  };
  return payload.replace(/\{(appliance|phase|duration|seconds)\}/g, (_, key: string) => filled[key]!);
}

/**
 * An appliance's topics and their values now. Nothing for one not yet
 * paired, and nothing for what is not known yet, rather than a guess.
 */
export function stateTopics(prefix: string, device: DeviceConfig, live: LiveAppliance): Map<string, string> {
  const topics = new Map<string, string>();
  if (!live.paired) {
    return topics;
  }
  const base = applianceTopic(prefix, device.name);
  if (live.state !== undefined) {
    topics.set(`${base}/state`, live.state);
  }
  // Running began when the draw rose, as Overtime counts, not once that was clear a minute later.
  const since = live.state === 'running' && live.cycle ? live.cycle.startedAt : live.since;
  if (since !== undefined) {
    topics.set(`${base}/since`, unixSeconds(since));
  }
  // Tenths of a watt: the plugs read finer than that, and every change is a message.
  if (live.watts !== undefined) {
    topics.set(`${base}/watts`, String(Math.round(live.watts * 10) / 10));
  }
  if (live.reachable !== undefined) {
    topics.set(`${base}/reachable`, String(live.reachable));
  }
  if (live.relay !== undefined) {
    topics.set(`${base}/relay`, live.relay ? ON : OFF);
  }
  for (const { name } of device.phases ?? []) {
    const topic = phaseTopic(prefix, device.name, name);
    topics.set(topic, live.phases.includes(name) ? ON : OFF);
    const until = live.phasesUntil?.[name];
    topics.set(`${topic}/until`, until === undefined ? '' : unixSeconds(until));
  }
  // An empty retained message clears the topic: nothing counting.
  if (usableMinutes(device, 'overtime').minutes !== undefined) {
    topics.set(`${base}/overtime`, live.overtime ? ON : OFF);
    topics.set(`${base}/overtime/at`, live.overtimeAt === undefined ? '' : unixSeconds(live.overtimeAt));
  }
  if (usableMinutes(device, 'idleOn').minutes !== undefined) {
    topics.set(`${base}/idle`, live.idleOn ? ON : OFF);
    topics.set(`${base}/idle/at`, live.idleOnAt === undefined ? '' : unixSeconds(live.idleOnAt));
  }
  return topics;
}

/** What a plug's message says, as far as it says it. */
export interface MqttReading {
  watts?: number;
  /** Whether its relay is switched on. */
  on?: boolean;
}

/** A Shelly's keys, in its own status messages and a script's alike. */
export const DEFAULT_POWER_KEY = 'apower';
export const DEFAULT_RELAY_KEY = 'output';

/**
 * A plug's message: a number of watts, or a JSON object with them under
 * the power key and the relay under the relay key — `a.b` for one inside
 * another. Anything not there, or not a number or true/false, is not known.
 */
export function parseReading(payload: string, powerKey = DEFAULT_POWER_KEY, relayKey = DEFAULT_RELAY_KEY): MqttReading {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return {};
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { watts: value } : {};
  }
  const watts = at(value, powerKey.trim() || DEFAULT_POWER_KEY);
  const on = at(value, relayKey.trim() || DEFAULT_RELAY_KEY);
  return {
    ...(typeof watts === 'number' && Number.isFinite(watts) && watts >= 0 ? { watts } : {}),
    ...(typeof on === 'boolean' ? { on } : {}),
  };
}

function at(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Whether a plug says it is connected: true or online; false or offline. Anything else is not known. */
export function parseOnline(payload: string): boolean | undefined {
  const value = payload.trim().toLowerCase();
  return value === 'true' || value === 'online' ? true : value === 'false' || value === 'offline' ? false : undefined;
}

/** Whole seconds: what a small display can count with, where milliseconds overflow its integers. */
const unixSeconds = (ms: number): string => String(Math.round(ms / 1000));

/**
 * The connection to the broker. Without one — not there yet, or gone — the
 * plugin runs on as before; what changed meanwhile goes out once it is back.
 */
export class MqttPublisher {
  readonly #log: Logging;
  readonly #url: string;
  readonly #status: string;
  readonly #client: MqttClient;
  /** What each topic was last sent as; emptied on every connect, so that all is sent again. */
  readonly #sent = new Map<string, string>();
  /** Whether a lost connection was logged, so that the retries every few seconds are not. */
  #lost = false;
  /** The topics listened to, and what each message on them goes to. */
  readonly #listeners = new Map<string, (payload: string) => void>();

  constructor(log: Logging, url: string, prefix: string) {
    this.#log = log;
    this.#url = withoutLogin(url);
    this.#status = `${prefix}/status`;
    this.#client = connect(url, {
      reconnectPeriod: RECONNECT_MS,
      // Values from while it was away are stale; the current ones go out on connecting.
      queueQoSZero: false,
      will: { topic: this.#status, payload: Buffer.from('offline'), qos: 0, retain: true },
    });
    this.#client.on('connect', () => {
      this.#sent.clear();
      this.#client.publish(this.#status, 'online', { retain: true });
      if (this.#listeners.size > 0) {
        this.#client.subscribe([...this.#listeners.keys()]);
      }
      this.#log.info(`MQTT: ${this.#lost ? 'connected again to' : 'publishing to'} ${this.#url}`);
      this.#lost = false;
    });
    this.#client.on('message', (topic, payload) => this.#listeners.get(topic)?.(payload.toString()));
    this.#client.on('error', (error) => this.#lose(error.message));
    this.#client.on('offline', () => this.#lose('no connection'));
  }

  #lose(why: string): void {
    if (!this.#lost) {
      this.#lost = true;
      this.#log.warn(`MQTT: ${this.#url}: ${why}; trying again every ${RECONNECT_MS / 1000} s`);
    }
  }

  /** Hands every message on a topic to `listener`, from now and after every reconnect. */
  listen(topic: string, listener: (payload: string) => void): void {
    this.#listeners.set(topic, listener);
    if (this.#client.connected) {
      this.#client.subscribe(topic);
    }
  }

  /** Sends the values that changed since they were last sent. */
  publish(topics: Map<string, string>): void {
    if (!this.#client.connected) {
      return;
    }
    for (const [topic, value] of topics) {
      if (this.#sent.get(topic) !== value) {
        this.#client.publish(topic, value, { retain: true });
        this.#sent.set(topic, value);
      }
    }
  }

  /**
   * A short phase, known only once it is over: ON for a moment, as its switch
   * in HomeKit is. Only OFF is retained, which is what it is now.
   */
  pulse(topic: string): void {
    if (!this.#client.connected) {
      return;
    }
    this.#client.publish(topic, ON);
    this.#client.publish(topic, OFF, { retain: true });
    this.#sent.set(topic, OFF);
  }

  /** One of an appliance's own messages: once, not retained, and lost if the broker is away. */
  send(topic: string, payload: string): void {
    if (this.#client.connected) {
      this.#client.publish(topic, payload);
    }
  }

  /** Says goodbye, so that listeners see the plugin gone rather than the values frozen. */
  async close(): Promise<void> {
    if (this.#client.connected) {
      await this.#client.publishAsync(this.#status, 'offline', { retain: true }).catch(() => undefined);
    }
    await this.#client.endAsync().catch(() => undefined);
  }
}
