# MINIMIZER.md — ternary logic minimizer (roadmap F1)

> Design note for the two-level ternary logic minimizer. The engine lives in
> `js/minimizer.js`; it's surfaced as a **Minimize** button in the gate-builder
> modal. This is the balanced-ternary analogue of binary Quine–McCluskey / K-map
> sum-of-products reduction.

## What it does

Given an n-input → 1-output ternary truth table (the `{ "a,b,..": out }` map the
custom-gate builder already produces), it returns a compact **MAX-of-MIN**
expression over the simulator's own primitives (`MIN`, `MAX`, `STI`, `PTI`,
`NTI`), the gate count of that expression, and the gate count of the naive
canonical form — so the saving is visible. It's a **report**: the custom gate
stays a behavioural table-lookup; the minimizer tells you the minimal primitive
circuit that realises the same function.

## Canonical form (why MAX-of-MIN works)

Sum-of-products in multi-valued logic is **MAX-of-MIN**. A *decoder literal* for
input i and value v is +1 when `x_i = v`, else T (−1, the MIN/MAX floor). Because
every literal tops out at +1 and MIN/MAX clamp, a product `MIN(k, lit, lit, …)`
equals the constant k exactly where all its literals fire and T everywhere else;
MAX-ing the products reconstructs f.

Output level matters. A product **capped at +1** must fire only on `f=+1` inputs;
a product **capped at 0** may also spill onto `f=+1` inputs (`MAX(0,+1)=+1`) but
never onto `f=−1`. So two onsets are covered independently:

```
 level +1:  ON = { f=+1 },  OFF = { f≤0 }              (no don't-cares)
 level  0:  ON = { f= 0 },  OFF = { f<0 },  DC = { f=+1 }

 f(x) = MAX(  MAX of the +1-capped terms,
              MAX of the  0-capped terms )
```

Terms whose output is T are dropped (they'd contribute the floor anyway) — the
analogue of dropping 0-minterms in binary SOP.

## Implicants, literals, cost

An **implicant** is a *box*: a non-empty value subset `S_i ⊆ {−1,0,1}` per input;
it contains x iff `x_i ∈ S_i` for all i. A box is a valid implicant of a cover
iff it touches no OFF minterm; a **prime** implicant is a valid box no other
contains. The engine enumerates every box (`7^n` — tiny for the ≤4-input gates the
builder makes), keeps the primes, then covers the ON set greedily, taking the
lowest **literal-cost-per-newly-covered-minterm** prime each step.

Each window literal compiles to a decoder from STI/PTI/NTI/MIN/MAX. A full set
`{−1,0,1}` is a don't-care → no gate. Costs (see `DECODER_COST`):

| set        | network                    | gates |
|------------|----------------------------|------:|
| `{−1}`     | `NTI`                      | 1 |
| `{1}`      | `NTI(STI)`                 | 2 |
| `{0}`      | `MIN(PTI, STI(NTI))`       | 4 |
| `{−1,0}`   | `PTI`                      | 1 |
| `{0,1}`    | `STI(NTI)`                 | 2 |
| `{−1,1}`   | `MAX(NTI, NTI(STI))`       | 4 |
| `{−1,0,1}` | (don't care)               | 0 |

## Optimality

Greedy weighted set cover is the standard practical choice, not provably minimal.
Two guarantees make it honest:

1. **Correctness is exact, always** — the minimized expression reproduces the
   source table on every input (asserted by the test suite over a battery of
   named functions, constants, and a deterministic pseudo-random sweep for
   n = 1..3).
2. **Never worse than canonical** — the naive canonical form (one single-value
   product per care minterm) is itself a feasible cover, so `minimizeTernary`
   compares the two and returns whichever is cheaper.

For the small (n ≤ 3, occasionally 4), mostly-unate functions a hand-built gate
produces, the greedy result is at or near optimal.

## API (`js/minimizer.js`)

- `minimizeTernary(table, n)` → `{ numInputs, terms: [{ cap: 0|1, sets: number[][] }] }`
- `evalMinimizedExpr(expr, combo)` → trit (verification / re-sim)
- `minimizedGateCount(expr)` / `canonicalGateCount(table, n)`
- `formatMinimizedExpr(expr, inNames)` → e.g. `out = MAX(MIN(0, a∈{T,0}), b=+1)`
- `minimizeReport(table, n, inNames)` → everything the UI shows

## Status / future

- **Phase 1 — engine + report.** ✅ Done. The Minimize button reports the
  expression + gate saving; no canvas changes.
- **Phase 2 — materialize.** 📋 Build the minimized network as a placed
  subcircuit of MIN/MAX/STI/PTI/NTI on the canvas (a "compile to gates" for a
  custom gate). Deferred — the synthesis is mechanical from `expr` (decoders per
  literal → MIN per product → MAX across terms), the work is placement/wiring.
- **Beyond.** Exact (branch-and-bound) cover for small n; multi-output sharing;
  this is also the substrate F3 (AI-assisted optimisation) would build on.
