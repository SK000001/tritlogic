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
  inverters (STI, PTI, NTI), MIN, MAX, full-trit ADDER, and a D-flip-flop.
- A live combinational simulator (fixed-point iteration) plus a four-phase
  step engine for clocks and flip-flops.
- Truth-table generator over up to 7 swept inputs (2,187 rows).
- Sub-circuit packing: select a region, give it a name, get a reusable
  block with named pins.
- Waveform panel that records every probe on each clock step, displayed
  as three-level step plots.
- Built-in self-tests: hit the **Tests** button — 9 test groups covering
  conversions, gate truth tables, the full adder, ripple addition,
  negation, and DFF edge semantics. All should be green; if anything goes
  red, the simulator is producing wrong values and I want to hear about it.

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

## Deploying to Vercel

Three options, fastest to most permanent:

### Option 1 — drag-and-drop (no account changes needed beyond signup)

1. Sign in at <https://vercel.com>.
2. Go to <https://vercel.com/new> → "Deploy without a Git repository".
3. Drag this entire `tritlogic/` folder onto the drop zone.
4. Click **Deploy**. You get a live URL in ~20 seconds.

### Option 2 — Vercel CLI

```bash
npm install -g vercel
cd tritlogic
vercel              # first run will prompt for project name / org
vercel --prod       # promote to production
```

### Option 3 — GitHub + Vercel (best for ongoing updates)

```bash
cd tritlogic
git init
git add .
git commit -m "Initial TritLogic deploy"

# Create the repo on GitHub, then:
git remote add origin https://github.com/YOURNAME/tritlogic.git
git push -u origin main
```

Then in the Vercel dashboard: **Add New… → Project → Import Git Repository**,
pick the repo, accept the defaults, deploy. Every push to `main` becomes a
new production deploy; every pull request gets its own preview URL.

### About `vercel.json`

The included `vercel.json` does three small things:

- Disables long caching on `index.html` so a redeploy is immediately
  visible to returning visitors. (Vercel's other assets — none yet — get
  the default long-cache treatment.)
- Adds `X-Content-Type-Options: nosniff` and a couple of other low-risk
  hardening headers.
- Enables `cleanUrls` so `/index` works the same as `/index.html`.

None of this is required to deploy successfully; you can delete the file
and Vercel will still serve the site.

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
implements phases 1–4 (logic, voltage thresholds in concept, gates) and
phase 5 (arithmetic). The natural next steps are phase 6 (registers /
memory beyond the single D-flip-flop) and phase 8 (ISA encoding fed into
a simulated CPU built out of this canvas).

## License

Treat this as personal / educational. If you want to ship it commercially,
ask first.
