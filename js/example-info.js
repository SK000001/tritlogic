// ============================================================================
//  EXAMPLE WALKTHROUGH DATA (Info modal → "Example walkthroughs" tab)
// ============================================================================
//
//  Detailed, beginner-friendly explanations of every preset in the Load-Example
//  dropdown. Pure data — rendering lives in app.js (renderExampleList /
//  showExampleEntry). Each key here matches a key in EXAMPLES (examples.js) so
//  the detail page can show a "Load this example" button; the synthetic key
//  `_exintro` is the landing page and has no matching preset.
//
//  Diagrams are ASCII inside <pre class="info-diagram"> (box-drawing chars,
//  themeable, copy-pasteable) plus step-trace tables (<table class="info-tt">).
//  Keep the prose plain and concrete: say what each wire carries and what to
//  watch on screen when the example is Stepped or Played.

// Left-hand list order for the Examples tab. Keys map to EXAMPLES (or _exintro).
export const EXAMPLE_INFO_CATEGORIES = [
  ['Start here',         ['_exintro']],
  ['Logic & inverters',  ['sti-inverter', 'sti-chain', 'min-max', 'three-way-branch']],
  ['Arithmetic',         ['half-adder', 'full-adder', 'ripple-3', 'alu-demo']],
  ['Routing & memory',   ['mux-demo', 'd-storage', 't-flop', 'ram-store', 'pc-demo', 'tryte-io']],
  ['Buses',              ['tristate-bus', 'regfile-bus', 'word-bus', 'regfile-wordbus', 'tryte-bus', 'bus-datapath']],
  ['CPU',                ['cpu', 'cpu-structural', 'cpu2']],
  ['Microcode',          ['microcode-seq', 'microcode-fields', 'microcode-dispatch', 'cpu3']],
  ['Neural net',         ['ternary-mac', 'ternary-layer', 'ternary-mlp']],
];

export const EXAMPLE_INFO = {
  // ---- landing page --------------------------------------------------------
  _exintro: {
    name: 'About the examples',
    tagline: 'How to load a preset and read what it is doing',
    body: `
      <p>Every entry on the left is a ready-made circuit you can load onto the
      canvas. These walkthroughs explain <em>how each one works</em> — what each
      block computes, what the wires carry, and what to watch when you run it.</p>

      <h4>Loading one</h4>
      <ul>
        <li>Use the <b>Load Example</b> dropdown in the toolbar, <em>or</em></li>
        <li>press <b>▶ Load this example</b> at the top of any walkthrough here.</li>
      </ul>

      <h4>Running it</h4>
      <p>Circuits with no clock are <b>combinational</b> — they settle instantly,
      and you change them by clicking an <code>INPUT</code> to cycle its trit
      (<span class="trit-T">T</span> → <span class="trit-0">0</span> →
      <span class="trit-P">+1</span>). Circuits with a <code>CLOCK</code> are
      <b>sequential</b> — press <b>Step</b> to advance one tick, or <b>Play</b>
      to free-run. A <code>bi</code> clock latches every <b>2</b> steps; a
      <code>tri</code> clock every <b>3</b>.</p>

      <h4>Reading values</h4>
      <p>Wires and pins are colour-coded: <span class="trit-T">T = −1 (red)</span>,
      <span class="trit-0">0 (grey)</span>, <span class="trit-P">+1 (green)</span>,
      and dark-grey means <em>floating</em> (undriven). <code>OUTPUT</code> shows
      the settled value; <code>WAVE</code> records a trace you can open in the
      <b>Wave</b> panel.</p>

      <h4>Going deeper</h4>
      <p>Switch to the <b>Components</b> tab for the per-block reference (pins,
      truth tables, internals). Many examples place <em>subcircuits</em> — double-
      click one on the canvas to open it and see the gates inside.</p>`,
  },

  // ---- Logic & inverters ---------------------------------------------------
  'sti-inverter': {
    name: 'STI inverter (NEG)',
    tagline: 'The ternary NOT gate: out = −in',
    body: `
      <p>The smallest possible circuit — a single <b>STI</b> (Standard Ternary
      Inverter) negating one input. It is the ternary analogue of a NOT gate.</p>
      <pre class="info-diagram">
   a ──▶ [ STI ] ──▶ y        y = −a
      </pre>
      <p>STI just <b>flips the sign</b> of the trit: it swaps
      <span class="trit-T">T</span> and <span class="trit-P">+1</span> and leaves
      <span class="trit-0">0</span> alone. That is exactly what negating a
      balanced-ternary number does — negate every trit.</p>
      <table class="info-tt">
        <thead><tr><th>a</th><th>y = −a</th></tr></thead>
        <tbody>
          <tr><td class="trit-T">T</td><td class="trit-P">+1</td></tr>
          <tr><td class="trit-0">0</td><td class="trit-0">0</td></tr>
          <tr><td class="trit-P">+1</td><td class="trit-T">T</td></tr>
        </tbody>
      </table>
      <p><b>Try it:</b> click the <code>a</code> input to cycle its value and
      watch <code>y</code> flip. There is no clock, so the change is instant.</p>`,
  },
  'sti-chain': {
    name: 'STI chain (double negation)',
    tagline: 'Two inverters in series cancel out — the simplest composition',
    body: `
      <p>Two <b>STI</b> gates back to back. Negating twice returns the original
      value, so the whole chain is the <b>identity</b> function — a concrete way
      to see that gates compose like maths functions.</p>
      <pre class="info-diagram">
   a ──▶ [ STI ] ──▶ [ STI ] ──▶ y      y = −(−a) = a
              n1          n2
      </pre>
      <p>The middle wire <code>n1</code> carries the negated value; the second
      STI negates it back. Whatever you set <code>a</code> to, <code>y</code>
      matches it, while the wire between the two gates always shows the opposite
      colour. This "−(−x) = x" cancellation is the basis of why an even number
      of inverters is a buffer and an odd number is an inverter.</p>`,
  },
  'min-max': {
    name: 'MIN / MAX (AND / OR)',
    tagline: 'The two fundamental two-input ternary gates',
    body: `
      <p><b>MIN</b> and <b>MAX</b> are to ternary what AND and OR are to binary.
      Order the states <code>T &lt; 0 &lt; +1</code>; then MIN returns the
      <em>smaller</em> of its inputs and MAX the <em>larger</em>.</p>
      <pre class="info-diagram">
   a ─┬─▶ [ MIN ] ──▶ min = lesser(a, b)
      │     ▲
   b ─┼─────┘
      │
      ├─▶ [ MAX ] ──▶ max = greater(a, b)
      └─────┘
      </pre>
      <p>The default <code>a = </code><span class="trit-T">T</span>,
      <code>b = </code><span class="trit-P">+1</span> gives
      <code>min = </code><span class="trit-T">T</span> and
      <code>max = </code><span class="trit-P">+1</span>. Restricted to just
      <span class="trit-T">T</span> and <span class="trit-P">+1</span> (treating
      T as "false"), MIN behaves exactly like Boolean AND and MAX like OR — but
      they also do something sensible with the third value <span class="trit-0">0</span>.</p>
      <p><b>Try it:</b> cycle <code>a</code> and <code>b</code> through all nine
      combinations and confirm MIN always tracks the lesser, MAX the greater.</p>`,
  },
  'three-way-branch': {
    name: 'Three-way branch (sign detector)',
    tagline: 'One trit in, a one-hot {neg, zero, pos} out — the decoder pattern',
    body: `
      <p>This is the building block behind every <em>decoder</em> in the project:
      it takes one <code>sign</code> trit and lights exactly one of three
      outputs — <code>neg</code>, <code>zero</code>, <code>pos</code> — depending
      on whether the input is negative, zero, or positive.</p>
      <pre class="info-diagram">
                 ┌─ NTI ───────────────▶ neg   (+1 iff sign = T)
   sign ─┬──────▶│
         │       └─ NTI ─┐
         │              MAX ─▶ STI ────▶ zero  (+1 iff sign = 0)
         └─ PTI ─▶ STI ──┘
                    │
                    └──────────────────▶ pos   (+1 iff sign = +1)
      </pre>
      <p>The trick is to combine the three ternary inverters:</p>
      <ul>
        <li><b>neg</b> = <code>NTI(sign)</code> — NTI answers "is the input T?",
        so it is <span class="trit-P">+1</span> only for a negative input.</li>
        <li><b>pos</b> = <code>STI(PTI(sign))</code> — PTI answers "is it not +1?";
        negating that gives <span class="trit-P">+1</span> only for a positive input.</li>
        <li><b>zero</b> = <code>STI(MAX(neg, pos))</code> — if it is neither
        negative nor positive, it must be zero. MAX is <span class="trit-P">+1</span>
        when <em>either</em> neg or pos fires; STI inverts that, so zero is
        <span class="trit-P">+1</span> exactly when both are quiet.</li>
      </ul>
      <p>Cycle <code>sign</code> through T / 0 / +1 and watch the active output
      hop. This same "detect a specific trit value" idea, scaled to two trits,
      is the <code>DECODE2</code> subcircuit that decodes CPU2's opcodes.</p>`,
  },

  // ---- Arithmetic ----------------------------------------------------------
  'half-adder': {
    name: 'Half-trit adder',
    tagline: 'One ADDER with carry-in tied to 0',
    body: `
      <p>A single <b>ADDER</b> adding two trits with no incoming carry. The
      arithmetic sum <code>a + b</code> ranges −2…+2, which one trit cannot hold,
      so the ADDER splits it into a low trit <code>sum</code> and a carry
      <code>cout</code> per the identity:</p>
      <p style="text-align:center"><code>a + b + cin = 3·cout + sum</code></p>
      <pre class="info-diagram">
   a   ──▶┌───────┐
   b   ──▶│ ADDER │──▶ sum    (low trit)
   0 ────▶│       │──▶ cout   (carry)
     cin  └───────┘
      </pre>
      <p>"Half" means the carry-<em>in</em> is fixed at <span class="trit-0">0</span>
      (the <code>CONST 0</code> block). The default <code>a = b = </code>
      <span class="trit-P">+1</span> gives <code>1 + 1 = 2</code>, which in
      balanced ternary is <code>+1·3 + (−1)</code> — so <code>cout = </code>
      <span class="trit-P">+1</span> and <code>sum = </code><span class="trit-T">T</span>.
      Cycle the inputs to see every case.</p>`,
  },
  'full-adder': {
    name: 'Full-trit adder',
    tagline: 'The same ADDER, now with a real carry-in',
    body: `
      <p>The full single-trit adder: three trits in (<code>a</code>,
      <code>b</code>, <code>cin</code>), two trits out (<code>sum</code>,
      <code>cout</code>). It is the exact same <b>ADDER</b> primitive as the
      half-adder, but here <code>cin</code> is a live input instead of a tied 0 —
      which is what lets you chain adders into wider words.</p>
      <pre class="info-diagram">
   a   ──▶┌───────┐
   b   ──▶│ ADDER │──▶ sum
   cin ──▶│       │──▶ cout
          └───────┘     a + b + cin = 3·cout + sum
      </pre>
      <p>Now the sum ranges −3…+3. Default <code>a = </code><span class="trit-P">+1</span>,
      <code>b = </code><span class="trit-T">T</span>, <code>cin = </code><span class="trit-0">0</span>
      gives <code>1 − 1 + 0 = 0</code> → <code>sum = </code><span class="trit-0">0</span>,
      <code>cout = </code><span class="trit-0">0</span>. The <b>3-trit ripple
      adder</b> example wires three of these together.</p>`,
  },
  'ripple-3': {
    name: '3-trit ripple adder',
    tagline: 'Three ADDERs chained carry-to-carry = a 3-trit word adder',
    body: `
      <p>Three full adders stacked into a <b>ripple-carry</b> array — the
      standard way to add multi-trit words. Each stage adds one trit of
      <code>a</code> to the matching trit of <code>b</code>, and passes its carry
      <em>up</em> to the next more-significant stage.</p>
      <pre class="info-diagram">
   a0 b0   a1 b1        a2 b2
    │  │    │  │         │  │
   ┌▼──▼┐  ┌▼──▼┐       ┌▼──▼┐
 0▶│ADD0│  │ADD1│       │ADD2│
   └─┬──┘c0└─┬──┘  c1   └─┬──┘ c2
     │  └────▶│  └────────▶│  └──▶ cout
     ▼        ▼            ▼
     s0       s1           s2     (result, low→high)
      </pre>
      <p>The least-significant carry-in is tied to <span class="trit-0">0</span>;
      each <code>cout</code> feeds the next <code>cin</code>, exactly like
      long-hand addition carrying into the next column. The defaults set the
      low trits of both words to <span class="trit-P">+1</span>
      (<code>1 + 1 = 2</code>), so stage 0 emits <code>sum = </code><span class="trit-T">T</span>
      and carries <span class="trit-P">+1</span> into stage 1. Six of these in a
      row add two whole trytes.</p>`,
  },
  'alu-demo': {
    name: 'ALU — add two 3-trit words',
    tagline: 'A whole word adder with a mode selector, no clock needed',
    body: `
      <p>The native <b>ALU</b> block doing word arithmetic on two 3-trit inputs
      <code>A</code> and <code>B</code>. A single <code>op</code> trit chooses
      what it computes:</p>
      <table class="info-tt">
        <thead><tr><th>op</th><th>result</th></tr></thead>
        <tbody>
          <tr><td class="trit-T">T</td><td>MIN(A, B) — trit-wise minimum</td></tr>
          <tr><td class="trit-0">0</td><td>A + B — ripple-carry sum (+ cout)</td></tr>
          <tr><td class="trit-P">+1</td><td>MAX(A, B) — trit-wise maximum</td></tr>
        </tbody>
      </table>
      <pre class="info-diagram">
   A (a0,a1,a2) ─▶┌─────┐
   B (b0,b1,b2) ─▶│ ALU │─▶ r0,r1,r2  (result word)
   op ───────────▶│     │─▶ cout
                  └─────┘
      </pre>
      <p>The defaults load <code>A = 5</code> and <code>B = 4</code> with
      <code>op = </code><span class="trit-0">0</span>, so the result is
      <code>9</code> (trits <span class="trit-0">0</span>,<span class="trit-0">0</span>,<span class="trit-P">+1</span>).
      It is purely combinational — flip <code>op</code> to <span class="trit-T">T</span>
      or <span class="trit-P">+1</span> and the result switches to MIN or MAX
      instantly, no clock involved.</p>`,
  },

  // ---- Routing & memory ----------------------------------------------------
  'mux-demo': {
    name: 'MUX — route one of three inputs',
    tagline: 'The select trit picks which data input reaches the output',
    body: `
      <p>A 3:1 multiplexer. One select trit <code>s</code> chooses which of three
      data inputs (<code>dT</code>, <code>d0</code>, <code>dP</code>) is passed
      through to the output.</p>
      <pre class="info-diagram">
   dT ─▶┐
   d0 ─▶┤ MUX ├──▶ out      s = T  → out = dT
   dP ─▶┘             0  → out = d0
          ▲              +1 → out = dP
          s
      </pre>
      <p>The three data inputs hold distinct values
      (<span class="trit-T">T</span>, <span class="trit-0">0</span>,
      <span class="trit-P">+1</span>) so the routing is obvious. Click
      <code>s</code> to cycle it and watch <code>out</code> follow the matching
      input. The MUX is the workhorse of the whole project: its
      "select-routes-the-value" behaviour <em>is</em> the decode step in the MSEQ
      microsequencer and the multiply step in the ternary-weight MAC.</p>`,
  },
  'd-storage': {
    name: 'D flip-flop storage',
    tagline: 'One bit of memory: capture d on the rising clock edge, then hold',
    body: `
      <p>A single <b>DFF</b> (D flip-flop) — the simplest memory element. On each
      rising clock edge it <em>samples</em> whatever is on <code>d</code> and
      holds it on <code>q</code> until the next edge.</p>
      <pre class="info-diagram">
   d   ──▶┌─────┐
          │ DFF │──▶ q     q ← d  on each rising edge,
   clk ──▶│     │              held steady in between
          └─────┘
      </pre>
      <p>The clock here is in <code>tri</code> mode, so it climbs
      <span class="trit-T">T</span> → <span class="trit-0">0</span> →
      <span class="trit-P">+1</span> and latches once per 3 steps (on the
      transition into +1). Three <code>WAVE</code> probes record <code>clk</code>,
      <code>d</code> and <code>q</code> — open the <b>Wave</b> panel and you will
      see <code>q</code> only change on the clock's rising edges, never between
      them. Change <code>d</code> mid-cycle and notice <code>q</code> ignores it
      until the next edge: that edge-triggering is what makes synchronous logic
      predictable.</p>`,
  },
  't-flop': {
    name: 'T flip-flop (toggle)',
    tagline: 'Feed a DFF its own inverted output → it flips every clock',
    body: `
      <p>Wire a flip-flop's output back to its input through an inverter and you
      get a <b>toggle</b>: every rising edge, <code>q</code> becomes the opposite
      of what it was. This is the basic frequency divider — <code>q</code>
      changes half as often as the clock.</p>
      <pre class="info-diagram">
        ┌─────────── STI ◀──────────┐
        ▼                           │
   ┌─────┐                          │
   │ DFF │── q ──┬──────────────────┘
   │     │       └──▶ (wave)
   └──▲──┘
   clk
      </pre>
      <p>On each edge the DFF samples <code>d = −q</code>, so it lands on the
      negation of its current state, then negates again next edge, and so on. The
      <code>WAVE</code> on <code>q</code> draws a slower square-ish wave against
      the clock trace. (Because the feedback is a pure STI negation, in
      <code>tri</code> mode <code>q</code> alternates between
      <span class="trit-P">+1</span> and <span class="trit-T">T</span>.)</p>`,
  },
  'ram-store': {
    name: 'RAM — store and read back',
    tagline: 'Write a 3-trit word into one address, read it out the q pins',
    body: `
      <p>The native <b>RAM</b> block holds 9 words of 3 trits each, addressed by
      two trits <code>a0</code>, <code>a1</code>. This example writes one word and
      reads it straight back.</p>
      <pre class="info-diagram">
   a0,a1 ─▶┌──────┐
   d0..d2 ─▶│ RAM  │─▶ q0,q1,q2   (async read of word[addr])
   we ─────▶│ 9×3  │
   clk ────▶└──────┘   write happens on rising edge when we = +1
      </pre>
      <p>Addresses are balanced-ternary, so <code>a0 = a1 = </code><span class="trit-0">0</span>
      selects the <em>middle</em> word, index 4 of 0…8 (the map is
      <code>(a0+1) + 3·(a1+1)</code>). With <code>we</code> held
      <span class="trit-P">+1</span> and the clock free-running, the first rising
      edge latches the data trits <code>(+1, T, +1)</code> into word 4; the
      <code>q</code> outputs (which read continuously, no clock needed) then show
      that word. <b>Try it:</b> after it has stored, set <code>we</code> to
      <span class="trit-0">0</span>, change the <code>d</code> inputs, and Step —
      the stored word stays put because writes are disabled.</p>`,
  },
  'pc-demo': {
    name: 'PC — program counter',
    tagline: 'A counter that increments each clock, or jumps when told to',
    body: `
      <p>The <b>PC</b> (program counter) is a 2-trit address register with one
      special trick: each rising edge it either <em>increments</em> or
      <em>jumps</em>, depending on its <code>jmp</code> pin.</p>
      <pre class="info-diagram">
   jmp ──▶┌─────┐
   j0  ──▶│ PC  │─▶ p0,p1   jmp = +1 → load (j0,j1)
   j1  ──▶│     │           else     → count up (wrap 8→0)
   clk ──▶└─────┘
      </pre>
      <p>With <code>jmp = </code><span class="trit-0">0</span> (the default) the PC
      just counts: word 0, 1, 2, … 8, then wraps back to 0. The face shows the
      current word index and a <code>WAVE</code> traces the low trit. <b>Try it:</b>
      set <code>jmp = </code><span class="trit-P">+1</span> and pick values for
      <code>j0</code>/<code>j1</code> — on the next edge the PC loads that address
      instead of counting. That load-vs-increment choice is exactly how a CPU
      takes a branch, and how the microcode µPC is steered by the MSEQ block.</p>`,
  },
  'tryte-io': {
    name: 'Tryte input → tryte probe',
    tagline: 'A whole 6-trit word as a number, on six parallel wires',
    body: `
      <p>A <b>TRYTE_IN</b> source feeding a <b>TRYTE_OUT</b> display directly. A
      "tryte" is a 6-trit word — the ternary cousin of a byte — and represents
      values from −364 to +364.</p>
      <pre class="info-diagram">
   ┌──────────┐  t0 ─────▶┌───────────┐
   │ TRYTE_IN │  t1 ─────▶│ TRYTE_OUT │
   │  = 17    │   …  6    │  shows 17 │
   │          │  t5 ─────▶│           │
   └──────────┘  wires    └───────────┘
      </pre>
      <p>The source breaks the number 17 into six balanced-ternary trits on pins
      <code>t0</code> (least-significant) … <code>t5</code>; the six wires carry
      them across; the sink reassembles them into the number. It shows how a word
      is just a bundle of single-trit wires — edit the input value in its
      inspector and the output number tracks it. (The <b>Buses</b> examples show
      how to squeeze those six wires onto one.)</p>`,
  },

  // ---- Buses ---------------------------------------------------------------
  'tristate-bus': {
    name: 'Tri-state bus',
    tagline: 'Two drivers share one wire; TRIBUF gates decide who talks',
    body: `
      <p>A <b>bus</b> is one wire shared by several drivers. To avoid two drivers
      fighting, each goes through a <b>TRIBUF</b> (tri-state buffer): when its
      enable is on, it drives its value onto the bus; when off, it goes
      <em>high-impedance</em> (Z) and electrically lets go of the wire.</p>
      <pre class="info-diagram">
   srcA ─▶[TRIBUF]─┐
            ▲      ├──● bus ──▶ out
   enA ─────┘      │
   srcB ─▶[TRIBUF]─┘
            ▲
   enB ─────┘     enable exactly ONE buffer at a time
      </pre>
      <p>The wire shows the value of whichever buffer is enabled, or floating Z
      when none is. <b>Important rule:</b> never enable two buffers with different
      values at once — that is a bus conflict. This Z-when-disabled behaviour is
      what lets many registers share a few bus wires instead of a private wire
      each, which the register-file examples build on.</p>`,
  },
  'regfile-bus': {
    name: 'Tri-state register file',
    tagline: 'Several registers, one shared read bus, one-hot select',
    body: `
      <p>A small <b>register file</b>: a few stored values, each behind a
      <b>TRIBUF</b>, all sharing one read bus. A one-hot select turns on exactly
      one buffer, so its register's value appears on the bus and the others stay
      out of the way (Z).</p>
      <pre class="info-diagram">
   reg0 ─▶[TRIBUF]─┐
   sel0 ──┘        │
   reg1 ─▶[TRIBUF]─┼──● read bus ──▶ out
   sel1 ──┘        │
   reg2 ─▶[TRIBUF]─┘
   sel2 ──┘        (drive sel as one-hot: one +1, rest off)
      </pre>
      <p>This is how a CPU reads "register N" onto a shared datapath without a
      giant multiplexer — the selected register simply drives the bus. Flip the
      select lines and watch the bus value jump to the chosen register. The whole
      C1 bus subsystem generalises this to multi-trit words.</p>`,
  },
  'word-bus': {
    name: 'Word bus (MERGE3 / SPLIT3)',
    tagline: 'Pack 3 trits onto one wire, carry it, then unpack',
    body: `
      <p>Instead of routing three separate trit wires everywhere, <b>MERGE3</b>
      packs a 3-trit word onto a single <em>bus wire</em>, and <b>SPLIT3</b>
      unpacks it back into three trits at the far end. One wire on the canvas
      instead of three — the diagram stays readable as words get wider.</p>
      <pre class="info-diagram">
   x0 ─▶┐                              ┌─▶ y0
   x1 ─▶┤ MERGE3 ├══ bus ══┤ SPLIT3 ├──┼─▶ y1
   x2 ─▶┘   (one violet wire carries   └─▶ y2
             all three trits)
      </pre>
      <p>The bus wire (drawn thicker / violet) carries the packed word as a single
      value; nothing is lost — <code>y0,y1,y2</code> come out equal to
      <code>x0,x1,x2</code>. This is purely a wiring convenience built on the
      simulator's existing word handling; no new engine behaviour. It is the
      foundation for the register-file-on-a-word-bus and the bus datapath.</p>`,
  },
  'regfile-wordbus': {
    name: 'Register file (word bus)',
    tagline: 'The register file, but reading whole words over one bus wire',
    body: `
      <p>The same idea as the tri-state register file, upgraded to <b>words</b>:
      each register's 3-trit value is merged onto a single bus wire and gated by a
      <b>TRIBUF3</b> (a word-wide tri-state buffer). One read bus wire replaces
      the six you would otherwise need for a two-register read port.</p>
      <pre class="info-diagram">
   regA ▶[MERGE3]▶[TRIBUF3]─┐
   selA ───────────┘        ├══ word bus ══▶[SPLIT3]─▶ out (3 trits)
   regB ▶[MERGE3]▶[TRIBUF3]─┘
   selB ───────────┘
      </pre>
      <p>Enable one register's TRIBUF3 and its whole word drives the bus; the
      other goes high-impedance. SPLIT3 at the consumer turns the bus back into
      three trits. Same one-hot discipline as before — exactly one driver on at a
      time — just word-wide.</p>`,
  },
  'tryte-bus': {
    name: 'Tryte bus (MERGE6 / SPLIT6)',
    tagline: 'A full 6-trit word on a single wire',
    body: `
      <p>The widest bus primitives: <b>MERGE6</b> packs six trits (a whole tryte)
      onto one wire and <b>SPLIT6</b> unpacks them. Where <code>tryte-io</code>
      needed six parallel wires between source and sink, here a single bus wire
      does the job.</p>
      <pre class="info-diagram">
   t0..t5 ─▶[ MERGE6 ]══════ tryte bus ══════[ SPLIT6 ]─▶ t0..t5
            (6 trits in)      one wire        (6 trits out)
      </pre>
      <p>Useful when moving whole words around a larger design — an entire tryte
      travels as one labelled wire, then fans back out to six trits exactly where
      it is consumed. Same lossless packing as MERGE3/SPLIT3, just twice as wide.</p>`,
  },
  'bus-datapath': {
    name: 'Bus datapath (accumulator loop)',
    tagline: 'A register + ALU feedback loop wired entirely on word buses',
    body: `
      <p>A complete little datapath built <em>on the word bus</em>: an
      accumulator register feeds an ALU, the ALU's result goes back to the
      accumulator, and the whole loop is carried on merged word wires instead of
      bundles of single trits.</p>
      <pre class="info-diagram">
        ┌───────────────── word bus ◀──────────────┐
        ▼                                           │
   ┌────────┐   ▶[MERGE3]══bus══▶[SPLIT3]▶┌─────┐   │
   │  ACC   │── a ───────────────────────▶│ ALU │── r ──[MERGE3]══┘
   │ (REG3) │                       b ───▶│     │
   └───▲────┘                             └─────┘
       │ clk           (each rising edge: ACC ← ALU(ACC, …))
      </pre>
      <p>On every clock edge the accumulator latches the ALU's output, so the
      value evolves step by step — the same shape as a CPU's "ACC ← ACC op
      operand" inner loop, but shown with the data travelling as words on buses.
      Open the <b>Wave</b> panel to watch the accumulator climb. It is the bridge
      between the plumbing examples (buses) and the full CPUs.</p>`,
  },

  // ---- CPU -----------------------------------------------------------------
  'cpu': {
    name: 'CPU — single-cycle processor',
    tagline: 'The whole datapath: PC → IMEM → decode → ALU → ACC, one op per clock',
    body: `
      <p>A complete (tiny) stored-program computer. Every rising clock edge runs
      one instruction end to end: fetch it, decode it, compute, and write the
      result back — all in a single cycle.</p>
      <pre class="info-diagram">
   ┌────┐  addr  ┌──────┐  word  ┌────────┐
   │ PC │───────▶│ IMEM │───────▶│ decode │
   └─▲──┘        └──────┘        └───┬────┘
     │ jmp/target      operand       │ accWrite / jmp
     │   ▲                ▼          │
     │   │             ┌─────┐       │
     │   └─────────────│ ALU │◀── ACC value
     │                 └──┬──┘
     │           result   ▼
     └──────────────────┌─────┐
                        │ ACC │ (REG3)
                        └─────┘
      </pre>
      <p>The instruction word is <code>[operand-low, operand-high, opcode]</code>.
      The opcode trit chooses the operation:
      <code>0 = ADDI</code> (ACC += operand), <code>+1 = MAXI</code>,
      <code>T = JMP</code>. The "decoder" is just two inverters off the opcode
      trit: an NTI drives the PC's <code>jmp</code> (so only <code>T</code>/JMP
      jumps), and an STI after it forms the ACC write-enable.</p>
      <p>The pre-loaded program is a two-instruction loop:</p>
      <table class="info-tt">
        <thead><tr><th>word</th><th>instruction</th><th>effect</th></tr></thead>
        <tbody>
          <tr><td>0</td><td>ADDI +1</td><td>ACC ← ACC + 1</td></tr>
          <tr><td>1</td><td>JMP 0</td><td>jump back to word 0</td></tr>
        </tbody>
      </table>
      <p>So it counts: press <b>Play</b> and the ACC face climbs 1, 2, 3, … while
      the PC bounces 0, 1, 0, 1. The clock is <code>bi</code>, so one instruction
      takes 2 steps. This is the machine the assembler targets — open
      <b>Assemble &amp; Load</b> to write your own program into IMEM.</p>`,
  },
  'cpu-structural': {
    name: 'CPU (structural)',
    tagline: 'The same CPU, but PC/ALU/ACC rebuilt from gates — no native blocks',
    body: `
      <p>Identical behaviour to the basic <b>CPU</b>, but every block on the
      <em>compute path</em> is replaced by its gate-level structural twin from the
      kits: <code>TPC</code> for the program counter, <code>ALU3</code> for the
      ALU, <code>TREG3</code> for the accumulator. Double-click any of them to
      drill all the way down — they bottom out at MIN / MAX / STI / PTI / NTI
      with no native sequential or arithmetic primitive inside.</p>
      <pre class="info-diagram">
   TPC ──▶ IMEM ──▶ (NTI,STI decode) ──▶ ALU3 ──▶ TREG3
   │                                              │
   └── TPC = TFLOP → TLATCH → MIN/MAX feedback     └ TREG3 = latches
       ALU3 = FADD → TSUM → MUX3 → native gates
      </pre>
      <p>Two wrinkles to know about:</p>
      <ul>
        <li><b>Starts at word 4.</b> TPC's internal flip-flops wake at address
        <code>(0,0)</code>, which is word index 4 — not word 0 like the native
        PC. So the demo program lives at words 4–5 (<code>ADDI +1</code> /
        <code>JMP 4</code>). It does <em>not</em> interoperate with Assemble &amp;
        Load (which writes at word 0) — use the plain CPU for that.</li>
        <li><b>Clamped load-enable.</b> TREG3 reads <code>ld = T</code> as
        <em>clear</em>, so the decoder's raw output would wrongly wipe the ACC on
        every JMP. One extra MAX-with-0 gate clamps the enable to {0,+1} so JMP
        cycles just hold.</li>
      </ul>
      <p>Press <b>Play</b>: the ACC climbs by 1 each cycle, exactly like the
      native CPU — proof that the whole processor can be expressed in three
      fundamental gates.</p>`,
  },
  'cpu2': {
    name: 'CPU2 — 9-op ISA',
    tagline: 'A wider processor: 9 opcodes, two-trit decode, data memory, branches',
    body: `
      <p>The grown-up processor. The instruction set widens to <b>9 operations</b>
      decoded from a 2-trit opcode, and the machine gains a <b>data memory</b> and
      <b>conditional branches</b>. (Full spec: <code>ISA_v2.md</code>.)</p>
      <table class="info-tt">
        <thead><tr><th colspan="3">v2 opcodes (opH, opL)</th></tr></thead>
        <tbody>
          <tr><td>NOP</td><td>ADDI</td><td>MAXI</td></tr>
          <tr><td>MINI</td><td>JMP</td><td>JMPP (if ACC&gt;0)</td></tr>
          <tr><td>JMPZ (if ACC=0)</td><td>LOAD</td><td>STORE</td></tr>
        </tbody>
      </table>
      <p>Each instruction is now <b>6 trits</b>, stored across two parallel RAM
      banks that share the PC's address (so one "word" = imem_lo + imem_hi):</p>
      <pre class="info-diagram">
        ┌────┐  ┌─ imem_lo ─┐  opL,opH  ┌─────────┐
        │ PC │─▶│  imem_hi  │──────────▶│ DECODE2 │ (9 enables)
        └─▲──┘  └─────┬─────┘           └────┬────┘
          │       operand        ┌──────┐    │ en_*  selects:
          │          ▼           │ ALU  │◀─ ACC   · aluOp (MIN/ADD/MAX)
          │  ┌──────────────┐    └──┬───┘    · accWrite enable
   jmpEn ─┴──│ branch logic │    r/ ▼  load   · ACC source MUX
             │ JMP/JMPP/JMPZ│   ┌───────┐◀─ DMEM read
             └──────▲───────┘   │  ACC  │
                ACC sign        └───┬───┘
                                STORE ▼  → DMEM[operand]
      </pre>
      <p>Highlights of the wiring:</p>
      <ul>
        <li><b>DECODE2</b> turns the 2-trit opcode into 9 one-hot enable lines
        (the two-trit version of the three-way branch).</li>
        <li>The ALU mode is picked by a single <code>TSUM</code> gate combining
        the MAXI/MINI enables, so ADDI→ADD, MAXI→MAX, MINI→MIN.</li>
        <li><b>LOAD/STORE</b> use a second RAM (<code>dmem</code>); a per-trit MUX
        chooses whether ACC loads the ALU result or a DMEM read.</li>
        <li><b>ACC_SIGN</b> computes "is ACC zero / positive", and a little
        MIN/MAX tree turns that into the jump-enable for JMPP/JMPZ — the
        conditional branches.</li>
      </ul>
      <p>The default program is the same counter as the basic CPU (semantically
      identical), so Play makes the ACC climb — but now you can assemble any of
      the 9 ops. CPU2 is the machine the <b>microcode</b> examples set out to
      rebuild as a <em>soft</em>, multi-cycle control unit.</p>`,
  },

  // ---- Microcode -----------------------------------------------------------
  'microcode-seq': {
    name: 'Microcode sequencer (Phase 1)',
    tagline: 'A µPC walks a control store on its own — the heart of microcode',
    body: `
      <p>First step toward a <em>microcoded</em> CPU (see <code>MICROCODE.md</code>).
      Where CPU2 decodes each opcode in one combinational shot, a microcoded
      machine runs a tiny program — a <b>control store</b> of control words —
      walked by a <b>micro-PC (µPC)</b>. This example shows just the walking.</p>
      <pre class="info-diagram">
   ┌─────┐ µaddr ┌────────────┐  q0 = seqMode  ┌──────┐
   │ µPC │──────▶│ control     │───────────────▶│ MSEQ │
   │(PC) │       │ store (RAM) │  q1,q2 = ctrl  └──┬───┘
   └──▲──┘       └────────────┘                    │ jmp/j0/j1
      └─────────────────────────────────────────────┘
      </pre>
      <p>Each control word's first trit is a <b>seqMode</b> field that tells the
      <b>MSEQ</b> microsequencer where the µPC goes next:</p>
      <table class="info-tt">
        <thead><tr><th>seqMode</th><th>mode</th><th>µPC next</th></tr></thead>
        <tbody>
          <tr><td class="trit-0">0</td><td>CONT</td><td>µPC + 1</td></tr>
          <tr><td class="trit-P">+1</td><td>DISP</td><td>a dispatch address</td></tr>
          <tr><td class="trit-T">T</td><td>FETCH</td><td>µword 0</td></tr>
        </tbody>
      </table>
      <p>The microprogram here is <code>CONT, CONT, CONT, FETCH</code>, so the µPC
      walks 0 → 1 → 2 → 3 and the FETCH word sends it back to 0 — a loop that
      cycles on its own. The other two trits (<code>ctrlA</code>,
      <code>ctrlB</code>) are demo control bits that pulse through a fixed pattern
      each lap. MSEQ itself is just three MUXes keyed on seqMode — the routing
      <em>is</em> the decode, no detector gates. Press <b>Play</b> and watch
      <code>uPC0/uPC1</code> cycle.</p>`,
  },
  'microcode-fields': {
    name: 'Microcode control store (Phase 2)',
    tagline: 'One horizontal control word → many named control lines',
    body: `
      <p>Phase 2 fills in <em>what the control words say</em>. Each microinstruction
      is now a <b>horizontal control word</b> — one field per datapath control
      line — stored as 6 trits across two parallel RAM banks. The <b>UFIELDS</b>
      decoder taps those trits and exposes them under their real names.</p>
      <pre class="info-diagram">
   romLo ─ q0,q1,q2 ─┐
                     ├─▶ UFIELDS ─▶ seqMode, aluOp, accWrite,
   romHi ─ q0,q1,q2 ─┘              accSrc, memWrite, memRead, pcCtl
      </pre>
      <p>µword layout: <code>romLo = [m_seq, m_alu, m_accW]</code>,
      <code>romHi = [m_accSrc, m_mem, m_pc]</code>. Most fields pass straight
      through (in horizontal microcode the field <em>is</em> the control line).
      The one packed field is <code>m_mem</code> — a 1-of-3 memory control
      (T = none / 0 = read / +1 = write) that UFIELDS decodes into two separate
      <code>memWrite</code> / <code>memRead</code> enables.</p>
      <p>As the µPC walks the 4-word microprogram, the named control lines change
      each step. Watch <code>aluOp</code>, <code>accWrite</code>,
      <code>memWrite</code>, <code>memRead</code> on the outputs (and the
      <code>memWrite</code> WAVE pulse on step µ1). There is no datapath yet — the
      control unit is "running dry," producing the right control pattern ahead of
      Phase 4 wiring it to a real ALU and memory.</p>`,
  },
  'microcode-dispatch': {
    name: 'Microcode dispatch (Phase 3)',
    tagline: 'Macro-op → microroutine, run multi-cycle, then fetch the next',
    body: `
      <p>Phase 3 closes the loop. A real CPU instruction (a "macro-op") now
      <b>dispatches</b> to a small <em>microroutine</em> that runs over several
      clocks before fetching the next instruction. This is what makes a
      microcoded machine multi-cycle and its control unit <em>soft</em>.</p>
      <pre class="info-diagram">
   ┌──────┐ addr ┌──────┐ opcode ┌──────────────┐ entry µaddr
   │macroPC│────▶│ IMEM │───────▶│ dispatch ROM │──────────┐
   └──▲───┘      └──────┘        └──────────────┘          ▼
      │ hold/advance                              ┌──────────────┐
      │                                            │     MSEQ     │
      │            ┌─────┐  seqMode  ┌─────────┐   │ (disp/cont/  │
      └── pcCtl ◀──│UFIELD│◀─────────│ control │   │   fetch)     │
                   └─────┘           │  store  │   └──────┬───────┘
                                     └────▲────┘          │ jmp/j*
                                          │   ┌─────┐     │
                                          └───│ µPC │◀────┘
                                              └─────┘
      </pre>
      <p><b>The dispatch map</b> is a 9-word mapping ROM addressed by the opcode
      itself (<code>a0 = opL</code>, <code>a1 = opH</code> → one slot per v2
      opcode); each slot holds that opcode's microroutine entry address. That
      entry feeds <code>MSEQ.disp</code>.</p>
      <p><b>The loop:</b> µword µ0 is the shared <em>fetch/dispatch</em> step —
      its <code>seqMode = DISP</code> sends the µPC to the routine, and its
      <code>pcCtl = ADV</code> bumps the macro-PC. The routine's µwords set
      <code>pcCtl = HOLD</code> so the macro-PC freezes mid-instruction, and the
      last µword's <code>seqMode = FETCH</code> returns to µ0. (The PC has no
      native "hold", so HOLD is done by reloading the PC with its own address.)</p>
      <p>The demo runs a two-op micro-ISA — <b>ADDI</b> (a 1-µword routine) and
      <b>LOAD</b> (2 µwords) — over the program <code>ADDI, LOAD, ADDI, LOAD, …</code>.
      Step it and watch the two counters: the µPC dives into each routine and
      FETCHes back, while the macro-PC advances exactly once per instruction:</p>
      <table class="info-tt">
        <thead><tr><th>edge</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th></tr></thead>
        <tbody>
          <tr><td>µPC</td><td>µ1</td><td>µ0</td><td>µ2</td><td>µ3</td><td>µ0</td><td>µ1</td><td>µ0</td></tr>
          <tr><td>macroPC</td><td>1</td><td>1</td><td>2</td><td>2</td><td>2</td><td>3</td><td>3</td></tr>
          <tr><td>op</td><td colspan="2">ADDI (1 cycle)</td><td colspan="3">LOAD (2 cycles)</td><td colspan="2">ADDI…</td></tr>
        </tbody>
      </table>
      <p>(With the <code>bi</code> clock each value is held for 2 steps.) No
      datapath is wired yet — this proves the <em>control flow</em> is multi-cycle.
      Phase 4 will attach the real ACC/ALU/DMEM so the routines actually compute.</p>`,
  },
  'cpu3': {
    name: 'CPU3 — microcoded processor (Phase 4)',
    tagline: 'The microengine drives a real ACC/ALU/DMEM datapath — runs CPU2’s counter',
    body: `
      <p>The payoff of the microcode track: a working processor whose control
      unit is <em>soft</em>. CPU3 has the <b>same datapath and same v2
      instruction words as CPU2</b> — ACC, ALU, data memory, the two-bank IMEM —
      but CPU2's one-shot <code>DECODE2</code> is replaced by the microengine
      from Phases 1–3. Each instruction now runs a multi-cycle microroutine.</p>
      <pre class="info-diagram">
   macro side                       micro side (the soft control unit)
   ──────────                       ──────────────────────────────────
   mPC ─▶ IMEM ─▶ opcode ─▶ dispatch ROM ─ entry µaddr ─▶ MSEQ ─▶ µPC
    ▲       │                                              ▲       │
    │       └─ operand ─▶ ALU.b / DMEM.addr / jump tgt     │  control store
    │                                                       └── UFIELDS ◀┘
    │   ┌──────┐ aluOp   ┌─────┐ accSrc  ┌─────┐                 │ fields
    └─ MPCSEQ ◀┤ pcCtl   │ ALU │─▶ MUX ─▶│ ACC │   memWrite ─▶ DMEM
        ▲      └─────────┴──┬──┘  ▲      └─────┘
        └ p0,p1 (self)      │     └─ DMEM read (LOAD)
                         accWrite
      </pre>
      <p>Every control line the datapath needs comes out of <b>UFIELDS</b>
      reading the current microinstruction: <code>aluOp</code> → ALU mode,
      <code>accWrite</code> → ACC load-enable, <code>accSrc</code> → the
      ALU-vs-DMEM MUX, <code>memWrite</code> → DMEM write, and <code>pcCtl</code>
      → the new <b>MPCSEQ</b> macro-PC sequencer (advance / hold / jump).</p>

      <h4>How an instruction executes</h4>
      <ol>
        <li><b>µ0 — dispatch.</b> The opcode indexes the dispatch ROM; MSEQ jumps
        the µPC to that op's routine. <code>pcCtl = HOLD</code> keeps the macro-PC
        parked on this instruction so its operand stays valid all through the
        routine.</li>
        <li><b>routine.</b> The op's µword(s) drive the datapath — e.g. ADDI sets
        <code>aluOp = ADD</code>, <code>accWrite = +1</code>, so ACC ← ACC +
        operand. The final µword also sets <code>pcCtl = ADV</code> (next
        instruction) or <code>JMP</code> (load the operand as target), and
        <code>seqMode = FETCH</code> to send the µPC back to µ0.</li>
      </ol>
      <p>The microprogram fits the 9-word store exactly: µ0 dispatch + one-µword
      routines for <b>NOP, ADDI, MAXI, MINI, JMP, LOAD, STORE</b> + a spare.
      (The two conditional jumps JMPP/JMPZ are deferred — they need a conditional
      sequencer and the µword budget is full; see <code>MICROCODE.md</code>.)</p>

      <h4>What to watch</h4>
      <p>The default program is CPU2's counter — <code>ADDI +1</code> /
      <code>JMP 0</code>. Press <b>Play</b>: <code>ACC0/1/2</code> climbs
      0, 1, 2, 3, … exactly like CPU2, but each instruction now takes <b>two
      clocks</b> (dispatch, then execute), so it counts at half the wall-clock
      rate. That slowdown <em>is</em> microcode — the control unit is a little
      program now, not a slab of gates.</p>`,
  },

  // ---- Neural net ----------------------------------------------------------
  'ternary-mac': {
    name: 'Ternary-weight MAC',
    tagline: 'A dot product with weights in {T,0,+1} — and no multiplier at all',
    body: `
      <p>The single operation a neural network spends almost all its time on: a
      <b>multiply-accumulate</b> (dot product) <code>y = Σ wᵢ·xᵢ</code>. The trick
      here — the BitNet b1.58 idea — is to quantise the weights to just three
      values, which makes every "multiply" disappear:</p>
      <pre class="info-diagram">
   wᵢ = +1  → pass  xᵢ
   wᵢ =  0  → 0
   wᵢ =  T  → negate xᵢ
      </pre>
      <p>So each product is one <b>STI</b> (to have <code>−xᵢ</code> ready) feeding
      one <b>MUX</b> whose select is the weight trit — pass / zero / negate. No
      multiplier hardware exists anywhere. The three products are then summed by a
      small ADDER tree.</p>
      <pre class="info-diagram">
   x0 ─┬─[STI]─▶dT┐
       └────────▶dP│MUX0├─ p0 ─▶┐
   w0 ──────────▶s ┘            ├─[ADDER]─┐
   x1 …            (same)─ p1 ─▶┘         ├─[ADDER]─▶ y (2 trits)
   x2 …            (same)─ p2 ──────────▶┘
      </pre>
      <p>Defaults: <code>x = (+1, +1, T)</code>, <code>w = (+1, 0, T)</code> →
      products <code>(+1, 0, +1)</code> → <code>y = 2</code> — which exercises all
      three multiply modes at once (pass, zero, negate). It is combinational:
      change any weight or activation trit and the result updates immediately.</p>`,
  },
  'ternary-layer': {
    name: 'Ternary neural-net layer',
    tagline: 'A matrix × vector — several MAC units sharing one input vector',
    body: `
      <p>One layer of a neural network is a <b>matrix–vector product</b>: each
      output neuron is its own dot product of the shared input vector with that
      neuron's row of weights. So a layer is just several <b>ternary MAC</b> units
      side by side, all reading the same inputs.</p>
      <pre class="info-diagram">
                ┌─ MAC(row0 weights) ─▶ y0
   x (vector) ──┼─ MAC(row1 weights) ─▶ y1
                └─ MAC(row2 weights) ─▶ y2
      </pre>
      <p>Each MAC is the same STI+MUX "multiply" and ADDER-tree "accumulate" as
      the single-MAC example, just replicated per output. The input vector fans
      out to every row; each row has its own ternary weights. Edit any weight and
      watch only that output respond. Stack two of these with a non-linearity in
      between and you have a complete network — the <b>ternary MLP</b>.</p>`,
  },
  'ternary-mlp': {
    name: 'Ternary MLP',
    tagline: 'Two ternary layers with an activation between them',
    body: `
      <p>A full (if tiny) multi-layer perceptron: an input vector goes through a
      first ternary <b>layer</b>, then a per-neuron <b>activation</b> (ACT), then a
      second layer to the outputs. This is the canonical "deep" network shape,
      built entirely from ternary gates.</p>
      <pre class="info-diagram">
   x ─▶[ layer 1 ]─▶ h ─▶[ ACT ]─▶ a ─▶[ layer 2 ]─▶ y
        (MAC rows)         │              (MAC rows)
                    non-linearity squashes
                    each hidden value
      </pre>
      <p>Without the activation, two linear layers would collapse into one — the
      <b>ACT</b> block in the middle is what gives the network its expressive
      power, the same role ReLU/tanh play in a binary network. Every multiply is
      still weightless (STI + MUX), every sum is an ADDER tree, and the activation
      is itself a small ternary function. Change an input or a weight and the
      signal propagates through both layers to the outputs. It ties the whole
      neural-net kit together: MAC → layer → MLP.</p>`,
  },
};
