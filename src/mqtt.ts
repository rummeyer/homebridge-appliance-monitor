/**
 * Each appliance's state as MQTT topics, for whatever listens on the home
 * network: a display such as AWTRIX, Node-RED, Home Assistant. Published to
 * a broker the owner runs — Mosquitto, say — only when a value changes, and
 * retained, so that a listener connecting later has the current values at once.
 *
 *     <prefix>/status                  online, or offline once the plugin is gone
 *     <prefix>/<name>/state            running | idle
 *     <prefix>/<name>/watts            14.9
 *     <prefix>/<name>/reachable        true | false
 *     <prefix>/<name>/phase/<phase>    ON | OFF; a short phase is ON for a moment
 *     <prefix>/<name>/overtime         ON | OFF, if Overtime is set
 *     <prefix>/<name>/idle             ON | OFF, if Idle is set
 *
 * Only ever publishes: nothing sent to the plugin changes anything, as it
 * only measures.
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
  // Tenths of a watt: the plugs read finer than that, and every change is a message.
  if (live.watts !== undefined) {
    topics.set(`${base}/watts`, String(Math.round(live.watts * 10) / 10));
  }
  if (live.reachable !== undefined) {
    topics.set(`${base}/reachable`, String(live.reachable));
  }
  for (const { name } of device.phases ?? []) {
    topics.set(phaseTopic(prefix, device.name, name), live.phases.includes(name) ? ON : OFF);
  }
  if (usableMinutes(device, 'overtime').minutes !== undefined) {
    topics.set(`${base}/overtime`, live.overtime ? ON : OFF);
  }
  if (usableMinutes(device, 'idleOn').minutes !== undefined) {
    topics.set(`${base}/idle`, live.idleOn ? ON : OFF);
  }
  return topics;
}

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
      this.#log.info(`MQTT: ${this.#lost ? 'connected again to' : 'publishing to'} ${this.#url}`);
      this.#lost = false;
    });
    this.#client.on('error', (error) => this.#lose(error.message));
    this.#client.on('offline', () => this.#lose('no connection'));
  }

  #lose(why: string): void {
    if (!this.#lost) {
      this.#lost = true;
      this.#log.warn(`MQTT: ${this.#url}: ${why}; trying again every ${RECONNECT_MS / 1000} s`);
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

  /** Says goodbye, so that listeners see the plugin gone rather than the values frozen. */
  async close(): Promise<void> {
    if (this.#client.connected) {
      await this.#client.publishAsync(this.#status, 'offline', { retain: true }).catch(() => undefined);
    }
    await this.#client.endAsync().catch(() => undefined);
  }
}
