// P2 — the photonic 3×3 crossbar's value-level "twin" (Strategic Push 2).
//
// Strategic Push 2 (the Photonic-AI bridge) connects TritLogic's Neural-Net kit
// to the already-taped-out `photonic/` 3×3 ternary-weight crossbar. P1 trained
// real ternary weights; P2 makes the link *numerically* checkable: it models the
// crossbar's compute at the VALUE level — the ideal (lossless, noiseless)
// operation the photonic mesh implements — so the logical net and the photonic
// net can be proven to agree on the same weights and inputs.
//
// This is a pure, dependency-free leaf module (like ternary-train.js) so the
// example builder, the self-tests, and any future tooling share one source of
// truth and never drift. Loss / extinction / optical noise are deliberately
// OUT of scope here — that fidelity layer is P3 (it pulls in the SAX model and
// the FDTD S-parameters).
//
// ── What the photonic crossbar computes ────────────────────────────────────
// Topology (see photonic/scripts/05_crossbar_3x3.py):
//
//     input GC i ─ 1×3 splitter ─┬─ tile(i,0) ─┐ column 0 combiner ─→ output GC 0
//                                ├─ tile(i,1) ─┤ column 1 combiner ─→ output GC 1
//                                └─ tile(i,2) ─┘ column 2 combiner ─→ output GC 2
//
//   • input row i carries activation x[i] (an optical field amplitude),
//   • tile (i,j) is an MZI weight cell applying ternary weight W[i][j] ∈ {−1,0,+1},
//   • column j's combiner coherently SUMS the weighted fields from every row.
//
// So output column j is  y[j] = Σ_i W[i][j] · x[i]  — a matrix-vector product
// with the weight matrix indexed [input row i][output column j]. (Note this is
// the TRANSPOSE of the `ternary-layer` preset's [output][input] convention: the
// crossbar's rows are inputs, its columns are outputs.)
//
// ── How a trit becomes a weight on the device ──────────────────────────────
// From photonic/scripts/04_sax_mzi_sim.py: sweeping the MZI heater phase swaps
// optical power between the in-phase and anti-phase output ports along a cosine.
// The 2×2 MMI combiner adds an intrinsic π/2 differential phase, so the natural
// ternary set-points are at φ = π/2, π, 3π/2 (NOT 0, π/2, π):
//
//     φ = π/2   → anti-phase port bright  → trit −1
//     φ = π     → both ports at mid-rail  → trit  0
//     φ = 3π/2  → in-phase port bright    → trit +1

const TAU = 2 * Math.PI;

// The three heater set-points, in trit order {−1, 0, +1}. Frozen so callers
// can't mutate the device table.
export const MZI_TRIT_PHASES = Object.freeze({
  '-1': Math.PI / 2,
  '0':  Math.PI,
  '1':  3 * Math.PI / 2,
});

// trit → the heater phase that programs that weight into a tile.
export function tritToPhase(t) {
  if (t === -1) return Math.PI / 2;
  if (t === 0)  return Math.PI;
  if (t === 1)  return 3 * Math.PI / 2;
  throw new RangeError(`weight must be a trit {-1,0,+1}, got ${t}`);
}

// heater phase → the trit it encodes. Snaps to the nearest of the three
// set-points (taking phase mod 2π) so a small heater-trim error still reads as
// the intended weight — mirroring the "categorise" step in the SAX sweep. A
// real device is driven on-target; this tolerance is for robustness.
export function phaseToTrit(phase) {
  const p = ((phase % TAU) + TAU) % TAU;
  let bestTrit = 0;
  let bestDist = Infinity;
  for (const [t, ph] of [[-1, Math.PI / 2], [0, Math.PI], [1, 3 * Math.PI / 2]]) {
    // Circular distance on the phase ring, so φ≈0/2π snaps sensibly too.
    const d = Math.min(Math.abs(p - ph), TAU - Math.abs(p - ph));
    if (d < bestDist) { bestDist = d; bestTrit = t; }
  }
  return bestTrit;
}

// The crossbar's value-level compute. `W[i][j]` is tile (input row i, output
// column j)'s ternary weight; `x[i]` is input row i's activation. Output column
// j coherently sums the weighted inputs:  y[j] = Σ_i W[i][j] · x[i].
//
// Generalised to any N inputs × M outputs (the v1 device is 3×3). This is the
// IDEAL operation — the same integer dot products the Neural-Net kit's MAC3
// performs, which is exactly why the two can be checked for numerical agreement.
export function crossbarMac(W, x) {
  const n = x.length;
  if (W.length !== n) {
    throw new RangeError(`weight matrix has ${W.length} rows but x has ${n} entries`);
  }
  const m = W[0].length;
  const y = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += W[i][j] * x[i];
    y[j] = s || 0;   // normalise JS's -0 (e.g. 0 * -1) to a plain 0
  }
  return y;
}

// Same compute, but starting from the physical heater-phase grid the way you'd
// actually program the chip: `phaseGrid[i][j]` is tile (i,j)'s heater phase →
// decoded to a trit weight → fed through crossbarMac. Ties the device knobs
// straight to the numeric output.
export function crossbarMacFromPhases(phaseGrid, x) {
  const W = phaseGrid.map(row => row.map(phaseToTrit));
  return crossbarMac(W, x);
}

// ── P3 — analog / optical fidelity ─────────────────────────────────────────
// crossbarMac above is the IDEAL operation. A real optical mesh isn't ideal:
// the MZI's "0"/"±1" states have finite extinction, every path has insertion
// loss, the MMIs are slightly imbalanced, and the photodetector adds noise. P3
// brings those in so the ternary-weight MAC can be checked against realistic
// device behaviour — i.e. "does the chip still compute the right trits?".
//
// Modelling choices (value level, balanced detection — the standard scheme for
// a SIGNED optical MAC, where a balanced photodetector subtracts the MZI's
// in-phase and anti-phase ports to recover the weight's sign):
//   • insertion loss  → a single uniform amplitude gain on every output. Uniform
//     loss can't change a sign or an argmax; it just sets the signal level the
//     detector noise competes with (the SNR).
//   • finite extinction → a "±1" weight's magnitude is trimmed by the amplitude
//     that leaks to the wrong port (also uniform, so also benign on its own).
//   • MMI imbalance → a small STATIC per-tile offset. This is the real
//     decision-limiter: it's why a "0" weight isn't a perfect null, and it
//     varies tile-to-tile so it doesn't cancel.
//   • detector noise → a per-output Gaussian whose stdev is in units of one
//     ideal weighted input.
// All randomness is seeded, so the model is deterministic given its params.
//
// Defaults are the device numbers from photonic/scripts/04_sax_mzi_sim.py
// (4 dB GCs, 0.3 dB MMIs, 2 dB/cm waveguide) with a realistic 25 dB extinction
// (the ideal SAX model gives >40 dB; real MMI imbalance drops it to ~20–30 dB).
export const ANALOG_DEFAULTS = Object.freeze({
  gcLossDb:    4.0,    // per grating coupler (an optical path passes two)
  mmiLossDb:   0.3,    // excess loss per MMI
  wgLossDbCm:  2.0,    // 220 nm strip waveguide propagation loss
  armUm:       300,    // MZI arm length (one arm on the through path)
  busUm:       50,     // GC-to-MMI bus on each side
  extinctionDb: 25,    // realistic MZI extinction ratio
  imbalance:   0.02,   // MMI amplitude imbalance, fractional (per-tile stdev)
  noise:       0.0,    // detector noise stdev, in units of one ideal weighted input
  seed:        1,      // PRNG seed for the static imbalance + noise draws
});

// Lumped insertion loss (dB) of one input→tile→output optical route through the
// crossbar: two grating couplers, ~6 MMIs (splitter tree + tile + combiner
// tree), and the waveguide run (two buses + one arm). A rough but honest budget
// from the GDS lengths; refine when CORNERSTONE S-parameters land (that's the
// FDTD half of P3, on the photonic side).
export function pathInsertionLossDb(params = {}) {
  const p = { ...ANALOG_DEFAULTS, ...params };
  const MMI_COUNT = 6;
  const wgUm = 2 * p.busUm + p.armUm;
  return 2 * p.gcLossDb + MMI_COUNT * p.mmiLossDb + p.wgLossDbCm * (wgUm / 1e4);
}

// Seeded PRNG (mulberry32) + Box–Muller, local so the analog model is pure and
// deterministic without leaning on Math.random.
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
  // Box–Muller; guard log(0).
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// The crossbar's compute WITH device imperfections. Returns the continuous
// (real-valued) output vector a balanced photodetector would read — NOT rounded
// to trits. `gain` (uniform insertion-loss amplitude) is applied so the output
// is in the same units as crossbarMac up to that scale; recoverMac() inverts it.
export function crossbarMacAnalog(W, x, params = {}) {
  const p = { ...ANALOG_DEFAULTS, ...params };
  const gain = Math.pow(10, -pathInsertionLossDb(p) / 20);   // amplitude transmission
  const leak = Math.pow(10, -p.extinctionDb / 20);           // amplitude to the wrong port
  const rnd = mulberry32(p.seed);
  const n = x.length, m = W[0].length;
  const y = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const imb = p.imbalance * gaussian(rnd);               // static per-tile MMI imbalance
      // A "0" tile reads only its residual imbalance (no perfect null); a "±1"
      // tile reads its sign, magnitude trimmed by the leaked amplitude, plus imb.
      const wReal = W[i][j] === 0 ? imb : W[i][j] * (1 - leak) + imb;
      s += wReal * x[i];
    }
    s = gain * s + p.noise * gaussian(rnd);                  // uniform loss + detector noise
    y[j] = s;
  }
  return y;
}

// Recover the integer ternary MAC result from the analog output: undo the
// uniform gain and round (a calibrated ADC + threshold). The whole point of P3
// is checking when this still equals crossbarMac(W, x).
export function recoverMac(yAnalog, params = {}) {
  const gain = Math.pow(10, -pathInsertionLossDb(params) / 20);
  return yAnalog.map(v => Math.round(v / gain) || 0);
}

// Convenience: does the imperfect chip still compute the exact ideal MAC for
// these weights/inputs under these device params?
export function macFidelityOk(W, x, params = {}) {
  const ideal = crossbarMac(W, x);
  const got = recoverMac(crossbarMacAnalog(W, x, params), params);
  return ideal.every((v, j) => v === got[j]);
}

// ── P4 — weights → device export ("train → program the chip") ──────────────
// The end of the pipeline: take trained ternary weights (P1's absmean
// ternarization, or any ternary matrix) and emit the concrete settings that
// program the photonic crossbar. The v1 weight cell is a thermo-optic MZI
// (photonic/RESEARCH_NOTES §5b), so each tile is programmed by ONE knob — its
// heater phase — via the trit→φ encoding from the SAX model
// (−1→π/2, 0→π, +1→3π/2). (§4b's "MZM amplitude + π trim" is the foundry-MZM
// alternative, kept as a reference pad; the per-cell weight is heater-phase.)
//
// The heater itself is driven by electrical power, so we also give the per-tile
// drive power from a linear thermo-optic model φ = π·(P/P_π): P = (φ/π)·P_π.
// P_π (power for a π shift) is an ESTIMATE — a real heater wants on-bench
// calibration (the FDTD/characterisation half), so it's flagged and overridable.

// Heater power for a π phase shift — typical Si thermo-optic heater is ~20–30 mW.
// ESTIMATE; replace with the characterised value once the device is measured.
export const HEATER_P_PI_MW = 25;

// trit → the phase set-point's display label, for readable program tables.
const TRIT_PHASE_LABEL = { '-1': 'π/2', '0': 'π', '1': '3π/2' };

// Map a ternary weight matrix to a crossbar device program. Returns the
// per-tile heater phases (rad) and drive powers (mW), plus a flat `tiles` list
// suitable for a bench table. `W[i][j]` is tile (input row i, output column j).
export function exportCrossbarProgram(W, { pPiMw = HEATER_P_PI_MW } = {}) {
  const phaseRad      = W.map(row => row.map(tritToPhase));
  const heaterPowerMw = phaseRad.map(row => row.map(phi => (phi / Math.PI) * pPiMw));
  const tiles = [];
  for (let i = 0; i < W.length; i++) {
    for (let j = 0; j < W[i].length; j++) {
      tiles.push({
        i, j,
        weight: W[i][j],
        phaseRad: phaseRad[i][j],
        phaseLabel: TRIT_PHASE_LABEL[String(W[i][j])],
        heaterPowerMw: heaterPowerMw[i][j],
      });
    }
  }
  return { rows: W.length, cols: W[0].length, pPiMw, phaseRad, heaterPowerMw, tiles };
}

// A plain-text bench table of a program — the literal "set tile (i,j)'s heater
// to X mW" instructions. Handy for a UI "copy program" action or a lab notebook.
export function formatProgram(program) {
  const head = `tile  w   φ      heater(mW)`;
  const rows = program.tiles.map(t =>
    `(${t.i},${t.j})  ${t.weight >= 0 ? '+' + t.weight : t.weight}  ${t.phaseLabel.padEnd(4)}  ${t.heaterPowerMw.toFixed(1)}`);
  return [head, ...rows].join('\n');
}

// Round-trip check: decode a program's heater phases back to the ternary weight
// matrix it encodes (via phaseToTrit). exportCrossbarProgram(W) → this == W, so
// the program faithfully carries the trained weights onto the chip.
export function programToWeights(program) {
  return program.phaseRad.map(row => row.map(phaseToTrit));
}
