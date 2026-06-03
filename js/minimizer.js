// ============================================================================
//  TERNARY LOGIC MINIMIZER  (roadmap F1)
// ============================================================================
//
//  Two-level minimization of an arbitrary n-input → 1-output ternary function,
//  the balanced-ternary analogue of binary Quine–McCluskey / Karnaugh-map SOP
//  reduction. The input is a truth table (the same `{ "a,b,..": out }` map the
//  custom-gate builder produces); the output is a compact MAX-of-MIN expression
//  over the simulator's own primitives, plus a gate-count for it and for the
//  naive canonical form so the saving is visible.
//
//  ── Canonical form ────────────────────────────────────────────────────────
//  Sum-of-products in MVL is MAX-of-MIN. A "minterm" picks one value per input;
//  its decoder literal is +1 when the input equals that value, else T (−1, the
//  MIN/MAX floor). Because every literal tops out at +1 and MIN/MAX clamp, a
//  product MIN(k, lit, lit, …) yields the constant k exactly where all literals
//  fire and T everywhere else, and MAX-ing the products reconstructs f. Output
//  level matters: a term capped at +1 must fire ONLY on f=+1 inputs, while a
//  term capped at 0 may also spill onto f=+1 inputs (MAX(0,+1)=+1) but never
//  onto f=−1 inputs. So we cover two onsets independently:
//
//    level +1:  ON = { f=+1 },  OFF = { f≤0 },           no don't-cares
//    level  0:  ON = { f= 0 },  OFF = { f<0 },  DC = { f=+1 }
//
//    f(x) = MAX(  MAX of the +1-capped product terms,
//                 MAX of the  0-capped product terms )
//
//  ── Implicants & literals ─────────────────────────────────────────────────
//  An implicant is a "box": a non-empty subset S_i ⊆ {−1,0,1} per input. It
//  contains x iff x_i ∈ S_i for all i. A box is a valid implicant of a cover
//  iff it touches no OFF minterm. A prime implicant is a valid box no other
//  valid box contains. We enumerate every box (7^n — tiny for the ≤4-input
//  gates the builder makes), keep the primes, then greedily cover the ON set,
//  preferring cheaper (fewer / cheaper literals) primes. Greedy is not provably
//  minimal but is the standard practical choice and is exact on the small,
//  mostly-unate functions seen here; correctness (reproducing f) is guaranteed
//  regardless and is asserted by the test suite over every input.
//
//  ── Literal cost ──────────────────────────────────────────────────────────
//  Each window literal S_i compiles to a decoder built from STI/PTI/NTI/MIN/MAX
//  (see DECODER_COST). A full set {−1,0,1} is "don't care" → no gate. The cost
//  drives both the gate-count readout and the greedy tie-break.

const VALUES = [-1, 0, 1];

// All non-empty subsets of {−1,0,1}, as sorted arrays. 7 of them.
const SUBSETS = (() => {
  const out = [];
  for (let mask = 1; mask < 8; mask++) {
    const s = [];
    for (let i = 0; i < 3; i++) if (mask & (1 << i)) s.push(VALUES[i]);
    out.push(s);
  }
  return out;
})();
const subKey = (s) => s.join(',');

// Minimal STI/PTI/NTI/MIN/MAX gate count to build the decoder for each window
// literal — the unary function that is +1 when the input is in the set, else T.
// Derivations (a = input):
//   {−1}      NTI(a)                         → 1   (NTI = +1 iff a=T)
//   {1}       NTI(STI(a))                    → 2   (STI flips a=+1 to T)
//   {0}       MIN(PTI(a), STI(NTI(a)))       → 4   (≤0 AND ≠T)
//   {−1,0}    PTI(a)                         → 1   (PTI = +1 iff a≤0)
//   {0,1}     STI(NTI(a))                    → 2   (≠T)
//   {−1,1}    MAX(NTI(a), NTI(STI(a)))       → 4   (≠0)
//   {−1,0,1}  (don't care, no gate)          → 0
const DECODER_COST = {
  '-1': 1, '1': 2, '0': 4,
  '-1,0': 1, '0,1': 2, '-1,1': 4,
  '-1,0,1': 0,
};

function combosOf(n) {
  const out = [];
  (function rec(prefix) {
    if (prefix.length === n) { out.push(prefix.slice()); return; }
    for (const v of VALUES) { prefix.push(v); rec(prefix); prefix.pop(); }
  })([]);
  return out;
}
const comboKey = (c) => c.join(',');
const outAt = (table, combo) => { const r = table[comboKey(combo)]; return r === undefined ? 0 : r; };

// Does the box (array of n subsets) contain the combo?
function boxContainsCombo(box, combo) {
  for (let i = 0; i < box.length; i++) if (!box[i].includes(combo[i])) return false;
  return true;
}
// Is box A a superset of box B (A contains every combo B does)?
function boxSupersetOf(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (const v of b[i]) if (!a[i].includes(v)) return false;
  }
  return true;
}
function boxLiteralCost(box) {
  let cost = 0;
  for (const s of box) cost += DECODER_COST[subKey(s)];
  return cost;
}

// Cover an onset with prime implicants that avoid every off minterm.
//   on, off : arrays of combos (off must NOT be touched)
//   returns : array of boxes
function coverLevel(on, off, n) {
  if (on.length === 0) return [];
  const offKeys = new Set(off.map(comboKey));

  // Enumerate all valid boxes (7^n) — those touching no OFF minterm.
  const valid = [];
  (function rec(i, box) {
    if (i === n) {
      // Reject if any contained combo is an OFF minterm.
      const contained = boxCombos(box);
      for (const c of contained) if (offKeys.has(comboKey(c))) return;
      valid.push(box.slice());
      return;
    }
    for (const s of SUBSETS) { box.push(s); rec(i + 1, box); box.pop(); }
  })(0, []);

  // Primes = valid boxes not strictly contained in another valid box.
  const primes = valid.filter(b =>
    !valid.some(o => o !== b && boxSupersetOf(o, b) && !boxSupersetOf(b, o)));

  // Greedy weighted set cover of the ON minterms: each step takes the prime
  // with the lowest literal-cost PER newly-covered minterm (a free don't-care
  // box wins outright), so we add cheap coverage first. Tie-break: cover more.
  const need = new Set(on.map(comboKey));
  const chosen = [];
  while (need.size) {
    let best = null, bestRatio = Infinity, bestCovers = 0;
    for (const p of primes) {
      let covers = 0;
      for (const c of on) if (need.has(comboKey(c)) && boxContainsCombo(p, c)) covers++;
      if (covers === 0) continue;
      const ratio = boxLiteralCost(p) / covers;
      if (ratio < bestRatio || (ratio === bestRatio && covers > bestCovers)) {
        best = p; bestRatio = ratio; bestCovers = covers;
      }
    }
    if (!best) break;   // shouldn't happen — primes always cover their onset
    chosen.push(best);
    for (const c of on) if (boxContainsCombo(best, c)) need.delete(comboKey(c));
  }
  return chosen;
}

// The naive canonical expression: one single-value-decoder product per care
// minterm. Always a feasible (if large) two-level cover, so we use it as a
// guaranteed upper bound — the minimizer never returns something worse.
function canonicalExpr(table, n) {
  const combos = combosOf(n);
  const terms = [];
  for (const c of combos) {
    const o = outAt(table, c);
    if (o === -1) continue;
    terms.push({ cap: o === 1 ? 1 : 0, sets: c.map(v => [v]) });
  }
  return { numInputs: n, terms };
}

// All combos contained in a box (cartesian product of its subsets).
function boxCombos(box) {
  let acc = [[]];
  for (const s of box) {
    const next = [];
    for (const pre of acc) for (const v of s) next.push(pre.concat(v));
    acc = next;
  }
  return acc;
}

// ── Public API ─────────────────────────────────────────────────────────────

// Minimise a ternary truth table into a MAX-of-MIN expression.
//   table : { "a,b,..": out in {−1,0,1} }   (missing key ⇒ 0)
//   n     : number of inputs
// Returns { numInputs, terms: [{ cap: 0|1, sets: number[][] }] }.
export function minimizeTernary(table, n) {
  const combos = combosOf(n);
  const on1 = combos.filter(c => outAt(table, c) === 1);
  const off1 = combos.filter(c => outAt(table, c) <= 0);
  const on0 = combos.filter(c => outAt(table, c) === 0);
  const off0 = combos.filter(c => outAt(table, c) < 0);
  const expr = { numInputs: n, terms: [
    ...coverLevel(on1, off1, n).map(sets => ({ cap: 1, sets })),
    ...coverLevel(on0, off0, n).map(sets => ({ cap: 0, sets })),
  ] };
  // Greedy can occasionally trail the trivial form on tiny functions; fall back
  // to canonical whenever it isn't strictly cheaper, so the result is never
  // worse than where we started.
  const canon = canonicalExpr(table, n);
  return minimizedGateCount(expr) <= minimizedGateCount(canon) ? expr : canon;
}

// Evaluate a minimized expression at one input combo.
export function evalMinimizedExpr(expr, combo) {
  let best = -1;
  for (const t of expr.terms) {
    let fires = true;
    for (let i = 0; i < expr.numInputs; i++) {
      if (!t.sets[i].includes(combo[i])) { fires = false; break; }
    }
    if (fires && t.cap > best) best = t.cap;
  }
  return best;
}

// Gate count of a minimized expression, in STI/PTI/NTI/MIN/MAX primitives.
export function minimizedGateCount(expr) {
  let gates = 0;
  for (const t of expr.terms) {
    const lits = t.sets.filter(s => s.length < 3);   // drop don't-cares
    for (const s of lits) gates += DECODER_COST[subKey(s)];
    const operands = lits.length + (t.cap === 0 ? 1 : 0);   // +1 for the 0 cap (CONST)
    gates += Math.max(0, operands - 1);                     // MINs inside the term
  }
  gates += Math.max(0, expr.terms.length - 1);              // MAXes across terms
  return gates;
}

// Gate count of the naive canonical form (one product per care minterm, single-
// value decoders) — the baseline the minimizer improves on.
export function canonicalGateCount(table, n) {
  const combos = combosOf(n);
  const care = combos.filter(c => outAt(table, c) !== -1);
  if (care.length === 0) return 0;
  let gates = 0;
  for (const c of care) {
    for (const v of c) gates += DECODER_COST[subKey([v])];   // n single-value decoders
    const cap = outAt(table, c);
    const operands = n + (cap === 0 ? 1 : 0);
    gates += Math.max(0, operands - 1);
  }
  gates += Math.max(0, care.length - 1);
  return gates;
}

// Human-readable expression, e.g. "out = MAX(MIN(0, a∈{T,0}), b=+1)".
export function formatMinimizedExpr(expr, inNames) {
  const tl = (v) => (v === -1 ? 'T' : v === 1 ? '+1' : '0');
  const names = inNames || Array.from({ length: expr.numInputs }, (_, i) => 'in' + i);
  if (expr.terms.length === 0) return 'out = T  (constant −1)';
  const litStr = (set, i) => {
    if (set.length === 3) return null;                       // don't care
    if (set.length === 1) return `${names[i]}=${tl(set[0])}`;
    return `${names[i]}∈{${set.map(tl).join(',')}}`;
  };
  const termStr = (t) => {
    const parts = [];
    if (t.cap === 0) parts.push('0');
    for (let i = 0; i < expr.numInputs; i++) {
      const s = litStr(t.sets[i], i);
      if (s) parts.push(s);
    }
    if (parts.length === 0) return tl(t.cap);                // bare constant
    if (parts.length === 1) return parts[0];
    return `MIN(${parts.join(', ')})`;
  };
  const terms = expr.terms.map(termStr);
  return terms.length === 1 ? `out = ${terms[0]}` : `out = MAX(${terms.join(', ')})`;
}

// Convenience: everything the UI needs in one call.
export function minimizeReport(table, n, inNames) {
  const expr = minimizeTernary(table, n);
  return {
    expr,
    text: formatMinimizedExpr(expr, inNames),
    gatesBefore: canonicalGateCount(table, n),
    gatesAfter: minimizedGateCount(expr),
    terms: expr.terms.length,
  };
}
