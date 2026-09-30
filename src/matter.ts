import { Environment, Logger, LogLevel, Seconds } from '@matter/main';
import { GeneralCommissioning } from '@matter/main/clusters';
import { NodeId } from '@matter/main/types';
import { CommissioningController } from '@project-chip/matter.js';
import { NodeStates } from '@project-chip/matter.js/device';
import type { Endpoint, PairedNode } from '@project-chip/matter.js/device';
import type { Logging } from 'homebridge';

import type { MatterLogLevel, PairingData } from './config.ts';
import { ACTIVE_POWER, ELECTRICAL_POWER_MEASUREMENT, hex } from './power.ts';
import { FABRIC_LABEL } from './settings.ts';

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
   * Connects to a paired plug and subscribes to everything it has.
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

/** The ActivePower each endpoint currently holds, as if just reported. */
export function activePowerValues(node: PairedNode): AttributeReport[] {
  const reports: AttributeReport[] = [];
  for (const endpoint of allEndpoints(node)) {
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
          value: attribute.getLocal(),
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
    if (message.level >= LogLevel.ERROR) {
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
