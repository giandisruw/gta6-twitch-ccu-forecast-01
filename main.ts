// gta6-twitch-ccu-forecast-01 entry v2 (Node 22, standard library only).
//
// Forecast: for each hour h = 2..24 of the release day, five quantiles of the
// Twitch concurrent-viewer count in the game's category, given hour 1's print.
//
// Model — log-log regression on rolling-midnight launches, with two changes
// over v1 (practice 0.1542):
//
//  1. Block-constant slopes. v1 fitted one slope per hour and smoothed it
//     with a 3-point moving average. With only ~12 launches a per-hour slope
//     is mostly noise, while the true slope profile is a slow curve: ~1.0
//     for hours 2-4 (the same regions are still the only ones awake), ~0.6
//     through the middle of the day, ~0.5 for the evening (the global
//     audience dominates). v2 pools the slope within four hour blocks
//     (2-4, 5-9, 10-16, 17-24) by a stacked regression with hour dummies,
//     and fits one intercept per hour from its block slope. Pooling cuts the
//     slope's estimation variance roughly fourfold; the per-hour intercept
//     keeps each hour's level free.
//
//  2. Honest out-of-sample spread. v1 set each hour's spread from the
//     in-sample regression residuals, which understate how far a NEW launch
//     lands from the line (the fit has seen those launches). v2 leaves each
//     training launch out in turn, predicts it from the other eleven, and
//     takes the quantiles of those leave-one-out residuals — the spread a
//     genuinely new launch faces. Each quantile is half the empirical
//     leave-one-out residual quantile and half a Gaussian quantile with
//     sigma 0.3 (the typical residual scale), so the tails stay sane with
//     only twelve residuals while the skew the data shows (residuals run
//     right-skewed mid-day) is kept.
//
// Measured on the four practice cases (answers re-read from the public
// SullyGnome source the kit names, scored with the contest's pinball loss):
//   v1: 0.187 / 0.103 / 0.104 / 0.224, mean 0.1542
//   v2: 0.170 / 0.109 / 0.104 / 0.206, mean 0.1471
// Leave-one-out over the twelve rolling-midnight comparables (each held-out
// launch scored against its own real curve): v1 0.2543, v2 0.2458.
// The gain is modest and the block choice moves the practice mean by
// ~0.005 across reasonable partitions, so v2 is an improvement, not a
// breakthrough: it does not reach the ~0.144 paid bar on practice.
//
// What was tried and dropped (same practice + leave-one-out scoring):
//   - shrinking evening slopes toward the unconditional mean: practice
//     0.138 but leave-one-out 0.267 — it only fits Wolverine's odd evening
//     and hurts 9 of 12 held-out launches; rejected as overfitting.
//   - median shift by the residual median: practice 0.149, leave-one-out
//     0.258 — no leave-one-out gain; rejected.
//   - Theil-Sen slopes: leave-one-out 0.248 but practice 0.171; rejected.
//   - k-nearest-neighbour shape, level+shape split, second regressors
//     (pre-release level, hour-1 channels), recency/similarity weights,
//     all 37 comparables instead of the rolling 12: all worse on one or
//     both scores; rejected.
//
// The entry reads only the case file it is given, runs offline with no
// network and no randomness, and is deterministic: two runs on the same case
// write byte-identical output.
//
// Usage (local): mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input \
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Lowest and highest median the model may output, as a multiple of hour 1. */
const MEDIAN_FLOOR_RATIO = 0.05;
const MEDIAN_CAP_RATIO = 20;
/** The Gaussian half of each quantile uses this log-scale sigma. */
const GAUSS_SIGMA = 0.3;
/** A regression needs at least this many launches to be trusted. */
const MIN_LAUNCHES = 4;
/** Hour blocks sharing one pooled log-log slope. */
const BLOCKS: Array<[number, number]> = [
  [2, 4],
  [5, 9],
  [10, 16],
  [17, 24],
];

interface CaseFile {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Array<{
    name: string;
    day_start: string;
    unlock: string;
    hourly: Array<{ from: string; viewers: number | null }>;
  }>;
}

interface LaunchCurve {
  name: string;
  /** log viewers for release-day hours 1..24. */
  logViewers: number[];
}

/** x rounded to 2 decimals (half up), as the house baseline rounds. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The p-th quantile of a list, by linear interpolation on sorted values. */
const quantileOf = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

/**
 * A comparable is a rolling-midnight launch when its unlock note says the
 * game unlocked at local midnight, rolling across time zones. Simultaneous
 * global unlocks (one fixed UTC hour) and early-access launches have a
 * different day shape, so they are left out of the fit.
 */
const isRollingMidnight = (unlock: string): boolean =>
  /midnight local|rolling/i.test(unlock);

/**
 * A comparable's release-day curve: log viewers for hours 1..24 counted from
 * its day_start. Only a launch with a complete day is usable — a sparse
 * category (for example GTA VI's own pre-release history, sampled about
 * every 12 hours) has holes in the day and is skipped, never interpolated.
 */
const releaseDayCurve = (c: CaseFile['comparables'][number]): LaunchCurve | null => {
  const t0 = Date.parse(c.day_start);
  if (Number.isNaN(t0)) return null;
  const byHour = new Map<number, number>();
  for (const row of c.hourly ?? []) {
    if (row.viewers == null || row.viewers <= 0) continue;
    const t = Date.parse(row.from);
    if (Number.isNaN(t)) continue;
    const h = Math.round((t - t0) / 3600000) + 1;
    if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, Math.log(row.viewers));
  }
  if (byHour.size !== 24) return null;
  const logViewers: number[] = [];
  for (let h = 1; h <= 24; h++) logViewers.push(byHour.get(h) as number);
  return { name: c.name, logViewers };
};

/**
 * The log median of each forecast hour under the block-slope model:
 * one pooled slope per hour block (stacked regression with hour dummies),
 * one intercept per hour. `hours` are the forecast hours (2..24).
 */
const blockSlopeMedians = (
  launches: LaunchCurve[],
  logP1: number,
  hours: number[],
): Map<number, number> => {
  const xs = launches.map((lc) => lc.logViewers[0]);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const medians = new Map<number, number>();
  for (const [lo, hi] of BLOCKS) {
    // Pooled slope over the block: within-hour demeaned regression.
    let num = 0;
    let den = 0;
    for (let h = lo; h <= hi; h++) {
      const ys = launches.map((lc) => lc.logViewers[h - 1]);
      const my = ys.reduce((s, y) => s + y, 0) / ys.length;
      for (let i = 0; i < launches.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) * (xs[i] - mx);
      }
    }
    const b = den > 0 ? num / den : 0;
    for (let h = lo; h <= hi; h++) {
      if (!hours.includes(h)) continue;
      const ys = launches.map((lc) => lc.logViewers[h - 1]);
      const my = ys.reduce((s, y) => s + y, 0) / ys.length;
      const a = my - b * mx;
      let mu = a + b * logP1;
      mu = Math.max(
        logP1 + Math.log(MEDIAN_FLOOR_RATIO),
        Math.min(logP1 + Math.log(MEDIAN_CAP_RATIO), mu),
      );
      medians.set(h, mu);
    }
  }
  return medians;
};

/**
 * The five quantiles for one hour. `mu` is the log median (already fitted
 * and clamped); `looResid` are that hour's leave-one-out residuals, the
 * honest spread of a new launch around the line.
 */
const hourQuantiles = (mu: number, looResid: number[]): number[] => {
  // Centre on the rounded median, as the scorer's reference does.
  const centre = Math.log(Math.max(1, round2(Math.exp(mu))));
  const q = LEVELS.map((tau, j) => {
    const emp = quantileOf(looResid, tau);
    const gauss = Z[j] * GAUSS_SIGMA;
    return round2(Math.max(1, Math.exp(centre + 0.5 * emp + 0.5 * gauss)));
  });
  for (let j = 1; j < q.length; j++) {
    if (q[j] < q[j - 1]) q[j] = q[j - 1];
  }
  return q;
};

/**
 * The persistence forecast the house baseline uses — the fallback when a
 * case has too few usable comparables to fit anything. Kept so the entry
 * still writes a valid forecast instead of failing outright.
 */
const persistenceQuantiles = (p1: number, h: number): number[] => {
  const q = Z.map((z) => round2(p1 * Math.exp(z * 0.15 * Math.sqrt(h - 1))));
  for (let j = 1; j < q.length; j++) {
    if (q[j] < q[j - 1]) q[j] = q[j - 1];
  }
  return q;
};

/** The forecast of one case: 23 rows, hours 2..24. */
const forecastCase = (c: CaseFile): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  const p1 = Math.max(1, first?.viewers ?? 1);
  const logP1 = Math.log(p1);
  const hours = c.forecast.map(({ hour }) => hour);

  // Rolling-midnight launches with a complete release day, in name order so
  // the fit — and therefore the output — is the same on every run.
  let launches = (c.comparables ?? [])
    .filter((comp) => isRollingMidnight(comp.unlock ?? ''))
    .map(releaseDayCurve)
    .filter((lc): lc is LaunchCurve => lc !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (launches.length < MIN_LAUNCHES) {
    launches = (c.comparables ?? [])
      .map(releaseDayCurve)
      .filter((lc): lc is LaunchCurve => lc !== null)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  if (launches.length < MIN_LAUNCHES) {
    return hours.map((hour) => ({ hour, q: persistenceQuantiles(p1, hour) }));
  }

  // Leave-one-out residuals: each launch predicted from the other launches,
  // so the spread is what a genuinely new launch faces, not the in-sample
  // fit's own residuals.
  const looResid = new Map<number, number[]>();
  for (const h of hours) looResid.set(h, []);
  for (let i = 0; i < launches.length; i++) {
    const held = launches[i];
    const rest = launches.filter((_, j) => j !== i);
    if (rest.length < MIN_LAUNCHES) continue;
    const medians = blockSlopeMedians(rest, held.logViewers[0], hours);
    for (const h of hours) {
      looResid.get(h)?.push(held.logViewers[h - 1] - (medians.get(h) as number));
    }
  }

  const medians = blockSlopeMedians(launches, logP1, hours);
  return hours.map((hour) => {
    const mu = medians.get(hour) as number;
    const resid = looResid.get(hour) as number[];
    // If the leave-one-out pass found nothing (tiny training set), fall
    // back to a Gaussian spread of the usual scale.
    const q = resid.length >= 4
      ? hourQuantiles(mu, resid)
      : Z.map((z) => round2(Math.max(1, Math.exp(mu + z * GAUSS_SIGMA))));
    for (let j = 1; j < q.length; j++) {
      if (q[j] < q[j - 1]) q[j] = q[j - 1];
    }
    return { hour, q };
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (
    c.levels.length !== LEVELS.length ||
    c.levels.some((t, j) => t !== LEVELS[j])
  ) {
    throw new Error(
      `${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`,
    );
  }
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
