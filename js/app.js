// ============================================================================
//  TRIT VALUES & UTILITIES
// ============================================================================
//
//  A "trit" is one of -1, 0, +1.  We use the JavaScript number type directly
//  because it makes arithmetic in component eval() functions natural.
//  The value `null` represents an undefined / floating wire — propagates
//  through gates as null.

const TRIT_COLOR = {
  '-1': '#e35555', '0': '#888c95', '1': '#54c060', undef: '#44485a',
};
const tritColor = (v) => v == null ? TRIT_COLOR.undef : (TRIT_COLOR[String(v)] || TRIT_COLOR.undef);
const tritLabel = (v) => v === -1 ? 'T' : v === 0 ? '0' : v === 1 ? '1' : '?';
const tritClass = (v) => v === -1 ? 'trit-T' : v === 0 ? 'trit-0' : v === 1 ? 'trit-P' : '';

// File format version for save/load.  Increment when the JSON shape
// changes incompatibly so the loader can either upgrade or warn.
const SAVE_FORMAT_VERSION = 1;

// Prefer the platform's structuredClone (faster + preserves more JS types)
// and fall back to the JSON round-trip when it isn't available.  This
// shows up in cleanComps() and cloneSubScope() in particular.
const deepClone = (typeof structuredClone === 'function')
  ? structuredClone
  : (x => JSON.parse(JSON.stringify(x)));

// Decimal → balanced-ternary digit array, LSB first, length N.
//
// JS `%` returns negative remainders for negative dividends (-7 % 3 === -1),
// and `Math.trunc(n/3)` truncates toward zero — together those mean a naive
// loop produces wrong digits for negatives.  The fix: take the raw signed
// remainder, map 2 → -1 and -2 → +1, and update n via the exact identity
// (n - r) / 3 which is always an integer.
function intToTrits(n, width) {
  const trits = [];
  n = Math.trunc(n);
  for (let i = 0; i < width; i++) {
    let r = n % 3;
    if (r ===  2) r = -1;
    if (r === -2) r =  1;
    trits.push(r);
    n = (n - r) / 3;
  }
  return trits;
}

// Sanity check on startup: every 6-trit value must round-trip.  Fires once
// at parse time.  Cheap (~729 iterations) and saves debugging time.
(function selfTestIntToTrits() {
  for (let n = -364; n <= 364; n++) {
    const back = tritsToInt(intToTrits(n, 6));
    if (back !== n) {
      console.error(`intToTrits round-trip failed: ${n} → ${back}`);
      return;
    }
  }
})();
function tritsToInt(trits) {
  let s = 0;
  for (let i = 0; i < trits.length; i++) s += (trits[i] ?? 0) * Math.pow(3, i);
  return s;
}
// Parse a balanced-ternary string like "1T01" (MSB first) or a decimal int.
//
// Returns { trits, warning }.  `trits` is always a length-`width` array of
// {-1,0,+1}.  `warning` is a string when the input had to be clamped,
// truncated, or rejected — otherwise null.  Callers should surface the
// warning via setStatus so the user sees it instead of silently getting
// zeros.
// Parse a balanced-ternary trit string, MSB first — the digits T (−1), 0
// and +1.  Strictly ternary: a string of only 0s and 1s is a trit pattern,
// NOT a decimal number ("000111" → trits, value 13).  Decimal entry has its
// own dedicated field, so there is no ambiguous decimal fallback here.
function parseTryteString(s, width = 6) {
  s = (s || '').trim();
  if (s === '') return { trits: new Array(width).fill(0), warning: null };
  if (/^[T01]+$/i.test(s)) {
    const arr = s.toUpperCase().split('').reverse().map(c => c === 'T' ? -1 : c === '0' ? 0 : 1);
    if (arr.length > width) {
      return { trits: arr.slice(0, width),
               warning: `string longer than ${width} trits; only LSB ${width} kept` };
    }
    while (arr.length < width) arr.push(0);
    return { trits: arr, warning: null };
  }
  // Not a trit string.  Return zeros + a warning rather than pretending the
  // user typed 0 successfully.
  return { trits: new Array(width).fill(0),
           warning: `could not parse "${s}"; expected a balanced-ternary string of T, 0 and 1 — use the Decimal value field for numbers` };
}
function formatTryte(trits) {
  // Pretty form: balanced-ternary MSB first + decimal in parens
  const bt = trits.slice().reverse().map(t => t === -1 ? 'T' : t === 0 ? '0' : '1').join('');
  return `${bt} (${tritsToInt(trits)})`;
}

// ============================================================================
//  COMPONENT TYPE REGISTRY
// ============================================================================
//
//  Each entry describes geometry, pin layout, default state, and the pure
//  eval() function that maps inputs → outputs.  Sequential components
//  additionally define latch(c, vIn) which is called on each clock tick to
//  mutate internal state.

const TYPES = {};

// ---- I/O sources ----------------------------------------------------------
TYPES.INPUT = {
  w: 56, h: 40,
  pins: { out: { side: 'right', dx: 56, dy: 20, kind: 'out' } },
  defaults: () => ({ value: 0, name: '' }),
  eval: (c) => ({ out: c.state.value }),
  draw: drawInput,
  inspector: (c) => [
    { label: 'Pin name (for subcircuits)', kind: 'text', get: () => c.state.name || '',
      set: v => c.state.name = v },
    { label: 'Value', kind: 'select', options: [['-1','T'],['0','0'],['1','+1']],
      get: () => String(c.state.value), set: v => { c.state.value = parseInt(v,10); } },
  ],
};

TYPES.CONST = {
  w: 40, h: 28,
  pins: { out: { side: 'right', dx: 40, dy: 14, kind: 'out' } },
  defaults: () => ({ value: 1 }),
  eval: (c) => ({ out: c.state.value }),
  draw: drawConst,
  inspector: (c) => [
    { label: 'Value', kind: 'select', options: [['-1','T'],['0','0'],['1','+1']],
      get: () => String(c.state.value), set: v => { c.state.value = parseInt(v,10); } },
  ],
};

TYPES.TRYTE_IN = {
  // 6-trit input: 6 output pins, value editable.
  w: 80, h: 100,
  pins: (() => {
    const p = {};
    for (let i = 0; i < 6; i++) {
      p['t' + i] = { side: 'right', dx: 80, dy: 18 + i * 14, kind: 'out' };
    }
    return p;
  })(),
  defaults: () => ({ value: 0, name: '' }),
  eval: (c) => {
    const trits = intToTrits(c.state.value, 6);
    const out = {};
    for (let i = 0; i < 6; i++) out['t' + i] = trits[i];
    return out;
  },
  draw: drawTryteIn,
  inspector: (c) => [
    { label: 'Decimal value', kind: 'number', get: () => c.state.value,
      set: v => {
        const n = parseInt(v || '0', 10) || 0;
        const clamped = Math.max(-364, Math.min(364, n));
        c.state.value = clamped;
        if (clamped !== n) {
          setStatus(`tryte value ${n} out of range (±364); clamped to ${clamped}`);
        }
      } },
    { label: 'Balanced ternary (MSB first)', kind: 'text',
      get: () => intToTrits(c.state.value, 6).slice().reverse()
                 .map(t => t === -1 ? 'T' : t === 0 ? '0' : '1').join(''),
      set: v => {
        const { trits, warning } = parseTryteString(v, 6);
        c.state.value = tritsToInt(trits);
        if (warning) setStatus(warning);
      } },
  ],
};

TYPES.CLOCK = {
  // A ternary clock has two reasonable cycle patterns:
  //
  //   mode 'tri' (default): T → 0 → +1 → T → ...   — visits all three states.
  //   mode 'bi':            T ↔ +1                — skips the middle state.
  //
  // The tri mode is more honest in a balanced-ternary system; bi mode is
  // useful when you want classical rising/falling edge timing without
  // an intermediate state.  Either way the DFF latches on the transition
  // INTO +1 from anything else, so latches happen once per cycle in
  // both modes (every 3 ticks for tri, every 2 ticks for bi).
  w: 56, h: 40,
  pins: { out: { side: 'right', dx: 56, dy: 20, kind: 'out' } },
  defaults: () => ({ value: -1, mode: 'tri' }),
  eval: (c) => ({ out: c.state.value }),
  draw: drawClock,
  inspector: (c) => [
    { label: 'Cycle mode', kind: 'select',
      options: [['tri','Three-state (T → 0 → +1)'], ['bi','Two-state (T ↔ +1)']],
      get: () => c.state.mode || 'tri',
      set: v => { c.state.mode = v; } },
    { label: 'Current value', kind: 'select',
      options: [['-1','T'],['0','0'],['1','+1']],
      get: () => String(c.state.value),
      set: v => { c.state.value = parseInt(v,10); } },
  ],
};

// ---- I/O sinks ------------------------------------------------------------
TYPES.OUTPUT = {
  w: 40, h: 40,
  pins: { in: { side: 'left', dx: 0, dy: 20, kind: 'in' } },
  defaults: () => ({ name: '' }),
  eval: () => ({}),
  draw: drawOutput,
  inspector: (c) => [
    { label: 'Pin name (for subcircuits)', kind: 'text', get: () => c.state.name || '',
      set: v => c.state.name = v },
  ],
};

TYPES.TRYTE_OUT = {
  w: 88, h: 100,
  pins: (() => {
    const p = {};
    for (let i = 0; i < 6; i++) {
      p['t' + i] = { side: 'left', dx: 0, dy: 18 + i * 14, kind: 'in' };
    }
    return p;
  })(),
  defaults: () => ({}),
  eval: () => ({}),
  draw: drawTryteOut,
};

TYPES.WAVE = {
  // A probe that records its input value at every clock tick.  Unlike a true
  // sequential element, WAVE is a passive observer; we record its input
  // value after the final combinational settle each step (not in the latch
  // phase) so the trace reflects the post-edge state.
  w: 56, h: 40,
  pins: { in: { side: 'left', dx: 0, dy: 20, kind: 'in' } },
  defaults: () => ({ name: '', trace: [] }),
  eval: () => ({}),
  draw: drawWave,
  inspector: (c) => [
    { label: 'Probe name', kind: 'text', get: () => c.state.name || '',
      set: v => c.state.name = v },
  ],
};

// ---- Unary inverters ------------------------------------------------------
function makeInverter(label, fn) {
  return {
    w: 64, h: 40,
    pins: {
      in:  { side: 'left',  dx: 0,  dy: 20, kind: 'in' },
      out: { side: 'right', dx: 64, dy: 20, kind: 'out' },
    },
    defaults: () => ({}),
    eval: (_, v) => v.in == null ? { out: null } : { out: fn(v.in) },
    draw: (c) => drawInverterShape(c, label),
  };
}
TYPES.STI = makeInverter('STI', a => -a || 0);   // `|| 0` canonicalises -0 → 0
TYPES.PTI = makeInverter('PTI', a => a === 1 ? -1 : 1);   // T,0 → 1 ; 1 → T
TYPES.NTI = makeInverter('NTI', a => a === -1 ? 1 : -1);  // T → 1 ; 0,1 → T

// ---- Binary gates ---------------------------------------------------------
function makeBinary(label, fn) {
  return {
    w: 72, h: 60,
    pins: {
      a:   { side: 'left',  dx: 0,  dy: 16, kind: 'in' },
      b:   { side: 'left',  dx: 0,  dy: 44, kind: 'in' },
      out: { side: 'right', dx: 72, dy: 30, kind: 'out' },
    },
    defaults: () => ({}),
    eval: (_, v) => (v.a == null || v.b == null) ? { out: null } : { out: fn(v.a, v.b) },
    draw: (c) => drawBinaryShape(c, label),
  };
}
TYPES.MIN = makeBinary('MIN', (a, b) => Math.min(a, b));
TYPES.MAX = makeBinary('MAX', (a, b) => Math.max(a, b));

// ---- Full-trit adder ------------------------------------------------------
const ADDER_TABLE = {
  '-3': { sum:  0, cout: -1 },
  '-2': { sum:  1, cout: -1 },
  '-1': { sum: -1, cout:  0 },
   '0': { sum:  0, cout:  0 },
   '1': { sum:  1, cout:  0 },
   '2': { sum: -1, cout:  1 },
   '3': { sum:  0, cout:  1 },
};
TYPES.ADDER = {
  w: 96, h: 88,
  pins: {
    a:    { side: 'left',  dx: 0,  dy: 18, kind: 'in' },
    b:    { side: 'left',  dx: 0,  dy: 44, kind: 'in' },
    cin:  { side: 'left',  dx: 0,  dy: 70, kind: 'in' },
    sum:  { side: 'right', dx: 96, dy: 26, kind: 'out' },
    cout: { side: 'right', dx: 96, dy: 62, kind: 'out' },
  },
  defaults: () => ({}),
  eval: (_, v) => {
    if (v.a == null || v.b == null || v.cin == null) return { sum: null, cout: null };
    return ADDER_TABLE[String(v.a + v.b + v.cin)];
  },
  draw: drawAdder,
};

// ---- Multiplexer ----------------------------------------------------------
//
//  A ternary 3:1 multiplexer.  The select trit s routes one of three data
//  inputs to the output:  s = T → dT,  s = 0 → d0,  s = +1 → dP.  Each data
//  input is named for the select value that picks it.  A floating select,
//  or a floating value on the *selected* input, gives a floating output;
//  floating values on the unselected inputs are ignored.

TYPES.MUX = {
  w: 80, h: 104,
  pins: {
    s:   { side: 'left',  dx: 0,  dy: 20, kind: 'in' },
    dT:  { side: 'left',  dx: 0,  dy: 44, kind: 'in' },
    d0:  { side: 'left',  dx: 0,  dy: 62, kind: 'in' },
    dP:  { side: 'left',  dx: 0,  dy: 80, kind: 'in' },
    out: { side: 'right', dx: 80, dy: 50, kind: 'out' },
  },
  defaults: () => ({}),
  eval: (_, v) => {
    if (v.s == null) return { out: null };
    const pick = v.s === -1 ? v.dT : v.s === 0 ? v.d0 : v.dP;
    return { out: pick ?? null };
  },
  draw: drawMUX,
};

// ---- D flip-flop ----------------------------------------------------------
//
//  Edge-triggered on rising edge of clk (clkPrev !== 1 && clk === 1).
//  Internal state: q (current stored trit), clkPrev (last seen clk value).
//  Output is always state.q.  We latch on tick() — the combinational
//  simulator never modifies state.

TYPES.DFF = {
  w: 80, h: 60,
  pins: {
    d:   { side: 'left',  dx: 0,  dy: 18, kind: 'in' },
    clk: { side: 'left',  dx: 0,  dy: 44, kind: 'in' },
    q:   { side: 'right', dx: 80, dy: 30, kind: 'out' },
  },
  defaults: () => ({ q: 0, clkPrev: 0 }),
  eval: (c) => ({ q: c.state.q }),
  latch: (c, vIn) => {
    const clk = vIn.clk ?? 0;
    if (c.state.clkPrev !== 1 && clk === 1) {
      c.state.q = vIn.d ?? c.state.q;
    }
    c.state.clkPrev = clk;
  },
  isSequential: true,
  draw: drawDFF,
};

// ---- 3-trit register ------------------------------------------------------
//
//  Three D flip-flops sharing one clock, plus a load-enable line.  On the
//  rising edge of clk (clkPrev !== 1 && clk === 1) the register samples
//  d0..d2 — but ONLY when the load-enable pin ld is +1.  When ld is 0, T,
//  or floating the register holds its current contents through the edge.
//
//  Internal state: q (array of three stored trits, q0..q2), clkPrev (last
//  clk value seen).  This is the smallest Phase-6 memory element; a wider
//  ternary RAM block and the CPU register file are built from it.

TYPES.REG3 = {
  w: 104, h: 120,
  pins: {
    d0:  { side: 'left',  dx: 0,   dy: 24,  kind: 'in' },
    d1:  { side: 'left',  dx: 0,   dy: 42,  kind: 'in' },
    d2:  { side: 'left',  dx: 0,   dy: 60,  kind: 'in' },
    clk: { side: 'left',  dx: 0,   dy: 84,  kind: 'in' },
    ld:  { side: 'left',  dx: 0,   dy: 102, kind: 'in' },
    q0:  { side: 'right', dx: 104, dy: 24,  kind: 'out' },
    q1:  { side: 'right', dx: 104, dy: 42,  kind: 'out' },
    q2:  { side: 'right', dx: 104, dy: 60,  kind: 'out' },
  },
  defaults: () => ({ q: [0, 0, 0], clkPrev: 0 }),
  eval: (c) => ({ q0: c.state.q[0], q1: c.state.q[1], q2: c.state.q[2] }),
  latch: (c, vIn) => {
    const clk = vIn.clk ?? 0;
    if (c.state.clkPrev !== 1 && clk === 1) {
      // Rising edge.  Load only when the enable line is asserted (+1);
      // hold the stored trits on 0, T, or a floating ld.
      if ((vIn.ld ?? 0) === 1) {
        c.state.q = [
          vIn.d0 ?? c.state.q[0],
          vIn.d1 ?? c.state.q[1],
          vIn.d2 ?? c.state.q[2],
        ];
      }
    }
    c.state.clkPrev = clk;
  },
  isSequential: true,
  draw: drawReg,
};

// ---- Ternary RAM block ----------------------------------------------------
//
//  A small addressable memory: nine words of three trits each — the array of
//  trit registers Phase 6 (memory) calls for.  Conceptually nine REG3s that
//  share a clock, with an address decoder picking which one a write lands in.
//
//  The two address trits a0,a1 form a balanced-ternary number in the range
//  -4..+4, decoded to a word index 0..8:
//
//    word index = (a0 + 1) + (a1 + 1) * 3
//
//  Reads are asynchronous: q0..q2 always show the word currently selected by
//  the address pins.  Writes are synchronous: on the rising edge of clk (the
//  same edge rule as DFF/REG3) the addressed word is overwritten with d0..d2
//  — but ONLY when the write-enable pin we is +1.  A null on either address
//  trit selects no word: the outputs read null and a write is suppressed.
//
//  Internal state: mem (nine 3-trit arrays), clkPrev (last clk value seen).

const RAM_WORDS = 9;   // 3^2 — two address trits

function ramAddr(a0, a1) {
  // Balanced-ternary address decode → word index 0..8, or null when either
  // address trit is floating.
  if (a0 == null || a1 == null) return null;
  return (a0 + 1) + (a1 + 1) * 3;
}

TYPES.RAM = {
  w: 132, h: 162,
  pins: {
    a0:  { side: 'left',  dx: 0,   dy: 22,  kind: 'in' },
    a1:  { side: 'left',  dx: 0,   dy: 40,  kind: 'in' },
    d0:  { side: 'left',  dx: 0,   dy: 64,  kind: 'in' },
    d1:  { side: 'left',  dx: 0,   dy: 82,  kind: 'in' },
    d2:  { side: 'left',  dx: 0,   dy: 100, kind: 'in' },
    we:  { side: 'left',  dx: 0,   dy: 124, kind: 'in' },
    clk: { side: 'left',  dx: 0,   dy: 142, kind: 'in' },
    q0:  { side: 'right', dx: 132, dy: 22,  kind: 'out' },
    q1:  { side: 'right', dx: 132, dy: 40,  kind: 'out' },
    q2:  { side: 'right', dx: 132, dy: 58,  kind: 'out' },
  },
  defaults: () => ({
    mem: Array.from({ length: RAM_WORDS }, () => [0, 0, 0]),
    clkPrev: 0,
  }),
  eval: (c, v) => {
    const idx = ramAddr(v.a0, v.a1);
    if (idx == null) return { q0: null, q1: null, q2: null };
    const w = c.state.mem[idx];
    return { q0: w[0], q1: w[1], q2: w[2] };
  },
  latch: (c, vIn) => {
    const clk = vIn.clk ?? 0;
    if (c.state.clkPrev !== 1 && clk === 1) {
      // Rising edge — commit a write only when write-enable is asserted (+1)
      // and the address selects a real word.
      if ((vIn.we ?? 0) === 1) {
        const idx = ramAddr(vIn.a0, vIn.a1);
        if (idx != null) {
          const w = c.state.mem[idx];
          c.state.mem[idx] = [
            vIn.d0 ?? w[0],
            vIn.d1 ?? w[1],
            vIn.d2 ?? w[2],
          ];
        }
      }
    }
    c.state.clkPrev = clk;
  },
  isSequential: true,
  draw: drawRAM,
};

// ---- ALU ------------------------------------------------------------------
//
//  The compute core of the Phase 7 CPU.  Combinational (no state): two
//  3-trit word operands a0..a2 and b0..b2, plus a one-trit operation
//  select op, produce a 3-trit result r0..r2 and a carry-out cout.
//
//    op = T  → MIN   per-trit min(a, b),  cout = 0
//    op = 0  → ADD   a + b ripple-carried, cout = carry off the top trit
//    op = +1 → MAX   per-trit max(a, b),  cout = 0
//
//  ADD ripples a full-trit add (the same ADDER_TABLE the ADDER component
//  uses) low trit to high.  The true sum is value(r0..r2) + cout * 27.
//  A null on op or on any operand trit yields an all-null result.

TYPES.ALU = {
  w: 120, h: 162,
  pins: {
    a0: { side: 'left',  dx: 0,   dy: 22,  kind: 'in' },
    a1: { side: 'left',  dx: 0,   dy: 40,  kind: 'in' },
    a2: { side: 'left',  dx: 0,   dy: 58,  kind: 'in' },
    b0: { side: 'left',  dx: 0,   dy: 82,  kind: 'in' },
    b1: { side: 'left',  dx: 0,   dy: 100, kind: 'in' },
    b2: { side: 'left',  dx: 0,   dy: 118, kind: 'in' },
    op: { side: 'left',  dx: 0,   dy: 142, kind: 'in' },
    r0: { side: 'right', dx: 120, dy: 22,  kind: 'out' },
    r1: { side: 'right', dx: 120, dy: 40,  kind: 'out' },
    r2: { side: 'right', dx: 120, dy: 58,  kind: 'out' },
    cout: { side: 'right', dx: 120, dy: 82, kind: 'out' },
  },
  defaults: () => ({}),
  eval: (_, v) => {
    const NULL = { r0: null, r1: null, r2: null, cout: null };
    const a = [v.a0, v.a1, v.a2], b = [v.b0, v.b1, v.b2];
    if (v.op == null || a.some(t => t == null) || b.some(t => t == null)) return NULL;
    if (v.op === 0) {
      // ADD — ripple a full-trit add from the low trit to the high.
      let cin = 0; const r = [];
      for (let i = 0; i < 3; i++) {
        const s = ADDER_TABLE[String(a[i] + b[i] + cin)];
        r.push(s.sum); cin = s.cout;
      }
      return { r0: r[0], r1: r[1], r2: r[2], cout: cin };
    }
    // op = T → MIN, op = +1 → MAX.  No carry for the logic ops.
    const f = v.op === -1 ? Math.min : Math.max;
    return { r0: f(a[0], b[0]), r1: f(a[1], b[1]), r2: f(a[2], b[2]), cout: 0 };
  },
  draw: drawALU,
};

// ---- Program counter ------------------------------------------------------
//
//  A 2-trit program counter — the instruction-address register of the
//  Phase 7 CPU.  Holds a balanced-ternary address in the range −4..+4,
//  which is RAM word index 0..8.  On each rising clock edge it either
//  jumps or advances:
//
//    jmp = +1             → load the target address from j0, j1
//    jmp = 0, T, floating → increment, wrapping word 8 back to word 0
//
//  Outputs p0, p1 are the current address — wire them straight into a RAM
//  block's a0, a1.  Internal state: p (two trits, low first), clkPrev.

TYPES.PC = {
  w: 96, h: 108,
  pins: {
    clk: { side: 'left',  dx: 0,  dy: 24, kind: 'in' },
    jmp: { side: 'left',  dx: 0,  dy: 44, kind: 'in' },
    j0:  { side: 'left',  dx: 0,  dy: 68, kind: 'in' },
    j1:  { side: 'left',  dx: 0,  dy: 86, kind: 'in' },
    p0:  { side: 'right', dx: 96, dy: 24, kind: 'out' },
    p1:  { side: 'right', dx: 96, dy: 44, kind: 'out' },
  },
  defaults: () => ({ p: [-1, -1], clkPrev: 0 }),   // starts at word 0
  eval: (c) => ({ p0: c.state.p[0], p1: c.state.p[1] }),
  latch: (c, vIn) => {
    const clk = vIn.clk ?? 0;
    if (c.state.clkPrev !== 1 && clk === 1) {
      if ((vIn.jmp ?? 0) === 1) {
        // Jump — load the target address from j0, j1.
        c.state.p = [vIn.j0 ?? c.state.p[0], vIn.j1 ?? c.state.p[1]];
      } else {
        // Advance.  intToTrits truncates to 2 trits, so word 8 wraps to 0.
        c.state.p = intToTrits(tritsToInt(c.state.p) + 1, 2);
      }
    }
    c.state.clkPrev = clk;
  },
  isSequential: true,
  draw: drawPC,
};

// ============================================================================
//  WORLD STATE
// ============================================================================

let comps = [];     // { id, type, x, y, state, subScope? }
let wires = [];     // { id, fromId, fromPort, toId, toPort }
let nextCompId = 1, nextWireId = 1;
let outVals = {};

let subcircuitDefs = {};   // name -> { inputs:[{name}], outputs:[{name}], comps, wires, nextCompId, nextWireId }

let view = { tx: 40, ty: 40, scale: 1 };
let tick = 0;
let autoPlay = null;

// Tool / interaction state
let tool = 'select';
let placeType = null;
let mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, spaceDown: false };
let drag = null;             // { kind:'comp'|'pan'|'rect', startX, startY, ... }
let rmbDelete = true;        // right-click deletes the comp/wire under the cursor
let pendingWire = null;
let hoverPin = null;
let selection = new Set();   // Set of component IDs
let selectedWire = null;
let lastClickPos = null;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const statusEl = document.getElementById('status');
const selInfo = document.getElementById('sel-info');
const waveCv = document.getElementById('wave-cv');
const waveCtx = waveCv.getContext('2d');

function resize() {
  cv.width = cv.parentElement.clientWidth;
  cv.height = cv.parentElement.clientHeight;
  waveCv.width = waveCv.parentElement.clientWidth;
  waveCv.height = waveCv.parentElement.clientHeight - 28;
  draw();
  drawWaves();
}
window.addEventListener('resize', resize);

// ============================================================================
//  HIT-TESTING & COORDINATES
// ============================================================================

function screenToWorld(sx, sy) {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}
function snap(v, g = 10) { return Math.round(v / g) * g; }

// Map for O(1) component lookup.  Kept in sync via syncCompMap() at each
// place that mutates the comps array; getComp falls back to a full rebuild
// if it detects the map and array have drifted.
let compById = new Map();
function syncCompMap() { compById = new Map(comps.map(c => [c.id, c])); }
function getComp(id) {
  if (compById.size !== comps.length) syncCompMap();
  return compById.get(id);
}

function compDef(c) {
  if (c.type.startsWith('SUB:'))  return subInstanceDef(c);
  if (c.type.startsWith('GATE:')) return customGateDef(c);
  const t = TYPES[c.type];
  if (!t) return unknownTypeDef(c);
  return t;
}
function unknownTypeDef(c) {
  // Defensive fallback for save files containing types this build doesn't
  // know about (e.g. a forward-compatible save).  Returns a draw-only block
  // with no pins so the simulator skips it; renders as a red "?" box so
  // the user can see which component is the problem.
  return {
    w: 80, h: 60, pins: {}, defaults: () => ({}), eval: () => ({}),
    draw: () => {
      ctx.fillStyle = '#3a2226'; ctx.fillRect(0, 0, 80, 60);
      ctx.strokeStyle = '#e35555'; ctx.strokeRect(0.5, 0.5, 79, 59);
      ctx.fillStyle = '#e35555';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?' + (c.type.length > 7 ? c.type.slice(0, 6) + '…' : c.type), 40, 30);
    },
  };
}

function pinAbsPos(comp, portName) {
  const def = compDef(comp);
  const p = def.pins[portName];
  return { x: comp.x + p.dx, y: comp.y + p.dy, side: p.side, kind: p.kind };
}

function hitTestComp(wx, wy) {
  for (let i = comps.length - 1; i >= 0; i--) {
    const c = comps[i];
    const def = compDef(c);
    if (wx >= c.x && wx <= c.x + def.w && wy >= c.y && wy <= c.y + def.h) return c;
  }
  return null;
}
function hitTestPin(wx, wy, tol = 7) {
  for (const c of comps) {
    const def = compDef(c);
    for (const port in def.pins) {
      const p = pinAbsPos(c, port);
      const dx = wx - p.x, dy = wy - p.y;
      if (dx * dx + dy * dy <= tol * tol) {
        return { comp: c, port, kind: p.kind, x: p.x, y: p.y };
      }
    }
  }
  return null;
}
function hitTestWire(wx, wy, tol = 5) {
  for (let i = wires.length - 1; i >= 0; i--) {
    const w = wires[i];
    const path = wirePath(w);
    for (let j = 0; j < path.length - 1; j++) {
      if (pointSegmentDist(wx, wy, path[j].x, path[j].y, path[j+1].x, path[j+1].y) <= tol) {
        return w;
      }
    }
  }
  return null;
}
function pointSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

// ============================================================================
//  WIRE ROUTING
// ============================================================================
//
//  We build a simple orthogonal path with the elbow positioned at the midpoint
//  along the dominant axis.  This avoids the worst case where a wire would
//  pass straight through a gate when source and destination are roughly
//  vertically aligned.

// Axis-aligned segment vs box overlap.  Strict on the perpendicular axis
// so a segment exactly along a component's edge doesn't count as a hit —
// otherwise pin stubs would always self-flag.
function segHitsBox(x1, y1, x2, y2, bx, by, bw, bh) {
  if (y1 === y2) {
    if (y1 <= by || y1 >= by + bh) return false;
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    return !(hi <= bx || lo >= bx + bw);
  }
  if (x1 === x2) {
    if (x1 <= bx || x1 >= bx + bw) return false;
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return !(hi <= by || lo >= by + bh);
  }
  return false; // wires here are always axis-aligned
}
function pathCrossesObstacle(path, exclude) {
  for (const c of comps) {
    if (exclude.has(c.id)) continue;
    const def = compDef(c);
    for (let i = 0; i < path.length - 1; i++) {
      if (segHitsBox(path[i].x, path[i].y, path[i+1].x, path[i+1].y,
                     c.x, c.y, def.w, def.h)) return true;
    }
  }
  return false;
}

// A* obstacle-aware router on a coarse grid.  Replaces the previous
// "try a handful of L-shape elbows" heuristic, which broke down in dense
// layouts.  Cells overlapping a non-endpoint component are blocked; the
// search returns a path that's guaranteed not to cross any component.

// Minimal binary min-heap so A*'s open-set extraction is O(log n) rather
// than O(n).  Items are { key, priority } pairs.
class _MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    this.a.push(item);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].priority > this.a[i].priority) {
        [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
        i = p;
      } else break;
    }
  }
  pop() {
    if (this.a.length === 0) return undefined;
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0, n = this.a.length;
      while (true) {
        const l = 2*i + 1, r = 2*i + 2;
        let m = i;
        if (l < n && this.a[l].priority < this.a[m].priority) m = l;
        if (r < n && this.a[r].priority < this.a[m].priority) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
}

function _aStarRoute(sgx, sgy, egx, egy, obstacles, bounds, occupied, mySourceKey) {
  const startKey = sgx + ',' + sgy;
  const endKey   = egx + ',' + egy;
  if (startKey === endKey) return [{ gx: sgx, gy: sgy }];

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const cameDir  = new Map();   // for turn-penalty
  const open = new _MinHeap();
  open.push({ key: startKey, priority: Math.abs(egx - sgx) + Math.abs(egy - sgy) });
  const closed = new Set();
  let iter = 0;
  const MAX_ITER = 20000;

  while (open.size && iter++ < MAX_ITER) {
    const cur = open.pop();
    if (closed.has(cur.key)) continue;
    if (cur.key === endKey) {
      // Reconstruct
      const cells = [cur.key];
      let k = cur.key;
      while (cameFrom.has(k)) { k = cameFrom.get(k); cells.unshift(k); }
      return cells.map(s => {
        const [gx, gy] = s.split(',').map(Number);
        return { gx, gy };
      });
    }
    closed.add(cur.key);
    const [cx, cy] = cur.key.split(',').map(Number);
    const prevDir = cameDir.get(cur.key);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < bounds.minGx || nx > bounds.maxGx ||
          ny < bounds.minGy || ny > bounds.maxGy) continue;
      const nKey = nx + ',' + ny;
      if (closed.has(nKey) || obstacles.has(nKey)) continue;
      const dirKey = dx + ',' + dy;
      const turnCost = (prevDir && prevDir !== dirKey) ? 0.4 : 0;
      // Occupancy penalty: if another wire (with a different source pin)
      // already runs through this cell, prefer to route around it.  Cost
      // is high but finite so A* will go through in worst cases rather
      // than fail to find a path entirely.  Same-source (fan-out) wires
      // pay no penalty since their signals are identical.
      let occCost = 0;
      if (occupied) {
        const occ = occupied.get(nKey);
        if (occ && occ !== mySourceKey) occCost = 30;
      }
      const tentG = (gScore.get(cur.key) ?? Infinity) + 1 + turnCost + occCost;
      if (tentG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, cur.key);
        cameDir.set(nKey, dirKey);
        gScore.set(nKey, tentG);
        const f = tentG + Math.abs(egx - nx) + Math.abs(egy - ny);
        open.push({ key: nKey, priority: f });
      }
    }
  }
  return null;
}

function _simplifyOrthoPath(p) {
  if (p.length < 3) return p;
  const out = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = p[i], next = p[i + 1];
    const d1x = Math.sign(cur.x - prev.x), d1y = Math.sign(cur.y - prev.y);
    const d2x = Math.sign(next.x - cur.x), d2y = Math.sign(next.y - cur.y);
    if (d1x === d2x && d1y === d2y) continue;   // collinear continuation
    out.push(cur);
  }
  out.push(p[p.length - 1]);
  return out;
}

// Per-draw cache so the many callers (drawWire, drawWireGhost,
// computeWireCrossings, fanoutPins, hitTestWire) don't each re-run A*.
let _pathCache = new Map();
// Per-cell occupancy: gridKey -> sourceKey ('fromId:fromPort').  Wires
// route in id order; each one marks its cells so subsequent wires with a
// DIFFERENT source pin steer around them (rather than overlapping
// longitudinally).  Same-source wires (fan-out) are free to share cells
// since their carried signal is identical.
let _wireOccupied = new Map();
function invalidatePathCache() { _pathCache.clear(); _wireOccupied.clear(); }

function wirePath(w) {
  if (_pathCache.has(w.id)) return _pathCache.get(w.id);
  const a = pinAbsPos(getComp(w.fromId), w.fromPort);
  const b = pinAbsPos(getComp(w.toId), w.toPort);
  const G = 10, stub = 12;
  const aStubX = a.x + stub;
  const bStubX = b.x - stub;

  // Stub-end grid coordinates.  Snap Y to nearest grid line so A* works
  // on whole-cell steps; we patch the real pin Y back in at the ends.
  const sgx = Math.round(aStubX / G);
  const sgy = Math.round(a.y    / G);
  const egx = Math.round(bStubX / G);
  const egy = Math.round(b.y    / G);
  // Bounding box for the search — extend around both endpoints with
  // generous margin so the router has room to detour.
  const minX = Math.min(sgx, egx) - 30;
  const maxX = Math.max(sgx, egx) + 30;
  const minY = Math.min(sgy, egy) - 30;
  const maxY = Math.max(sgy, egy) + 30;
  const bounds = { minGx: minX, maxGx: maxX, minGy: minY, maxGy: maxY };

  // Build obstacle set.  ALL components — including this wire's own source
  // and destination — are obstacles, with a 2-cell padding so wires keep
  // visible breathing room and don't touch component edges.  Without
  // including the destination, A* would route the shortest path straight
  // through the destination's body to reach its pin.
  //
  // The padding would also block the wire-approach corridor at each pin,
  // so we then carve a 3-cell corridor at each endpoint pointing in the
  // direction the pin faces ("left"-side pins carve leftward, etc.).
  const padding = 2;
  const obstacles = new Set();
  for (const c of comps) {
    const def = compDef(c);
    const x0 = Math.floor(c.x / G) - padding, x1 = Math.ceil((c.x + def.w) / G) + padding;
    const y0 = Math.floor(c.y / G) - padding, y1 = Math.ceil((c.y + def.h) / G) + padding;
    for (let gy = y0; gy < y1; gy++)
      for (let gx = x0; gx < x1; gx++)
        obstacles.add(gx + ',' + gy);
  }
  // Pin-approach corridor: from stub-end cell, walk OUTWARD (away from
  // the component centre, in the direction the pin faces) and clear those
  // cells from obstacles so A* can enter / leave the padded zone.
  const carveCorridor = (side, gx, gy) => {
    const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const dy = side === 'top'  ? -1 : side === 'bottom' ? 1 : 0;
    for (let i = 0; i <= padding; i++) {
      obstacles.delete((gx + dx * i) + ',' + (gy + dy * i));
    }
  };
  carveCorridor(a.side, sgx, sgy);
  carveCorridor(b.side, egx, egy);

  const sourceKey = w.fromId + ':' + w.fromPort;
  const gridPath = _aStarRoute(sgx, sgy, egx, egy, obstacles, bounds,
                               _wireOccupied, sourceKey);

  let path;
  if (gridPath) {
    // Mark every cell along the routed path with this wire's source key so
    // later wires (different source) get pushed onto alternate routes.
    for (const cell of gridPath) {
      const k = cell.gx + ',' + cell.gy;
      if (!_wireOccupied.has(k)) _wireOccupied.set(k, sourceKey);
    }
    const cellsToPoints = gridPath.map(p => ({ x: p.gx * G, y: p.gy * G }));
    const body = _simplifyOrthoPath(cellsToPoints);
    // Assemble: pin → stub-end (at real pin Y) → vertical to grid Y →
    // A*-routed body → vertical to real pin Y → stub-end → pin.
    path = [{ x: a.x, y: a.y }, { x: aStubX, y: a.y }];
    if (a.y !== sgy * G) path.push({ x: aStubX, y: sgy * G });
    for (let i = 1; i < body.length - 1; i++) path.push(body[i]);
    if (b.y !== egy * G) path.push({ x: bStubX, y: egy * G });
    path.push({ x: bStubX, y: b.y });
    path.push({ x: b.x, y: b.y });
    path = _simplifyOrthoPath(path);
  } else {
    // No A* solution.  Defensive fallback to a centred L-shape.  This
    // shouldn't normally happen with the wide bounding box; if it does
    // the ghost-overlay pass will still surface the wire.
    const ax = a.x + stub, bx = b.x - stub;
    const baseX = Math.round((ax + bx) / 2);
    path = [
      { x: a.x, y: a.y }, { x: ax, y: a.y },
      { x: baseX, y: a.y }, { x: baseX, y: b.y },
      { x: bx, y: b.y }, { x: b.x, y: b.y },
    ];
  }
  _pathCache.set(w.id, path);
  return path;
}

// Junction dots: at any output pin with fan-out > 1, draw a dot.
function fanoutPins() {
  const count = {};
  for (const w of wires) {
    const key = `${w.fromId}:${w.fromPort}`;
    count[key] = (count[key] || 0) + 1;
  }
  return Object.entries(count).filter(([_,n]) => n > 1).map(([k]) => k);
}

// ============================================================================
//  SIMULATION
// ============================================================================
//
//  Two phases.  Phase A is purely combinational: iterate components,
//  recomputing each output from its inputs, until nothing changes.  Phase B
//  ("step") is the sequential edge-triggered update, executed only when the
//  user clicks Step or auto-play fires.  After Phase B we re-run Phase A.

function inputValueFromWires(scope, compId, portName) {
  const w = scope.wires.find(w => w.toId === compId && w.toPort === portName);
  if (!w) return null;
  return scope.outVals[`${w.fromId}:${w.fromPort}`] ?? null;
}

function simulateScope(scope) {
  // Initialize: combinational outputs to null, sequential outputs to current
  // state.  This means a DFF participates correctly as a source of its
  // stored q.
  for (const c of scope.comps) {
    const def = compDef(c);
    for (const port in def.pins) {
      if (def.pins[port].kind === 'out') {
        const key = `${c.id}:${port}`;
        if (scope.outVals[key] === undefined) scope.outVals[key] = null;
      }
    }
  }
  let stable = false, iters = 0;
  const maxIters = 300;
  while (!stable && iters < maxIters) {
    stable = true; iters++;
    for (const c of scope.comps) {
      const def = compDef(c);
      const vIn = {};
      for (const port in def.pins) {
        if (def.pins[port].kind === 'in') vIn[port] = inputValueFromWires(scope, c.id, port);
      }
      let vOut;
      try {
        if (c.type.startsWith('SUB:')) vOut = simulateSubInstance(c, vIn);
        else vOut = def.eval(c, vIn) || {};
      } catch (err) {
        // Don't let a single buggy eval take down the whole fixed-point
        // iteration.  Outputs go to null so downstream gates see a clean
        // "floating" signal, and we increment a counter the UI can show.
        scope._evalErrors = (scope._evalErrors || 0) + 1;
        if (!scope._evalLogged) {
          scope._evalLogged = true;
          console.warn(`eval error in ${c.type} #${c.id}:`, err);
        }
        vOut = {};
        for (const port in def.pins) {
          if (def.pins[port].kind === 'out') vOut[port] = null;
        }
      }
      for (const port in vOut) {
        const key = `${c.id}:${port}`;
        if (scope.outVals[key] !== vOut[port]) {
          scope.outVals[key] = vOut[port];
          stable = false;
        }
      }
    }
  }
  scope.lastIters = iters;
  scope.stable = stable;
  return { iters, stable };
}

function simulate() {
  const root = { comps, wires, outVals };
  const { iters, stable } = simulateScope(root);
  outVals = root.outVals;
  // Count floating (undriven) input pins.  Cheap O(C·W) scan; acceptable
  // for circuits of the size this tool is meant for.
  let floating = 0;
  for (const c of comps) {
    const def = compDef(c);
    for (const port in def.pins) {
      if (def.pins[port].kind === 'in' &&
          !wires.some(w => w.toId === c.id && w.toPort === port)) {
        floating++;
      }
    }
  }
  document.getElementById('stat-comp').textContent = comps.length;
  document.getElementById('stat-wires').textContent = wires.length;
  document.getElementById('stat-iter').textContent = iters;
  document.getElementById('stat-stable').textContent = stable ? 'yes' : 'no (oscillating)';
  document.getElementById('stat-tick').textContent = tick;
  const floatEl = document.getElementById('stat-floating');
  floatEl.textContent = floating;
  // Tint the number amber when there's anything to warn about.
  floatEl.style.color = floating > 0 ? '#e3a55a' : '';
  // Eval-error count from the per-component try/catch in simulateScope.
  const errs = root._evalErrors || 0;
  const errEl = document.getElementById('stat-errors');
  if (errEl) {
    errEl.textContent = errs;
    errEl.style.color = errs > 0 ? '#e35555' : '';
  }
}

function stepSequential() {
  // A correct synchronous step is FOUR phases, not one:
  //
  //   1. Tick every CLOCK (they are autonomous oscillators with no inputs).
  //   2. Re-settle combinational logic so flip-flops can SEE the new clock
  //      level on their clk pin.
  //   3. Latch every flip-flop / sequential element using its inputs as they
  //      stand now — this is the rising-edge sample point.
  //   4. Re-settle combinational logic so any q output that just changed
  //      propagates before we record waveforms.
  //
  //  Then record WAVE probes against the final post-settle values.
  function tickClocks(scope) {
    for (const c of scope.comps) {
      if (c.type === 'CLOCK') {
        const mode = c.state.mode || 'tri';
        if (mode === 'bi') {
          c.state.value = (c.state.value === 1) ? -1 : 1;
        } else {
          // Tri-state cycle: T(-1) → 0 → +1 → T → ...
          c.state.value = (c.state.value === -1) ? 0
                        : (c.state.value === 0)  ? 1
                        : -1;
        }
      } else if (c.type.startsWith('SUB:') && c.subScope) {
        tickClocks(c.subScope);
      }
    }
  }
  function latchFlops(scope) {
    for (const c of scope.comps) {
      if (c.type === 'CLOCK') continue;
      if (c.type.startsWith('SUB:')) {
        if (c.subScope) latchFlops(c.subScope);
      } else {
        const def = TYPES[c.type];
        if (def && def.isSequential && def.latch) {
          const vIn = {};
          for (const port in def.pins) {
            if (def.pins[port].kind === 'in') {
              vIn[port] = inputValueFromWires(scope, c.id, port);
            }
          }
          def.latch(c, vIn);
        }
      }
    }
  }
  function recordWaves(scope) {
    for (const c of scope.comps) {
      if (c.type === 'WAVE') {
        const v = inputValueFromWires(scope, c.id, 'in');
        c.state.trace.push(v ?? null);
        if (c.state.trace.length > 256) c.state.trace.shift();
      } else if (c.type.startsWith('SUB:') && c.subScope) {
        recordWaves(c.subScope);
      }
    }
  }

  // NB: the scope MUST include outVals or inputValueFromWires will throw
  // (it does `scope.outVals[key]`).  Build a fresh scope before each helper
  // so a reassignment of the global `outVals` (e.g. from Reset) doesn't
  // leave us holding a stale reference.
  tickClocks({ comps });                       // doesn't touch wires/outVals
  simulate();                                  // phase 2 settle
  latchFlops({ comps, wires, outVals });
  simulate();                                  // phase 4 settle
  recordWaves({ comps, wires, outVals });
  tick++;
  document.getElementById('stat-tick').textContent = tick;
  drawWaves();
  draw();
  if (typeof refreshDebugger === 'function') refreshDebugger();
}

// ============================================================================
//  SUBCIRCUITS
// ============================================================================
//
//  A subcircuit definition is stored in `subcircuitDefs[name]`.  When a
//  subcircuit instance is placed, we deep-clone the definition's internal
//  comps and wires into `c.subScope`, so each instance has independent
//  flip-flop state and waveform traces.
//
//  The instance's outward-facing pin layout is derived from the input/output
//  components inside, ordered by their y coordinate at pack time.

function subInstanceDef(c) {
  // Build a TYPES-like def on the fly from the instance's definition.
  const defName = c.type.slice(4);
  const def = subcircuitDefs[defName];
  if (!def) {
    return { w: 80, h: 60, pins: {}, defaults: () => ({}), eval: () => ({}),
             draw: (cc) => drawSubMissing(cc, defName) };
  }
  const pins = {};
  def.inputs.forEach((p, i) => {
    pins[p.name] = { side: 'left', dx: 0, dy: 20 + i * 18, kind: 'in' };
  });
  def.outputs.forEach((p, i) => {
    pins[p.name] = { side: 'right', dx: 96, dy: 20 + i * 18, kind: 'out' };
  });
  const h = Math.max(48, 20 + Math.max(def.inputs.length, def.outputs.length) * 18);
  return {
    w: 96, h,
    pins,
    defaults: () => ({}),
    eval: () => ({}),  // unused — simulator special-cases SUB: types
    draw: (cc) => drawSubInstance(cc, defName, def),
  };
}

// Module-level counter so a runaway recursion (subcircuit cycle) doesn't
// blow the JS stack with a confusing trace — we bail at a sensible depth.
let _subDepth = 0;
function simulateSubInstance(instance, vIn) {
  const def = subcircuitDefs[instance.type.slice(4)];
  if (!def) return {};
  if (_subDepth > 32) {
    // Cycle detected (or just very deep nesting).  Return floating outputs
    // and log once — the validator should have caught this at load time.
    if (!simulateSubInstance._warned) {
      simulateSubInstance._warned = true;
      console.warn(`subcircuit recursion exceeded depth 32 at instance #${instance.id} (${instance.type}); aborting this branch`);
    }
    const out = {};
    for (const p of def.outputs) out[p.name] = null;
    return out;
  }
  if (!instance.subScope) instance.subScope = cloneSubScope(def);
  // Push inputs
  for (const p of def.inputs) {
    const v = vIn[p.name];
    const ic = instance.subScope.comps.find(
      c => c.type === 'INPUT' && (c.state.name || '') === p.name);
    if (ic) ic.state.value = (v == null) ? 0 : v;
  }
  _subDepth++;
  try { simulateScope(instance.subScope); }
  finally { _subDepth--; }
  // Pull outputs
  const out = {};
  for (const p of def.outputs) {
    const oc = instance.subScope.comps.find(
      c => c.type === 'OUTPUT' && (c.state.name || '') === p.name);
    if (oc) {
      const wire = instance.subScope.wires.find(w => w.toId === oc.id && w.toPort === 'in');
      out[p.name] = wire ? (instance.subScope.outVals[`${wire.fromId}:${wire.fromPort}`] ?? null) : null;
    }
  }
  return out;
}

function cloneSubScope(def) {
  const scope = {
    comps: deepClone(def.comps),
    wires: deepClone(def.wires),
    outVals: {},
  };
  // Seed every output to 0 instead of letting it default to null. Cross-
  // coupled feedback (TLATCH, TFLOP, ...) cannot bootstrap from null —
  // MIN/MAX/STI all propagate null, so a feedback wire that starts null
  // can never become anything else. Seeding to 0 gives the fixed-point
  // solver a defined starting point; combinational subs reach the same
  // settled values either way.
  for (const c of scope.comps) {
    const d = compDef(c);
    if (!d || !d.pins) continue;
    for (const port in d.pins) {
      if (d.pins[port].kind === 'out') scope.outVals[`${c.id}:${port}`] = 0;
    }
  }
  return scope;
}

// Pack the currently-selected components into a new subcircuit.
function packSelection(name, pinRenames) {
  const sel = Array.from(selection);
  if (sel.length === 0) return;
  pushHistory();
  const inSelComps = sel.map(getComp).filter(Boolean);
  const ids = new Set(inSelComps.map(c => c.id));
  const inSelWires = wires.filter(w => ids.has(w.fromId) && ids.has(w.toId));

  // Find external connections — wires that cross the selection boundary.
  // These need to be re-routed to the new subcircuit instance.
  const inboundWires  = wires.filter(w => !ids.has(w.fromId) && ids.has(w.toId));
  const outboundWires = wires.filter(w => ids.has(w.fromId) && !ids.has(w.toId));

  // Refuse to pack if any crossing wire bypasses an INPUT/OUTPUT boundary.
  // Otherwise those wires would silently disappear because the new
  // subcircuit instance has no pin to attach them to.
  const inputIds  = new Set(inSelComps.filter(c => c.type === 'INPUT').map(c => c.id));
  const outputIds = new Set(inSelComps.filter(c => c.type === 'OUTPUT').map(c => c.id));
  const badIn  = inboundWires.filter(w => !inputIds.has(w.toId));
  const badOut = outboundWires.filter(w => !outputIds.has(w.fromId));
  if (badIn.length || badOut.length) {
    const detail = [
      ...badIn.map(w  => `into #${w.toId}.${w.toPort}`),
      ...badOut.map(w => `out of #${w.fromId}.${w.fromPort}`),
    ].slice(0, 6).join(', ');
    alert(
      `${badIn.length + badOut.length} wire(s) cross the selection boundary but ` +
      `do not enter via an INPUT or leave via an OUTPUT component:\n\n  ${detail}` +
      (badIn.length + badOut.length > 6 ? '\n  …' : '') +
      `\n\nAdd INPUT/OUTPUT pseudocomponents on those boundary wires, ` +
      `or delete the wires, then try Pack again.`
    );
    return;
  }

  // Inputs/outputs of the subcircuit are the INPUT and OUTPUT components
  // already in the selection.  Sort top-to-bottom for stable pin order.
  const inputs = inSelComps
    .filter(c => c.type === 'INPUT')
    .sort((a, b) => a.y - b.y)
    .map((c, i) => ({ name: pinRenames?.['in_' + c.id] || c.state.name || `in${i}`, srcId: c.id }));
  const outputs = inSelComps
    .filter(c => c.type === 'OUTPUT')
    .sort((a, b) => a.y - b.y)
    .map((c, i) => ({ name: pinRenames?.['out_' + c.id] || c.state.name || `out${i}`, srcId: c.id }));

  if (inputs.length === 0 && outputs.length === 0) {
    alert('Selection must contain at least one INPUT or OUTPUT component to define pins.');
    return;
  }
  // De-duplicate pin names so two INPUTs (or two OUTPUTs) named "a" don't
  // both collapse to a single pin in the resulting subcircuit.  The first
  // occurrence keeps its name; subsequent duplicates get an "_2", "_3" suffix.
  function dedupePins(arr, kind) {
    const seen = new Set();
    const renamed = [];
    for (const p of arr) {
      const original = p.name;
      let name = original;
      let i = 1;
      while (seen.has(name)) { i++; name = `${original}_${i}`; }
      if (name !== original) renamed.push(`${kind} "${original}" → "${name}"`);
      p.name = name;
      seen.add(name);
    }
    return renamed;
  }
  const renamedIns  = dedupePins(inputs,  'input');
  const renamedOuts = dedupePins(outputs, 'output');
  if (renamedIns.length || renamedOuts.length) {
    setStatus(`Renamed duplicates: ${[...renamedIns, ...renamedOuts].join(', ')}`);
  }

  // Build def with renamed INPUTs/OUTPUTs so eval can locate them.
  const compsCopy = JSON.parse(JSON.stringify(inSelComps));
  for (const c of compsCopy) {
    const inp = inputs.find(p => p.srcId === c.id);
    const oup = outputs.find(p => p.srcId === c.id);
    if (inp) c.state.name = inp.name;
    if (oup) c.state.name = oup.name;
  }
  const wiresCopy = JSON.parse(JSON.stringify(inSelWires));
  subcircuitDefs[name] = {
    inputs: inputs.map(p => ({ name: p.name })),
    outputs: outputs.map(p => ({ name: p.name })),
    comps: compsCopy,
    wires: wiresCopy,
  };

  // Replace selection in the main canvas with a single subcircuit instance.
  const bbox = boundingBox(inSelComps);
  const instance = {
    id: nextCompId++,
    type: 'SUB:' + name,
    x: snap(bbox.x),
    y: snap(bbox.y),
    state: {},
  };
  comps = comps.filter(c => !ids.has(c.id));
  wires = wires.filter(w => !ids.has(w.fromId) && !ids.has(w.toId));
  comps.push(instance); syncCompMap();

  // Re-route external wires.  Inbound (... → input) become wires from the
  // external source to the instance's matching input pin.  Outbound similarly.
  for (const w of inboundWires) {
    const target = inSelComps.find(c => c.id === w.toId);
    const inputPin = inputs.find(p => p.srcId === target.id);
    if (inputPin) {
      wires.push({ id: nextWireId++, fromId: w.fromId, fromPort: w.fromPort,
                   toId: instance.id, toPort: inputPin.name });
    }
  }
  for (const w of outboundWires) {
    const source = inSelComps.find(c => c.id === w.fromId);
    const outputPin = outputs.find(p => p.srcId === source.id);
    if (outputPin) {
      wires.push({ id: nextWireId++, fromId: instance.id, fromPort: outputPin.name,
                   toId: w.toId, toPort: w.toPort });
    }
  }

  selection.clear(); selectedWire = null;
  refreshSubLib();
  simulate(); draw();
  setStatus(`Packed ${inSelComps.length} components into subcircuit "${name}"`);
}

function boundingBox(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of items) {
    const def = compDef(c);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + def.w);
    maxY = Math.max(maxY, c.y + def.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// True for the subcircuits this build ships with — see BUILTIN_SUBCIRCUITS,
// defined further down. The library panel uses this to group them under
// their kit headings and to protect them from deletion.
function isBuiltinSubcircuit(name) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_SUBCIRCUITS, name);
}

// Delete a subcircuit definition. Built-ins are protected — only
// user-created subcircuits can be removed.
function deleteSubcircuit(name) {
  if (isBuiltinSubcircuit(name)) {
    setStatus(`"${name}" is a built-in subcircuit and cannot be deleted`);
    return;
  }
  if (!confirm(`Delete subcircuit "${name}"? Existing instances will become broken.`)) return;
  delete subcircuitDefs[name];
  if (placeType === 'SUB:' + name) setTool('select');
  refreshSubLib();
  simulate(); draw();
}

// "Edit on canvas" — load a subcircuit's inner circuit (the components and
// wires it was packed from) onto the main canvas, so it can be inspected or
// modified and then re-packed. Replaces the current canvas contents.
function editSubcircuit(name) {
  const def = subcircuitDefs[name];
  if (!def) return;
  if (!confirm(`Load the internals of "${name}" onto the canvas for editing?\n\n` +
               `This replaces the current circuit. When done, select the parts ` +
               `and press Pack ▢ to save them back as a subcircuit.`)) return;
  comps = deepClone(def.comps);
  wires = deepClone(def.wires);
  syncCompMap();
  nextCompId = comps.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  nextWireId = wires.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  view = { tx: 40, ty: 40, scale: 1 };
  selection.clear(); selectedWire = null; tick = 0; outVals = {};
  setTool('select');
  simulate(); drawWaves(); draw(); updateInspector();
  setStatus(`Editing "${name}" — its INPUT / OUTPUT components are the block's pins`);
}

function refreshSubLib() {
  const lib = document.getElementById('sub-lib');
  lib.innerHTML = '';
  const ICON = '<div class="icon" style="width:24px;height:18px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:1px solid var(--border);border-radius:3px;background:#1a1d23;font-size:10px;">⌬</div>';

  function addHeading(text) {
    const h = document.createElement('div');
    h.className = 'sub-cat';
    h.textContent = text;
    lib.appendChild(h);
  }
  function addEntry(name, deletable) {
    const def = subcircuitDefs[name];
    const el = document.createElement('div');
    el.className = 'sub-entry';
    el.title = 'Click to place · middle-click (scroll-wheel press) to edit on canvas';
    el.innerHTML = ICON +
      `<div>${escapeHtml(name)}</div>` +
      `<span class="pin-counts">${def.inputs.length}→${def.outputs.length}</span>` +
      (deletable ? `<button data-del="${escapeHtml(name)}" title="Delete subcircuit">✕</button>` : '');
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') { deleteSubcircuit(e.target.dataset.del); return; }
      setTool('place', 'SUB:' + name);
    });
    // Middle-click (the scroll-wheel button) edits the subcircuit on the
    // canvas. The mousedown handler suppresses the browser's middle-click
    // autoscroll so the gesture is free; auxclick is the actual trigger.
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); editSubcircuit(name); }
    });
    // Right-click is the canvas's delete gesture — keep the browser's native
    // menu from popping up on a library entry, but do nothing else with it.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    lib.appendChild(el);
  }

  // Built-in subcircuits, grouped by kit; then any user-created ones.
  for (const kit of BUILTIN_SUBCIRCUIT_KITS) {
    const inKit = kit.names.filter(n => subcircuitDefs[n]);
    if (!inKit.length) continue;
    addHeading(kit.label);
    for (const name of inKit) addEntry(name, false);
  }
  addHeading('Your subcircuits');
  const user = Object.keys(subcircuitDefs).filter(n => !isBuiltinSubcircuit(n));
  if (user.length) {
    for (const name of user) addEntry(name, true);
  } else {
    const hint = document.createElement('div');
    hint.className = 'sub-hint';
    hint.textContent = 'None yet — select components and press Pack ▢.';
    lib.appendChild(hint);
  }
  if (typeof filterPalette === 'function') filterPalette();
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ============================================================================
//  CUSTOM GATES (Gate Builder)
// ============================================================================
//
//  A custom gate is a behavioural component defined by a truth table.  The
//  user fills in the 3^n output cells in a modal; we store the resulting
//  function as { numInputs, table } where `table` is a plain object keyed
//  by the comma-joined input trits (e.g. "-1,1") to the output trit.
//
//  Custom gates are instantiated like any built-in component; their `type`
//  string is "GATE:<name>".  compDef() routes them to customGateDef() which
//  synthesises a TYPES-like def on the fly.

let customGates = {};   // name -> { numInputs, table }

// Generate every input combination for n inputs in {-1,0,1}^n, in a stable
// order so the UI and the storage agree.  Returns an array of arrays.
function enumerateInputs(n) {
  const result = [];
  const vals = [-1, 0, 1];
  function recur(prefix) {
    if (prefix.length === n) { result.push(prefix.slice()); return; }
    for (const v of vals) { prefix.push(v); recur(prefix); prefix.pop(); }
  }
  recur([]);
  return result;
}
function inputKey(arr) { return arr.join(','); }

function customGateDef(c) {
  const name = c.type.slice(5);
  const def = customGates[name];
  if (!def) {
    return { w: 80, h: 60, pins: {}, defaults: () => ({}), eval: () => ({}),
             draw: (cc) => drawCustomGateMissing(cc, name) };
  }
  const pins = {};
  for (let i = 0; i < def.numInputs; i++) {
    pins['in' + i] = { side: 'left', dx: 0, dy: 18 + i * 18, kind: 'in' };
  }
  const outY = Math.max(20, (16 + def.numInputs * 18) / 2);
  pins.out = { side: 'right', dx: 80, dy: outY, kind: 'out' };
  const h = Math.max(40, 16 + def.numInputs * 18);
  return {
    w: 80, h,
    pins,
    defaults: () => ({}),
    eval: (_, v) => {
      const parts = [];
      for (let i = 0; i < def.numInputs; i++) {
        if (v['in' + i] == null) return { out: null };
        parts.push(v['in' + i]);
      }
      const key = parts.join(',');
      const r = def.table[key];
      return { out: (r === undefined ? 0 : r) };
    },
    draw: (cc) => drawCustomGate(cc, name, def),
  };
}

function drawCustomGate(c, name, def) {
  // Geometry is the same as customGateDef; compute inline rather than
  // re-entering compDef from inside a draw call.
  const w = 80;
  const h = Math.max(40, 16 + def.numInputs * 18);
  const outDy = Math.max(20, (16 + def.numInputs * 18) / 2);
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e3a55a';                // amber border = custom gate
  ctx.lineWidth = 1.5 / view.scale;
  ctx.strokeRect(0.5, 0.5, w-1, h-1);
  ctx.fillStyle = '#d8dde6';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shown = name.length > 9 ? name.slice(0, 8) + '…' : name;
  ctx.fillText(shown, w / 2, h / 2);
  ctx.font = '8px monospace';
  ctx.fillStyle = '#8a92a1';
  ctx.textAlign = 'left';
  for (let i = 0; i < def.numInputs; i++) {
    ctx.fillText('in' + i, 4, 18 + i * 18);
  }
  ctx.textAlign = 'right';
  ctx.fillText('out', w - 4, outDy);
}
function drawCustomGateMissing(c, name) {
  ctx.fillStyle = '#3a2226'; ctx.fillRect(0, 0, 80, 60);
  ctx.strokeStyle = '#e35555'; ctx.strokeRect(0.5, 0.5, 79, 59);
  ctx.fillStyle = '#e35555'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!' + name, 40, 30);
}

// ---- modal ----------------------------------------------------------------

// Working state for the modal (the table being edited).  Stored separately
// from `customGates` so that closing without saving discards changes.
let gbDraft = { numInputs: 2, table: {} };

function renderGateTable() {
  const host = document.getElementById('gate-table');
  host.innerHTML = '';
  const n = gbDraft.numInputs;

  function cellEl(key) {
    const v = gbDraft.table[key] ?? 0;
    const el = document.createElement('div');
    el.className = 'gb-cell ' + (v === -1 ? 'trit-T' : v === 1 ? 'trit-P' : 'trit-0');
    el.textContent = tritLabel(v);
    el.addEventListener('click', () => {
      const cur = gbDraft.table[key] ?? 0;
      gbDraft.table[key] = cur === -1 ? 0 : cur === 0 ? 1 : -1;
      renderGateTable();
    });
    return el;
  }

  if (n === 1) {
    const block = document.createElement('div');
    block.className = 'gb-block';
    const h = document.createElement('h4');
    h.textContent = 'out = f(in0)';
    block.appendChild(h);
    const row = document.createElement('div');
    row.className = 'gb-row';
    row.style.gap = '8px';
    for (const v of [-1, 0, 1]) {
      const wrap = document.createElement('div');
      wrap.style.textAlign = 'center';
      const lbl = document.createElement('div');
      lbl.className = 'gb-axis';
      lbl.style.textAlign = 'center';
      lbl.textContent = `in0=${tritLabel(v)}`;
      wrap.appendChild(lbl);
      wrap.appendChild(cellEl(inputKey([v])));
      row.appendChild(wrap);
    }
    block.appendChild(row);
    host.appendChild(block);
    return;
  }

  if (n === 2) {
    const block = document.createElement('div');
    block.className = 'gb-block';
    const h = document.createElement('h4');
    h.textContent = 'rows = in0 (a), columns = in1 (b)';
    block.appendChild(h);
    // Header row
    const header = document.createElement('div');
    header.className = 'gb-row';
    header.appendChild(Object.assign(document.createElement('div'), { className: 'gb-corner' }));
    for (const b of [-1, 0, 1]) {
      const lab = document.createElement('div');
      lab.className = 'gb-axis';
      lab.textContent = `b=${tritLabel(b)}`;
      header.appendChild(lab);
    }
    block.appendChild(header);
    for (const a of [-1, 0, 1]) {
      const row = document.createElement('div');
      row.className = 'gb-row';
      const lab = document.createElement('div');
      lab.className = 'gb-axis';
      lab.textContent = `a=${tritLabel(a)}`;
      row.appendChild(lab);
      for (const b of [-1, 0, 1]) row.appendChild(cellEl(inputKey([a, b])));
      block.appendChild(row);
    }
    host.appendChild(block);
    return;
  }

  if (n === 3) {
    // Show three 3×3 grids, one per cin value.
    for (const c of [-1, 0, 1]) {
      const block = document.createElement('div');
      block.className = 'gb-block';
      const h = document.createElement('h4');
      h.textContent = `cin = ${tritLabel(c)}    (rows = a, cols = b)`;
      block.appendChild(h);
      const header = document.createElement('div');
      header.className = 'gb-row';
      header.appendChild(Object.assign(document.createElement('div'), { className: 'gb-corner' }));
      for (const b of [-1, 0, 1]) {
        const lab = document.createElement('div');
        lab.className = 'gb-axis';
        lab.textContent = `b=${tritLabel(b)}`;
        header.appendChild(lab);
      }
      block.appendChild(header);
      for (const a of [-1, 0, 1]) {
        const row = document.createElement('div');
        row.className = 'gb-row';
        const lab = document.createElement('div');
        lab.className = 'gb-axis';
        lab.textContent = `a=${tritLabel(a)}`;
        row.appendChild(lab);
        for (const b of [-1, 0, 1]) row.appendChild(cellEl(inputKey([a, b, c])));
        block.appendChild(row);
      }
      host.appendChild(block);
    }
  }
}

function openGateBuilder() {
  // Reset draft.  Default to a 2-input, all-zero gate.
  gbDraft = { numInputs: parseInt(document.getElementById('gate-inputs').value, 10), table: {} };
  document.getElementById('gate-name').value = 'MyGate' + (Object.keys(customGates).length + 1);
  document.getElementById('gate-status').textContent = '';
  renderGateTable();
  openModal('gate-modal');
}

document.getElementById('btn-gate').addEventListener('click', openGateBuilder);
document.getElementById('gate-close').addEventListener('click', () => closeModal('gate-modal'));
document.getElementById('gate-inputs').addEventListener('change', (e) => {
  gbDraft.numInputs = parseInt(e.target.value, 10);
  gbDraft.table = {};   // wipe — old table doesn't map onto new arity
  renderGateTable();
});
document.getElementById('gate-clear-table').addEventListener('click', () => {
  gbDraft.table = {};
  renderGateTable();
});
document.getElementById('gate-add').addEventListener('click', () => {
  const name = document.getElementById('gate-name').value.trim();
  if (!name) { document.getElementById('gate-status').textContent = 'name required'; return; }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    document.getElementById('gate-status').textContent = 'name must start with a letter, then letters/digits/_';
    return;
  }
  if (TYPES.hasOwnProperty(name)) {
    document.getElementById('gate-status').textContent =
      `name "${name}" shadows a built-in component type; choose another name`;
    return;
  }
  if (customGates[name]) {
    if (!confirm(`Overwrite existing gate "${name}"?`)) return;
  }
  // Fill any missing cells with 0 so the table is total.
  const table = {};
  for (const combo of enumerateInputs(gbDraft.numInputs)) {
    const k = inputKey(combo);
    table[k] = gbDraft.table[k] ?? 0;
  }
  customGates[name] = { numInputs: gbDraft.numInputs, table };
  refreshGateLib();
  closeModal('gate-modal');
  setStatus(`gate "${name}" added (${gbDraft.numInputs}-input)`);
});

function refreshGateLib() {
  const lib = document.getElementById('gate-lib');
  lib.innerHTML = '';
  const names = Object.keys(customGates);
  if (names.length === 0) {
    lib.innerHTML = `<div style="color: var(--muted); font-size: 11px; padding: 4px 2px;">
      Click <b>Build Gate</b> in the header to define one.</div>`;
    return;
  }
  for (const name of names) {
    const def = customGates[name];
    const el = document.createElement('div');
    el.className = 'sub-entry';
    el.style.borderColor = '#e3a55a33';
    el.innerHTML = `<div class="icon" style="width:24px;height:18px;
        display:flex;align-items:center;justify-content:center;
        border:1px solid var(--border);border-radius:3px;background:#1a1d23;font-size:10px;color:#e3a55a">▦</div>
      <div>${escapeHtml(name)}</div>
      <span class="pin-counts">${def.numInputs}→1</span>
      <button data-del="${escapeHtml(name)}" title="Delete gate">✕</button>`;
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        const n = e.target.dataset.del;
        if (confirm(`Delete custom gate "${n}"? Existing instances will become broken.`)) {
          delete customGates[n];
          // If the deleted gate was the active place tool, fall back to select.
          if (placeType === 'GATE:' + n) setTool('select');
          refreshGateLib();
          simulate(); draw();    // outVals for deleted instances must be reset
        }
        return;
      }
      setTool('place', 'GATE:' + name);
    });
    lib.appendChild(el);
  }
  if (typeof filterPalette === 'function') filterPalette();
}

// ============================================================================
//  DRAWING
// ============================================================================

function draw() {
  invalidatePathCache();
  // Pre-route every wire in id order so that occupancy buildup is
  // deterministic and the same regardless of which caller hits wirePath()
  // first later in the frame.
  const _orderedWires = [...wires].sort((a, b) => a.id - b.id);
  for (const _w of _orderedWires) wirePath(_w);
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  drawGrid();
  // Pre-compute wire crossings so drawWire() can render arc jumps where
  // perpendicular wires meet without connecting.
  computeWireCrossings();
  // Wires go UNDER components in the normal case so a wire passing
  // alongside a gate doesn't visibly overlap the gate's labels.
  for (const w of wires) drawWire(w);
  if (pendingWire) drawPendingWire();
  for (const c of comps) drawComp(c);
  // X-ray pass: for any wire segment that the obstacle-aware router
  // couldn't avoid (i.e. it actually does pass through a non-endpoint
  // component), redraw just that segment as a thin overlay on top.  This
  // keeps the wire visible in fallback-routing cases without making every
  // wire sit on top of every component.
  for (const w of wires) drawWireGhost(w);
  // Junction dots
  ctx.fillStyle = '#d8dde6';
  for (const key of fanoutPins()) {
    const [id, port] = key.split(':');
    const c = getComp(parseInt(id, 10));
    if (!c) continue;
    const p = pinAbsPos(c, port);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Selection rectangle (during drag)
  if (drag && drag.kind === 'rect') {
    ctx.save();
    ctx.strokeStyle = '#6ea8ff';
    ctx.fillStyle = 'rgba(110, 168, 255, 0.08)';
    ctx.lineWidth = 1 / view.scale;
    ctx.setLineDash([4, 3]);
    const x0 = Math.min(drag.x0, mouse.wx), y0 = Math.min(drag.y0, mouse.wy);
    const w0 = Math.abs(mouse.wx - drag.x0), h0 = Math.abs(mouse.wy - drag.y0);
    ctx.fillRect(x0, y0, w0, h0);
    ctx.strokeRect(x0, y0, w0, h0);
    ctx.restore();
  }
  // Highlight selection
  for (const id of selection) {
    const c = getComp(id);
    if (!c) continue;
    const def = compDef(c);
    ctx.save();
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 2 / view.scale;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(c.x - 4, c.y - 4, def.w + 8, def.h + 8);
    ctx.restore();
  }
  if (hoverPin) {
    ctx.beginPath();
    ctx.arc(hoverPin.x, hoverPin.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 1.5 / view.scale;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrid() {
  const g = 10;
  const w0 = screenToWorld(0, 0), w1 = screenToWorld(cv.width, cv.height);
  const x0 = Math.floor(w0.x / g) * g, y0 = Math.floor(w0.y / g) * g;
  ctx.strokeStyle = '#1f232b';
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let x = x0; x < w1.x; x += g) { ctx.moveTo(x, w0.y); ctx.lineTo(x, w1.y); }
  for (let y = y0; y < w1.y; y += g) { ctx.moveTo(w0.x, y); ctx.lineTo(w1.x, y); }
  ctx.stroke();
}

function drawComp(c) {
  const def = compDef(c);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.lineWidth = 1.5 / view.scale;
  ctx.fillStyle = '#262a32';
  ctx.strokeStyle = '#525a6b';
  def.draw(c);
  ctx.restore();

  // Pins.  An input pin with no incoming wire is visually distinct from one
  // that's driven-but-floating (i.e. the upstream gate is producing null) —
  // we draw the former as a hollow amber ring, the latter as a normal dot
  // in the "undef" colour.  This separates "I forgot to wire this" from
  // "this is null because of cascading uncertainty."
  for (const port in def.pins) {
    const p = pinAbsPos(c, port);
    const isOut = def.pins[port].kind === 'out';
    if (!isOut) {
      const driven = wires.some(w => w.toId === c.id && w.toPort === port);
      if (!driven) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#e3a55a';   // amber
        ctx.lineWidth = 1.5 / view.scale;
        ctx.stroke();
        continue;
      }
    }
    const v = isOut ? outVals[`${c.id}:${port}`] : inputValueFromWires({comps, wires, outVals}, c.id, port);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = tritColor(v);
    ctx.fill();
  }
}

function drawInput(c) {
  const t = TYPES.INPUT;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  ctx.fillStyle = tritColor(c.state.value); ctx.fillRect(8, 8, t.w-16, t.h-16);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tritLabel(c.state.value), t.w/2, t.h/2);
  if (c.state.name) {
    ctx.font = '9px monospace'; ctx.fillStyle = '#8a92a1';
    ctx.fillText(c.state.name, t.w/2, -8);
  }
}
function drawConst(c) {
  const t = TYPES.CONST;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  ctx.fillStyle = tritColor(c.state.value);
  ctx.fillRect(4, 4, t.w-8, t.h-8);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tritLabel(c.state.value), t.w/2, t.h/2);
}
function drawTryteIn(c) {
  const t = TYPES.TRYTE_IN;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  const trits = intToTrits(c.state.value, 6);
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    const y = 18 + i * 14;
    ctx.fillStyle = tritColor(trits[i]);
    ctx.fillRect(8, y - 5, 18, 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(tritLabel(trits[i]), 17, y);
  }
  ctx.fillStyle = '#d8dde6';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(String(c.state.value), 32, 12);
}
function drawClock(c) {
  const t = TYPES.CLOCK;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Three rails for the three states; the current level is highlighted in
  // the matching trit colour.
  const Y = { '1': 12, '0': 20, '-1': 28 };
  ctx.strokeStyle = '#2c3038';
  ctx.lineWidth = 1 / view.scale;
  for (const k of ['1','0','-1']) {
    ctx.beginPath(); ctx.moveTo(6, Y[k]); ctx.lineTo(42, Y[k]); ctx.stroke();
  }
  const y = Y[String(c.state.value)] ?? 20;
  ctx.fillStyle = tritColor(c.state.value);
  ctx.fillRect(6, y - 2, 36, 4);
  ctx.fillStyle = '#d8dde6';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('CLK', 4, 2);
  ctx.textAlign = 'right';
  ctx.font = '9px monospace';
  ctx.fillStyle = '#8a92a1';
  ctx.fillText((c.state.mode || 'tri'), t.w - 4, 2);
}
function drawOutput(c) {
  const t = TYPES.OUTPUT;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  const v = inputValueFromWires({comps, wires, outVals}, c.id, 'in');
  ctx.beginPath(); ctx.arc(t.w/2, t.h/2, 11, 0, Math.PI*2);
  ctx.fillStyle = tritColor(v); ctx.fill();
  ctx.strokeStyle = '#11141a'; ctx.lineWidth = 2 / view.scale; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tritLabel(v), t.w/2, t.h/2);
  if (c.state.name) {
    ctx.font = '9px monospace'; ctx.fillStyle = '#8a92a1';
    ctx.fillText(c.state.name, t.w/2, -8);
  }
}
function drawTryteOut(c) {
  const t = TYPES.TRYTE_OUT;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Read 6 inputs, display decoded
  const trits = [];
  for (let i = 0; i < 6; i++) {
    const v = inputValueFromWires({comps, wires, outVals}, c.id, 't' + i);
    trits.push(v ?? null);
  }
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    const y = 18 + i * 14;
    ctx.fillStyle = tritColor(trits[i]);
    ctx.fillRect(28, y - 5, 18, 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(tritLabel(trits[i]), 37, y);
  }
  ctx.fillStyle = '#d8dde6';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  if (!trits.includes(null)) {
    ctx.fillText(String(tritsToInt(trits)), 52, t.h/2);
  } else {
    ctx.fillText('—', 56, t.h/2);
  }
}
function drawWave(c) {
  const t = TYPES.WAVE;
  ctx.fillStyle = '#1d2026'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Tiny waveform preview inside the component
  ctx.strokeStyle = '#6ea8ff';
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  const trace = c.state.trace || [];
  const cells = 12;
  for (let i = 0; i < cells; i++) {
    const v = trace[Math.max(0, trace.length - cells + i)] ?? 0;
    const x = 8 + i * 3.5;
    const y = 20 - v * 8;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#d8dde6';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('WAVE', 4, 2);
}
function drawInverterShape(c, label) {
  const t = TYPES.STI;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(t.w - 12, t.h / 2); ctx.lineTo(0, t.h); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(t.w - 6, t.h/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#262a32'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, (t.w-12)/2, t.h/2);
}
function drawBinaryShape(c, label) {
  const t = TYPES.MIN;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(14, t.h/2, 0, t.h);
  ctx.lineTo(t.w-14, t.h);
  ctx.quadraticCurveTo(t.w+2, t.h/2, t.w-14, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, t.w/2 - 6, t.h/2);
}
function drawAdder(c) {
  const t = TYPES.ADDER;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('+', t.w/2, t.h/2);
  ctx.font = '9px monospace'; ctx.fillStyle = '#8a92a1';
  ctx.textAlign = 'left';
  ctx.fillText('a', 4, 18); ctx.fillText('b', 4, 44); ctx.fillText('cin', 4, 70);
  ctx.textAlign = 'right';
  ctx.fillText('sum', t.w-4, 26); ctx.fillText('cout', t.w-4, 62);
}
function drawDFF(c) {
  const t = TYPES.DFF;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Stored value display
  ctx.fillStyle = tritColor(c.state.q);
  ctx.fillRect(t.w/2 - 10, t.h/2 - 10, 20, 20);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tritLabel(c.state.q), t.w/2, t.h/2);
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('D', 4, 18); ctx.fillText('CLK', 4, 44);
  ctx.textAlign = 'right';
  ctx.fillText('Q', t.w-4, 30);
  // clock triangle marker
  ctx.beginPath();
  ctx.moveTo(2, 40); ctx.lineTo(10, 44); ctx.lineTo(2, 48); ctx.closePath();
  ctx.strokeStyle = '#525a6b'; ctx.stroke();
}
function drawReg(c) {
  const t = TYPES.REG3;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Title
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('REG3', t.w/2, 4);
  // Three stored trits as colour cells, q0 on top down to q2.
  const q = c.state.q || [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const cy = 24 + i * 18;
    ctx.fillStyle = tritColor(q[i]);
    ctx.fillRect(t.w/2 - 9, cy - 8, 18, 16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tritLabel(q[i]), t.w/2, cy);
  }
  // Pin labels
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('D0', 4, 24); ctx.fillText('D1', 4, 42); ctx.fillText('D2', 4, 60);
  ctx.fillText('CLK', 4, 84); ctx.fillText('LD', 4, 102);
  ctx.textAlign = 'right';
  ctx.fillText('Q0', t.w-4, 24); ctx.fillText('Q1', t.w-4, 42); ctx.fillText('Q2', t.w-4, 60);
  // clock-edge triangle marker next to the CLK pin
  ctx.beginPath();
  ctx.moveTo(2, 80); ctx.lineTo(10, 84); ctx.lineTo(2, 88); ctx.closePath();
  ctx.strokeStyle = '#525a6b'; ctx.stroke();
}
function drawRAM(c) {
  const t = TYPES.RAM;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Title
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('RAM', t.w/2, 4);
  // Live memory map: nine words top-to-bottom, three trit cells per word.
  const mem = c.state.mem || [];
  const cw = 11, ch = 11, gx = 1, gy = 2;
  const gridW = 3 * cw + 2 * gx;
  const x0 = (t.w - gridW) / 2, y0 = 20;
  for (let word = 0; word < RAM_WORDS; word++) {
    const wv = mem[word] || [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = tritColor(wv[i]);
      ctx.fillRect(x0 + i * (cw + gx), y0 + word * (ch + gy), cw, ch);
    }
  }
  // Pin labels
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('A0', 4, 22); ctx.fillText('A1', 4, 40);
  ctx.fillText('D0', 4, 64); ctx.fillText('D1', 4, 82); ctx.fillText('D2', 4, 100);
  ctx.fillText('WE', 4, 124); ctx.fillText('CLK', 4, 142);
  ctx.textAlign = 'right';
  ctx.fillText('Q0', t.w-4, 22); ctx.fillText('Q1', t.w-4, 40); ctx.fillText('Q2', t.w-4, 58);
  // clock-edge triangle marker next to the CLK pin
  ctx.beginPath();
  ctx.moveTo(2, 138); ctx.lineTo(10, 142); ctx.lineTo(2, 146); ctx.closePath();
  ctx.strokeStyle = '#525a6b'; ctx.stroke();
}
function drawALU(c) {
  const t = TYPES.ALU;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Centre label
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ALU', t.w/2, t.h/2 - 6);
  ctx.fillStyle = '#8a92a1'; ctx.font = '8px monospace';
  ctx.fillText('op T:MIN', t.w/2, t.h/2 + 8);
  ctx.fillText('0:ADD +:MAX', t.w/2, t.h/2 + 18);
  // Pin labels
  ctx.font = '9px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('A0', 4, 22); ctx.fillText('A1', 4, 40); ctx.fillText('A2', 4, 58);
  ctx.fillText('B0', 4, 82); ctx.fillText('B1', 4, 100); ctx.fillText('B2', 4, 118);
  ctx.fillText('OP', 4, 142);
  ctx.textAlign = 'right';
  ctx.fillText('R0', t.w-4, 22); ctx.fillText('R1', t.w-4, 40); ctx.fillText('R2', t.w-4, 58);
  ctx.fillText('C', t.w-4, 82);
}
function drawMUX(c) {
  const t = TYPES.MUX;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('MUX', t.w/2, t.h/2);
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('S', 4, 20);
  ctx.fillText('dT', 4, 44); ctx.fillText('d0', 4, 62); ctx.fillText('dP', 4, 80);
  ctx.textAlign = 'right';
  ctx.fillText('OUT', t.w-4, 50);
}
function drawPC(c) {
  const t = TYPES.PC;
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('PC', t.w/2, 5);
  // Current address shown as a RAM word index 0..8.
  const p = c.state.p || [0, 0];
  ctx.fillStyle = '#8effb0'; ctx.font = 'bold 24px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(tritsToInt(p) + 4), t.w/2, t.h/2 + 6);
  // Pin labels
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace'; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('CLK', 4, 24); ctx.fillText('JMP', 4, 44);
  ctx.fillText('J0', 4, 68);  ctx.fillText('J1', 4, 86);
  ctx.textAlign = 'right';
  ctx.fillText('P0', t.w-4, 24); ctx.fillText('P1', t.w-4, 44);
  // clock-edge triangle marker next to the CLK pin
  ctx.beginPath();
  ctx.moveTo(2, 20); ctx.lineTo(10, 24); ctx.lineTo(2, 28); ctx.closePath();
  ctx.strokeStyle = '#525a6b'; ctx.stroke();
}
function drawSubInstance(c, name, def) {
  const cdef = compDef(c);
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, cdef.w, cdef.h);
  ctx.strokeStyle = '#8effb0'; ctx.lineWidth = 2 / view.scale;
  ctx.strokeRect(0.5, 0.5, cdef.w-1, cdef.h-1);
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, cdef.w/2, cdef.h/2);
  ctx.font = '8px monospace'; ctx.fillStyle = '#8a92a1';
  def.inputs.forEach((p, i) => {
    ctx.textAlign = 'left'; ctx.fillText(p.name, 4, 20 + i*18);
  });
  def.outputs.forEach((p, i) => {
    ctx.textAlign = 'right'; ctx.fillText(p.name, cdef.w-4, 20 + i*18);
  });
}
function drawSubMissing(c, name) {
  ctx.fillStyle = '#3a2226'; ctx.fillRect(0, 0, 80, 60);
  ctx.strokeStyle = '#e35555'; ctx.strokeRect(0.5, 0.5, 79, 59);
  ctx.fillStyle = '#e35555'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!' + name, 40, 30);
}

// Per-wire list of crossing points where this wire (horizontal segment)
// passes over another wire (vertical segment).  Recomputed once per draw
// frame in draw() — O(W^2 * S^2) where S is the small segments-per-wire
// (5–6) so it's fine for everyday circuit sizes.
let _wireCrossings = new Map();
function computeWireCrossings() {
  _wireCrossings = new Map();
  // Cache paths so we don't recompute wirePath() for each pair.
  const paths = wires.map(w => wirePath(w));
  for (let i = 0; i < wires.length; i++) {
    const pA = paths[i];
    for (let j = i + 1; j < wires.length; j++) {
      const pB = paths[j];
      for (let si = 1; si < pA.length; si++) {
        const a1 = pA[si-1], a2 = pA[si];
        const aH = (a1.y === a2.y && a1.x !== a2.x);
        const aV = (a1.x === a2.x && a1.y !== a2.y);
        if (!aH && !aV) continue;
        for (let sj = 1; sj < pB.length; sj++) {
          const b1 = pB[sj-1], b2 = pB[sj];
          const bH = (b1.y === b2.y && b1.x !== b2.x);
          const bV = (b1.x === b2.x && b1.y !== b2.y);
          if (!bH && !bV) continue;
          if (aH === bH) continue;  // parallel, no crossing
          const h = aH ? { p1: a1, p2: a2, id: wires[i].id } : { p1: b1, p2: b2, id: wires[j].id };
          const v = aH ? { p1: b1, p2: b2 }                  : { p1: a1, p2: a2 };
          const cx = v.p1.x, cy = h.p1.y;
          const hLo = Math.min(h.p1.x, h.p2.x), hHi = Math.max(h.p1.x, h.p2.x);
          const vLo = Math.min(v.p1.y, v.p2.y), vHi = Math.max(v.p1.y, v.p2.y);
          // Strict interior intersection — avoids flagging pin endpoints
          // and segment elbows as crossings.
          if (cx > hLo + 1 && cx < hHi - 1 && cy > vLo + 1 && cy < vHi - 1) {
            const list = _wireCrossings.get(h.id);
            if (list) list.push({ x: cx, y: cy });
            else _wireCrossings.set(h.id, [{ x: cx, y: cy }]);
          }
        }
      }
    }
  }
}

function drawWire(w) {
  const path = wirePath(w);
  const v = outVals[`${w.fromId}:${w.fromPort}`] ?? null;
  ctx.strokeStyle = tritColor(v);
  ctx.lineWidth = (selectedWire === w.id ? 3 : 2) / view.scale;
  // Live wires get a dashed pattern whose offset advances each animation
  // tick, producing a slow "marching ants" toward the destination.
  // Floating wires stay solid — visually flagging the dead segment.
  const animated = (v != null);
  if (animated) {
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -animTime % 10;
  } else {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  // Pull the crossings list for this wire (horizontal-segment crossings
  // only — by convention horizontal wires hump over vertical wires).
  const crossings = _wireCrossings.get(w.id) || [];
  const jumpR = 5;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    const p1 = path[i-1], p2 = path[i];
    if (p1.y === p2.y && p1.x !== p2.x) {
      // Horizontal segment.  Find any crossings that fall strictly inside
      // it, sorted in the direction of travel, and render line→arc→line.
      const dir = p1.x < p2.x ? 1 : -1;
      const segCrossings = crossings
        .filter(c => Math.abs(c.y - p1.y) < 0.5 &&
                     c.x > Math.min(p1.x, p2.x) + jumpR &&
                     c.x < Math.max(p1.x, p2.x) - jumpR)
        .sort((a, b) => dir * (a.x - b.x));
      for (const c of segCrossings) {
        ctx.lineTo(c.x - dir * jumpR, p1.y);
        // Arc the line UP (negative y) over the crossing.
        if (dir > 0) ctx.arc(c.x, p1.y, jumpR, Math.PI, 0, true);
        else         ctx.arc(c.x, p1.y, jumpR, 0, Math.PI, true);
      }
      ctx.lineTo(p2.x, p2.y);
    } else {
      // Vertical (or degenerate) segment — just draw straight.  The
      // perpendicular horizontal wire is the one that humps over us.
      ctx.lineTo(p2.x, p2.y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);  // reset state for other shapes
}
function drawWireGhost(w) {
  // Overlay wire segments that pass through a non-endpoint component, so
  // the wire isn't fully invisible when the router couldn't route around.
  // 1 px width, partial alpha — visible but subordinate to the main wire
  // beneath, so the canvas doesn't get visually busy.
  const path = wirePath(w);
  const v = outVals[`${w.fromId}:${w.fromPort}`] ?? null;
  const exclude = new Set([w.fromId, w.toId]);
  ctx.strokeStyle = tritColor(v);
  ctx.lineWidth = 1 / view.scale;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([]);
  for (let i = 1; i < path.length; i++) {
    const p1 = path[i-1], p2 = path[i];
    let hits = false;
    for (const c of comps) {
      if (exclude.has(c.id)) continue;
      const def = compDef(c);
      if (segHitsBox(p1.x, p1.y, p2.x, p2.y, c.x, c.y, def.w, def.h)) { hits = true; break; }
    }
    if (hits) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPendingWire() {
  ctx.save();
  ctx.strokeStyle = '#6ea8ff';
  ctx.setLineDash([4,4]);
  ctx.lineWidth = 1.5 / view.scale;
  ctx.beginPath();
  ctx.moveTo(pendingWire.fromXY.x, pendingWire.fromXY.y);
  const mid = (pendingWire.fromXY.x + mouse.wx) / 2;
  ctx.lineTo(mid, pendingWire.fromXY.y);
  ctx.lineTo(mid, mouse.wy);
  ctx.lineTo(mouse.wx, mouse.wy);
  ctx.stroke();
  ctx.restore();
}

// ---- Waveform panel -------------------------------------------------------
// Mouse-tracked tick column in the waveform panel.  When the user hovers
// over a probe row, _waveCursorTick holds the tick index nearest the
// cursor; drawWaves uses it to draw a vertical guide and value labels.
let _waveCursorTick = -1;
let _waveCursorX = -1;
function drawWaves() {
  if (!document.body.classList.contains('wave-open')) return;
  const c = waveCv, x = waveCtx;
  const cssBg = getComputedStyle(document.body).getPropertyValue('--panel') || '#1d2026';
  x.fillStyle = cssBg.trim() || '#1d2026'; x.fillRect(0, 0, c.width, c.height);
  // Collect WAVE probes (including those inside subcircuit instances)
  const probes = [];
  function gather(scope, prefix) {
    for (const cc of scope.comps) {
      if (cc.type === 'WAVE') {
        probes.push({ name: prefix + (cc.state.name || `wave${cc.id}`), trace: cc.state.trace || [] });
      } else if (cc.type.startsWith('SUB:') && cc.subScope) {
        gather(cc.subScope, prefix + cc.type.slice(4) + '/');
      }
    }
  }
  gather({comps}, '');
  if (probes.length === 0) {
    x.fillStyle = '#8a92a1'; x.font = '12px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Place WAVE components and step the clock to record traces.', c.width/2, c.height/2);
    return;
  }
  const labelW = 80;
  const plotW = c.width - labelW - 12;
  const rowH = Math.min(40, (c.height - 8) / probes.length);
  // Tick-number ruler at the very top (a thin row above the probes).
  if (probes.length > 0 && probes[0].trace.length > 1) {
    x.strokeStyle = '#2c3038';
    x.fillStyle = '#8a92a1';
    x.font = '9px monospace';
    x.textAlign = 'center';
    x.textBaseline = 'top';
    const trace0 = probes[0].trace;
    const dx0 = (c.width - labelW - 12) / Math.max(1, trace0.length - 1);
    const baseTick = Math.max(0, tick - trace0.length + 1);
    // Pick a tick step that fits visibly (~50 px between labels).
    let step = 1;
    while (dx0 * step < 36) step *= 2;
    for (let k = 0; k < trace0.length; k += step) {
      const xx = labelW + k * dx0;
      x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, 4); x.stroke();
      x.fillText(String(baseTick + k), xx, 5);
    }
  }
  probes.forEach((p, i) => {
    const y0 = 4 + i * rowH;
    x.fillStyle = '#d8dde6'; x.font = '11px monospace';
    x.textAlign = 'left'; x.textBaseline = 'top';
    x.fillText(p.name, 6, y0 + 2);
    // 3 horizontal guide lines
    x.strokeStyle = '#2c3038'; x.lineWidth = 1;
    [0.2, 0.5, 0.8].forEach(f => {
      x.beginPath();
      x.moveTo(labelW, y0 + rowH * f);
      x.lineTo(labelW + plotW, y0 + rowH * f);
      x.stroke();
    });
    // Trace as a step plot
    const trace = p.trace;
    if (trace.length < 2) return;
    const dx = plotW / Math.max(1, trace.length - 1);
    let prevX = labelW, prevY = y0 + rowH * 0.5;
    for (let k = 0; k < trace.length; k++) {
      const v = trace[k];
      const yy = y0 + rowH * (v === 1 ? 0.2 : v === 0 ? 0.5 : v === -1 ? 0.8 : 0.5);
      const xx = labelW + k * dx;
      x.strokeStyle = tritColor(v);
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(prevX, prevY);
      x.lineTo(xx, prevY);
      x.lineTo(xx, yy);
      x.stroke();
      prevX = xx; prevY = yy;
    }
  });
  // Hover cursor — vertical line + per-probe value label at the cursor tick.
  if (_waveCursorTick >= 0 && probes.length > 0 && _waveCursorX >= labelW) {
    x.strokeStyle = '#6ea8ff';
    x.lineWidth = 1;
    x.setLineDash([3, 2]);
    x.beginPath();
    x.moveTo(_waveCursorX, 0);
    x.lineTo(_waveCursorX, c.height);
    x.stroke();
    x.setLineDash([]);
    x.font = 'bold 10px monospace';
    x.textAlign = 'left';
    x.textBaseline = 'top';
    probes.forEach((p, i) => {
      const v = p.trace[_waveCursorTick];
      if (v === undefined) return;
      x.fillStyle = tritColor(v);
      const labelText = tritLabel(v);
      x.fillText(labelText, _waveCursorX + 4, 4 + i * rowH + 2);
    });
  }
}

// Mouse tracking on the waveform canvas to update _waveCursorTick.
waveCv.addEventListener('mousemove', (e) => {
  const r = waveCv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const labelW = 80;
  const plotW = waveCv.width - labelW - 12;
  if (x < labelW || plotW <= 0) { _waveCursorTick = -1; _waveCursorX = -1; drawWaves(); return; }
  // Find a representative probe to anchor the tick computation.
  let firstTrace = null;
  function findFirst(scope) {
    for (const c of scope.comps) {
      if (c.type === 'WAVE') { firstTrace = c.state.trace; return; }
      if (c.type.startsWith('SUB:') && c.subScope) { findFirst(c.subScope); if (firstTrace) return; }
    }
  }
  findFirst({comps});
  if (!firstTrace || firstTrace.length < 2) { _waveCursorTick = -1; _waveCursorX = -1; drawWaves(); return; }
  const dx = plotW / Math.max(1, firstTrace.length - 1);
  _waveCursorTick = Math.round((x - labelW) / dx);
  _waveCursorTick = Math.max(0, Math.min(firstTrace.length - 1, _waveCursorTick));
  _waveCursorX = labelW + _waveCursorTick * dx;
  drawWaves();
});
waveCv.addEventListener('mouseleave', () => {
  _waveCursorTick = -1; _waveCursorX = -1; drawWaves();
});

// ============================================================================
//  INSPECTOR
// ============================================================================

function updateInspector() {
  if (selectedWire) {
    const w = wires.find(w => w.id === selectedWire);
    if (!w) { selInfo.textContent = 'nothing selected'; return; }
    const v = outVals[`${w.fromId}:${w.fromPort}`] ?? null;
    selInfo.innerHTML = `<b>Wire</b> #${w.id}<br>
      <span style="color:var(--muted)">${w.fromId}.${w.fromPort} → ${w.toId}.${w.toPort}</span>
      <div class="kv"><span>value</span><b style="color:${tritColor(v)}">${tritLabel(v)}</b></div>`;
    return;
  }
  if (selection.size === 0) { selInfo.textContent = 'nothing selected'; return; }
  if (selection.size > 1) {
    selInfo.innerHTML = `<b>${selection.size} components selected</b><br>
      <span style="color:var(--muted)">Press Pack to bundle them into a subcircuit, or drag to move.</span>`;
    return;
  }
  const c = getComp(Array.from(selection)[0]);
  if (!c) { selInfo.textContent = 'nothing selected'; return; }
  const def = compDef(c);
  let html = `<b>${c.type}</b> #${c.id}<br>
    <span style="color:var(--muted)">at (${c.x}, ${c.y})</span><br>`;
  for (const port in def.pins) {
    const isOut = def.pins[port].kind === 'out';
    const v = isOut ? outVals[`${c.id}:${port}`] : inputValueFromWires({comps,wires,outVals}, c.id, port);
    html += `<div class="kv"><span>${port} (${isOut ? 'out' : 'in'})</span>
             <b style="color:${tritColor(v)}">${tritLabel(v)}</b></div>`;
  }
  // Editable state fields, if the type defines an inspector
  const tdef = TYPES[c.type];
  if (tdef && tdef.inspector) {
    html += `<div class="inspector-form" id="insp-form"></div>`;
  }
  selInfo.innerHTML = html;
  if (tdef && tdef.inspector) {
    const form = document.getElementById('insp-form');
    const fields = tdef.inspector(c);
    for (const f of fields) {
      const labelEl = document.createElement('label');
      labelEl.textContent = f.label;
      form.appendChild(labelEl);
      let inputEl;
      if (f.kind === 'select') {
        inputEl = document.createElement('select');
        for (const [val, lab] of f.options) {
          const opt = document.createElement('option');
          opt.value = val; opt.textContent = lab;
          if (val === f.get()) opt.selected = true;
          inputEl.appendChild(opt);
        }
        inputEl.addEventListener('change', () => { pushHistory(); f.set(inputEl.value); simulate(); draw(); updateInspector(); });
      } else {
        inputEl = document.createElement('input');
        inputEl.type = (f.kind === 'number') ? 'number' : 'text';
        inputEl.value = f.get();
        inputEl.addEventListener('change', () => { pushHistory(); f.set(inputEl.value); simulate(); draw(); updateInspector(); });
      }
      form.appendChild(inputEl);
    }
  }
}

// ============================================================================
//  INTERACTION
// ============================================================================

function setStatus(s) { statusEl.textContent = s; }
function setTool(t, type = null) {
  tool = t; placeType = type;
  document.querySelectorAll('.pal-item').forEach(el => el.classList.remove('active'));
  // SUB: and GATE: types come from the library panels, not the static palette,
  // so there's no palette item to highlight.  Skip the data-type filter and
  // skip the activation entirely for those — otherwise a generic
  // .pal-item[data-tool="place"] selector matches the first place tool
  // (INPUT) and lights up the wrong row.
  if (!type || (!type.startsWith('SUB:') && !type.startsWith('GATE:'))) {
    let sel = `.pal-item[data-tool="${t}"]`;
    if (type) sel += `[data-type="${type}"]`;
    const target = document.querySelector(sel);
    if (target) target.classList.add('active');
  }
  pendingWire = null;
  setStatus(`tool: ${t}${type ? ' / ' + type : ''}`);
  draw();
}
document.querySelectorAll('.pal-item').forEach(el => {
  el.addEventListener('click', () => setTool(el.dataset.tool, el.dataset.type || null));
});

// ---- palette search --------------------------------------------------------
// Filter palette entries by substring against their visible text + data-type.
// Library entries inside #gate-lib and #sub-lib are filtered the same way.
// Section <h3>s hide themselves when none of their items match. Exposed as
// filterPalette() so a self-test can drive it without DOM events.
function filterPalette() {
  const inp = document.getElementById('pal-search');
  const q = (inp && inp.value || '').trim().toLowerCase();
  const aside = document.querySelector('aside.palette');
  if (!aside) return;
  let anyVisibleTotal = 0;
  // Filter individual entries first.
  for (const el of aside.querySelectorAll('.pal-item')) {
    const text = (el.textContent || '').toLowerCase();
    const ds   = (el.dataset.type || '').toLowerCase();
    const hit  = !q || text.includes(q) || ds.includes(q);
    el.style.display = hit ? '' : 'none';
    if (hit) anyVisibleTotal++;
  }
  for (const el of aside.querySelectorAll('#sub-lib > *, #gate-lib > *')) {
    const text = (el.textContent || '').toLowerCase();
    const hit  = !q || text.includes(q);
    el.style.display = hit ? '' : 'none';
    if (hit) anyVisibleTotal++;
  }
  // Walk top-level children in source order, hiding section <h3>s whose
  // following block has no visible entries.
  const kids = Array.from(aside.children);
  let header = null, groupHasMatch = false;
  const flushHeader = () => { if (header) header.style.display = groupHasMatch ? '' : 'none'; };
  for (const el of kids) {
    if (el.tagName === 'H3') {
      flushHeader();
      header = el; groupHasMatch = false;
    } else if (el.classList && el.classList.contains('pal-search')) {
      // search bar stays visible always
    } else if (el.id === 'pal-empty') {
      // skip — handled at the end
    } else if (el.id === 'gate-lib' || el.id === 'sub-lib') {
      // container — visible if any child is visible
      const any = Array.from(el.children).some(c => c.style.display !== 'none');
      el.style.display = (!q || any) ? '' : 'none';
      groupHasMatch = groupHasMatch || any;
    } else {
      // pal-item, switch-row, or other div: keep switch-row visible when
      // not searching, hide when searching unless its text matches.
      if (el.classList && el.classList.contains('switch-row')) {
        const text = (el.textContent || '').toLowerCase();
        const hit  = !q || text.includes(q);
        el.style.display = hit ? '' : 'none';
        if (hit) groupHasMatch = true;
      } else if (el.style.display !== 'none') {
        groupHasMatch = true;
      }
    }
  }
  flushHeader();
  const emptyEl = document.getElementById('pal-empty');
  if (emptyEl) emptyEl.style.display = (q && anyVisibleTotal === 0) ? '' : 'none';
}
{
  const inp = document.getElementById('pal-search');
  if (inp) {
    inp.addEventListener('input', filterPalette);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { inp.value = ''; filterPalette(); inp.blur(); }
    });
  }
}

// ---- right-click-to-delete -------------------------------------------------
// When enabled (toggle in the palette), a right-click on the canvas removes
// the component — or, failing that, the wire — under the cursor, and the
// browser's native context menu is suppressed.  When disabled, the right
// click falls through to the normal context menu.
cv.addEventListener('contextmenu', (e) => {
  if (!rmbDelete) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
  const p = hitTestComp(w.x, w.y);
  if (p) { deleteComp(p.id); return; }
  const wr = hitTestWire(w.x, w.y);
  if (wr) deleteWire(wr.id);
});
const rmbToggle = document.getElementById('rmb-delete-toggle');
try {
  if (localStorage.getItem('tritlogic.rmbDelete') === '0') rmbDelete = false;
} catch (e) {}
rmbToggle.checked = rmbDelete;
rmbToggle.addEventListener('change', () => {
  rmbDelete = rmbToggle.checked;
  try { localStorage.setItem('tritlogic.rmbDelete', rmbDelete ? '1' : '0'); }
  catch (e) {}
  setStatus(`right-click delete ${rmbDelete ? 'enabled' : 'disabled'}`);
});

cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x; mouse.wy = w.y;

  if (drag && drag.kind === 'pan') {
    view.tx = drag.tx0 + (mouse.x - drag.mx0);
    view.ty = drag.ty0 + (mouse.y - drag.my0);
  } else if (drag && drag.kind === 'comp') {
    const dx = snap(mouse.wx - drag.startWX);
    const dy = snap(mouse.wy - drag.startWY);
    for (const item of drag.items) {
      const c = getComp(item.id);
      if (c) { c.x = item.x0 + dx; c.y = item.y0 + dy; }
    }
  }
  hoverPin = hitTestPin(mouse.wx, mouse.wy);
  if (hoverPin) hoverPin = { compId: hoverPin.comp.id, port: hoverPin.port,
                             kind: hoverPin.kind, x: hoverPin.x, y: hoverPin.y };
  draw();
});

// ============================================================================
//  UNDO / REDO
// ============================================================================
//
//  Two stacks of in-memory snapshots. snapshotState() takes a deep-clone of
//  the user-edited surface (comps + wires + IDs + subcircuit / custom-gate
//  defs) — it deliberately omits subScope (rebuilt lazily by
//  simulateSubInstance) and outVals (recomputed by simulate). pushHistory()
//  is called BEFORE each mutating user action; redo is invalidated on any
//  new push. Drag-move snapshots are dropped if no movement happened.

const undoStack = [], redoStack = [];
const UNDO_LIMIT = 50;

function snapshotState() {
  const cleanComps = comps.map(c => {
    const cc = { ...c, state: deepClone(c.state) };
    delete cc.subScope;
    return cc;
  });
  return {
    comps: cleanComps,
    wires: deepClone(wires),
    nextCompId, nextWireId,
    subcircuitDefs: deepClone(subcircuitDefs),
    customGates: deepClone(customGates),
  };
}

function restoreState(snap) {
  comps = deepClone(snap.comps);
  wires = deepClone(snap.wires);
  nextCompId = snap.nextCompId;
  nextWireId = snap.nextWireId;
  subcircuitDefs = deepClone(snap.subcircuitDefs);
  registerBuiltinSubcircuits();
  customGates = deepClone(snap.customGates);
  syncCompMap();
  selection.clear(); selectedWire = null; pendingWire = null;
  outVals = {};
  if (typeof refreshSubLib === 'function') refreshSubLib();
  if (typeof refreshGateLib === 'function') refreshGateLib();
  simulate(); draw(); updateInspector();
}

function pushHistory() {
  undoStack.push(snapshotState());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}
// Pop the most recently pushed snapshot without restoring — used when a
// would-be mutation turned out to be a no-op (e.g. a drag with no movement).
function popHistory() { undoStack.pop(); }

function undo() {
  if (!undoStack.length) { setStatus('nothing to undo'); return; }
  redoStack.push(snapshotState());
  restoreState(undoStack.pop());
  setStatus(`undo (${undoStack.length} more)`);
}
function redo() {
  if (!redoStack.length) { setStatus('nothing to redo'); return; }
  undoStack.push(snapshotState());
  restoreState(redoStack.pop());
  setStatus(`redo (${redoStack.length} more)`);
}

cv.addEventListener('mousedown', (e) => {
  const r = cv.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x; mouse.wy = w.y;

  // Pan
  if (e.button === 1 || (e.button === 0 && mouse.spaceDown)) {
    drag = { kind: 'pan', mx0: mouse.x, my0: mouse.y, tx0: view.tx, ty0: view.ty };
    return;
  }
  if (e.button !== 0) return;

  // Place mode
  if (tool === 'place' && placeType) {
    const tdef = placeType.startsWith('SUB:') ? subInstanceDef({type: placeType}) : TYPES[placeType];
    const state = (tdef.defaults || (() => ({})))();
    // If WAVE, ensure trace is a fresh array (defaults() already does it)
    const c = {
      id: nextCompId++,
      type: placeType,
      x: snap(mouse.wx - tdef.w/2),
      y: snap(mouse.wy - tdef.h/2),
      state,
    };
    pushHistory();
    comps.push(c); syncCompMap();
    simulate(); draw();
    return;
  }

  // Delete mode
  if (tool === 'delete') {
    const p = hitTestComp(mouse.wx, mouse.wy);
    if (p) { deleteComp(p.id); return; }
    const wr = hitTestWire(mouse.wx, mouse.wy);
    if (wr) { deleteWire(wr.id); return; }
    return;
  }

  // Select-tool path
  const pin = hitTestPin(mouse.wx, mouse.wy);
  if (pin) {
    handlePinClick(pin);
    return;
  }
  const c = hitTestComp(mouse.wx, mouse.wy);
  if (c) {
    // Start a drag.  We delay any "click input cycle" decision until mouseup,
    // distinguishing click vs drag by total mouse movement.
    if (!selection.has(c.id)) {
      if (!e.shiftKey) selection.clear();
      selection.add(c.id);
    }
    selectedWire = null;
    const items = Array.from(selection).map(id => {
      const cc = getComp(id);
      return { id, x0: cc.x, y0: cc.y };
    });
    // Pre-emptive snapshot: if it turns out to be a no-move click, mouseup
    // pops it; if it was a real drag (movement) or a click on INPUT/CONST
    // (cycles the value), the snapshot stays.
    pushHistory();
    drag = { kind: 'comp', startWX: mouse.wx, startWY: mouse.wy, items,
             clickComp: c, startMX: mouse.x, startMY: mouse.y };
    updateInspector(); draw();
    return;
  }
  // Wire?
  const wr = hitTestWire(mouse.wx, mouse.wy);
  if (wr) {
    selection.clear();
    selectedWire = wr.id;
    updateInspector(); draw();
    return;
  }
  // Empty space — drag pans the canvas by default, Shift+drag rect-selects.
  // (Space+drag and middle-mouse-drag also pan, handled in the early-return
  // branch above.)
  if (e.shiftKey) {
    drag = { kind: 'rect', x0: mouse.wx, y0: mouse.wy };
    updateInspector(); draw();
  } else {
    selection.clear();
    selectedWire = null;
    drag = { kind: 'pan', mx0: mouse.x, my0: mouse.y, tx0: view.tx, ty0: view.ty };
    cv.style.cursor = 'grabbing';
    updateInspector(); draw();
  }
});

cv.addEventListener('mouseup', (e) => {
  if (drag && drag.kind === 'pan') cv.style.cursor = '';
  if (!drag) return;
  if (drag.kind === 'comp') {
    // Was this actually a click (no movement)?
    const dx = Math.abs(mouse.x - drag.startMX), dy = Math.abs(mouse.y - drag.startMY);
    if (dx < 3 && dy < 3) {
      const c = drag.clickComp;
      const isCycle = c.type === 'INPUT' || c.type === 'CONST';
      if (isCycle) {
        const order = [-1, 0, 1];
        c.state.value = order[(order.indexOf(c.state.value) + 1) % 3];
        simulate();
      } else {
        // Pure click on a non-cycling component is a no-op mutation —
        // discard the pre-emptive history snapshot we took at mousedown.
        popHistory();
      }
    }
    // Else: real drag with movement — keep the snapshot pushed at mousedown.
    updateInspector();
  } else if (drag.kind === 'rect') {
    const x0 = Math.min(drag.x0, mouse.wx), y0 = Math.min(drag.y0, mouse.wy);
    const x1 = Math.max(drag.x0, mouse.wx), y1 = Math.max(drag.y0, mouse.wy);
    if (Math.abs(x1 - x0) > 3 && Math.abs(y1 - y0) > 3) {
      if (!e.shiftKey) selection.clear();
      for (const c of comps) {
        const def = compDef(c);
        if (c.x >= x0 && c.x + def.w <= x1 && c.y >= y0 && c.y + def.h <= y1) {
          selection.add(c.id);
        }
      }
    }
    updateInspector();
  }
  drag = null;
  draw();
});

function handlePinClick(pin) {
  if (pendingWire) {
    // Complete the wire if pin kinds are compatible.
    let fromId, fromPort, toId, toPort;
    if (pendingWire.fromKind === 'out' && pin.kind === 'in') {
      fromId = pendingWire.compId; fromPort = pendingWire.port;
      toId = pin.comp.id; toPort = pin.port;
    } else if (pendingWire.fromKind === 'in' && pin.kind === 'out') {
      fromId = pin.comp.id; fromPort = pin.port;
      toId = pendingWire.compId; toPort = pendingWire.port;
    } else {
      // Restart from new pin
      pendingWire = { compId: pin.comp.id, port: pin.port, fromKind: pin.kind,
                      fromXY: { x: pin.x, y: pin.y } };
      setStatus('wire start (click an opposite-kind pin)');
      draw(); return;
    }
    addWire(fromId, fromPort, toId, toPort);
    pendingWire = null;
    setStatus('wire placed');
  } else {
    pendingWire = { compId: pin.comp.id, port: pin.port, fromKind: pin.kind,
                    fromXY: { x: pin.x, y: pin.y } };
    setStatus(`wire start (${pin.kind}) — click an opposite-kind pin`);
  }
  draw();
}

// Internal delete primitives — no history push here, because callers
// (deleteSelection, right-click-delete, deleteComp/deleteWire from the
// Delete tool path) all wrap their own pushHistory() around the call.
function _deleteCompNoHist(id) {
  comps = comps.filter(c => c.id !== id);
  syncCompMap();
  wires = wires.filter(w => w.fromId !== id && w.toId !== id);
  selection.delete(id);
  if (selectedWire) {
    const w = wires.find(w => w.id === selectedWire);
    if (!w) selectedWire = null;
  }
}
function _deleteWireNoHist(id) {
  wires = wires.filter(w => w.id !== id);
  if (selectedWire === id) selectedWire = null;
}
function deleteComp(id) {
  pushHistory();
  _deleteCompNoHist(id);
  simulate(); draw(); updateInspector();
}
function deleteWire(id) {
  pushHistory();
  _deleteWireNoHist(id);
  simulate(); draw(); updateInspector();
}
function deleteSelection() {
  if (selection.size === 0 && !selectedWire) return;
  pushHistory();
  for (const id of Array.from(selection)) _deleteCompNoHist(id);
  if (selectedWire) _deleteWireNoHist(selectedWire);
  simulate(); draw(); updateInspector();
}

function addWire(fromId, fromPort, toId, toPort) {
  // Reject if from-pin is not actually an output of its component (and vice versa).
  const fc = getComp(fromId), tc = getComp(toId);
  if (!fc || !tc) return;
  const fdef = compDef(fc), tdef = compDef(tc);
  if (!fdef.pins[fromPort] || fdef.pins[fromPort].kind !== 'out') return;
  if (!tdef.pins[toPort] || tdef.pins[toPort].kind !== 'in') return;
  pushHistory();
  // Replace any existing wire driving the same input.
  wires = wires.filter(w => !(w.toId === toId && w.toPort === toPort));
  wires.push({ id: nextWireId++, fromId, fromPort, toId, toPort });
  simulate(); draw();
}

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dz = e.deltaY > 0 ? 1/1.1 : 1.1;
  const wx = (mouse.x - view.tx) / view.scale;
  const wy = (mouse.y - view.ty) / view.scale;
  view.scale = Math.max(0.3, Math.min(3, view.scale * dz));
  view.tx = mouse.x - wx * view.scale;
  view.ty = mouse.y - wy * view.scale;
  draw();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  // Undo / redo are bound even while focus is in a text field, but ONLY
  // when the field isn't the palette search box — typing there should
  // never collide with Ctrl+Z. The browser's built-in undo in the search
  // input continues to work as usual.
  const ae = document.activeElement;
  const inSearch = ae && ae.id === 'pal-search';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !inSearch) {
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
    if (e.key === 'f' || e.key === 'F') {
      const s = document.getElementById('pal-search');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
      return;
    }
  }
  // Don't hijack other keys when typing in an input field.
  if (ae && ae.tagName === 'INPUT') return;
  if (ae && ae.tagName === 'SELECT') return;
  if (e.code === 'Space') { mouse.spaceDown = true; cv.style.cursor = 'grab'; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); }
  if (e.key === 'Escape') {
    pendingWire = null; selection.clear(); selectedWire = null;
    updateInspector(); draw();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { mouse.spaceDown = false; cv.style.cursor = ''; }
});

// ============================================================================
//  TOOLBAR ACTIONS
// ============================================================================

document.getElementById('btn-step').addEventListener('click', stepSequential);

// Start or stop the 4 Hz auto-step.  Idempotent: a no-op if already in
// the requested state.  Used by the Play button and by example loading.
function setAutoPlay(on) {
  const btn = document.getElementById('btn-play');
  if (on && !autoPlay) {
    autoPlay = setInterval(stepSequential, 250);
    btn.classList.add('active'); btn.textContent = '⏸ Pause';
  } else if (!on && autoPlay) {
    clearInterval(autoPlay); autoPlay = null;
    btn.classList.remove('active'); btn.textContent = '▶ Play';
  }
}
document.getElementById('btn-play').addEventListener('click', () => setAutoPlay(!autoPlay));

document.getElementById('btn-reset').addEventListener('click', () => {
  // Reset every flip-flop's stored state and every clock's value; clear waves.
  function resetScope(scope) {
    for (const c of scope.comps) {
      if (c.type === 'DFF') { c.state.q = 0; c.state.clkPrev = 0; }
      else if (c.type === 'REG3') { c.state.q = [0, 0, 0]; c.state.clkPrev = 0; }
      else if (c.type === 'RAM') {
        // Reset clears registers, not memory — RAM contents persist (so a
        // program loaded into a RAM-as-instruction-memory survives Reset).
        c.state.clkPrev = 0;
      }
      else if (c.type === 'PC') { c.state.p = [-1, -1]; c.state.clkPrev = 0; }
      else if (c.type === 'CLOCK') { c.state.value = -1; }
      else if (c.type === 'WAVE') { c.state.trace = []; }
      else if (c.type.startsWith('SUB:') && c.subScope) resetScope(c.subScope);
    }
  }
  resetScope({comps, wires});
  tick = 0; outVals = {};
  simulate(); drawWaves(); draw();
});

document.getElementById('btn-wave').addEventListener('click', () => {
  document.body.classList.toggle('wave-open');
  resize();
});
document.getElementById('btn-wave-close').addEventListener('click', () => {
  document.body.classList.remove('wave-open'); resize();
});
document.getElementById('btn-wave-clear').addEventListener('click', () => {
  function clr(scope) {
    for (const c of scope.comps) {
      if (c.type === 'WAVE') c.state.trace = [];
      else if (c.type.startsWith('SUB:') && c.subScope) clr(c.subScope);
    }
  }
  clr({comps, wires}); drawWaves();
});

document.getElementById('btn-tt').addEventListener('click', openTruthTable);
document.getElementById('tt-close').addEventListener('click', () => closeModal('tt-modal'));
document.getElementById('btn-pack').addEventListener('click', openPackModal);
document.getElementById('pack-close').addEventListener('click', () => closeModal('pack-modal'));

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// Click on the dimmed background (but not on any of its children) closes
// the modal — matches standard UX.  Applied once to every .modal-bg.
document.querySelectorAll('.modal-bg').forEach(bg => {
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.classList.remove('open'); });
});

// ============================================================================
//  COMPONENT REFERENCE  (Info button)
// ============================================================================
//
//  An in-app encyclopedia of every built-in component.  The Info button
//  opens it; if a component is selected on the canvas it opens straight to
//  that component's page, otherwise it shows the intro and the full list.

// Gate-like types whose behaviour is a pure function of their inputs — for
// these we render a truth table generated live from the simulator's own
// eval(), so the docs can never drift from real behaviour.
const INFO_GATE_TYPES = ['STI', 'PTI', 'NTI', 'MIN', 'MAX', 'ADDER'];

// Order of the left-hand list.  Each key is either a real TYPES name or one
// of the synthetic keys (_intro, SUBCIRCUIT, CUSTOMGATE).
const INFO_CATEGORIES = [
  ['Start here', ['_intro']],
  ['Sources',    ['INPUT', 'CONST', 'TRYTE_IN', 'CLOCK']],
  ['Sinks',      ['OUTPUT', 'TRYTE_OUT', 'WAVE']],
  ['Inverters',  ['STI', 'PTI', 'NTI']],
  ['Gates',      ['MIN', 'MAX', 'ADDER', 'MUX']],
  ['Sequential', ['DFF', 'REG3', 'RAM']],
  ['CPU',        ['ALU', 'PC']],
  ['Composite',  ['SUBCIRCUIT', 'CUSTOMGATE']],
  ['Neural-net kit', ['SUB:TMUL', 'SUB:MAC3', 'SUB:ACT']],
  ['Arithmetic kit', ['SUB:TSUM', 'SUB:TCARRY', 'SUB:FADD', 'SUB:ALU3', 'SUB:MUX3']],
  ['Sequential kit', ['SUB:TLATCH', 'SUB:TFLOP', 'SUB:TREG3', 'SUB:TPC', 'SUB:TRAM']],
  ['ISA',            ['_asm', '_debugger']],
];

const COMPONENT_INFO = {
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
};

// Pin table read straight from the live TYPES definition.
function infoPinsTable(typeName) {
  const def = typeName.startsWith('SUB:') ? subInstanceDef({ type: typeName })
                                          : TYPES[typeName];
  if (!def || !def.pins) return '';
  const rows = Object.keys(def.pins).map(p => {
    const pin = def.pins[p];
    return `<tr><td>${escapeHtml(p)}</td>` +
           `<td>${pin.kind === 'in' ? 'input' : 'output'}</td>` +
           `<td>${escapeHtml(pin.side)}</td></tr>`;
  }).join('');
  return `<h4>Pins</h4><table class="info-tt info-pintbl">` +
         `<thead><tr><th>pin</th><th>kind</th><th>side</th></tr></thead>` +
         `<tbody>${rows}</tbody></table>`;
}

// Truth table generated by actually running the simulator's eval().
function infoTruthTable(typeName) {
  const def = TYPES[typeName];
  const inPins  = Object.keys(def.pins).filter(p => def.pins[p].kind === 'in');
  const outPins = Object.keys(def.pins).filter(p => def.pins[p].kind === 'out');
  let html = '<table class="info-tt"><thead><tr>';
  for (const p of inPins)  html += `<th>${escapeHtml(p)}</th>`;
  for (const p of outPins) html += `<th>${escapeHtml(p)}</th>`;
  html += '</tr></thead><tbody>';
  for (const combo of enumerateInputs(inPins.length)) {
    const vIn = {};
    inPins.forEach((p, i) => vIn[p] = combo[i]);
    const vOut = def.eval(null, vIn) || {};
    html += '<tr>';
    for (const v of combo) html += `<td class="${tritClass(v)}">${tritLabel(v)}</td>`;
    for (const p of outPins) html += `<td class="${tritClass(vOut[p])}">${tritLabel(vOut[p])}</td>`;
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

// Truth table for a subcircuit, generated by actually running the block
// through the simulator — the SUB: counterpart of infoTruthTable, for types
// whose behaviour comes from an inner circuit rather than an eval().
function infoSubTruthTable(typeName) {
  const def = subInstanceDef({ type: typeName });
  const inPins  = Object.keys(def.pins).filter(p => def.pins[p].kind === 'in');
  const outPins = Object.keys(def.pins).filter(p => def.pins[p].kind === 'out');
  let html = '<table class="info-tt"><thead><tr>';
  for (const p of inPins)  html += `<th>${escapeHtml(p)}</th>`;
  for (const p of outPins) html += `<th>${escapeHtml(p)}</th>`;
  html += '</tr></thead><tbody>';
  for (const combo of enumerateInputs(inPins.length)) {
    const vIn = {};
    inPins.forEach((p, i) => vIn[p] = combo[i]);
    const vOut = simulateSubInstance({ type: typeName, state: {} }, vIn) || {};
    html += '<tr>';
    for (const v of combo) html += `<td class="${tritClass(v)}">${tritLabel(v)}</td>`;
    for (const p of outPins) html += `<td class="${tritClass(vOut[p])}">${tritLabel(vOut[p])}</td>`;
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

function renderInfoList(activeKey) {
  let html = '';
  for (const [cat, keys] of INFO_CATEGORIES) {
    html += `<div class="cat">${cat}</div>`;
    for (const k of keys) {
      const e = COMPONENT_INFO[k];
      if (!e) continue;
      html += `<div class="info-entry${k === activeKey ? ' active' : ''}" ` +
              `data-key="${k}">${escapeHtml(e.name)}</div>`;
    }
  }
  const list = document.getElementById('info-list');
  list.innerHTML = html;
  list.querySelectorAll('.info-entry').forEach(el => {
    el.addEventListener('click', () => showInfoEntry(el.dataset.key));
  });
}

function showInfoEntry(key) {
  const e = COMPONENT_INFO[key];
  if (!e) return;
  renderInfoList(key);
  let html = `<h3>${escapeHtml(e.name)}</h3>` +
             `<p class="tagline">${escapeHtml(e.tagline)}</p>`;
  const isBuiltinSub = key.startsWith('SUB:') && !!subcircuitDefs[key.slice(4)];
  if (TYPES[key] || isBuiltinSub) html += infoPinsTable(key);
  html += e.body;
  if (INFO_GATE_TYPES.includes(key)) {
    html += '<h4>Truth table — generated live from the simulator</h4>' +
            infoTruthTable(key);
  } else if (isBuiltinSub) {
    // A small subcircuit (≤ 3 inputs, so ≤ 27 rows) gets a full live truth
    // table; a larger one would have too many rows (3ⁿ) to be useful.
    const subDef = subInstanceDef({ type: key });
    const nIn = Object.keys(subDef.pins).filter(p => subDef.pins[p].kind === 'in').length;
    if (nIn <= 3) {
      html += '<h4>Truth table — generated live from the simulator</h4>' +
              infoSubTruthTable(key);
    }
  }
  const detail = document.getElementById('info-detail');
  detail.innerHTML = html;
  detail.scrollTop = 0;
}

function openInfoModal() {
  // If a component is selected, open straight to its reference page.
  let key = '_intro';
  const firstId = selection.values().next().value;
  if (firstId != null) {
    const c = getComp(firstId);
    if (c) {
      if (c.type.startsWith('SUB:'))       key = COMPONENT_INFO[c.type] ? c.type : 'SUBCIRCUIT';
      else if (c.type.startsWith('GATE:')) key = 'CUSTOMGATE';
      else if (COMPONENT_INFO[c.type])     key = c.type;
    }
  }
  showInfoEntry(key);
  openModal('info-modal');
}
document.getElementById('btn-info').addEventListener('click', openInfoModal);
document.getElementById('info-close').addEventListener('click', () => closeModal('info-modal'));

// ---- assembler modal ------------------------------------------------------
function openAsmModal() {
  // Populate the examples dropdown on first open (idempotent — clearing
  // first lets a hot reload still see new entries).
  const sel = document.getElementById('asm-example');
  if (sel) {
    sel.innerHTML = '<option value="">— pick one —</option>';
    for (const key in ASM_EXAMPLES) {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = ASM_EXAMPLES[key].label;
      sel.appendChild(opt);
    }
  }
  // Seed the textarea with the default counter program on a blank field.
  const ta = document.getElementById('asm-source');
  if (ta && !ta.value.trim()) ta.value = ASM_EXAMPLES['counter'].src.trimEnd();
  document.getElementById('asm-status').textContent = '';
  document.getElementById('asm-result').innerHTML = '';
  openModal('asm-modal');
}
function renderAsmResult(res) {
  const out = document.getElementById('asm-result');
  if (res.errors.length) {
    out.innerHTML = `<div style="color: var(--t-neg)">
      ${res.errors.length} error(s):</div>` +
      res.errors.map(e => `<div style="color: var(--t-neg); padding-left: 8px;">` +
        `line ${e.line}: ${escapeHtml(e.msg)}</div>`).join('');
    return;
  }
  // Print the encoded word image — one line per word, low trit first.
  const rows = res.mem.map((w, i) => {
    const used = i < res.words ? '' : ' style="color: var(--muted)"';
    const trits = w.map(t => t === -1 ? 'T' : t === 1 ? '+1' : ' 0').join(' ');
    return `<div${used}>  word ${i}: [${trits}]</div>`;
  }).join('');
  out.innerHTML =
    `<div style="color: var(--accent)">Assembled ${res.words} instruction${res.words === 1 ? '' : 's'}` +
    ` (${ASM_PROGRAM_WORDS - res.words} word${ASM_PROGRAM_WORDS - res.words === 1 ? '' : 's'} padded with 0).</div>` +
    `<div style="margin-top: 4px;">${rows}</div>`;
}
// Find the RAM block that's wired up as IMEM (address pins driven by a PC).
// Falls back to the first RAM in the circuit if no PC is present.
function findImem(scope) {
  scope = scope || { comps, wires };
  const rams = scope.comps.filter(c => c.type === 'RAM');
  if (rams.length === 0) return null;
  for (const r of rams) {
    const a0Wire = scope.wires.find(w => w.toId === r.id && w.toPort === 'a0');
    if (!a0Wire) continue;
    const src = scope.comps.find(c => c.id === a0Wire.fromId);
    if (src && src.type === 'PC') return r;
  }
  return rams[0];
}
function loadProgramIntoImem(mem) {
  const ram = findImem();
  if (!ram) return { ok: false, msg: 'No RAM block found — load the CPU example first.' };
  pushHistory();
  ram.state.mem = mem.map(w => w.slice());
  ram.state.clkPrev = 0;
  outVals = {}; tick = 0;
  simulate(); draw(); drawWaves();
  return { ok: true, msg: `Loaded ${mem.length} words into RAM #${ram.id}.` };
}

// Stash the last-loaded assembly + asm result so the debugger can render
// source lines and map PC → source line. Set when "Assemble & Load" succeeds.
let lastAsmProgram = null;   // { source, mem, addrToLine, labels, words }
document.getElementById('btn-asm').addEventListener('click', openAsmModal);
document.getElementById('asm-close').addEventListener('click', () => closeModal('asm-modal'));
document.getElementById('asm-example').addEventListener('change', (e) => {
  const ex = ASM_EXAMPLES[e.target.value];
  if (!ex) return;
  document.getElementById('asm-source').value = ex.src.trimEnd();
  document.getElementById('asm-status').textContent = '';
  document.getElementById('asm-result').innerHTML = '';
  e.target.value = '';
});
document.getElementById('asm-check').addEventListener('click', () => {
  const res = assemble(document.getElementById('asm-source').value);
  renderAsmResult(res);
  document.getElementById('asm-status').textContent =
    res.errors.length ? `${res.errors.length} error(s)` : 'assembled cleanly';
});
document.getElementById('asm-load').addEventListener('click', () => {
  const res = assemble(document.getElementById('asm-source').value);
  renderAsmResult(res);
  if (res.errors.length) {
    document.getElementById('asm-status').textContent = `${res.errors.length} error(s) — fix before loading`;
    return;
  }
  const r = loadProgramIntoImem(res.mem);
  document.getElementById('asm-status').textContent = r.msg;
  if (r.ok) {
    lastAsmProgram = {
      source:     document.getElementById('asm-source').value,
      mem:        res.mem.map(w => w.slice()),
      addrToLine: res.addrToLine.slice(),
      labels:     { ...res.labels },
      words:      res.words,
    };
    refreshDebugger();
    setStatus(`asm: ${r.msg}`);
  }
});

// ---- CPU debugger ---------------------------------------------------------
//
//  A floating panel that single-steps the Phase 7 CPU and shows the live
//  program counter and accumulator alongside the source we last assembled
//  & loaded into IMEM. It depends only on the standard CPU shape used by
//  EXAMPLES['cpu']: one RAM driven by one PC, with a REG3 acting as ACC.
//  Breakpoints are stored as a Set of IMEM word addresses (0..8). The Run
//  loop reuses the same stepSequential() the toolbar Step / Play buttons
//  call, so the debugger is just observation + a stop condition; the
//  simulator itself is untouched.

const debuggerState = {
  breakpoints: new Set(),  // word addresses 0..8
  running: false,
  runTimer: null,
};

function decodeImemWord(word) {
  // [operand_low, operand_high, opcode] → human-readable mnemonic. Matches
  // the assembler's ASM_OPCODES mapping exactly. Floating trits show as "?".
  const opTrit = word[2];
  const lo = word[0], hi = word[1];
  if (lo == null || hi == null || opTrit == null) return '?';
  const operandInt = lo + hi * 3;
  if (opTrit === 0)  return `ADDI ${operandInt >= 0 ? '+' : ''}${operandInt}`;
  if (opTrit === 1)  return `MAXI ${operandInt >= 0 ? '+' : ''}${operandInt}`;
  if (opTrit === -1) return `JMP  ${operandInt + 4}`;  // PC index = stored value + 4
  return '?';
}

function findDebuggerTargets(scope) {
  // Returns { pc, imem, acc } or null if the canvas doesn't hold a CPU.
  // ACC = the REG3 whose d-pins are driven by the ALU; falls back to first
  // REG3. The CPU example wires the ALU outputs straight into ACC.
  scope = scope || { comps, wires };
  const pc = scope.comps.find(c => c.type === 'PC');
  const imem = findImem(scope);
  if (!pc || !imem) return null;
  const regs = scope.comps.filter(c => c.type === 'REG3');
  let acc = null;
  for (const r of regs) {
    const dWire = scope.wires.find(w => w.toId === r.id && w.toPort === 'd0');
    if (!dWire) continue;
    const src = scope.comps.find(c => c.id === dWire.fromId);
    if (src && src.type === 'ALU') { acc = r; break; }
  }
  if (!acc) acc = regs[0] || null;
  return { pc, imem, acc };
}

function escapeHtmlSafe(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function refreshDebugger() {
  const panel = document.getElementById('dbg-panel');
  if (!panel || panel.style.display === 'none') return;
  const targets = findDebuggerTargets();
  const pcEl    = document.getElementById('dbg-pc');
  const accEl   = document.getElementById('dbg-acc');
  const instrEl = document.getElementById('dbg-instr');
  const tickEl  = document.getElementById('dbg-tick');
  const brksEl  = document.getElementById('dbg-brks');
  const srcEl   = document.getElementById('dbg-src');
  const memEl   = document.getElementById('dbg-mem');
  tickEl.textContent = tick;
  brksEl.textContent = debuggerState.breakpoints.size
    ? Array.from(debuggerState.breakpoints).sort((a,b)=>a-b).join(', ')
    : '(none)';

  if (!targets) {
    pcEl.textContent = '—'; accEl.textContent = '—';
    instrEl.innerHTML = '<span style="color: var(--muted);">no CPU on canvas — load the CPU example</span>';
    srcEl.innerHTML = ''; memEl.innerHTML = '';
    return;
  }
  const pcAddr = tritsToInt(targets.pc.state.p) + 4;
  const accVal = tritsToInt(targets.acc ? targets.acc.state.q : [0,0,0]);
  pcEl.textContent  = `${pcAddr}  [${targets.pc.state.p.map(tritLabel).join(' ')}]`;
  accEl.textContent = `${accVal >= 0 ? '+' : ''}${accVal}  ` +
    (targets.acc ? `[${targets.acc.state.q.map(tritLabel).join(' ')}]` : '');
  const curWord = targets.imem.state.mem[pcAddr] || [0,0,0];
  instrEl.textContent = `word ${pcAddr}: ${decodeImemWord(curWord)}`;

  // Source listing.
  if (lastAsmProgram) {
    const lines = lastAsmProgram.source.split(/\r?\n/);
    // Reverse lookup: which IMEM addr (if any) lives on each source line.
    const lineToAddr = {};
    for (let i = 0; i < lastAsmProgram.addrToLine.length; i++) {
      const ln = lastAsmProgram.addrToLine[i];
      if (ln != null && !(ln in lineToAddr)) lineToAddr[ln] = i;
    }
    const pcLine = lastAsmProgram.addrToLine[pcAddr];
    srcEl.innerHTML = lines.map((raw, idx) => {
      const ln = idx + 1;
      const addr = lineToAddr[ln];
      const isPc = (ln === pcLine);
      const hasBp = (addr != null) && debuggerState.breakpoints.has(addr);
      const bpDot = addr != null
        ? `<span class="dbg-bp" data-addr="${addr}" style="cursor: pointer;
             color: ${hasBp ? 'var(--t-neg)' : 'var(--muted)'};">●</span>`
        : `<span style="color: transparent;">●</span>`;
      const bg = isPc ? 'background: rgba(110,168,255,0.18);' : '';
      const lnLabel = String(ln).padStart(2, ' ');
      return `<div style="padding: 1px 6px; ${bg}">${bpDot} <span style="color: var(--muted);">${lnLabel}</span>  ${escapeHtmlSafe(raw) || '&nbsp;'}</div>`;
    }).join('');
  } else {
    srcEl.innerHTML = `<div style="padding: 8px; color: var(--muted);">No assembled program yet. Open <b>Assemble</b>, write a program, and click <b>Assemble &amp; Load into IMEM</b>.</div>`;
  }

  // IMEM dump.
  memEl.innerHTML = targets.imem.state.mem.map((w, i) => {
    const isPc = (i === pcAddr);
    const hasBp = debuggerState.breakpoints.has(i);
    const trits = w.map(t => t == null ? '?' : tritLabel(t)).join(' ');
    const bg = isPc ? 'background: rgba(110,168,255,0.18);' : '';
    const bpDot = `<span class="dbg-bp-mem" data-addr="${i}" style="cursor: pointer;
       color: ${hasBp ? 'var(--t-neg)' : 'var(--muted)'};">●</span>`;
    return `<div style="padding: 1px 6px; ${bg}">${bpDot} <span style="color: var(--muted);">w${i}</span>  [${trits}]  ${escapeHtmlSafe(decodeImemWord(w))}</div>`;
  }).join('');
}

function openDebugger() {
  const panel = document.getElementById('dbg-panel');
  panel.style.display = 'flex';
  refreshDebugger();
}
function closeDebugger() {
  debuggerStopRun();
  document.getElementById('dbg-panel').style.display = 'none';
}
function debuggerHitBreakpoint() {
  const targets = findDebuggerTargets();
  if (!targets) return false;
  const pcAddr = tritsToInt(targets.pc.state.p) + 4;
  return debuggerState.breakpoints.has(pcAddr);
}
function debuggerStopRun() {
  debuggerState.running = false;
  if (debuggerState.runTimer != null) {
    clearInterval(debuggerState.runTimer);
    debuggerState.runTimer = null;
  }
  const s = document.getElementById('dbg-status');
  if (s) s.textContent = '';
}
function debuggerStartRun() {
  if (debuggerState.running) return;
  const maxStepsInput = document.getElementById('dbg-runmax');
  let budget = Math.max(1, Math.min(9999, Number(maxStepsInput.value) || 200));
  debuggerState.running = true;
  document.getElementById('dbg-status').textContent = `running (budget ${budget})…`;
  debuggerState.runTimer = setInterval(() => {
    if (!debuggerState.running) return;
    stepSequential();
    refreshDebugger();
    budget--;
    if (debuggerHitBreakpoint()) {
      debuggerStopRun();
      document.getElementById('dbg-status').textContent = `halted at breakpoint`;
    } else if (budget <= 0) {
      debuggerStopRun();
      document.getElementById('dbg-status').textContent = `budget exhausted`;
    }
  }, 80);
}

// Headless version of Run (no setInterval) used by the self-test suite:
// step up to `maxSteps` ticks, halting early when PC matches a breakpoint.
// Returns { steps, halted: 'breakpoint' | 'budget' }.
function debuggerRunHeadless(maxSteps) {
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    stepSequential();
    steps++;
    if (debuggerHitBreakpoint()) return { steps, halted: 'breakpoint' };
  }
  return { steps, halted: 'budget' };
}

document.getElementById('btn-debug').addEventListener('click', openDebugger);
document.getElementById('dbg-close').addEventListener('click', closeDebugger);
document.getElementById('dbg-step').addEventListener('click', () => {
  stepSequential(); refreshDebugger();
});
document.getElementById('dbg-step-cyc').addEventListener('click', () => {
  stepSequential(); stepSequential(); refreshDebugger();
});
document.getElementById('dbg-run').addEventListener('click', debuggerStartRun);
document.getElementById('dbg-pause').addEventListener('click', debuggerStopRun);
document.getElementById('dbg-reset').addEventListener('click', () => {
  const targets = findDebuggerTargets();
  if (!targets) return;
  pushHistory();
  targets.pc.state.p = [-1, -1]; targets.pc.state.clkPrev = 0;
  if (targets.acc) { targets.acc.state.q = [0,0,0]; targets.acc.state.clkPrev = 0; }
  outVals = {}; tick = 0;
  simulate(); draw(); drawWaves(); refreshDebugger();
});
// Click a breakpoint dot — toggle the address. Listener on the panel so it
// keeps working after each innerHTML re-render.
document.getElementById('dbg-panel').addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !(t.classList.contains('dbg-bp') || t.classList.contains('dbg-bp-mem'))) return;
  const a = Number(t.dataset.addr);
  if (!Number.isInteger(a)) return;
  if (debuggerState.breakpoints.has(a)) debuggerState.breakpoints.delete(a);
  else debuggerState.breakpoints.add(a);
  refreshDebugger();
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear the entire circuit? (Subcircuit library is preserved.)')) return;
  pushHistory();
  comps = []; wires = []; nextCompId = 1; nextWireId = 1; syncCompMap();
  outVals = {}; selection.clear(); selectedWire = null; tick = 0;
  simulate(); draw(); drawWaves(); updateInspector();
});
document.getElementById('btn-save').addEventListener('click', () => {
  // Deep-copy comps but strip non-serializable subScope (will be rebuilt on load).
  const cleanComps = comps.map(c => {
    const cc = { ...c, state: deepClone(c.state) };
    delete cc.subScope;
    return cc;
  });
  const data = { version: SAVE_FORMAT_VERSION,
                 comps: cleanComps, wires, nextCompId, nextWireId, view, tick,
                 subcircuitDefs, customGates };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'tritlogic_circuit.json'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      // Version check.  Missing field = legacy save (treat as version 0 and
      // accept).  Newer version than we know about = warn but load anyway.
      const v = data.version;
      if (typeof v === 'number' && v > SAVE_FORMAT_VERSION) {
        if (!confirm(`Save file is format version ${v}; this build only knows up to ${SAVE_FORMAT_VERSION}. Load anyway?`)) return;
      }
      pushHistory();
      comps = data.comps || [];
      wires = data.wires || [];
      syncCompMap();
      nextCompId = data.nextCompId || (comps.reduce((m,c) => Math.max(m,c.id), 0) + 1);
      nextWireId = data.nextWireId || (wires.reduce((m,w) => Math.max(m,w.id), 0) + 1);
      view = data.view || { tx: 40, ty: 40, scale: 1 };
      tick = data.tick || 0;
      subcircuitDefs = data.subcircuitDefs || {};
      registerBuiltinSubcircuits();   // keep the built-ins present after a load
      customGates    = data.customGates    || {};
      selection.clear(); selectedWire = null;
      outVals = {};
      refreshSubLib();
      refreshGateLib();
      simulate(); draw(); updateInspector();
      const warnings = validateCircuit();
      if (warnings.length) {
        console.warn('Loaded circuit produced ' + warnings.length + ' validation warning(s):');
        for (const w of warnings) console.warn('  ' + w);
        setStatus(`loaded with ${warnings.length} validation warning(s) — see console`);
      }
    } catch (err) { alert('Could not load file: ' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ============================================================================
//  TRUTH TABLE
// ============================================================================

function openTruthTable() {
  // Populate sweep lists from current top-level comps.
  const inputs = comps.filter(c => c.type === 'INPUT' || c.type === 'CONST');
  const outputs = comps.filter(c => c.type === 'OUTPUT');
  const inEl = document.getElementById('tt-inputs');
  const outEl = document.getElementById('tt-outputs');
  inEl.innerHTML = ''; outEl.innerHTML = '';
  if (inputs.length === 0) inEl.innerHTML = '<span style="color:var(--muted)">No INPUT or CONST components.</span>';
  if (outputs.length === 0) outEl.innerHTML = '<span style="color:var(--muted)">No OUTPUT components.</span>';
  for (const c of inputs) {
    const id = 'tt-in-' + c.id;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" id="${id}" data-id="${c.id}" />
                     ${c.type} #${c.id}${c.state.name ? ' ('+escapeHtml(c.state.name)+')' : ''}`;
    inEl.appendChild(lbl);
  }
  for (const c of outputs) {
    const id = 'tt-out-' + c.id;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" id="${id}" data-id="${c.id}" checked />
                     ${c.type} #${c.id}${c.state.name ? ' ('+escapeHtml(c.state.name)+')' : ''}`;
    outEl.appendChild(lbl);
  }
  // Auto-check first few inputs
  inEl.querySelectorAll('input').forEach((el, i) => { if (i < 3) el.checked = true; });
  document.getElementById('tt-result').innerHTML = '';
  openModal('tt-modal');
}

document.getElementById('tt-generate').addEventListener('click', () => {
  const swept = Array.from(document.querySelectorAll('#tt-inputs input:checked'))
    .map(el => parseInt(el.dataset.id, 10)).map(getComp).filter(Boolean);
  const shown = Array.from(document.querySelectorAll('#tt-outputs input:checked'))
    .map(el => parseInt(el.dataset.id, 10)).map(getComp).filter(Boolean);
  if (swept.length === 0) { alert('Select at least one input to sweep.'); return; }
  if (swept.length > 7) { alert('At most 7 swept inputs (limit: 2,187 rows).'); return; }
  // Save state — wrapped in try/finally below so a throw inside simulate()
  // can't leave the user's INPUT components stuck at sweep values.
  const savedValues = swept.map(c => c.state.value);
  const rows = Math.pow(3, swept.length);
  const tritOrder = [-1, 0, 1];
  let html = '<table><thead><tr>';
  for (const c of swept) html += `<th>${c.state.name || (c.type + '#' + c.id)}</th>`;
  for (const c of shown) html += `<th>${c.state.name || (c.type + '#' + c.id)}</th>`;
  html += '</tr></thead><tbody>';
  try {
  for (let r = 0; r < rows; r++) {
    let n = r;
    for (let i = 0; i < swept.length; i++) {
      swept[i].state.value = tritOrder[n % 3];
      n = Math.floor(n / 3);
    }
    simulate();
    html += '<tr>';
    for (const c of swept) {
      const v = c.state.value;
      html += `<td class="input-cell ${tritClass(v)}">${tritLabel(v)}</td>`;
    }
    for (const c of shown) {
      const v = inputValueFromWires({comps,wires,outVals}, c.id, 'in');
      html += `<td class="${tritClass(v)}">${tritLabel(v)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('tt-result').innerHTML = html;
  } finally {
    // Restore state.  Runs even if simulate() threw inside the loop above.
    swept.forEach((c, i) => c.state.value = savedValues[i]);
    simulate(); draw();
  }
});

// ============================================================================
//  PACK MODAL
// ============================================================================

function openPackModal() {
  if (selection.size === 0) {
    alert('Select components first (drag a rectangle on empty space).');
    return;
  }
  const inSelComps = Array.from(selection).map(getComp).filter(Boolean);
  const ins = inSelComps.filter(c => c.type === 'INPUT').sort((a,b)=>a.y-b.y);
  const outs = inSelComps.filter(c => c.type === 'OUTPUT').sort((a,b)=>a.y-b.y);
  if (ins.length === 0 && outs.length === 0) {
    alert('Selection must contain at least one INPUT or OUTPUT for pin definitions.');
    return;
  }
  const form = document.getElementById('pack-form');
  form.innerHTML = `
    <label>Subcircuit name</label>
    <input id="pack-name" type="text" value="MyBlock${Object.keys(subcircuitDefs).length+1}" />
    <h4 style="font-size:11px; color: var(--muted); margin: 12px 0 4px 0;">Input pins</h4>
    ${ins.map((c,i) => `
      <label>INPUT #${c.id} → pin name</label>
      <input data-pinkey="in_${c.id}" type="text" value="${escapeHtml(c.state.name || ('in' + i))}" />
    `).join('')}
    <h4 style="font-size:11px; color: var(--muted); margin: 12px 0 4px 0;">Output pins</h4>
    ${outs.map((c,i) => `
      <label>OUTPUT #${c.id} → pin name</label>
      <input data-pinkey="out_${c.id}" type="text" value="${escapeHtml(c.state.name || ('out' + i))}" />
    `).join('')}
  `;
  openModal('pack-modal');
}
document.getElementById('pack-confirm').addEventListener('click', () => {
  const name = document.getElementById('pack-name').value.trim();
  if (!name) { alert('Name required.'); return; }
  if (subcircuitDefs[name]) {
    if (!confirm(`Subcircuit "${name}" already exists. Overwrite?`)) return;
  }
  const renames = {};
  document.querySelectorAll('#pack-form input[data-pinkey]').forEach(el => {
    renames[el.dataset.pinkey] = el.value.trim();
  });
  packSelection(name, renames);
  closeModal('pack-modal');
});

// ============================================================================
//  EXAMPLES
// ============================================================================
//
//  Each example is a builder that returns {comps, wires}.  We assign IDs
//  by passing a small "id" closure so wires can reference comps by their
//  builder-local labels rather than hard-coded numbers — far easier to
//  edit and reorder than the original example.

function buildExample(buildFn) {
  let nextId = 1;
  const labels = {};
  function comp(label, type, x, y, state) {
    // Seed from the type's own defaults so sequential components (DFF,
    // REG3, RAM, ...) always carry their full internal state; any explicit
    // values the example passes override the defaults per key.
    const def = TYPES[type];
    const base = (def && def.defaults) ? def.defaults() : {};
    const c = { id: nextId++, type, x, y, state: { ...base, ...(state || {}) } };
    labels[label] = c.id;
    return c;
  }
  function wire(fromLabel, fromPort, toLabel, toPort) {
    return { id: 0, fromId: labels[fromLabel], fromPort, toId: labels[toLabel], toPort };
  }
  const result = buildFn(comp, wire);
  result.wires.forEach((w, i) => { w.id = i + 1; });
  return result;
}

// The "multiply-by-trit" cell, packaged as a subcircuit definition so the
// matrix-vector example can place it as a single block instead of an STI +
// MUX pair.  Inside: an STI negates the activation x, and a MUX uses the
// weight trit w to select pass (w=+1) / zero (w=0) / negate (w=T).  The
// block's output is p = w · x.
function buildTmulDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('w',  'INPUT',  40,  40,  { value: 0, name: 'w' }),
      c('x',  'INPUT',  40,  110, { value: 0, name: 'x' }),
      c('z',  'CONST',  40,  180, { value: 0 }),
      c('ng', 'STI',    190, 95),
      c('mx', 'SUB:MUX3', 330, 78),
      c('p',  'OUTPUT', 500, 120, { name: 'p' }),
    ],
    wires: [
      w('x',  'out', 'ng', 'in'),
      w('w',  'out', 'mx', 's'),
      w('ng', 'out', 'mx', 'dT'),
      w('z',  'out', 'mx', 'd0'),
      w('x',  'out', 'mx', 'dP'),
      w('mx', 'out', 'p',  'in'),
    ],
  }));
  return {
    inputs: [{ name: 'w' }, { name: 'x' }],
    outputs: [{ name: 'p' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, x) => Math.max(m, x.id), 0) + 1,
  };
}

// A complete 3-element ternary-weight dot product, packaged as a subcircuit:
// inputs w0..w2 and x0..x2, outputs the 2-trit result lo/hi (value 3·hi+lo).
// Inside it is the ternary-MAC example — three multiply-by-trit cells
// (STI + MUX) feeding an ADDER tree.  One MAC3 block is one neuron's worth
// of arithmetic.
function buildMac3Def() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [], wires = [];
    comps.push(c('z', 'CONST', 40, 360, { value: 0 }));
    for (let i = 0; i < 3; i++) {
      const y = 40 + i * 90;
      comps.push(c('w' + i,  'INPUT', 40, y,      { value: 0, name: 'w' + i }));
      comps.push(c('x' + i,  'INPUT', 40, y + 42, { value: 0, name: 'x' + i }));
      comps.push(c('ng' + i, 'STI',   200, y + 24));
      comps.push(c('mx' + i, 'SUB:MUX3', 340, y + 12));
      wires.push(w('x' + i,  'out', 'ng' + i, 'in'));
      wires.push(w('w' + i,  'out', 'mx' + i, 's'));
      wires.push(w('ng' + i, 'out', 'mx' + i, 'dT'));
      wires.push(w('z',      'out', 'mx' + i, 'd0'));
      wires.push(w('x' + i,  'out', 'mx' + i, 'dP'));
    }
    comps.push(c('a1', 'ADDER', 500, 90));
    comps.push(c('a2', 'ADDER', 640, 210));
    comps.push(c('a3', 'ADDER', 640, 340));
    comps.push(c('lo', 'OUTPUT', 820, 236, { name: 'lo' }));
    comps.push(c('hi', 'OUTPUT', 820, 366, { name: 'hi' }));
    wires.push(w('mx0', 'out',  'a1', 'a'));
    wires.push(w('mx1', 'out',  'a1', 'b'));
    wires.push(w('z',   'out',  'a1', 'cin'));
    wires.push(w('a1',  'sum',  'a2', 'a'));
    wires.push(w('mx2', 'out',  'a2', 'b'));
    wires.push(w('z',   'out',  'a2', 'cin'));
    wires.push(w('a1',  'cout', 'a3', 'a'));
    wires.push(w('a2',  'cout', 'a3', 'b'));
    wires.push(w('z',   'out',  'a3', 'cin'));
    wires.push(w('a2',  'sum',  'lo', 'in'));
    wires.push(w('a3',  'sum',  'hi', 'in'));
    return { comps, wires };
  });
  return {
    inputs: [{ name: 'w0' }, { name: 'w1' }, { name: 'w2' },
             { name: 'x0' }, { name: 'x1' }, { name: 'x2' }],
    outputs: [{ name: 'lo' }, { name: 'hi' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, x) => Math.max(m, x.id), 0) + 1,
  };
}

// The sign() activation, packaged as a subcircuit: inputs lo/hi (a 2-trit
// value, −3..+3), output s = sign of that value, one trit {T,0,+1}.
// The high trit dominates (|3·hi| ≥ 3 > |lo|), so sign is just "hi when hi
// is non-zero, else lo" — which is exactly one MUX selecting on hi.
function buildActDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('lo', 'INPUT',  40,  40,  { value: 0, name: 'lo' }),
      c('hi', 'INPUT',  40,  110, { value: 0, name: 'hi' }),
      c('mx', 'SUB:MUX3', 220, 60),
      c('s',  'OUTPUT', 400, 100, { name: 's' }),
    ],
    wires: [
      w('hi', 'out', 'mx', 's'),    // select on the high trit
      w('hi', 'out', 'mx', 'dT'),   // hi = T  → output hi (= T)
      w('lo', 'out', 'mx', 'd0'),   // hi = 0  → output lo
      w('hi', 'out', 'mx', 'dP'),   // hi = +1 → output hi (= +1)
      w('mx', 'out', 's',  'in'),
    ],
  }));
  return {
    inputs: [{ name: 'lo' }, { name: 'hi' }],
    outputs: [{ name: 's' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, x) => Math.max(m, x.id), 0) + 1,
  };
}

// TSUM — the carry-free balanced-ternary sum of two trits: x + y folded
// back into {T,0,+1}. Mod-3 addition is non-monotone, so it cannot be made
// from MIN/MAX alone (those are monotone). The non-monotone primitive is the
// MUX: operand y selects one of three rotations of x.
function buildTsumDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('x',   'INPUT',  40,  40,  { value: 0, name: 'x' }),
      c('y',   'INPUT',  40,  330, { value: 0, name: 'y' }),
      c('cN',  'CONST',  40,  120, { value: -1 }),
      c('cZ',  'CONST',  40,  170, { value: 0 }),
      c('cP',  'CONST',  40,  220, { value: 1 }),
      c('rUp', 'SUB:MUX3', 220, 40),
      c('rDn', 'SUB:MUX3', 220, 200),
      c('mux', 'SUB:MUX3', 440, 150),
      c('s',   'OUTPUT', 620, 190, { name: 'sum' }),
    ],
    wires: [
      // rUp = rotate-up(x):   x = T/0/+1 routes 0 / +1 / T
      w('x',  'out', 'rUp', 's'),
      w('cZ', 'out', 'rUp', 'dT'),
      w('cP', 'out', 'rUp', 'd0'),
      w('cN', 'out', 'rUp', 'dP'),
      // rDn = rotate-down(x): x = T/0/+1 routes +1 / T / 0
      w('x',  'out', 'rDn', 's'),
      w('cP', 'out', 'rDn', 'dT'),
      w('cN', 'out', 'rDn', 'd0'),
      w('cZ', 'out', 'rDn', 'dP'),
      // y selects rotate-down / x unchanged / rotate-up
      w('y',   'out', 'mux', 's'),
      w('rDn', 'out', 'mux', 'dT'),
      w('x',   'out', 'mux', 'd0'),
      w('rUp', 'out', 'mux', 'dP'),
      w('mux', 'out', 's',   'in'),
    ],
  }));
  return {
    inputs: [{ name: 'x' }, { name: 'y' }],
    outputs: [{ name: 'sum' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// TCARRY — the carry of adding two trits: +1 only when both are +1, T only
// when both are T, else 0. The carry is monotone, so MIN/MAX carry the load;
// operand y selects MIN(x,0) / 0 / MAX(x,0).
function buildTcarryDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('x',   'INPUT',  40,  40,  { value: 0, name: 'x' }),
      c('y',   'INPUT',  40,  300, { value: 0, name: 'y' }),
      c('cZ',  'CONST',  40,  170, { value: 0 }),
      c('mn',  'MIN',    220, 40),
      c('mx',  'MAX',    220, 150),
      c('mux', 'SUB:MUX3', 420, 120),
      c('c',   'OUTPUT', 600, 160, { name: 'carry' }),
    ],
    wires: [
      w('x',  'out', 'mn', 'a'),
      w('cZ', 'out', 'mn', 'b'),
      w('x',  'out', 'mx', 'a'),
      w('cZ', 'out', 'mx', 'b'),
      w('y',  'out', 'mux', 's'),
      w('mn', 'out', 'mux', 'dT'),
      w('cZ', 'out', 'mux', 'd0'),
      w('mx', 'out', 'mux', 'dP'),
      w('mux','out', 'c',   'in'),
    ],
  }));
  return {
    inputs: [{ name: 'x' }, { name: 'y' }],
    outputs: [{ name: 'carry' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// FADD — a full-trit adder built structurally from TSUM/TCARRY subcircuits:
// the circuit-level equivalent of the native ADDER. Two half-adds chain
// a, b and cin; a final TSUM combines the two carries into the carry-out.
function buildFaddDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('a',    'INPUT',      40,  40,  { value: 0, name: 'a' }),
      c('b',    'INPUT',      40,  130, { value: 0, name: 'b' }),
      c('cin',  'INPUT',      40,  360, { value: 0, name: 'cin' }),
      c('ha1s', 'SUB:TSUM',   230, 40),
      c('ha1c', 'SUB:TCARRY', 230, 210),
      c('ha2s', 'SUB:TSUM',   450, 70),
      c('ha2c', 'SUB:TCARRY', 450, 300),
      c('csum', 'SUB:TSUM',   670, 200),
      c('outS', 'OUTPUT',     880, 110, { name: 'sum' }),
      c('outC', 'OUTPUT',     880, 250, { name: 'cout' }),
    ],
    wires: [
      // half-add 1:  a + b
      w('a', 'out', 'ha1s', 'x'),
      w('b', 'out', 'ha1s', 'y'),
      w('a', 'out', 'ha1c', 'x'),
      w('b', 'out', 'ha1c', 'y'),
      // half-add 2:  (sum of half-add 1) + cin
      w('ha1s', 'sum', 'ha2s', 'x'),
      w('cin',  'out', 'ha2s', 'y'),
      w('ha1s', 'sum', 'ha2c', 'x'),
      w('cin',  'out', 'ha2c', 'y'),
      // carry-out = TSUM of the two carries (always in range — no wrap)
      w('ha1c', 'carry', 'csum', 'x'),
      w('ha2c', 'carry', 'csum', 'y'),
      // results
      w('ha2s', 'sum', 'outS', 'in'),
      w('csum', 'sum', 'outC', 'in'),
    ],
  }));
  return {
    inputs: [{ name: 'a' }, { name: 'b' }, { name: 'cin' }],
    outputs: [{ name: 'sum' }, { name: 'cout' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// ALU3 — the structural equivalent of the native ALU. Two 3-trit words and
// a 1-trit op select → a 3-trit result + carry-out. All three operations are
// computed in parallel and a MUX (steered by op) selects which one reaches
// the output: op = T → MIN, op = 0 → ADD (ripple of three FADDs), op = +1 →
// MAX. Built from FADD / MIN / MAX / MUX — every part itself openable.
function buildAlu3Def() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [], wires = [];
    comps.push(c('op', 'INPUT', 40, 400, { value: 0, name: 'op' }));
    comps.push(c('cZ', 'CONST', 40, 470, { value: 0 }));
    for (let i = 0; i < 3; i++) {
      const yB = 40 + i * 150;
      comps.push(c('a' + i, 'INPUT',    40,  yB,      { value: 0, name: 'a' + i }));
      comps.push(c('b' + i, 'INPUT',    40,  yB + 60, { value: 0, name: 'b' + i }));
      comps.push(c('mn' + i, 'MIN',     230, yB));
      comps.push(c('mx' + i, 'MAX',     230, yB + 70));
      comps.push(c('fa' + i, 'SUB:FADD',410, yB));
      comps.push(c('rm' + i, 'SUB:MUX3', 620, yB + 20));
      comps.push(c('r' + i,  'OUTPUT',  800, yB + 38, { name: 'r' + i }));
      // per-trit MIN and MAX
      wires.push(w('a' + i, 'out', 'mn' + i, 'a'));
      wires.push(w('b' + i, 'out', 'mn' + i, 'b'));
      wires.push(w('a' + i, 'out', 'mx' + i, 'a'));
      wires.push(w('b' + i, 'out', 'mx' + i, 'b'));
      // ripple-carry full add: each FADD's carry-out feeds the next's cin
      wires.push(w('a' + i, 'out', 'fa' + i, 'a'));
      wires.push(w('b' + i, 'out', 'fa' + i, 'b'));
      wires.push(w(i === 0 ? 'cZ' : 'fa' + (i - 1),
                   i === 0 ? 'out' : 'cout', 'fa' + i, 'cin'));
      // op selects MIN / ADD-sum / MAX into the result trit
      wires.push(w('op',     'out', 'rm' + i, 's'));
      wires.push(w('mn' + i, 'out', 'rm' + i, 'dT'));
      wires.push(w('fa' + i, 'sum', 'rm' + i, 'd0'));
      wires.push(w('mx' + i, 'out', 'rm' + i, 'dP'));
      wires.push(w('rm' + i, 'out', 'r' + i,  'in'));
    }
    // carry-out: the ripple carry for ADD, a constant 0 for MIN and MAX
    comps.push(c('cm', 'SUB:MUX3', 620, 510));
    comps.push(c('co', 'OUTPUT', 800, 528, { name: 'cout' }));
    wires.push(w('op',  'out',  'cm', 's'));
    wires.push(w('cZ',  'out',  'cm', 'dT'));
    wires.push(w('fa2', 'cout', 'cm', 'd0'));
    wires.push(w('cZ',  'out',  'cm', 'dP'));
    wires.push(w('cm',  'out',  'co', 'in'));
    return { comps, wires };
  });
  return {
    inputs: [{ name: 'a0' }, { name: 'a1' }, { name: 'a2' },
             { name: 'b0' }, { name: 'b1' }, { name: 'b2' }, { name: 'op' }],
    outputs: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }, { name: 'cout' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// MUX3 — a 3:1 ternary multiplexer built from MIN / MAX / STI / NTI, with no
// MUX inside it. It shows that the MUX (which TMUL, ACT, TSUM ... all lean
// on) is not fundamental: decode the select s into three case detectors,
// mask each data input to −1 unless its detector fires, then MAX-combine.
function buildMux3Def() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('s',    'INPUT',  40,   40,  { value: 0, name: 's'  }),
      c('dT',   'INPUT',  40,   130, { value: 0, name: 'dT' }),
      c('d0',   'INPUT',  40,   200, { value: 0, name: 'd0' }),
      c('dP',   'INPUT',  40,   270, { value: 0, name: 'dP' }),
      c('sNeg', 'STI',    210,  40),
      c('isT',  'NTI',    210,  120),
      c('isP',  'NTI',    370,  40),
      c('mxT',  'MAX',    370,  130),
      c('is0',  'STI',    530,  140),
      c('gT',   'MIN',    690,  40),
      c('g0',   'MIN',    690,  150),
      c('gP',   'MIN',    690,  260),
      c('c1',   'MAX',    850,  90),
      c('mxF',  'MAX',    1000, 170),
      c('o',    'OUTPUT', 1170, 190, { name: 'out' }),
    ],
    wires: [
      // decode the select trit into three detectors (+1 = "this case holds")
      w('s',    'out', 'sNeg', 'in'),   // sNeg = −s
      w('s',    'out', 'isT',  'in'),   // isT  = +1 iff s = T
      w('sNeg', 'out', 'isP',  'in'),   // isP  = +1 iff s = +1
      w('isT',  'out', 'mxT',  'a'),
      w('isP',  'out', 'mxT',  'b'),
      w('mxT',  'out', 'is0',  'in'),   // is0  = +1 iff s = 0
      // mask each data input: MIN(d, +1) = d when selected, MIN(d, T) = −1 when not
      w('dT',   'out', 'gT', 'a'),
      w('isT',  'out', 'gT', 'b'),
      w('d0',   'out', 'g0', 'a'),
      w('is0',  'out', 'g0', 'b'),
      w('dP',   'out', 'gP', 'a'),
      w('isP',  'out', 'gP', 'b'),
      // MAX keeps the one value that got through (the other two are −1)
      w('gT',   'out', 'c1',  'a'),
      w('g0',   'out', 'c1',  'b'),
      w('c1',   'out', 'mxF', 'a'),
      w('gP',   'out', 'mxF', 'b'),
      w('mxF',  'out', 'o',   'in'),
    ],
  }));
  return {
    inputs: [{ name: 's' }, { name: 'dT' }, { name: 'd0' }, { name: 'dP' }],
    outputs: [{ name: 'out' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// ============================================================================
//  SEQUENTIAL KIT — gate-level structural twins of the stateful primitives
// ============================================================================
//
//  The combinational kit (TSUM/TCARRY/FADD/MUX3/ALU3) proved every native
//  arithmetic component can be opened up. The sequential kit does the same
//  for the stateful side: DFF / REG3 / RAM / PC, all rebuilt from
//  cross-coupled gate networks with no native sequential primitive inside.
//
//  How can pure combinational gates store state? Through the fixed-point
//  solver. The subcircuit's outVals carry between simulate() calls (the
//  subScope is reused), and cloneSubScope seeds them to 0 — so a feedback
//  loop like q = MAX(MIN(d, en), MIN(q, NOT en)) has a defined starting
//  value, and the solver settles on it. When en holds, the loop is q := q,
//  a stable fixed point at whatever the previous call left.

// TLATCH — a transparent ternary D-latch (one trit, level-sensitive).
// While en=+1 the output follows d ("transparent"); while en=T the latch
// holds its previous value. The en pin MUST be either +1 or T — at en=0
// the storage formula breaks. (The TFLOP master-slave wrapper makes sure
// of this by deriving en through PTI.)
//
// Mechanism:
//   en_n = STI(en)        — invert the enable
//   load = MIN(d, en)     — pass d when en=+1, give T when en=T
//   hold = MIN(q, en_n)   — pass q when en=T, give T when en=+1
//   q    = MAX(load, hold) — feedback closes the loop
function buildTlatchDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('d',    'INPUT',  40,  40,  { value: 0, name: 'd'  }),
      c('en',   'INPUT',  40,  130, { value: 0, name: 'en' }),
      c('inv',  'STI',    210, 130),
      c('ld',   'MIN',    400, 40),
      c('hl',   'MIN',    400, 160),
      c('mx',   'MAX',    600, 100),
      c('q',    'OUTPUT', 780, 110, { name: 'q' }),
    ],
    wires: [
      w('en',  'out', 'inv', 'in'),
      w('d',   'out', 'ld',  'a'),
      w('en',  'out', 'ld',  'b'),
      w('mx',  'out', 'hl',  'a'),   // feedback: hold path reads current q
      w('inv', 'out', 'hl',  'b'),
      w('ld',  'out', 'mx',  'a'),
      w('hl',  'out', 'mx',  'b'),
      w('mx',  'out', 'q',   'in'),
    ],
  }));
  return {
    inputs: [{ name: 'd' }, { name: 'en' }],
    outputs: [{ name: 'q' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// TFLOP — the gate-level structural twin of the native DFF: an edge-
// triggered D flip-flop built master-slave from two TLATCHes, with no
// primitive flop inside. Samples d on the rising clock edge to +1.
//
// Clock derivation (PTI quantises the tri-state clock to {T,+1} so the
// latches never see en=0):
//   en_slave  = STI(PTI(clk))   = +1 when clk=+1, else T
//   en_master = STI(en_slave)   = T when clk=+1, else +1
//
// Master is transparent while clk is not +1 (catches d), holds at clk=+1.
// Slave is the opposite — transparent at clk=+1, holds otherwise. So the
// edge from non-+1 → +1 closes the master on its last d and opens the
// slave to copy it: exactly the rising-edge sample the native DFF does.
function buildTflopDef() {
  const { comps, wires } = buildExample((c, w) => ({
    comps: [
      c('d',    'INPUT',  40,  40,  { value: 0, name: 'd'   }),
      c('clk',  'INPUT',  40,  160, { value: 0, name: 'clk' }),
      c('pti',  'PTI',    210, 160),
      c('iSl',  'STI',    370, 160),   // en_slave
      c('iMa',  'STI',    530, 160),   // en_master
      c('lm',   'SUB:TLATCH', 700, 40), // master
      c('ls',   'SUB:TLATCH', 900, 90), // slave
      c('q',    'OUTPUT', 1090, 110, { name: 'q' }),
    ],
    wires: [
      w('clk', 'out', 'pti', 'in'),
      w('pti', 'out', 'iSl', 'in'),
      w('iSl', 'out', 'iMa', 'in'),
      w('d',   'out', 'lm',  'd'),
      w('iMa', 'out', 'lm',  'en'),
      w('lm',  'q',   'ls',  'd'),
      w('iSl', 'out', 'ls',  'en'),
      w('ls',  'q',   'q',   'in'),
    ],
  }));
  return {
    inputs: [{ name: 'd' }, { name: 'clk' }],
    outputs: [{ name: 'q' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// TREG3 — gate-level 3-trit register. Three TFLOPs sharing one clock, plus
// a per-trit MUX3 that interprets the load-enable line as a TRUE ternary
// control (this is the "fold in the tri-state load" extension the native
// REG3 lacks):
//
//   ld = +1  → load:  d_eff = d_in        (sample new data on the edge)
//   ld =  0  → hold:  d_eff = q           (feedback — re-store current q)
//   ld =  T  → clear: d_eff = 0           (sample a zero constant)
//
// So one TREG3 is three TFLOPs + three MUX3 selectors + one CONST 0. The
// q→MUX3→TFLOP.d feedback in hold mode is harmless: on a non-edge the
// TFLOP doesn't sample, and on an edge it samples q itself, a no-op.
function buildTreg3Def() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [], wires = [];
    comps.push(c('clk', 'INPUT', 40, 400, { value: 0, name: 'clk' }));
    comps.push(c('ld',  'INPUT', 40, 460, { value: 0, name: 'ld'  }));
    comps.push(c('cZ',  'CONST', 40, 520, { value: 0 }));
    for (let i = 0; i < 3; i++) {
      const yB = 40 + i * 130;
      comps.push(c('d' + i, 'INPUT',      40,  yB,      { value: 0, name: 'd' + i }));
      comps.push(c('mx' + i, 'SUB:MUX3',  240, yB - 10));
      comps.push(c('ff' + i, 'SUB:TFLOP', 470, yB - 10));
      comps.push(c('q' + i,  'OUTPUT',    690, yB + 5,  { name: 'q' + i }));
      // ld selects: dT = clear (0), d0 = hold (q feedback), dP = load (d)
      wires.push(w('ld',     'out', 'mx' + i, 's'));
      wires.push(w('cZ',     'out', 'mx' + i, 'dT'));
      wires.push(w('ff' + i, 'q',   'mx' + i, 'd0'));   // hold-feedback
      wires.push(w('d' + i,  'out', 'mx' + i, 'dP'));
      wires.push(w('mx' + i, 'out', 'ff' + i, 'd'));
      wires.push(w('clk',    'out', 'ff' + i, 'clk'));
      wires.push(w('ff' + i, 'q',   'q' + i,  'in'));
    }
    return { comps, wires };
  });
  return {
    inputs: [{ name: 'd0' }, { name: 'd1' }, { name: 'd2' },
             { name: 'clk' }, { name: 'ld' }],
    outputs: [{ name: 'q0' }, { name: 'q1' }, { name: 'q2' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// TPC — gate-level 2-trit program counter, the structural twin of native
// PC. Two TFLOPs hold the address; two FADDs do the +1 increment (with
// the top carry discarded, which naturally wraps word 8 → 0); a MUX3 per
// trit picks between the increment and the jump target.
//
// jmp selector: native PC only looks at jmp=+1, treating anything else
// as "increment". So the MUX3 wires increment to BOTH dT and d0, and the
// jump target to dP — every non-+1 jmp value still picks the increment.
function buildTpcDef() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [], wires = [];
    comps.push(c('clk', 'INPUT', 40, 360, { value: 0, name: 'clk' }));
    comps.push(c('jmp', 'INPUT', 40, 420, { value: 0, name: 'jmp' }));
    comps.push(c('j0',  'INPUT', 40, 60,  { value: 0, name: 'j0'  }));
    comps.push(c('j1',  'INPUT', 40, 200, { value: 0, name: 'j1'  }));
    comps.push(c('cZ',  'CONST', 40, 480, { value: 0 }));
    comps.push(c('cP',  'CONST', 40, 530, { value: 1 }));
    // Per-trit: FADD adds 1 with carry chained low → high, then a MUX3
    // selects increment vs jump target. TFLOP latches the selection.
    comps.push(c('fa0', 'SUB:FADD', 240,  60));
    comps.push(c('fa1', 'SUB:FADD', 240, 200));
    comps.push(c('mx0', 'SUB:MUX3', 470,  80));
    comps.push(c('mx1', 'SUB:MUX3', 470, 220));
    comps.push(c('ff0', 'SUB:TFLOP', 690,  80));
    comps.push(c('ff1', 'SUB:TFLOP', 690, 220));
    comps.push(c('p0',  'OUTPUT',   900,  95, { name: 'p0' }));
    comps.push(c('p1',  'OUTPUT',   900, 235, { name: 'p1' }));
    // Low trit: a=p0, b=+1, cin=0 → sum=inc0, cout=c01
    wires.push(w('ff0', 'q',   'fa0', 'a'));
    wires.push(w('cP',  'out', 'fa0', 'b'));
    wires.push(w('cZ',  'out', 'fa0', 'cin'));
    // High trit: a=p1, b=0, cin=c01 → sum=inc1, cout discarded (wrap)
    wires.push(w('ff1', 'q',   'fa1', 'a'));
    wires.push(w('cZ',  'out', 'fa1', 'b'));
    wires.push(w('fa0', 'cout', 'fa1', 'cin'));
    // MUX3: s=jmp; dT=inc, d0=inc (any non-+1 increments), dP=jump target
    for (const i of [0, 1]) {
      wires.push(w('jmp', 'out', 'mx' + i, 's'));
      wires.push(w('fa' + i, 'sum', 'mx' + i, 'dT'));
      wires.push(w('fa' + i, 'sum', 'mx' + i, 'd0'));
      wires.push(w('j'  + i, 'out', 'mx' + i, 'dP'));
      wires.push(w('mx' + i, 'out', 'ff' + i, 'd'));
      wires.push(w('clk',    'out', 'ff' + i, 'clk'));
      wires.push(w('ff' + i, 'q',   'p'  + i, 'in'));
    }
    return { comps, wires };
  });
  return {
    inputs: [{ name: 'clk' }, { name: 'jmp' }, { name: 'j0' }, { name: 'j1' }],
    outputs: [{ name: 'p0' }, { name: 'p1' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// TRAM — gate-level 9-word × 3-trit RAM, the structural twin of native
// RAM. Nine TREG3 instances form the storage array; a one-hot address
// decoder steers writes; a 2-level MUX3 tree reads the addressed word.
//
// Address decoding: detect a0 ∈ {T,0,+1} and a1 ∈ {T,0,+1} separately
// using NTI / is0 / STI∘PTI, then MIN-AND the row and column detectors
// into nine per-word selects. Each word's load-enable is MIN(sel_i, we) —
// the addressed word loads when we=+1 and the address is matched.
//
// Reading: MUX3 selects between the three trits, no clock required. Two
// levels — a0 picks within each row, a1 picks between rows.
function buildTramDef() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [], wires = [];
    // ── inputs and constants ──
    comps.push(c('a0',  'INPUT', 40,  40,  { value: 0, name: 'a0'  }));
    comps.push(c('a1',  'INPUT', 40,  80,  { value: 0, name: 'a1'  }));
    comps.push(c('d0',  'INPUT', 40,  140, { value: 0, name: 'd0'  }));
    comps.push(c('d1',  'INPUT', 40,  180, { value: 0, name: 'd1'  }));
    comps.push(c('d2',  'INPUT', 40,  220, { value: 0, name: 'd2'  }));
    comps.push(c('we',  'INPUT', 40,  280, { value: 0, name: 'we'  }));
    comps.push(c('clk', 'INPUT', 40,  320, { value: 0, name: 'clk' }));

    // ── trit-equality detectors for a0 and a1 ──
    // isT = NTI; isP = STI∘PTI; is0 = MIN(PTI, STI∘NTI). Each detector
    // returns +1 when the address trit matches the constant, T otherwise.
    function buildDetectors(addrLabel, prefix, yBase) {
      // isT(addr): NTI
      comps.push(c(prefix + 'T', 'NTI', 220, yBase));
      wires.push(w(addrLabel, 'out', prefix + 'T', 'in'));
      // isP(addr): STI∘PTI
      comps.push(c(prefix + 'P_pti', 'PTI', 220, yBase + 30));
      comps.push(c(prefix + 'P',     'STI', 320, yBase + 30));
      wires.push(w(addrLabel,        'out', prefix + 'P_pti', 'in'));
      wires.push(w(prefix + 'P_pti', 'out', prefix + 'P',     'in'));
      // is0(addr): MIN(PTI(addr), STI(NTI(addr)))  — PTI reused from above
      comps.push(c(prefix + '0_nti', 'NTI', 220, yBase + 70));
      comps.push(c(prefix + '0_sti', 'STI', 320, yBase + 70));
      comps.push(c(prefix + '0',     'MIN', 420, yBase + 50));
      wires.push(w(addrLabel,        'out', prefix + '0_nti', 'in'));
      wires.push(w(prefix + '0_nti', 'out', prefix + '0_sti', 'in'));
      wires.push(w(prefix + 'P_pti', 'out', prefix + '0',     'a'));
      wires.push(w(prefix + '0_sti', 'out', prefix + '0',     'b'));
    }
    buildDetectors('a0', 'd0_', 40);   // detectors for a0
    buildDetectors('a1', 'd1_', 200);  // detectors for a1

    // ── per-word select (one-hot) and write enable, then 9 TREG3 words ──
    // Word index follows native RAM: idx = (a0+1) + (a1+1)*3, so the
    // ordering of detector pairs below matches the native decoder.
    //
    // Note on ld clamping: TREG3 interprets ld = T as *clear* (its
    // tri-state extension). The naïve formula ld_i = MIN(sel_i, we)
    // would feed T to every non-selected word during a write — clearing
    // eight words on every store. So ld_i is MAX'd against a CONST 0 to
    // clip negatives up to 0 (hold) — selected words still receive +1,
    // every other word gets 0 (hold), nothing accidentally clears.
    comps.push(c('cZero', 'CONST', 480, 1080, { value: 0 }));
    const a0sel = ['d0_T', 'd0_0', 'd0_P'];   // a0 = T, 0, +1 (col)
    const a1sel = ['d1_T', 'd1_0', 'd1_P'];   // a1 = T, 0, +1 (row)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const idx = col + row * 3;
        const yB = 40 + idx * 120;
        // sel_i = MIN(a0_match, a1_match)
        comps.push(c('sel' + idx, 'MIN', 600, yB));
        wires.push(w(a0sel[col], 'out', 'sel' + idx, 'a'));
        wires.push(w(a1sel[row], 'out', 'sel' + idx, 'b'));
        // ld_raw = MIN(sel_i, we)
        comps.push(c('ldR' + idx, 'MIN', 720, yB));
        wires.push(w('sel' + idx, 'out', 'ldR' + idx, 'a'));
        wires.push(w('we',        'out', 'ldR' + idx, 'b'));
        // ld_i = MAX(ld_raw, 0) — clamp to {0, +1} so non-selected words
        // see ld=0 (hold) rather than ld=T (clear).
        comps.push(c('ld' + idx, 'MAX', 800, yB));
        wires.push(w('ldR' + idx, 'out', 'ld' + idx, 'a'));
        wires.push(w('cZero',     'out', 'ld' + idx, 'b'));
        // The storage word — a TREG3 (which itself wraps three TFLOPs)
        comps.push(c('w' + idx, 'SUB:TREG3', 880, yB - 20));
        wires.push(w('d0',       'out',   'w' + idx, 'd0'));
        wires.push(w('d1',       'out',   'w' + idx, 'd1'));
        wires.push(w('d2',       'out',   'w' + idx, 'd2'));
        wires.push(w('clk',      'out',   'w' + idx, 'clk'));
        wires.push(w('ld' + idx, 'out',   'w' + idx, 'ld'));
      }
    }

    // ── 2-level MUX3 read tree, one per output trit ──
    // For each trit i, a0 picks within each row (mid_row_i), then a1
    // picks between rows (q_i). Matches the native (a0+1)+(a1+1)*3.
    const outNames = ['q0', 'q1', 'q2'];
    for (let i = 0; i < 3; i++) {
      const port = 'q' + i;
      // Row mux per a1 value — selects within a row using a0
      comps.push(c('mr' + i + 'T', 'SUB:MUX3', 1100, 100 + i * 380));
      comps.push(c('mr' + i + '0', 'SUB:MUX3', 1100, 200 + i * 380));
      comps.push(c('mr' + i + 'P', 'SUB:MUX3', 1100, 300 + i * 380));
      // Final mux — a1 picks between rows
      comps.push(c('out' + i, 'SUB:MUX3', 1320, 200 + i * 380));
      comps.push(c(outNames[i], 'OUTPUT', 1530, 215 + i * 380, { name: outNames[i] }));
      // Row T = words 0/1/2; Row 0 = 3/4/5; Row P = 6/7/8
      const rowWords = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
      const tags = ['T', '0', 'P'];
      for (let r = 0; r < 3; r++) {
        const mr = 'mr' + i + tags[r];
        wires.push(w('a0', 'out', mr, 's'));
        wires.push(w('w' + rowWords[r][0], port, mr, 'dT'));
        wires.push(w('w' + rowWords[r][1], port, mr, 'd0'));
        wires.push(w('w' + rowWords[r][2], port, mr, 'dP'));
      }
      wires.push(w('a1',          'out', 'out' + i, 's'));
      wires.push(w('mr' + i + 'T', 'out', 'out' + i, 'dT'));
      wires.push(w('mr' + i + '0', 'out', 'out' + i, 'd0'));
      wires.push(w('mr' + i + 'P', 'out', 'out' + i, 'dP'));
      wires.push(w('out' + i, 'out', outNames[i], 'in'));
    }
    return { comps, wires };
  });
  return {
    inputs: [{ name: 'a0' }, { name: 'a1' }, { name: 'd0' }, { name: 'd1' },
             { name: 'd2' }, { name: 'we' }, { name: 'clk' }],
    outputs: [{ name: 'q0' }, { name: 'q1' }, { name: 'q2' }],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

// The subcircuits this build ships with. Each names its builder and the kit
// (library-panel heading) it belongs to.
const BUILTIN_SUBCIRCUITS = {
  TMUL:   { kit: 'Neural-Net Kit', build: buildTmulDef },
  MAC3:   { kit: 'Neural-Net Kit', build: buildMac3Def },
  ACT:    { kit: 'Neural-Net Kit', build: buildActDef },
  TSUM:   { kit: 'Arithmetic Kit', build: buildTsumDef },
  TCARRY: { kit: 'Arithmetic Kit', build: buildTcarryDef },
  FADD:   { kit: 'Arithmetic Kit', build: buildFaddDef },
  ALU3:   { kit: 'Arithmetic Kit', build: buildAlu3Def },
  MUX3:   { kit: 'Arithmetic Kit', build: buildMux3Def },
  TLATCH: { kit: 'Sequential Kit', build: buildTlatchDef },
  TFLOP:  { kit: 'Sequential Kit', build: buildTflopDef },
  TREG3:  { kit: 'Sequential Kit', build: buildTreg3Def },
  TPC:    { kit: 'Sequential Kit', build: buildTpcDef },
  TRAM:   { kit: 'Sequential Kit', build: buildTramDef },
};
// Kit headings, in library-panel order.
const BUILTIN_SUBCIRCUIT_KITS = [
  { label: 'Neural-Net Kit', names: ['TMUL', 'MAC3', 'ACT'] },
  { label: 'Arithmetic Kit', names: ['TSUM', 'TCARRY', 'FADD', 'ALU3', 'MUX3'] },
  { label: 'Sequential Kit', names: ['TLATCH', 'TFLOP', 'TREG3', 'TPC', 'TRAM'] },
];
// Seed the built-ins into the library. Called at boot and re-called after a
// load; the `if absent` guard means a loaded file's own same-named
// definition (perhaps edited) is never overwritten by the built-in.
function registerBuiltinSubcircuits() {
  for (const name in BUILTIN_SUBCIRCUITS)
    if (!subcircuitDefs[name]) subcircuitDefs[name] = BUILTIN_SUBCIRCUITS[name].build();
}

// ============================================================================
//  ASSEMBLER (Phase 8 — ternary ISA)
// ============================================================================
//
//  Tiny text-to-trit assembler for the Phase 7 CPU's 3-op ISA. One
//  instruction per RAM word (9 words max). Each word is encoded as
//  [operand_low, operand_high, opcode] — same layout the CPU preset uses,
//  so the output goes straight into IMEM with no further translation.
//
//  Mnemonics  (opcode trit drives the ALU's op pin directly):
//    ADDI <n>     opcode  0   ACC = ACC + n        (n in -4..+4)
//    MAXI <n>     opcode +1   ACC = max(ACC, n)    (n in -4..+4)
//    JMP  <addr>  opcode  T   PC  ← addr           (addr in 0..8 or a label)
//
//  Labels: `LABEL:` at the start of a line names the next instruction's
//  address. Comments: `;` to end of line. Blank lines ignored.
//
//  Address encoding: the PC's stored trits p map to word index via
//  index = tritsToInt(p) + 4 (range 0..8). So `JMP 0` encodes its operand
//  as intToTrits(-4, 2) = [T, T]. The CPU example's existing program
//  (ADDI +1 / JMP 0) round-trips byte-for-byte through this assembler.

const ASM_OPCODES = {
  ADDI: { opTrit:  0, operandKind: 'imm'  },
  MAXI: { opTrit:  1, operandKind: 'imm'  },
  JMP:  { opTrit: -1, operandKind: 'addr' },
};
const ASM_PROGRAM_WORDS = 9;

function assemble(text) {
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  // Pass 1 — strip comments, collect labels, accumulate statements.
  const stmts = [];   // { srcLine, mnem, operand }
  const labels = {};
  let pc = 0;
  for (let i = 0; i < lines.length; i++) {
    let s = lines[i].replace(/;.*/, '').trim();
    if (!s) continue;
    const labMatch = s.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (labMatch) {
      const name = labMatch[1];
      if (Object.prototype.hasOwnProperty.call(labels, name)) {
        errors.push({ line: i + 1, msg: `duplicate label "${name}"` });
      } else {
        labels[name] = pc;
      }
      s = labMatch[2].trim();
      if (!s) continue;
    }
    if (pc >= ASM_PROGRAM_WORDS) {
      errors.push({ line: i + 1, msg: `program exceeds ${ASM_PROGRAM_WORDS} words (IMEM is ${ASM_PROGRAM_WORDS} deep)` });
      continue;
    }
    const m = s.match(/^([A-Za-z]+)\s+(\S.*?)\s*$/);
    if (!m) {
      errors.push({ line: i + 1, msg: `expected "MNEM operand", got: ${s}` });
      continue;
    }
    stmts.push({ srcLine: i + 1, mnem: m[1].toUpperCase(), operand: m[2] });
    pc++;
  }
  // Pass 2 — encode each statement.
  const mem = Array.from({ length: ASM_PROGRAM_WORDS }, () => [0, 0, 0]);
  for (let idx = 0; idx < stmts.length; idx++) {
    const st = stmts[idx];
    const op = ASM_OPCODES[st.mnem];
    if (!op) {
      errors.push({ line: st.srcLine, msg: `unknown mnemonic "${st.mnem}" (use ADDI / MAXI / JMP)` });
      continue;
    }
    let value;
    if (op.operandKind === 'addr') {
      // Label first, then a decimal integer 0..8.
      if (Object.prototype.hasOwnProperty.call(labels, st.operand)) {
        value = labels[st.operand];
      } else {
        const n = Number(st.operand);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          errors.push({ line: st.srcLine, msg: `unknown label or non-integer address: ${st.operand}` });
          continue;
        }
        value = n;
      }
      if (value < 0 || value > 8) {
        errors.push({ line: st.srcLine, msg: `JMP address ${value} out of range 0..8` });
        continue;
      }
      // PC stores p where tritsToInt(p) + 4 = word index → operand trits are intToTrits(addr − 4, 2).
      const tr = intToTrits(value - 4, 2);
      mem[idx] = [tr[0], tr[1], op.opTrit];
    } else {
      // 'imm' — signed integer, two-trit balanced range −4..+4.
      const n = Number(st.operand);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        errors.push({ line: st.srcLine, msg: `expected integer operand, got: ${st.operand}` });
        continue;
      }
      if (n < -4 || n > 4) {
        errors.push({ line: st.srcLine, msg: `${st.mnem} immediate ${n} out of range −4..+4 (operand is two trits)` });
        continue;
      }
      const tr = intToTrits(n, 2);
      mem[idx] = [tr[0], tr[1], op.opTrit];
    }
  }
  // addrToLine[i] = 1-based source line of the instruction at IMEM word i,
  // or null for the trailing padding words. The debugger uses this to map
  // the live PC back onto the source listing.
  const addrToLine = Array.from({ length: ASM_PROGRAM_WORDS }, () => null);
  for (let i = 0; i < stmts.length; i++) addrToLine[i] = stmts[i].srcLine;
  return { errors, mem, labels, words: stmts.length, addrToLine };
}

// A small library of pre-written programs the modal's example dropdown
// surfaces. Each is a string of assembly text.
const ASM_EXAMPLES = {
  'counter': {
    label: 'Counter — ADDI +1 / JMP 0 (the default CPU program)',
    src:
`; Increments ACC by 1 every two clock ticks, forever.
LOOP:
  ADDI +1
  JMP  LOOP
`,
  },
  'saturating-counter': {
    label: 'Saturating counter — counts up, clamps at +3',
    src:
`; ACC counts up, MAXI clamps it at +3, JMP loops.
; Settles to ACC = +3 and stays there.
LOOP:
  ADDI +1
  MAXI +3
  JMP  LOOP
`,
  },
  'down-up': {
    label: 'Bounce — adds +1, then subtracts back via MAXI floor',
    src:
`; Toggles ACC between two values by alternating ADDI +1 and ADDI -1,
; using MAXI to ensure a floor. Demonstrates negative immediates.
LOOP:
  ADDI +1
  ADDI -1
  MAXI -2
  JMP  LOOP
`,
  },
};

const EXAMPLES = {
  'sti-inverter': {
    label: 'STI inverter (NEG)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('a', 'INPUT',  100, 150, { value: 1, name: 'a' }),
        c('n', 'STI',    240, 145),
        c('y', 'OUTPUT', 360, 150, { name: 'y' }),
      ],
      wires: [
        w('a', 'out', 'n', 'in'),
        w('n', 'out', 'y', 'in'),
      ],
    })),
  },
  'sti-chain': {
    label: 'STI chain (double-negation is identity)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('a',  'INPUT',  100, 150, { value: 1, name: 'a' }),
        c('n1', 'STI',    240, 145),
        c('n2', 'STI',    360, 145),
        c('y',  'OUTPUT', 480, 150, { name: 'y' }),
      ],
      wires: [
        w('a',  'out', 'n1', 'in'),
        w('n1', 'out', 'n2', 'in'),
        w('n2', 'out', 'y',  'in'),
      ],
    })),
  },
  'min-max': {
    label: 'MIN / MAX (ternary AND / OR)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('a',   'INPUT',  100, 150, { value: -1, name: 'a' }),
        c('b',   'INPUT',  100, 230, { value:  1, name: 'b' }),
        c('mn',  'MIN',    260, 150),
        c('mx',  'MAX',    260, 250),
        c('ymn', 'OUTPUT', 400, 160, { name: 'min' }),
        c('ymx', 'OUTPUT', 400, 260, { name: 'max' }),
      ],
      wires: [
        w('a', 'out', 'mn', 'a'),
        w('b', 'out', 'mn', 'b'),
        w('a', 'out', 'mx', 'a'),
        w('b', 'out', 'mx', 'b'),
        w('mn', 'out', 'ymn', 'in'),
        w('mx', 'out', 'ymx', 'in'),
      ],
    })),
  },
  'half-adder': {
    label: 'Half-trit adder (cin = 0)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('a',   'INPUT',  100, 130, { value: 1, name: 'a' }),
        c('b',   'INPUT',  100, 190, { value: 1, name: 'b' }),
        c('z',   'CONST',  100, 260, { value: 0 }),
        c('add', 'ADDER',  240, 150),
        c('ys',  'OUTPUT', 400, 160, { name: 'sum' }),
        c('yc',  'OUTPUT', 400, 220, { name: 'cout' }),
      ],
      wires: [
        w('a',   'out',  'add', 'a'),
        w('b',   'out',  'add', 'b'),
        w('z',   'out',  'add', 'cin'),
        w('add', 'sum',  'ys',  'in'),
        w('add', 'cout', 'yc',  'in'),
      ],
    })),
  },
  'full-adder': {
    label: 'Full-trit adder',
    build: () => buildExample((c, w) => ({
      comps: [
        c('a',   'INPUT',  100, 130, { value:  1, name: 'a' }),
        c('b',   'INPUT',  100, 190, { value: -1, name: 'b' }),
        c('cin', 'INPUT',  100, 250, { value:  0, name: 'cin' }),
        c('add', 'ADDER',  240, 160),
        c('ys',  'OUTPUT', 400, 170, { name: 'sum' }),
        c('yc',  'OUTPUT', 400, 230, { name: 'cout' }),
      ],
      wires: [
        w('a',   'out',  'add', 'a'),
        w('b',   'out',  'add', 'b'),
        w('cin', 'out',  'add', 'cin'),
        w('add', 'sum',  'ys',  'in'),
        w('add', 'cout', 'yc',  'in'),
      ],
    })),
  },
  'ripple-3': {
    label: '3-trit ripple adder',
    build: () => buildExample((c, w) => {
      const comps = [];
      const wires = [];
      const xA = 80, xB = 80, xCin = 80;
      for (let i = 0; i < 3; i++) {
        comps.push(c('a' + i, 'INPUT',  xA, 100 + i * 180, { value: i === 0 ? 1 : 0, name: 'a' + i }));
        comps.push(c('b' + i, 'INPUT',  xB, 160 + i * 180, { value: i === 0 ? 1 : 0, name: 'b' + i }));
        comps.push(c('ad' + i, 'ADDER', 240, 100 + i * 180));
        comps.push(c('s' + i, 'OUTPUT', 400, 130 + i * 180, { name: 's' + i }));
        wires.push(w('a' + i, 'out', 'ad' + i, 'a'));
        wires.push(w('b' + i, 'out', 'ad' + i, 'b'));
        wires.push(w('ad' + i, 'sum', 's' + i, 'in'));
        if (i === 0) {
          comps.push(c('cin0', 'CONST', xCin, 220, { value: 0 }));
          wires.push(w('cin0', 'out', 'ad0', 'cin'));
        } else {
          wires.push(w('ad' + (i - 1), 'cout', 'ad' + i, 'cin'));
        }
      }
      comps.push(c('cout', 'OUTPUT', 400, 100 + 3 * 180, { name: 'cout' }));
      wires.push(w('ad2', 'cout', 'cout', 'in'));
      return { comps, wires };
    }),
  },
  'd-storage': {
    label: 'D flip-flop storage (test 3-state hold)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('d',   'INPUT',  100, 140, { value: 0, name: 'd' }),
        c('clk', 'CLOCK',  100, 220, { value: -1, mode: 'tri' }),
        c('ff',  'DFF',    260, 160, { q: 0, clkPrev: 0 }),
        c('q',   'OUTPUT', 420, 175, { name: 'q' }),
        c('wq',  'WAVE',   420, 250, { name: 'q',   trace: [] }),
        c('wd',  'WAVE',   420, 310, { name: 'd',   trace: [] }),
        c('wc',  'WAVE',   420, 370, { name: 'clk', trace: [] }),
      ],
      wires: [
        w('d',   'out', 'ff', 'd'),
        w('clk', 'out', 'ff', 'clk'),
        w('ff',  'q',   'q',  'in'),
        w('ff',  'q',   'wq', 'in'),
        w('d',   'out', 'wd', 'in'),
        w('clk', 'out', 'wc', 'in'),
      ],
    })),
  },
  't-flop': {
    label: 'T flip-flop (NEG-feedback toggle)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('clk', 'CLOCK',  100, 200, { value: -1, mode: 'tri' }),
        c('ff',  'DFF',    260, 200, { q: 1, clkPrev: 0 }),
        c('inv', 'STI',    400, 210),
        c('wq',  'WAVE',   520, 200, { name: 'q',   trace: [] }),
        c('wc',  'WAVE',   520, 260, { name: 'clk', trace: [] }),
      ],
      wires: [
        w('clk', 'out', 'ff',  'clk'),
        w('ff',  'q',   'inv', 'in'),
        w('inv', 'out', 'ff',  'd'),
        w('ff',  'q',   'wq',  'in'),
        w('clk', 'out', 'wc',  'in'),
      ],
    })),
  },
  'tryte-io': {
    label: 'Tryte input → tryte probe',
    build: () => buildExample((c, w) => {
      const comps = [
        c('in',  'TRYTE_IN',  100, 130, { value: 17 }),
        c('out', 'TRYTE_OUT', 280, 130),
      ];
      const wires = [];
      for (let i = 0; i < 6; i++) {
        wires.push(w('in', 't' + i, 'out', 't' + i));
      }
      return { comps, wires };
    }),
  },
  'three-way-branch': {
    label: 'Three-way branch (neg / zero / pos detector)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('s',   'INPUT',  100, 230, { value: 0, name: 'sign' }),
        c('nti', 'NTI',    260, 130),
        c('pti', 'PTI',    260, 330),
        c('sti', 'STI',    380, 330),
        c('mx',  'MAX',    500, 220),
        c('st2', 'STI',    640, 220),
        c('yn',  'OUTPUT', 760, 145, { name: 'neg' }),
        c('yz',  'OUTPUT', 760, 230, { name: 'zero' }),
        c('yp',  'OUTPUT', 760, 345, { name: 'pos' }),
      ],
      wires: [
        w('s',   'out', 'nti', 'in'),
        w('s',   'out', 'pti', 'in'),
        w('pti', 'out', 'sti', 'in'),
        w('sti', 'out', 'yp',  'in'),
        w('nti', 'out', 'yn',  'in'),
        w('nti', 'out', 'mx',  'a'),
        w('sti', 'out', 'mx',  'b'),
        w('mx',  'out', 'st2', 'in'),
        w('st2', 'out', 'yz',  'in'),
      ],
    })),
  },
  'ram-store': {
    label: 'RAM — store a word and read it back',
    build: () => buildExample((c, w) => ({
      comps: [
        // Address: a0 = 0, a1 = 0.  In balanced ternary the zero address
        // selects the MIDDLE word — index (0+1) + (0+1)*3 = 4 of 0..8.
        c('a0',  'INPUT',  80,  70,  { value:  0, name: 'a0' }),
        c('a1',  'INPUT',  80,  130, { value:  0, name: 'a1' }),
        // The trit pattern to store: (+1, T, +1).
        c('d0',  'INPUT',  80,  200, { value:  1, name: 'd0' }),
        c('d1',  'INPUT',  80,  260, { value: -1, name: 'd1' }),
        c('d2',  'INPUT',  80,  320, { value:  1, name: 'd2' }),
        // Write-enable held high; clock free-running.  Step (or Play) the
        // circuit: on the first rising clock edge the RAM latches d0..d2
        // into word 4, and the q outputs — an asynchronous read — show it.
        c('we',  'INPUT',  80,  390, { value:  1, name: 'we' }),
        c('clk', 'CLOCK',  80,  450, { value: -1, mode: 'tri' }),
        c('ram', 'RAM',    300, 170),
        c('q0',  'OUTPUT', 540, 200, { name: 'q0' }),
        c('q1',  'OUTPUT', 540, 260, { name: 'q1' }),
        c('q2',  'OUTPUT', 540, 320, { name: 'q2' }),
        c('wc',  'WAVE',   540, 400, { name: 'clk', trace: [] }),
        c('wq',  'WAVE',   540, 460, { name: 'q0',  trace: [] }),
      ],
      wires: [
        w('a0',  'out', 'ram', 'a0'),
        w('a1',  'out', 'ram', 'a1'),
        w('d0',  'out', 'ram', 'd0'),
        w('d1',  'out', 'ram', 'd1'),
        w('d2',  'out', 'ram', 'd2'),
        w('we',  'out', 'ram', 'we'),
        w('clk', 'out', 'ram', 'clk'),
        w('ram', 'q0',  'q0',  'in'),
        w('ram', 'q1',  'q1',  'in'),
        w('ram', 'q2',  'q2',  'in'),
        w('clk', 'out', 'wc',  'in'),
        w('ram', 'q0',  'wq',  'in'),
      ],
    })),
  },
  'alu-demo': {
    label: 'ALU — add two 3-trit words',
    build: () => buildExample((c, w) => ({
      comps: [
        // Word A = 5  (trits T, T, +1 from low to high).
        c('a0', 'INPUT',  80,  60,  { value: -1, name: 'a0' }),
        c('a1', 'INPUT',  80,  110, { value: -1, name: 'a1' }),
        c('a2', 'INPUT',  80,  160, { value:  1, name: 'a2' }),
        // Word B = 4  (trits +1, +1, 0).
        c('b0', 'INPUT',  80,  230, { value:  1, name: 'b0' }),
        c('b1', 'INPUT',  80,  280, { value:  1, name: 'b1' }),
        c('b2', 'INPUT',  80,  330, { value:  0, name: 'b2' }),
        // op = 0 selects ADD (5 + 4 = 9 → r = 0,0,+1).  Click op to T for
        // MIN or +1 for MAX and watch the result change — no clock needed.
        c('op', 'INPUT',  80,  400, { value:  0, name: 'op' }),
        c('alu', 'ALU',   300, 160),
        c('r0', 'OUTPUT', 520, 182, { name: 'r0' }),
        c('r1', 'OUTPUT', 520, 232, { name: 'r1' }),
        c('r2', 'OUTPUT', 520, 282, { name: 'r2' }),
        c('cc', 'OUTPUT', 520, 332, { name: 'cout' }),
      ],
      wires: [
        w('a0', 'out', 'alu', 'a0'), w('a1', 'out', 'alu', 'a1'),
        w('a2', 'out', 'alu', 'a2'), w('b0', 'out', 'alu', 'b0'),
        w('b1', 'out', 'alu', 'b1'), w('b2', 'out', 'alu', 'b2'),
        w('op', 'out', 'alu', 'op'),
        w('alu', 'r0', 'r0', 'in'), w('alu', 'r1', 'r1', 'in'),
        w('alu', 'r2', 'r2', 'in'), w('alu', 'cout', 'cc', 'in'),
      ],
    })),
  },
  'mux-demo': {
    label: 'MUX — route one of three inputs',
    build: () => buildExample((c, w) => ({
      comps: [
        // Click the select trit T / 0 / +1 to route a different data input.
        // The three data inputs hold distinct values so the routing shows.
        c('s',  'INPUT',  90,  80,  { value:  0, name: 's'  }),
        c('dT', 'INPUT',  90,  160, { value: -1, name: 'dT' }),
        c('d0', 'INPUT',  90,  210, { value:  0, name: 'd0' }),
        c('dP', 'INPUT',  90,  260, { value:  1, name: 'dP' }),
        c('mux', 'MUX',   300, 165),
        c('out', 'OUTPUT', 500, 210, { name: 'out' }),
      ],
      wires: [
        w('s',  'out', 'mux', 's'),
        w('dT', 'out', 'mux', 'dT'),
        w('d0', 'out', 'mux', 'd0'),
        w('dP', 'out', 'mux', 'dP'),
        w('mux', 'out', 'out', 'in'),
      ],
    })),
  },
  'pc-demo': {
    label: 'PC — program counter counting',
    build: () => buildExample((c, w) => ({
      comps: [
        // Step (or Play) the clock: the PC face counts 0,1,…,8,0,…
        // Set jmp = +1 and pick j0/j1 to make it jump there on the edge.
        c('clk', 'CLOCK',  90,  90,  { value: -1, mode: 'tri' }),
        c('jmp', 'INPUT',  90,  170, { value: 0, name: 'jmp' }),
        c('j0',  'INPUT',  90,  230, { value: 0, name: 'j0' }),
        c('j1',  'INPUT',  90,  290, { value: 0, name: 'j1' }),
        c('pc',  'PC',     300, 130),
        c('p0',  'OUTPUT', 500, 150, { name: 'p0' }),
        c('p1',  'OUTPUT', 500, 210, { name: 'p1' }),
        c('wp',  'WAVE',   500, 280, { name: 'p0', trace: [] }),
      ],
      wires: [
        w('clk', 'out', 'pc', 'clk'),
        w('jmp', 'out', 'pc', 'jmp'),
        w('j0',  'out', 'pc', 'j0'),
        w('j1',  'out', 'pc', 'j1'),
        w('pc', 'p0', 'p0', 'in'),
        w('pc', 'p1', 'p1', 'in'),
        w('pc', 'p0', 'wp', 'in'),
      ],
    })),
  },
  'cpu': {
    label: 'CPU — a single-cycle ternary processor',
    build: () => buildExample((c, w) => ({
      // The whole Phase 7 datapath wired up.  Press Play (or Step): each
      // rising clock edge executes one instruction.  Watch the PC face
      // count, the ACC (REG3) face hold the running total, and the IMEM
      // memory map show the two-instruction program.
      //
      //   instruction word = [operand-low, operand-high, opcode]
      //   opcode  0 = ADDI (ACC += operand) · +1 = MAXI · T = JMP
      //
      //   mem[0] = ADDI +1   [1, 0, 0]      ACC = ACC + 1
      //   mem[1] = JMP  0    [T, T, T]      jump back to word 0
      //
      // The loop adds 1 to the accumulator forever.
      comps: [
        c('clk',  'CLOCK',  60,  340, { value: -1, mode: 'bi' }),
        c('pc',   'PC',     190, 290),
        c('imem', 'RAM',    360, 220, { mem: [
          [1, 0, 0], [-1, -1, -1],
          [0, 0, 0], [0, 0, 0], [0, 0, 0],
          [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
        ] }),
        // Decoder — two inverters off the opcode trit (imem q2).
        c('nti',  'NTI',    610, 150),
        c('sti',  'STI',    740, 150),
        c('alu',  'ALU',    610, 320),
        // One constant 0 — feeds the ALU operand's sign-extend trit, and
        // ties off the instruction memory's write port (read-only IMEM).
        c('zero', 'CONST',  430, 510, { value: 0 }),
        c('acc',  'REG3',   800, 330),
        c('wclk', 'WAVE',   60,  470, { name: 'clk',  trace: [] }),
        c('wacc', 'WAVE',   800, 480, { name: 'ACC0', trace: [] }),
      ],
      wires: [
        // PC ← clock, decoder jmp, jump target (the operand)
        w('clk', 'out', 'pc', 'clk'),
        w('nti', 'out', 'pc', 'jmp'),
        w('imem', 'q0', 'pc', 'j0'),
        w('imem', 'q1', 'pc', 'j1'),
        // IMEM addressed by the PC.  It is read-only instruction memory:
        // clk is wired in, but the write port (we, d0..d2) is tied to 0,
        // so the pre-loaded program is never overwritten.
        w('pc', 'p0', 'imem', 'a0'),
        w('pc', 'p1', 'imem', 'a1'),
        w('clk', 'out', 'imem', 'clk'),
        w('zero', 'out', 'imem', 'we'),
        w('zero', 'out', 'imem', 'd0'),
        w('zero', 'out', 'imem', 'd1'),
        w('zero', 'out', 'imem', 'd2'),
        // Decoder: opcode → NTI (jmp) → STI (accWrite)
        w('imem', 'q2', 'nti', 'in'),
        w('nti', 'out', 'sti', 'in'),
        // ALU: a = ACC, b = operand (high trit sign-extended 0), op = opcode
        w('acc', 'q0', 'alu', 'a0'),
        w('acc', 'q1', 'alu', 'a1'),
        w('acc', 'q2', 'alu', 'a2'),
        w('imem', 'q0', 'alu', 'b0'),
        w('imem', 'q1', 'alu', 'b1'),
        w('zero', 'out', 'alu', 'b2'),
        w('imem', 'q2', 'alu', 'op'),
        // ACC ← ALU result, clock, accWrite (load-enable)
        w('alu', 'r0', 'acc', 'd0'),
        w('alu', 'r1', 'acc', 'd1'),
        w('alu', 'r2', 'acc', 'd2'),
        w('clk', 'out', 'acc', 'clk'),
        w('sti', 'out', 'acc', 'ld'),
        // Probes
        w('clk', 'out', 'wclk', 'in'),
        w('acc', 'q0', 'wacc', 'in'),
      ],
    })),
  },
  'ternary-mac': {
    label: 'Ternary-weight MAC — the AI dot-product primitive',
    build: () => buildExample((c, w) => {
      // A 3-element ternary-weight multiply-accumulate:  y = Σ wᵢ·xᵢ.
      //
      // This is the operation a neural network spends almost all its time
      // on — a dot product — with the weights quantised to {T, 0, +1}
      // (the BitNet b1.58 idea).  A ternary weight removes the multiplier
      // entirely: multiplying an activation xᵢ by a weight wᵢ is just
      //
      //     wᵢ = +1 → pass xᵢ     wᵢ = 0 → 0     wᵢ = T → negate xᵢ
      //
      // so each "multiply" is one STI (negate xᵢ) feeding one MUX (the
      // weight trit selects pass / zero / negate).  The three products are
      // then summed by a small ADDER tree — no multiplier anywhere.
      //
      // Result is two trits:  value = 3·y1 + y0  ∈ −3..+3.
      // Defaults: x = (+1,+1,T), w = (+1,0,T) → products (+1,0,+1) → y = 2,
      // which shows all three multiply modes at once (pass, zero, negate).
      const comps = [];
      const wires = [];
      const xv = [1, 1, -1], wv = [1, 0, -1];
      comps.push(c('zero', 'CONST', 430, 660, { value: 0 }));
      for (let i = 0; i < 3; i++) {
        const baseY = 70 + i * 170;
        comps.push(c('x' + i,   'INPUT',  60,  baseY,      { value: xv[i], name: 'x' + i }));
        comps.push(c('w' + i,   'INPUT',  60,  baseY + 72, { value: wv[i], name: 'w' + i }));
        comps.push(c('neg' + i, 'STI',    220, baseY + 30));
        comps.push(c('mux' + i, 'MUX',    380, baseY + 18));
        comps.push(c('p' + i,   'OUTPUT', 560, baseY + 38, { name: 'p' + i }));
        // multiply-by-trit: STI negates xᵢ; the MUX picks pass / zero /
        // negate according to the weight trit wᵢ on its select input.
        wires.push(w('x' + i,   'out', 'neg' + i, 'in'));
        wires.push(w('w' + i,   'out', 'mux' + i, 's'));
        wires.push(w('neg' + i, 'out', 'mux' + i, 'dT'));
        wires.push(w('zero',    'out', 'mux' + i, 'd0'));
        wires.push(w('x' + i,   'out', 'mux' + i, 'dP'));
        wires.push(w('mux' + i, 'out', 'p' + i,   'in'));
      }
      // Adder tree: (p0 + p1), then that low trit + p2; the two carries
      // sum to the result's high trit (their own carry is always 0 here).
      comps.push(c('add1', 'ADDER',  720, 150));
      comps.push(c('add2', 'ADDER',  880, 330));
      comps.push(c('add3', 'ADDER',  880, 540));
      comps.push(c('y0',   'OUTPUT', 1060, 336, { name: 'y0' }));
      comps.push(c('y1',   'OUTPUT', 1060, 546, { name: 'y1' }));
      wires.push(w('mux0', 'out',  'add1', 'a'));
      wires.push(w('mux1', 'out',  'add1', 'b'));
      wires.push(w('zero', 'out',  'add1', 'cin'));
      wires.push(w('add1', 'sum',  'add2', 'a'));
      wires.push(w('mux2', 'out',  'add2', 'b'));
      wires.push(w('zero', 'out',  'add2', 'cin'));
      wires.push(w('add1', 'cout', 'add3', 'a'));
      wires.push(w('add2', 'cout', 'add3', 'b'));
      wires.push(w('zero', 'out',  'add3', 'cin'));
      wires.push(w('add2', 'sum',  'y0',   'in'));
      wires.push(w('add3', 'sum',  'y1',   'in'));
      return { comps, wires };
    }),
  },
  'ternary-layer': {
    label: 'Ternary neural-net layer — matrix × vector',
    build: () => {
      // This example places the multiply-by-trit cell as a subcircuit, so
      // ensure that TMUL definition is registered before it is referenced.
      subcircuitDefs['TMUL'] = buildTmulDef();
      return buildExample((c, w) => {
        // y = W · x — a 3×3 ternary weight matrix times a 3-trit activation
        // vector.  Each output yⱼ is its own neuron: the dot product of
        // weight row j with the shared activation vector x.  In other words
        // it is the ternary-MAC example, stacked three times — which is all
        // a neural-net layer is.
        //
        // Every multiply is one TMUL block (the packed STI+MUX subcircuit);
        // each row's three products feed an ADDER tree → a 2-trit output,
        // value = 3·hi + lo.  The shared x inputs fan out to all three rows,
        // which is exactly the weight-reuse a matrix-vector product is.
        //
        // Defaults:  x = (+1, +1, T)
        //   W row 0 = (+1, 0, T)  → y0 =  2   (identical to the MAC example)
        //   W row 1 = (T, +1, +1) → y1 = -1
        //   W row 2 = (0, T,  0)  → y2 = -1
        const comps = [];
        const wires = [];
        const xv = [1, 1, -1];
        const wm = [[1, 0, -1], [-1, 1, 1], [0, -1, 0]];
        comps.push(c('zero', 'CONST', 450, 250, { value: 0 }));
        // Shared activation vector — one column, fanning out to every row.
        for (let i = 0; i < 3; i++)
          comps.push(c('x' + i, 'INPUT', 40, 300 + i * 72, { value: xv[i], name: 'x' + i }));
        for (let j = 0; j < 3; j++) {
          const rowY = 70 + j * 270;
          for (let i = 0; i < 3; i++) {
            const cy = rowY + i * 78;
            comps.push(c('w' + j + i, 'INPUT', 150, cy + 8, { value: wm[j][i], name: 'w' + j + i }));
            comps.push(c('m' + j + i, 'SUB:TMUL', 300, cy));
            // Each TMUL takes a weight trit and a shared activation trit.
            wires.push(w('w' + j + i, 'out', 'm' + j + i, 'w'));
            wires.push(w('x' + i,     'out', 'm' + j + i, 'x'));
          }
          // Adder tree for row j: (p0 + p1), then + p2; the two carries
          // sum to the result's high trit.
          comps.push(c('a' + j + '1', 'ADDER', 470, rowY + 20));
          comps.push(c('a' + j + '2', 'ADDER', 620, rowY + 96));
          comps.push(c('a' + j + '3', 'ADDER', 620, rowY + 176));
          comps.push(c('ylo' + j, 'OUTPUT', 790, rowY + 102, { name: 'y' + j + 'lo' }));
          comps.push(c('yhi' + j, 'OUTPUT', 790, rowY + 182, { name: 'y' + j + 'hi' }));
          wires.push(w('m' + j + '0', 'p',    'a' + j + '1', 'a'));
          wires.push(w('m' + j + '1', 'p',    'a' + j + '1', 'b'));
          wires.push(w('zero',        'out',  'a' + j + '1', 'cin'));
          wires.push(w('a' + j + '1', 'sum',  'a' + j + '2', 'a'));
          wires.push(w('m' + j + '2', 'p',    'a' + j + '2', 'b'));
          wires.push(w('zero',        'out',  'a' + j + '2', 'cin'));
          wires.push(w('a' + j + '1', 'cout', 'a' + j + '3', 'a'));
          wires.push(w('a' + j + '2', 'cout', 'a' + j + '3', 'b'));
          wires.push(w('zero',        'out',  'a' + j + '3', 'cin'));
          wires.push(w('a' + j + '2', 'sum',  'ylo' + j, 'in'));
          wires.push(w('a' + j + '3', 'sum',  'yhi' + j, 'in'));
        }
        return { comps, wires };
      });
    },
  },
  'ternary-mlp': {
    label: 'Ternary MLP — a 2-layer network with activation',
    build: () => {
      // Register the two subcircuits this example places.
      subcircuitDefs['MAC3'] = buildMac3Def();
      subcircuitDefs['ACT']  = buildActDef();
      return buildExample((c, w) => {
        // A two-layer ternary neural network:
        //
        //   x → [layer 1: MAC3 ×3] → [ACT ×3] → h → [layer 2: MAC3] → [ACT] → y
        //
        //   Layer 1   3 neurons, weight matrix W1 (3×3), shared input x.
        //   ACT       sign() — the nonlinearity. It maps each neuron's
        //             2-trit output (−3..+3) back to ONE trit so the next
        //             layer can consume it. This is the decision step: the
        //             matmul either side of it is linear (photonics' home
        //             turf), but sign() is a threshold — exactly where a
        //             photonic build would hand back to electronics.
        //   Layer 2   1 output neuron, weight vector W2, over the hidden h.
        //   ACT       sign() again — so the network's output y is a 3-way
        //             classification {T, 0, +1}.
        //
        // Without the ACT blocks the two matmuls would collapse into one
        // (W2·W1·x is still linear) — the activation is what makes depth
        // mean something.
        //
        // Defaults:  x = (+1,+1,T)
        //   W1 = [(+1,0,T),(T,+1,+1),(0,T,0)] → h_pre (2,−1,−1) → h (+1,T,T)
        //   W2 = (+1,+1,T)                    → y_pre  1        → y  +1
        const comps = [];
        const wires = [];
        const xv = [1, 1, -1];
        const W1 = [[1, 0, -1], [-1, 1, 1], [0, -1, 0]];
        const W2 = [1, 1, -1];
        // Shared input vector — fans out to all three layer-1 neurons.
        for (let i = 0; i < 3; i++)
          comps.push(c('x' + i, 'INPUT', 30, 250 + i * 44, { value: xv[i], name: 'x' + i }));
        // Layer 1 — three neurons, each a MAC3 (dot product) then an ACT.
        for (let j = 0; j < 3; j++) {
          const yB = 40 + j * 210;
          for (let i = 0; i < 3; i++)
            comps.push(c('w1_' + j + i, 'INPUT', 150, yB + 12 + i * 22,
                         { value: W1[j][i], name: 'W1_' + j + i }));
          comps.push(c('mac1_' + j, 'SUB:MAC3', 300, yB));
          comps.push(c('act1_' + j, 'SUB:ACT',  490, yB + 30));
          comps.push(c('h' + j, 'OUTPUT', 620, yB + 48, { name: 'h' + j }));
          for (let i = 0; i < 3; i++) {
            wires.push(w('w1_' + j + i, 'out', 'mac1_' + j, 'w' + i));
            wires.push(w('x' + i,       'out', 'mac1_' + j, 'x' + i));
          }
          wires.push(w('mac1_' + j, 'lo', 'act1_' + j, 'lo'));
          wires.push(w('mac1_' + j, 'hi', 'act1_' + j, 'hi'));
          wires.push(w('act1_' + j, 's',  'h' + j, 'in'));
        }
        // Layer 2 — one output neuron over the three hidden activations.
        for (let i = 0; i < 3; i++)
          comps.push(c('w2_' + i, 'INPUT', 690, 250 + i * 44,
                       { value: W2[i], name: 'W2_' + i }));
        comps.push(c('mac2', 'SUB:MAC3', 840, 236));
        comps.push(c('act2', 'SUB:ACT',  1030, 266));
        comps.push(c('y', 'OUTPUT', 1170, 284, { name: 'y' }));
        for (let i = 0; i < 3; i++) {
          wires.push(w('w2_' + i,   'out', 'mac2', 'w' + i));
          wires.push(w('act1_' + i, 's',   'mac2', 'x' + i));
        }
        wires.push(w('mac2', 'lo', 'act2', 'lo'));
        wires.push(w('mac2', 'hi', 'act2', 'hi'));
        wires.push(w('act2', 's',  'y', 'in'));
        return { comps, wires };
      });
    },
  },
};

function loadExampleNamed(name) {
  const ex = EXAMPLES[name];
  if (!ex) return;
  pushHistory();
  const { comps: newComps, wires: newWires } = ex.build();
  comps = newComps;
  wires = newWires;
  syncCompMap();
  nextCompId = comps.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  nextWireId = wires.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  view = { tx: 40, ty: 40, scale: 1 };
  selection.clear(); selectedWire = null; tick = 0; outVals = {};
  simulate(); drawWaves(); draw(); updateInspector();
}

(function initExampleSelect() {
  const sel = document.getElementById('example-select');
  for (const key in EXAMPLES) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = EXAMPLES[key].label;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    if (sel.value) {
      loadExampleNamed(sel.value);
      sel.value = '';
      // Clock-driven examples start running the moment they are picked, so
      // their behaviour is visible at once; combinational examples (no
      // CLOCK) load idle, and selecting one stops any running auto-step.
      setAutoPlay(comps.some(c => c.type === 'CLOCK'));
    }
  });
})();

function loadExample() { loadExampleNamed('t-flop'); }

// ============================================================================
//  SELF-TESTS
// ============================================================================

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

function assertEq(actual, expected, ctx = '') {
  if (!Object.is(actual, expected)) {
    throw new Error(`${ctx} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertDeepEq(actual, expected, ctx = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${ctx} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---- conversions ----
test('intToTrits round-trips −364..+364 at width 6', () => {
  for (let n = -364; n <= 364; n++) {
    assertEq(tritsToInt(intToTrits(n, 6)), n, `n=${n}:`);
  }
});
test('intToTrits known values', () => {
  assertDeepEq(intToTrits(0, 3),  [0, 0, 0]);
  assertDeepEq(intToTrits(1, 3),  [1, 0, 0]);
  assertDeepEq(intToTrits(-1, 3), [-1, 0, 0]);
  assertDeepEq(intToTrits(2, 3),  [-1, 1, 0]);
  assertDeepEq(intToTrits(-2, 3), [1, -1, 0]);
  assertDeepEq(intToTrits(13, 3), [1, 1, 1]);
});
test('parseTryteString parses balanced-ternary trit strings (MSB first)', () => {
  assertDeepEq(parseTryteString('0', 6).trits,    [0, 0, 0, 0, 0, 0]);
  assertDeepEq(parseTryteString('', 6).trits,     [0, 0, 0, 0, 0, 0]);
  assertDeepEq(parseTryteString('T1T', 6).trits,  [-1, 1, -1, 0, 0, 0]);
  // All-0/1 strings are trit patterns, not decimal numbers.
  assertEq(tritsToInt(parseTryteString('000111', 6).trits), 13, '000111 → 13:');
  assertEq(tritsToInt(parseTryteString('000101', 6).trits), 10, '000101 → 10:');
  assertEq(tritsToInt(parseTryteString('1000', 6).trits),   27, '1000 → 27:');
  assertEq(parseTryteString('T1T', 6).warning,    null, 'clean input has no warning');
  assertEq(parseTryteString('000111', 6).warning, null);
});
test('parseTryteString warns on non-ternary input and over-long strings', () => {
  const a = parseTryteString('garbage', 6);
  assertDeepEq(a.trits, [0, 0, 0, 0, 0, 0]);
  if (!a.warning) throw new Error('garbage should warn');
  // Decimal numbers are not trit strings — they belong in the decimal field.
  if (!parseTryteString('-7', 6).warning) throw new Error('"-7" should warn');
  if (!parseTryteString('13', 6).warning)  throw new Error('"13" (has a 3) should warn');
  const d = parseTryteString('1111111', 6);
  if (!d.warning) throw new Error('too-long string should warn');
  assertEq(d.trits.length, 6, 'still returns exactly width trits');
});

// ---- unary inverters ----
test('STI truth table', () => {
  assertEq(TYPES.STI.eval(null, { in: -1 }).out,  1);
  assertEq(TYPES.STI.eval(null, { in:  0 }).out,  0);
  assertEq(TYPES.STI.eval(null, { in:  1 }).out, -1);
  assertEq(TYPES.STI.eval(null, { in: null }).out, null);
});
test('PTI truth table (T→1, 0→1, 1→T)', () => {
  assertEq(TYPES.PTI.eval(null, { in: -1 }).out,  1);
  assertEq(TYPES.PTI.eval(null, { in:  0 }).out,  1);
  assertEq(TYPES.PTI.eval(null, { in:  1 }).out, -1);
});
test('NTI truth table (T→1, 0→T, 1→T)', () => {
  assertEq(TYPES.NTI.eval(null, { in: -1 }).out,  1);
  assertEq(TYPES.NTI.eval(null, { in:  0 }).out, -1);
  assertEq(TYPES.NTI.eval(null, { in:  1 }).out, -1);
});

// ---- binary gates ----
test('MIN over all 9 input combinations', () => {
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
    assertEq(TYPES.MIN.eval(null, { a, b }).out, Math.min(a, b), `MIN(${a},${b}):`);
  }
});
test('MAX over all 9 input combinations', () => {
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
    assertEq(TYPES.MAX.eval(null, { a, b }).out, Math.max(a, b), `MAX(${a},${b}):`);
  }
});
test('MUX routes the data input named by the select trit', () => {
  const def = TYPES.MUX;
  for (const dT of [-1, 0, 1])
    for (const d0 of [-1, 0, 1])
      for (const dP of [-1, 0, 1]) {
        assertEq(def.eval(null, { s: -1, dT, d0, dP }).out, dT, `s=T (${dT},${d0},${dP}):`);
        assertEq(def.eval(null, { s:  0, dT, d0, dP }).out, d0, `s=0 (${dT},${d0},${dP}):`);
        assertEq(def.eval(null, { s:  1, dT, d0, dP }).out, dP, `s=+1 (${dT},${d0},${dP}):`);
      }
});
test('MUX out is null for a floating select or floating selected input', () => {
  const def = TYPES.MUX;
  assertEq(def.eval(null, { s: null, dT: 1, d0: 1, dP: 1 }).out, null, 'select floating:');
  assertEq(def.eval(null, { s: 0, dT: 1, d0: null, dP: 1 }).out, null, 'selected input floating:');
  // A floating value on an unselected input must not reach the output.
  assertEq(def.eval(null, { s: 0, dT: null, d0: 1, dP: null }).out, 1, 'unselected floats ignored:');
});

// ---- adder ----
test('Full-trit adder: all 27 input combinations satisfy a+b+cin = cout*3 + sum', () => {
  for (const a of [-1, 0, 1])
    for (const b of [-1, 0, 1])
      for (const cin of [-1, 0, 1]) {
        const r = TYPES.ADDER.eval(null, { a, b, cin });
        assertEq(r.cout * 3 + r.sum, a + b + cin, `${a}+${b}+${cin}:`);
        if (Math.abs(r.sum)  > 1) throw new Error(`sum out of range for ${a},${b},${cin}`);
        if (Math.abs(r.cout) > 1) throw new Error(`cout out of range for ${a},${b},${cin}`);
      }
});

// ---- tryte-level arithmetic ----
test('6-trit ripple addition matches integer arithmetic (sample)', () => {
  function addTrytesViaTable(av, bv, width = 6) {
    const a = intToTrits(av, width), b = intToTrits(bv, width);
    let cin = 0; const sum = [];
    for (let i = 0; i < width; i++) {
      const r = TYPES.ADDER.eval(null, { a: a[i], b: b[i], cin });
      sum.push(r.sum); cin = r.cout;
    }
    return tritsToInt(sum);
  }
  const samples = [
    [0, 0], [1, 1], [-1, -1], [5, -7], [100, 200], [-100, -200],
    [364, -364], [-364, 364], [123, 241], [50, 50], [-50, -50],
    [0, 364], [0, -364], [1, -1], [-1, 1], [200, 100],
  ];
  for (const [x, y] of samples) {
    const got = addTrytesViaTable(x, y, 6);
    let exp = x + y;
    if (exp >= 365)  exp -= 729;
    if (exp <= -365) exp += 729;
    assertEq(got, exp, `${x}+${y}:`);
  }
});
test('Negation: NEG of every value matches -x', () => {
  for (let n = -50; n <= 50; n++) {
    const trits = intToTrits(n, 6);
    const negated = trits.map(t => -t);
    assertEq(tritsToInt(negated), -n || 0, `NEG(${n}):`);
  }
});

// ---- DFF behaviour ----
test('DFF latches on rising edge into +1, not on other clock transitions', () => {
  const dff = { id: 99, type: 'DFF', x: 0, y: 0, state: { q: 0, clkPrev: 0 } };
  const def = TYPES.DFF;
  def.latch(dff, { d: 1, clk: 0 });
  assertEq(dff.state.q, 0, 'no latch on clk=0:');
  def.latch(dff, { d: 1, clk: -1 });
  assertEq(dff.state.q, 0, 'no latch on clk=-1:');
  def.latch(dff, { d: 1, clk: 1 });
  assertEq(dff.state.q, 1, 'latch on 0→1:');
  def.latch(dff, { d: -1, clk: 1 });
  assertEq(dff.state.q, 1, 'no latch on flat clk=1:');
  def.latch(dff, { d: -1, clk: -1 });
  assertEq(dff.state.q, 1, 'no latch on falling:');
  def.latch(dff, { d: 0, clk: 1 });
  assertEq(dff.state.q, 0, 'latch with d=0 stores 0:');
  def.latch(dff, { d: -1, clk: -1 });
  def.latch(dff, { d: -1, clk: 1 });
  assertEq(dff.state.q, -1, 'latch with d=-1 stores -1:');
});

// ---- 3-trit register ----
test('REG3 loads d0..d2 on a rising edge only when ld = +1', () => {
  const def = TYPES.REG3;
  const reg = { id: 1, type: 'REG3', x: 0, y: 0, state: def.defaults() };
  assertDeepEq(reg.state.q, [0, 0, 0], 'starts cleared:');
  // Data present, but ld held at 0 — a rising edge must NOT load.
  def.latch(reg, { d0: 1, d1: -1, d2: 1, clk: 1, ld: 0 });
  assertDeepEq(reg.state.q, [0, 0, 0], 'no load when ld=0:');
  // ld asserted but the clock is flat at +1 (no edge) — must NOT load.
  def.latch(reg, { d0: 1, d1: -1, d2: 1, clk: 1, ld: 1 });
  assertDeepEq(reg.state.q, [0, 0, 0], 'no load without an edge:');
  // Drop the clock low, then a genuine 0→1 edge with ld asserted — loads.
  def.latch(reg, { d0: 1, d1: -1, d2: 1, clk: -1, ld: 1 });
  def.latch(reg, { d0: 1, d1: -1, d2: 1, clk:  1, ld: 1 });
  assertDeepEq(reg.state.q, [1, -1, 1], 'loads on 0→1 edge with ld=+1:');
});
test('REG3 holds its contents through an edge when ld is 0, T, or floating', () => {
  const def = TYPES.REG3;
  for (const ld of [0, -1, null]) {
    const reg = { id: 2, type: 'REG3', x: 0, y: 0, state: { q: [1, 1, 1], clkPrev: -1 } };
    def.latch(reg, { d0: -1, d1: -1, d2: -1, clk: 1, ld });
    assertDeepEq(reg.state.q, [1, 1, 1], `holds when ld=${ld}:`);
  }
});
test('REG3 eval mirrors the stored trits to q0..q2', () => {
  const reg = { type: 'REG3', state: { q: [-1, 0, 1], clkPrev: 0 } };
  assertDeepEq(TYPES.REG3.eval(reg), { q0: -1, q1: 0, q2: 1 });
});

// ---- ternary RAM ----------------------------------------------------------
test('RAM address decode maps (a0,a1) to nine distinct word indices 0..8', () => {
  const seen = new Set();
  for (const a1 of [-1, 0, 1])
    for (const a0 of [-1, 0, 1]) {
      const idx = ramAddr(a0, a1);
      if (idx < 0 || idx > 8) throw new Error(`idx out of range for a0=${a0},a1=${a1}: ${idx}`);
      seen.add(idx);
    }
  assertEq(seen.size, 9, 'all nine addresses distinct:');
  assertEq(ramAddr(null, 0), null, 'floating a0 → no address:');
  assertEq(ramAddr(0, null), null, 'floating a1 → no address:');
});
test('RAM eval shows the addressed word; a floating address reads null', () => {
  const def = TYPES.RAM;
  const ram = { type: 'RAM', state: def.defaults() };
  ram.state.mem[ramAddr(1, -1)] = [1, 0, -1];
  assertDeepEq(def.eval(ram, { a0: 1, a1: -1 }), { q0: 1, q1: 0, q2: -1 }, 'written word:');
  assertDeepEq(def.eval(ram, { a0: 0, a1: 0 }),  { q0: 0, q1: 0, q2: 0 },  'untouched word:');
  assertDeepEq(def.eval(ram, { a0: null, a1: 0 }),
               { q0: null, q1: null, q2: null }, 'floating address:');
});
test('RAM writes the addressed word on a rising edge when we = +1', () => {
  const def = TYPES.RAM;
  const ram = { type: 'RAM', state: def.defaults() };
  const idx = ramAddr(-1, 1);
  // A genuine 0→1 edge with we asserted — the addressed word loads.
  def.latch(ram, { a0: -1, a1: 1, d0: 1, d1: -1, d2: 1, we: 1, clk: -1 });
  def.latch(ram, { a0: -1, a1: 1, d0: 1, d1: -1, d2: 1, we: 1, clk:  1 });
  assertDeepEq(ram.state.mem[idx], [1, -1, 1], 'addressed word written:');
  assertDeepEq(def.eval(ram, { a0: 0, a1: 0 }),
               { q0: 0, q1: 0, q2: 0 }, 'other words untouched:');
});
test('RAM holds every word through an edge when we is 0, T, or floating', () => {
  const def = TYPES.RAM;
  for (const we of [0, -1, null]) {
    const ram = { type: 'RAM', state: def.defaults() };
    const idx = ramAddr(1, 1);
    ram.state.mem[idx] = [1, 1, 1];
    def.latch(ram, { a0: 1, a1: 1, d0: -1, d1: -1, d2: -1, we, clk: -1 });
    def.latch(ram, { a0: 1, a1: 1, d0: -1, d1: -1, d2: -1, we, clk:  1 });
    assertDeepEq(ram.state.mem[idx], [1, 1, 1], `holds when we=${we}:`);
  }
});
test('RAM ignores a write when the clock does not actually rise', () => {
  const def = TYPES.RAM;
  const ram = { type: 'RAM',
                state: { mem: Array.from({ length: 9 }, () => [0, 0, 0]), clkPrev: 1 } };
  // clk is already high — a flat clk=1 is not an edge and must not write.
  def.latch(ram, { a0: 0, a1: 0, d0: 1, d1: 1, d2: 1, we: 1, clk: 1 });
  assertDeepEq(ram.state.mem[ramAddr(0, 0)], [0, 0, 0], 'no write without a 0→1 edge:');
});
test('RAM suppresses a write when the address is floating', () => {
  const def = TYPES.RAM;
  const ram = { type: 'RAM', state: def.defaults() };
  def.latch(ram, { a0: null, a1: 0, d0: 1, d1: 1, d2: 1, we: 1, clk: -1 });
  def.latch(ram, { a0: null, a1: 0, d0: 1, d1: 1, d2: 1, we: 1, clk:  1 });
  for (let i = 0; i < 9; i++) {
    assertDeepEq(ram.state.mem[i], [0, 0, 0], `word ${i} unchanged:`);
  }
});

// ---- ALU ------------------------------------------------------------------
test('ALU ADD ripple-adds two 3-trit words and matches integer arithmetic', () => {
  const def = TYPES.ALU;
  const samples = [
    [0, 0], [1, 1], [-1, -1], [5, -7], [13, -13], [-13, 13],
    [6, 6], [-6, -6], [13, 1], [-13, -1], [4, 9], [10, -10],
  ];
  for (const [x, y] of samples) {
    const a = intToTrits(x, 3), b = intToTrits(y, 3);
    const r = def.eval(null, { a0: a[0], a1: a[1], a2: a[2],
                               b0: b[0], b1: b[1], b2: b[2], op: 0 });
    // The carry-out holds the overflow trit (weight 27).
    const got = tritsToInt([r.r0, r.r1, r.r2]) + r.cout * 27;
    assertEq(got, x + y, `${x}+${y}:`);
  }
});
test('ALU MIN / MAX apply min / max per trit, with no carry', () => {
  const def = TYPES.ALU;
  const a = { a0: -1, a1: 0, a2: 1 }, b = { b0: 1, b1: 0, b2: -1 };
  const mn = def.eval(null, { ...a, ...b, op: -1 });
  assertDeepEq([mn.r0, mn.r1, mn.r2], [-1, 0, -1], 'MIN result:');
  assertEq(mn.cout, 0, 'MIN cout:');
  const mx = def.eval(null, { ...a, ...b, op: 1 });
  assertDeepEq([mx.r0, mx.r1, mx.r2], [1, 0, 1], 'MAX result:');
  assertEq(mx.cout, 0, 'MAX cout:');
});
test('ALU outputs all-null when op or any operand trit is floating', () => {
  const def = TYPES.ALU;
  const full = { a0: 1, a1: 1, a2: 1, b0: 1, b1: 1, b2: 1, op: 0 };
  const NULL = { r0: null, r1: null, r2: null, cout: null };
  assertDeepEq(def.eval(null, { ...full, op: null }), NULL, 'op floating:');
  assertDeepEq(def.eval(null, { ...full, a1: null }), NULL, 'operand a1 floating:');
  assertDeepEq(def.eval(null, { ...full, b2: null }), NULL, 'operand b2 floating:');
});

// ---- program counter ------------------------------------------------------
test('PC increments its address on each rising edge, wrapping word 8 → 0', () => {
  const def = TYPES.PC;
  const pc = { type: 'PC', state: def.defaults() };
  assertDeepEq(pc.state.p, [-1, -1], 'starts at word 0:');
  // Nine rising edges: index walks 1..8 then wraps back to 0.
  for (let i = 1; i <= 9; i++) {
    def.latch(pc, { clk: -1, jmp: 0 });
    def.latch(pc, { clk:  1, jmp: 0 });
    assertEq(tritsToInt(pc.state.p) + 4, i % 9, `after ${i} edges:`);
  }
});
test('PC jumps to j0,j1 on a rising edge when jmp = +1', () => {
  const def = TYPES.PC;
  const pc = { type: 'PC', state: def.defaults() };
  const tgt = intToTrits(3, 2);   // balanced 3 → RAM word index 7
  def.latch(pc, { clk: -1, jmp: 1, j0: tgt[0], j1: tgt[1] });
  def.latch(pc, { clk:  1, jmp: 1, j0: tgt[0], j1: tgt[1] });
  assertEq(tritsToInt(pc.state.p) + 4, 7, 'jumped to word 7:');
});
test('PC holds its address when the clock does not rise', () => {
  const def = TYPES.PC;
  const pc = { type: 'PC', state: { p: intToTrits(2, 2), clkPrev: 1 } };
  def.latch(pc, { clk: 1, jmp: 0 });   // flat clk = 1, no edge
  assertEq(tritsToInt(pc.state.p), 2, 'no change without a 0→1 edge:');
});
test('PC eval mirrors the stored address to p0, p1', () => {
  const pc = { type: 'PC', state: { p: [1, -1], clkPrev: 0 } };
  assertDeepEq(TYPES.PC.eval(pc), { p0: 1, p1: -1 });
});

// ---- preset examples ----
test('every preset example builds with wires connecting real in/out pins', () => {
  for (const key in EXAMPLES) {
    const { comps, wires } = EXAMPLES[key].build();
    const byId = {};
    for (const c of comps) byId[c.id] = c;
    for (const wr of wires) {
      const fc = byId[wr.fromId], tc = byId[wr.toId];
      if (!fc || !tc) throw new Error(`${key} wire #${wr.id}: missing component`);
      // compDef resolves plain TYPES, GATE:, and SUB: types alike, so an
      // example that places a subcircuit instance is checked correctly.
      const fdef = compDef(fc), tdef = compDef(tc);
      const fpin = fdef && fdef.pins && fdef.pins[wr.fromPort];
      const tpin = tdef && tdef.pins && tdef.pins[wr.toPort];
      if (!fpin || fpin.kind !== 'out')
        throw new Error(`${key} wire #${wr.id}: ${fc.type}.${wr.fromPort} is not an output pin`);
      if (!tpin || tpin.kind !== 'in')
        throw new Error(`${key} wire #${wr.id}: ${tc.type}.${wr.toPort} is not an input pin`);
    }
  }
});

test('every preset example gives each component its full default state', () => {
  for (const key in EXAMPLES) {
    const { comps } = EXAMPLES[key].build();
    for (const c of comps) {
      const def = TYPES[c.type];
      if (!def || !def.defaults) continue;
      for (const k in def.defaults()) {
        if (!(k in c.state))
          throw new Error(`${key}: ${c.type} #${c.id} is missing state key "${k}"`);
      }
    }
  }
});

test('Ternary-weight MAC computes the dot product Σ wᵢ·xᵢ for all 729 inputs', () => {
  const { comps, wires } = EXAMPLES['ternary-mac'].build();
  const inByName = {}, outSrc = {};
  for (const c of comps) {
    if (c.type === 'INPUT') inByName[c.state.name] = c;
    if (c.type === 'OUTPUT') {
      const wr = wires.find(w => w.toId === c.id && w.toPort === 'in');
      outSrc[c.state.name] = wr ? `${wr.fromId}:${wr.fromPort}` : null;
    }
  }
  for (const x0 of [-1, 0, 1]) for (const x1 of [-1, 0, 1]) for (const x2 of [-1, 0, 1])
  for (const w0 of [-1, 0, 1]) for (const w1 of [-1, 0, 1]) for (const w2 of [-1, 0, 1]) {
    inByName.x0.state.value = x0; inByName.x1.state.value = x1; inByName.x2.state.value = x2;
    inByName.w0.state.value = w0; inByName.w1.state.value = w1; inByName.w2.state.value = w2;
    const scope = { comps, wires, outVals: {} };
    simulateScope(scope);
    const tag = `MAC(x=${x0},${x1},${x2} w=${w0},${w1},${w2}):`;
    // Each MUX must realise multiply-by-trit on its product output.
    // (|| 0 normalises JS's -0 from e.g. 0 * -1 to a plain 0.)
    assertEq(scope.outVals[outSrc.p0], w0 * x0 || 0, tag + ' p0');
    assertEq(scope.outVals[outSrc.p1], w1 * x1 || 0, tag + ' p1');
    assertEq(scope.outVals[outSrc.p2], w2 * x2 || 0, tag + ' p2');
    // The adder tree must accumulate them: value = 3·y1 + y0.
    const got = 3 * scope.outVals[outSrc.y1] + scope.outVals[outSrc.y0];
    assertEq(got, (w0 * x0 + w1 * x1 + w2 * x2) || 0, tag + ' y');
  }
});

test('Ternary layer computes y = W·x for each row, over a deterministic sample', () => {
  const { comps, wires } = EXAMPLES['ternary-layer'].build();
  const inByName = {}, outSrc = {};
  for (const c of comps) {
    if (c.type === 'INPUT') inByName[c.state.name] = c;
    if (c.type === 'OUTPUT') {
      const wr = wires.find(w => w.toId === c.id && w.toPort === 'in');
      outSrc[c.state.name] = wr ? `${wr.fromId}:${wr.fromPort}` : null;
    }
  }
  // A tiny deterministic LCG so the sample is reproducible run-to-run.
  let seed = 4321;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 800; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [];
    for (let j = 0; j < 3; j++) W.push([nextTrit(), nextTrit(), nextTrit()]);
    inByName.x0.state.value = x[0];
    inByName.x1.state.value = x[1];
    inByName.x2.state.value = x[2];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
      inByName['w' + j + i].state.value = W[j][i];
    const scope = { comps, wires, outVals: {} };
    simulateScope(scope);
    for (let j = 0; j < 3; j++) {
      const got = 3 * scope.outVals[outSrc['y' + j + 'hi']]
                +     scope.outVals[outSrc['y' + j + 'lo']];
      const want = (W[j][0] * x[0] + W[j][1] * x[1] + W[j][2] * x[2]) || 0;
      assertEq(got, want, `layer row ${j} sample ${s} (x=${x}, W${j}=${W[j]}):`);
    }
  }
});

test('Ternary MLP runs both layers through the sign activation, sampled', () => {
  const { comps, wires } = EXAMPLES['ternary-mlp'].build();
  const inByName = {}, outSrc = {};
  for (const c of comps) {
    if (c.type === 'INPUT') inByName[c.state.name] = c;
    if (c.type === 'OUTPUT') {
      const wr = wires.find(w => w.toId === c.id && w.toPort === 'in');
      outSrc[c.state.name] = wr ? `${wr.fromId}:${wr.fromPort}` : null;
    }
  }
  const sgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
  let seed = 9001;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 600; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W1 = [], W2 = [];
    for (let j = 0; j < 3; j++) W1.push([nextTrit(), nextTrit(), nextTrit()]);
    for (let i = 0; i < 3; i++) W2.push(nextTrit());
    for (let i = 0; i < 3; i++) inByName['x' + i].state.value = x[i];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
      inByName['W1_' + j + i].state.value = W1[j][i];
    for (let i = 0; i < 3; i++) inByName['W2_' + i].state.value = W2[i];
    const scope = { comps, wires, outVals: {} };
    simulateScope(scope);
    // Reference: layer-1 dot products → sign → layer-2 dot product → sign.
    const h = [];
    for (let j = 0; j < 3; j++)
      h.push(sgn(W1[j][0] * x[0] + W1[j][1] * x[1] + W1[j][2] * x[2]));
    const y = sgn(W2[0] * h[0] + W2[1] * h[1] + W2[2] * h[2]);
    for (let j = 0; j < 3; j++)
      assertEq(scope.outVals[outSrc['h' + j]], h[j], `MLP h${j} sample ${s}:`);
    assertEq(scope.outVals[outSrc.y], y, `MLP y sample ${s}:`);
  }
});

test('Built-in subcircuits TMUL / MAC3 / ACT register with the right pins', () => {
  registerBuiltinSubcircuits();
  const expect = {
    TMUL: { inputs: 2, outputs: 1 },
    MAC3: { inputs: 6, outputs: 2 },
    ACT:  { inputs: 2, outputs: 1 },
  };
  for (const name in expect) {
    const def = subcircuitDefs[name];
    if (!def) throw new Error(`built-in subcircuit "${name}" is not registered`);
    assertEq(def.inputs.length, expect[name].inputs, `${name} input count:`);
    assertEq(def.outputs.length, expect[name].outputs, `${name} output count:`);
    // The definition must be self-consistent: every wire endpoint real.
    const byId = {};
    for (const ic of def.comps) byId[ic.id] = ic;
    for (const wr of def.wires) {
      if (!byId[wr.fromId] || !byId[wr.toId])
        throw new Error(`${name}: wire references a missing component`);
    }
  }
});

test('Info reference has detailed pages for the built-in subcircuits', () => {
  for (const key of ['SUB:TMUL', 'SUB:MAC3', 'SUB:ACT', 'SUB:TSUM',
                      'SUB:TCARRY', 'SUB:FADD', 'SUB:ALU3', 'SUB:MUX3']) {
    const e = COMPONENT_INFO[key];
    if (!e) throw new Error(`no COMPONENT_INFO entry for ${key}`);
    if (!e.name || !e.tagline || !e.body) throw new Error(`${key} info entry is incomplete`);
    if (!INFO_CATEGORIES.some(([, keys]) => keys.includes(key)))
      throw new Error(`${key} is not listed in any INFO_CATEGORIES group`);
    showInfoEntry(key);   // must render without throwing
  }
  // The two-input blocks get a live truth table — confirm it builds and
  // that the values come from the real subcircuit behaviour.
  if (!/<table/.test(infoSubTruthTable('SUB:TMUL'))) throw new Error('TMUL table missing');
  for (const w of [-1, 0, 1]) for (const x of [-1, 0, 1]) {
    const out = simulateSubInstance({ type: 'SUB:TMUL', state: {} }, { w, x });
    assertEq(out.p, w * x || 0, `TMUL info table (w=${w},x=${x}):`);
  }
});

test('Subcircuit library protects built-ins; only user blocks are deletable', () => {
  registerBuiltinSubcircuits();
  for (const n of ['TMUL', 'MAC3', 'ACT', 'TSUM', 'TCARRY', 'FADD', 'ALU3', 'MUX3']) {
    assertEq(isBuiltinSubcircuit(n), true, `${n} is built-in:`);
    deleteSubcircuit(n);   // protected — must be a no-op, not a deletion
    if (!subcircuitDefs[n]) throw new Error(`built-in subcircuit "${n}" was deleted`);
  }
  assertEq(isBuiltinSubcircuit('MyBlock7'), false, 'a user-named block is not built-in:');
});

test('Gate-level TSUM / TCARRY subcircuits match the balanced-ternary add tables', () => {
  registerBuiltinSubcircuits();
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    const total = x + y;
    let sum = total, carry = 0;
    if (total === 2)  { sum = -1; carry = 1; }
    if (total === -2) { sum = 1;  carry = -1; }
    const ts = simulateSubInstance({ type: 'SUB:TSUM',   state: {} }, { x, y });
    const tc = simulateSubInstance({ type: 'SUB:TCARRY', state: {} }, { x, y });
    assertEq(ts.sum,   sum   || 0, `TSUM(${x},${y}):`);
    assertEq(tc.carry, carry || 0, `TCARRY(${x},${y}):`);
  }
});

test('Gate-level FADD subcircuit matches the native ADDER for all 27 inputs', () => {
  registerBuiltinSubcircuits();
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const cin of [-1, 0, 1]) {
    const got  = simulateSubInstance({ type: 'SUB:FADD', state: {} }, { a, b, cin });
    const want = TYPES.ADDER.eval(null, { a, b, cin });
    assertEq(got.sum,  want.sum,  `FADD sum (a=${a},b=${b},cin=${cin}):`);
    assertEq(got.cout, want.cout, `FADD cout (a=${a},b=${b},cin=${cin}):`);
  }
});

test('Gate-level ALU3 subcircuit matches the native ALU over a deterministic sample', () => {
  registerBuiltinSubcircuits();
  let seed = 271;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 300; s++) {
    const v = {
      a0: nextTrit(), a1: nextTrit(), a2: nextTrit(),
      b0: nextTrit(), b1: nextTrit(), b2: nextTrit(),
      op: nextTrit(),
    };
    const got  = simulateSubInstance({ type: 'SUB:ALU3', state: {} }, v);
    const want = TYPES.ALU.eval(null, v);
    for (const p of ['r0', 'r1', 'r2', 'cout'])
      assertEq(got[p], want[p], `ALU3 ${p} sample ${s} (op=${v.op}):`);
  }
});

test('Gate-level MUX3 subcircuit matches the native MUX for all 81 inputs', () => {
  registerBuiltinSubcircuits();
  for (const s of [-1, 0, 1]) for (const dT of [-1, 0, 1])
  for (const d0 of [-1, 0, 1]) for (const dP of [-1, 0, 1]) {
    const got  = simulateSubInstance({ type: 'SUB:MUX3', state: {} }, { s, dT, d0, dP });
    const want = TYPES.MUX.eval(null, { s, dT, d0, dP });
    assertEq(got.out, want.out, `MUX3 (s=${s},dT=${dT},d0=${d0},dP=${dP}):`);
  }
});

// ---- Sequential kit (TLATCH / TFLOP / TREG3 / TPC / TRAM) ------------------
//
// Stateful subcircuits — driven by repeatedly calling simulateSubInstance on
// the SAME instance, which reuses its subScope (and so retains its outVals)
// across calls. That's exactly how the cross-coupled feedback stores state.

test('Gate-level TLATCH is transparent at en=+1 and holds at en=T', () => {
  registerBuiltinSubcircuits();
  const inst = { type: 'SUB:TLATCH', state: {} };
  // Initial settle with en=T should produce 0 (the seed value).
  assertEq(simulateSubInstance(inst, { d: 1, en: -1 }).q, 0, 'init holds at 0:');
  // Open the latch (en=+1) and write each ternary value in turn; close it
  // (en=T) and confirm the value persists across the close.
  for (const v of [1, -1, 0, 1, -1]) {
    assertEq(simulateSubInstance(inst, { d: v,  en: 1  }).q, v, `load d=${v}:`);
    assertEq(simulateSubInstance(inst, { d: -v, en: -1 }).q, v, `hold after ${v}:`);
  }
});

test('Gate-level TFLOP samples d on the rising clock edge to +1', () => {
  registerBuiltinSubcircuits();
  const inst = { type: 'SUB:TFLOP', state: {} };
  // Initial state is 0 (the outVals seed). A flat clock or a falling edge
  // must not change q. A 0→+1 transition with the right d does.
  assertEq(simulateSubInstance(inst, { d: 1, clk: -1 }).q, 0, 'init=0, clk low:');
  assertEq(simulateSubInstance(inst, { d: 1, clk:  0 }).q, 0, 'still 0 at clk=0:');
  assertEq(simulateSubInstance(inst, { d: 1, clk:  1 }).q, 1, 'latches +1 on rise:');
  assertEq(simulateSubInstance(inst, { d: 0, clk:  1 }).q, 1, 'flat clk=1 holds:');
  assertEq(simulateSubInstance(inst, { d: 0, clk: -1 }).q, 1, 'falling edge holds:');
  assertEq(simulateSubInstance(inst, { d: 0, clk:  1 }).q, 0, 'latches 0 on next rise:');
  assertEq(simulateSubInstance(inst, { d: -1, clk: -1 }).q, 0, 'drop clk, still 0:');
  assertEq(simulateSubInstance(inst, { d: -1, clk:  1 }).q, -1, 'latches T on rise:');
});

test('Gate-level TREG3 loads, holds, and clears via tri-state ld', () => {
  registerBuiltinSubcircuits();
  const inst = { type: 'SUB:TREG3', state: {} };
  const step = (d0, d1, d2, ld) => {
    simulateSubInstance(inst, { d0, d1, d2, ld, clk: -1 });
    return simulateSubInstance(inst, { d0, d1, d2, ld, clk: 1 });
  };
  // Load a value with ld=+1 on a real edge.
  let r = step(1, -1, 1, 1);
  assertDeepEq([r.q0, r.q1, r.q2], [1, -1, 1], 'loaded on ld=+1:');
  // Hold with ld=0 — data is ignored.
  r = step(-1, -1, -1, 0);
  assertDeepEq([r.q0, r.q1, r.q2], [1, -1, 1], 'held on ld=0:');
  // Load a different value to confirm reload works.
  r = step(0, 1, -1, 1);
  assertDeepEq([r.q0, r.q1, r.q2], [0, 1, -1], 'reloaded:');
  // Clear with ld=T — the tri-state extension this twin adds.
  r = step(1, 1, 1, -1);
  assertDeepEq([r.q0, r.q1, r.q2], [0, 0, 0], 'cleared on ld=T:');
});

test('Gate-level TPC increments and wraps, and jumps when jmp=+1', () => {
  registerBuiltinSubcircuits();
  const inst = { type: 'SUB:TPC', state: {} };
  const native = { type: 'PC', state: TYPES.PC.defaults() };
  const tick = (jmp, j0, j1) => {
    // Two simulateSubInstance calls per "step" — one with clk low, one
    // with clk high — so the TFLOPs see a genuine rising edge.
    simulateSubInstance(inst, { clk: -1, jmp, j0, j1 });
    const r = simulateSubInstance(inst, { clk: 1, jmp, j0, j1 });
    // Mirror on the native PC.
    TYPES.PC.latch(native, { clk: -1, jmp, j0, j1 });
    TYPES.PC.latch(native, { clk:  1, jmp, j0, j1 });
    return r;
  };
  // The TFLOPs inside TPC start at q=0 (the cross-coupled-loop bootstrap
  // seed), so TPC's natural reset is word 4 — not word 0 like native PC,
  // whose defaults() sets p=[-1,-1]. Align both to a known address with
  // one jump tick before comparing increment behaviour.
  tick(1, -1, -1);
  // Ten increments — walks 1..8, wraps to 0, then steps to 1. Compare
  // as integers (via tritsToInt) rather than per-trit, because native
  // intToTrits can return -0 for some high trits and Object.is treats
  // -0 ≠ 0; the integer comparison is the meaning we actually want.
  for (let i = 1; i <= 10; i++) {
    const r = tick(0, 0, 0);
    assertEq(tritsToInt([r.p0, r.p1]), tritsToInt(native.state.p),
             `TPC address after ${i} ticks:`);
  }
  // Jump to balanced 3 → word index 7.
  const tgt = intToTrits(3, 2);
  const r = tick(1, tgt[0], tgt[1]);
  assertEq(tritsToInt([r.p0, r.p1]), 3, 'TPC jump address:');
});

test('Gate-level TRAM stores and reads back across multiple addresses', () => {
  registerBuiltinSubcircuits();
  const inst = { type: 'SUB:TRAM', state: {} };
  // Write a distinct word to each of three addresses, then read back all
  // three — proves both the per-word load enable and the read-mux tree.
  const writes = [
    { a0: -1, a1: -1, d: [1, -1, 1] },   // word 0
    { a0:  1, a1: -1, d: [-1, 1, -1] },  // word 2
    { a0:  0, a1:  1, d: [1, 1, -1] },   // word 7
  ];
  for (const wr of writes) {
    simulateSubInstance(inst, { a0: wr.a0, a1: wr.a1,
                                 d0: wr.d[0], d1: wr.d[1], d2: wr.d[2],
                                 we: 1, clk: -1 });
    simulateSubInstance(inst, { a0: wr.a0, a1: wr.a1,
                                 d0: wr.d[0], d1: wr.d[1], d2: wr.d[2],
                                 we: 1, clk: 1 });
  }
  for (const wr of writes) {
    const r = simulateSubInstance(inst, { a0: wr.a0, a1: wr.a1,
                                           d0: 0, d1: 0, d2: 0,
                                           we: -1, clk: -1 });
    assertDeepEq([r.q0, r.q1, r.q2], wr.d,
                 `TRAM read back (a0=${wr.a0},a1=${wr.a1}):`);
  }
  // Suppress a write with we=T — addressed word must keep its prior value.
  const before = simulateSubInstance(inst, { a0: -1, a1: -1, d0: 0, d1: 0, d2: 0,
                                              we: -1, clk: -1 });
  simulateSubInstance(inst, { a0: -1, a1: -1, d0: -1, d1: -1, d2: -1,
                               we: -1, clk: -1 });
  simulateSubInstance(inst, { a0: -1, a1: -1, d0: -1, d1: -1, d2: -1,
                               we: -1, clk: 1 });
  const after = simulateSubInstance(inst, { a0: -1, a1: -1, d0: 0, d1: 0, d2: 0,
                                             we: -1, clk: -1 });
  assertDeepEq([after.q0, after.q1, after.q2],
               [before.q0, before.q1, before.q2], 'TRAM held on we=T:');
});

test('Sequential kit registered and protected as built-ins', () => {
  registerBuiltinSubcircuits();
  for (const n of ['TLATCH', 'TFLOP', 'TREG3', 'TPC', 'TRAM']) {
    assertEq(isBuiltinSubcircuit(n), true, `${n} is built-in:`);
    deleteSubcircuit(n);
    if (!subcircuitDefs[n]) throw new Error(`built-in subcircuit "${n}" was deleted`);
  }
});

// ---- Phase 8 assembler ----------------------------------------------------

test('Assembler encodes ADDI / MAXI / JMP exactly as the CPU preset expects', () => {
  // The default CPU example hand-encodes "ADDI +1 / JMP 0" — assembling that
  // textual program must produce the same first two words. Any drift here
  // means the assembler and the live CPU have desynced.
  const res = assemble(`
    ADDI +1
    JMP  0
  `);
  if (res.errors.length) throw new Error('clean source produced errors: ' + JSON.stringify(res.errors));
  assertDeepEq(res.mem[0], [1, 0, 0],    'ADDI +1 word:');
  assertDeepEq(res.mem[1], [-1, -1, -1], 'JMP 0 word:');
  // Remaining words padded with 0 — the CPU example does the same.
  for (let i = 2; i < 9; i++) assertDeepEq(res.mem[i], [0, 0, 0], `padding word ${i}:`);
});

test('Assembler resolves labels and handles negative immediates', () => {
  const res = assemble(`
LOOP:
  ADDI +2
  ADDI -3
  MAXI +1
  JMP  LOOP
  `);
  if (res.errors.length) throw new Error('errors: ' + JSON.stringify(res.errors));
  assertDeepEq(res.mem[0], [-1, 1, 0],   'ADDI +2 = intToTrits(2,2)=[T,+1] + op 0:');
  assertDeepEq(res.mem[1], [0, -1, 0],   'ADDI -3 = intToTrits(-3,2)=[0,T] + op 0:');
  assertDeepEq(res.mem[2], [1, 0, 1],    'MAXI +1 + op +1:');
  assertDeepEq(res.mem[3], [-1, -1, -1], 'JMP LOOP (label = word 0, addr-4=-4 → [T,T]) + op T:');
  assertEq(res.labels.LOOP, 0, 'LOOP label resolves to 0:');
  assertEq(res.words, 4, '4 instructions assembled:');
});

test('Assembler rejects out-of-range immediates, bad labels, overlong programs', () => {
  // Immediate out of range.
  let r = assemble('ADDI +5');
  assertEq(r.errors.length, 1, 'ADDI +5 → 1 error:');
  if (!/out of range/.test(r.errors[0].msg)) throw new Error('expected range msg, got: ' + r.errors[0].msg);
  // Unknown mnemonic.
  r = assemble('FOO 1');
  assertEq(r.errors.length, 1, 'FOO → 1 error:');
  if (!/unknown mnemonic/.test(r.errors[0].msg)) throw new Error('expected unknown-mnem msg');
  // Unknown label.
  r = assemble('JMP NOWHERE');
  assertEq(r.errors.length, 1, 'JMP NOWHERE → 1 error:');
  // JMP address out of range.
  r = assemble('JMP 9');
  assertEq(r.errors.length, 1, 'JMP 9 → 1 error:');
  // Too many instructions (10 > 9).
  r = assemble(Array(10).fill('ADDI +1').join('\n'));
  if (r.errors.length === 0) throw new Error('expected an "exceeds" error for 10 instructions');
  if (!r.errors.some(e => /exceeds/.test(e.msg))) throw new Error('expected exceeds-9 message');
});

test('Assembler examples library exposes 3 programs that assemble cleanly', () => {
  const names = Object.keys(ASM_EXAMPLES);
  assertEq(names.length, 3, 'three canned examples:');
  for (const k of names) {
    const ex = ASM_EXAMPLES[k];
    if (!ex.label || !ex.src) throw new Error(`example ${k} missing label or src`);
    const res = assemble(ex.src);
    if (res.errors.length) {
      throw new Error(`example "${k}" failed to assemble: ` + JSON.stringify(res.errors));
    }
    if (res.words < 1 || res.words > 9) throw new Error(`example "${k}" has ${res.words} instructions`);
  }
});

test('Assembled "counter" program executes ACC=1,2,3,... on the live CPU', () => {
  // Round-trip: assemble the canned counter, slap its word image straight
  // into IMEM of a fresh CPU instance, and step ten clock edges. ACC must
  // climb 1,1,2,2,3,3,... — the same pattern verify-cpu.cjs checks.
  const res = assemble(ASM_EXAMPLES['counter'].src);
  if (res.errors.length) throw new Error('counter failed to assemble: ' + JSON.stringify(res.errors));
  // Build the CPU example from scratch (independent of the live top-level
  // `comps`, so the test doesn't disturb the user's circuit).
  const ex = EXAMPLES['cpu'].build();
  const imem = ex.comps.find(c => c.type === 'RAM');
  imem.state.mem = res.mem.map(w => w.slice());
  imem.state.clkPrev = 0;
  const pc  = ex.comps.find(c => c.type === 'PC');
  const acc = ex.comps.find(c => c.type === 'REG3');
  // Run ten clock ticks through the scope-aware engine. The 4-phase step
  // engine wants a real top-level scope, so swap `comps`/`wires` briefly.
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    comps = ex.comps; wires = ex.wires; outVals = {}; tick = 0;
    syncCompMap(); simulate();
    const seen = [];
    for (let i = 0; i < 10; i++) {
      stepSequential();
      seen.push({ acc: tritsToInt(acc.state.q), pc: tritsToInt(pc.state.p) + 4 });
    }
    const expect = [
      { acc: 1, pc: 1 }, { acc: 1, pc: 1 }, { acc: 1, pc: 0 }, { acc: 1, pc: 0 },
      { acc: 2, pc: 1 }, { acc: 2, pc: 1 }, { acc: 2, pc: 0 }, { acc: 2, pc: 0 },
      { acc: 3, pc: 1 }, { acc: 3, pc: 1 },
    ];
    for (let i = 0; i < expect.length; i++) {
      assertEq(seen[i].acc, expect[i].acc, `step ${i+1} ACC:`);
      assertEq(seen[i].pc,  expect[i].pc,  `step ${i+1} PC:`);
    }
  } finally {
    comps = savedComps; wires = savedWires; outVals = savedOutVals; tick = savedTick;
    syncCompMap();
  }
});

// ---- CPU debugger ---------------------------------------------------------
//
// The panel just observes; the simulator does the real work. So the tests
// focus on (a) the debug-side data the assembler produces and (b) the
// breakpoint stop condition, by running the same headless CPU instance the
// round-trip test uses.

test('Assembler emits addrToLine mapping each IMEM word to its source line', () => {
  const res = assemble(`
; comment
LOOP:
  ADDI +1     ; word 0, source line 4
  MAXI +3     ; word 1, source line 5
  JMP  LOOP   ; word 2, source line 6
`);
  assertEq(res.errors.length, 0, 'no errors:');
  assertEq(res.words, 3, '3 instructions:');
  assertEq(res.addrToLine[0], 4, 'word 0 ← line 4:');
  assertEq(res.addrToLine[1], 5, 'word 1 ← line 5:');
  assertEq(res.addrToLine[2], 6, 'word 2 ← line 6:');
  assertEq(res.addrToLine[3], null, 'word 3 (padding) is null:');
  assertEq(res.addrToLine[8], null, 'word 8 (padding) is null:');
});

test('decodeImemWord round-trips ADDI / MAXI / JMP from assembler output', () => {
  const res = assemble(`
ADDI +2
MAXI -3
JMP  5
`);
  assertEq(res.errors.length, 0, 'no errors:');
  assertEq(decodeImemWord(res.mem[0]), 'ADDI +2', 'ADDI decode:');
  assertEq(decodeImemWord(res.mem[1]), 'MAXI -3', 'MAXI decode:');
  assertEq(decodeImemWord(res.mem[2]), 'JMP  5',  'JMP decode:');
});

test('Debugger Run halts at a breakpoint on the live CPU', () => {
  // Same scaffolding as the round-trip test: assemble the counter, swap
  // the top-level scope to a fresh CPU instance, set a breakpoint, run.
  const res = assemble(ASM_EXAMPLES['counter'].src);
  if (res.errors.length) throw new Error('counter failed: ' + JSON.stringify(res.errors));
  const ex = EXAMPLES['cpu'].build();
  const imem = ex.comps.find(c => c.type === 'RAM');
  imem.state.mem = res.mem.map(w => w.slice());
  imem.state.clkPrev = 0;
  const pc  = ex.comps.find(c => c.type === 'PC');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  const savedBps = new Set(debuggerState.breakpoints);
  try {
    comps = ex.comps; wires = ex.wires; outVals = {}; tick = 0;
    syncCompMap(); simulate();
    debuggerState.breakpoints = new Set([1]);   // halt when PC == word 1
    const r = debuggerRunHeadless(50);
    assertEq(r.halted, 'breakpoint', 'halted reason:');
    assertEq(tritsToInt(pc.state.p) + 4, 1, 'PC is at the breakpoint word:');
    // And it should NOT have run the full budget — counter program hits the
    // breakpoint on the first rising edge (after step 1).
    if (r.steps > 4) throw new Error(`expected halt within 4 steps, got ${r.steps}`);
    // Empty breakpoints — Run exhausts the budget cleanly.
    debuggerState.breakpoints = new Set();
    const r2 = debuggerRunHeadless(6);
    assertEq(r2.halted, 'budget', 'no-bp run exhausts budget:');
    assertEq(r2.steps, 6, 'budget steps consumed:');
  } finally {
    comps = savedComps; wires = savedWires; outVals = savedOutVals; tick = savedTick;
    debuggerState.breakpoints = savedBps;
    syncCompMap();
  }
});

// ---- Undo / redo ----------------------------------------------------------
//
// Sanity-check the snapshot stack against the canonical mutations a user
// makes from the canvas: add component, add wire, delete, edit-name. After
// each, undo() must restore the previous state and redo() must reapply it.

test('Undo / redo round-trips component add, wire add, delete', () => {
  // Save real state, work on an empty scratch state, restore at the end.
  const savedComps = comps, savedWires = wires;
  const savedNextC = nextCompId, savedNextW = nextWireId;
  const savedUndo = undoStack.slice(), savedRedo = redoStack.slice();
  try {
    comps = []; wires = []; nextCompId = 1; nextWireId = 1;
    syncCompMap(); undoStack.length = 0; redoStack.length = 0;
    // Add a STI.
    pushHistory();
    comps.push({ id: nextCompId++, type: 'STI', x: 0, y: 0, state: {} });
    syncCompMap();
    assertEq(comps.length, 1, 'one comp after add:');
    assertEq(undoStack.length, 1, 'one history entry:');
    // Add a wire from a fake INPUT.
    pushHistory();
    comps.push({ id: nextCompId++, type: 'INPUT', x: 0, y: 80, state: { value: 1 } });
    syncCompMap();
    pushHistory();
    wires.push({ id: nextWireId++, fromId: 2, fromPort: 'out', toId: 1, toPort: 'in' });
    assertEq(comps.length, 2, 'two comps after second add:');
    assertEq(wires.length, 1, 'one wire after wire add:');
    assertEq(undoStack.length, 3, 'three history entries:');
    // Undo the wire.
    undo();
    assertEq(wires.length, 0, 'wire gone after first undo:');
    assertEq(comps.length, 2, 'comps unchanged by wire undo:');
    assertEq(redoStack.length, 1, 'one redo entry:');
    // Undo the second comp.
    undo();
    assertEq(comps.length, 1, 'one comp after second undo:');
    // Redo it back.
    redo();
    assertEq(comps.length, 2, 'redo brings the comp back:');
    // Redo the wire.
    redo();
    assertEq(wires.length, 1, 'redo brings the wire back:');
    assertEq(redoStack.length, 0, 'redo stack drained:');
    // A fresh push invalidates the redo stack.
    undo(); undo();
    assertEq(comps.length, 1, 'two undos back to one comp:');
    pushHistory();
    comps.push({ id: nextCompId++, type: 'MAX', x: 100, y: 0, state: {} });
    assertEq(redoStack.length, 0, 'new push clears redo:');
  } finally {
    comps = savedComps; wires = savedWires;
    nextCompId = savedNextC; nextWireId = savedNextW;
    syncCompMap();
    undoStack.length = 0; redoStack.length = 0;
    for (const s of savedUndo) undoStack.push(s);
    for (const s of savedRedo) redoStack.push(s);
  }
});

// ---- palette search -------------------------------------------------------
//
// filterPalette() walks the .pal-item entries and hides ones whose text and
// data-type both miss the query. Section headers go away when their group
// has no visible items, and the empty-state hint appears for a no-match
// search.

test('filterPalette() hides non-matching palette items', () => {
  const inp = document.getElementById('pal-search');
  const aside = document.querySelector('aside.palette');
  if (!inp || !aside) return;   // no real DOM (headless runner) — skip cleanly
  const items = Array.from(aside.querySelectorAll('.pal-item'));
  const muxItem = items.find(el => (el.dataset || {}).type === 'MUX');
  const inputItem = items.find(el => (el.dataset || {}).type === 'INPUT');
  if (!muxItem || !inputItem) return;   // headless stub — palette not parsed
  const saved = inp.value;
  try {
    // Search "mux" — MUX entry visible, INPUT hidden.
    inp.value = 'mux'; filterPalette();
    assertEq(muxItem.style.display, '',     'MUX visible for "mux":');
    assertEq(inputItem.style.display, 'none', 'INPUT hidden for "mux":');
    // Garbage search — everything hidden, empty hint visible.
    inp.value = 'zzznotacomp'; filterPalette();
    assertEq(muxItem.style.display, 'none', 'MUX hidden for no-match:');
    const empty = document.getElementById('pal-empty');
    assertEq(empty.style.display, '', 'empty hint shown:');
    // Clear search — everything back.
    inp.value = ''; filterPalette();
    assertEq(muxItem.style.display, '',   'MUX restored after clear:');
    assertEq(inputItem.style.display, '', 'INPUT restored after clear:');
    assertEq(empty.style.display, 'none', 'empty hint hidden:');
  } finally {
    inp.value = saved; filterPalette();
  }
});

// ---- custom-gate registration & evaluation ----
test('Custom gate: table-lookup evaluation matches definition', () => {
  const savedGates = customGates;
  try {
    customGates = {};
    const table = {};
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
      table[`${a},${b}`] = -Math.min(a, b);
    }
    customGates['NAND3'] = { numInputs: 2, table };
    const fakeInstance = { type: 'GATE:NAND3', state: {} };
    const def = customGateDef(fakeInstance);
    assertEq(def.w, 80);
    if (!('in0' in def.pins) || !('in1' in def.pins) || !('out' in def.pins)) {
      throw new Error('expected pins in0, in1, out');
    }
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
      const r = def.eval(fakeInstance, { in0: a, in1: b });
      assertEq(r.out, -Math.min(a, b), `NAND3(${a},${b}):`);
    }
    assertEq(def.eval(fakeInstance, { in0: null, in1: 0 }).out, null, 'null input:');
  } finally {
    customGates = savedGates;
  }
});
test('Custom gate: enumerateInputs returns 3^n combinations in stable order', () => {
  assertEq(enumerateInputs(1).length, 3);
  assertEq(enumerateInputs(2).length, 9);
  assertEq(enumerateInputs(3).length, 27);
  assertDeepEq(enumerateInputs(1), [[-1], [0], [1]]);
  const two = enumerateInputs(2);
  assertDeepEq(two[0], [-1, -1]);
  assertDeepEq(two[two.length - 1], [1, 1]);
});

function runAllTests() {
  const results = [];
  for (const t of TESTS) {
    try { t.fn(); results.push({ name: t.name, pass: true }); }
    catch (e) { results.push({ name: t.name, pass: false, error: e.message }); }
  }
  return results;
}

document.getElementById('btn-tests').addEventListener('click', () => {
  const results = runAllTests();
  const pass = results.filter(r => r.pass).length;
  const fail = results.length - pass;
  document.getElementById('tests-summary').innerHTML =
    `<b style="color:${fail === 0 ? 'var(--t-pos)' : 'var(--t-neg)'}">` +
    `${pass} pass · ${fail} fail</b> · ${results.length} total`;
  const lines = results.map(r =>
    `<div class="test-row ${r.pass ? 'pass' : 'fail'}">
       <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
       <span>${escapeHtml(r.name)}</span>
       ${r.error ? `<span class="err">${escapeHtml(r.error)}</span>` : ''}
     </div>`);
  document.getElementById('tests-result').innerHTML = lines.join('');
  openModal('tests-modal');
});
document.getElementById('tests-run').addEventListener('click', () => {
  document.getElementById('btn-tests').click();
});
document.getElementById('tests-close').addEventListener('click', () => closeModal('tests-modal'));

document.getElementById('btn-crt').addEventListener('click', () => {
  document.body.classList.toggle('crt');
  try { localStorage.setItem('tritlogic.crt', document.body.classList.contains('crt') ? '1' : '0'); }
  catch (e) {}
  draw(); drawWaves();
});
// Restore CRT preference at boot.
try {
  if (localStorage.getItem('tritlogic.crt') === '1') document.body.classList.add('crt');
} catch (e) {}

// Wire-flow animation.  A monotonic counter that ticks every ~100 ms,
// used by drawWire() for the dashed-line offset.  We only schedule a draw
// when the page is visible and at least one wire actually has a non-null
// value to animate — static or all-floating circuits don't burn cycles.
let animTime = 0;
let _lastAnim = 0;
function animLoop(t) {
  if (t - _lastAnim > 100 && !document.hidden) {
    _lastAnim = t;
    animTime++;
    let live = false;
    for (const w of wires) {
      if (outVals[`${w.fromId}:${w.fromPort}`] != null) { live = true; break; }
    }
    if (live) draw();
  }
  requestAnimationFrame(animLoop);
}
requestAnimationFrame(animLoop);

// ============================================================================
//  VALIDATION
// ============================================================================
//
//  Inspect the current circuit for structural problems and return a list
//  of human-readable warnings.  Runs after load to catch corrupted saves
//  and detect dangling references that would otherwise cause silent
//  evaluation failures.

function validateCircuit() {
  const warnings = [];
  const idSet = new Set(comps.map(c => c.id));

  // Wires must point at existing components with the correct pin kind.
  for (const w of wires) {
    if (!idSet.has(w.fromId)) { warnings.push(`wire #${w.id}: source comp #${w.fromId} does not exist`); continue; }
    if (!idSet.has(w.toId))   { warnings.push(`wire #${w.id}: target comp #${w.toId} does not exist`); continue; }
    const fc = getComp(w.fromId), tc = getComp(w.toId);
    const fdef = compDef(fc), tdef = compDef(tc);
    if (!fdef.pins[w.fromPort]) warnings.push(`wire #${w.id}: ${fc.type} #${fc.id} has no pin "${w.fromPort}"`);
    else if (fdef.pins[w.fromPort].kind !== 'out') warnings.push(`wire #${w.id}: source pin "${w.fromPort}" is not an output`);
    if (!tdef.pins[w.toPort]) warnings.push(`wire #${w.id}: ${tc.type} #${tc.id} has no pin "${w.toPort}"`);
    else if (tdef.pins[w.toPort].kind !== 'in') warnings.push(`wire #${w.id}: target pin "${w.toPort}" is not an input`);
  }

  // Components must have a known type / a present library definition.
  for (const c of comps) {
    if (c.type.startsWith('SUB:')) {
      const name = c.type.slice(4);
      if (!subcircuitDefs[name]) warnings.push(`SUB instance #${c.id}: subcircuit "${name}" is not defined`);
    } else if (c.type.startsWith('GATE:')) {
      const name = c.type.slice(5);
      if (!customGates[name]) warnings.push(`GATE instance #${c.id}: custom gate "${name}" is not defined`);
    } else if (!TYPES[c.type]) {
      warnings.push(`Comp #${c.id}: unknown built-in type "${c.type}"`);
    }
  }

  // Direct subcircuit self-reference (cheap one-level cycle check).  Full
  // recursive cycle detection across the definition graph would need a DFS;
  // the recursion-depth guard added to simulateScope (below) catches deeper
  // cycles at runtime.
  for (const name in subcircuitDefs) {
    const def = subcircuitDefs[name];
    for (const sc of def.comps || []) {
      if (sc.type === 'SUB:' + name) warnings.push(`subcircuit "${name}" instantiates itself`);
    }
  }

  return warnings;
}

// ============================================================================
//  BOOT
// ============================================================================

resize();
loadExample();
setTool('select');
registerBuiltinSubcircuits();
refreshSubLib();
refreshGateLib();


// ---- ESM shim for the headless test runner -------------------------------
// In the browser this is a no-op; the Node test runner reads runAllTests off
// globalThis after the module evaluates. Keep this last so every symbol it
// references is already declared.
if (typeof globalThis !== "undefined") {
  globalThis.runAllTests = runAllTests;
  globalThis.TESTS = TESTS;
}
