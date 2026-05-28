# TritLogic

A balanced-ternary circuit simulator that runs in the browser. Place gates,
wire them, watch three-state signals propagate. Built as the prototyping
companion to a longer research guide on ternary computing.

**States.** Every wire carries one of three values:

- `T` = −1  (red)
- `0` =  0  (grey)
- `1` = +1  (green)

`null` (dark grey) means undefined / floating, and propagates through gates
the way you'd expect.

## What's in here

- A canvas with grid snap, pan, zoom, rect-select, drag-to-move, undo/
  redo (Ctrl+Z / Ctrl+Y), and a searchable component palette (Ctrl+F).
- Twenty preset example circuits — pick one from the dropdown in the
  header. Includes RAM store-and-read-back, ALU add, MUX routing, PC
  counting, two complete CPUs (a 3-op `CPU` and a 9-op `CPU2` running
  the wider v2 ISA), an all-structural CPU twin (`cpu-structural` —
  every sequential and arithmetic block built from MIN/MAX gates via
  the kits), and a 2-layer ternary neural network. Clock-driven
  examples start running the moment they are selected.
- Native components: INPUT, CONST, TRYTE_IN, CLOCK, OUTPUT, TRYTE_OUT,
  WAVE, the three inverters (STI, PTI, NTI), MIN, MAX, full-trit
  ADDER, ternary 3:1 MUX, DFF, REG3 (3-trit register), RAM (9 words ×
  3 trits), ALU (op T/0/+1 → MIN/ADD/MAX), and PC (2-trit program
  counter).
- Four kits of built-in subcircuits (every gate openable down to the
  three native inverters):
  - **Arithmetic Kit** — TSUM, TCARRY, FADD, ALU3, MUX3
  - **Sequential Kit** — TLATCH, TFLOP, TREG3, TPC, TRAM (cross-coupled
    MIN/MAX feedback; no native sequential primitive inside)
  - **Control Kit** — DECODE2 (2-trit opcode → 9 one-hot enables for
    CPU2), ACC_SIGN (ACC sign-detection for conditional jumps)
  - **Neural-Net Kit** — TMUL, MAC3, ACT (the building blocks of the
    `ternary-mac` / `ternary-layer` / `ternary-mlp` presets)
- A live combinational simulator (fixed-point iteration) plus a four-
  phase step engine for clocks and flip-flops.
- A **ternary assembler** + load-into-IMEM modal — write a small
  program (3-op v1 or 9-op v2 ISA), check it, load it straight into
  the CPU preset's RAM. Source dropdown ships canned programs for
  each ISA (counter, saturating-counter, MINI demo, JMPZ cycle,
  LOAD/STORE round-trip via DMEM, etc.).
- A **debugger panel** for the live CPU — single-step, step-cycle, run
  with breakpoints, source listing with PC highlighted, IMEM dump,
  ACC sign chip showing whether the next conditional jump will branch.
- **Sub-circuit packing**: select a region, give it a name, get a
  reusable block with named pins. Built-in subcircuits are
  middle-clickable to drill in and trace every gate.
- Truth-table generator over up to 7 swept inputs (2,187 rows).
- Waveform panel that records every probe on each clock step, displayed
  as three-level step plots.
- An in-app component reference (**Info** button) — encyclopedia pages
  for every component and built-in subcircuit, with pins and truth
  tables generated live from the simulator. Select a component first
  to jump straight to its page.
- Built-in self-tests: hit the **Tests** button — 77 tests covering
  conversions, gate truth tables, the full adder, ripple addition,
  negation, DFF / REG3 / RAM semantics, ALU add/min/max, every kit
  subcircuit's gate-level equivalence to its native twin, the v1 + v2
  assemblers (round-trip + every canned example), DECODE2 + ACC_SIGN
  exhaustive checks, live-CPU programs running on both CPU presets,
  LOAD/STORE through DMEM, debugger breakpoint handling, save-format
  migrations, undo/redo, and the searchable palette filter.
  All should be green; if anything goes red, the simulator is producing
  wrong values and I want to hear about it.

## Running locally

It's static HTML — no build step. Either:

```bash
# Easiest: just open the file
xdg-open index.html      # Linux
open index.html          # macOS
start index.html         # Windows
```

Or serve it (recommended if you plan to extend with ES modules later):

```bash
# Python 3
python -m http.server 8000

# Node
npx serve .
```

Then visit `http://localhost:8000`.

## Run live version

The latest version is always live at https://tern-pi.vercel.app/.

## Known limitations

- **Logical, not electrical.** Wires settle instantly. Noise, propagation
  delay, signal integrity, and voltage levels are not modelled.
- **No persistent state across sessions.** Save/load uses JSON file
  download/upload. The save format has a registered version-migration
  chain (`upgradeSave()` in `js/util.js`) so old saves keep loading as
  the format evolves.
- **Browser support.** Tested in modern Chrome and Firefox. Safari should
  work but isn't a primary target.

## Future direction

The accompanying research guide (in the parent directory) covers ten
phases of a ternary computing project from theory to hardware. TritLogic
implements phases 1–4 (logic, voltage thresholds in concept, gates),
phase 5 (arithmetic), phase 6 (memory — DFF, REG3, RAM and their gate-
level structural twins), phase 7 (CPU skeleton — both a native-parts
CPU and an all-structural `cpu-structural` variant ship as presets),
and phase 8 (a 9-op ISA with assembler + debugger + LOAD/STORE through
a data-memory RAM). Phase 10 (physical prototype) is underway in the
sibling `../photonic/` workspace as a CORNERSTONE-PDK photonic
ternary-MAC chip.

## License

Treat this as personal / educational. If you want to ship it commercially,
ask first.
