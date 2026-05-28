# ISA v2 — design doc for E2b (wider opcode, 9-op ISA)

> **Status (2026-05-28):** Phases A, B, and C all shipped — all 9 ops
> have full datapath in the `CPU2` preset. This document is kept as
> the historical design spec; the live system matches it.
>
> Original status note (preserved for context):
>
> **Status:** design only, no code yet. v1 ISA (3-op skeleton:
> ADDI / MAXI / JMP encoded in 1 opcode trit) ships today. v2 widens
> the encoding to 2 opcode trits (9 op slots) plus a 4-trit operand,
> packed into a 6-trit instruction word via two parallel RAM blocks.
>
> The next session implements this end-to-end: subcircuits, CPU2
> preset, assembler, decoder, debugger, tests. Items left undone in
> v1 (E4 debugger landed before v2) carry over.

---

## Goals

1. Make the CPU more programmable than 3 ops while keeping the
   simulator primitives unchanged — no new built-in components, only
   composition.
2. Keep the existing `CPU` preset working as-is. The wider machine
   ships as a separate `CPU2` preset so today's tests, examples, and
   debugger demos stay valid.
3. Provide enough headroom for LOAD / STORE in a follow-up without
   re-encoding everything.

## Non-goals (for this design)

- Pipelining or multi-cycle ops. CPU2 is still single-cycle.
- Variable-length instructions. Every word is exactly 6 trits.
- Caches, branch prediction, anything else that's not a 1989 toy ISA.

---

## Word format

Each instruction occupies one **logical word** = 6 trits, stored
across two parallel 3-trit RAM blocks (`imem_lo`, `imem_hi`) that
share the PC address pins.

```
  IMEM word layout (6 trits per logical instruction)
  ────────────────────────────────────────────────────────
  imem_lo.q0  ─ opL     (opcode trit, low)
  imem_lo.q1  ─ opH     (opcode trit, high)
  imem_lo.q2  ─ oper0   (operand trit, low)
  imem_hi.q0  ─ oper1
  imem_hi.q1  ─ oper2
  imem_hi.q2  ─ oper3   (operand trit, high)
```

The operand is a balanced-ternary signed integer covering
**−40..+40**, computed as `oper0 + 3·oper1 + 9·oper2 + 27·oper3`.

Both RAMs are addressed by the same 2-trit PC, so they always read
the same logical word index (0..8) — exactly 9 logical instructions
per program, same depth as today's RAM.

## Opcode table

The 2 opcode trits give 9 codepoints. v1 fills 6 (5 implementable
this session, 4 more queued); the remaining 3 are reserved.

| Mnemonic | opH opL | Operand semantics                  | Status |
|----------|---------|------------------------------------|--------|
| `NOP`    |  T  T   | ignored                            | v1     |
| `JMP`    |  T  0   | absolute IMEM address 0..8         | v1     |
| `JMPP`   |  T  +   | address; jump if `ACC > 0`         | v2-cond |
| `JMPZ`   |  0  T   | address; jump if `ACC == 0`        | v2-cond |
| `ADDI`   |  0  0   | signed immediate −40..+40          | v1     |
| `MAXI`   |  0  +   | signed immediate −40..+40          | v1     |
| `MINI`   |  +  T   | signed immediate −40..+40          | v1     |
| `LOAD`   |  +  0   | DMEM address 0..8 → `ACC`          | Phase C ✓ |
| `STORE`  |  +  +   | `ACC` → DMEM address 0..8          | Phase C ✓ |

`v1`            = ships in the first E2b session.
`v2-cond`       = needs ACC sign detection.
`v2-dmem`       = needs a second RAM block as DMEM, plus bus routing.

### Why this assignment

- `NOP = TT` makes a freshly-cleared RAM (all-T initial pattern)
  decode as a stream of NOPs, which is the friendliest default.
- Arithmetic ops cluster in the middle (`opH = 0`).
- Memory ops cluster at `opH = +`.
- Jumps cluster at `opH = T`.

### Operand encoding for jumps

`JMP` and friends interpret `operand` as a **0..8 address** the same
way today's CPU does: the PC stores `p` where
`tritsToInt(p) + 4 = word index`. So the assembler emits
`oper0, oper1 = intToTrits(addr − 4, 2)` and `oper2, oper3 = 0` for
all jump ops. `oper2, oper3` are wired to ground / unused on the
PC's `j0, j1` inputs.

### Operand encoding for immediates

Full 4-trit balanced range, MSB at `oper3`. The ALU is still 3-trit
internally, so v1 routes only `oper0..oper2` to `ALU.b` and ignores
`oper3` (the high trit). This caps the *practically usable*
immediate range to −13..+13 in v1 — but the assembler still
validates against −40..+40 to keep the format consistent for v2,
which will widen the ALU or sign-extend explicitly.

---

## DECODE2 subcircuit

A new built-in subcircuit `DECODE2` (in the "Decoder kit" or as part
of the existing Sequential / Arithmetic family — TBD on placement).

```
  pins
    in:  opL, opH
    out: en_NOP, en_JMP, en_JMPP, en_JMPZ,
         en_ADDI, en_MAXI, en_MINI,
         en_LOAD, en_STORE
```

Each enable output is **active high**: `+1` when its op is selected,
`0` otherwise. (`0` not `T` — chosen because most downstream
multiplexing maths is cleaner with the `{0, +1}` enable convention.
See the ALU-op selector derivation below.)

Internally: nine "is-this-codepoint" detectors, each a MIN of two
trit-equality checks:

```
  is_trit_eq(x, target):
     +1 if target = +1:  PTI(x)                ; +1 iff x = +1, else T
     +1 if target =  0:  STI of (PTI(x) MAX NTI(x))-then-mask  ; +1 iff x = 0
     +1 if target = T :  NTI(x)                ; +1 iff x = -1, else T

  is_zero(x):
     MAX(NEG(MAX(PTI(x), NTI(x))), 0)
     → +1 when x = 0, 0 when x = ±1
```

Then `en_NOP = MIN_clamp(is_trit_eq(opL, T), is_trit_eq(opH, T))`,
clamped to `{0, +1}` so the `0`-inactive convention holds.

A reasonable simplification: build one `IS_T`, `IS_0`, `IS_P`
1-input-3-output subcircuit and reuse it; that drops the gate count
significantly.

---

## CPU2 datapath

```
                                  +-----------+
   clk ─┬──────────────────────►  │ imem_lo   │ q0=opL  ─┐
        │             ┌────────►  │ (RAM 9×3) │ q1=opH  ─┤
        │             │           │           │ q2=op0  ─┤
        ▼             │           +-----------+          │
   ┌────────┐ p0 ─────┤                                  │
   │   PC   │ p1 ─────┤           +-----------+          │
   └────────┘         └────────►  │ imem_hi   │ q0=op1   │
        ▲                         │ (RAM 9×3) │ q1=op2   │
        │                         │           │ q2=op3   │
        │  jmp/j0/j1              +-----------+          │
        │                                                │
   ┌────┴────────────────────────────────────────────────┘
   │
   ▼   opL,opH         ┌──────────────────────────────┐
  ┌──────────┐        │           DECODE2            │
  │  DECODE2 │ ──────►│  en_NOP en_JMP en_JMPP ...   │
  └──────────┘         └──────────────────────────────┘
        │                              │
        │   en_*                       │
        ▼                              ▼
                accWrite = MAX(en_ADDI, en_MAXI, en_MINI, en_LOAD)
                jmpEn    = en_JMP   (v1; v2 adds cond AND with ACC sign)
                aluOpSel = TSUM(en_MAXI, NEG(en_MINI))   ; -1/0/+1

                                                  ▼
   ┌─────────┐                ┌──────┐    ┌────────────┐
   │   ACC   │ q0..q2 ───────►│ ALU  │───►│  ld=accWr  │── back to ACC.d
   │ (REG3)  │                │      │    └────────────┘
   └─────────┘                │      │
        ▲           op0..op2 ►│ b    │
        │           aluOpSel ►│ op   │
        │                     └──────┘
```

### Control signal derivation

All enables ∈ `{0, +1}` (active-high, 0-inactive).

```
  accWrite  = MAX(en_ADDI, en_MAXI, en_MINI, en_LOAD)    ; +1 if any active
  jmpEn     = en_JMP                                      ; v1 only
            = MAX(en_JMP, MIN(en_JMPP, accIsPos),
                          MIN(en_JMPZ, accIsZero))        ; v2
  dmemWrite = en_STORE                                    ; v2
  accSrc    = en_LOAD                                     ; v2 (mux select)
  aluOpSel  = TSUM(en_MAXI, NEG(en_MINI))                 ; -1/0/+1
```

**Why `TSUM(en_MAXI, NEG(en_MINI))` is correct for the ALU op:**
- ADDI active: `TSUM(0, NEG(0)=0) = 0` → ALU computes ADD ✓
- MAXI active: `TSUM(+1, NEG(0)=0) = +1` → ALU computes MAX ✓
- MINI active: `TSUM(0, NEG(+1)=−1) = −1` → ALU computes MIN ✓
- Other ops: `accWrite` is 0, so the ALU output isn't latched — don't care

The `TSUM` (carry-free ternary sum) primitive already exists in the
Arithmetic Kit.

---

## ACC sign detection (v2-cond)

Build a new `ACC_SIGN` subcircuit:

```
  pins
    in:  q0, q1, q2     ; the three ACC trits
    out: isZero, isPos  ; both ∈ {0, +1}
```

Logic:

```
  iszero_t(x) = MAX(NEG(MAX(PTI(x), NTI(x))), 0)
              ; +1 if x = 0, else 0

  isZero      = MIN(iszero_t(q0), iszero_t(q1), iszero_t(q2))

  ; Sign = the highest-order non-zero trit. Priority encoder:
  signOf      = MUX(iszero_t(q2), q2, q2,
                  MUX(iszero_t(q1), q1, q1, q0))
              ; selector +1 means q2 is zero → look down at q1, etc.

  isPos       = MAX(PTI(signOf), 0)
              ; +1 if sign = +1, else 0
```

This is the only sign detection needed; `JMPT` (jump-if-negative)
isn't in v2 scope. The reserved opcode slot at `(opH, opL) = (+, 0)`
is currently spec'd as `LOAD` not `JMPT`; if we want JMPT instead,
swap LOAD into the spare slot at... actually, all 9 slots are
allocated. JMPT would need to wait for an ISA v3 or share a slot
with JMPP via a flag trit. For v2 just live without it.

---

## Data memory (v2-dmem)

A second 9×3-trit RAM block (`dmem`) addressed by the operand's low
2 trits (operand 0..8).

- Read side (`LOAD`): `dmem.q*` → MUX → ACC.d, selected by `en_LOAD`
  (1) vs `0` (ALU result is the default ACC source).
- Write side (`STORE`): `dmem.we = en_STORE`; `dmem.d0..2 = ACC.q*`;
  `dmem.a0..1 = operand[0..1]`.

This is the biggest single chunk of new wiring. Estimate ~25 wires.

---

## Assembler changes

The new mnemonics are:

```
  NOP                            ; no operand
  ADDI <signed int −40..+40>     ; immediate
  MAXI <signed int>
  MINI <signed int>
  JMP  <addr 0..8 | label>
  JMPP <addr | label>            ; v2
  JMPZ <addr | label>            ; v2
  LOAD <dmem addr 0..8>          ; v2
  STORE <dmem addr 0..8>         ; v2
```

The existing `assemble()` function gets a `version: 1 | 2` argument
(defaulting to 2 for new programs; the existing 3-op programs stay
parseable as `version: 1`). v2 encodes to a 12-trit pair per word
laid out as `[opL, opH, oper0, oper1, oper2, oper3]`. We'd actually
return the mem image as two parallel arrays (mem_lo, mem_hi) for
loading into the two RAMs.

`ASM_EXAMPLES` gets new entries showing the wider ISA — at minimum:
- `counter2` — `ADDI +1 / JMP LOOP` in v2 form (sanity-check
  round-trip)
- `minmax-toggle` — `MAXI +5 / MINI -5 / JMP 0`, demonstrates MINI
- `nop-padding` — shows NOP being decoded correctly

The `findImem()` helper that currently looks for one PC-addressed
RAM is generalised to find two — returning `{ ramLo, ramHi }` if
both are present, falling back to `{ ram }` for v1 CPUs.

## Decoder + debugger changes

`decodeImemWord(word_lo, word_hi)` becomes a function of one OR two
words depending on which CPU is on the canvas. The debugger detects
the CPU shape:
- One RAM addressed by PC → v1 ISA, show 3-trit words
- Two RAMs sharing PC addr → v2 ISA, show 6-trit words

IMEM dump in the debugger panel: for v2, each row shows both RAMs
side by side, e.g.:

```
  w0  [0 0 1]  [0 0 0]   ADDI +1
  w1  [0 T T]  [0 0 0]   JMP  0
  ...
```

## Tests

Add (target ~7 new tests, suite 61 → 68):

1. **Opcode encoding round-trip** — for every v2 mnemonic, assemble
   one instance and check the resulting trit pattern matches the
   table above.
2. **DECODE2 produces correct one-hot for every opcode** — exhaustive,
   9 cases.
3. **`aluOpSel` derivation** — `TSUM(en_MAXI, NEG(en_MINI))`
   produces 0 / +1 / -1 for the three arithmetic op cases.
4. **CPU2 counter program** — assemble v2 `ADDI +1 / JMP LOOP`, run
   10 ticks, assert ACC climbs the same way the v1 counter test
   does.
5. **CPU2 MINI saturates** — `MAXI +5 / MINI -3 / JMP 0` keeps
   ACC bouncing between two values.
6. **CPU2 NOP is observed** — a NOP instruction leaves ACC and PC
   advances normally (PC bumps, ACC unchanged).
7. **`ACC_SIGN` subcircuit** (v2-cond, deferred) — exhaustive
   over all 27 ACC values, checks isZero / isPos.

---

## Implementation order (one session per phase)

**Phase A — v1 core (5 ops, no cond/dmem):**
1. `DECODE2` subcircuit + tests
2. `CPU2` preset with parallel RAMs
3. Assembler `version: 2` mode + `decodeImemWord` v2 path
4. Debugger 6-trit display
5. Tests 1, 2, 3, 4, 5, 6
6. Info-modal `_isa2` page

**Phase B — conditional jumps:**
1. `ACC_SIGN` subcircuit + tests
2. Wire JMPP / JMPZ into CPU2 datapath
3. Assembler emits JMPP / JMPZ
4. Tests for both conditional ops

**Phase C — data memory:**
1. Add `dmem` second RAM block to CPU2 preset
2. Wire `accSrc` MUX + STORE write enable
3. Assembler emits LOAD / STORE
4. Tests for both
5. Update info page

Each phase ships as one commit, suite green throughout.

---

## Open questions to resolve in Phase A

- **DECODE2 kit placement** — Arithmetic Kit, new "Control Kit", or
  ungrouped? Suggest new "Control Kit" alongside DECODE2 + ACC_SIGN
  (when it ships) + future MUX-based control parts.
- **Inverter form for the `0`-inactive enable convention** — DECODE2
  could output the existing `T`-inactive convention and downstream
  consumers would just `MAX(en, 0)`. Less elegant but reuses the
  IS_T/IS_0/IS_P detector naturally. **Recommendation:** output
  active-high {0, +1} from DECODE2 so the math downstream stays clean.
- **`oper3` in v1** — wire to ground, leave unconnected, or
  sign-extend by replicating `oper2`? Suggest: leave unconnected
  (`null` is harmless) and let v2's wider ALU read it later.
- **Save-format compatibility** — the new RAM count and wiring will
  load fine because the save format already serialises whatever
  comps/wires are present. No `SAVE_FORMAT_VERSION` bump needed.

---

## Carry-forward notes from today

- `lastAsmProgram` (source + `addrToLine` + `labels`) is captured on
  every successful "Assemble & Load". v2 should keep this shape so
  the debugger source-display stays unchanged.
- The CPU preset's existing decoder is two inverters off the opcode
  trit. CPU2's `DECODE2` replaces this entirely — it isn't an
  expansion, it's a new subcircuit.
- `decodeImemWord` is the single shared instruction-decoder for
  debugger and tests. It needs to handle both ISA versions; the
  cleanest split is `decodeImemWordV1(word)` and
  `decodeImemWordV2(word_lo, word_hi)`.
- The `findImem()` helper traces back from the PC through `a0` —
  generalising it to find TWO RAMs both addressed by the same PC is
  one extra loop.
