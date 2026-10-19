import { readJson, writeJson } from './json-file.ts';

interface Entry {
  nodeId: bigint;
  /** The code it was paired with, to know it again after a rename. */
  pairingCode?: string;
}

/**
 * Which Matter node each configured plug became when it was paired.
 *
 * matter.js keeps the fabric and everything it knows about the nodes; this
 * only adds the one thing it cannot know, which is the name the plug has in
 * config.json. Stored as decimal strings because node IDs are 64-bit; an
 * entry that knows its pairing code is `{ "node": "13", "pairingCode": "…" }`.
 */
export class NodeRegistry {
  readonly #path: string;
  readonly #nodes = new Map<string, Entry>();

  constructor(path: string) {
    this.#path = path;
    const data = readJson(path) as Record<string, unknown> | undefined;
    for (const [name, value] of Object.entries(data ?? {})) {
      const { node, pairingCode } = (typeof value === 'object' && value !== null ? value : { node: value }) as Record<string, unknown>;
      if (typeof node === 'string' && /^\d+$/.test(node)) {
        this.#nodes.set(name, { nodeId: BigInt(node), pairingCode: typeof pairingCode === 'string' ? pairingCode : undefined });
      }
    }
  }

  get(name: string): bigint | undefined {
    return this.#nodes.get(name)?.nodeId;
  }

  set(name: string, nodeId: bigint, pairingCode?: string): void {
    this.#nodes.set(name, { nodeId, pairingCode: pairingCode ? samePairingCode(pairingCode) : undefined });
    this.#save();
  }

  /** Remembers the code a plug known by name was paired with, if it was not known yet. */
  learnPairingCode(name: string, pairingCode: string): void {
    const entry = this.#nodes.get(name);
    if (entry && !entry.pairingCode) {
      this.set(name, entry.nodeId, pairingCode);
    }
  }

  /** The name a plug was paired under with this code. */
  nameFor(pairingCode: string): string | undefined {
    const code = samePairingCode(pairingCode);
    return [...this.#nodes].find(([, entry]) => entry.pairingCode === code)?.[0];
  }

  rename(from: string, to: string): void {
    const entry = this.#nodes.get(from);
    if (entry) {
      this.#nodes.delete(from);
      this.#nodes.set(to, entry);
      this.#save();
    }
  }

  delete(name: string): void {
    if (this.#nodes.delete(name)) {
      this.#save();
    }
  }

  entries(): [string, bigint][] {
    return [...this.#nodes].map(([name, { nodeId }]) => [name, nodeId]);
  }

  #save(): void {
    writeJson(
      this.#path,
      Object.fromEntries(
        [...this.#nodes].map(([name, { nodeId, pairingCode }]) => [
          name,
          pairingCode ? { node: nodeId.toString(), pairingCode } : nodeId.toString(),
        ]),
      ),
    );
  }
}

/** A code as typed, with or without dashes and spaces, in one spelling. */
function samePairingCode(code: string): string {
  return code.trim().replace(/[\s-]/g, '').toUpperCase();
}
