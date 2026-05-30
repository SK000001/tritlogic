import {
  comps, wires, nextCompId, nextWireId, outVals, subcircuitDefs, customGates, view, tick, autoPlay, tool, placeType, mouse, drag, rmbDelete, pendingWire, hoverPin, selection, selectedWire, lastClickPos, compById, lastAsmProgram, _subDepth, animTime, _lastAnim,
  setComps, setWires, setNextCompId, setNextWireId, setOutVals, setSubcircuitDefs, setCustomGates, setView, setTick, assignAutoPlay, assignTool, setPlaceType, setMouse, setDrag, setRmbDelete, setPendingWire, setHoverPin, setSelection, setSelectedWire, setLastClickPos, setCompById, setLastAsmProgram, setSubDepth, setAnimTime, setLastAnim,
  _pathCache, _wireOccupied, undoStack, redoStack,
  cv, ctx, statusEl, selInfo, waveCv, waveCtx
} from './state.js';
import {
  TRIT_COLOR, tritColor, tritLabel, tritClass, SAVE_FORMAT_VERSION, upgradeSave,
  deepClone, intToTrits, tritsToInt, parseTryteString, formatTryte, escapeHtml
} from './util.js';
import {
  INFO_GATE_TYPES, INFO_CATEGORIES, COMPONENT_INFO
} from './info-data.js';
import {
  ASM_OPCODES, ASM_PROGRAM_WORDS, assemble, decodeImemWord,
  ASM2_OPCODES, ASM2_IMM_RANGE, ASM2_ADDR_RANGE, assembleV2, decodeImemWordV2,
  ASM_EXAMPLES, ASM2_EXAMPLES
} from './assembler.js';
import { createExamples } from './examples.js';
import { registerTests } from './tests.js';
import { createRender } from './render.js';
import { createEngine } from './engine.js';


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
};

// ============================================================================
//  WORLD STATE
// ============================================================================




// Tool / interaction state


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
function syncCompMap() { setCompById(new Map(comps.map(c => [c.id, c]))); }
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
// Per-cell occupancy: gridKey -> sourceKey ('fromId:fromPort').  Wires
// route in id order; each one marks its cells so subsequent wires with a
// DIFFERENT source pin steer around them (rather than overlapping
// longitudinally).  Same-source wires (fan-out) are free to share cells
// since their carried signal is identical.
let _pathCacheRev = 0;
function invalidatePathCache() { _pathCache.clear(); _wireOccupied.clear(); _pathCacheRev++; }
function pathCacheRev() { return _pathCacheRev; }

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
//  ENGINE + RENDER WIRING
// ============================================================================
//
//  Engine ↔ render is a cycle: stepSequential() ends with a draw() /
//  drawWaves() repaint, and several drawXxx functions consult engine's
//  inputValueFromWires(). We resolve it by sharing a single deps object that
//  each factory reads lazily — fill draw / drawWaves on it after createRender
//  returns, and inputValueFromWires after createEngine returns. This block
//  must sit after every helper it passes in (compDef, fanoutPins, wirePath,
//  …) but before any top-level addEventListener that references the returned
//  handles by name (e.g. btn-step → stepSequential).

const engineDeps = { TYPES, compDef };
const {
  simulate, simulateScope, simulateTimed, stepSequential,
  subInstanceDef, simulateSubInstance, cloneSubScope,
  inputValueFromWires,
} = createEngine(engineDeps);

const renderDeps = {
  RAM_WORDS, TYPES,
  compDef, fanoutPins, getComp,
  inputValueFromWires,
  invalidatePathCache, pathCacheRev,
  pinAbsPos, screenToWorld, segHitsBox, wirePath,
};
const {
  draw, drawCustomGate, drawCustomGateMissing,
  drawSubInstance, drawSubMissing, drawWaves, DRAW,
} = createRender(renderDeps);

// Close the cycle. `refreshDebugger` is a function declaration further down
// in this file (hoisted), so capturing it here is fine.
engineDeps.draw = draw;
engineDeps.drawWaves = drawWaves;
engineDeps.drawSubInstance = drawSubInstance;
engineDeps.drawSubMissing = drawSubMissing;
engineDeps.refreshDebugger = refreshDebugger;


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
    id: setNextCompId(nextCompId + 1),
    type: 'SUB:' + name,
    x: snap(bbox.x),
    y: snap(bbox.y),
    state: {},
  };
  setComps(comps.filter(c => !ids.has(c.id)));
  setWires(wires.filter(w => !ids.has(w.fromId) && !ids.has(w.toId)));
  comps.push(instance); syncCompMap();

  // Re-route external wires.  Inbound (... → input) become wires from the
  // external source to the instance's matching input pin.  Outbound similarly.
  for (const w of inboundWires) {
    const target = inSelComps.find(c => c.id === w.toId);
    const inputPin = inputs.find(p => p.srcId === target.id);
    if (inputPin) {
      wires.push({ id: setNextWireId(nextWireId + 1), fromId: w.fromId, fromPort: w.fromPort,
                   toId: instance.id, toPort: inputPin.name });
    }
  }
  for (const w of outboundWires) {
    const source = inSelComps.find(c => c.id === w.fromId);
    const outputPin = outputs.find(p => p.srcId === source.id);
    if (outputPin) {
      wires.push({ id: setNextWireId(nextWireId + 1), fromId: instance.id, fromPort: outputPin.name,
                   toId: w.toId, toPort: w.toPort });
    }
  }

  selection.clear(); setSelectedWire(null);
  invalidatePathCache();
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
  setComps(deepClone(def.comps));
  setWires(deepClone(def.wires));
  syncCompMap();
  setNextCompId(comps.reduce((m, c) => Math.max(m, c.id), 0) + 1);
  setNextWireId(wires.reduce((m, w) => Math.max(m, w.id), 0) + 1);
  setView({ tx: 40, ty: 40, scale: 1 });
  selection.clear(); setSelectedWire(null); setTick(0); setOutVals({});
  setTool('select');
  invalidatePathCache();
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
  // Editable fields: any type-specific ones (from the type's inspector) plus a
  // universal propagation-delay field used by the timing-mode simulator (A2),
  // shown only for components that actually propagate (have an in and an out).
  const tdef = TYPES[c.type];
  const fields = (tdef && tdef.inspector) ? tdef.inspector(c) : [];
  const pinKinds = Object.values(def.pins).map(p => p.kind);
  const propagates = pinKinds.includes('in') && pinKinds.includes('out');
  if (fields.length || propagates) {
    html += `<div class="inspector-form" id="insp-form"></div>`;
  }
  selInfo.innerHTML = html;
  const form = document.getElementById('insp-form');
  if (form) {
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
    if (propagates) {
      const labelEl = document.createElement('label');
      labelEl.textContent = 'Delay (timing)';
      labelEl.title = 'Propagation delay in abstract time units for Timing mode (≥1).';
      form.appendChild(labelEl);
      const inputEl = document.createElement('input');
      inputEl.type = 'number'; inputEl.min = '1'; inputEl.step = '1';
      inputEl.value = String(Number.isInteger(c.state.delay) ? c.state.delay : 1);
      inputEl.addEventListener('change', () => {
        const n = Math.max(1, Math.round(parseInt(inputEl.value, 10) || 1));
        pushHistory();           // also drops out of any active timing playback
        c.state.delay = n;
        updateInspector();
      });
      form.appendChild(inputEl);
    }
  }
}

// ============================================================================
//  INTERACTION
// ============================================================================

function setStatus(s) { statusEl.textContent = s; }
function setTool(t, type = null) {
  assignTool(t); setPlaceType(type);
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
  setPendingWire(null);
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
  if (localStorage.getItem('tritlogic.rmbDelete') === '0') setRmbDelete(false);
} catch (e) {}
rmbToggle.checked = rmbDelete;
rmbToggle.addEventListener('change', () => {
  setRmbDelete(rmbToggle.checked);
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
    let moved = false;
    for (const item of drag.items) {
      const c = getComp(item.id);
      if (c) {
        const nx = item.x0 + dx, ny = item.y0 + dy;
        if (c.x !== nx || c.y !== ny) { c.x = nx; c.y = ny; moved = true; }
      }
    }
    if (moved) invalidatePathCache();
  }
  setHoverPin(hitTestPin(mouse.wx, mouse.wy));
  if (hoverPin) setHoverPin({ compId: hoverPin.comp.id, port: hoverPin.port,
                             kind: hoverPin.kind, x: hoverPin.x, y: hoverPin.y });
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
  setComps(deepClone(snap.comps));
  setWires(deepClone(snap.wires));
  setNextCompId(snap.nextCompId);
  setNextWireId(snap.nextWireId);
  setSubcircuitDefs(deepClone(snap.subcircuitDefs));
  registerBuiltinSubcircuits();
  setCustomGates(deepClone(snap.customGates));
  syncCompMap();
  invalidatePathCache();
  selection.clear(); setSelectedWire(null); setPendingWire(null);
  setOutVals({});
  if (typeof refreshSubLib === 'function') refreshSubLib();
  if (typeof refreshGateLib === 'function') refreshGateLib();
  simulate(); draw(); updateInspector();
}

function pushHistory() {
  // Any structural edit leaves the timed-propagation playback stale, so drop
  // out of timing mode first (no-op when it isn't active).
  exitTimingMode();
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
    setDrag({ kind: 'pan', mx0: mouse.x, my0: mouse.y, tx0: view.tx, ty0: view.ty });
    return;
  }
  if (e.button !== 0) return;

  // Place mode
  if (tool === 'place' && placeType) {
    const tdef = placeType.startsWith('SUB:') ? subInstanceDef({type: placeType}) : TYPES[placeType];
    const state = (tdef.defaults || (() => ({})))();
    // If WAVE, ensure trace is a fresh array (defaults() already does it)
    const c = {
      id: setNextCompId(nextCompId + 1),
      type: placeType,
      x: snap(mouse.wx - tdef.w/2),
      y: snap(mouse.wy - tdef.h/2),
      state,
    };
    pushHistory();
    comps.push(c); syncCompMap();
    invalidatePathCache();
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
    setSelectedWire(null);
    const items = Array.from(selection).map(id => {
      const cc = getComp(id);
      return { id, x0: cc.x, y0: cc.y };
    });
    // Pre-emptive snapshot: if it turns out to be a no-move click, mouseup
    // pops it; if it was a real drag (movement) or a click on INPUT/CONST
    // (cycles the value), the snapshot stays.
    pushHistory();
    setDrag({ kind: 'comp', startWX: mouse.wx, startWY: mouse.wy, items,
             clickComp: c, startMX: mouse.x, startMY: mouse.y });
    updateInspector(); draw();
    return;
  }
  // Wire?
  const wr = hitTestWire(mouse.wx, mouse.wy);
  if (wr) {
    selection.clear();
    setSelectedWire(wr.id);
    updateInspector(); draw();
    return;
  }
  // Empty space — drag pans the canvas by default, Shift+drag rect-selects.
  // (Space+drag and middle-mouse-drag also pan, handled in the early-return
  // branch above.)
  if (e.shiftKey) {
    setDrag({ kind: 'rect', x0: mouse.wx, y0: mouse.wy });
    updateInspector(); draw();
  } else {
    selection.clear();
    setSelectedWire(null);
    setDrag({ kind: 'pan', mx0: mouse.x, my0: mouse.y, tx0: view.tx, ty0: view.ty });
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
  setDrag(null);
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
      setPendingWire({ compId: pin.comp.id, port: pin.port, fromKind: pin.kind,
                      fromXY: { x: pin.x, y: pin.y } });
      setStatus('wire start (click an opposite-kind pin)');
      draw(); return;
    }
    addWire(fromId, fromPort, toId, toPort);
    setPendingWire(null);
    setStatus('wire placed');
  } else {
    setPendingWire({ compId: pin.comp.id, port: pin.port, fromKind: pin.kind,
                    fromXY: { x: pin.x, y: pin.y } });
    setStatus(`wire start (${pin.kind}) — click an opposite-kind pin`);
  }
  draw();
}

// Internal delete primitives — no history push here, because callers
// (deleteSelection, right-click-delete, deleteComp/deleteWire from the
// Delete tool path) all wrap their own pushHistory() around the call.
function _deleteCompNoHist(id) {
  setComps(comps.filter(c => c.id !== id));
  syncCompMap();
  setWires(wires.filter(w => w.fromId !== id && w.toId !== id));
  selection.delete(id);
  if (selectedWire) {
    const w = wires.find(w => w.id === selectedWire);
    if (!w) setSelectedWire(null);
  }
  invalidatePathCache();
}
function _deleteWireNoHist(id) {
  setWires(wires.filter(w => w.id !== id));
  if (selectedWire === id) setSelectedWire(null);
  invalidatePathCache();
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
  setWires(wires.filter(w => !(w.toId === toId && w.toPort === toPort)));
  wires.push({ id: setNextWireId(nextWireId + 1), fromId, fromPort, toId, toPort });
  invalidatePathCache();
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
    setPendingWire(null); selection.clear(); setSelectedWire(null);
    updateInspector(); draw();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { mouse.spaceDown = false; cv.style.cursor = ''; }
});

// ============================================================================
//  TOOLBAR ACTIONS
// ============================================================================

document.getElementById('btn-step').addEventListener('click', () => { exitTimingMode(); stepSequential(); });

// Start or stop the 4 Hz auto-step.  Idempotent: a no-op if already in
// the requested state.  Used by the Play button and by example loading.
function setAutoPlay(on) {
  if (on) exitTimingMode();   // stepping the clock leaves a timed trace stale
  const btn = document.getElementById('btn-play');
  if (on && !autoPlay) {
    assignAutoPlay(setInterval(stepSequential, 250));
    btn.classList.add('active'); btn.textContent = '⏸ Pause';
  } else if (!on && autoPlay) {
    clearInterval(autoPlay); assignAutoPlay(null);
    btn.classList.remove('active'); btn.textContent = '▶ Play';
  }
}
document.getElementById('btn-play').addEventListener('click', () => setAutoPlay(!autoPlay));

document.getElementById('btn-reset').addEventListener('click', () => {
  exitTimingMode();
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
  setTick(0); setOutVals({});
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

// ============================================================================
//  TIMING MODE (A2 — watch propagation delays)
// ============================================================================
//
//  A playback view over simulateTimed(). Entering runs a cold-start timed
//  settle of the current circuit; a slider scrubs a simulation-time cursor and
//  the canvas recolours each net by its value AT that time, so a wavefront
//  visibly sweeps through the circuit (e.g. a ripple-carry adder's carry, one
//  gate-delay per step) and glitching nets flip and flip back as you scrub.
//  Non-invasive: it temporarily drives `outVals` to the timed snapshot and
//  restores the live steady state on exit. Give a gate a larger delay via the
//  inspector's Delay field to create skew (and hazards).
const timing = { active: false, run: null, t: 0, playTimer: null };

function timingValsAt(t) {
  // Reconstruct net values at time t from the ascending change log. Cold start
  // ⇒ a net absent from the log was never driven (null).
  const v = {};
  for (const ch of timing.run.changes) {
    if (ch.t > t) break;
    v[ch.key] = ch.value;
  }
  return v;
}

function timingFrame() {
  if (!timing.active) return;
  setOutVals(timingValsAt(timing.t));
  const slider = document.getElementById('timing-slider');
  if (slider) slider.value = String(timing.t);
  const ro = document.getElementById('timing-readout');
  if (ro) {
    const h = timing.run.hazards.length;
    ro.textContent = `t = ${timing.t} / ${timing.run.settleTime}` +
      `  ·  ${h} glitch${h === 1 ? '' : 'es'}` +
      (timing.run.settled ? '' : '  ·  unsettled');
  }
  draw();
}

function timingPlay(on) {
  const btn = document.getElementById('timing-play');
  if (on && !timing.playTimer) {
    if (timing.t >= timing.run.settleTime) timing.t = 0;   // restart from 0 if at the end
    timing.playTimer = setInterval(() => {
      if (timing.t >= timing.run.settleTime) { timingPlay(false); return; }
      timing.t++; timingFrame();
    }, 140);
    if (btn) { btn.textContent = '⏸'; btn.classList.add('active'); }
  } else if (!on && timing.playTimer) {
    clearInterval(timing.playTimer); timing.playTimer = null;
    if (btn) { btn.textContent = '▶'; btn.classList.remove('active'); }
  }
}

function enterTimingMode() {
  setAutoPlay(false);
  simulate();                                    // clean steady-state baseline
  timing.run = simulateTimed({ comps, wires });
  timing.active = true;
  timing.t = timing.run.settleTime;              // start on the fully-settled frame
  const slider = document.getElementById('timing-slider');
  if (slider) {
    slider.min = '0';
    slider.max = String(Math.max(0, timing.run.settleTime));
    slider.value = String(timing.t);
  }
  document.body.classList.add('timing-open');
  document.getElementById('btn-timing').classList.add('active');
  timingFrame();
  setStatus(`timing mode — settles in ${timing.run.settleTime} delay units, ` +
            `${timing.run.hazards.length} glitch net(s)`);
}

function exitTimingMode() {
  if (!timing.active) return;
  timingPlay(false);
  timing.active = false;
  timing.run = null;
  document.body.classList.remove('timing-open');
  document.getElementById('btn-timing').classList.remove('active');
  simulate(); draw();                            // restore live values
}

document.getElementById('btn-timing').addEventListener('click', () => {
  if (timing.active) exitTimingMode(); else enterTimingMode();
});
document.getElementById('timing-close').addEventListener('click', exitTimingMode);
document.getElementById('timing-play').addEventListener('click', () => timingPlay(!timing.playTimer));
document.getElementById('timing-slider').addEventListener('input', (e) => {
  if (!timing.active) return;
  timingPlay(false);
  timing.t = parseInt(e.target.value, 10) || 0;
  timingFrame();
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
    const addGroup = (label, examples) => {
      const og = document.createElement('optgroup'); og.label = label;
      for (const key in examples) {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = examples[key].label;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    };
    addGroup('ISA v1 (CPU)',  ASM_EXAMPLES);
    addGroup('ISA v2 (CPU2)', ASM2_EXAMPLES);
  }
  // Seed the textarea with a sensible default based on which CPU is on canvas.
  const ta = document.getElementById('asm-source');
  if (ta && !ta.value.trim()) {
    const version = detectIsaVersion();
    ta.value = (version === 2 ? ASM2_EXAMPLES['counter2'].src : ASM_EXAMPLES['counter'].src).trimEnd();
  }
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
  // Print the encoded word image — one line per word, low trit first. v2
  // shows the two parallel RAM rows side by side.
  const fmt = t => t === -1 ? 'T' : t === 1 ? '+1' : ' 0';
  let rows;
  if (res.mem_lo && res.mem_hi) {
    rows = res.mem_lo.map((w, i) => {
      const used = i < res.words ? '' : ' style="color: var(--muted)"';
      const lo = w.map(fmt).join(' ');
      const hi = res.mem_hi[i].map(fmt).join(' ');
      return `<div${used}>  w${i}: lo[${lo}]  hi[${hi}]</div>`;
    }).join('');
  } else {
    rows = res.mem.map((w, i) => {
      const used = i < res.words ? '' : ' style="color: var(--muted)"';
      const trits = w.map(fmt).join(' ');
      return `<div${used}>  word ${i}: [${trits}]</div>`;
    }).join('');
  }
  out.innerHTML =
    `<div style="color: var(--accent)">Assembled ${res.words} instruction${res.words === 1 ? '' : 's'}` +
    ` (${ASM_PROGRAM_WORDS - res.words} word${ASM_PROGRAM_WORDS - res.words === 1 ? '' : 's'} padded with 0).</div>` +
    `<div style="margin-top: 4px; font-family: monospace;">${rows}</div>`;
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
  setOutVals({}); setTick(0);
  simulate(); draw(); drawWaves();
  return { ok: true, msg: `Loaded ${mem.length} words into RAM #${ram.id}.` };
}

// v2 IMEM finder — locate two RAM blocks that share the PC's address pins
// (the parallel-RAM shape used by the CPU2 preset). Returns
// { ramLo, ramHi } where ramLo is wired to imem.q0=opL and ramHi is the
// other one, or null if the canvas isn't v2-shaped.
function findImemV2(scope) {
  scope = scope || { comps, wires };
  const pcs = scope.comps.filter(c => c.type === 'PC');
  if (pcs.length === 0) return null;
  const pc = pcs[0];
  const pcRams = scope.comps.filter(c => {
    if (c.type !== 'RAM') return false;
    const a0Wire = scope.wires.find(w => w.toId === c.id && w.toPort === 'a0' && w.fromId === pc.id);
    return !!a0Wire;
  });
  if (pcRams.length !== 2) return null;
  // The "lo" RAM is the one whose q0 feeds the DECODE2 subcircuit's opL
  // pin. Fall back to whichever one feeds the ALU.b0 if the decoder isn't
  // present (CPU2 phase A always has it, but be defensive).
  for (const r of pcRams) {
    const opLWire = scope.wires.find(w => w.fromId === r.id && w.fromPort === 'q0' &&
      scope.comps.find(c => c.id === w.toId && c.type === 'SUB:DECODE2' && w.toPort === 'opL'));
    if (opLWire) {
      return { ramLo: r, ramHi: pcRams.find(x => x.id !== r.id) };
    }
  }
  // Fallback: pick the one with lower id as "lo".
  pcRams.sort((a, b) => a.id - b.id);
  return { ramLo: pcRams[0], ramHi: pcRams[1] };
}

function loadProgramIntoImemV2(mem_lo, mem_hi) {
  const pair = findImemV2();
  if (!pair) return { ok: false, msg: 'No CPU2-shaped IMEM (two PC-addressed RAMs) on canvas — load the CPU2 example.' };
  pushHistory();
  pair.ramLo.state.mem = mem_lo.map(w => w.slice());
  pair.ramHi.state.mem = mem_hi.map(w => w.slice());
  pair.ramLo.state.clkPrev = 0;
  pair.ramHi.state.clkPrev = 0;
  setOutVals({}); setTick(0);
  simulate(); draw(); drawWaves();
  return { ok: true, msg: `Loaded ${mem_lo.length} words into RAMs #${pair.ramLo.id} / #${pair.ramHi.id}.` };
}

// Decide which ISA the canvas is wired for. Returns 2 if a CPU2-style
// parallel-RAM IMEM is present, 1 otherwise (default to v1).
function detectIsaVersion(scope) {
  return findImemV2(scope) ? 2 : 1;
}

// Stash the last-loaded assembly + asm result so the debugger can render
// source lines and map PC → source line. Set when "Assemble & Load" succeeds.
document.getElementById('btn-asm').addEventListener('click', openAsmModal);
document.getElementById('asm-close').addEventListener('click', () => closeModal('asm-modal'));
document.getElementById('asm-example').addEventListener('change', (e) => {
  const ex = ASM_EXAMPLES[e.target.value] || ASM2_EXAMPLES[e.target.value];
  if (!ex) return;
  document.getElementById('asm-source').value = ex.src.trimEnd();
  document.getElementById('asm-status').textContent = '';
  document.getElementById('asm-result').innerHTML = '';
  e.target.value = '';
});
// Auto-dispatch by detecting which CPU is on canvas: v2 if a two-RAM
// parallel-IMEM is wired up, v1 otherwise. The "Assemble (check only)"
// button reports against the SAME version so the user sees errors that
// match what loading would produce.
function assembleForCanvas(src) {
  const version = detectIsaVersion();
  const res = (version === 2) ? assembleV2(src) : assemble(src);
  res.version = version;
  return res;
}
document.getElementById('asm-check').addEventListener('click', () => {
  const res = assembleForCanvas(document.getElementById('asm-source').value);
  renderAsmResult(res);
  document.getElementById('asm-status').textContent =
    res.errors.length ? `${res.errors.length} error(s) (ISA v${res.version})` : `assembled cleanly (ISA v${res.version})`;
});
document.getElementById('asm-load').addEventListener('click', () => {
  const res = assembleForCanvas(document.getElementById('asm-source').value);
  renderAsmResult(res);
  if (res.errors.length) {
    document.getElementById('asm-status').textContent = `${res.errors.length} error(s) — fix before loading`;
    return;
  }
  const r = (res.version === 2)
    ? loadProgramIntoImemV2(res.mem_lo, res.mem_hi)
    : loadProgramIntoImem(res.mem);
  document.getElementById('asm-status').textContent = r.msg;
  if (r.ok) {
    setLastAsmProgram({
      source:     document.getElementById('asm-source').value,
      version:    res.version,
      mem:        res.mem    ? res.mem.map(w => w.slice())    : null,
      mem_lo:     res.mem_lo ? res.mem_lo.map(w => w.slice()) : null,
      mem_hi:     res.mem_hi ? res.mem_hi.map(w => w.slice()) : null,
      addrToLine: res.addrToLine.slice(),
      labels:     { ...res.labels },
      words:      res.words,
    });
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


function findDebuggerTargets(scope) {
  // Returns { pc, imem, imemHi, acc, version } or null if the canvas doesn't
  // hold a CPU. version is 1 (one IMEM RAM) or 2 (two parallel IMEMs).
  // ACC = the REG3 whose d-pins are driven by the ALU; falls back to first
  // REG3. The CPU example wires the ALU outputs straight into ACC.
  scope = scope || { comps, wires };
  const pc = scope.comps.find(c => c.type === 'PC');
  if (!pc) return null;
  const pairV2 = findImemV2(scope);
  const imem = pairV2 ? pairV2.ramLo : findImem(scope);
  if (!imem) return null;
  const regs = scope.comps.filter(c => c.type === 'REG3');
  let acc = null;
  for (const r of regs) {
    const dWire = scope.wires.find(w => w.toId === r.id && w.toPort === 'd0');
    if (!dWire) continue;
    const src = scope.comps.find(c => c.id === dWire.fromId);
    if (src && src.type === 'ALU') { acc = r; break; }
  }
  if (!acc) acc = regs[0] || null;
  return { pc, imem, imemHi: pairV2 ? pairV2.ramHi : null, acc, version: pairV2 ? 2 : 1 };
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
  // ACC sign — surfaces what CPU2's JMPP / JMPZ would branch on next cycle.
  const accSign = accVal > 0 ? '+' : accVal < 0 ? 'T' : '0';
  const signClass = accVal > 0 ? 'trit-P' : accVal < 0 ? 'trit-T' : 'trit-0';
  pcEl.textContent  = `${pcAddr}  [${targets.pc.state.p.map(tritLabel).join(' ')}]`;
  accEl.innerHTML = `${accVal >= 0 ? '+' : ''}${accVal}  ` +
    (targets.acc ? `[${targets.acc.state.q.map(tritLabel).join(' ')}]` : '') +
    `  <span class="${signClass}" title="ACC sign — JMPP branches on +, JMPZ on 0">sign:${accSign}</span>`;
  const decodeWord = (i) => targets.version === 2
    ? decodeImemWordV2(targets.imem.state.mem[i], targets.imemHi.state.mem[i])
    : decodeImemWord(targets.imem.state.mem[i] || [0,0,0]);
  instrEl.textContent = `word ${pcAddr}: ${decodeWord(pcAddr)}  (ISA v${targets.version})`;

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
      return `<div style="padding: 1px 6px; ${bg}">${bpDot} <span style="color: var(--muted);">${lnLabel}</span>  ${escapeHtml(raw) || '&nbsp;'}</div>`;
    }).join('');
  } else {
    srcEl.innerHTML = `<div style="padding: 8px; color: var(--muted);">No assembled program yet. Open <b>Assemble</b>, write a program, and click <b>Assemble &amp; Load into IMEM</b>.</div>`;
  }

  // IMEM dump. v2 shows both parallel-RAM rows side by side.
  memEl.innerHTML = targets.imem.state.mem.map((w, i) => {
    const isPc = (i === pcAddr);
    const hasBp = debuggerState.breakpoints.has(i);
    const triFmt = arr => arr.map(t => t == null ? '?' : tritLabel(t)).join(' ');
    const bg = isPc ? 'background: rgba(110,168,255,0.18);' : '';
    const bpDot = `<span class="dbg-bp-mem" data-addr="${i}" style="cursor: pointer;
       color: ${hasBp ? 'var(--t-neg)' : 'var(--muted)'};">●</span>`;
    const trits = targets.version === 2
      ? `lo[${triFmt(w)}] hi[${triFmt(targets.imemHi.state.mem[i] || [0,0,0])}]`
      : `[${triFmt(w)}]`;
    return `<div style="padding: 1px 6px; ${bg}">${bpDot} <span style="color: var(--muted);">w${i}</span>  ${trits}  ${escapeHtml(decodeWord(i))}</div>`;
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
  setOutVals({}); setTick(0);
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
  setComps([]); setWires([]); setNextCompId(1); setNextWireId(1); syncCompMap();
  setOutVals({}); selection.clear(); setSelectedWire(null); setTick(0);
  invalidatePathCache();
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
      let data = JSON.parse(reader.result);
      // Version check.  Newer-than-us = warn but load (the user may know
      // the new fields are additive). Older-or-equal = walk the migration
      // chain in util.js up to SAVE_FORMAT_VERSION.
      const v = data.version;
      if (typeof v === 'number' && v > SAVE_FORMAT_VERSION) {
        if (!confirm(`Save file is format version ${v}; this build only knows up to ${SAVE_FORMAT_VERSION}. Load anyway?`)) return;
      } else {
        try { data = upgradeSave(data); }
        catch (err) { alert('Could not migrate save file: ' + err.message); return; }
      }
      pushHistory();
      setComps(data.comps || []);
      setWires(data.wires || []);
      syncCompMap();
      setNextCompId(data.nextCompId || (comps.reduce((m,c) => Math.max(m,c.id), 0) + 1));
      setNextWireId(data.nextWireId || (wires.reduce((m,w) => Math.max(m,w.id), 0) + 1));
      setView(data.view || { tx: 40, ty: 40, scale: 1 });
      setTick(data.tick || 0);
      setSubcircuitDefs(data.subcircuitDefs || {});
      registerBuiltinSubcircuits();   // keep the built-ins present after a load
      setCustomGates(data.customGates    || {});
      selection.clear(); setSelectedWire(null);
      setOutVals({});
      invalidatePathCache();
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
//  CONTROL KIT — decoders and other CPU control glue
// ============================================================================
//
//  DECODE2 — 2-trit opcode → 9 one-hot enable lines for the v2 ISA (see
//  tritlogic/ISA_v2.md). Each enable is active-high in the {0, +1}
//  convention: +1 when its op is selected, 0 otherwise. The {0,+1} choice
//  (rather than {T,+1}) lets the CPU2 datapath compute the ALU op selector
//  as a single TSUM gate: aluOpSel = TSUM(en_MAXI, NEG(en_MINI)).
//
//  Per opcode trit x ∈ {T, 0, +1} we extract three detectors. The native
//  inverters PTI / NTI here output +1 *unless* the input matches their
//  target trit — PTI(+1) = T, PTI(other) = +1; NTI(-1) = +1, NTI(other) =
//  T — so the trit-equality formulas have to negate accordingly:
//    isP(x) = MAX(STI(MAX(PTI(x), NTI(x))), 0)   ; +1 iff x = +1
//    isT(x) = MAX(NTI(x), 0)                     ; +1 iff x = -1
//    is0(x) = MAX(MIN(PTI(x), STI(NTI(x))), 0)   ; +1 iff x =  0
//  Each enable = MIN(is_H, is_L) (MIN acts as AND on the {0,+1} domain).
//
//  Opcode assignment (matches ISA_v2.md):
//    NOP  TT  | JMP  T0  | JMPP T+
//    JMPZ 0T  | ADDI 00  | MAXI 0+
//    MINI +T  | LOAD +0  | STORE ++
function buildDecode2Def() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [];
    const wires = [];
    // Inputs.
    comps.push(c('opL', 'INPUT', 40, 30, { value: 0, name: 'opL' }));
    comps.push(c('opH', 'INPUT', 40, 80, { value: 0, name: 'opH' }));
    // The {T,+1} → {0,+1} clamp needs a constant 0 to MAX against.
    comps.push(c('zero', 'CONST', 40, 140, { value: 0 }));

    // Per-trit detector block. Builds three trit-equality detectors that
    // output +1 iff the input matches the target trit (else 0).
    function detectorBlock(trit, x0, y0) {
      // Raw inverters (T-active outputs, ∈ {-1, +1}).
      comps.push(c(`pti_${trit}`,   'PTI',  x0,      y0));
      comps.push(c(`nti_${trit}`,   'NTI',  x0,      y0 + 60));
      // Building blocks needed by the corrected formulas.
      comps.push(c(`mxPN_${trit}`,  'MAX',  x0 + 140, y0 - 10));   // MAX(PTI, NTI) ∈ {-1, +1}
      comps.push(c(`sNeg_${trit}`,  'STI',  x0 + 290, y0 - 10));   // STI(mxPN) — +1 iff x=+1
      comps.push(c(`isP_${trit}`,   'MAX',  x0 + 430, y0));        // clamp to {0,+1}
      comps.push(c(`isT_${trit}`,   'MAX',  x0 + 430, y0 + 60));   // clamp NTI to {0,+1}
      comps.push(c(`notNti_${trit}`, 'STI', x0 + 290, y0 + 130));  // STI(NTI) — +1 unless x=-1
      comps.push(c(`is0t_${trit}`,  'MIN',  x0 + 430, y0 + 140));  // MIN(PTI, notNti) — +1 iff x=0
      comps.push(c(`is0_${trit}`,   'MAX',  x0 + 580, y0 + 140));  // clamp to {0,+1}

      // Input trit fans out to PTI, NTI.
      wires.push(w(trit,            'out', `pti_${trit}`,    'in'));
      wires.push(w(trit,            'out', `nti_${trit}`,    'in'));
      // isP = MAX(STI(MAX(PTI, NTI)), 0).
      wires.push(w(`pti_${trit}`,   'out', `mxPN_${trit}`,   'a'));
      wires.push(w(`nti_${trit}`,   'out', `mxPN_${trit}`,   'b'));
      wires.push(w(`mxPN_${trit}`,  'out', `sNeg_${trit}`,   'in'));
      wires.push(w(`sNeg_${trit}`,  'out', `isP_${trit}`,    'a'));
      wires.push(w('zero',          'out', `isP_${trit}`,    'b'));
      // isT = MAX(NTI, 0).
      wires.push(w(`nti_${trit}`,   'out', `isT_${trit}`,    'a'));
      wires.push(w('zero',          'out', `isT_${trit}`,    'b'));
      // is0 = MAX(MIN(PTI, STI(NTI)), 0).
      wires.push(w(`nti_${trit}`,   'out', `notNti_${trit}`, 'in'));
      wires.push(w(`pti_${trit}`,   'out', `is0t_${trit}`,   'a'));
      wires.push(w(`notNti_${trit}`,'out', `is0t_${trit}`,   'b'));
      wires.push(w(`is0t_${trit}`,  'out', `is0_${trit}`,    'a'));
      wires.push(w('zero',          'out', `is0_${trit}`,    'b'));
    }
    detectorBlock('opH', 210, 30);
    detectorBlock('opL', 210, 430);

    // Enable combiners — one MIN gate per opcode codepoint.
    // Each row: [enable_name, opH_detector, opL_detector, yPos]
    const combos = [
      ['en_NOP',   'isT_opH', 'isT_opL'],
      ['en_JMP',   'isT_opH', 'is0_opL'],
      ['en_JMPP',  'isT_opH', 'isP_opL'],
      ['en_JMPZ',  'is0_opH', 'isT_opL'],
      ['en_ADDI',  'is0_opH', 'is0_opL'],
      ['en_MAXI',  'is0_opH', 'isP_opL'],
      ['en_MINI',  'isP_opH', 'isT_opL'],
      ['en_LOAD',  'isP_opH', 'is0_opL'],
      ['en_STORE', 'isP_opH', 'isP_opL'],
    ];
    combos.forEach(([name, dH, dL], i) => {
      const y = 30 + i * 70;
      comps.push(c(name, 'MIN', 820, y));
      comps.push(c('out_' + name, 'OUTPUT', 1000, y + 10, { name }));
      wires.push(w(dH,   'out', name,            'a'));
      wires.push(w(dL,   'out', name,            'b'));
      wires.push(w(name, 'out', 'out_' + name,   'in'));
    });
    return { comps, wires };
  });
  return {
    inputs:  [{ name: 'opL' }, { name: 'opH' }],
    outputs: [
      { name: 'en_NOP'   }, { name: 'en_JMP'   }, { name: 'en_JMPP' },
      { name: 'en_JMPZ'  }, { name: 'en_ADDI'  }, { name: 'en_MAXI' },
      { name: 'en_MINI'  }, { name: 'en_LOAD'  }, { name: 'en_STORE' },
    ],
    comps, wires,
    nextCompId: comps.reduce((m, c) => Math.max(m, c.id), 0) + 1,
    nextWireId: wires.reduce((m, z) => Math.max(m, z.id), 0) + 1,
  };
}

//  ACC_SIGN — three ACC trits (q0/q1/q2) → two enable-style flags isZero and
//  isPos, both in the {0, +1} convention (matching DECODE2). Drives CPU2's
//  conditional jumps: JMPP gates on isPos, JMPZ on isZero.
//
//  isZero  = MIN over all three trits of "is this trit 0?". Each per-trit
//            is0 detector uses the same pattern as DECODE2's is0_:
//            is0(x) = MAX(MIN(PTI(x), STI(NTI(x))), 0)   — +1 iff x = 0.
//            MIN acts as AND on the {0,+1} domain, so isZero is +1 iff
//            every trit is 0.
//
//  isPos   = sign of ACC interpreted as balanced ternary. The sign equals
//            the highest-order non-zero trit's sign (since |3·q_hi| beats
//            the sum |q_lo + 3·q_mid|). A two-MUX priority encoder picks
//            it out:
//              inner  = MUX(is0(q1), q1, q1, q0)   ; q1 nonzero → q1 else q0
//              signOf = MUX(is0(q2), q2, q2, inner); q2 nonzero → q2 else inner
//            Then "+1 iff signOf = +1" via STI(PTI(signOf)) clamped to {0,+1}.
function buildAccSignDef() {
  const { comps, wires } = buildExample((c, w) => {
    const comps = [];
    const wires = [];
    comps.push(c('q0',   'INPUT', 40,  30, { value: 0, name: 'q0' }));
    comps.push(c('q1',   'INPUT', 40, 110, { value: 0, name: 'q1' }));
    comps.push(c('q2',   'INPUT', 40, 190, { value: 0, name: 'q2' }));
    comps.push(c('zero', 'CONST', 40, 270, { value: 0 }));

    // Per-trit is0 detector — +1 iff the trit is 0, else 0.
    function isZeroBlock(name, x0, y0) {
      comps.push(c(`pti_${name}`,    'PTI', x0,         y0));
      comps.push(c(`nti_${name}`,    'NTI', x0,         y0 + 60));
      comps.push(c(`notNti_${name}`, 'STI', x0 + 140,   y0 + 60));
      comps.push(c(`is0t_${name}`,   'MIN', x0 + 290,   y0 + 30));
      comps.push(c(`is0_${name}`,    'MAX', x0 + 430,   y0 + 30));
      wires.push(w(name,             'out', `pti_${name}`,    'in'));
      wires.push(w(name,             'out', `nti_${name}`,    'in'));
      wires.push(w(`nti_${name}`,    'out', `notNti_${name}`, 'in'));
      wires.push(w(`pti_${name}`,    'out', `is0t_${name}`,   'a'));
      wires.push(w(`notNti_${name}`, 'out', `is0t_${name}`,   'b'));
      wires.push(w(`is0t_${name}`,   'out', `is0_${name}`,    'a'));
      wires.push(w('zero',           'out', `is0_${name}`,    'b'));
    }
    isZeroBlock('q0', 200,  30);
    isZeroBlock('q1', 200, 200);
    isZeroBlock('q2', 200, 370);

    // isZero = AND over the three per-trit is0 flags.
    comps.push(c('isZ01',      'MIN',    790,  120));
    comps.push(c('isZall',     'MIN',    950,  250));
    comps.push(c('isZero_out', 'OUTPUT', 1130, 260, { name: 'isZero' }));
    wires.push(w('is0_q0', 'out', 'isZ01',      'a'));
    wires.push(w('is0_q1', 'out', 'isZ01',      'b'));
    wires.push(w('isZ01',  'out', 'isZall',     'a'));
    wires.push(w('is0_q2', 'out', 'isZall',     'b'));
    wires.push(w('isZall', 'out', 'isZero_out', 'in'));

    // Priority encoder for signOf. is0_qi ∈ {0,+1} so the MUX selector
    // never goes to -1; dT is wired to qi only for cosmetic completeness.
    comps.push(c('muxInner', 'MUX',  790, 470));
    comps.push(c('muxOuter', 'MUX',  950, 570));
    wires.push(w('is0_q1',   'out',  'muxInner', 's'));
    wires.push(w('q1',       'out',  'muxInner', 'dT'));
    wires.push(w('q1',       'out',  'muxInner', 'd0'));
    wires.push(w('q0',       'out',  'muxInner', 'dP'));
    wires.push(w('is0_q2',   'out',  'muxOuter', 's'));
    wires.push(w('q2',       'out',  'muxOuter', 'dT'));
    wires.push(w('q2',       'out',  'muxOuter', 'd0'));
    wires.push(w('muxInner', 'out',  'muxOuter', 'dP'));

    // isPos = +1 iff signOf = +1, via STI(PTI(signOf)) clamped to {0,+1}.
    //   signOf=+1 → PTI=-1 → STI=+1 → MAX(+1,0)=+1
    //   signOf=0  → PTI=+1 → STI=-1 → MAX(-1,0)=0
    //   signOf=-1 → PTI=+1 → STI=-1 → MAX(-1,0)=0
    comps.push(c('ptiSig',     'PTI',    1110, 570));
    comps.push(c('stiSig',     'STI',    1250, 570));
    comps.push(c('isPos_max',  'MAX',    1400, 570));
    comps.push(c('isPos_out',  'OUTPUT', 1580, 580, { name: 'isPos' }));
    wires.push(w('muxOuter',   'out', 'ptiSig',    'in'));
    wires.push(w('ptiSig',     'out', 'stiSig',    'in'));
    wires.push(w('stiSig',     'out', 'isPos_max', 'a'));
    wires.push(w('zero',       'out', 'isPos_max', 'b'));
    wires.push(w('isPos_max',  'out', 'isPos_out', 'in'));
    return { comps, wires };
  });
  return {
    inputs:  [{ name: 'q0' }, { name: 'q1' }, { name: 'q2' }],
    outputs: [{ name: 'isZero' }, { name: 'isPos' }],
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
  TRAM:    { kit: 'Sequential Kit', build: buildTramDef },
  DECODE2:  { kit: 'Control Kit',    build: buildDecode2Def },
  ACC_SIGN: { kit: 'Control Kit',    build: buildAccSignDef },
};
// Kit headings, in library-panel order.
const BUILTIN_SUBCIRCUIT_KITS = [
  { label: 'Neural-Net Kit', names: ['TMUL', 'MAC3', 'ACT'] },
  { label: 'Arithmetic Kit', names: ['TSUM', 'TCARRY', 'FADD', 'ALU3', 'MUX3'] },
  { label: 'Sequential Kit', names: ['TLATCH', 'TFLOP', 'TREG3', 'TPC', 'TRAM'] },
  { label: 'Control Kit',    names: ['DECODE2', 'ACC_SIGN'] },
];
// Seed the built-ins into the library. Called at boot and re-called after a
// load; the `if absent` guard means a loaded file's own same-named
// definition (perhaps edited) is never overwritten by the built-in.
function registerBuiltinSubcircuits() {
  for (const name in BUILTIN_SUBCIRCUITS)
    if (!subcircuitDefs[name]) subcircuitDefs[name] = BUILTIN_SUBCIRCUITS[name].build();
}


const EXAMPLES = createExamples({
  buildExample,
  buildTmulDef, buildMac3Def, buildActDef,
  buildTsumDef, buildDecode2Def, buildAccSignDef,
  subcircuitDefs,
});


function loadExampleNamed(name) {
  const ex = EXAMPLES[name];
  if (!ex) return;
  pushHistory();
  const { comps: newComps, wires: newWires } = ex.build();
  setComps(newComps);
  setWires(newWires);
  syncCompMap();
  setNextCompId(comps.reduce((m, c) => Math.max(m, c.id), 0) + 1);
  setNextWireId(wires.reduce((m, w) => Math.max(m, w.id), 0) + 1);
  setView({ tx: 40, ty: 40, scale: 1 });
  selection.clear(); setSelectedWire(null); setTick(0); setOutVals({});
  invalidatePathCache();
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
//
//  Tests live in tests.js. We pass it the app-internal symbols it needs via a
//  factory call so it can stay import-cycle-free with the rest of app.js.

const { TESTS, runAllTests } = registerTests({
  TYPES, EXAMPLES,
  buildAccSignDef, buildDecode2Def, cloneSubScope, compDef, customGateDef, debuggerRunHeadless,
  debuggerState, deleteSubcircuit, enumerateInputs, filterPalette,
  infoSubTruthTable, isBuiltinSubcircuit, pushHistory, ramAddr,
  registerBuiltinSubcircuits, showInfoEntry, simulate, simulateScope,
  simulateTimed, simulateSubInstance, stepSequential, syncCompMap, undo, redo,
});


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
function animLoop(t) {
  if (t - _lastAnim > 100 && !document.hidden) {
    setLastAnim(t);
    setAnimTime(animTime + 1);
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
