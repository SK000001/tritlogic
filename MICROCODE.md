# MICROCODE.md — design doc for E3 (microcoded CPU3)

> **Status (2026-06-03):** design + **Phases 1–4 shipped** — Phase 1 the
> `MSEQ` microsequencer + `microcode-seq` demo; Phase 2 the `UFIELDS`
> field decoder + a two-bank control store (`microcode-fields` demo);
> Phase 3 the dispatch map + the fetch/dispatch/return loop
> (`microcode-dispatch` demo); Phase 4 the **`cpu3` preset** — the
> microengine driving the real ACC/ALU/DMEM datapath, running the counter
> identically to CPU2, plus the `MPCSEQ` macro-PC sequencer.
> Phase 5 below is the remaining plan. This is the live spec — mirrors how
> `ISA_v2.md` preceded E2b.

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

### Microinstruction (the control store word) — **Phase 2 DONE**

Horizontal, one field per control line. Finalized at **6 trits across
two parallel control-store RAM banks** (`romLo`, `romHi`), tapped by the
`UFIELDS` decoder:

```
  bank-lo  q0 = m_seq    seqMode  CONT / DISP / FETCH     (→ MSEQ)
           q1 = m_alu    aluOp    MIN / ADD / MAX = T/0/+1 (→ ALU.op)
           q2 = m_accW   accWrite load ACC this µstep?     (→ ACC.ld, {0,+1})
  bank-hi  q0 = m_accSrc accSrc   ALU result vs DMEM read  (→ ACC-source MUX)
           q1 = m_mem    memCtl   none / read / write = T/0/+1
           q2 = m_pc     pcCtl    macro-PC control
```

Most fields are **pass-through** (horizontal microcode: the field *is*
the control line). The one packed field is `m_mem`, a 1-of-3 memory
control that `UFIELDS` decodes into two `{0,+1}` enables `memWrite`
(`isP`) + `memRead` (`is0`). `bSrc` (ALU.b operand source) was dropped
from the first cut to fit six trits; it returns as a reserved-slot field
if Phase 4 needs it (e.g. operand vs ACC vs const), likely as a third
bank.

Each macro-op's routine is a few of these in sequence. ADDI is one
µinstruction (`aluOp=ADD, accWrite=1, pcCtl=advance, seqMode=FETCH`);
LOAD/STORE become two (address then transfer); a future microcoded
multiply is a loop. `UFIELDS` + the two-bank control store ship in the
`microcode-fields` demo, walking a microprogram with the control lines
changing per µstep (the control unit running "dry," no datapath yet).

### Dispatch map — **Phase 3 DONE**

Macro-opcode (2 trits) → start µaddress of its routine. Rather than the
`DECODE2`-style detector/MUX tree first sketched here, Phase 3 uses a
**mapping ROM** — the textbook microcode dispatch device, and pure
composition: a 9-word read-only `RAM` addressed by the opcode itself
(`a0 = opL`, `a1 = opH`, so word = `opL + 3·opH + 4` — exactly one slot
per v2 opcode), each slot holding that opcode's routine-entry µaddr in
`q0/q1`. Those feed `MSEQ.disp0/disp1`, and µ0's `seqMode = DISP` makes
MSEQ jump there. The map is **soft** (it's data in a ROM), matching the
ethos that the control unit is reprogrammable, not gates.

### Fetch / dispatch / return loop — **Phase 3 DONE**

µword **µ0** is the shared **fetch/dispatch** microinstruction:
`seqMode = DISP` (MSEQ → the dispatch addr from the mapping ROM) +
`pcCtl = ADV` (advance the macro-PC). A macro-op's routine is the µwords
at its entry µaddr; each sets `pcCtl = HOLD` so the macro-PC freezes
mid-instruction, and the last sets `seqMode = FETCH` (MSEQ → µ0). So the
loop is: **µ0 dispatches on the current opcode and bumps the macro-PC →
the routine runs one µword per clock → FETCH returns to µ0**, which now
sees the next opcode. Classic fetch/execute overlap.

The macro-PC has no native "hold", so HOLD is done by **reloading the PC
with its own address**: `pcCtl → PC.jmp`, and `PC.j0/j1 ← PC.p0/p1`. With
the convention `pcCtl = 0` → advance (`jmp = 0`, increment), `pcCtl = +1`
→ hold (`jmp = +1`, load self), the `pcCtl` field drives the macro-PC
directly — no extra gates. (Phase 4 generalizes this: a third `pcCtl`
state + a MUX on `j0/j1` between *self* and an instruction-operand target
gives real macro-level `JMP`/branches.)

The `microcode-dispatch` example runs a two-op micro-ISA — **ADDI** (a
1-µword routine) and **LOAD** (2 µwords) — over a macro-program
`ADDI, LOAD, ADDI, LOAD, …`. The µPC walks `µ0→µ1→µ0→µ2→µ3→µ0→…` and the
macro-PC advances exactly once per instruction; no datapath yet, so this
proves the *control flow* is multi-cycle. Tested on both PC trajectories.

### Datapath integration — the `cpu3` preset (Phase 4) — **DONE**

`cpu3` is the microcoded twin of CPU2: **the same v2 instruction words and
the same ACC / ALU / DMEM datapath**, but the single-cycle `DECODE2` +
combinational control is gone — control now comes from the microengine
(µPC → control store → `UFIELDS` → the datapath control lines).

**`MPCSEQ` (Microcode Kit, new).** The sibling of `MSEQ`, for the *macro*-PC.
Phase 3 held the macro-PC by hardwiring `pcCtl→jmp` + self-feedback; Phase 4
needs a real `JMP` too, so this is promoted to a subcircuit — three native
MUXes keyed on a 1-trit `pcCtl`, mirroring MSEQ:

```
  pcCtl = 0  (ADV)  → jmp=0            : PC increments to the next instruction
  pcCtl = +1 (HOLD) → jmp=+1, j=(p0,p1): PC reloads itself  → holds
  pcCtl = T  (JMP)  → jmp=+1, j=(t0,t1): PC loads the operand → branch
```

`p0/p1` feed back from the macro-PC's own outputs; `t0/t1` are the jump
target (the instruction operand, same `imem_lo.q2`/`imem_hi.q0` CPU2 uses).

**The µ0-holds refinement.** Phase 3's demo advanced the macro-PC *at* µ0
(dispatch). With a real datapath that breaks: the routine reads the
instruction's operand on a *later* clock, by which point the macro-PC has
already moved on. So Phase 4 flips it — **µ0 holds** (`pcCtl = HOLD`, keeping
the macro-PC on the current instruction so its operand stays valid through
the whole routine), and the routine's **last µword advances**: `pcCtl = ADV`
for the next instruction, or `pcCtl = JMP` to load the operand as target.
Both latch on the same edge as `seqMode = FETCH`, from the pre-edge settled
values, so the operand-driven ACC write and the macro-PC advance are
consistent.

**The microprogram** (9 µwords — fits the 9×3 store exactly):

```
  µ0 dispatch (DISP, HOLD)   µ5 JMP   (FETCH, pcCtl=JMP)
  µ1 NOP                     µ6 LOAD  (accSrc=DMEM, mem=read, accW, ADV)
  µ2 ADDI (ADD, accW, ADV)   µ7 STORE (mem=write, ADV)
  µ3 MAXI (MAX, accW, ADV)   µ8 spare
  µ4 MINI (MIN, accW, ADV)
```

The dispatch ROM maps all 9 opcodes; **7 are wired** (NOP/ADDI/MAXI/MINI/
JMP/LOAD/STORE). The two **conditional jumps JMPP/JMPZ are deferred** — they
need the µPC's *next* address to depend on an ACC-sign condition (a
conditional microsequencer, not a static `seqMode` field), and the 9-µword
budget is already full. They're the natural Phase 5 / deeper-ROM work.

The default program is CPU2's counter (`ADDI +1` / `JMP 0`); ACC climbs
0,1,2,3,… identically, just at 2 clocks/instruction (dispatch + execute).
Tests: the counter ACC progression + a STORE/LOAD round-trip through DMEM.

---

## Phase plan (one commit per phase, suite green throughout)

- **Phase 1 — microsequencer.** ✅ `MSEQ` subcircuit + `microcode-seq`
  demo + tests.
- **Phase 2 — control store + field decode.** ✅ Two-bank control store
  (parallel RAMs); the 6-trit microinstruction layout above; the
  `UFIELDS` decoder exposing each field as a named line (+ the `m_mem`
  1-of-3 → memWrite/memRead decode). `microcode-fields` demo drives
  named control outputs through a multi-step microprogram. Tests on the
  field decode + the stepped control-line sequence.
- **Phase 3 — dispatch + fetch loop.** ✅ The opcode→µaddr dispatch map
  (a mapping ROM addressed by the opcode); wire fetch(µ0)→dispatch→
  routine→FETCH back, with the macro-PC held mid-routine by self-reload.
  A two-op micro-ISA (ADDI 1-µword, LOAD 2-µword) running multi-cycle end
  to end (no real ALU yet). `microcode-dispatch` demo + a test on both PC
  trajectories.
- **Phase 4 — datapath integration (CPU3 preset).** ✅ Replaced CPU2's
  `DECODE2`+combinational control with the microengine driving the *real*
  ACC/ALU/DMEM datapath — the `cpu3` preset. Runs the counter identically
  to CPU2 (just 2 clocks/instruction). New **`MPCSEQ`** macro-PC sequencer
  + the µ0-holds refinement + a 9-µword microprogram for 7 of the 9 ops.
  See the section below.
- **Phase 5 — assembler/debugger + microcode authoring.** Debugger
  shows the µPC + current microinstruction alongside the macro-PC; a
  way to view/edit the control store. The macro-assembler is unchanged
  (CPU3 runs v2 binaries); add a microassembler view if time permits.

## Open questions (resolve as phases land)

- **Control-store width vs. RAM size.** RAM is fixed 9×3. A horizontal
  µword needs ~7 fields → 3 parallel banks, and a real microprogram
  needs >9 µwords → either accept ≤9 µwords for CPU3's small ISA, or add
  a wider/deeper native `ROM` (breaks the "composition only" ethos but
  may be necessary past Phase 4). **RESOLVED for Phase 4 by keeping every
  routine to 1 µword** (the combinational ALU/DMEM read lets ADDI, LOAD,
  STORE each finish in one µword): µ0 dispatch + 7 one-µword routines + 1
  spare = 9 µwords, an exact fit. **What the ceiling cost us:** the two
  conditional jumps (JMPP/JMPZ) are deferred — they'd need either extra
  µwords or a conditional sequencer. So the 9-µword wall is real and is
  the trigger for a deeper `ROM` primitive (E5) the moment CPU3 wants the
  full 9 ops or any multi-µword routine (a microcoded multiply, shifts).
- **µPC encoding.** Reuse `PC` (the `+4` offset, wrap-at-8) as the µPC —
  `MSEQ` already targets that encoding. Good enough for ≤9 µwords.
- **Save-format.** Pure composition + existing components → no
  `SAVE_FORMAT_VERSION` bump (same as CPU2).
