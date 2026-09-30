import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Which Matter node each configured plug became when it was paired.
 *
 * matter.js keeps the fabric and everything it knows about the nodes; this
 * only adds the one thing it cannot know, which is the name the plug has in
 * config.json. Stored as decimal strings because node IDs are 64-bit.
 */
export class NodeRegistry {
  readonly #path: string;
  readonly #nodes: Map<string, bigint>;

  constructor(path: string) {
    this.#path = path;
    this.#nodes = load(path);
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

  /** Written to a temporary file first, so a crash cannot leave half a file. */
  #save(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const data = Object.fromEntries([...this.#nodes].map(([name, id]) => [name, id.toString()]));
    const temp = `${this.#path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temp, this.#path);
  }
}

function load(path: string): Map<string, bigint> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return new Map();
  }
  const nodes = new Map<string, bigint>();
  const data = JSON.parse(text) as Record<string, unknown>;
  for (const [name, id] of Object.entries(data)) {
    if (typeof id === 'string' && /^\d+$/.test(id)) {
      nodes.set(name, BigInt(id));
    }
  }
  return nodes;
}
