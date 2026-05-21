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

- A canvas with grid snap, pan, zoom, rect-select, drag-to-move.
- Ten preset example circuits — pick one from the dropdown in the header.
- Components: INPUT (cycle T/0/+1), CONST, TRYTE_IN, CLOCK (tri-state
  or two-state cycle), OUTPUT probe, TRYTE_OUT, WAVE recorder, the three
  inverters (STI, PTI, NTI), MIN, MAX, full-trit ADDER, a D-flip-flop,
  and a 3-trit register (REG3 — three DFFs on a shared clock with a
  load-enable line).
- A live combinational simulator (fixed-point iteration) plus a four-phase
  step engine for clocks and flip-flops.
- Truth-table generator over up to 7 swept inputs (2,187 rows).
- Sub-circuit packing: select a region, give it a name, get a reusable
  block with named pins.
- Waveform panel that records every probe on each clock step, displayed
  as three-level step plots.
- An in-app component reference (**Info** button) — an encyclopedia page
  for every component, with pins and truth tables generated live from the
  simulator. Select a component first to jump straight to its page.
- Built-in self-tests: hit the **Tests** button — test groups covering
  conversions, gate truth tables, the full adder, ripple addition,
  negation, DFF edge semantics, and REG3 register load/hold behaviour.
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
- **Subcircuits aren't editable in place.** To change a packed block, you
  build a new version and re-pack. There is no recursive editor.
- **No persistent state across sessions.** Save/load uses JSON file
  download/upload.
- **Browser support.** Tested in modern Chrome and Firefox. Safari should
  work but isn't a primary target.

## Future direction

The accompanying research guide (in the parent directory) covers ten
phases of a ternary computing project from theory to hardware. TritLogic
implements phases 1–4 (logic, voltage thresholds in concept, gates),
phase 5 (arithmetic), and has started on phase 6 (memory) with the DFF
and the 3-trit register. The natural next steps are a wider addressable
ternary RAM block (rest of phase 6) and phase 8 (ISA encoding fed into a
simulated CPU built out of this canvas).

## License

Treat this as personal / educational. If you want to ship it commercially,
ask first.
