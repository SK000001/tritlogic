// P1 — trained ternary weights (the BitNet b1.58 pipeline, in miniature).
//
// Real photonic-AI and the BitNet line of work both use ternary weights
// {-1, 0, +1}. This module shows the *honest* path to such weights: train a tiny
// floating-point net, then quantize it with the BitNet "absmean" rule — NOT
// hand-place the trits. The result drops straight into TritLogic's Neural-Net kit
// (MAC3 = ternary dot product, ACT = sign), so the logical circuit and the
// trained net agree numerically.
//
// Pure + deterministic (seeded), so the example builder and the self-tests share
// one source of truth and never drift.

// ---- BitNet b1.58 absmean ternarization ----------------------------------
// Scale by the mean absolute weight, round to the nearest integer, clamp to
// {-1, 0, +1}. Returns the ternary vector (the per-weight scale is folded away
// because the downstream sign() activation is scale-invariant).
export function ternarizeAbsmean(vec) {
  let s = 0;
  for (const w of vec) s += Math.abs(w);
  const scale = s / (vec.length || 1);
  if (scale === 0) return vec.map(() => 0);
  return vec.map(w => Math.max(-1, Math.min(1, Math.round(w / scale))));
}

// Evaluate the ternary 2→2→1 net with the EXACT semantics of the TritLogic
// circuit: each neuron is an integer ternary dot product (MAC3) over
// (inputs…, bias=+1) followed by sign() (ACT). a, b are bipolar trits {-1,+1}.
const sgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
export function evalTernaryXorNet(W1, W2, a, b) {
  const h = [];
  for (let j = 0; j < 2; j++) h.push(sgn(W1[j][0] * a + W1[j][1] * b + W1[j][2] * 1));
  return sgn(W2[0] * h[0] + W2[1] * h[1] + W2[2] * 1);
}

// XOR target on bipolar inputs: +1 when the inputs differ, −1 when they agree.
const XOR = [
  { a: -1, b: -1, t: -1 },
  { a: -1, b:  1, t:  1 },
  { a:  1, b: -1, t:  1 },
  { a:  1, b:  1, t: -1 },
];

// Tiny seeded PRNG (mulberry32) for reproducible weight init.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Train one float 2→2→1 tanh net on XOR (full-batch gradient descent), then
// absmean-ternarize each neuron's [w0, w1, bias] vector. Returns { W1, W2 }.
function trainOnce(seed, epochs = 4000, lr = 0.1) {
  const r = rng(seed);
  const rw = () => r() * 2 - 1;                       // init in [-1, 1]
  const w1 = [[rw(), rw()], [rw(), rw()]], b1 = [rw(), rw()];
  const w2 = [rw(), rw()];
  let b2 = rw();
  const th = Math.tanh;
  for (let e = 0; e < epochs; e++) {
    for (const { a, b, t } of XOR) {
      const x = [a, b];
      const z1 = [w1[0][0] * a + w1[0][1] * b + b1[0], w1[1][0] * a + w1[1][1] * b + b1[1]];
      const h = [th(z1[0]), th(z1[1])];
      const z2 = w2[0] * h[0] + w2[1] * h[1] + b2;
      const o = th(z2);
      const dO = (o - t) * (1 - o * o);
      const dH = [dO * w2[0] * (1 - h[0] * h[0]), dO * w2[1] * (1 - h[1] * h[1])];
      for (let k = 0; k < 2; k++) { w2[k] -= lr * dO * h[k]; }
      b2 -= lr * dO;
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < 2; i++) w1[k][i] -= lr * dH[k] * x[i];
        b1[k] -= lr * dH[k];
      }
    }
  }
  return {
    W1: [ternarizeAbsmean([w1[0][0], w1[0][1], b1[0]]),
         ternarizeAbsmean([w1[1][0], w1[1][1], b1[1]])],
    W2: ternarizeAbsmean([w2[0], w2[1], b2]),
  };
}

function solvesXor(W1, W2) {
  return XOR.every(({ a, b, t }) => evalTernaryXorNet(W1, W2, a, b) === t);
}

// Deterministic: train float nets across seeds 0..maxSeed, ternarize each, and
// return the FIRST whose ternary form solves XOR exactly. Honest framing — the
// weights come out of training + BitNet ternarization; we just pick the first
// seed whose quantized net happens to land on a working configuration. Returns
// { W1, W2, seed } (seed = -1 with the best effort if none solve it, which the
// test would catch).
export function trainTernaryXor(maxSeed = 200) {
  let last = null;
  for (let seed = 0; seed <= maxSeed; seed++) {
    const { W1, W2 } = trainOnce(seed);
    last = { W1, W2, seed };
    if (solvesXor(W1, W2)) return last;
  }
  return { ...last, seed: -1 };
}
