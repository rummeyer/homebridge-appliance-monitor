/**
 * Learns a model in a thread of its own: it takes a minute or more, and
 * Homebridge has to go on answering HomeKit meanwhile. See model.ts.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { learnModel } from './model.ts';
import type { PhaseConfig } from './phases.ts';
import { readSamples } from './recorder.ts';

export interface LearnRequest {
  dir: string;
  device: string;
  phases: PhaseConfig[];
  from: number;
  to: number;
}

const { dir, device, phases, from, to } = workerData as LearnRequest;
parentPort!.postMessage(learnModel(phases, readSamples(dir, device, from, to)));
