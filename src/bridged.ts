/**
 * Which readings belong to which appliance, on a node that has more than one
 * device measuring power: a Matter bridge — homebridge-shelly-matter, say,
 * with every Shelly in the house behind it — or a plug with several
 * channels, each on an endpoint of its own.
 *
 * A bridge shows each device it carries as an endpoint with Bridged Device
 * Basic Information: a name, and a UniqueID that stays when the bridge
 * renumbers its endpoints, as bridges do when an accessory is created anew.
 * The power can be on that endpoint or on one below it, so a device is the
 * endpoint with that information and everything under it.
 *
 * Kept free of matter.js, so the tests can build any tree they like; see
 * endpointTree() in matter.ts for the real one.
 */

/** One endpoint of a node, as far as this needs to know. */
export interface EndpointInfo {
  number: number;
  /** The endpoint it sits under; none for the root. */
  parent?: number;
  /** Whether it has the power measurement cluster. */
  metering: boolean;
  /** Its Bridged Device Basic Information, for a device behind a bridge. */
  bridged?: { uniqueId?: string; name?: string };
}

/** A device on a node that measures power, to choose an appliance's readings from. */
export interface MeteredDevice {
  /** The endpoint that stands for it: the bridged device's, or the measuring one. */
  endpoint: number;
  /** The endpoints whose readings are its own: that one and those under it. */
  endpoints: number[];
  uniqueId?: string;
  name?: string;
}

/** The devices that measure power, in endpoint order, each once. */
export function meteredDevices(tree: EndpointInfo[]): MeteredDevice[] {
  const byNumber = new Map(tree.map((info) => [info.number, info]));
  /** The endpoint and those above it, nearest first, guarded against a loop. */
  const lineage = (number: number): EndpointInfo[] => {
    const found: EndpointInfo[] = [];
    for (let info = byNumber.get(number); info && !found.includes(info); info = info.parent === undefined ? undefined : byNumber.get(info.parent)) {
      found.push(info);
    }
    return found;
  };
  const devices = new Map<number, MeteredDevice>();
  for (const info of tree) {
    if (!info.metering) {
      continue;
    }
    const top = lineage(info.number).find(({ bridged }) => bridged) ?? info;
    if (!devices.has(top.number)) {
      devices.set(top.number, {
        endpoint: top.number,
        endpoints: tree.filter(({ number }) => lineage(number).includes(top)).map(({ number }) => number).sort((a, b) => a - b),
        uniqueId: top.bridged?.uniqueId || undefined,
        name: top.bridged?.name || undefined,
      });
    }
  }
  return [...devices.values()].sort((a, b) => a.endpoint - b.endpoint);
}

/** What an appliance chose, as config.json has it. */
export interface Choice {
  deviceId?: string;
  endpoint?: number;
}

/**
 * The endpoints whose readings an appliance takes: those of the device it
 * chose, found by UniqueID first and by endpoint number else; every endpoint
 * when it chose none; none when what it chose is not there (any more).
 */
export function chosenEndpoints(devices: MeteredDevice[], choice: Choice): Set<number> | 'all' {
  if (!choice.deviceId && choice.endpoint === undefined) {
    return 'all';
  }
  const device = (choice.deviceId ? devices.find(({ uniqueId }) => uniqueId === choice.deviceId) : undefined)
    ?? (choice.endpoint === undefined ? undefined : devices.find(({ endpoint, endpoints }) => endpoint === choice.endpoint || endpoints.includes(choice.endpoint!)));
  return new Set(device?.endpoints ?? []);
}

/** "Waschmaschine (endpoint 3, id shelly-1234)", for the log. */
export function describeDevice({ endpoint, uniqueId, name }: MeteredDevice): string {
  return `${name ?? 'Endpoint'} (endpoint ${endpoint}${uniqueId ? `, id ${uniqueId}` : ''})`;
}
