import { readJson, writeJson } from './json-file.ts';

/**
 * Which Matter node each configured plug became when it was paired.
 *
 * matter.js keeps the fabric and everything it knows about the nodes; this
 * only adds the one thing it cannot know, which is the name the plug has in
 * config.json. Stored as decimal strings because node IDs are 64-bit.
 */
export class NodeRegistry {
  readonly #path: string;
  readonly #nodes = new Map<string, bigint>();

  constructor(path: string) {
    this.#path = path;
    const data = readJson(path) as Record<string, unknown> | undefined;
    for (const [name, id] of Object.entries(data ?? {})) {
      if (typeof id === 'string' && /^\d+$/.test(id)) {
        this.#nodes.set(name, BigInt(id));
      }
    }
  }

  get(name: string): bigint | undefined {
    return this.#nodes.get(name);
  }

  set(name: string, nodeId: bigint): void {
    this.#nodes.set(name, nodeId);
    this.#save();
  }

  delete(name: string): void {
    if (this.#nodes.delete(name)) {
      this.#save();
    }
  }

  entries(): [string, bigint][] {
    return [...this.#nodes.entries()];
  }

  #save(): void {
    writeJson(this.#path, Object.fromEntries([...this.#nodes].map(([name, id]) => [name, id.toString()])));
  }
}
