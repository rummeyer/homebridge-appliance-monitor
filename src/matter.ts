import { Environment, Logger, LogLevel, Seconds } from '@matter/main';
import { GeneralCommissioning } from '@matter/main/clusters';
import { NodeId } from '@matter/main/types';
import { CommissioningController } from '@project-chip/matter.js';
import { NodeStates } from '@project-chip/matter.js/device';
import type { Endpoint, PairedNode } from '@project-chip/matter.js/device';
import type { Logging } from 'homebridge';

import type { EndpointInfo } from './bridged.ts';
import type { MatterLogLevel, PairingData } from './config.ts';
import { ACTIVE_POWER, ELECTRICAL_POWER_MEASUREMENT, hex, ON_OFF, ON_OFF_STATE } from './power.ts';
import { FABRIC_LABEL } from './settings.ts';

/** Bridged Device Basic Information, and the attributes of it used here. */
const BRIDGED_DEVICE_BASIC_INFORMATION = 0x0039;
const PRODUCT_NAME = 0x0003;
const NODE_LABEL = 0x0005;
const UNIQUE_ID = 0x0012;

/** Thread plugs can take a while to answer mDNS; the default is 30 s. */
const DISCOVERY_TIMEOUT = Seconds(60);

export interface AttributeReport {
  endpointId: number;
  clusterId: number;
  attributeId: number;
  attributeName: string;
  value: unknown;
}

export interface NodeHandlers {
  onAttribute(report: AttributeReport): void;
  onState(state: string): void;
  /** Once per connection, when everything has been read from the plug. */
  onReady(node: PairedNode): void;
}

/** The plugin's one Matter controller: its own fabric, shared by every plug. */
export class MatterController {
  #controller: CommissioningController | undefined;

  constructor(log: Logging, storagePath: string, level: MatterLogLevel) {
    routeMatterLogging(log, level);
    // Read lazily by matter.js, so setting it before start() is soon enough.
    Environment.default.vars.set('storage.path', storagePath);
  }

  async start(): Promise<void> {
    const controller = new CommissioningController({
      // The plugin's name while it was being tried out. matter.js keeps the
      // fabric under this name, so it stays, and plugs paired then stay paired.
      environment: { environment: Environment.default, id: 'outlet-monitor' },
      autoConnect: false,
      adminFabricLabel: FABRIC_LABEL,
    });
    await controller.start();
    this.#controller = controller;
  }

  async stop(): Promise<void> {
    await this.#controller?.close();
    this.#controller = undefined;
  }

  get #started(): CommissioningController {
    if (!this.#controller) {
      throw new Error('Matter controller not started');
    }
    return this.#controller;
  }

  isCommissioned(nodeId: bigint): boolean {
    return this.#started.isNodeCommissioned(NodeId(nodeId));
  }

  commissionedNodes(): bigint[] {
    return this.#started.getCommissionedNodes().map((id) => BigInt(id));
  }

  /**
   * Joins a plug to this controller's fabric, alongside Apple Home.
   *
   * Over the IP network only — the plug is already on Thread through Apple's
   * border router, so there is no Bluetooth step and no network credentials.
   */
  async commission(pairing: PairingData): Promise<bigint> {
    const nodeId = await this.#started.commissionNode(
      {
        commissioning: {
          regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
          regulatoryCountryCode: 'XX',
        },
        discovery: {
          identifierData: pairing.identifier,
          discoveryCapabilities: { onIpNetwork: true },
          timeout: DISCOVERY_TIMEOUT,
        },
        passcode: pairing.passcode,
      },
      { connectNodeAfterCommissioning: false },
    );
    return BigInt(nodeId);
  }

  /**
   * Connects to a paired plug and subscribes to everything it has. Once per
   * node: the appliances behind one bridge share the connection.
   *
   * matter.js keeps the connection up from here: it resubscribes after a
   * dropped subscription and rediscovers the plug if its address changes.
   */
  async connect(nodeId: bigint, handlers: NodeHandlers): Promise<PairedNode> {
    const node = await this.#started.getNode(NodeId(nodeId));

    node.events.attributeChanged.on(({ path, value }) => {
      handlers.onAttribute({
        endpointId: Number(path.endpointId),
        clusterId: Number(path.clusterId),
        attributeId: Number(path.attributeId),
        attributeName: path.attributeName,
        value,
      });
    });
    node.events.stateChanged.on((state) => handlers.onState(NodeStates[state] ?? String(state)));
    node.events.initializedFromRemote.on(() => handlers.onReady(node));

    node.connect();
    return node;
  }
}

/**
 * Lines describing every endpoint of a plug, its device types and clusters,
 * with the current value of every attribute of the power measurement cluster.
 */
export function describeNode(node: PairedNode): string[] {
  const lines: string[] = [];
  const info = node.basicInformation;
  if (info) {
    lines.push(
      `${info.vendorName ?? '?'} ${info.productName ?? '?'} ` +
        `(vendor ${hex(Number(info.vendorId ?? 0))}, product ${hex(Number(info.productId ?? 0))}), ` +
        `firmware ${info.softwareVersionString ?? '?'}`,
    );
  }

  for (const endpoint of allEndpoints(node)) {
    const types = endpoint
      .getDeviceTypes()
      .map((type) => `${type.name} ${hex(Number(type.code))}`)
      .join(', ');
    lines.push(`Endpoint ${endpoint.number ?? '?'}: ${types}`);

    for (const cluster of endpoint.getAllClusterClients()) {
      const id = Number(cluster.id);
      const unknown = cluster.isUnknown ? ', not known to matter.js' : '';
      lines.push(`  ${cluster.name} ${hex(id, id > 0xffff ? 8 : 4)}${unknown}`);

      if (id !== ELECTRICAL_POWER_MEASUREMENT) {
        continue;
      }
      const seen = new Set<number>();
      for (const attribute of Object.values(cluster.attributes)) {
        const attributeId = Number(attribute.id);
        if (seen.has(attributeId)) {
          continue;
        }
        seen.add(attributeId);
        lines.push(`    ${attribute.name} ${hex(attributeId)} = ${show(attribute.getLocal())}`);
      }
    }
  }
  return lines;
}

/**
 * Every endpoint, where it sits, whether it measures power, and what a
 * bridge says of the device it stands for; see bridged.ts.
 */
export function endpointTree(node: PairedNode): EndpointInfo[] {
  const parents = new Map<number, number>();
  for (const endpoint of allEndpoints(node)) {
    for (const child of endpoint.getChildEndpoints()) {
      parents.set(Number(child.number), Number(endpoint.number));
    }
  }
  return allEndpoints(node).map((endpoint) => {
    const number = Number(endpoint.number);
    const info: EndpointInfo = { number, parent: parents.get(number), metering: false };
    for (const cluster of endpoint.getAllClusterClients()) {
      const id = Number(cluster.id);
      if (id === ELECTRICAL_POWER_MEASUREMENT) {
        info.metering = true;
      } else if (id === BRIDGED_DEVICE_BASIC_INFORMATION) {
        const text = (attributeId: number): string | undefined => {
          const value = Object.values(cluster.attributes).find(({ id: inner }) => Number(inner) === attributeId)?.getLocal();
          return typeof value === 'string' && value.trim() ? value.trim() : undefined;
        };
        info.bridged = { uniqueId: text(UNIQUE_ID), name: text(NODE_LABEL) ?? text(PRODUCT_NAME) };
      }
    }
    return info;
  });
}

/**
 * The ActivePower and relay state each endpoint currently holds, as if just
 * reported: the relay first, so that a reading is taken knowing whether the
 * relay is off.
 */
export function currentValues(node: PairedNode): AttributeReport[] {
  const reports: AttributeReport[] = [];
  for (const [clusterId, attributeId] of [[ON_OFF, ON_OFF_STATE], [ELECTRICAL_POWER_MEASUREMENT, ACTIVE_POWER]] as const) {
    for (const endpoint of allEndpoints(node)) {
      for (const cluster of endpoint.getAllClusterClients()) {
        if (Number(cluster.id) !== clusterId) {
          continue;
        }
        const attribute = Object.values(cluster.attributes).find(({ id }) => Number(id) === attributeId);
        if (attribute) {
          reports.push({
            endpointId: Number(endpoint.number),
            clusterId,
            attributeId,
            attributeName: attribute.name,
            value: attribute.getLocal(),
          });
        }
      }
    }
  }
  return reports;
}

/**
 * ActivePower read from the device now, rather than what it last reported.
 *
 * Some plugs report on their own schedule — the Eve Energy about once a
 * minute — which is too coarse to see a coffee run through. Asking can be
 * fresher, if the plug measures more often than it reports.
 */
export async function readActivePower(node: PairedNode, only?: Set<number>): Promise<AttributeReport[]> {
  const reports: AttributeReport[] = [];
  for (const endpoint of allEndpoints(node)) {
    // Behind a bridge, only the device asked about: not every Shelly in the house.
    if (only && !only.has(Number(endpoint.number))) {
      continue;
    }
    for (const cluster of endpoint.getAllClusterClients()) {
      if (Number(cluster.id) !== ELECTRICAL_POWER_MEASUREMENT) {
        continue;
      }
      const attribute = Object.values(cluster.attributes).find(({ id }) => Number(id) === ACTIVE_POWER);
      if (attribute) {
        reports.push({
          endpointId: Number(endpoint.number),
          clusterId: ELECTRICAL_POWER_MEASUREMENT,
          attributeId: ACTIVE_POWER,
          attributeName: attribute.name,
          value: await attribute.get(true),
        });
      }
    }
  }
  return reports;
}

/** The root endpoint and everything under it, each once, in number order. */
function allEndpoints(node: PairedNode): Endpoint[] {
  const found = new Map<number, Endpoint>();
  const visit = (endpoint: Endpoint | undefined): void => {
    if (!endpoint || found.has(Number(endpoint.number))) {
      return;
    }
    found.set(Number(endpoint.number), endpoint);
    endpoint.getChildEndpoints().forEach(visit);
  };
  visit(node.getRootEndpoint());
  node.getDevices().forEach(visit);
  return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number));
}

/** JSON, except that bigints (int64 attributes) survive. */
export function show(value: unknown): string {
  if (value === undefined) {
    return '(not read)';
  }
  return JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'bigint' ? inner.toString() : inner));
}

/**
 * Warnings matter.js gives on every start or pairing that are expected for a
 * controller like this one, and so not worth a yellow line each time: it has
 * no vendor ID of its own, no Bluetooth, and no access to the certificate
 * ledger it would check a new plug's attestation against.
 */
const EXPECTED = [
  /Using development values for some BasicInformation attributes/,
  /Using test vendor ID/,
  /BLE is not enabled/,
  /Attestation finding accepted/,
];

/**
 * Sends matter.js's own log lines to the Homebridge log instead of stdout.
 *
 * matter.js logs to the console by default, which a child bridge would show
 * without the plugin's prefix or Homebridge's timestamps.
 */
function routeMatterLogging(log: Logging, level: MatterLogLevel): void {
  Logger.format = 'plain';
  Logger.level = LogLevel(level);
  const destination = Logger.destinations.default;
  if (!destination) {
    return;
  }
  destination.write = (formatted, message) => {
    // Homebridge adds its own timestamp, and the level shows in the colour.
    const text = formatted.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ [A-Z]+ /, '');
    if (EXPECTED.some((pattern) => pattern.test(text))) {
      log.debug(text);
    } else if (message.level >= LogLevel.ERROR) {
      log.error(text);
    } else if (message.level >= LogLevel.WARN) {
      log.warn(text);
    } else if (message.level >= LogLevel.NOTICE) {
      log.info(text);
    } else {
      log.debug(text);
    }
  };
}
