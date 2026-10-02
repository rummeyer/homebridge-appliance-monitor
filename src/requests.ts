/**
 * Asking the running plugin to do something from the settings page: learn
 * from a cycle marked on the Power tab, or forget what was learned.
 *
 * The page runs in a process of its own with no line to the plugin, which
 * holds what it learned in memory. So the page leaves each request as a file
 * of its own in `requests/`, the plugin takes it on its next tick and leaves
 * its answer in `answers/` under the same id, and the page reads that. One
 * file per request and per answer, so neither side ever writes over the
 * other's.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { readJson, writeJson } from './json-file.ts';

export type PluginRequest =
  | { id: string; name: string; action: 'learn'; from: number; to: number }
  | { id: string; name: string; action: 'forget' };

export interface PluginAnswer {
  ok: boolean;
  message: string;
}

const REQUESTS = 'requests';
const ANSWERS = 'answers';
const ID = /^[0-9a-z-]{1,64}$/i;

/** Leaves a request for the plugin. */
export function addRequest(dir: string, request: PluginRequest): void {
  if (!ID.test(request.id)) {
    throw new Error(`Not a request id: ${request.id}`);
  }
  writeJson(join(dir, REQUESTS, `${request.id}.json`), request);
}

/** Takes the requests waiting, oldest first, and removes them. */
export function takeRequests(dir: string): PluginRequest[] {
  const folder = join(dir, REQUESTS);
  let files: string[];
  try {
    files = readdirSync(folder).filter((file) => file.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const requests: PluginRequest[] = [];
  for (const file of files) {
    const path = join(folder, file);
    try {
      const request = readJson(path) as PluginRequest | undefined;
      if (request && typeof request.name === 'string' && ID.test(String(request.id))) {
        requests.push(request);
      }
    } catch {
      // Half written or damaged: dropped, and the page times out.
    }
    rmSync(path, { force: true });
  }
  return requests;
}

/** Withdraws a request nobody took. */
export function dropRequest(dir: string, id: string): void {
  if (ID.test(id)) {
    rmSync(join(dir, REQUESTS, `${id}.json`), { force: true });
  }
}

/** Leaves the answer to a request. */
export function answer(dir: string, id: string, result: PluginAnswer): void {
  mkdirSync(join(dir, ANSWERS), { recursive: true });
  writeJson(join(dir, ANSWERS, `${id}.json`), result);
}

/** The answer to a request, once there is one, which is then removed. */
export function takeAnswer(dir: string, id: string): PluginAnswer | undefined {
  if (!ID.test(id)) {
    return undefined;
  }
  const path = join(dir, ANSWERS, `${id}.json`);
  let result: PluginAnswer | undefined;
  try {
    result = readJson(path) as PluginAnswer | undefined;
  } catch {
    return undefined; // still being written
  }
  if (result) {
    rmSync(path, { force: true });
  }
  return result;
}
