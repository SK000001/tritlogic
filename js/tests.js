// ============================================================================
//  SELF-TESTS
// ============================================================================
//
//  All in-app self-tests live here. Tests reference dozens of app-internal
//  symbols (TYPES, simulate, build*Def helpers, EXAMPLES, etc.), so this
//  module exports a `registerTests(deps)` factory that takes the app-internal
//  bindings as parameters. Cross-cutting symbols that already have their own
//  modules (util / state / assembler / info-data) are imported directly to
//  preserve live-binding semantics for state's mutable globals.

import { intToTrits, tritsToInt, parseTryteString,
         SAVE_FORMAT_VERSION, upgradeSave,
         resolveDrivers, coerceForLogic,
         packBus, unpackBus, isBus, busLabel } from './util.js';
import {
  comps, wires, subcircuitDefs, customGates, outVals,
  nextCompId, nextWireId, tick, undoStack, redoStack,
  setComps, setWires, setOutVals, setTick,
  setNextCompId, setNextWireId, setCustomGates,
} from './state.js';
import {
  assemble, assembleV2, decodeImemWord, decodeImemWordV2,
  ASM_EXAMPLES, ASM2_EXAMPLES,
} from './assembler.js';
import { COMPONENT_INFO, INFO_CATEGORIES } from './info-data.js';

export function registerTests(deps) {
  const {
    TYPES, EXAMPLES,
    buildAccSignDef, buildDecode2Def,
    cloneSubScope, compDef, customGateDef, debuggerRunHeadless,
    debuggerState, deleteSubcircuit, enumerateInputs, filterPalette,
    infoSubTruthTable, isBuiltinSubcircuit, pushHistory, ramAddr,
    registerBuiltinSubcircuits, showInfoEntry, simulate, simulateScope,
    simulateTimed, switchingKeysAt, simulateSubInstance, stepSequential, syncCompMap, undo, redo,
  } = deps;

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

// ---- A2 timed simulation (propagation delays) ----
test('A2 timed sim settles to the same values as the instant solver', () => {
  const { comps, wires } = EXAMPLES['ternary-layer'].build();
  const inByName = {};
  for (const c of comps) if (c.type === 'INPUT') inByName[c.state.name] = c;
  const vectors = [
    { x0: 1, x1: -1, x2: 0, w00: 1, w01: 1, w02: -1, w10: 0, w11: -1, w12: 1, w20: -1, w21: 0, w22: 1 },
    { x0: -1, x1: -1, x2: 1, w00: -1, w01: 0, w02: 1, w10: 1, w11: 1, w12: 1, w20: 0, w21: -1, w22: -1 },
  ];
  for (const vec of vectors) {
    for (const name in vec) if (inByName[name]) inByName[name].state.value = vec[name];
    const inst = { comps, wires, outVals: {} };
    simulateScope(inst);
    const timed = simulateTimed({ comps, wires });
    assertEq(timed.settled, true, 'timed run settled:');
    for (const k in inst.outVals) {
      assertEq(timed.finalVals[k], inst.outVals[k], `timed vs instant net ${k}:`);
    }
  }
});

test('A2 propagation delay accumulates down an inverter chain', () => {
  // INPUT → STI → STI → STI → OUTPUT, all unit delay.
  const comps = [
    { id: 1, type: 'INPUT',  x: 0, y: 0, state: { value: 1, name: 'x' } },
    { id: 2, type: 'STI',    x: 0, y: 0, state: {} },
    { id: 3, type: 'STI',    x: 0, y: 0, state: {} },
    { id: 4, type: 'STI',    x: 0, y: 0, state: {} },
    { id: 5, type: 'OUTPUT', x: 0, y: 0, state: { name: 'y' } },
  ];
  const wires = [
    { id: 1, fromId: 1, fromPort: 'out', toId: 2, toPort: 'in' },
    { id: 2, fromId: 2, fromPort: 'out', toId: 3, toPort: 'in' },
    { id: 3, fromId: 3, fromPort: 'out', toId: 4, toPort: 'in' },
    { id: 4, fromId: 4, fromPort: 'out', toId: 5, toPort: 'in' },
  ];
  const r = simulateTimed({ comps, wires });
  assertEq(r.settleTime, 3, 'chain settle time (3 unit-delay gates):');
  assertEq(r.finalVals['4:out'], -1, 'three inversions of +1:');   // -(-(-1)) = -1
  assertEq(r.hazards.length, 0, 'a simple chain has no glitches:');
});

test('A2 detects a static-1 hazard from skewed reconvergent delays', () => {
  // out = MAX(x, STI(x)) = |x|, constant 1 for x = ±1. Make the inverter arm
  // two units slower than the direct arm; flipping x = +1 → −1 makes MAX
  // briefly see (−1, stale −1) before STI catches up → a 1 → −1 → 1 glitch.
  const comps = [
    { id: 1, type: 'INPUT',  x: 0, y: 0, state: { value: 1, name: 'x' } },
    { id: 2, type: 'STI',    x: 0, y: 0, state: { delay: 2 } },
    { id: 3, type: 'MAX',    x: 0, y: 0, state: {} },
    { id: 4, type: 'OUTPUT', x: 0, y: 0, state: { name: 'y' } },
  ];
  const wires = [
    { id: 1, fromId: 1, fromPort: 'out', toId: 2, toPort: 'in' },  // x → STI
    { id: 2, fromId: 1, fromPort: 'out', toId: 3, toPort: 'a' },   // x → MAX.a
    { id: 3, fromId: 2, fromPort: 'out', toId: 3, toPort: 'b' },   // STI → MAX.b
    { id: 4, fromId: 3, fromPort: 'out', toId: 4, toPort: 'in' },  // MAX → OUT
  ];
  const base = { comps, wires, outVals: {} };
  simulateScope(base);
  assertEq(base.outVals['3:out'], 1, 'steady MAX = |+1|:');
  const r = simulateTimed({ comps, wires }, {
    base: base.outVals,
    stimulus: [{ key: '1:out', value: -1 }],
  });
  assertEq(r.finalVals['3:out'], 1, 'final MAX = |−1|:');
  assertEq(r.hazards.some(h => h.key === '3:out'), true, 'MAX output flagged as hazard:');
  assertEq(r.changes.filter(ch => ch.key === '3:out').length, 2, 'MAX glitched (two changes):');
});

test('A2 per-type default delay applies without a per-instance override', () => {
  // INPUT → ADDER → OUTPUT. The ADDER has no c.state.delay, so the timed solver
  // must fall back to its per-type default (TYPES.ADDER.delay = 2): inputs seed
  // at t=0, the ADDER re-evaluates and changes at t=2.
  const comps = [
    { id: 1, type: 'INPUT', x: 0, y: 0, state: { value: 1, name: 'a' } },
    { id: 2, type: 'INPUT', x: 0, y: 0, state: { value: 1, name: 'b' } },
    { id: 3, type: 'INPUT', x: 0, y: 0, state: { value: 0, name: 'c' } },
    { id: 4, type: 'ADDER', x: 0, y: 0, state: {} },
    { id: 5, type: 'OUTPUT', x: 0, y: 0, state: { name: 's' } },
  ];
  const wires = [
    { id: 1, fromId: 1, fromPort: 'out', toId: 4, toPort: 'a' },
    { id: 2, fromId: 2, fromPort: 'out', toId: 4, toPort: 'b' },
    { id: 3, fromId: 3, fromPort: 'out', toId: 4, toPort: 'cin' },
    { id: 4, fromId: 4, fromPort: 'sum', toId: 5, toPort: 'in' },
  ];
  const r = simulateTimed({ comps, wires });
  assertEq(r.settleTime, 2, 'ADDER settles at its per-type default delay (2):');
  const sumChange = r.changes.find(ch => ch.key === '4:sum');
  assertEq(sumChange && sumChange.t, 2, 'ADDER sum transitions at t=2:');
  // A per-instance override still wins over the per-type default.
  comps[3].state.delay = 5;
  const r2 = simulateTimed({ comps, wires });
  assertEq(r2.settleTime, 5, 'per-instance delay overrides the per-type default:');
});

test('A2 switchingKeysAt isolates the nets transitioning at exactly time t', () => {
  // A change log with two distinct edge times plus a glitch net that flips at
  // t=1 and flips back at t=3.
  const changes = [
    { t: 0, key: 'src:out', value: 1 },
    { t: 1, key: 'g:out',   value: 1 },
    { t: 1, key: 'h:out',   value: -1 },
    { t: 3, key: 'g:out',   value: -1 },   // glitch: g flips back
  ];
  const at0 = switchingKeysAt(changes, 0);
  assertEq(at0.size === 1 && at0.has('src:out'), true, 't=0 ⇒ just the source:');
  const at1 = switchingKeysAt(changes, 1);
  assertEq(at1.size === 2 && at1.has('g:out') && at1.has('h:out'), true,
           't=1 ⇒ both gates switching:');
  const at2 = switchingKeysAt(changes, 2);
  assertEq(at2.size, 0, 't=2 ⇒ nothing switching (quiet step):');
  const at3 = switchingKeysAt(changes, 3);
  assertEq(at3.size === 1 && at3.has('g:out'), true, 't=3 ⇒ the glitch net flips back:');
});

// ---- A3 high-impedance (Z) + tri-state buses ----
test('A3 resolveDrivers: tri-state bus resolution table', () => {
  assertEq(resolveDrivers([]), null, 'no drivers:');
  assertEq(resolveDrivers([null, null]), null, 'all undefined:');
  assertEq(resolveDrivers(['Z']), 'Z', 'single Z:');
  assertEq(resolveDrivers(['Z', 'Z']), 'Z', 'all Z floats:');
  assertEq(resolveDrivers(['Z', 1]), 1, 'one strong over Z:');
  assertEq(resolveDrivers([1]), 1, 'single strong:');
  assertEq(resolveDrivers([0, 'Z', null]), 0, 'strong 0 wins over Z/null:');
  assertEq(resolveDrivers([1, 1]), 1, 'agreeing strong:');
  assertEq(resolveDrivers([1, 'Z', 1]), 1, 'agree with a Z present:');
  assertEq(resolveDrivers([1, -1]), 'X', 'disagreeing strong = X:');
  assertEq(resolveDrivers([-1, 0]), 'X', 'disagreeing strong (−1 vs 0) = X:');
  assertEq(resolveDrivers(['X', 1]), 'X', 'X propagates:');
});

test('A3 coerceForLogic maps Z/X to null, passes trits through', () => {
  assertEq(coerceForLogic('Z'), null, 'Z→null:');
  assertEq(coerceForLogic('X'), null, 'X→null:');
  assertEq(coerceForLogic(1), 1, '1→1:');
  assertEq(coerceForLogic(0), 0, '0→0:');
  assertEq(coerceForLogic(-1), -1, '−1→−1:');
  assertEq(coerceForLogic(null), null, 'null→null:');
});

test('A3 TRIBUF drives when enabled, high-Z when disabled', () => {
  const def = TYPES.TRIBUF;
  assertEq(def.eval(null, { in: 1, en: 1 }).out, 1, 'enabled drives in:');
  assertEq(def.eval(null, { in: -1, en: 1 }).out, -1, 'enabled drives −1:');
  assertEq(def.eval(null, { in: 1, en: 0 }).out, 'Z', 'en=0 → Z:');
  assertEq(def.eval(null, { in: 1, en: -1 }).out, 'Z', 'en=−1 → Z:');
  assertEq(def.eval(null, { in: 1, en: null }).out, 'Z', 'en undefined → Z:');
  assertEq(def.eval(null, { in: null, en: 1 }).out, null, 'enabled but in floating → null:');
});

test('A3 tri-state bus: two TRIBUFs onto one net resolve through the engine', () => {
  // da/db → TRIBUF a/b (enabled by ena/enb); both outputs feed one inverter
  // input (the shared bus). The inverter is non-tri-state, so it sees the
  // resolved bus coerced to a trit/null.
  const comps = [
    { id: 1, type: 'INPUT',  x: 0, y: 0, state: { value: 1,  name: 'da' } },
    { id: 2, type: 'INPUT',  x: 0, y: 0, state: { value: -1, name: 'db' } },
    { id: 3, type: 'INPUT',  x: 0, y: 0, state: { value: 0,  name: 'ena' } },
    { id: 4, type: 'INPUT',  x: 0, y: 0, state: { value: 0,  name: 'enb' } },
    { id: 5, type: 'TRIBUF', x: 0, y: 0, state: {} },
    { id: 6, type: 'TRIBUF', x: 0, y: 0, state: {} },
    { id: 7, type: 'STI',    x: 0, y: 0, state: {} },
  ];
  const wires = [
    { id: 1, fromId: 1, fromPort: 'out', toId: 5, toPort: 'in' },
    { id: 2, fromId: 3, fromPort: 'out', toId: 5, toPort: 'en' },
    { id: 3, fromId: 2, fromPort: 'out', toId: 6, toPort: 'in' },
    { id: 4, fromId: 4, fromPort: 'out', toId: 6, toPort: 'en' },
    { id: 5, fromId: 5, fromPort: 'out', toId: 7, toPort: 'in' },   // bus driver A
    { id: 6, fromId: 6, fromPort: 'out', toId: 7, toPort: 'in' },   // bus driver B
  ];
  const da = comps[0], db = comps[1], ena = comps[2], enb = comps[3];
  const run = () => { const s = { comps, wires, outVals: {} }; simulateScope(s); return s; };
  const bus = (s) => resolveDrivers([s.outVals['5:out'], s.outVals['6:out']]);

  // Neither enabled → both Z → bus floats → inverter sees undefined.
  ena.state.value = 0; enb.state.value = 0;
  let s = run();
  assertEq(s.outVals['5:out'], 'Z', 'disabled buffer A drives Z:');
  assertEq(bus(s), 'Z', 'floating bus = Z:');
  assertEq(s.outVals['7:out'], null, 'inverter sees Z as undefined:');

  // Only A enabled (da=1) → bus 1 → inverter −1.
  ena.state.value = 1; enb.state.value = 0; da.state.value = 1;
  s = run();
  assertEq(s.outVals['5:out'], 1, 'enabled buffer A drives its input:');
  assertEq(bus(s), 1, 'bus selects A:');
  assertEq(s.outVals['7:out'], -1, 'inverter of bus=1 is −1:');

  // Only B enabled (db=−1) → bus −1 → inverter 1.
  ena.state.value = 0; enb.state.value = 1; db.state.value = -1;
  s = run();
  assertEq(bus(s), -1, 'bus selects B:');
  assertEq(s.outVals['7:out'], 1, 'inverter of bus=−1 is 1:');

  // Both enabled, disagreeing (1 vs −1) → contention X → inverter undefined.
  ena.state.value = 1; enb.state.value = 1; da.state.value = 1; db.state.value = -1;
  s = run();
  assertEq(bus(s), 'X', 'two disagreeing drivers = X:');
  assertEq(s.outVals['7:out'], null, 'inverter sees X as undefined:');

  // Both enabled, agreeing (1 and 1) → bus 1.
  da.state.value = 1; db.state.value = 1;
  s = run();
  assertEq(bus(s), 1, 'two agreeing drivers = that value:');
  assertEq(s.outVals['7:out'], -1, 'inverter of agreed bus=1 is −1:');
});

test('A3 register-file demo: one-hot read selects a register onto the shared bus', () => {
  // Drive the actual `regfile-bus` Examples preset and resolve each bus line
  // from the TRIBUFs wired into it — verifying the preset's wiring as well as
  // the multi-driver bus semantics.
  const { comps, wires } = EXAMPLES['regfile-bus'].build();
  const inByName = {}, outByName = {};
  for (const c of comps) {
    if (c.type === 'INPUT')  inByName[c.state.name]  = c;
    if (c.type === 'OUTPUT') outByName[c.state.name] = c;
  }
  const run = () => { const s = { comps, wires, outVals: {} }; simulateScope(s); return s; };
  // Resolve a named bus probe: gather every driver wired into its `in` pin.
  const busVal = (s, name) => {
    const oid = outByName[name].id;
    const drivers = wires.filter(wr => wr.toId === oid && wr.toPort === 'in')
                         .map(wr => s.outVals[`${wr.fromId}:${wr.fromPort}`] ?? null);
    return resolveDrivers(drivers);
  };
  const bus = (s) => JSON.stringify([busVal(s, 'bus0'), busVal(s, 'bus1'), busVal(s, 'bus2')]);

  // Default one-hot (rdR0=1, rdR1=0) → bus reads R0's seeded value.
  let s = run();
  assertEq(bus(s), JSON.stringify([1, -1, 0]), 'rdR0 selects R0:');

  // Flip the one-hot to R1 → bus reads R1's seeded value.
  inByName.rdR0.state.value = 0; inByName.rdR1.state.value = 1;
  s = run();
  assertEq(bus(s), JSON.stringify([-1, 0, 1]), 'rdR1 selects R1:');

  // No read-enable asserted → every line floats (Z).
  inByName.rdR0.state.value = 0; inByName.rdR1.state.value = 0;
  s = run();
  assertEq(bus(s), JSON.stringify(['Z', 'Z', 'Z']), 'no read-enable floats the bus:');

  // Both asserted with differing trits on every line → contention (X).
  inByName.rdR0.state.value = 1; inByName.rdR1.state.value = 1;
  s = run();
  assertEq(bus(s), JSON.stringify(['X', 'X', 'X']), 'two disagreeing drivers → X:');
});

// ---- C1 tryte buses (merge / split) ----
test('C1 packBus / unpackBus round-trip and bus typing', () => {
  // A fully-strong word round-trips and never collides with a single trit.
  const packed = packBus([1, -1, 0]);
  assertEq(isBus(packed), true, 'packed word is a bus value:');
  assertEq(isBus(1), false, 'a trit is not a bus:');
  assertEq(isBus('Z'), false, "'Z' is not a bus:");
  assertEq(isBus(null), false, 'null is not a bus:');
  assertEq(JSON.stringify(unpackBus(packed, 3)), JSON.stringify([1, -1, 0]), 'round-trips:');
  // Lossless on floating / tri-state slots.
  assertEq(JSON.stringify(unpackBus(packBus([1, null, 'Z']), 3)),
           JSON.stringify([1, null, 'Z']), 'keeps null + Z slots:');
  // All-floating collapses to an undefined bus (null), not a "b_,_,_" string.
  assertEq(packBus([null, null, null]), null, 'all-floating ⇒ null bus:');
  // Unpacking a non-bus value yields all-undefined.
  assertEq(JSON.stringify(unpackBus(null, 3)), JSON.stringify([null, null, null]), 'null → all undef:');
  assertEq(JSON.stringify(unpackBus(1, 3)), JSON.stringify([null, null, null]), 'trit → all undef:');
  // Label: balanced-ternary pattern (MSB first) + decimal when fully strong.
  assertEq(busLabel(packBus([1, -1, 1]), 3), '1T1=7', 'fully-strong label shows decimal:');
  assertEq(busLabel(packBus([1, null, 1]), 3), '1?1', 'floating slot → ? and no decimal:');
});

test('C1 MERGE3 / SPLIT3 eval pack and unpack a word', () => {
  assertEq(TYPES.MERGE3.eval(null, { t0: 1, t1: -1, t2: 0 }).bus, packBus([1, -1, 0]),
           'MERGE3 packs its trits:');
  assertEq(TYPES.MERGE3.eval(null, { t0: null, t1: null, t2: null }).bus, null,
           'MERGE3 of all-floating is null:');
  const out = TYPES.SPLIT3.eval(null, { bus: packBus([1, -1, 0]) });
  assertEq(JSON.stringify([out.t0, out.t1, out.t2]), JSON.stringify([1, -1, 0]),
           'SPLIT3 unpacks the word:');
  const undef = TYPES.SPLIT3.eval(null, { bus: null });
  assertEq(JSON.stringify([undef.t0, undef.t1, undef.t2]), JSON.stringify([null, null, null]),
           'SPLIT3 of null floats every trit:');
});

test('C1 word-bus demo: a word survives MERGE → bus wire → SPLIT through the engine', () => {
  const { comps, wires } = EXAMPLES['word-bus'].build();
  const inById = {};
  for (const c of comps) if (c.type === 'INPUT') inById[c.id] = c;
  const ins = comps.filter(c => c.type === 'INPUT');   // i0,i1,i2 in placement order
  const outs = comps.filter(c => c.type === 'OUTPUT');  // o0,o1,o2
  const merge = comps.find(c => c.type === 'MERGE3');
  const run = () => { const s = { comps, wires, outVals: {} }; simulateScope(s); return s; };
  const word = (s) => outs.map(o => {
    const wr = wires.find(x => x.toId === o.id && x.toPort === 'in');
    return s.outVals[`${wr.fromId}:${wr.fromPort}`] ?? null;
  });

  // Default preset values [1,-1,1] survive the bus.
  let s = run();
  assertEq(JSON.stringify(word(s)), JSON.stringify([1, -1, 1]), 'word reproduced at the split:');
  assertEq(isBus(s.outVals[`${merge.id}:bus`]), true, 'the MERGE drives a bus value:');

  // Change the inputs → the split tracks.
  ins[0].state.value = -1; ins[1].state.value = 0; ins[2].state.value = -1;
  s = run();
  assertEq(JSON.stringify(word(s)), JSON.stringify([-1, 0, -1]), 'edited word tracks through the bus:');

  // Float the low trit → that slot floats out the other side, others survive.
  ins[0].state.value = null;
  s = run();
  assertEq(JSON.stringify(word(s)), JSON.stringify([null, 0, -1]), 'a floating slot stays floating:');
});

test('C1 word bus is tri-stateable: TRIBUF3 + one-hot read on a single bus wire', () => {
  // eval level: drive the word when enabled, float (Z) otherwise.
  assertEq(TYPES.TRIBUF3.eval(null, { in: packBus([1, -1, 0]), en: 1 }).out, packBus([1, -1, 0]),
           'enabled TRIBUF3 drives its word:');
  assertEq(TYPES.TRIBUF3.eval(null, { in: packBus([1, -1, 0]), en: 0 }).out, 'Z',
           'disabled TRIBUF3 floats (Z):');

  // End-to-end on the regfile-wordbus preset: two word drivers, one bus wire.
  const { comps, wires } = EXAMPLES['regfile-wordbus'].build();
  const inByName = {}, outByName = {};
  for (const c of comps) {
    if (c.type === 'INPUT')  inByName[c.state.name]  = c;
    if (c.type === 'OUTPUT') outByName[c.state.name] = c;
  }
  const gates = comps.filter(c => c.type === 'TRIBUF3');   // g0, g1 in placement order
  const run = () => { const s = { comps, wires, outVals: {} }; simulateScope(s); return s; };
  const busVal = (s) => resolveDrivers(gates.map(g => s.outVals[`${g.id}:out`] ?? null));
  const splitOut = (s) => ['bus0', 'bus1', 'bus2'].map(n => {
    const wr = wires.find(x => x.toId === outByName[n].id && x.toPort === 'in');
    return s.outVals[`${wr.fromId}:${wr.fromPort}`] ?? null;
  });

  // Default one-hot (R0): the bus carries R0's word and the split recovers it.
  let s = run();
  assertEq(busVal(s), packBus([1, -1, 0]), 'rdR0 → R0 word on the bus:');
  assertEq(JSON.stringify(splitOut(s)), JSON.stringify([1, -1, 0]), 'split recovers R0 trits:');

  // Select R1.
  inByName.rdR0.state.value = 0; inByName.rdR1.state.value = 1;
  s = run();
  assertEq(busVal(s), packBus([-1, 0, 1]), 'rdR1 → R1 word on the bus:');
  assertEq(JSON.stringify(splitOut(s)), JSON.stringify([-1, 0, 1]), 'split recovers R1 trits:');

  // None enabled → floating word bus (Z) → split floats every trit.
  inByName.rdR0.state.value = 0; inByName.rdR1.state.value = 0;
  s = run();
  assertEq(busVal(s), 'Z', 'no read-enable floats the word bus:');
  assertEq(JSON.stringify(splitOut(s)), JSON.stringify([null, null, null]), 'split of Z is all undef:');

  // Both enabled with different words → contention (X) → split floats.
  inByName.rdR0.state.value = 1; inByName.rdR1.state.value = 1;
  s = run();
  assertEq(busVal(s), 'X', 'two different words contend → X:');
  assertEq(JSON.stringify(splitOut(s)), JSON.stringify([null, null, null]), 'split of X is all undef:');
});

test('C1 tryte bus: MERGE6 / SPLIT6 carry a full 6-trit value', () => {
  const trits = intToTrits(215, 6);
  const inv = {}; trits.forEach((t, i) => inv['t' + i] = t);
  const bus = TYPES.MERGE6.eval(null, inv).bus;
  assertEq(isBus(bus), true, 'MERGE6 packs a tryte bus:');
  // Width is inferred from the value, so the label shows all six trits + decimal
  // (a width-3 inference would corrupt both).
  assertEq(busLabel(bus), '10T00T=215', 'busLabel infers the 6-trit width:');
  const out = TYPES.SPLIT6.eval(null, { bus });
  const back = [out.t0, out.t1, out.t2, out.t3, out.t4, out.t5];
  assertEq(tritsToInt(back), 215, 'SPLIT6 recovers the tryte value:');
  assertEq(JSON.stringify(back), JSON.stringify(trits), 'all six trits round-trip:');
});

test('C1 tryte-bus demo: a tryte survives TRYTE_IN → MERGE6 → bus → SPLIT6', () => {
  const { comps, wires } = EXAMPLES['tryte-bus'].build();
  const tin = comps.find(c => c.type === 'TRYTE_IN');
  const merge = comps.find(c => c.type === 'MERGE6');
  const split = comps.find(c => c.type === 'SPLIT6');
  const run = () => { const s = { comps, wires, outVals: {} }; simulateScope(s); return s; };
  const word = (s) => [0, 1, 2, 3, 4, 5].map(i => s.outVals[`${split.id}:t${i}`] ?? null);

  let s = run();
  assertEq(tritsToInt(word(s)), 215, 'default tryte 215 reproduced after the bus:');
  assertEq(isBus(s.outVals[`${merge.id}:bus`]), true, 'the MERGE6 drives a bus value:');

  // A different tryte (incl. a negative) tracks through.
  tin.state.value = -100;
  s = run();
  assertEq(tritsToInt(word(s)), -100, 'edited tryte tracks through the bus:');
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

test('Assembler v2 examples library — every canned program assembles cleanly', () => {
  // Parallel smoke test to the v1 library check above. Catches typos or
  // out-of-range immediates in newly-added v2 examples before they show
  // up in the modal as an "errors loading" status.
  const names = Object.keys(ASM2_EXAMPLES);
  if (names.length < 4) throw new Error(`expected at least 4 v2 examples, got ${names.length}`);
  for (const k of names) {
    const ex = ASM2_EXAMPLES[k];
    if (!ex.label || !ex.src) throw new Error(`v2 example ${k} missing label or src`);
    const res = assembleV2(ex.src);
    if (res.errors.length) {
      throw new Error(`v2 example "${k}" failed: ` + JSON.stringify(res.errors));
    }
    if (res.words < 1 || res.words > 9)
      throw new Error(`v2 example "${k}" has ${res.words} instructions`);
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
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
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
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
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
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
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
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    debuggerState.breakpoints = savedBps;
    syncCompMap();
  }
});

// ---- ISA v2 — DECODE2 + CPU2 ---------------------------------------------
//
// Phase A of the wider ISA (see tritlogic/ISA_v2.md). Five tests cover the
// assembler's encoding table, the round-trip through decodeImemWordV2, the
// DECODE2 subcircuit's one-hot output for every opcode, and an end-to-end
// counter program running on a live CPU2 instance.

test('assembleV2 encodes every v2 opcode to the spec\'s opH/opL table', () => {
  // One ADDI/MAXI/MINI immediate, one of each address-taking op, one NOP.
  const cases = [
    { src: 'NOP',         opH: -1, opL: -1, oper: [0, 0, 0, 0] },
    { src: 'JMP 0',       opH: -1, opL:  0, oper: [-1, -1, 0, 0] },
    { src: 'JMPP 8',      opH: -1, opL:  1, oper: [ 1,  1, 0, 0] },
    { src: 'JMPZ 4',      opH:  0, opL: -1, oper: [ 0,  0, 0, 0] },
    { src: 'ADDI +1',     opH:  0, opL:  0, oper: [ 1,  0, 0, 0] },
    { src: 'MAXI -3',     opH:  0, opL:  1, oper: [ 0, -1, 0, 0] },
    { src: 'MINI +13',    opH:  1, opL: -1, oper: [ 1,  1, 1, 0] },
    // addr 5 → operand encoded as intToTrits(5-4, 2) = [1, 0]; trailing zeros.
    { src: 'LOAD 5',      opH:  1, opL:  0, oper: [ 1,  0, 0, 0] },
    // addr 2 → intToTrits(-2, 2) = [1, -1].
    { src: 'STORE 2',     opH:  1, opL:  1, oper: [ 1, -1, 0, 0] },
  ];
  for (const tc of cases) {
    const r = assembleV2(tc.src);
    assertEq(r.errors.length, 0, `${tc.src}: errors:`);
    assertDeepEq(r.mem_lo[0], [tc.opL, tc.opH, tc.oper[0]], `${tc.src}: mem_lo:`);
    assertDeepEq(r.mem_hi[0], [tc.oper[1], tc.oper[2], tc.oper[3]], `${tc.src}: mem_hi:`);
  }
});

test('decodeImemWordV2 round-trips every assembled v2 instruction', () => {
  const src = [
    'NOP', 'JMP 0', 'JMPP 8', 'JMPZ 4', 'ADDI +1', 'MAXI -3', 'MINI +13',
    'LOAD 5', 'STORE 2',
  ];
  // We must keep ≤9 in one program (IMEM depth), so chunk through.
  for (const line of src) {
    const r = assembleV2(line);
    if (r.errors.length) throw new Error(`assemble("${line}"): ${JSON.stringify(r.errors)}`);
    const decoded = decodeImemWordV2(r.mem_lo[0], r.mem_hi[0]);
    // Tolerate spacing differences (`JMP 0` vs `JMP  0`).
    const norm = s => s.replace(/\s+/g, ' ').trim();
    assertEq(norm(decoded), norm(line), `round-trip "${line}":`);
  }
});

test('assembleV2 rejects out-of-range immediates and bad opcodes', () => {
  let r = assembleV2('ADDI +41');
  assertEq(r.errors.length, 1, 'imm overflow:');
  r = assembleV2('JMP 9');
  assertEq(r.errors.length, 1, 'addr overflow:');
  r = assembleV2('FOO 1');
  assertEq(r.errors.length, 1, 'unknown mnemonic:');
  r = assembleV2('NOP 7');
  assertEq(r.errors.length, 1, 'NOP with operand:');
});

test('DECODE2 emits {0,+1} one-hot for every opcode', () => {
  // Build a fresh DECODE2 instance and drive (opH, opL) across all 9 codes.
  if (!subcircuitDefs['DECODE2']) subcircuitDefs['DECODE2'] = buildDecode2Def();
  const def = subcircuitDefs['DECODE2'];
  const expected = [
    [-1, -1, 'en_NOP'],   [-1, 0, 'en_JMP'],    [-1, 1, 'en_JMPP'],
    [ 0, -1, 'en_JMPZ'],  [ 0, 0, 'en_ADDI'],   [ 0, 1, 'en_MAXI'],
    [ 1, -1, 'en_MINI'],  [ 1, 0, 'en_LOAD'],   [ 1, 1, 'en_STORE'],
  ];
  const enableNames = expected.map(e => e[2]);
  for (const [opH, opL, activeName] of expected) {
    const instance = { type: 'SUB:DECODE2', state: {}, subScope: cloneSubScope(def) };
    const out = simulateSubInstance(instance, { opH, opL });
    // The active enable must be exactly +1; every other enable exactly 0.
    for (const name of enableNames) {
      const want = (name === activeName) ? 1 : 0;
      assertEq(out[name], want, `opH=${opH} opL=${opL}: ${name}:`);
    }
  }
});

test('Assembled v2 counter executes ACC = 1,1,2,2,3,3,... on the live CPU2', () => {
  // Round-trip: assemble the v2 counter, slap its image into CPU2's two
  // parallel RAMs, and run 10 stepSequential() ticks. ACC must climb the
  // same way the v1 counter does — proving the wider ISA's datapath agrees
  // with the v1 datapath on shared semantics (ADDI / JMP).
  const res = assembleV2(ASM2_EXAMPLES['counter2'].src);
  if (res.errors.length) throw new Error('counter2 failed: ' + JSON.stringify(res.errors));
  const ex = EXAMPLES['cpu2'].build();
  const rams = ex.comps.filter(c => c.type === 'RAM');
  // The lo RAM is the one wired to DECODE2.opL.
  const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
  const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
  const ramLo = rams.find(r => r.id === opLWire.fromId);
  const ramHi = rams.find(r => r.id !== ramLo.id);
  ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
  ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
  const pc  = ex.comps.find(c => c.type === 'PC');
  const acc = ex.comps.find(c => c.type === 'REG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
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
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- ISA v2 — ACC_SIGN + conditional jumps (E2b Phase B) -----------------
//
// ACC_SIGN turns the three ACC trits into the {isZero, isPos} flags that
// JMPZ / JMPP gate on. The exhaustive test drives all 27 possible ACC values
// through a fresh ACC_SIGN instance and checks both flags against the
// balanced-ternary semantics (sign = highest-order non-zero trit). The two
// end-to-end tests then drive the live CPU2 with handcrafted programs to
// confirm the JMPP / JMPZ datapath wiring matches.

test('ACC_SIGN: isZero / isPos correct for every 3-trit ACC value', () => {
  if (!subcircuitDefs['ACC_SIGN']) subcircuitDefs['ACC_SIGN'] = buildAccSignDef();
  const def = subcircuitDefs['ACC_SIGN'];
  for (let v = -13; v <= 13; v++) {
    const [q0, q1, q2] = intToTrits(v, 3);
    const instance = { type: 'SUB:ACC_SIGN', state: {}, subScope: cloneSubScope(def) };
    const out = simulateSubInstance(instance, { q0, q1, q2 });
    const expectZero = v === 0 ? 1 : 0;
    const expectPos  = v >  0 ? 1 : 0;
    assertEq(out.isZero, expectZero, `v=${v} isZero:`);
    assertEq(out.isPos,  expectPos,  `v=${v} isPos:`);
  }
});

test('CPU2 JMPP branches only when ACC > 0', () => {
  // Three programs at three starting ACC values exercise the three sign cases.
  // Each program is just `JMPP 0` at word 0 — if the jump is taken, PC stays
  // at 0; if not, PC advances to 1.
  const res = assembleV2('JMPP 0');
  if (res.errors.length) throw new Error('JMPP assemble: ' + JSON.stringify(res.errors));
  const cases = [
    { accInt:  1, taken: true  },
    { accInt:  0, taken: false },
    { accInt: -1, taken: false },
  ];
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    for (const { accInt, taken } of cases) {
      const ex = EXAMPLES['cpu2'].build();
      const rams = ex.comps.filter(c => c.type === 'RAM');
      const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
      const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
      const ramLo = rams.find(r => r.id === opLWire.fromId);
      const ramHi = rams.find(r => r.id !== ramLo.id);
      ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
      ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
      const pc  = ex.comps.find(c => c.type === 'PC');
      const acc = ex.comps.find(c => c.type === 'REG3');
      // Seed ACC with the test value (REG3 stores q as [q0,q1,q2]).
      acc.state = { q: intToTrits(accInt, 3), clkPrev: 0 };
      setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
      syncCompMap(); simulate();
      // Two stepSequential calls = one full clock cycle = one PC update.
      stepSequential(); stepSequential();
      const pcAddr = tritsToInt(pc.state.p) + 4;
      assertEq(pcAddr, taken ? 0 : 1, `ACC=${accInt} JMPP PC:`);
    }
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('CPU2 JMPZ branches only when ACC == 0', () => {
  const res = assembleV2('JMPZ 0');
  if (res.errors.length) throw new Error('JMPZ assemble: ' + JSON.stringify(res.errors));
  const cases = [
    { accInt:  0, taken: true  },
    { accInt:  1, taken: false },
    { accInt: -1, taken: false },
  ];
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    for (const { accInt, taken } of cases) {
      const ex = EXAMPLES['cpu2'].build();
      const rams = ex.comps.filter(c => c.type === 'RAM');
      const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
      const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
      const ramLo = rams.find(r => r.id === opLWire.fromId);
      const ramHi = rams.find(r => r.id !== ramLo.id);
      ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
      ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
      const pc  = ex.comps.find(c => c.type === 'PC');
      const acc = ex.comps.find(c => c.type === 'REG3');
      acc.state = { q: intToTrits(accInt, 3), clkPrev: 0 };
      setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
      syncCompMap(); simulate();
      stepSequential(); stepSequential();
      const pcAddr = tritsToInt(pc.state.p) + 4;
      assertEq(pcAddr, taken ? 0 : 1, `ACC=${accInt} JMPZ PC:`);
    }
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- Save-format migration chain (D4) ------------------------------------
//
// upgradeSave(data) walks the SAVE_MIGRATIONS chain in util.js from
// `data.version` up to SAVE_FORMAT_VERSION. These tests pin the framework's
// behaviour today (one no-op 0→1 step) and act as a worked example for
// what a future migration test should look like.

test('upgradeSave: legacy save (no version field) bumps to current version', () => {
  const legacy = { comps: [], wires: [] };
  const out = upgradeSave(legacy);
  assertEq(out.version, SAVE_FORMAT_VERSION, 'version after upgrade:');
});

test('upgradeSave: current-version save is returned unchanged', () => {
  const fresh = { version: SAVE_FORMAT_VERSION, comps: [], wires: [] };
  const out = upgradeSave(fresh);
  assertEq(out.version, SAVE_FORMAT_VERSION, 'version unchanged:');
});

test('upgradeSave: newer-than-current save is passed through (caller decides)', () => {
  const future = { version: SAVE_FORMAT_VERSION + 5, comps: [], wires: [] };
  const out = upgradeSave(future);
  assertEq(out.version, SAVE_FORMAT_VERSION + 5, 'version preserved:');
});

// ---- All-structural CPU --------------------------------------------------
//
// The `cpu-structural` preset rebuilds the Phase 7 compute path with
// `TPC` / `TREG3` / `ALU3` from the Sequential & Arithmetic kits in place of
// the native PC / REG3 / ALU primitives. IMEM stays native (TRAM's storage
// can't be pre-loaded — its subscope bootstraps to zero). TPC's TFLOPs wake
// at q=[0,0] = word index 4, so the default program is offset to word 4 and
// the loop runs ADDI +1 / JMP 4. This test verifies the structural ACC
// climbs the same 1,1,2,2,3,3,... pattern the native CPU does.

test('Structural CPU preset uses kit subcircuits, not native PC / REG3 / ALU', () => {
  // The whole point of cpu-structural is that the compute path bottoms out
  // at MIN/MAX gates via the Sequential/Arithmetic kits. A regression to a
  // native PC/REG3/ALU would silently make the preset functionally identical
  // to `cpu` and defeat the demo. Pin the invariant.
  const ex = EXAMPLES['cpu-structural'].build();
  const types = new Set(ex.comps.map(c => c.type));
  for (const banned of ['PC', 'REG3', 'ALU']) {
    if (types.has(banned))
      throw new Error(`cpu-structural must not place a native ${banned}; use SUB:T${banned === 'PC' ? 'PC' : (banned === 'REG3' ? 'REG3' : 'ALU3')} instead`);
  }
  for (const required of ['SUB:TPC', 'SUB:TREG3', 'SUB:ALU3']) {
    if (!types.has(required))
      throw new Error(`cpu-structural must place a ${required}; not found`);
  }
});

test('Structural CPU (TPC + TREG3 + ALU3) increments ACC like the native CPU', () => {
  const ex = EXAMPLES['cpu-structural'].build();
  const pc  = ex.comps.find(c => c.type === 'SUB:TPC');
  const acc = ex.comps.find(c => c.type === 'SUB:TREG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    // Read SUB instance q via the outer scope's outVals fanout (the keys the
    // simulator writes when settling a subcircuit instance's outputs).
    const readAcc = () => {
      const q0 = outVals[`${acc.id}:q0`];
      const q1 = outVals[`${acc.id}:q1`];
      const q2 = outVals[`${acc.id}:q2`];
      return tritsToInt([q0 ?? 0, q1 ?? 0, q2 ?? 0]);
    };
    const readPc = () => {
      const p0 = outVals[`${pc.id}:p0`];
      const p1 = outVals[`${pc.id}:p1`];
      return tritsToInt([p0 ?? 0, p1 ?? 0]) + 4;
    };
    // The structural CPU starts at word 4 (TPC's natural reset), runs
    // ADDI +1 at word 4, then JMP 4 at word 5 — same shape as the native
    // CPU's word 0 / word 1 loop. Each full instruction is 2 stepSequential
    // calls (one full clock cycle in bi mode). Sample the (ACC, PC) pair
    // after each step for ten steps.
    const seen = [];
    for (let i = 0; i < 10; i++) {
      stepSequential();
      seen.push({ acc: readAcc(), pc: readPc() });
    }
    // Pattern mirrors the native CPU's counter test: ACC and PC each hold
    // their value across the two half-cycles of a clock period.
    const expect = [
      { acc: 1, pc: 5 }, { acc: 1, pc: 5 }, { acc: 1, pc: 4 }, { acc: 1, pc: 4 },
      { acc: 2, pc: 5 }, { acc: 2, pc: 5 }, { acc: 2, pc: 4 }, { acc: 2, pc: 4 },
      { acc: 3, pc: 5 }, { acc: 3, pc: 5 },
    ];
    for (let i = 0; i < expect.length; i++) {
      assertEq(seen[i].acc, expect[i].acc, `step ${i+1} ACC:`);
      assertEq(seen[i].pc,  expect[i].pc,  `step ${i+1} PC:`);
    }
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- ISA v2 — LOAD / STORE + DMEM (E2b Phase C) --------------------------
//
// Phase C added a second 9×3-trit RAM (`dmem`) to the CPU2 preset plus a
// per-trit MUX picking ALU result vs DMEM read for ACC's data input. These
// tests drive handcrafted programs through the live CPU2 to confirm both
// LOAD and STORE move data between ACC and DMEM correctly.

// Locate the DMEM RAM on a CPU2-shaped circuit. The two IMEM RAMs are
// identified by sharing the PC's address; DMEM is the third RAM.
function findCpu2Dmem(scope) {
  const pc = scope.comps.find(c => c.type === 'PC');
  const rams = scope.comps.filter(c => c.type === 'RAM');
  const imemPair = rams.filter(r =>
    scope.wires.some(w => w.toId === r.id && w.toPort === 'a0' && w.fromId === pc.id));
  return rams.find(r => !imemPair.includes(r));
}

test('CPU2 STORE writes ACC into DMEM[addr]', () => {
  // Program: STORE 3 at word 0. Seed ACC = +2; after one cycle DMEM[3]
  // should hold [+2,0,0] (the trit encoding of +2).
  const res = assembleV2('STORE 3');
  if (res.errors.length) throw new Error('STORE assemble: ' + JSON.stringify(res.errors));
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    const ex = EXAMPLES['cpu2'].build();
    const rams = ex.comps.filter(c => c.type === 'RAM');
    const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
    const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
    const ramLo = rams.find(r => r.id === opLWire.fromId);
    const ramHi = rams.find(r => r.id !== ramLo.id &&
      ex.wires.some(w => w.toId === r.id && w.toPort === 'a0' &&
                          w.fromId === ex.comps.find(c => c.type === 'PC').id));
    ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
    ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
    const acc = ex.comps.find(c => c.type === 'REG3');
    acc.state = { q: intToTrits(2, 3), clkPrev: 0 };
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    stepSequential(); stepSequential();   // one full clock cycle
    const dmem = findCpu2Dmem({ comps: ex.comps, wires: ex.wires });
    assertDeepEq(dmem.state.mem[3], [-1, 1, 0], 'DMEM[3] after STORE 3 (ACC=+2):');
    // ACC must not have been overwritten by STORE (accWrite is 0 for STORE).
    assertEq(tritsToInt(acc.state.q), 2, 'ACC unchanged by STORE:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('CPU2 LOAD reads DMEM[addr] into ACC', () => {
  // Program: LOAD 5 at word 0. Pre-seed DMEM[5] = -3; ACC starts at 0.
  // After one cycle ACC should equal -3.
  const res = assembleV2('LOAD 5');
  if (res.errors.length) throw new Error('LOAD assemble: ' + JSON.stringify(res.errors));
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    const ex = EXAMPLES['cpu2'].build();
    const rams = ex.comps.filter(c => c.type === 'RAM');
    const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
    const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
    const ramLo = rams.find(r => r.id === opLWire.fromId);
    const pc = ex.comps.find(c => c.type === 'PC');
    const ramHi = rams.find(r => r.id !== ramLo.id &&
      ex.wires.some(w => w.toId === r.id && w.toPort === 'a0' && w.fromId === pc.id));
    ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
    ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
    const dmem = findCpu2Dmem({ comps: ex.comps, wires: ex.wires });
    dmem.state.mem[5] = intToTrits(-3, 3);
    dmem.state.clkPrev = 0;
    const acc = ex.comps.find(c => c.type === 'REG3');
    acc.state = { q: [0, 0, 0], clkPrev: 0 };
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    stepSequential(); stepSequential();
    assertEq(tritsToInt(acc.state.q), -3, 'ACC after LOAD 5:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('CPU2 LOAD / STORE round-trip increments DMEM in place', () => {
  // The dmem-counter program: LOAD 5 / ADDI +1 / STORE 5 / JMP LOOP.
  // After N full iterations DMEM[5] should equal N.
  const res = assembleV2(ASM2_EXAMPLES['dmem-counter'].src);
  if (res.errors.length) throw new Error('dmem-counter assemble: ' + JSON.stringify(res.errors));
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    const ex = EXAMPLES['cpu2'].build();
    const rams = ex.comps.filter(c => c.type === 'RAM');
    const decode = ex.comps.find(c => c.type === 'SUB:DECODE2');
    const opLWire = ex.wires.find(w => w.toId === decode.id && w.toPort === 'opL');
    const ramLo = rams.find(r => r.id === opLWire.fromId);
    const pc = ex.comps.find(c => c.type === 'PC');
    const ramHi = rams.find(r => r.id !== ramLo.id &&
      ex.wires.some(w => w.toId === r.id && w.toPort === 'a0' && w.fromId === pc.id));
    ramLo.state.mem = res.mem_lo.map(w => w.slice()); ramLo.state.clkPrev = 0;
    ramHi.state.mem = res.mem_hi.map(w => w.slice()); ramHi.state.clkPrev = 0;
    const dmem = findCpu2Dmem({ comps: ex.comps, wires: ex.wires });
    dmem.state.mem[5] = [0, 0, 0]; dmem.state.clkPrev = 0;
    const acc = ex.comps.find(c => c.type === 'REG3');
    acc.state = { q: [0, 0, 0], clkPrev: 0 };
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    // Two iterations of the 4-instruction loop = 8 PC advances = 16 stepSequential().
    for (let i = 0; i < 16; i++) stepSequential();
    assertEq(tritsToInt(dmem.state.mem[5]), 2, 'DMEM[5] after 2 loop iterations:');
    assertEq(tritsToInt(acc.state.q), 2, 'ACC after 2 loop iterations:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
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
    setComps([]); setWires([]); setNextCompId(1); setNextWireId(1);
    syncCompMap(); undoStack.length = 0; redoStack.length = 0;
    // Add a STI.
    pushHistory();
    comps.push({ id: setNextCompId(nextCompId + 1), type: 'STI', x: 0, y: 0, state: {} });
    syncCompMap();
    assertEq(comps.length, 1, 'one comp after add:');
    assertEq(undoStack.length, 1, 'one history entry:');
    // Add a wire from a fake INPUT.
    pushHistory();
    comps.push({ id: setNextCompId(nextCompId + 1), type: 'INPUT', x: 0, y: 80, state: { value: 1 } });
    syncCompMap();
    pushHistory();
    wires.push({ id: setNextWireId(nextWireId + 1), fromId: 2, fromPort: 'out', toId: 1, toPort: 'in' });
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
    comps.push({ id: setNextCompId(nextCompId + 1), type: 'MAX', x: 100, y: 0, state: {} });
    assertEq(redoStack.length, 0, 'new push clears redo:');
  } finally {
    setComps(savedComps); setWires(savedWires);
    setNextCompId(savedNextC); setNextWireId(savedNextW);
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
    setCustomGates({});
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
    setCustomGates(savedGates);
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

  return { TESTS, runAllTests };
}
