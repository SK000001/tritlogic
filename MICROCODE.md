# MICROCODE.md — design doc for E3 (microcoded CPU3)

> **Status (2026-06-02):** design + **Phase 1 shipped** (the `MSEQ`
> microsequencer subcircuit + a `microcode-seq` demo). Phases 2–5 below
> are the remaining multi-session plan for the full microcoded CPU3.
> This is the live spec — mirrors how `ISA_v2.md` preceded E2b.

---

## Why microcode

Today's `CPU2` is **single-cycle**: `DECODE2` maps the 2-trit opcode to
nine one-hot enable lines combinationally, and the control signals
(`accWrite`, `jmpEn`, `aluOpSel`, `dmemWrite`, `accSrc`) are pure
functions of the opcode, all consumed in one clock. That caps every
instruction at one ALU pass + one register write — no instruction can
take several steps, so anything needing a sequence (a multi-word move, a
read-modify-write, a shift-by-N, a microcoded multiply) is impossible.

**Microcode** replaces the combinational decoder with a small program:

```
   macro instruction (opcode)                 the DECODE2 path becomes…
        │                                            a control STORE
        ▼                                            walked by a µPC
   ┌─────────┐   dispatch    ┌───────────────────────────────────────┐
   │ dispatch│──────────────►│ µPC ─► control store (µROM) ─► control │
   │   map   │               │  ▲                              words  │
   └─────────┘               │  └──────── microsequencer ◄───seq field│
                             └───────────────────────────────────────┘
```

Each macro-instruction dispatches the µPC to the first **microinstruction**
of its routine; the µPC then walks that routine one µinstruction per
clock until a microinstruction's *sequencing field* says "done — fetch
the next macro-instruction." Every microinstruction is a **horizontal**
control word: each field drives one datapath control line directly, so
"decoding" is just reading the store.

This makes instructions **multi-cycle** and the control unit **soft** —
new macro-ops are new microroutines in the store, not new gates.

---

## The microsequencer (Phase 1 — DONE)

The novel core of any microcoded machine is the **next-µaddress**
decision. Everything else (the µPC register, the control store, the
datapath) reuses parts TritLogic already has — `PC`, `RAM`, `MUX`,
`REG3`, `ALU`. So Phase 1 is exactly that decision, as a subcircuit.

### `MSEQ` — microsequencer (Microcode Kit)

```
  pins
    in:  seqMode, disp0, disp1
    out: jmp, j0, j1            (wire straight into a PC acting as the µPC)
```

`seqMode` is the microinstruction's 1-trit sequencing field:

| seqMode | meaning | µPC next            | drives PC as |
|---------|---------|---------------------|--------------|
| `0`     | CONT    | µPC + 1             | `jmp=0` (PC increments) |
| `+1`    | DISP    | dispatch address    | `jmp=+1`, `j0/j1 = disp` |
| `T`     | FETCH   | µword 0 (fetch)     | `jmp=+1`, `j0/j1 = (T,T)` |

The PC convention is `word index = tritsToInt(p) + 4`, so µword 0 is
`p = (T, T)` — that's why FETCH loads `(T, T)`.

The whole thing is **three native MUXes** keyed on `seqMode` (no detector
gates), reusing MUX's `s ∈ {T,0,+1} → dT/d0/dP` routing:

```
  jmp = MUX(s=seqMode, dT=+1, d0=0,     dP=+1)     ; load on DISP/FETCH, inc on CONT
  j0  = MUX(s=seqMode, dT=−1, d0=disp0, dP=disp0)  ; FETCH→T, DISP→disp; CONT don't-care
  j1  = MUX(s=seqMode, dT=−1, d0=disp1, dP=disp1)
```

Exhaustively tested over `seqMode × disp`. The `microcode-seq` example
wires `MSEQ` to a `PC` (the µPC) and a `RAM` (the µROM): the µROM's `q0`
is the `seqMode` field, `q1/q2` are demo control bits, and the µPC walks
a CONT,CONT,CONT,FETCH microprogram, looping 0,1,2,3,0,… — a control
sequence cycling on its own, the essence of horizontal microcode.

---

## Word formats (Phases 2+)

### Macro-instruction

Unchanged from the v2 ISA — 6 trits across two parallel RAMs
(`imem_lo`, `imem_hi`): `[opL, opH, oper0, oper1, oper2, oper3]`. The
macro-PC still addresses IMEM. **CPU3 keeps the v2 assembler and word
format**, so existing programs run; only the control unit changes.

### Microinstruction (the control store word)

Horizontal, one field per control line. A first cut (subject to Phase-2
field allocation), packed across parallel control-store RAM banks:

```
  seqMode    1 trit   CONT / DISP / FETCH         (→ MSEQ)
  aluOpSel   1 trit   MIN / ADD / MAX             (→ ALU.op)
  accWrite   1 trit   load ACC this µstep?        (→ ACC.ld, {0,+1})
  accSrc     1 trit   ALU result vs DMEM read     (→ ACC-source MUX)
  bSrc       1 trit   operand vs ACC vs const     (→ ALU.b MUX)
  memCtl     1 trit   none / read / write         (→ DMEM we + addr enable)
  pcCtl      1 trit   hold / inc / branch         (→ macro-PC)
  …reserved          spare fields for new ops
```

Each macro-op's routine is a few of these in sequence. ADDI is one
µinstruction (`aluOpSel=ADD, accWrite=1, pcCtl=inc, seqMode=FETCH`);
LOAD/STORE become two (address then transfer); a future microcoded
multiply is a loop.

### Dispatch map

Macro-opcode (2 trits) → start µaddress of its routine. Smallest build:
a `DECODE2`-style detector feeding a priority/MUX tree that emits the
9 routine entry points. Phase 3.

---

## Phase plan (one commit per phase, suite green throughout)

- **Phase 1 — microsequencer.** ✅ `MSEQ` subcircuit + `microcode-seq`
  demo + tests. (This session.)
- **Phase 2 — control store + field decode.** Build the µROM from
  parallel RAMs; define the microinstruction field layout; a
  `UFIELDS`-style splitter exposing each field as a named line. A demo
  that drives a *dummy* datapath (LEDs/outputs) through a multi-step
  microprogram. Tests on the field decode.
- **Phase 3 — dispatch + fetch loop.** The opcode→µaddr dispatch map;
  wire fetch(µ0)→dispatch→routine→FETCH back. A two-op micro-ISA
  running multi-cycle end to end (no real ALU yet). Tests on the µPC
  trajectory for a sample program.
- **Phase 4 — datapath integration (CPU3 preset).** Replace CPU2's
  `DECODE2`+combinational control with the microengine driving the
  *real* ACC/ALU/DMEM datapath. The `cpu3` preset. Re-run the counter
  program; ACC must climb identically to CPU2. This is the big wiring
  phase.
- **Phase 5 — assembler/debugger + microcode authoring.** Debugger
  shows the µPC + current microinstruction alongside the macro-PC; a
  way to view/edit the control store. The macro-assembler is unchanged
  (CPU3 runs v2 binaries); add a microassembler view if time permits.

## Open questions (resolve as phases land)

- **Control-store width vs. RAM size.** RAM is fixed 9×3. A horizontal
  µword needs ~7 fields → 3 parallel banks, and a real microprogram
  needs >9 µwords → either accept ≤9 µwords for CPU3's small ISA, or add
  a wider/deeper native `ROM` (breaks the "composition only" ethos but
  may be necessary past Phase 3). **Lean:** stay on parallel 9×3 RAMs
  through Phase 3; revisit a `ROM` primitive only if Phase 4's
  microprogram overflows 9 µwords.
- **µPC encoding.** Reuse `PC` (the `+4` offset, wrap-at-8) as the µPC —
  `MSEQ` already targets that encoding. Good enough for ≤9 µwords.
- **Save-format.** Pure composition + existing components → no
  `SAVE_FORMAT_VERSION` bump (same as CPU2).
