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
