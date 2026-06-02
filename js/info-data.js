// ============================================================================
//  COMPONENT REFERENCE DATA (Info button)
// ============================================================================
//
//  Pure-data tables for the in-app encyclopedia. Rendering and DOM wiring live
//  in app.js (infoPinsTable, openInfoModal, etc.). These exports are mutable
//  module bindings only because two entries (gates with truth tables) are
//  referenced by name from the renderer — the data itself is not modified at
//  runtime.

// Gate-like types whose behaviour is a pure function of their inputs — for
// these we render a truth table generated live from the simulator's own
// eval(), so the docs can never drift from real behaviour.
export const INFO_GATE_TYPES = ['STI', 'PTI', 'NTI', 'MIN', 'MAX', 'ADDER'];

// Order of the left-hand list.  Each key is either a real TYPES name or one
// of the synthetic keys (_intro, SUBCIRCUIT, CUSTOMGATE).
export const INFO_CATEGORIES = [
  ['Start here', ['_intro']],
  ['Sources',    ['INPUT', 'CONST', 'TRYTE_IN', 'CLOCK']],
  ['Sinks',      ['OUTPUT', 'TRYTE_OUT', 'WAVE']],
  ['Inverters',  ['STI', 'PTI', 'NTI']],
  ['Gates',      ['MIN', 'MAX', 'ADDER', 'MUX', 'TRIBUF']],
  ['Buses',      ['MERGE3', 'SPLIT3', 'TRIBUF3', 'MERGE6', 'SPLIT6']],
  ['Sequential', ['DFF', 'REG3', 'RAM']],
  ['CPU',        ['ALU', 'PC']],
  ['Composite',  ['SUBCIRCUIT', 'CUSTOMGATE']],
  ['Neural-net kit', ['SUB:TMUL', 'SUB:MAC3', 'SUB:ACT']],
  ['Arithmetic kit', ['SUB:TSUM', 'SUB:TCARRY', 'SUB:FADD', 'SUB:ALU3', 'SUB:MUX3']],
  ['Sequential kit', ['SUB:TLATCH', 'SUB:TFLOP', 'SUB:TREG3', 'SUB:TPC', 'SUB:TRAM']],
  ['Control kit',    ['SUB:DECODE2', 'SUB:ACC_SIGN']],
  ['Microcode kit',  ['SUB:MSEQ']],
  ['ISA',            ['_asm', '_isa2', '_debugger']],
];

export const COMPONENT_INFO = {
  _intro: {
    name: 'Getting started',
    tagline: 'Ternary basics and how the simulator runs',
    body: `
      <p>This is the in-app reference for every built-in TritLogic component.
      Pick an entry on the left to read how it works. If you select a
      component on the canvas <em>before</em> pressing <b>Info</b>, this
      window opens straight to that component's page.</p>
      <h4>Balanced ternary in 30 seconds</h4>
      <p>Every wire carries one <em>trit</em> instead of a bit. A trit has
      three values:</p>
      <ul>
        <li><code>T</code> = −1 — drawn red</li>
        <li><code>0</code> = 0 — drawn grey</li>
        <li><code>1</code> = +1 — drawn green</li>
      </ul>
      <p>A fourth value, <code>null</code> (dark grey), means the pin is
      <em>floating</em> — undriven. null flows through logic the way you would
      expect: most gates emit null if any input is null.</p>
      <h4>How the simulator runs</h4>
      <p>Combinational logic is solved by <b>fixed-point iteration</b>: every
      component is re-evaluated over and over until no wire value changes (or
      300 passes elapse, which flags an oscillation).</p>
      <p>Clocked parts use a <b>four-phase Step</b>: tick the clocks → settle
      the logic → latch the flip-flops on the rising edge → settle again. That
      ordering is why a flip-flop sees the new clock level before it decides
      whether to latch.</p>
      <h4>Reading a component page</h4>
      <p>Each page lists the component's <b>pins</b> (read live from the
      simulator), its <b>working mechanism</b>, any internal <b>state</b> it
      keeps, and — for gates — a <b>truth table generated live</b> by running
      the simulator's evaluation function.</p>`,
  },

  _debugger: {
    name: 'CPU debugger',
    tagline: 'Step the Phase 7 CPU, set breakpoints, watch ACC/PC live',
    body: `
      <p>The <b>Debug</b> toolbar button opens a floating panel that single-
      steps the CPU example. It reads the live <b>PC</b> and <b>ACC</b>
      registers and the <b>IMEM</b> contents straight from the canvas — so
      it is always in sync with whatever Step / Play has done.</p>
      <h4>What it shows</h4>
      <ul>
        <li><b>PC / ACC</b> as both signed integers and trit triples.</li>
        <li><b>Source listing</b> of the program you last assembled
            (<b>Assemble &amp; Load into IMEM</b>); the line currently being
            executed is highlighted.</li>
        <li><b>IMEM dump</b> of all 9 words, each decoded back to its
            mnemonic (<code>ADDI</code> / <code>MAXI</code> / <code>JMP</code>);
            the current word is highlighted.</li>
      </ul>
      <h4>Controls</h4>
      <ul>
        <li><b>Step</b> — one <code>stepSequential()</code> call, i.e. half
            a clock period. The PC only advances on the rising edge, so
            you may need two Steps to see it move.</li>
        <li><b>Step Cycle</b> — two steps, a full rising+falling clock
            period. One assembly instruction per Step Cycle.</li>
        <li><b>Run</b> — auto-steps at ~12 Hz until either (a) PC lands on a
            breakpoint, (b) the max-steps budget is exhausted, or (c) you
            click <b>Pause</b>.</li>
        <li><b>Reset PC</b> — zeroes PC and ACC without touching IMEM.</li>
      </ul>
      <h4>Breakpoints</h4>
      <p>Click the small ● next to any source line or any IMEM word to set
      a breakpoint on that address (0..8). Click again to clear. Run halts
      <em>after</em> the step whose post-state has PC pointing at the
      breakpoint address — so the highlighted line is the one about to
      execute next.</p>
      <h4>Limits</h4>
      <p>The debugger only attaches when the canvas contains the CPU
      shape: one <code>PC</code>, one <code>RAM</code> addressed by that
      PC, and ideally a <code>REG3</code> driven by the <code>ALU</code>
      output (the ACC). For other circuits the panel still opens but
      shows "no CPU on canvas".</p>`,
  },

  _isa2: {
    name: 'ISA v2 (CPU2)',
    tagline: 'Wider 2-trit opcode, 9 ops, parallel-RAM IMEM',
    body: `
      <p>The original CPU (Phase 7) ships a 1-opcode-trit ISA with three
      ops (ADDI / MAXI / JMP). v2 widens the opcode to <b>2 trits</b>
      (9 codepoints) and the instruction word to <b>6 trits</b>, packed
      across two parallel 3-trit RAM blocks that share the PC's address
      pins. Both CPUs ship as separate presets; pick <code>CPU2</code>
      from the Examples menu to load the wider one. Full design spec is
      in <code>tritlogic/ISA_v2.md</code>.</p>
      <h4>Word layout (6 trits / instruction)</h4>
      <table class="info-tt" style="text-align:left">
        <thead><tr><th>Bank</th><th>q0</th><th>q1</th><th>q2</th></tr></thead>
        <tbody>
          <tr><td><code>imem_lo</code></td><td>opL</td><td>opH</td><td>oper0</td></tr>
          <tr><td><code>imem_hi</code></td><td>oper1</td><td>oper2</td><td>oper3</td></tr>
        </tbody>
      </table>
      <h4>9-op codepoint table</h4>
      <table class="info-tt" style="text-align:left">
        <thead><tr><th>Mnemonic</th><th>opH opL</th><th>Operand</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td><code>NOP</code></td><td class="trit-T">T</td>
              <td class="trit-T">T</td><td>(ignored)</td><td>Phase A ✓</td></tr>
          <tr><td><code>JMP &lt;addr&gt;</code></td><td class="trit-T">T</td>
              <td class="trit-0">0</td><td>0..8</td><td>Phase A ✓</td></tr>
          <tr><td><code>JMPP &lt;addr&gt;</code></td><td class="trit-T">T</td>
              <td class="trit-P">+</td><td>if ACC&nbsp;&gt;&nbsp;0</td><td>Phase B ✓</td></tr>
          <tr><td><code>JMPZ &lt;addr&gt;</code></td><td class="trit-0">0</td>
              <td class="trit-T">T</td><td>if ACC&nbsp;==&nbsp;0</td><td>Phase B ✓</td></tr>
          <tr><td><code>ADDI &lt;n&gt;</code></td><td class="trit-0">0</td>
              <td class="trit-0">0</td><td>signed −40..+40</td><td>Phase A ✓</td></tr>
          <tr><td><code>MAXI &lt;n&gt;</code></td><td class="trit-0">0</td>
              <td class="trit-P">+</td><td>signed</td><td>Phase A ✓</td></tr>
          <tr><td><code>MINI &lt;n&gt;</code></td><td class="trit-P">+</td>
              <td class="trit-T">T</td><td>signed</td><td>Phase A ✓</td></tr>
          <tr><td><code>LOAD &lt;addr&gt;</code></td><td class="trit-P">+</td>
              <td class="trit-0">0</td><td>DMEM 0..8 → ACC</td><td>Phase C ✓</td></tr>
          <tr><td><code>STORE &lt;addr&gt;</code></td><td class="trit-P">+</td>
              <td class="trit-P">+</td><td>ACC → DMEM 0..8</td><td>Phase C ✓</td></tr>
        </tbody>
      </table>
      <p style="color: var(--muted); font-size: 11px;">All 9 v2 ops now have
      full datapath in CPU2: DECODE2 emits the one-hot enables, ACC_SIGN
      gates the conditional jumps, and a second 9×3-trit RAM (<code>dmem</code>)
      addressed by the operand's low 2 trits backs LOAD/STORE. An
      <code>en_LOAD</code>-selected per-trit MUX picks DMEM read vs ALU
      result for ACC's data input.</p>
      <h4>The DECODE2 subcircuit</h4>
      <p>Inside the new Control Kit. Takes <code>opL</code> + <code>opH</code>
      and emits 9 enable outputs — one for each codepoint — in the
      <code>{0, +1}</code> convention (active-high, 0-inactive). The
      <code>{0, +1}</code> choice lets the CPU2 datapath compute the ALU op
      selector as a single TSUM gate:
      <code>aluOpSel = TSUM(en_MAXI, NEG(en_MINI))</code> — which gives 0
      for ADDI, +1 for MAXI, and −1 for MINI.</p>
      <p>Per opcode trit, three trit-equality detectors are built from the
      native inverters PTI (+1 unless input is +1) and NTI (+1 only when
      input is −1):</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
isP(x) = MAX(STI(MAX(PTI(x), NTI(x))), 0)   ; +1 iff x = +1
isT(x) = MAX(NTI(x), 0)                     ; +1 iff x = −1
is0(x) = MAX(MIN(PTI(x), STI(NTI(x))), 0)   ; +1 iff x =  0</pre>
      <p>Each enable is then <code>MIN(is_H, is_L)</code> for that
      opcode's target pair.</p>
      <h4>Running v2 programs</h4>
      <p>Open the <b>Assemble</b> button as usual. The modal auto-detects
      which CPU is on the canvas — load <code>CPU2</code> from the Examples
      menu first and the assembler routes to <code>assembleV2()</code>
      automatically. The Examples dropdown inside the modal splits into
      "ISA v1 (CPU)" and "ISA v2 (CPU2)" groups; pick a v2 program to
      see the wider format.</p>`,
  },

  _asm: {
    name: 'Ternary assembler',
    tagline: 'Text → 9-word IMEM image for the Phase 7 CPU',
    body: `
      <p>Open the <b>Assemble</b> button in the toolbar to write a small
      program in the CPU's 3-op ISA, check it, and load the encoded image
      straight into the CPU example's <b>IMEM</b> (the RAM block whose
      address is driven by the PC). One source line per instruction; the
      RAM holds at most <b>nine</b> instructions.</p>

      <h4>The three mnemonics</h4>
      <table class="info-tt" style="text-align:left">
        <thead><tr><th>Mnemonic</th><th>Opcode trit</th><th>Operation</th><th>Operand</th></tr></thead>
        <tbody>
          <tr><td><code>ADDI &lt;n&gt;</code></td><td class="trit-0">0</td>
              <td><code>ACC = ACC + n</code></td>
              <td>signed integer <code>−4..+4</code></td></tr>
          <tr><td><code>MAXI &lt;n&gt;</code></td><td class="trit-P">+1</td>
              <td><code>ACC = max(ACC, n)</code></td>
              <td>signed integer <code>−4..+4</code></td></tr>
          <tr><td><code>JMP &nbsp;&lt;addr&gt;</code></td><td class="trit-T">T</td>
              <td><code>PC ← addr</code> on the next rising edge</td>
              <td>word index <code>0..8</code> or a label</td></tr>
        </tbody>
      </table>
      <p>The opcode trit is wired straight into the ALU's <code>op</code>
      pin (T = MIN, 0 = ADD, +1 = MAX), and into the decoder. For ADDI
      and MAXI the decoder leaves <code>accWrite = +1</code>, so the ALU
      result lands in ACC; for JMP it raises <code>pcSrc</code> instead.</p>

      <h4>Word layout</h4>
      <p>Each instruction is one RAM word — three trits <em>low-first</em>:</p>
      <p style="text-align:center"><code>[ operand_low, operand_high, opcode ]</code></p>
      <p>The operand's two trits are <code>intToTrits(n, 2)</code> for
      ADDI / MAXI immediates, and <code>intToTrits(addr − 4, 2)</code>
      for JMP — that's the encoding the PC uses for its stored address
      (so <code>JMP 0</code> is <code>[T, T, T]</code>).</p>

      <h4>Labels and comments</h4>
      <p>A bare <code>NAME:</code> at the start of a line names the next
      instruction's word index, and any JMP referring to it resolves to
      that index. Comments run from <code>;</code> to end of line.</p>
      <pre style="background: var(--panel-2); padding: 8px; border-radius: 4px; font-size: 11px; line-height: 1.4;">; Saturating counter — stops climbing at +3
LOOP:
  ADDI +1
  MAXI +3
  JMP  LOOP</pre>

      <h4>Errors</h4>
      <p>The check-only path is non-destructive — it just lists the
      problems with line numbers. Common ones: an immediate outside
      <code>−4..+4</code>, a JMP address outside <code>0..8</code>, an
      unresolved label, more than nine instructions total, or an unknown
      mnemonic. Fix and re-Assemble.</p>

      <h4>Round-trip with the built-in CPU example</h4>
      <p>The default <em>CPU</em> preset hand-encodes the
      "<code>ADDI +1 / JMP 0</code>" program directly into RAM. That same
      program assembled here produces exactly the same word image, byte
      for byte — there's a self-test that confirms it.</p>`,
  },

  INPUT: {
    name: 'INPUT', tagline: 'Manual signal source',
    body: `
      <p>A manual signal source — the trit you set by hand. INPUT is how you
      feed stimulus into a circuit.</p>
      <h4>Working mechanism</h4>
      <p>INPUT stores a single trit. Its one output pin emits that stored
      value on every simulation pass; it has no inputs and never changes on
      its own.</p>
      <p>With the <b>Select</b> tool active, <b>clicking the component on the
      canvas</b> cycles the stored value <code>T → 0 → +1 → T</code>. You can
      also set it precisely in the inspector.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>value</code> — the stored trit (−1, 0, or +1).</li>
        <li><code>name</code> — an optional label. When you <b>Pack</b> a
        selection into a subcircuit, each INPUT becomes an input pin of the
        block and this name becomes the pin name.</li>
      </ul>
      <h4>Tips</h4>
      <p>Use INPUT for signals you want to poke during simulation; use CONST
      for values that should never change.</p>`,
  },

  CONST: {
    name: 'CONST', tagline: 'Fixed signal source',
    body: `
      <p>A fixed signal source. Like INPUT, but its value is not meant to
      change while you experiment.</p>
      <h4>Working mechanism</h4>
      <p>CONST emits one constant trit from its single output pin. It defaults
      to <code>+1</code>. Unlike INPUT it does not cycle when clicked on the
      canvas — set the value in the inspector.</p>
      <h4>Internal state</h4>
      <ul><li><code>value</code> — the constant trit.</li></ul>
      <h4>Tips</h4>
      <p>Handy for tying a gate input to a known level — for example a
      permanent carry-in of <code>0</code> on the least-significant ADDER of a
      ripple chain.</p>`,
  },

  TRYTE_IN: {
    name: 'TRYTE_IN', tagline: '6-trit word source',
    body: `
      <p>A whole ternary word as a source. A <em>tryte</em> is the ternary
      cousin of a byte; here it is six trits wide.</p>
      <h4>Working mechanism</h4>
      <p>TRYTE_IN holds one signed integer and breaks it into six trits across
      six output pins, <code>t0</code> through <code>t5</code>.
      <code>t0</code> is the <b>least-significant</b> trit.</p>
      <p>Six balanced-ternary trits represent 3<sup>6</sup> = 729 distinct
      values, so the range is <b>−364 … +364</b>. Values outside that range
      are clamped.</p>
      <h4>Setting the value</h4>
      <p>The inspector has two fields. <b>Decimal value</b> takes a signed
      number. <b>Balanced ternary (MSB first)</b> takes a trit string using
      the digits <code>T</code>, <code>0</code> and <code>1</code> — and it
      is read strictly as trits: <code>000111</code> is the trit pattern
      worth <code>13</code>, not the decimal number 111. The two fields are
      independent — type a number in one or a trit string in the other.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>value</code> — the signed integer being represented.</li>
        <li><code>name</code> — optional label for subcircuit packing.</li>
      </ul>
      <h4>Tips</h4>
      <p>Wire <code>t0..t5</code> into a row of ADDERs for word-wide
      arithmetic; pair it with TRYTE_OUT to read the result back as a
      number.</p>`,
  },

  CLOCK: {
    name: 'CLOCK', tagline: 'Autonomous oscillator',
    body: `
      <p>An autonomous oscillator — the heartbeat that drives every sequential
      element.</p>
      <h4>Working mechanism</h4>
      <p>CLOCK emits a trit from its one output pin and advances that trit by
      one position <b>every time you press Step</b> (or on each tick of Play).
      It does <em>not</em> free-run inside the combinational solver — only the
      Step engine moves it.</p>
      <h4>Two cycle modes</h4>
      <ul>
        <li><b>tri</b> (default): <code>T → 0 → +1 → T → …</code> — visits all
        three ternary states; one full cycle every 3 ticks.</li>
        <li><b>bi</b>: <code>T ↔ +1</code> — skips the middle state for
        classic two-level edge timing; one full cycle every 2 ticks.</li>
      </ul>
      <p>In <em>both</em> modes there is exactly one rising transition into
      <code>+1</code> per cycle, so a DFF or REG3 on this clock latches once
      per cycle either way.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>value</code> — the current output trit.</li>
        <li><code>mode</code> — <code>'tri'</code> or <code>'bi'</code>.</li>
      </ul>
      <p><b>Reset</b> returns the clock to <code>T</code>.</p>`,
  },

  OUTPUT: {
    name: 'OUTPUT', tagline: 'Signal probe / display',
    body: `
      <p>A probe — a sink that displays whatever trit reaches it.</p>
      <h4>Working mechanism</h4>
      <p>OUTPUT has a single input pin and no output. The simulator does not
      evaluate it as logic; it simply shows the value on its input pin,
      colour-coded by trit, so you can read a circuit's result at a glance.</p>
      <h4>Internal state</h4>
      <ul><li><code>name</code> — optional label. When you <b>Pack</b> a
      selection, each OUTPUT becomes an <em>output pin</em> of the resulting
      subcircuit and this name becomes the pin name.</li></ul>
      <h4>Tips</h4>
      <p>OUTPUT shows the <em>settled</em> value. To watch a value evolve over
      clock ticks, use WAVE instead.</p>`,
  },

  TRYTE_OUT: {
    name: 'TRYTE_OUT', tagline: '6-trit word display',
    body: `
      <p>A whole-word display — the sink counterpart of TRYTE_IN.</p>
      <h4>Working mechanism</h4>
      <p>TRYTE_OUT has six input pins, <code>t0</code> (least-significant)
      through <code>t5</code>. It assembles those six trits back into a signed
      integer and shows it, so you can read word-wide arithmetic results as a
      number.</p>
      <h4>Tips</h4>
      <p>Feed it the <code>sum</code> outputs of a six-ADDER ripple chain to
      read the total. An undriven pin counts as <code>0</code> in the
      displayed value.</p>`,
  },

  WAVE: {
    name: 'WAVE', tagline: 'Waveform recorder',
    body: `
      <p>A waveform recorder — a probe with a memory.</p>
      <h4>Working mechanism</h4>
      <p>WAVE is a <em>passive observer</em>. It has one input pin and no
      output, and it takes no part in combinational logic. Once per
      <b>Step</b>, after the final settle, it samples the trit on its input
      and appends it to a trace buffer.</p>
      <p>The buffer keeps the most recent <b>256</b> samples; older samples
      drop off the front. Open the <b>Wave</b> panel to see every WAVE probe
      drawn as a three-level step plot on a shared time axis.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>trace</code> — the array of recorded trits.</li>
        <li><code>name</code> — label shown next to the trace.</li>
      </ul>
      <p><b>Reset</b> empties the trace.</p>`,
  },

  STI: {
    name: 'STI', tagline: 'Standard ternary inverter',
    body: `
      <p>The Standard Ternary Inverter — the ternary analogue of a NOT gate.</p>
      <h4>Working mechanism</h4>
      <p>STI outputs the <b>negation</b> of its input: <code>out = −in</code>.
      It swaps <code>T</code> and <code>+1</code> and leaves <code>0</code>
      untouched. A <code>null</code> (floating) input gives a <code>null</code>
      output.</p>
      <p>This is the most natural inverter in balanced ternary, because
      negating a balanced-ternary number is simply negating every trit.</p>
      <h4>The three inverters</h4>
      <p>STI, PTI, and NTI are three different one-input functions. Together
      with MIN and MAX they form a <b>functionally complete</b> set — any
      ternary logic function can be built from them.</p>`,
  },

  PTI: {
    name: 'PTI', tagline: 'Positive ternary inverter',
    body: `
      <p>The Positive Ternary Inverter — one of the three standard ternary
      inverters.</p>
      <h4>Working mechanism</h4>
      <p>PTI sends every <em>non-positive</em> input to <code>+1</code> and the
      positive input to <code>T</code>:</p>
      <ul>
        <li><code>T → +1</code></li>
        <li><code>0 → +1</code></li>
        <li><code>+1 → T</code></li>
      </ul>
      <p>Read it as the question "is the input <em>not</em> <code>+1</code>?",
      answered in ternary. With NTI and STI it lets you decompose any ternary
      function.</p>`,
  },

  NTI: {
    name: 'NTI', tagline: 'Negative ternary inverter',
    body: `
      <p>The Negative Ternary Inverter — one of the three standard ternary
      inverters.</p>
      <h4>Working mechanism</h4>
      <p>NTI sends only the negative input to <code>+1</code>; everything else
      goes to <code>T</code>:</p>
      <ul>
        <li><code>T → +1</code></li>
        <li><code>0 → T</code></li>
        <li><code>+1 → T</code></li>
      </ul>
      <p>Read it as the question "is the input <code>T</code>?", answered in
      ternary. It is the mirror image of PTI.</p>`,
  },

  MIN: {
    name: 'MIN', tagline: 'Ternary AND (minimum)',
    body: `
      <p>Ternary AND — outputs the <em>lesser</em> of its two inputs.</p>
      <h4>Working mechanism</h4>
      <p>With the three states ordered <code>T &lt; 0 &lt; +1</code>, MIN
      returns <code>min(a, b)</code>. If either input is <code>null</code> the
      output is <code>null</code>.</p>
      <p>MIN generalises the Boolean AND gate: restricted to the two values
      <code>T</code> and <code>+1</code> it behaves exactly like AND, with
      <code>T</code> playing the role of "false".</p>
      <h4>Why it matters</h4>
      <p>MIN and MAX are the two fundamental ternary gates. Together with the
      inverters they can express every ternary function.</p>`,
  },

  MAX: {
    name: 'MAX', tagline: 'Ternary OR (maximum)',
    body: `
      <p>Ternary OR — outputs the <em>greater</em> of its two inputs.</p>
      <h4>Working mechanism</h4>
      <p>With the states ordered <code>T &lt; 0 &lt; +1</code>, MAX returns
      <code>max(a, b)</code>. A <code>null</code> on either input gives a
      <code>null</code> output.</p>
      <p>MAX generalises the Boolean OR gate: restricted to <code>T</code> and
      <code>+1</code> it behaves exactly like OR.</p>`,
  },

  ADDER: {
    name: 'ADDER', tagline: 'Full single-trit adder',
    body: `
      <p>A full single-trit adder — the arithmetic core of the simulator.</p>
      <h4>Working mechanism</h4>
      <p>ADDER takes three trits — <code>a</code>, <code>b</code>, and a
      carry-in <code>cin</code> — and adds them. The arithmetic sum lies
      between −3 and +3, which a single trit cannot hold, so the result is
      split across two output trits:</p>
      <p style="text-align:center"><code>a + b + cin = 3·cout + sum</code></p>
      <p>Both <code>sum</code> and <code>cout</code> are themselves in
      {<code>T</code>, <code>0</code>, <code>+1</code>}. If any input is
      <code>null</code>, both outputs are <code>null</code>.</p>
      <h4>Building wider adders</h4>
      <p>Chain adders into a <b>ripple-carry</b> array: wire each stage's
      <code>cout</code> to the next stage's <code>cin</code>, feed the
      least-significant <code>cin</code> with <code>0</code>, and you have an
      N-trit adder. Six of them add two trytes.</p>
      <p>The full 27-row truth table below is generated live by the
      simulator.</p>`,
  },

  MUX: {
    name: 'MUX', tagline: 'Ternary 3:1 multiplexer',
    body: `
      <p>A multiplexer routes one of several data inputs through to its
      output, chosen by a select signal. MUX is the ternary 3:1 form: one
      select trit <code>s</code> picks one of three data inputs.</p>
      <h4>Selection</h4>
      <table class="info-tt" style="text-align:center">
        <thead><tr><th>s</th><th>out</th></tr></thead>
        <tbody>
          <tr><td class="trit-T">T</td><td>dT</td></tr>
          <tr><td class="trit-0">0</td><td>d0</td></tr>
          <tr><td class="trit-P">+1</td><td>dP</td></tr>
        </tbody>
      </table>
      <p>Each data input is named for the select value that routes it —
      <code>dT</code> for <code>s = T</code>, <code>d0</code> for
      <code>s = 0</code>, <code>dP</code> for <code>s = +1</code>.</p>
      <h4>Floating inputs</h4>
      <p>If the select <code>s</code> is <code>null</code>, or the
      <em>selected</em> data input is <code>null</code>, the output is
      <code>null</code>. A floating value on an <em>unselected</em> input
      is ignored — only the chosen path reaches the output.</p>
      <h4>Why it matters</h4>
      <p>A multiplexer is how a circuit makes a data-driven choice. In the
      Phase 7 CPU it selects the next program-counter value — increment or
      jump target — and helps the decoder steer control signals. For a
      plain 2-way choice just leave one of the three inputs unused.</p>`,
  },

  TRIBUF: {
    name: 'TRIBUF', tagline: 'Tri-state buffer (high-impedance output)',
    body: `
      <p>A tri-state buffer drives its data input <code>in</code> onto the
      output <code>out</code> only when its enable <code>en</code> is
      <code>+1</code>. Otherwise the output is <b>high-impedance</b>
      (<code>Z</code>, drawn cyan) — the buffer is electrically
      <em>disconnected</em>, driving nothing.</p>
      <h4>Behaviour</h4>
      <table class="info-tt" style="text-align:center">
        <thead><tr><th>en</th><th>out</th></tr></thead>
        <tbody>
          <tr><td class="trit-P">+1</td><td><code>in</code></td></tr>
          <tr><td class="trit-0">0</td><td><code>Z</code></td></tr>
          <tr><td class="trit-T">T</td><td><code>Z</code></td></tr>
        </tbody>
      </table>
      <p>An undefined enable also gives <code>Z</code>. When enabled but
      <code>in</code> itself is floating, the output is <code>null</code>.</p>
      <h4>Shared buses</h4>
      <p>Wire several buffer outputs onto one input pin to make a
      <b>tri-state bus</b>. The simulator resolves the drivers: if exactly one
      is enabled, the bus carries its value; if none are, the bus floats
      (<code>Z</code>); if two enabled buffers disagree, the bus is in
      <b>contention</b> (<code>X</code>, drawn magenta). Ordinary gates treat
      <code>Z</code> and <code>X</code> as undefined. See the
      <em>Tri-state bus</em> example.</p>`,
  },

  MERGE3: {
    name: 'MERGE3', tagline: 'Bundle 3 trits onto one bus wire',
    body: `
      <p>A <b>bus merger</b>: it packs three trit inputs <code>t0</code>,
      <code>t1</code>, <code>t2</code> (<code>t0</code> is the low trit) into a
      single <b>bus</b> output, so a 3-trit datapath word can travel as one
      wire instead of three parallel ones.</p>
      <h4>The bus wire</h4>
      <p>A bus pin is drawn as a violet square and its wire is thick and violet,
      labelled with the word's value — both the balanced-ternary pattern
      (MSB first, <code>T</code>/<code>0</code>/<code>1</code>) and the decimal
      (−13…+13). A floating slot reads <code>?</code> in the label; if every
      input is floating the whole bus is undefined.</p>
      <h4>Use it with SPLIT3</h4>
      <p>Feed the bus into a <code>SPLIT3</code> to recover the three trits.
      Merge/split is the wiring primitive for wider datapaths — bundle a
      <code>REG3</code>'s <code>q0..q2</code>, an <code>ALU</code> result, or a
      <code>RAM</code> word into one labelled wire. See the <em>Word bus</em>
      example.</p>`,
  },

  SPLIT3: {
    name: 'SPLIT3', tagline: 'Unpack a bus wire into 3 trits',
    body: `
      <p>A <b>bus splitter</b>: the inverse of <code>MERGE3</code>. It takes a
      single <b>bus</b> input and fans it back out to three trit outputs
      <code>t0</code>, <code>t1</code>, <code>t2</code> (<code>t0</code> low).</p>
      <p>Each output carries the corresponding trit of the word — including a
      floating slot, which comes out as undefined. An input that isn't a bus
      (e.g. nothing wired) yields three undefined outputs.</p>
      <p>Pair it with a <code>MERGE3</code> upstream. The packed word is an
      opaque value to the rest of the simulator, so a bus propagates, settles
      and times exactly like any other wire. See the <em>Word bus</em>
      example.</p>`,
  },

  TRIBUF3: {
    name: 'TRIBUF3', tagline: 'Tri-state buffer for a whole word bus',
    body: `
      <p>A <b>bus tri-state buffer</b> — the word-wide version of
      <code>TRIBUF</code>. It drives its bus input <code>in</code> onto the bus
      output <code>out</code> when the enable <code>en</code> is <code>+1</code>,
      and is otherwise <b>high-impedance</b> (<code>Z</code>).</p>
      <h4>Tri-state word buses</h4>
      <p>Because a packed bus value is just a scalar to the simulator, the
      resolver treats it exactly like a trit: wire several
      <code>TRIBUF3</code> outputs onto one bus net to build a <b>tri-state
      word bus</b>. Enable exactly one to select its word; enable none and the
      bus floats (<code>Z</code>); enable two that carry <em>different</em>
      words and the bus is in <b>contention</b> (<code>X</code>).</p>
      <p>This is the compact way to build a register-file read port: feed each
      register's <code>MERGE3</code> word through a <code>TRIBUF3</code> gated
      by that register's read-enable, all sharing one bus wire, then
      <code>SPLIT3</code> at the destination. See the <em>Register file (word
      bus)</em> example — the same two-register read port as the
      <em>Tri-state register file</em>, but on a single bus wire instead of
      six. </p>`,
  },

  MERGE6: {
    name: 'MERGE6', tagline: 'Bundle 6 trits (a tryte) onto one bus wire',
    body: `
      <p>The full-<b>tryte</b> bus merger: it packs six trit inputs
      <code>t0</code>…<code>t5</code> (<code>t0</code> low) into a single bus
      output — the 6-trit-wide version of <code>MERGE3</code>, covering the
      whole tryte range (−364…+364).</p>
      <p>It pairs directly with <code>TRYTE_IN</code> / <code>TRYTE_OUT</code>,
      whose six trit pins this bundles to (and from, via <code>SPLIT6</code>)
      one labelled wire. The packed value carries its own width, so a
      <code>TRIBUF3</code> tri-states a tryte bus exactly as it does a word
      bus. See the <em>Tryte bus</em> example.</p>`,
  },

  SPLIT6: {
    name: 'SPLIT6', tagline: 'Unpack a tryte bus into 6 trits',
    body: `
      <p>The inverse of <code>MERGE6</code>: it fans a tryte bus back out to six
      trit outputs <code>t0</code>…<code>t5</code> (<code>t0</code> low), e.g.
      straight into a <code>TRYTE_OUT</code>. A non-bus or floating input yields
      six undefined outputs. See the <em>Tryte bus</em> example.</p>`,
  },

  DFF: {
    name: 'DFF', tagline: 'D flip-flop — 1-trit memory',
    body: `
      <p>The D flip-flop — the one-trit memory cell, and the simplest
      sequential component.</p>
      <h4>Working mechanism</h4>
      <p>DFF has a data input <code>d</code>, a clock input <code>clk</code>,
      and an output <code>q</code> that always shows the stored trit.</p>
      <p>It is <b>edge-triggered</b>. On the <em>rising edge</em> of the clock
      — the moment the previous clk value was not <code>+1</code> and the
      current value is <code>+1</code> — it copies <code>d</code> into storage.
      At every other time, including a clock that simply sits at
      <code>+1</code>, it holds.</p>
      <h4>When latching happens</h4>
      <p>The store is updated only in the <b>latch phase</b> of a Step, never
      during a combinational settle. That separation is what makes feedback
      loops through a flip-flop behave: the rest of the circuit sees a stable
      <code>q</code> while logic settles, and <code>q</code> changes only on
      the edge.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>q</code> — the stored trit (also the output).</li>
        <li><code>clkPrev</code> — the clock value seen on the previous tick,
        used to detect the rising edge.</li>
      </ul>
      <p><b>Reset</b> sets <code>q = 0</code>.</p>`,
  },

  REG3: {
    name: 'REG3', tagline: '3-trit register',
    body: `
      <p>A 3-trit register — three D flip-flops sharing one clock, with a
      load-enable line. The smallest multi-trit memory in TritLogic.</p>
      <h4>Working mechanism</h4>
      <p>REG3 has three data inputs <code>d0..d2</code>, a clock
      <code>clk</code>, a load-enable <code>ld</code>, and three outputs
      <code>q0..q2</code> that always show the stored trits.</p>
      <p>On the <b>rising edge</b> of <code>clk</code> (the same edge rule as
      the DFF) the register checks <code>ld</code>:</p>
      <ul>
        <li><code>ld = +1</code> — <b>load</b>: <code>d0..d2</code> are copied
        into storage.</li>
        <li><code>ld = 0</code>, <code>T</code>, or floating — <b>hold</b>:
        the stored trits pass through the edge unchanged.</li>
      </ul>
      <p>The load-enable is what lets many registers share one clock yet
      update independently — only the ones whose <code>ld</code> is asserted
      change.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>q</code> — an array of three stored trits,
        <code>[q0, q1, q2]</code>.</li>
        <li><code>clkPrev</code> — previous clock value, for edge
        detection.</li>
      </ul>
      <p><b>Reset</b> clears the register to <code>[0, 0, 0]</code>.</p>
      <h4>Where it leads</h4>
      <p>REG3 is the first phase-6 (memory) component. A wider addressable RAM
      block and a CPU register file are built from registers like this one.</p>`,
  },

  RAM: {
    name: 'RAM', tagline: '9-word × 3-trit addressable memory',
    body: `
      <p>An addressable ternary memory: <b>nine words</b> of <b>three trits</b>
      each — the array of trit registers Phase 6 (memory) calls for. Picture
      nine REG3 registers sharing one clock, with an address decoder choosing
      which one a write lands in.</p>
      <h4>Addressing</h4>
      <p>The two address trits <code>a0</code> and <code>a1</code> form a
      balanced-ternary number from <code>-4</code> to <code>+4</code>, decoded
      to a word index 0–8:</p>
      <p style="text-align:center"><code>index = (a0 + 1) + (a1 + 1) × 3</code></p>
      <p>All nine address combinations and the word each selects:</p>
      <table class="info-tt" style="text-align:center">
        <thead><tr>
          <th>index</th><th>a0 = T</th><th>a0 = 0</th><th>a0 = +1</th>
        </tr></thead>
        <tbody>
          <tr><th>a1 = T</th>
            <td class="trit-0">0</td><td class="trit-0">1</td><td class="trit-0">2</td></tr>
          <tr><th>a1 = 0</th>
            <td class="trit-0">3</td><td class="trit-0">4</td><td class="trit-0">5</td></tr>
          <tr><th>a1 = +1</th>
            <td class="trit-0">6</td><td class="trit-0">7</td><td class="trit-0">8</td></tr>
        </tbody>
      </table>
      <p>The zero address <code>(a0 = 0, a1 = 0)</code> lands on the middle
      word, index 4 — balanced ternary centres on zero.</p>
      <p>If either address trit is floating the address is invalid: the
      outputs read <code>null</code> and any write is suppressed.</p>
      <h4>Reading — asynchronous</h4>
      <p>The outputs <code>q0..q2</code> continuously show the word currently
      selected by the address pins. Move the address and the outputs follow
      at once — no clock required.</p>
      <h4>Writing — synchronous</h4>
      <p>On the <b>rising edge</b> of <code>clk</code> (the same edge rule as
      DFF and REG3) the addressed word is overwritten with
      <code>d0..d2</code> — but only when the write-enable <code>we</code> is
      <code>+1</code>. With <code>we</code> at <code>0</code>, <code>T</code>,
      or floating the memory holds every word through the edge.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>mem</code> — nine 3-trit arrays, the stored words.</li>
        <li><code>clkPrev</code> — previous clock value, for edge
        detection.</li>
      </ul>
      <p>The component face draws a live <b>memory map</b>: nine rows of three
      colour cells, one row per word, so storage can be watched as the
      circuit runs. <b>Reset</b> does <em>not</em> clear the memory — like
      real RAM, contents persist across a reset (only the clock-edge
      tracking is cleared). Use <b>Clear</b> to wipe the whole circuit.</p>
      <h4>Where it leads</h4>
      <p>RAM is the addressable store a CPU reads instructions and data from.
      Phase 7 wires it to a program counter and an ALU to build the first
      ternary processor.</p>`,
  },

  ALU: {
    name: 'ALU', tagline: 'Arithmetic / logic unit (3-trit word)',
    body: `
      <p>The compute core of the Phase 7 CPU. The ALU takes two 3-trit
      words — <code>a0..a2</code> and <code>b0..b2</code> — and a one-trit
      operation select <code>op</code>, and produces a 3-trit result
      <code>r0..r2</code> with a carry-out <code>cout</code>.</p>
      <h4>Operations</h4>
      <p>The single <code>op</code> trit picks one of three operations:</p>
      <table class="info-tt" style="text-align:center">
        <thead><tr><th>op</th><th>operation</th><th>result</th></tr></thead>
        <tbody>
          <tr><td class="trit-T">T</td><td>MIN</td>
              <td>per-trit min(a, b)</td></tr>
          <tr><td class="trit-0">0</td><td>ADD</td>
              <td>a + b, ripple-carried</td></tr>
          <tr><td class="trit-P">+1</td><td>MAX</td>
              <td>per-trit max(a, b)</td></tr>
        </tbody>
      </table>
      <h4>ADD — the carry</h4>
      <p>ADD ripples a full-trit add across the three positions, low to
      high — exactly the standalone <b>ADDER</b> chained three deep.
      <code>cout</code> is the carry off the top trit (weight 27), so the
      true sum is <code>value(r0..r2) + cout × 27</code>. MIN and MAX have
      no carry, so <code>cout</code> is <code>0</code> for them.</p>
      <h4>Floating inputs</h4>
      <p>If <code>op</code> or any operand trit is <code>null</code> the
      whole result reads <code>null</code> — a floating input yields a
      floating output, as everywhere else in the simulator.</p>
      <h4>Role in the CPU</h4>
      <p>In the Phase 7 datapath the ALU's <code>a</code> input is the
      accumulator (ACC) and <code>b</code> is the instruction's operand;
      <code>op</code> comes from the instruction decoder. The result feeds
      back into ACC, latched on the next clock edge.</p>`,
  },

  PC: {
    name: 'PC', tagline: 'Program counter — 2-trit instruction address',
    body: `
      <p>The program counter of the Phase 7 CPU: a small clocked register
      holding the address of the current instruction. Two trits wide, so
      it counts the nine RAM word indices, 0–8.</p>
      <h4>Working mechanism</h4>
      <p>On the <b>rising edge</b> of <code>clk</code> (the same edge rule
      as DFF and REG3) the PC updates, choosing by the <code>jmp</code>
      input:</p>
      <ul>
        <li><code>jmp = +1</code> — <b>jump</b>: load the target address
        from <code>j0, j1</code>.</li>
        <li><code>jmp = 0</code>, <code>T</code>, or floating —
        <b>advance</b>: increment by one, wrapping word 8 back to word
        0.</li>
      </ul>
      <p>The outputs <code>p0, p1</code> are the current address — wire
      them straight into a <b>RAM</b> block's <code>a0, a1</code> to fetch
      the instruction there.</p>
      <h4>Internal state</h4>
      <ul>
        <li><code>p</code> — the address, two trits (low first). It is a
        balanced-ternary value −4..+4; the component face shows it as the
        word index 0–8.</li>
        <li><code>clkPrev</code> — previous clock value, for edge
        detection.</li>
      </ul>
      <p><b>Reset</b> returns the PC to word 0 (<code>p = [T, T]</code>).</p>
      <h4>Role in the CPU</h4>
      <p>Each cycle the PC addresses instruction memory; the decoder may
      assert <code>jmp</code> and supply a target to redirect the next
      fetch. Advance is the default — straight-line execution — and a jump
      is the branch.</p>`,
  },

  SUBCIRCUIT: {
    name: 'Subcircuits', tagline: 'Packed reusable blocks',
    body: `
      <p>A subcircuit is a circuit you have <b>packed</b> into a single
      reusable block — TritLogic's mechanism for hierarchical design.</p>
      <h4>How to make one</h4>
      <p>Select a group of components, press <b>Pack ▢</b>, and give the block
      a name. Every <b>INPUT</b> in the selection becomes an input pin of the
      block; every <b>OUTPUT</b> becomes an output pin. Pin names come from
      the <code>name</code> field of those INPUT/OUTPUT components.</p>
      <h4>Working mechanism</h4>
      <p>A subcircuit <em>instance</em> contains a full copy of the inner
      circuit. When the simulator evaluates it, it drives the inner INPUTs
      from the instance's input pins, settles the inner circuit recursively,
      and reads the inner OUTPUTs back out — clocks and flip-flops inside are
      stepped along with the rest of the design.</p>
      <h4>Editing</h4>
      <p>A subcircuit is not editable in place, but <b>middle-click</b> (a
      press of the scroll-wheel button) on any entry in the library to
      <b>edit it on the canvas</b>: that loads the block's internal
      components and wires back onto the canvas, where you can change them
      and <b>Pack</b> them again. Existing instances of the old definition
      keep working until they are replaced.</p>
      <h4>Built-in vs. your own</h4>
      <p>The blocks under the <b>Neural-Net Kit</b> heading
      (<code>TMUL</code>, <code>MAC3</code>, <code>ACT</code>) ship with the
      app and cannot be deleted. Subcircuits you create yourself appear
      under <b>Your subcircuits</b> and can be removed with the ✕ button or
      the right-click menu.</p>`,
  },

  CUSTOMGATE: {
    name: 'Custom gates', tagline: 'Table-defined behavioural gates',
    body: `
      <p>A custom gate is a <b>behavioural</b> component you define by filling
      in a truth table, rather than by drawing an internal circuit.</p>
      <h4>How to make one</h4>
      <p>Press <b>Build Gate</b>, choose 1–3 inputs, and click the
      truth-table cells to cycle each output through
      <code>T → 0 → +1</code>. Name it and add it to the library; it then
      appears in the palette like any built-in gate.</p>
      <h4>Working mechanism</h4>
      <p>The simulator evaluates a custom gate by <b>table lookup</b>: it reads
      the input trits, finds the matching row, and returns the stored output.
      There is no internal network of MIN/MAX/inverter primitives — the table
      <em>is</em> the definition. A <code>null</code> on any input yields a
      <code>null</code> output.</p>
      <h4>Tips</h4>
      <p>Custom gates are ideal for capturing a ternary function you have
      worked out on paper, without wiring up the primitives every time.</p>`,
  },

  'SUB:TMUL': {
    name: 'TMUL — multiply-by-trit',
    tagline: 'Multiplies one activation by one ternary weight',
    body: `
      <p><b>TMUL</b> is a built-in subcircuit that computes a single ternary
      product: <code>p = w · x</code>, where <code>w</code> is a weight trit
      and <code>x</code> is an activation trit. It is the smallest piece of
      the ternary neural-net toolkit — one multiply.</p>

      <h4>Why it exists</h4>
      <p>A neural network spends almost all of its time multiplying
      activations by weights. When the weight is restricted to the three
      values <code>{T, 0, +1}</code> — as in a ternary-weight network — that
      multiply stops needing a multiplier at all. It becomes a choice
      between three things:</p>
      <ul>
        <li><code>w = +1</code> → <b>pass</b> the activation: <code>p = x</code></li>
        <li><code>w = 0</code> → output <b>zero</b>: <code>p = 0</code> (the
            activation is ignored entirely — a free "skip")</li>
        <li><code>w = T</code> → <b>negate</b> the activation: <code>p = −x</code></li>
      </ul>
      <p>So a ternary multiply is just <em>route, zero, or negate</em> — no
      arithmetic hardware. That is the core reason ternary weights are
      cheap, and why a network built from them needs only adders.</p>

      <h4>Working mechanism</h4>
      <p>Two primitives do the job. An <b>STI</b> inverter continuously
      produces <code>−x</code>. A <b>MUX</b> then uses the weight
      <code>w</code> as its select trit to choose its output: when
      <code>w = T</code> it routes <code>−x</code>, when <code>w = 0</code>
      it routes a constant <code>0</code>, and when <code>w = +1</code> it
      routes <code>x</code> unchanged.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — the pins <code>w</code> and <code>x</code></li>
        <li>1 × <b>CONST 0</b> — the zero selected when <code>w = 0</code></li>
        <li>1 × <b>STI</b> — negates <code>x</code> to feed the MUX's
            <code>dT</code> data input</li>
        <li>1 × <b>MUX3</b> — select <code>s = w</code>; data inputs
            <code>dT = −x</code>, <code>d0 = 0</code>, <code>dP = x</code></li>
        <li>1 × <b>OUTPUT</b> — the pin <code>p</code></li>
      </ul>

      <h4>Role in the bigger picture</h4>
      <p>Three TMUL blocks plus an adder tree make a <b>MAC3</b> — a
      three-element dot product, i.e. one neuron's arithmetic. The truth
      table below is generated live by running the subcircuit through the
      simulator: all nine <code>(w, x)</code> combinations.</p>`,
  },

  'SUB:MAC3': {
    name: 'MAC3 — ternary dot product',
    tagline: 'A 3-element ternary-weight multiply-accumulate',
    body: `
      <p><b>MAC3</b> computes a three-element dot product —
      <code>w0·x0 + w1·x1 + w2·x2</code> — from three weight trits and three
      activation trits. It is exactly one neuron's worth of arithmetic: the
      <code>ternary-mac</code> preset example, packed into a single block.</p>

      <h4>The two-trit output</h4>
      <p>Three products, each in <code>{T, 0, +1}</code>, can sum to as much
      as <code>+3</code> or as little as <code>−3</code> — a range a single
      trit cannot hold. So MAC3 produces <b>two</b> output trits,
      <code>lo</code> and <code>hi</code>, and the value they represent is
      <code>3·hi + lo</code>, covering <code>−3 … +3</code>.</p>

      <h4>Working mechanism</h4>
      <p>Two stages. First, three multiply-by-trit cells (an STI + MUX each
      — the same circuit as <b>TMUL</b>) form the three products
      <code>p0, p1, p2</code>. Then an <b>ADDER tree</b> sums them:</p>
      <ul>
        <li><code>add1</code> = <code>p0 + p1</code> → a sum trit and a carry trit</li>
        <li><code>add2</code> = <code>add1.sum + p2</code> → its sum trit is the output <code>lo</code></li>
        <li><code>add3</code> = <code>add1.carry + add2.carry</code> → its sum trit is the output <code>hi</code></li>
      </ul>
      <p>Because the true total never leaves <code>−3 … +3</code>, the third
      adder's own carry-out is always <code>0</code> — two output trits are
      always enough to hold the result.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>6 × <b>INPUT</b> — weights <code>w0,w1,w2</code> and activations
            <code>x0,x1,x2</code></li>
        <li>1 × <b>CONST 0</b> — one shared zero, used for the MUX
            <code>d0</code> inputs and the three adder carry-ins</li>
        <li>3 × <b>STI</b> + 3 × <b>MUX3</b> — the three multiply-by-trit cells</li>
        <li>3 × <b>ADDER</b> — the summation tree described above</li>
        <li>2 × <b>OUTPUT</b> — the result pins <code>lo</code> and <code>hi</code></li>
      </ul>

      <h4>Worked example</h4>
      <p>With <code>x = (+1, +1, T)</code> and <code>w = (+1, 0, T)</code>
      the three products are <code>p = (+1, 0, +1)</code> — a pass, a zero,
      and a negate — which sum to <code>+2</code>. In balanced ternary
      <code>+2 = 3·(+1) + (−1)</code>, so the block outputs
      <code>hi = +1</code> and <code>lo = T</code>.</p>

      <h4>Role in the bigger picture</h4>
      <p>One MAC3 is one neuron, before its activation. A row of MAC3 blocks
      sharing the same activation inputs is a <b>matrix-vector layer</b> —
      see the <code>ternary-layer</code> example. No truth table is shown
      here: six trit inputs would be 3⁶ = 729 rows.</p>`,
  },

  'SUB:ACT': {
    name: 'ACT — sign activation',
    tagline: 'The sign() nonlinearity — a 2-trit value down to one trit',
    body: `
      <p><b>ACT</b> is the activation function of the ternary neural-net
      kit. It takes a two-trit value — the <code>lo</code> / <code>hi</code>
      pair produced by a <b>MAC3</b> — and outputs a single trit
      <code>s = sign(value)</code>, where <code>value = 3·hi + lo</code>.</p>

      <h4>Why it exists</h4>
      <p>It serves two purposes. First, <b>requantisation</b>: a MAC3 output
      spans <code>−3 … +3</code> across two trits, but the next layer's
      inputs are single trits — ACT compresses the wide value back down to
      one. Second, and more fundamental, it is the network's
      <b>nonlinearity</b>. Without a nonlinear step between them, two weight
      layers <code>W2·(W1·x)</code> collapse algebraically into a single
      linear map <code>(W2·W1)·x</code> — and depth would buy nothing. ACT
      is what makes a two-layer network genuinely two layers.</p>
      <p>It is also the one <em>decision</em> in the pipeline. The matrix
      multiplies on either side of it are purely linear; a sign is a
      threshold. In a photonic implementation that threshold is exactly the
      point where the computation would have to hand back from light to
      electronics.</p>

      <h4>Working mechanism</h4>
      <p>Taking the sign of <code>3·hi + lo</code> looks like it needs a
      comparison — it does not. The high trit <b>dominates</b>: whenever
      <code>hi</code> is non-zero, <code>|3·hi| ≥ 3</code> already outweighs
      <code>|lo| ≤ 1</code>, so the sign of the value simply <em>is</em>
      <code>hi</code>. Only when <code>hi = 0</code> does the low trit
      decide — and then the value is just <code>lo</code>, already a clean
      trit. So:</p>
      <p style="text-align:center"><code>sign(value) = hi when hi ≠ 0, else lo</code></p>
      <p>— which is precisely one <b>MUX</b> selecting on <code>hi</code>.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — the pins <code>lo</code> and <code>hi</code></li>
        <li>1 × <b>MUX3</b> — select <code>s = hi</code>; data inputs
            <code>dT = hi</code>, <code>d0 = lo</code>, <code>dP = hi</code>.
            The high trit is wired to <em>both</em> of its own non-zero
            select cases, so a non-zero <code>hi</code> passes itself
            through.</li>
        <li>1 × <b>OUTPUT</b> — the pin <code>s</code></li>
      </ul>

      <h4>The mapping</h4>
      <p>Across every value a MAC3 can produce:</p>
      <ul>
        <li><code>value = −3, −2, −1</code> → <code>s = T</code></li>
        <li><code>value = 0</code> → <code>s = 0</code></li>
        <li><code>value = +1, +2, +3</code> → <code>s = +1</code></li>
      </ul>
      <p>The live truth table below enumerates all nine raw
      <code>(lo, hi)</code> combinations. Three of them — where
      <code>|3·hi + lo| &gt; 3</code> — cannot actually arise from a real
      MAC3; ACT still defines an output for them, and because
      <code>hi</code> dominates that output is the correct sign anyway.</p>

      <h4>Role in the bigger picture</h4>
      <p>A complete neuron is a <b>MAC3</b> followed by an <b>ACT</b>. The
      <code>ternary-mlp</code> example stacks two such layers; every ACT
      block in it is one nonlinearity — one decision.</p>`,
  },

  'SUB:TSUM': {
    name: 'TSUM — carry-free ternary sum',
    tagline: 'One digit of balanced-ternary addition, without the carry',
    body: `
      <p><b>TSUM</b> adds two balanced-ternary trits and returns the result
      <em>folded back into one trit</em> — the sum "modulo 3". It is the
      carry-free half of single-digit addition; its partner <b>TCARRY</b>
      supplies the part that does not fit in one trit.</p>

      <h4>What it computes</h4>
      <p>For inputs <code>x</code> and <code>y</code> the output is
      <code>x + y</code> when that lands in <code>{T, 0, +1}</code>, and
      wraps when it does not: <code>+1</code> plus <code>+1</code> is
      <code>T</code> (2 wraps to −1), and <code>T</code> plus <code>T</code>
      is <code>+1</code> (−2 wraps to +1).</p>

      <h4>Working mechanism</h4>
      <p>Mod-3 addition is <em>not monotone</em>, so it cannot be built from
      <b>MIN</b> and <b>MAX</b> alone — those are monotone, and anything made
      only from monotone parts stays monotone. The non-monotone primitive
      here is the <b>MUX</b>. The operand <code>y</code> selects one of three
      versions of <code>x</code>:</p>
      <ul>
        <li><code>y = T</code> → <b>rotate-down</b> x &nbsp;(T→1, 0→T, 1→0)</li>
        <li><code>y = 0</code> → <b>x unchanged</b></li>
        <li><code>y = +1</code> → <b>rotate-up</b> x &nbsp;(T→0, 0→1, 1→T)</li>
      </ul>
      <p>Each rotation is itself a MUX that selects between the three
      constant trits, so TSUM is three MUXes plus three constants.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — <code>x</code>, <code>y</code></li>
        <li>3 × <b>CONST</b> — the trits T, 0, +1</li>
        <li>2 × <b>MUX3</b> — rotate-up and rotate-down of <code>x</code></li>
        <li>1 × <b>MUX3</b> — <code>y</code> selects rotate-down / x / rotate-up</li>
        <li>1 × <b>OUTPUT</b> — <code>sum</code></li>
      </ul>

      <h4>Role</h4>
      <p>Two TSUMs and two TCARRYs make a full adder — see <b>FADD</b>. The
      truth table below is generated live by running the subcircuit.</p>`,
  },

  'SUB:TCARRY': {
    name: 'TCARRY — ternary add carry',
    tagline: 'The carry digit produced by adding two trits',
    body: `
      <p><b>TCARRY</b> gives the carry of a single balanced-ternary add: the
      part of <code>x + y</code> that does not fit in one trit. It is
      <code>+1</code> only when both inputs are <code>+1</code> (sum +2),
      <code>T</code> only when both are <code>T</code> (sum −2), and
      <code>0</code> everywhere else.</p>

      <h4>Working mechanism</h4>
      <p>Unlike the sum, the carry <em>is</em> monotone, so <b>MIN</b> and
      <b>MAX</b> can do most of the work. The operand <code>y</code> selects,
      through a MUX:</p>
      <ul>
        <li><code>y = T</code> → <code>MIN(x, 0)</code> — gives −1 only if x is also T</li>
        <li><code>y = 0</code> → <code>0</code> — no carry is possible</li>
        <li><code>y = +1</code> → <code>MAX(x, 0)</code> — gives +1 only if x is also +1</li>
      </ul>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — <code>x</code>, <code>y</code></li>
        <li>1 × <b>CONST 0</b></li>
        <li>1 × <b>MIN</b> + 1 × <b>MAX</b> — clamp x to its negative / positive part</li>
        <li>1 × <b>MUX3</b> — <code>y</code> selects MIN / 0 / MAX</li>
        <li>1 × <b>OUTPUT</b> — <code>carry</code></li>
      </ul>

      <h4>Role</h4>
      <p>TCARRY pairs with <b>TSUM</b>: together they are a half-adder, and
      two half-adders make the full adder <b>FADD</b>.</p>`,
  },

  'SUB:FADD': {
    name: 'FADD — gate-level full-trit adder',
    tagline: 'A full adder built from subcircuits — the ADDER, opened up',
    body: `
      <p><b>FADD</b> adds three balanced-ternary trits — <code>a</code>,
      <code>b</code>, and a carry-in <code>cin</code> — producing a
      <code>sum</code> trit and a carry-out <code>cout</code>. It is the
      <em>circuit-level equivalent of the native <code>ADDER</code></em>
      component: identical truth table, but assembled from smaller blocks
      instead of computed by code.</p>

      <h4>Why it exists</h4>
      <p>The native <code>ADDER</code> is a <b>behavioural</b> model — a code
      function, with no inside to inspect. FADD is the same function built
      <b>structurally</b>: middle-click it in the library to open it on the
      canvas and trace every gate. It is the adder that Phases 4–5 of the
      research guide build by hand.</p>

      <h4>Working mechanism</h4>
      <p>Two half-adds, exactly as in a binary full adder:</p>
      <ul>
        <li><code>s1 = TSUM(a, b)</code> &nbsp;·&nbsp; <code>c1 = TCARRY(a, b)</code></li>
        <li><code>sum = TSUM(s1, cin)</code> &nbsp;·&nbsp; <code>c2 = TCARRY(s1, cin)</code></li>
        <li><code>cout = TSUM(c1, c2)</code></li>
      </ul>
      <p>The two carries <code>c1</code> and <code>c2</code> can never both
      be the same non-zero value, so their sum always fits in one trit — a
      plain TSUM combines them, with no further carry needed.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>3 × <b>INPUT</b> — <code>a</code>, <code>b</code>, <code>cin</code></li>
        <li>3 × <b>TSUM</b> + 2 × <b>TCARRY</b> — themselves subcircuits;
            middle-click those to drill down to the gates</li>
        <li>2 × <b>OUTPUT</b> — <code>sum</code>, <code>cout</code></li>
      </ul>

      <h4>Role</h4>
      <p>FADD is a structural stand-in for <code>ADDER</code>. The truth
      table below is generated live by running it — all 27 input
      combinations, identical to the native <code>ADDER</code>'s.</p>`,
  },

  'SUB:ALU3': {
    name: 'ALU3 — gate-level arithmetic-logic unit',
    tagline: 'The native ALU, rebuilt from FADD / MIN / MAX / MUX',
    body: `
      <p><b>ALU3</b> is the structural, openable equivalent of the native
      <code>ALU</code> component. It takes two 3-trit words —
      <code>a0..a2</code> and <code>b0..b2</code> — and a one-trit operation
      select <code>op</code>, and produces a 3-trit result
      <code>r0..r2</code> with a carry-out <code>cout</code>.</p>

      <h4>Operations</h4>
      <ul>
        <li><code>op = T</code> → <b>MIN</b> — per-trit minimum of a and b;
            <code>cout = 0</code></li>
        <li><code>op = 0</code> → <b>ADD</b> — a + b, ripple-carried;
            <code>cout</code> is the carry off the top trit</li>
        <li><code>op = +1</code> → <b>MAX</b> — per-trit maximum of a and b;
            <code>cout = 0</code></li>
      </ul>

      <h4>Working mechanism</h4>
      <p>All three operations are computed <em>at once, in parallel</em>, and
      <code>op</code> selects which result reaches the output:</p>
      <ul>
        <li>At each trit position a <b>MIN</b> gate and a <b>MAX</b> gate
            compute the logic results directly.</li>
        <li>Three <b>FADD</b> blocks form a ripple-carry adder — each one's
            carry-out feeds the next one's carry-in, low trit to high.</li>
        <li>A <b>MUX</b> at each trit, steered by <code>op</code>, picks
            MIN / ADD-sum / MAX. A fourth MUX picks the carry-out: the
            ripple carry for ADD, a constant <code>0</code> for MIN and MAX.</li>
      </ul>
      <p>"Compute everything, then select" is how real ALUs are built — the
      op code steers a multiplexer, it does not switch the arithmetic on
      and off.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>7 × <b>INPUT</b> — <code>a0..a2</code>, <code>b0..b2</code>, <code>op</code></li>
        <li>3 × <b>MIN</b> + 3 × <b>MAX</b> — the per-trit logic operations</li>
        <li>3 × <b>FADD</b> — the ripple-carry adder. Each FADD is itself a
            subcircuit; middle-click to drill down to TSUM / TCARRY, then to
            the gates.</li>
        <li>4 × <b>MUX3</b> + 1 × <b>CONST 0</b> — the op-selected output</li>
        <li>4 × <b>OUTPUT</b> — <code>r0..r2</code>, <code>cout</code></li>
      </ul>

      <h4>Relation to the native ALU</h4>
      <p>For every driven input, ALU3 produces exactly what the native
      <code>ALU</code> does — a self-test confirms this. One difference: the
      native ALU emits all-<code>null</code> if any input is floating,
      whereas ALU3 (like every subcircuit) treats a floating input as
      <code>0</code>. No live truth table is shown — seven trit inputs would
      be 3⁷ = 2187 rows.</p>`,
  },

  'SUB:MUX3': {
    name: 'MUX3 — gate-level 3:1 multiplexer',
    tagline: 'The MUX, rebuilt from MIN / MAX / STI / NTI',
    body: `
      <p><b>MUX3</b> is the structural equivalent of the native <b>MUX</b>: a
      3:1 ternary multiplexer. The select trit <code>s</code> routes one of
      three data inputs to the output — <code>s = T → dT</code>,
      <code>s = 0 → d0</code>, <code>s = +1 → dP</code> — but here it is
      built entirely from MIN, MAX and inverter gates, with no MUX inside.</p>

      <h4>Why this one matters</h4>
      <p>Every other block in the kit — TMUL, ACT, TSUM, TCARRY — leans on
      the MUX as if it were a fundamental primitive. MUX3 shows it is not:
      the MUX itself reduces to MIN / MAX / inverters. And those blocks now
      place a <b>MUX3</b> wherever they need a multiplexer — no native MUX
      anywhere in the kit — so the whole tower,
      <code>ALU3 → FADD → TSUM → MUX3</code>, bottoms out at one floor:
      MIN, MAX, and the inverters.</p>
      <p>It also sharpens an earlier claim. TSUM needs a MUX because mod-3
      addition is <em>non-monotone</em> while MIN and MAX are monotone — but
      the MUX is not the only non-monotone primitive. The <b>inverters</b>
      (STI / PTI / NTI) are too, and they are more fundamental: MUX3 is built
      from them. The true gate floor is <b>MIN, MAX, and the inverters</b>;
      the MUX is a convenience built on top.</p>

      <h4>Working mechanism</h4>
      <p>Three steps — decode, mask, combine:</p>
      <ul>
        <li><b>Decode.</b> The select <code>s</code> becomes three detector
            signals, each <code>+1</code> when its case holds and
            <code>T</code> otherwise: <code>isT = NTI(s)</code>,
            <code>isP = NTI(−s)</code>,
            <code>is0 = STI(MAX(isT, isP))</code>.</li>
        <li><b>Mask.</b> Each data input is combined with its detector by a
            MIN: <code>MIN(d, +1) = d</code> passes the value when selected,
            <code>MIN(d, T) = T</code> forces it to −1 when not.</li>
        <li><b>Combine.</b> Exactly one masked value is real data; the other
            two are −1. A MAX tree keeps the one that got through, since
            <code>MAX(d, −1, −1) = d</code>.</li>
      </ul>

      <h4>Internal structure</h4>
      <ul>
        <li>4 × <b>INPUT</b> — <code>s</code>, <code>dT</code>,
            <code>d0</code>, <code>dP</code></li>
        <li>2 × <b>STI</b> + 2 × <b>NTI</b> — negate s, and the case decoder</li>
        <li>3 × <b>MIN</b> — mask each data input by its detector</li>
        <li>3 × <b>MAX</b> — one in the decoder, two to combine the results</li>
        <li>1 × <b>OUTPUT</b> — <code>out</code></li>
      </ul>
      <p>No MUX, and no constants — fifteen components, all gates. No live
      truth table is shown: four trit inputs would be 3⁴ = 81 rows.</p>`,
  },

  'SUB:TLATCH': {
    name: 'TLATCH — transparent ternary D-latch',
    tagline: 'A 1-trit level-sensitive latch from cross-coupled MIN/MAX',
    body: `
      <p><b>TLATCH</b> is the kit's first <b>feedback</b> circuit: a 1-trit
      D-latch built from a MAX, two MINs, and an inverter — with a wire that
      loops the output back to one of the MIN inputs. It is the simplest
      gate-level memory and the building block of <b>TFLOP</b>.</p>

      <h4>Working mechanism</h4>
      <p>Two inputs — <code>d</code> (data) and <code>en</code> (enable).
      While <code>en = +1</code> the latch is <b>transparent</b>: output
      follows <code>d</code>. While <code>en = T</code> it <b>holds</b> its
      previous value. The trick is that "previous value" is whatever the
      feedback wire is carrying — the simulator's fixed-point solver settles
      to it because <code>q = q</code> is a fixed point.</p>
      <p>The MIN/MAX algebra works out cleanly:</p>
      <ul>
        <li><code>en = +1</code>: <code>load = MIN(d, +1) = d</code>;
            <code>hold = MIN(q, T) = T</code>;
            <code>q = MAX(d, T) = d</code>.</li>
        <li><code>en = T</code>: <code>load = MIN(d, T) = T</code>;
            <code>hold = MIN(q, +1) = q</code>;
            <code>q = MAX(T, q) = q</code>.</li>
      </ul>
      <p>The enable pin <b>must be +1 or T</b> — at <code>en = 0</code> both
      paths collapse and the storage breaks. <b>TFLOP</b> derives its
      latches' enables through <code>PTI</code>, which quantises the
      tri-state clock to <code>{+1, T}</code> so this constraint is always
      satisfied.</p>

      <h4>How can pure gates remember?</h4>
      <p>The simulator's solver runs each <code>simulate()</code> call as a
      fixed-point iteration: it keeps re-evaluating gates until no output
      changes. Output values <b>persist between calls</b> — a subcircuit's
      internal <code>outVals</code> are reused. When <code>en = T</code>, the
      stable solution is "<code>q</code> stays at whatever the last call left
      it at," which is exactly what storage means. To get the loop started,
      a subcircuit's outputs are seeded to <code>0</code> on first use (else
      <code>null</code> would propagate through MIN/MAX forever).</p>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — <code>d</code>, <code>en</code></li>
        <li>1 × <b>STI</b> — invert <code>en</code></li>
        <li>2 × <b>MIN</b> — the load and hold paths</li>
        <li>1 × <b>MAX</b> — combines them; its output is the feedback wire</li>
        <li>1 × <b>OUTPUT</b> — <code>q</code></li>
      </ul>
      <p>Six components, one feedback loop. The next block, <b>TFLOP</b>,
      uses two of these in master-slave to build an edge-triggered DFF.</p>`,
  },

  'SUB:TFLOP': {
    name: 'TFLOP — gate-level D flip-flop',
    tagline: 'The native DFF, rebuilt as two TLATCHes in master-slave',
    body: `
      <p><b>TFLOP</b> is the structural twin of the native <b>DFF</b>: a
      1-trit edge-triggered D flip-flop. Samples <code>d</code> on the
      rising clock edge to <code>+1</code> — exactly the rule the native
      DFF uses. Built from two <b>TLATCH</b>es in the classic master-slave
      arrangement, with no primitive flop inside.</p>

      <h4>Working mechanism</h4>
      <p>Two latches with opposite enables — at most one is transparent at
      any moment. The enables are derived from <code>clk</code> through
      <code>PTI</code> (which quantises <code>clk</code> to the {+1, T} the
      latches need):</p>
      <ul>
        <li><code>en_slave = STI(PTI(clk))</code> — <code>+1</code> when
            <code>clk = +1</code>, <code>T</code> otherwise.</li>
        <li><code>en_master = STI(en_slave)</code> — the opposite.</li>
      </ul>
      <p>While <code>clk</code> is anything except <code>+1</code>, the
      <b>master</b> is transparent (catching <code>d</code>) and the
      <b>slave</b> holds. The instant <code>clk</code> reaches
      <code>+1</code>, master closes on its last <code>d</code> and slave
      opens — so the slave copies the master's held value. That edge
      <em>is</em> the sample. As <code>clk</code> drops back below
      <code>+1</code> the slave closes on the captured value and the master
      becomes transparent again, ready for the next cycle.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>2 × <b>INPUT</b> — <code>d</code>, <code>clk</code></li>
        <li>1 × <b>PTI</b> + 2 × <b>STI</b> — derive the two latch enables</li>
        <li>2 × <b>TLATCH</b> — master and slave; each itself a subcircuit</li>
        <li>1 × <b>OUTPUT</b> — <code>q</code></li>
      </ul>

      <h4>Relation to the native DFF</h4>
      <p>Same rising-edge sample rule, same hold-otherwise behaviour. A
      self-test exercises TFLOP through a sequence of clock and data
      transitions and confirms it matches what the native <code>DFF</code>
      stores at each step. The one observable difference is the initial
      stored value: native <code>DFF</code> starts at <code>q = 0</code>
      (from its defaults), and TFLOP also reaches <code>q = 0</code> after
      its first settle (via the outVals seed).</p>`,
  },

  'SUB:TREG3': {
    name: 'TREG3 — gate-level 3-trit register',
    tagline: 'Three TFLOPs sharing a clock, with a true ternary load-enable',
    body: `
      <p><b>TREG3</b> is the structural twin of the native <b>REG3</b>:
      three 1-trit flip-flops sharing one clock, plus a load-enable pin.
      Every flop here is a <b>TFLOP</b>, which is two <b>TLATCH</b>es, which
      is cross-coupled MIN/MAX — all the way down.</p>

      <h4>Tri-state load-enable</h4>
      <p>Where the native REG3 treats <code>ld</code> as binary (only
      <code>+1</code> loads, everything else holds), TREG3 uses the full
      ternary range — the "fold in the tri-state load" extension this
      twin adds:</p>
      <table class="info-tt" style="text-align:center">
        <thead><tr><th>ld</th><th>action</th><th>d_eff fed to TFLOP</th></tr></thead>
        <tbody>
          <tr><td class="trit-P">+1</td><td>load</td><td><code>d</code></td></tr>
          <tr><td class="trit-0">0</td><td>hold</td><td><code>q</code> (feedback)</td></tr>
          <tr><td class="trit-T">T</td><td>clear</td><td><code>0</code></td></tr>
        </tbody>
      </table>
      <p>The selection happens per trit through a <b>MUX3</b>:
      <code>d_eff = MUX3(ld, dT=0, d0=q, dP=d)</code>. The TFLOP samples
      <code>d_eff</code> on the rising clock edge, so the meaning is
      "decide what to store; the edge stores it." Hold uses
      <code>q</code> as its own input — a feedback wire that re-samples the
      current value on the edge, a no-op.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>5 × <b>INPUT</b> — <code>d0..d2</code>, <code>clk</code>,
            <code>ld</code></li>
        <li>1 × <b>CONST 0</b> — the clear value</li>
        <li>3 × <b>MUX3</b> — per-trit selector</li>
        <li>3 × <b>TFLOP</b> — per-trit storage; each itself a subcircuit
            (drill down through TFLOP → TLATCH → MIN/MAX/STI)</li>
        <li>3 × <b>OUTPUT</b> — <code>q0..q2</code></li>
      </ul>

      <h4>Relation to the native REG3</h4>
      <p>For <code>ld ∈ {+1, 0}</code> TREG3 matches the native REG3
      exactly — load on the rising edge when <code>ld = +1</code>, hold
      otherwise. For <code>ld = T</code> TREG3 clears (a behaviour native
      REG3 doesn't have); a self-test verifies all three cases.</p>`,
  },

  'SUB:TPC': {
    name: 'TPC — gate-level program counter',
    tagline: 'The native PC, rebuilt from TFLOPs + a FADD-based incrementer',
    body: `
      <p><b>TPC</b> is the structural twin of the native <b>PC</b>: a 2-trit
      program counter that increments on each rising clock edge, or jumps
      to a target address when <code>jmp = +1</code>. Built from two
      <b>TFLOP</b>s for the address register, two <b>FADD</b> blocks for
      the +1 incrementer, and two <b>MUX3</b>es for the next-state select.</p>

      <h4>Working mechanism</h4>
      <p>Three pieces wired around the two stored trits:</p>
      <ul>
        <li><b>Increment.</b> <code>inc0 = FADD(p0, +1, 0)</code> and
            <code>inc1 = FADD(p1, 0, cout0)</code>. The carry off the top
            trit is <em>discarded</em>, which is exactly what makes the
            counter wrap word 8 → word 0 in balanced ternary.</li>
        <li><b>Select.</b> A MUX3 per trit picks either the increment or
            the jump target, controlled by <code>jmp</code>. The native PC
            only treats <code>+1</code> as "jump," so increment is wired
            into both <code>dT</code> and <code>d0</code> of the MUX3 —
            <em>any</em> non-<code>+1</code> value of <code>jmp</code> still
            picks the increment.</li>
        <li><b>Latch.</b> Two TFLOPs sample the MUX3 outputs on the rising
            edge; their <code>q</code> outputs are <code>p0, p1</code>, fed
            back into the incrementer for the next cycle.</li>
      </ul>

      <h4>Internal structure</h4>
      <ul>
        <li>4 × <b>INPUT</b> — <code>clk</code>, <code>jmp</code>,
            <code>j0</code>, <code>j1</code></li>
        <li>2 × <b>CONST</b> — <code>+1</code> (low-trit incrementer
            addend) and <code>0</code> (high-trit addend)</li>
        <li>2 × <b>FADD</b> — the ripple-carry incrementer; each itself a
            subcircuit (drill in for TSUM / TCARRY / gates)</li>
        <li>2 × <b>MUX3</b> — next-state select</li>
        <li>2 × <b>TFLOP</b> — the stored address; each itself nested
            (TFLOP → TLATCH → gates)</li>
        <li>2 × <b>OUTPUT</b> — <code>p0</code>, <code>p1</code></li>
      </ul>

      <h4>Relation to the native PC</h4>
      <p>Same rising-edge update rule, same wrap-on-overflow, same
      "jmp = +1 jumps, anything else increments" semantics — a self-test
      walks both through ten increments and a jump and confirms TPC
      tracks the native PC every cycle. One observable difference: the
      <em>reset state</em>. Native PC's <code>defaults()</code> sets
      <code>p = [-1, -1]</code> (word 0); TPC's TFLOPs settle to
      <code>q = 0</code> after their first call (the outVals seed), so
      TPC's natural reset is word 4 (the centre of balanced ternary).
      A one-cycle jump to <code>(-1, -1)</code> aligns them.</p>`,
  },

  'SUB:TRAM': {
    name: 'TRAM — gate-level 9 × 3-trit RAM',
    tagline: 'Nine TREG3 words, a one-hot decoder, a MUX3 read tree',
    body: `
      <p><b>TRAM</b> is the structural twin of the native <b>RAM</b> block:
      nine words of three trits each, with the same two-trit address, the
      same asynchronous read, and the same write-enabled synchronous
      write. Every trit of storage is a TFLOP (via TREG3); every cell of
      address decode and read mux is MIN/MAX/STI/NTI/PTI; nothing native is
      sequential anywhere inside.</p>

      <h4>Address decode (one-hot)</h4>
      <p>Each address trit gets three detectors — <code>isT</code>,
      <code>is0</code>, <code>isP</code> — that fire <code>+1</code> when
      the address trit matches the constant and <code>T</code> otherwise:</p>
      <ul>
        <li><code>isT(a) = NTI(a)</code></li>
        <li><code>isP(a) = STI(PTI(a))</code></li>
        <li><code>is0(a) = MIN(PTI(a), STI(NTI(a)))</code></li>
      </ul>
      <p>One row and column detector are MIN-ANDed into nine per-word
      select signals <code>sel[i]</code>. The load-enable for word
      <code>i</code> is <code>MAX(MIN(sel[i], we), 0)</code> — the
      addressed word loads exactly when <code>we = +1</code>, every other
      word gets <code>ld = 0</code> (hold). The <code>MAX</code>-with-0
      clamp is there because TREG3 treats <code>ld = T</code> as
      <em>clear</em>; without it, eight words would be cleared on every
      single-word store.</p>

      <h4>Read tree</h4>
      <p>Reads are combinational: for each output trit, three MUX3s pick
      within each row (steered by <code>a0</code>), then a final MUX3 picks
      between rows (steered by <code>a1</code>). Twelve MUX3s in total, no
      clock involved — change the address and the outputs follow at once,
      same as native RAM.</p>

      <h4>Internal structure</h4>
      <ul>
        <li>7 × <b>INPUT</b> — <code>a0</code>, <code>a1</code>,
            <code>d0..d2</code>, <code>we</code>, <code>clk</code></li>
        <li>16 × inverter (<b>NTI</b> / <b>PTI</b> / <b>STI</b>) — address
            trit equality detectors</li>
        <li>2 × <b>MIN</b> — the <code>is0</code> AND-combine</li>
        <li>9 × <b>MIN</b> + 9 × <b>MIN</b> + 9 × <b>MAX</b> + 1 ×
            <b>CONST 0</b> — per-word selects, write enables, and the
            clamp-to-non-negative</li>
        <li>9 × <b>TREG3</b> — the storage array (3 trits × 9 words; each
            TREG3 holds three TFLOPs)</li>
        <li>12 × <b>MUX3</b> — the 2-level read tree</li>
        <li>3 × <b>OUTPUT</b> — <code>q0..q2</code></li>
      </ul>
      <p>The deepest path is six levels deep:
      <code>TRAM → TREG3 → TFLOP → TLATCH → MIN/MAX/STI → gates</code> —
      every layer middle-clickable, every gate inspectable.</p>

      <h4>Relation to the native RAM</h4>
      <p>For every driven input, TRAM stores and reads the same words the
      native RAM does. One difference: the native RAM emits all-
      <code>null</code> when the address is floating, whereas TRAM (like
      every subcircuit) treats a floating input as <code>0</code>, so a
      floating address reads <em>word 4</em> (the centre) rather than
      <code>null</code>. A self-test exercises store-then-read across
      several addresses and confirms the contents match.</p>`,
  },

  'SUB:DECODE2': {
    name: 'DECODE2 — 2-trit opcode decoder',
    tagline: '9 active-high one-hot enables for the v2 ISA',
    body: `
      <p><b>DECODE2</b> is the first Control-kit subcircuit. It takes the
      two opcode trits (<code>opL</code>, <code>opH</code>) from a v2
      instruction word and emits nine <code>{0, +1}</code>-domain enable
      lines — one per opcode — that the CPU2 datapath uses to gate
      register loads, RAM writes, and the ALU op selector.</p>

      <h4>The {0, +1} convention</h4>
      <p>Each enable is <code>+1</code> when its opcode is selected,
      <code>0</code> otherwise (never <code>T</code>). This convention
      collapses combinational control to ordinary MIN/MAX gates —
      <code>MIN</code> is logical AND, <code>MAX</code> is OR — and it
      lets the ALU op selector reduce to a single TSUM:
      <code>aluOpSel = TSUM(en_MAXI, NEG(en_MINI))</code> gives <code>0</code>
      for ADDI, <code>+1</code> for MAXI, and <code>−1</code> for MINI
      with no extra clamp logic.</p>

      <h4>Detector formulas</h4>
      <p>Per opcode trit, three trit-equality detectors are built from
      the native inverters PTI and NTI:</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
isP(x) = MAX(STI(MAX(PTI(x), NTI(x))), 0)   ; +1 iff x = +1
isT(x) = MAX(NTI(x), 0)                     ; +1 iff x = −1
is0(x) = MAX(MIN(PTI(x), STI(NTI(x))), 0)   ; +1 iff x =  0</pre>
      <p>Each enable is then <code>MIN(is_H, is_L)</code> for that
      opcode's target <code>(opH, opL)</code> pair from the v2 codepoint
      table (see the ISA v2 reference page).</p>

      <h4>Outputs (9 enables)</h4>
      <p><code>en_NOP, en_JMP, en_JMPP, en_JMPZ, en_ADDI, en_MAXI,
      en_MINI, en_LOAD, en_STORE</code> — exactly one is <code>+1</code>
      on any valid <code>(opH, opL)</code>; the rest are <code>0</code>.
      A self-test drives every one of the nine codepoints through a
      fresh DECODE2 instance and checks the one-hot pattern.</p>

      <h4>How CPU2 uses the outputs</h4>
      <ul>
        <li><code>accWrite = MAX(en_ADDI, en_MAXI, en_MINI, en_LOAD)</code>
            — drives the ACC register's load enable</li>
        <li><code>jmpEn = MAX(en_JMP, MIN(en_JMPP, isPos),
            MIN(en_JMPZ, isZero))</code> — drives the PC's jump enable
            (the <code>isPos</code>/<code>isZero</code> flags come from
            <b>ACC_SIGN</b>)</li>
        <li><code>dmem.we = en_STORE</code></li>
        <li><code>accSrc</code> MUX select = <code>en_LOAD</code></li>
      </ul>`,
  },

  'SUB:ACC_SIGN': {
    name: 'ACC_SIGN — accumulator sign detector',
    tagline: 'Three ACC trits → isZero and isPos flags for CPU2 conditional jumps',
    body: `
      <p><b>ACC_SIGN</b> is the second Control-kit subcircuit, alongside
      <b>DECODE2</b>. It reads the three ACC trits and emits two
      <code>{0, +1}</code>-domain flags — <code>isZero</code> (true when
      ACC = 0) and <code>isPos</code> (true when ACC &gt; 0) — that gate
      CPU2's conditional jumps: <code>JMPZ</code> branches on
      <code>isZero</code>, <code>JMPP</code> branches on <code>isPos</code>.</p>

      <h4>isZero</h4>
      <p>A 3-trit balanced-ternary number is zero only when every trit
      is 0, so <code>isZero</code> is just an AND over per-trit
      <code>is0</code> detectors. Each detector reuses the DECODE2
      pattern:</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
is0(x) = MAX(MIN(PTI(x), STI(NTI(x))), 0)   ; +1 iff x = 0</pre>
      <p>Then <code>isZero = MIN(MIN(is0(q0), is0(q1)), is0(q2))</code> —
      MIN acts as AND on the <code>{0, +1}</code> domain.</p>

      <h4>isPos via priority encode</h4>
      <p>In balanced ternary, the sign of an N-trit value equals the sign
      of the highest-order non-zero trit — because <code>|q_hi · 3^hi|</code>
      always exceeds the sum of all lower-order trits. So the sign comes
      from a two-MUX priority encoder that walks down from <code>q2</code>:</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
inner  = MUX(is0(q1), q1, q1, q0)     ; if q1 ≠ 0 → q1 else q0
signOf = MUX(is0(q2), q2, q2, inner)  ; if q2 ≠ 0 → q2 else inner</pre>
      <p>The selector is in <code>{0, +1}</code> so <code>dT</code> is
      never reached; it is wired to the trit it would otherwise carry so
      the MUX renders cleanly. Then <code>isPos</code> detects
      <code>signOf = +1</code> using two inverters and a clamp:</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
isPos = MAX(STI(PTI(signOf)), 0)
      ;   signOf=+1 → +1
      ;   signOf=0  → 0
      ;   signOf=-1 → 0</pre>

      <h4>Internal structure</h4>
      <ul>
        <li>3 × <b>INPUT</b> — <code>q0</code>, <code>q1</code>,
            <code>q2</code></li>
        <li>1 × <b>CONST 0</b> — the clamp reference, shared by every
            <code>MAX(_, 0)</code></li>
        <li>9 × inverter (<b>PTI / NTI / STI</b>) per detector block ×
            3 blocks + 2 more for the isPos formula</li>
        <li>3 × <b>MIN</b> + 3 × <b>MAX</b> — per-trit <code>is0</code></li>
        <li>2 × <b>MIN</b> — the AND tree forming <code>isZero</code></li>
        <li>2 × <b>MUX</b> — the priority encoder picking
            <code>signOf</code></li>
        <li>1 × <b>MAX</b> — the <code>isPos</code> clamp</li>
        <li>2 × <b>OUTPUT</b> — <code>isZero</code>, <code>isPos</code></li>
      </ul>

      <h4>Why this matters for the CPU2 datapath</h4>
      <p>With ACC_SIGN's outputs in the <code>{0, +1}</code> convention,
      the conditional-jump combiner is one MIN per condition plus an OR
      tree:</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
jmpEn = MAX(en_JMP,
            MIN(en_JMPP, isPos),
            MIN(en_JMPZ, isZero))</pre>
      <p>A self-test drives every one of the 27 possible ACC values
      through a fresh ACC_SIGN instance and checks both flags against
      the balanced-ternary semantics.</p>`,
  },

  'SUB:MSEQ': {
    name: 'MSEQ — microsequencer',
    tagline: 'Picks the next micro-PC for a microcoded control unit (E3 Phase 1)',
    body: `
      <p><b>MSEQ</b> is the heart of <b>microcode</b> (see the project's
      <code>MICROCODE.md</code>). Where CPU2 decodes each opcode
      combinationally in one cycle, a microcoded machine walks a small
      program — a <b>control store</b> of horizontal control words —
      using a micro-PC (a <code>PC</code> acting as the µPC). MSEQ decides
      where the µPC goes next from a microinstruction's 1-trit
      <code>seqMode</code> field.</p>

      <h4>Sequencing modes</h4>
      <table class="info-tt" style="text-align:center">
        <thead><tr><th>seqMode</th><th>mode</th><th>µPC next</th></tr></thead>
        <tbody>
          <tr><td class="trit-0">0</td><td>CONT</td><td>µPC + 1</td></tr>
          <tr><td class="trit-P">+1</td><td>DISP</td><td>dispatch address</td></tr>
          <tr><td class="trit-T">T</td><td>FETCH</td><td>µword 0 (fetch routine)</td></tr>
        </tbody>
      </table>
      <p>It drives a <code>PC</code> through its <code>jmp</code> /
      <code>j0</code> / <code>j1</code> pins. Since the PC encodes its word
      index as <code>tritsToInt(p) + 4</code>, µword 0 is <code>p = (T, T)</code>
      — that's the FETCH target.</p>

      <h4>Internal structure</h4>
      <p>The whole sequencer is <b>three native MUXes</b> keyed on
      <code>seqMode</code> (the MUX's <code>s ∈ {T,0,+1}</code> routing
      <em>is</em> the decode — there isn't a single detector gate):</p>
      <pre style="margin: 4px 0; padding: 6px; background: var(--panel-2); border-radius: 4px; font-size: 11px;">
jmp = MUX(seqMode; dT=+1, d0=0,     dP=+1)
j0  = MUX(seqMode; dT=−1, d0=disp0, dP=disp0)
j1  = MUX(seqMode; dT=−1, d0=disp1, dP=disp1)</pre>
      <p>So CONT lets the µPC increment (<code>jmp = 0</code>), DISP loads
      the dispatch address, and FETCH loads <code>(T, T)</code>. See the
      <em>Microcode sequencer</em> example, where MSEQ + a PC + a RAM
      control store walk a CONT,CONT,CONT,FETCH microprogram that loops on
      its own.</p>`,
  },
};
