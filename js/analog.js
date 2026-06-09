// A4 — analog / noise-margin model for ternary signals (slice 1 of the XL
// "transistor-level / analog mode" in roadmap Track A).
//
// The TritLogic solver is exact and discrete: a wire carries {−1, 0, +1} (plus
// null/Z). That's the right abstraction for designing logic, but it can't answer
// the *robustness* question a real chip lives or dies by: with actual voltages,
// finite noise, and detection thresholds, how reliably does each wire hold its
// trit? This module is that layer — a continuous-voltage view of a ternary
// signal, with thresholds, noise margins, an analytic symbol-error probability,
// and a Monte-Carlo robustness check over a circuit's net values.
//
// Scope: this is the *signal-level* analog model (the 3-level rail + detection),
// not full device physics. Transistor-level continuous simulation (per-gate
// transfer curves, drift, interference) is the remaining XL part of A4.
//
// Pure + deterministic (seeded), like ternary-train.js / photonic-twin.js.

// A symmetric 3-level rail: trit −1/0/+1 → voltage −vDrive/0/+vDrive, detected
// with two thresholds at ±thresh. Defaults give equal noise margins on every
// level (vDrive−thresh = thresh = 0.5), which is the balanced design point.
export const ANALOG_LEVELS_DEFAULT = Object.freeze({ vDrive: 1.0, thresh: 0.5 });

// trit → its nominal rail voltage.
export function tritToVoltage(t, levels = ANALOG_LEVELS_DEFAULT) {
  return t * levels.vDrive;
}

// noisy voltage → detected trit, via the two symmetric thresholds.
export function voltageToTrit(v, levels = ANALOG_LEVELS_DEFAULT) {
  const { thresh } = levels;
  if (v > thresh) return 1;
  if (v < -thresh) return -1;
  return 0;
}

// Static noise margin: the smallest distance from any nominal level to its
// nearest decision threshold. A ±1 level sits `vDrive−thresh` from its
// threshold; the 0 level sits `thresh` from each. The circuit margin is the min.
export function noiseMargin(levels = ANALOG_LEVELS_DEFAULT) {
  return Math.min(levels.vDrive - levels.thresh, levels.thresh);
}

// erfc — the complementary error function (JS lacks Math.erfc). Abramowitz &
// Stegun 7.1.26 rational approximation; |error| < 1.5e-7, ample for noise math.
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const tau = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
    t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
    t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? tau : 2 - tau;
}

// Analytic probability that an additive-Gaussian-noise sample (stdev `sigma`)
// flips a symbol's detected trit. A ±1 symbol errs by crossing its one near
// threshold (prob = ½·erfc(margin/(σ√2))); a 0 symbol errs across EITHER
// threshold (prob = erfc(thresh/(σ√2))), so the middle level is the weakest.
export function symbolErrorProb(trit, sigma, levels = ANALOG_LEVELS_DEFAULT) {
  if (sigma <= 0) return 0;
  const { vDrive, thresh } = levels;
  const ROOT2 = Math.SQRT2;
  if (trit === 0) return erfc(thresh / (sigma * ROOT2));
  return 0.5 * erfc((vDrive - thresh) / (sigma * ROOT2));
}

// Worst-case analytic symbol-error probability across the trits actually present
// on a set of nets — the bound a designer cares about.
export function worstCaseErrorProb(trits, sigma, levels = ANALOG_LEVELS_DEFAULT) {
  let worst = 0;
  for (const t of trits) worst = Math.max(worst, symbolErrorProb(t, sigma, levels));
  return worst;
}

// Seeded PRNG (mulberry32) + Box–Muller, local so the model is pure.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rnd) {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// Monte-Carlo robustness: take a list of nominal trit values (e.g. a circuit's
// output-net values from the discrete solver), drive each onto the rail, add
// Gaussian noise (stdev σ) over many trials, re-detect, and report the measured
// trit-error rate plus the static noise margin. This is the "random voltage
// fluctuations → does the circuit still read right?" robustness test. Seeded.
export function monteCarloErrorRate(trits, sigma, { trials = 2000, seed = 1,
                                                    levels = ANALOG_LEVELS_DEFAULT } = {}) {
  if (!trits.length) return { errorRate: 0, errors: 0, samples: 0, margin: noiseMargin(levels) };
  const rnd = mulberry32(seed);
  let errors = 0, samples = 0;
  for (let k = 0; k < trials; k++) {
    for (const t of trits) {
      const v = tritToVoltage(t, levels) + sigma * gaussian(rnd);
      if (voltageToTrit(v, levels) !== t) errors++;
      samples++;
    }
  }
  return { errorRate: errors / samples, errors, samples, margin: noiseMargin(levels) };
}
