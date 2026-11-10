/**
 * Phases told apart by a model of the appliance, learned from its readings,
 * rather than by rules.
 *
 * Each band a phase is configured with is a part of the appliance that adds
 * its draw to the rest: a coffee machine's pump, milk frother and grinder. A
 * phase with no upper end is a part at a level of its own, steady through a
 * session and only roughly known beforehand: the heater. The plug reads the
 * sum. The model keeps the likeliest ways each reading came about, which
 * parts were on and for how long, and settles on what they all agree on:
 * usually a second or two later, once the readings after have told, and
 * no later than MAX_LAG_MS.
 *
 * Nobody says what was right. What each part draws, how long it usually
 * runs, how often it starts beside the others and how far the voltage sags
 * under load are learned from the recording: the readings are explained with
 * what is known, what is known is measured again from that explanation, and
 * so on a few times over (hard EM). The bands keep each part to its own.
 *
 * A phase that only counts from above (onDown) is not a part of anything and
 * is left out.
 */
import type { Sample } from './learn.ts';
import type { PhaseConfig } from './phases.ts';

/** The longest a part is known to run, in seconds; longer counts as this. */
const CAP = 3600;
/** A part on for less is a reading on the way from one level to the next. */
const MIN_RUN = 2;
/**
 * How far what the appliance draws with nothing on may vary: standby, a
 * display, keeping warm. Narrower, and a coffee machine's 8–13 W after a shot
 * was the pump still running (5.11.2026).
 */
const BASE_MIN_SD = 5;
/** The share of readings that fit nothing: a plug's glitch, a moment between two levels. */
const OUTLIER = 0.08;
/** How far a level part's level wanders, in W² per second. */
const LEVEL_DRIFT = 0.5;
/** What a session knows of the level beforehand, as a spread: nothing yet, or what it was lately. */
const LEVEL_PRIOR_SD = 150;
const LEVEL_SEEN_SD = 25;
/** Switched on, the level part may draw differently than before (31.10.2026: 1200 W, then 1255). */
const LEVEL_JUMP = 0.1;
const LEVEL_JUMP_SD = 40;
/**
 * How many ways of explaining the readings are kept, and how far behind the
 * best one at most: e^-20, a way not worth following.
 */
const BEAM = 300;
const BEAM_MARGIN = 20;
/** Readings this far apart are separate sessions. */
const SESSION_GAP_MS = 300_000;
/**
 * The ways kept that count when settling: those this close to the best one,
 * e^-10 as likely. What they agree on is settled; no later than MAX_LAG_MS
 * after, and once no reading has come for QUIET_MS, the best one is.
 */
const AGREE_MARGIN = 5;
export const MAX_LAG_MS = 30_000;
const QUIET_MS = 3000;
/** How many times the readings are explained and the model measured again. */
export const LEARN_ROUNDS = 3;
/**
 * Before the model would correct the rules: learned from this many sessions
 * at least, about the same as the time before at least this many times
 * running, and its accounts of the readings with something on it learned
 * from adding up for this share of them at least, of as many at least.
 */
const READY_SESSIONS = 10;
const READY_STEADY = 1;
const READY_FIT = 0.9;
const READY_READINGS = 600;
/**
 * Where the rules and the model saw a phase differently, the model would
 * correct the rules if its account adds up for this share of the readings in
 * dispute at least, and theirs for this share at most.
 */
const CORRECT_FIT = 0.8;
const RULES_FIT = 0.2;
/** How long the settled readings are kept to judge by. */
const HISTORY_MS = 3_600_000;

export interface PartParams {
  name: string;
  minWatts: number;
  /** Left out for a level part. */
  maxWatts?: number;
  /** What it draws, for a level part what it draws beyond its level: nothing. */
  mean: number;
  sd: number;
  /** Starts per second, by which of the other parts are on (a bitmask over them). */
  onRate: number[];
  /** How long it ran, in seconds, each time it was seen to. */
  runs: number[];
}

/** What is learned, as saved. */
export interface ModelParams {
  parts: PartParams[];
  base: { mean: number; sd: number };
  /** How much less two parts on together draw, as a share of the product of their draws. */
  sag: number;
  /** The highest reading seen: for how likely one that fits nothing is. */
  outRange: number;
  /** The level part's level, as last seen steady; or halfway up its band before anything is. */
  level: number;
  levelSeen: boolean;
  /** How many sessions it was learned from. */
  sessions: number;
  /** How many times running it was learned about the same as the time before. */
  steady?: number;
  /** Of the readings with something on it learned from, how many, and the share its account adds up for. */
  busy?: number;
  addsUp?: number;
}

interface Part extends PartParams {
  pmf: Float64Array;
  surv: Float64Array;
}

interface Model {
  params: ModelParams;
  parts: Part[];
  levelPart: number;
}

/** One way of explaining the readings so far. */
interface Node {
  at: number;
  /** For each part: 0 off, or how many seconds it has been on. */
  ages: number[];
  /** The level part's level as this way knows it: mean and variance (a Kalman filter). */
  mu: number;
  v: number;
  score: number;
  /** Whether the reading fits the parts on, rather than being one on the way between two levels. */
  fits: boolean;
  parent: Node | undefined;
}

/** A part on from one moment to another, in ms. */
export interface PartRun {
  part: number;
  from: number;
  until: number;
}

/** A phase as the model saw it, in ms. */
export interface ModelRun {
  phase: string;
  from: number;
  until: number;
}

/** The phases the model follows: all but those counting only from above. */
export function modelPhases(phases: PhaseConfig[]): PhaseConfig[] {
  return phases.filter(({ onDown }) => !onDown);
}

/** The parts the phases describe: one per band, and one level part at most. */
function partsOf(phases: PhaseConfig[]): { name: string; minWatts: number; maxWatts?: number }[] {
  const parts: { name: string; minWatts: number; maxWatts?: number }[] = [];
  for (const { name, minWatts, maxWatts } of modelPhases(phases)) {
    const same = parts.some((part) => part.minWatts === minWatts && part.maxWatts === maxWatts);
    const secondLevel = maxWatts === undefined && parts.some((part) => part.maxWatts === undefined);
    if (!same && !secondLevel) {
      parts.push({ name, minWatts, ...(maxWatts === undefined ? {} : { maxWatts }) });
    }
  }
  return parts;
}

/** What is known from the phases alone, before any reading. */
export function initialParams(phases: PhaseConfig[], highest: number): ModelParams {
  const described = partsOf(phases);
  const parts = described.map((part): PartParams => ({
    ...part,
    mean: part.maxWatts === undefined ? 0 : (part.minWatts + part.maxWatts) / 2,
    sd: part.maxWatts === undefined ? 4 : (part.maxWatts - part.minWatts) / 6,
    onRate: new Array<number>(1 << Math.max(described.length - 1, 0)).fill(0.005),
    runs: [],
  }));
  const level = described.find((part) => part.maxWatts === undefined);
  return {
    parts,
    base: { mean: 3, sd: BASE_MIN_SD },
    sag: 0,
    outRange: Math.max(highest, 100),
    level: level ? (level.minWatts + Math.max(highest, level.minWatts)) / 2 : 0,
    levelSeen: false,
    sessions: 0,
  };
}

/** Whether saved parameters still fit the phases: their bands have not changed. */
export function fits(params: ModelParams, phases: PhaseConfig[]): boolean {
  const described = partsOf(phases);
  return described.length === params.parts.length &&
    described.every((part, index) => part.minWatts === params.parts[index]!.minWatts && part.maxWatts === params.parts[index]!.maxWatts);
}

function prepare(params: ModelParams): Model {
  const parts = params.parts.map((part): Part => {
    // How long it runs: a kernel in log time over the runs seen, and as much
    // as two runs' worth of "anything", every length as likely as its double.
    const pmf = new Float64Array(CAP + 1);
    for (let d = MIN_RUN; d <= CAP; d++) {
      pmf[d] = 2 / d;
    }
    for (const run of part.runs) {
      if (run < MIN_RUN) {
        continue;
      }
      for (let d = MIN_RUN; d <= CAP; d++) {
        const z = (Math.log(d) - Math.log(run)) / 0.12;
        if (Math.abs(z) < 4) {
          pmf[d] += Math.exp(-0.5 * z * z) / d;
        }
      }
    }
    normalise(pmf);
    const surv = new Float64Array(CAP + 2);
    surv[0] = 1;
    for (let d = 0; d <= CAP; d++) {
      surv[d + 1] = Math.max(surv[d]! - pmf[d]!, 1e-9);
    }
    return { ...part, pmf, surv };
  });
  return { params, parts, levelPart: parts.findIndex((part) => part.maxWatts === undefined) };
}

function normalise(values: Float64Array): void {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  for (let index = 0; index < values.length; index++) {
    values[index]! /= sum;
  }
}

/** Which of the other parts are on, as a bitmask over them. */
function othersOn(ages: number[], part: number): number {
  let mask = 0;
  let bit = 0;
  for (let other = 0; other < ages.length; other++) {
    if (other === part) {
      continue;
    }
    if (ages[other]! > 0) {
      mask |= 1 << bit;
    }
    bit++;
  }
  return mask;
}

/** What the plug should read with these parts on: its mean and variance. */
function expected(model: Model, ages: number[], mu: number, v: number): { mean: number; variance: number } {
  const { params, parts, levelPart } = model;
  let mean = params.base.mean;
  let variance = params.base.sd ** 2;
  const on: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (ages[index] === 0) {
      continue;
    }
    const draw = index === levelPart ? mu : part.mean;
    on.push(draw);
    mean += draw;
    variance += part.sd ** 2 + (index === levelPart ? v : 0);
  }
  for (let a = 0; a < on.length; a++) {
    for (let b = a + 1; b < on.length; b++) {
      mean -= params.sag * on[a]! * on[b]!;
    }
  }
  return { mean, variance };
}

/** How likely a reading is with these parts on, and the level known after it. */
function emit(model: Model, ages: number[], mu: number, v: number, watts: number): { log: number; mu: number; v: number; fits: boolean } {
  const { params, levelPart } = model;
  const { mean, variance } = expected(model, ages, mu, v);
  const gauss = Math.exp(-0.5 * (watts - mean) ** 2 / variance) / Math.sqrt(2 * Math.PI * variance);
  const log = Math.log((1 - OUTLIER) * gauss + OUTLIER / params.outRange);
  // The level learns from a reading that fits, not from one on the way.
  const fits = Math.abs(watts - mean) < 4 * Math.sqrt(variance);
  if (levelPart >= 0 && ages[levelPart]! > 0 && fits) {
    const gain = v / variance;
    return { log, mu: mu + gain * (watts - mean), v: v * (1 - gain), fits };
  }
  return { log, mu, v, fits };
}

/** The log odds of a part staying as it is, or switching, over dt seconds. */
function moves(model: Model, ages: number[], index: number, dt: number): [number, number] {
  const part = model.parts[index]!;
  const age = ages[index]!;
  if (age === 0) {
    const on = 1 - Math.pow(1 - part.onRate[othersOn(ages, index)]!, dt);
    return [Math.log(1 - on), Math.log(on)];
  }
  const keep = age >= CAP ? 0.999 : Math.min(part.surv[Math.min(age + dt, CAP)]! / part.surv[age]!, 1);
  return [Math.log(Math.max(keep, 1e-12)), Math.log(Math.max(1 - keep, 1e-12))];
}

/** At most two parts switch between two readings: one of them, two, or none; as bitmasks. */
function switchSets(count: number): number[] {
  const sets = [0];
  for (let a = 0; a < count; a++) {
    sets.push(1 << a);
  }
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      sets.push((1 << a) | (1 << b));
    }
  }
  return sets;
}

/** Which parts are on and for how long, as one key; a number while that is exact. */
function keyOf(ages: number[]): number | string {
  if (ages.length > 4) {
    return ages.join(',');
  }
  let key = 0;
  for (const age of ages) {
    key = key * (CAP + 1) + age;
  }
  return key;
}

/**
 * Follows readings as they come, keeping the likeliest ways they came about.
 * Time is passed in, in ms.
 */
class Beam {
  readonly #model: Model;
  readonly #sets: number[];
  #nodes: Node[] = [];

  constructor(model: Model, at: number, watts: number, level: number, levelSd: number) {
    this.#model = model;
    this.#sets = switchSets(model.parts.length);
    const ages = new Array<number>(model.parts.length).fill(0);
    const first = emit(model, ages, level, levelSd ** 2, watts);
    this.#nodes = [{ at, ages, mu: first.mu, v: first.v, score: first.log, fits: first.fits, parent: undefined }];
  }

  get best(): Node {
    return this.#nodes[0]!;
  }

  get nodes(): Node[] {
    return this.#nodes;
  }

  /**
   * Up to when the likely ways agree on which parts were on, from a moment
   * on. Not on how long each had been: whether the heater came on a second
   * earlier or later keeps two ways apart for as long as it runs.
   */
  agreedAt(after: number): number {
    const likely = this.#nodes.filter(({ score }) => score >= this.best.score - AGREE_MARGIN);
    const paths = likely.map((node) => {
      const path: Node[] = [];
      for (let at: Node | undefined = node; at && at.at > after; at = at.parent) {
        path.push(at);
      }
      return path.reverse();
    });
    const best = paths[0]!;
    let agreed = after;
    for (const [index, node] of best.entries()) {
      const same = paths.every((path) => path[index] !== undefined && path[index]!.at === node.at &&
        path[index]!.ages.every((age, part) => (age > 0) === (node.ages[part]! > 0)));
      if (!same) {
        break;
      }
      agreed = node.at;
    }
    return agreed;
  }

  reading(at: number, watts: number): void {
    const model = this.#model;
    const count = model.parts.length;
    const dt = Math.min(Math.max(Math.round((at - this.best.at) / 1000), 1), 10);
    const next = new Map<number | string, Node>();
    for (const node of this.#nodes) {
      const odds = model.parts.map((_, index) => moves(model, node.ages, index, dt));
      const staying = odds.reduce((sum, [stay]) => sum + stay, 0);
      for (const set of this.#sets) {
        const ages = new Array<number>(count);
        let score = staying;
        let possible = true;
        for (let index = 0; index < count; index++) {
          const age = node.ages[index]!;
          if (set & (1 << index)) {
            score += odds[index]![1] - odds[index]![0];
            ages[index] = age === 0 ? Math.max(1, Math.round(dt / 2)) : 0;
            possible &&= age === 0 || age >= MIN_RUN;
          } else {
            ages[index] = age === 0 ? 0 : Math.min(age + dt, CAP);
          }
        }
        if (!possible) {
          continue;
        }
        const v = node.v + LEVEL_DRIFT * dt;
        const level = model.levelPart;
        const switchedOn = level >= 0 && node.ages[level] === 0 && ages[level]! > 0;
        const variants: [number, number][] = switchedOn
          ? [[v, Math.log(1 - LEVEL_JUMP)], [Math.max(v, LEVEL_JUMP_SD ** 2), Math.log(LEVEL_JUMP)]]
          : [[v, 0]];
        const key = keyOf(ages);
        for (const [variance, cost] of variants) {
          const seen = emit(model, ages, node.mu, variance, watts);
          const total = node.score + score + cost + seen.log;
          const known = next.get(key);
          if (!known || known.score < total) {
            next.set(key, { at, ages, mu: seen.mu, v: seen.v, score: total, fits: seen.fits, parent: node });
          }
        }
      }
    }
    const sorted = [...next.values()].sort((a, b) => b.score - a.score);
    const floor = sorted[0]!.score - BEAM_MARGIN;
    this.#nodes = sorted.slice(0, BEAM).filter(({ score }) => score >= floor);
  }
}

/** The best way through, oldest first. */
function pathOf(node: Node): Node[] {
  const path: Node[] = [];
  for (let at: Node | undefined = node; at; at = at.parent) {
    path.push(at);
  }
  return path.reverse();
}

/**
 * Where the parts' runs start and end along a way through: from the first
 * reading the part being on explains to the reading after the last one, not
 * at a reading on the way between two levels (9.11.2026: 398.7 and 29.3 W as
 * the heater went off and the pump on, a coffee taken for 3 s longer).
 */
class Edges {
  readonly #since: (number | undefined)[];
  /** When the reading after the last one explained came, for a part on. */
  readonly #endAt: (number | undefined)[];
  readonly #lastFits: boolean[];

  constructor(count: number) {
    this.#since = new Array<undefined>(count).fill(undefined);
    this.#endAt = new Array<undefined>(count).fill(undefined);
    this.#lastFits = new Array<boolean>(count).fill(false);
  }

  running(part: number): boolean {
    return this.#since[part] !== undefined;
  }

  /** The next node along the way; the runs it ends. */
  node(node: Node): PartRun[] {
    const ended: PartRun[] = [];
    for (let part = 0; part < this.#since.length; part++) {
      if (this.#lastFits[part]) {
        this.#endAt[part] = node.at;
        this.#lastFits[part] = false;
      }
      const since = this.#since[part];
      if (node.ages[part]! > 0) {
        if (node.fits) {
          this.#since[part] ??= node.at;
          this.#lastFits[part] = true;
        }
      } else if (since !== undefined) {
        ended.push({ part, from: since, until: this.#endAt[part] ?? node.at });
        this.#since[part] = undefined;
      }
    }
    return ended;
  }

  /** The runs still going, as ending at a moment: the end of the session. */
  close(at: number): PartRun[] {
    const ended: PartRun[] = [];
    for (const [part, since] of this.#since.entries()) {
      if (since !== undefined) {
        ended.push({ part, from: since, until: this.#lastFits[part] ? at : (this.#endAt[part] ?? at) });
        this.#since[part] = undefined;
        this.#lastFits[part] = false;
      }
    }
    return ended;
  }
}

/** When each part was on along a path. */
function partRuns(path: Node[], count: number): PartRun[] {
  const edges = new Edges(count);
  const found = path.flatMap((node) => edges.node(node));
  return [...found, ...edges.close(path[path.length - 1]!.at)];
}

/**
 * The level part's level a session most often held steady: readings at or
 * above its lower end, as close as 10 W to the one before, in 10 W bins. It
 * is on alone most of the time — heating up, keeping warm — so that is it.
 */
function steadyLevel(params: ModelParams, watts: number[]): number | undefined {
  const part = params.parts.find(({ maxWatts }) => maxWatts === undefined);
  if (!part) {
    return undefined;
  }
  const bins = new Map<number, number[]>();
  for (let index = 1; index < watts.length; index++) {
    const value = watts[index]!;
    if (value >= part.minWatts && Math.abs(value - watts[index - 1]!) <= 10) {
      const bin = Math.round(value / 10);
      bins.set(bin, [...(bins.get(bin) ?? []), value]);
    }
  }
  let best: number[] = [];
  for (const [bin, values] of bins) {
    const around = [...values, ...(bins.get(bin - 1) ?? []), ...(bins.get(bin + 1) ?? [])];
    if (around.length > best.length) {
      best = around;
    }
  }
  if (best.length < 10) {
    return undefined;
  }
  best.sort((a, b) => a - b);
  return best[Math.floor(best.length / 2)]! - params.base.mean;
}

/** Readings split where they stop for a while, and only those where something was on. */
export function sessionsOf(samples: Sample[], phases: PhaseConfig[]): Sample[][] {
  const lowest = Math.min(...modelPhases(phases).map(({ minWatts }) => minWatts));
  const found: Sample[][] = [];
  let current: Sample[] = [];
  for (const sample of samples) {
    if (current.length > 0 && sample.at - current[current.length - 1]!.at > SESSION_GAP_MS) {
      found.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) {
    found.push(current);
  }
  return found.filter((session) => session.some(({ watts }) => watts >= lowest));
}

interface Explained {
  watts: number[];
  path: Node[];
}

/** Explains a session as a whole, knowing its steady level beforehand. */
function explain(model: Model, session: Sample[]): Explained {
  const watts = session.map((sample) => sample.watts);
  const seen = steadyLevel(model.params, watts);
  const beam = new Beam(model, session[0]!.at, watts[0]!, seen ?? model.params.level, seen === undefined ? LEVEL_PRIOR_SD : LEVEL_SEEN_SD);
  for (let index = 1; index < session.length; index++) {
    beam.reading(session[index]!.at, watts[index]!);
  }
  return { watts, path: pathOf(beam.best) };
}

/** The middle and spread of some values, robust against a few that fit nothing. */
function middle(values: number[]): { mean: number; sd: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return { mean: median, sd: Math.max(1.4826 * deviations[Math.floor(deviations.length / 2)]!, 1) };
}

/** Measures the model again from how it explained the sessions. */
function measure(params: ModelParams, explained: Explained[]): ModelParams {
  const count = params.parts.length;
  const contexts = 1 << Math.max(count - 1, 0);
  const alone: number[][] = params.parts.map(() => []);
  const rest: number[] = [];
  const levelOff: number[] = [];
  const levels: number[] = [];
  const runs: number[][] = params.parts.map(() => []);
  const starts = params.parts.map(() => new Float64Array(contexts));
  const exposed = params.parts.map(() => new Float64Array(contexts));
  let sxy = 0;
  let sxx = 0;
  const same = (a: Node, b: Node) => a.ages.every((age, index) => (age > 0) === (b.ages[index]! > 0));
  let busy = 0;
  let addsUp = 0;
  for (const { watts, path } of explained) {
    for (const [index, node] of path.entries()) {
      if (node.ages.some((age) => age > 0)) {
        busy++;
        addsUp += node.fits ? 1 : 0;
      }
      const on = [...node.ages].flatMap((age, part) => (age > 0 ? [part] : []));
      const reading = watts[index]!;
      // Only readings the same parts were on before and after: not one on the way.
      if (index > 0 && index < path.length - 1 && same(path[index - 1]!, node) && same(path[index + 1]!, node)) {
        if (on.length === 0) {
          rest.push(reading);
        } else if (on.length === 1) {
          const part = on[0]!;
          if (params.parts[part]!.maxWatts === undefined) {
            levelOff.push(reading - params.base.mean - node.mu);
          } else {
            alone[part]!.push(reading - params.base.mean);
          }
        } else {
          const draws = on.map((part) => (params.parts[part]!.maxWatts === undefined ? node.mu : params.parts[part]!.mean));
          let product = 0;
          for (let a = 0; a < draws.length; a++) {
            for (let b = a + 1; b < draws.length; b++) {
              product += draws[a]! * draws[b]!;
            }
          }
          const missing = reading - params.base.mean - draws.reduce((sum, draw) => sum + draw, 0);
          sxy -= missing * product;
          sxx += product * product;
        }
      }
      if (index > 0) {
        const before = path[index - 1]!;
        const dt = Math.min(Math.max(Math.round((node.at - before.at) / 1000), 1), 10);
        for (let part = 0; part < count; part++) {
          if (before.ages[part] === 0) {
            const context = othersOn(before.ages, part);
            exposed[part]![context]! += dt;
            if (node.ages[part]! > 0) {
              starts[part]![context]! += 1;
            }
          }
        }
      }
    }
    for (const run of partRuns(path, count)) {
      runs[run.part]!.push(Math.round((run.until - run.from) / 1000));
    }
    const level = steadyLevel(params, watts);
    if (level !== undefined) {
      levels.push(level);
    }
  }
  const parts = params.parts.map((part, index): PartParams => {
    const measured = { ...part, runs: runs[index]!.filter((run) => run >= MIN_RUN) };
    if (part.maxWatts !== undefined && alone[index]!.length >= 20) {
      const { mean, sd } = middle(alone[index]!);
      measured.mean = mean;
      measured.sd = Math.max(sd, 2);
    }
    if (part.maxWatts === undefined && levelOff.length >= 20) {
      measured.sd = Math.max(middle(levelOff).sd, 2);
    }
    // Rarely seen, a start is about as likely as one in 200 s, not never.
    measured.onRate = [...starts[index]!].map((started, context) => (started + 0.5) / (exposed[index]![context]! + 100));
    return measured;
  });
  const base = rest.length >= 20 ? middle(rest) : params.base;
  return {
    ...params,
    parts,
    base: { mean: base.mean, sd: Math.max(base.sd, BASE_MIN_SD) },
    sag: sxx > 0 ? Math.max(sxy / sxx, 0) : params.sag,
    ...(levels.length > 0 ? { level: levels[levels.length - 1]!, levelSeen: true } : {}),
    sessions: explained.length,
    busy,
    addsUp: busy > 0 ? addsUp / busy : 0,
  };
}

/**
 * Learns the model from a recording, from what the phases say alone: some
 * rounds of explaining the sessions and measuring again. Takes a while — on
 * a Raspberry Pi a minute or more for two weeks of a coffee machine — and is
 * meant for a worker thread.
 */
export function learnModel(phases: PhaseConfig[], samples: Sample[], rounds = LEARN_ROUNDS): ModelParams {
  const sessions = sessionsOf(samples, phases);
  let params = initialParams(phases, Math.max(0, ...samples.map(({ watts }) => watts)));
  if (params.parts.length === 0) {
    return params;
  }
  for (let round = 0; round < rounds; round++) {
    const model = prepare(params);
    params = measure(params, sessions.map((session) => explain(model, session)));
  }
  return params;
}

/** The phases in when the parts were on: by their bands, how long they lasted, and their hold. */
export function phaseRuns(phases: PhaseConfig[], params: ModelParams, runs: PartRun[]): ModelRun[] {
  const found: ModelRun[] = [];
  for (const phase of modelPhases(phases)) {
    const part = params.parts.findIndex((each) => each.minWatts === phase.minWatts && each.maxWatts === phase.maxWatts);
    // A thermostat switching the heater on and off is one heating, as with
    // the rules; by difference the phase ends as the draw falls below its band.
    const holdMs = phase.byDifference ? 0 : (phase.holdSeconds ?? 30) * 1000;
    // How long it was on counts added up, as with the rules: a heater on now
    // and then beside a coffee is no heating up.
    const merged: (PartRun & { onMs: number })[] = [];
    for (const run of runs.filter((each) => each.part === part).sort((a, b) => a.from - b.from)) {
      const last = merged[merged.length - 1];
      if (last && run.from - last.until < holdMs) {
        last.onMs += run.until - Math.max(run.from, last.until);
        last.until = Math.max(last.until, run.until);
      } else {
        merged.push({ ...run, onMs: run.until - run.from });
      }
    }
    for (const run of merged) {
      const lasted = run.until - run.from;
      if (run.onMs >= (phase.minSeconds ?? 5) * 1000 && (phase.maxSeconds === undefined || lasted < phase.maxSeconds * 1000)) {
        found.push({ phase: phase.name, from: run.from, until: run.until });
      }
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

/**
 * Follows one appliance's readings as they come and tells, a few seconds
 * late, when each part ran. Runs are told once they are over.
 */
export class ModelWatcher {
  readonly #phases: PhaseConfig[];
  readonly #model: Model;
  #level: number;
  #levelSeen: boolean;
  #beam: Beam | undefined;
  #session: number[] = [];
  /** How far the readings are settled, and which parts were on then, since when. */
  #settledAt = -Infinity;
  #edges: Edges;
  /** Runs over, waiting for the hold: a heater's next switching on may still belong to them. */
  #done: PartRun[] = [];
  #lastAt: number | undefined;
  /** The readings not settled yet, and those settled lately with what the model made of them. */
  #unsettled = new Map<number, number>();
  #history: Settled[] = [];

  constructor(phases: PhaseConfig[], params: ModelParams) {
    this.#phases = phases;
    this.#model = prepare(params);
    this.#level = params.level;
    this.#levelSeen = params.levelSeen;
    this.#edges = new Edges(params.parts.length);
  }

  get params(): ModelParams {
    return this.#model.params;
  }

  /** A reading; what is settled by it, as phases over. */
  reading(at: number, watts: number): ModelRun[] {
    const told = this.#lastAt !== undefined && at - this.#lastAt > SESSION_GAP_MS ? this.#endSession() : [];
    this.#lastAt = at;
    this.#unsettled.set(at, watts);
    if (this.#beam) {
      this.#beam.reading(at, watts);
    } else {
      this.#beam = new Beam(this.#model, at, watts, this.#level, this.#levelSeen ? LEVEL_SEEN_SD : LEVEL_PRIOR_SD);
    }
    this.#session.push(watts);
    this.#settle(Math.max(this.#beam.agreedAt(this.#settledAt), at - MAX_LAG_MS));
    return [...told, ...this.#tell(this.#settledAt)];
  }

  /** Time passing: once no reading has come for the lag, the last one is settled, and once for long, the session is over. */
  tick(at: number): ModelRun[] {
    if (this.#lastAt === undefined) {
      return this.#tell(-Infinity);
    }
    if (at - this.#lastAt > SESSION_GAP_MS) {
      return this.#endSession();
    }
    if (at - this.#lastAt >= QUIET_MS) {
      this.#settle(this.#lastAt);
    }
    // With all readings settled, nothing has changed since the last: a plug
    // reports a change as it comes.
    return this.#tell(this.#settledAt === this.#lastAt ? at : this.#settledAt);
  }

  #endSession(): ModelRun[] {
    const lastAt = this.#lastAt!;
    this.#settle(lastAt);
    this.#done.push(...this.#edges.close(lastAt));
    const level = steadyLevel(this.#model.params, this.#session);
    if (level !== undefined) {
      this.#level = level;
      this.#levelSeen = true;
    }
    this.#beam = undefined;
    this.#unsettled.clear();
    this.#session = [];
    this.#settledAt = -Infinity;
    return this.#tell(Infinity);
  }

  /** Takes the best way through as it stands up to a moment, from where it was settled before. */
  #settle(upTo: number): void {
    if (!this.#beam) {
      return;
    }
    const fresh: Node[] = [];
    for (let node: Node | undefined = this.#beam.best; node && node.at > this.#settledAt; node = node.parent) {
      if (node.at <= upTo) {
        fresh.push(node);
      }
    }
    fresh.reverse();
    for (const node of fresh) {
      this.#done.push(...this.#edges.node(node));
      this.#settledAt = node.at;
      const watts = this.#unsettled.get(node.at);
      this.#unsettled.delete(node.at);
      if (watts !== undefined) {
        this.#history.push({ at: node.at, watts, ages: node.ages, mu: node.mu });
      }
    }
    const kept = this.#settledAt - HISTORY_MS;
    if (this.#history.length > 0 && this.#history[0]!.at < kept) {
      this.#history = this.#history.filter(({ at }) => at >= kept);
    }
    // What is settled is not looked at again: let it go.
    for (const node of this.#beam.nodes) {
      for (let at: Node | undefined = node; at; at = at.parent) {
        if (at.parent && at.parent.at <= this.#settledAt) {
          at.parent.parent = undefined;
          break;
        }
      }
    }
  }

  /**
   * Whether the model would correct the rules on a phase they saw
   * differently, and why: whether its account of the readings in dispute
   * adds up where theirs does not. Theirs is the model's with the phase's
   * part on or off as the rules had the phase.
   */
  judge(phase: string, rules: ModelRun | undefined, model: ModelRun | undefined): Verdict {
    const unready = this.unready();
    if (unready) {
      return { corrects: false, reason: unready };
    }
    const config = modelPhases(this.#phases).find(({ name }) => name === phase);
    const part = config ? this.#model.parts.findIndex((each) => each.minWatts === config.minWatts && each.maxWatts === config.maxWatts) : -1;
    const within = (run: ModelRun | undefined, at: number) => run !== undefined && at >= run.from && at < run.until;
    let disputed = 0;
    const mine = { fit: 0, off: 0 };
    const theirs = { fit: 0, off: 0 };
    const add = (account: typeof mine, ages: number[], settled: Settled) => {
      const { mean, variance } = expected(this.#model, ages, settled.mu, 0);
      account.off += Math.abs(settled.watts - mean);
      account.fit += Math.abs(settled.watts - mean) < 4 * Math.sqrt(variance) ? 1 : 0;
    };
    // Within the rules' phase the part may rest for a while, a heater between
    // two switchings on: they say it was on from their start to where the
    // model has it first on, and from where it has it last on to their end.
    const onAt = this.#history.filter((settled) => within(rules, settled.at) && settled.ages[part]! > 0).map(({ at }) => at);
    const claimed = (at: number) => within(rules, at) && (onAt.length === 0 || at < onAt[0]! || at > onAt[onAt.length - 1]!);
    for (const settled of part < 0 ? [] : this.#history) {
      if (!within(rules, settled.at) && !within(model, settled.at)) {
        continue;
      }
      const modelOn = settled.ages[part]! > 0;
      const rulesOn = within(rules, settled.at) ? claimed(settled.at) || modelOn : false;
      // A reading in the band the rules saw, and let pass for being too short
      // or too long: they do not say the part was off, only that it was no
      // phase (7.11.2026: a heater on for 177 s of 180).
      const inBand = settled.watts >= config!.minWatts && settled.watts < (config!.maxWatts ?? Infinity);
      if (rulesOn === modelOn || (!rulesOn && inBand)) {
        continue;
      }
      disputed++;
      add(mine, settled.ages, settled);
      add(theirs, settled.ages.map((age, index) => (index === part ? (rulesOn ? 1 : 0) : age)), settled);
    }
    if (disputed === 0) {
      return { corrects: false, reason: 'the part on and off as the rules have it, the phase cut differently' };
    }
    const corrects = mine.fit >= CORRECT_FIT * disputed && theirs.fit <= RULES_FIT * disputed;
    const watts = (account: typeof mine) => `${Math.round(account.off / disputed)} W`;
    return {
      corrects,
      reason: `the rules' account off by ${watts(theirs)} over ${disputed} reading${disputed === 1 ? '' : 's'}, the model's by ${watts(mine)}`,
    };
  }

  /** Why the model would not correct the rules at all yet, if it would not. */
  unready(): string | undefined {
    const { sessions, steady = 0, busy = 0, addsUp = 0 } = this.#model.params;
    if (sessions < READY_SESSIONS) {
      return `learned from ${sessions} session${sessions === 1 ? '' : 's'} only, needs ${READY_SESSIONS}`;
    }
    if (steady < READY_STEADY) {
      return 'not yet learned about the same twice running';
    }
    if (busy < READY_READINGS) {
      return `learned from ${busy} readings with something on only, needs ${READY_READINGS}`;
    }
    if (addsUp < READY_FIT) {
      return `its accounts add up for ${Math.round(100 * addsUp)} % of the readings only, needs ${100 * READY_FIT} %`;
    }
    return undefined;
  }

  /** The longest hold of the phases of a part's band that have one: see phaseRuns. */
  #holdMs(part: number): number {
    const { minWatts, maxWatts } = this.#model.parts[part]!;
    const holds = modelPhases(this.#phases)
      .filter((phase) => phase.minWatts === minWatts && phase.maxWatts === maxWatts && !phase.byDifference)
      .map(({ holdSeconds }) => (holdSeconds ?? 30) * 1000);
    return Math.max(0, ...holds);
  }

  /**
   * The runs over whose hold is over too, as phases: over by what is settled,
   * not by the clock, or a heater's next switching on in a few seconds, not
   * settled yet, would be missed and the heating cut short (6.11.2026: 515 s
   * of 1253).
   */
  #tell(at: number): ModelRun[] {
    // A part's runs within its hold of each other are one: told together once
    // the last is over and its hold too, or a later run starts after it.
    const ready: PartRun[] = [];
    for (let part = 0; part < this.#model.parts.length; part++) {
      const holdMs = this.#holdMs(part);
      const runs = this.#done.filter((run) => run.part === part).sort((a, b) => a.from - b.from);
      let chain: PartRun[] = [];
      for (const [index, run] of runs.entries()) {
        chain.push(run);
        const next = runs[index + 1];
        if (next ? next.from - run.until >= holdMs : run.until + holdMs <= at && !this.#edges.running(part)) {
          ready.push(...chain);
        }
        if (!next || next.from - run.until >= holdMs) {
          chain = [];
        }
      }
    }
    if (ready.length === 0) {
      return [];
    }
    this.#done = this.#done.filter((run) => !ready.includes(run));
    return phaseRuns(this.#phases, this.#model.params, ready);
  }
}

/** A reading settled, and what the model made of it. */
interface Settled {
  at: number;
  watts: number;
  ages: number[];
  mu: number;
}

/** Whether the model would correct the rules on a phase, and why. */
export interface Verdict {
  corrects: boolean;
  reason: string;
}

/**
 * Whether what was learned now is about what was learned before: each part
 * drawing within twice its spread of before, and the level within 50 W.
 */
export function aboutTheSame(before: ModelParams, now: ModelParams): boolean {
  return before.parts.length === now.parts.length &&
    before.parts.every((part, index) => {
      const other = now.parts[index]!;
      return part.maxWatts === undefined
        ? Math.abs(before.level - now.level) <= 50
        : Math.abs(part.mean - other.mean) <= 2 * Math.max(part.sd, other.sd, 2);
    });
}

/** A line for the log: what was learned. */
export function describeParams(params: ModelParams): string {
  const parts = params.parts.map((part) => {
    const runs = typicalRuns(part.runs);
    const draw = part.maxWatts === undefined ? `about ${Math.round(params.level)}` : `${Math.round(part.mean)} ± ${part.sd.toFixed(1)}`;
    return `${part.name} ${draw} W${runs ? `, runs ${runs}` : ''}`;
  });
  return `learned from ${params.sessions} session${params.sessions === 1 ? '' : 's'}: ${parts.join('; ')}`;
}

/** The lengths a part runs most often, up to two, as "7 s / 24 s". */
function typicalRuns(runs: number[]): string {
  if (runs.length < 3) {
    return '';
  }
  const counts = new Map<number, number>();
  for (const run of runs) {
    // In steps of a tenth in log time: 7 s and 8 s are one length, 7 and 24 are two.
    const bin = Math.round(Math.log(run) * 5);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([bin]) => Math.round(Math.exp(bin / 5)));
  return top.sort((a, b) => a - b).map((seconds) => `${seconds} s`).join(' / ');
}

/** How long after a run ends both sides have told it: the longest hold, the lag, and some. */
const COMPARE_AFTER_MS = 120_000;
/** Two runs of a phase starting this close, or overlapping, are the same one. */
const SAME_START_MS = 8000;
/** Two runs of the same one agree when they last this nearly as long. */
const SAME_LENGTH_MS = 2000;

export interface Compared {
  phase: string;
  at: number;
  /** How long each side had it, in seconds; undefined where it saw nothing. */
  rules: number | undefined;
  model: number | undefined;
  agree: boolean;
  /** The runs themselves, to judge by. */
  runs: { rules?: ModelRun; model?: ModelRun };
}

/**
 * The rules' phases and the model's side by side, while the model only
 * watches: each pair once both have told it, or one alone once the other has
 * had time to.
 */
/** Two runs of a phase that are the same one: starting close together, or overlapping. */
export function sameRun(a: ModelRun, b: ModelRun): boolean {
  return a.phase === b.phase && (Math.abs(a.from - b.from) <= SAME_START_MS || (a.from < b.until && b.from < a.until));
}

export class Comparison {
  #rules: ModelRun[] = [];
  #model: ModelRun[] = [];
  /** The phases the rules have on, since when: they tell a run only once it is over. */
  #open = new Map<string, number>();

  /** A phase the rules have just turned on, from when. */
  opened(phase: string, from: number): void {
    this.#open.set(phase, from);
  }

  rule(run: ModelRun): void {
    this.#open.delete(run.phase);
    this.#rules.push(run);
  }

  model(run: ModelRun): void {
    this.#model.push(run);
  }

  settle(at: number): Compared[] {
    const ready = (run: ModelRun) => run.until + COMPARE_AFTER_MS <= at;
    const told: Compared[] = [];
    const seconds = (run: ModelRun) => Math.round((run.until - run.from) / 1000);
    for (const rule of this.#rules.filter(ready)) {
      const match = this.#model.find((run) => sameRun(run, rule));
      if (match && !ready(match)) {
        continue;
      }
      this.#rules = this.#rules.filter((run) => run !== rule);
      this.#model = this.#model.filter((run) => run !== match);
      const agree = match !== undefined && Math.abs(match.until - match.from - (rule.until - rule.from)) <= SAME_LENGTH_MS;
      told.push({ phase: rule.phase, at: rule.from, rules: seconds(rule), model: match && seconds(match), agree, runs: { rules: rule, ...(match ? { model: match } : {}) } });
    }
    for (const run of this.#model.filter(ready)) {
      const open = this.#open.get(run.phase);
      const waiting = open !== undefined && (Math.abs(run.from - open) <= SAME_START_MS || open < run.until);
      if (!waiting && !this.#rules.some((rule) => sameRun(rule, run))) {
        this.#model = this.#model.filter((each) => each !== run);
        told.push({ phase: run.phase, at: run.from, rules: undefined, model: seconds(run), agree: false, runs: { model: run } });
      }
    }
    return told.sort((a, b) => a.at - b.at);
  }
}
