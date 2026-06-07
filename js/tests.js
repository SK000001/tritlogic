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
         SAVE_FORMAT_VERSION, upgradeSave, encodeShare, decodeShare,
         resolveDrivers, coerceForLogic,
         packBus, unpackBus, isBus, busLabel } from './util.js';
import {
  comps, wires, subcircuitDefs, customGates, outVals,
  nextCompId, nextWireId, tick, undoStack, redoStack, selection,
  setComps, setWires, setOutVals, setTick,
  setNextCompId, setNextWireId, setCustomGates,
} from './state.js';
import {
  assemble, assembleV2, decodeImemWord, decodeImemWordV2,
  ASM_EXAMPLES, ASM2_EXAMPLES,
} from './assembler.js';
import { COMPONENT_INFO, INFO_CATEGORIES } from './info-data.js';
import { minimizeTernary, evalMinimizedExpr, minimizedGateCount,
         canonicalGateCount, materializeMinimized } from './minimizer.js';
import { ternarizeAbsmean, evalTernaryXorNet, trainTernaryXor } from './ternary-train.js';
import { crossbarMac, crossbarMacFromPhases, tritToPhase, phaseToTrit,
         crossbarMacAnalog, recoverMac, macFidelityOk, pathInsertionLossDb,
         ANALOG_DEFAULTS, exportCrossbarProgram, programToWeights, formatProgram,
         HEATER_P_PI_MW, transpose, inferLayerOnChip, inferMlpOnCrossbar }
       from './photonic-twin.js';

export function registerTests(deps) {
  const {
    TYPES, EXAMPLES,
    buildAccSignDef, buildDecode2Def, buildMseqDef, buildUfieldsDef, buildMpcseqDef, buildCmpcseqDef,
    cloneSubScope, compDef, customGateDef, debuggerRunHeadless,
    debuggerState, deleteSubcircuit, enumerateInputs, filterPalette,
    findMicrocodeTargets, microcodeStoreUf, decodeMicroWord,
    infoSubTruthTable, isBuiltinSubcircuit, pushHistory, ramAddr,
    registerBuiltinSubcircuits, showInfoEntry, simulate, simulateScope,
    simulateTimed, switchingKeysAt, subLumpDelay, simulateSubInstance, stepSequential, syncCompMap, undo, redo,
    duplicateSelection, nudgeSelection, pickBootExample,
    isEmbed, shareParamFrom, fullAppUrlFromEmbed, buildEmbedCode,
    pickBootTutorial, TUTORIALS, TUTORIAL_LIST,
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
  // The bus-native port (C1 follow-on) also mirrors the word as a packed bus.
  assertDeepEq(TYPES.REG3.eval(reg), { q0: -1, q1: 0, q2: 1, qbus: packBus([-1, 0, 1]) });
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
  assertDeepEq(def.eval(ram, { a0: 1, a1: -1 }),
               { q0: 1, q1: 0, q2: -1, qbus: packBus([1, 0, -1]) }, 'written word:');
  assertDeepEq(def.eval(ram, { a0: 0, a1: 0 }),
               { q0: 0, q1: 0, q2: 0, qbus: packBus([0, 0, 0]) }, 'untouched word:');
  assertDeepEq(def.eval(ram, { a0: null, a1: 0 }),
               { q0: null, q1: null, q2: null, qbus: null }, 'floating address:');
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
               { q0: 0, q1: 0, q2: 0, qbus: packBus([0, 0, 0]) }, 'other words untouched:');
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
  const NULL = { r0: null, r1: null, r2: null, cout: null, rbus: null };
  assertDeepEq(def.eval(null, { ...full, op: null }), NULL, 'op floating:');
  assertDeepEq(def.eval(null, { ...full, a1: null }), NULL, 'operand a1 floating:');
  assertDeepEq(def.eval(null, { ...full, b2: null }), NULL, 'operand b2 floating:');
});
test('Bus-native ports (C1): REG3 / RAM / ALU accept and emit a packed word', () => {
  // REG3 loads its whole word from the dbus pin (no per-trit pins wired).
  const reg = { type: 'REG3', state: TYPES.REG3.defaults() };
  TYPES.REG3.latch(reg, { clk: -1, ld: 1, dbus: packBus([1, -1, 0]) });
  TYPES.REG3.latch(reg, { clk:  1, ld: 1, dbus: packBus([1, -1, 0]) });
  assertDeepEq(reg.state.q, [1, -1, 0], 'REG3 loaded word from dbus:');
  assertEq(TYPES.REG3.eval(reg).qbus, packBus([1, -1, 0]), 'REG3 emits qbus:');

  // A per-trit pin wins for its own slot; the rest come from the bus.
  TYPES.REG3.latch(reg, { clk: -1, ld: 1, dbus: packBus([1, 1, 1]), d1: -1 });
  TYPES.REG3.latch(reg, { clk:  1, ld: 1, dbus: packBus([1, 1, 1]), d1: -1 });
  assertDeepEq(reg.state.q, [1, -1, 1], 'per-trit d1 overrides bus slot 1:');

  // ALU adds two words delivered on abus / bbus and emits the sum on rbus.
  const r = TYPES.ALU.eval(null, { op: 0, abus: packBus(intToTrits(5, 3)),
                                          bbus: packBus(intToTrits(7, 3)) });
  assertEq(tritsToInt([r.r0, r.r1, r.r2]) + r.cout * 27, 12, 'ALU bus operands add:');
  assertEq(r.rbus, packBus([r.r0, r.r1, r.r2]), 'ALU emits rbus matching r0..r2:');

  // RAM writes from dbus and reads the word back on qbus.
  const ram = { type: 'RAM', state: TYPES.RAM.defaults() };
  TYPES.RAM.latch(ram, { a0: 0, a1: 0, we: 1, clk: -1, dbus: packBus([1, 0, -1]) });
  TYPES.RAM.latch(ram, { a0: 0, a1: 0, we: 1, clk:  1, dbus: packBus([1, 0, -1]) });
  assertEq(TYPES.RAM.eval(ram, { a0: 0, a1: 0 }).qbus, packBus([1, 0, -1]),
           'RAM round-trips a word via dbus → qbus:');
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

// ---- P1 trained ternary net (BitNet absmean → XOR) -----------------------
test('P1 absmean ternarization matches the BitNet b1.58 rule', () => {
  // scale = mean(|w|); round(w/scale) clamped to {-1,0,+1}.
  assertDeepEq(ternarizeAbsmean([0.9, -0.1, 0.5]), [1, 0, 1], 'mixed magnitudes:');
  assertDeepEq(ternarizeAbsmean([2, -2, 2, -2]), [1, -1, 1, -1], 'equal magnitudes saturate:');
  assertDeepEq(ternarizeAbsmean([0, 0, 0]), [0, 0, 0], 'all-zero → all-zero (no divide-by-zero):');
  // A big outlier raises the scale, zeroing the small weights.
  assertDeepEq(ternarizeAbsmean([10, 1, -1, 1]), [1, 0, 0, 0], 'outlier dominates the scale:');
});
test('P1 trainTernaryXor produces ternary weights that solve XOR', () => {
  const { W1, W2, seed } = trainTernaryXor();
  if (seed < 0) throw new Error('no seed yielded a ternary net that solves XOR');
  // Weights really are ternary {-1,0,+1}.
  for (const row of [...W1, W2]) for (const v of row)
    if (![-1, 0, 1].includes(v)) throw new Error('non-ternary weight: ' + v);
  // The ternary net computes XOR on all four bipolar inputs.
  for (const a of [-1, 1]) for (const b of [-1, 1])
    assertEq(evalTernaryXorNet(W1, W2, a, b), a !== b ? 1 : -1, `xor(${a},${b}):`);
  // Deterministic — same call, same result.
  assertDeepEq(trainTernaryXor().W1, W1, 'training is deterministic (W1):');
  assertDeepEq(trainTernaryXor().W2, W2, 'training is deterministic (W2):');
});
test('P1 ternary-xor preset circuit computes XOR end to end', () => {
  // The built circuit (MAC3 + ACT kit, trained weights baked in) must agree with
  // the reference net for every bipolar input — proving the logic matches the ML.
  const { comps, wires } = EXAMPLES['ternary-xor'].build();
  const inByName = {}, outSrc = {};
  for (const c of comps) {
    if (c.type === 'INPUT') inByName[c.state.name] = c;
    if (c.type === 'OUTPUT') {
      const wr = wires.find(w => w.toId === c.id && w.toPort === 'in');
      outSrc[c.state.name] = wr ? `${wr.fromId}:${wr.fromPort}` : null;
    }
  }
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    inByName.a.state.value = a;
    inByName.b.state.value = b;
    const scope = { comps, wires, outVals: {} };
    simulateScope(scope);
    assertEq(scope.outVals[outSrc.y], a !== b ? 1 : -1, `preset xor(${a},${b}) y:`);
  }
});
test('P1 slice 2 — time-multiplexed MAC computes a 3-neuron layer with ONE MAC3', () => {
  const ex = EXAMPLES['ternary-mac-seq'].build();
  // The whole point: a single shared MAC3, not one per neuron.
  assertEq(ex.comps.filter(c => c.type === 'SUB:MAC3').length, 1, 'exactly one MAC3:');
  const sr = ex.comps.find(c => c.type === 'REG3');
  // Reference: the same 3-neuron layer computed in parallel — h_j = sign(W[j]·x).
  const sgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const W = [[1, 0, -1], [-1, 1, 1], [0, -1, 1]], x = [1, 1, -1];
  const h = W.map(row => sgn(row[0] * x[0] + row[1] * x[1] + row[2] * x[2]));
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    // bi clock → a rising edge every 2 steps; 6 steps = 3 edges = 3 neurons swept.
    for (let i = 0; i < 6; i++) stepSequential();
    // After the sweep the shift register holds [h2, h1, h0] (newest in q0).
    assertEq(sr.state.q[0], h[2], 'sr.q0 = h2 (last neuron):');
    assertEq(sr.state.q[1], h[1], 'sr.q1 = h1:');
    assertEq(sr.state.q[2], h[0], 'sr.q2 = h0 (first neuron):');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- P2 photonic crossbar twin (value-level bridge) ----------------------
// The photonic 3×3 crossbar's compute, modelled at the value level, must agree
// numerically with the TritLogic Neural-Net kit on the same weights/inputs —
// that agreement IS Strategic Push 2's deliverable.

test('P2 photonic-twin: crossbarMac = y_j = Σ_i W_ij·x_i, plus the MZI phase encoding', () => {
  // Device weight encoding from the SAX model: φ = π/2 → −1, π → 0, 3π/2 → +1.
  assertEq(tritToPhase(-1), Math.PI / 2,     'tritToPhase(−1) = π/2:');
  assertEq(tritToPhase(0),  Math.PI,         'tritToPhase(0) = π:');
  assertEq(tritToPhase(1),  3 * Math.PI / 2, 'tritToPhase(+1) = 3π/2:');
  for (const t of [-1, 0, 1]) assertEq(phaseToTrit(tritToPhase(t)), t, `phase round-trips trit ${t}:`);
  // A small heater-trim error still reads as the intended weight.
  assertEq(phaseToTrit(Math.PI / 2 + 0.2), -1, 'slightly-off φ still snaps to −1:');

  // crossbarMac on a hand-checked case: y = (+2, 0, −2) for the preset defaults.
  const Wd = [[1, -1, 0], [0, 1, -1], [-1, 0, 1]];
  assertDeepEq(crossbarMac(Wd, [1, 1, -1]), [2, 0, -2], 'crossbarMac default case:');
  // The column sum is genuinely [input i][output j]: column 0 reads W[*][0].
  assertEq(crossbarMac([[1, 0, 0], [1, 0, 0], [1, 0, 0]], [1, 1, 1])[0], 3, 'column 0 sums input rows:');
  // Programming via heater phases gives the same answer.
  const phaseGrid = Wd.map(row => row.map(tritToPhase));
  assertDeepEq(crossbarMacFromPhases(phaseGrid, [1, 1, -1]), [2, 0, -2], 'from-phases matches:');
});

test('P2 functional MAC twin: Neural-Net kit MAC3 agrees NUMERICALLY with the crossbar model', () => {
  // The core P2 check: each output column of the photonic crossbar is one MAC3
  // dot product. Drive MAC3 directly with column j's weights {W[0][j],W[1][j],
  // W[2][j]} + the shared input vector, decode its 2-trit output (lo + 3·hi),
  // and assert it equals crossbarMac(W,x)[j]. Exhaustive over a single column's
  // 3^6 weight×input space, then random over full 3×3 matrices.
  const colVal = (wcol, x) => {
    const o = simulateSubInstance({ type: 'SUB:MAC3', state: {} },
      { w0: wcol[0], w1: wcol[1], w2: wcol[2], x0: x[0], x1: x[1], x2: x[2] });
    return (o.lo + 3 * o.hi) || 0;
  };
  // Exhaustive: one column over all 729 (weights × inputs) — MAC3 == Σ wᵢxᵢ.
  for (const w0 of [-1, 0, 1]) for (const w1 of [-1, 0, 1]) for (const w2 of [-1, 0, 1])
  for (const x0 of [-1, 0, 1]) for (const x1 of [-1, 0, 1]) for (const x2 of [-1, 0, 1]) {
    const wcol = [w0, w1, w2], x = [x0, x1, x2];
    // A 3×3 crossbar whose column 0 carries this weight column.
    const W = [[w0, 0, 0], [w1, 0, 0], [w2, 0, 0]];
    assertEq(colVal(wcol, x), crossbarMac(W, x)[0],
      `MAC3 vs twin (w=${wcol} x=${x}):`);
  }
  // Random full 3×3 matrices: every column of the kit agrees with the twin.
  let seed = 2718;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 400; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    const yTwin = crossbarMac(W, x);
    for (let j = 0; j < 3; j++) {
      const wcol = [W[0][j], W[1][j], W[2][j]];
      assertEq(colVal(wcol, x), yTwin[j], `sample ${s} column ${j} (x=${x}):`);
    }
  }
});

test('P2 photonic-crossbar preset circuit computes the crossbar matmul', () => {
  // The on-canvas logical twin (3 MAC3 columns sharing the input vector) must
  // reproduce crossbarMac on the same weights/inputs — validates the demo, the
  // [input i][output j] weight wiring (wᵢⱼ), and the 2-trit output decode.
  const { comps, wires } = EXAMPLES['photonic-crossbar'].build();
  const inByName = {}, outSrc = {};
  for (const c of comps) {
    if (c.type === 'INPUT') inByName[c.state.name] = c;
    if (c.type === 'OUTPUT') {
      const wr = wires.find(w => w.toId === c.id && w.toPort === 'in');
      outSrc[c.state.name] = wr ? `${wr.fromId}:${wr.fromPort}` : null;
    }
  }
  // Defaults already wired: confirm the documented y = (+2, 0, −2).
  let scope = { comps, wires, outVals: {} };
  simulateScope(scope);
  for (let j = 0; j < 3; j++) {
    const got = 3 * scope.outVals[outSrc['y' + j + 'hi']] + scope.outVals[outSrc['y' + j + 'lo']];
    assertEq(got || 0, [2, 0, -2][j], `default y${j}:`);
  }
  // Then a reproducible random sweep against the twin.
  let seed = 1414;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 400; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    for (let i = 0; i < 3; i++) inByName['x' + i].state.value = x[i];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      inByName['w' + i + j].state.value = W[i][j];
    scope = { comps, wires, outVals: {} };
    simulateScope(scope);
    const yTwin = crossbarMac(W, x);
    for (let j = 0; j < 3; j++) {
      const got = 3 * scope.outVals[outSrc['y' + j + 'hi']] + scope.outVals[outSrc['y' + j + 'lo']];
      assertEq(got || 0, yTwin[j], `sample ${s} y${j} (x=${x}):`);
    }
  }
});

// ---- P3 analog / optical fidelity ---------------------------------------
// crossbarMac is the IDEAL op; the chip isn't ideal. P3 checks the ternary
// result against realistic loss / finite extinction / MMI imbalance / detector
// noise — "does the imperfect optical mesh still compute the right trits?".

test('P3 ideal device params reproduce the exact integer MAC', () => {
  // Insertion loss is a uniform gain that recoverMac divides back out, so even
  // a lossy-but-otherwise-ideal chip (no leak, no imbalance, no noise) recovers
  // the exact crossbarMac result.
  const ideal = { extinctionDb: 200, imbalance: 0, noise: 0, seed: 7 };
  let seed = 31337;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 300; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    const got = recoverMac(crossbarMacAnalog(W, x, ideal), ideal);
    assertDeepEq(got, crossbarMac(W, x), `ideal analog == crossbarMac (sample ${s}):`);
  }
  // The insertion-loss budget is a sane positive number (~9.9 dB), and a fully
  // lossless device has unity gain.
  const il = pathInsertionLossDb();
  if (!(il > 5 && il < 15)) throw new Error('insertion loss out of expected range: ' + il);
  assertEq(pathInsertionLossDb({ gcLossDb: 0, mmiLossDb: 0, wgLossDbCm: 0 }), 0, 'lossless path = 0 dB:');
});

test('P3 realistic loss + 25 dB extinction + MMI imbalance still recover the exact result', () => {
  // The reassuring result: with the device's real loss/extinction/imbalance but
  // no detector noise, the rounded ternary MAC is still exactly the ideal one —
  // uniform loss/extinction don't move a decision, and the small static
  // imbalance stays well inside the ±0.5 rounding margin.
  const real = { ...ANALOG_DEFAULTS, noise: 0 };   // 25 dB ER, 0.02 imbalance, lossy path
  let seed = 24601;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 400; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    const params = { ...real, seed: s + 1 };        // vary the static imbalance draw per chip
    assertEq(macFidelityOk(W, x, params), true,
      `realistic device recovers ideal (sample ${s}, x=${x}):`);
  }
});

test('P3 detector noise degrades gracefully — exact at low noise, errors at high noise', () => {
  // Effective noise (post gain-recovery) ≈ p.noise / gain. Low noise stays many
  // sigma inside the ±0.5 rounding margin → every case recovers; crank it up and
  // the ternary result starts to break — the fidelity wall the SNR sets.
  let seed = 90210;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  const N = 250;
  const cases = [];
  for (let s = 0; s < N; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    cases.push({ x, W });
  }
  const rateAt = (noise) => {
    let ok = 0;
    cases.forEach((c, s) => {
      if (macFidelityOk(c.W, c.x, { ...ANALOG_DEFAULTS, noise, seed: s + 1 })) ok++;
    });
    return ok / N;
  };
  const low = rateAt(0.02);    // tiny noise → perfect recovery
  const high = rateAt(0.6);    // heavy noise → frequent errors
  assertEq(low, 1, 'low noise recovers every case:');
  if (!(high < 0.9)) throw new Error(`high noise should degrade recovery, got rate ${high}`);
  if (!(high < low))  throw new Error('more noise must not recover better than less noise');
});

// ---- P4 weights → device export ("train → program the chip") -------------
// The end of the pipeline: trained ternary weights → the concrete per-tile
// heater settings that program the crossbar, validated end to end.

test('P4 exportCrossbarProgram maps trits → heater phases/powers and round-trips', () => {
  const W = [[-1, 0], [1, -1], [0, 1]];   // 3 inputs × 2 outputs
  const prog = exportCrossbarProgram(W);
  // Per-tile encoding: −1→π/2, 0→π, +1→3π/2; power = (φ/π)·P_π.
  assertDeepEq(prog.phaseRad, [[Math.PI / 2, Math.PI], [3 * Math.PI / 2, Math.PI / 2], [Math.PI, 3 * Math.PI / 2]], 'phase grid:');
  assertDeepEq(prog.heaterPowerMw, [[12.5, 25], [37.5, 12.5], [25, 37.5]], 'heater power grid (P_π=25 mW):');
  assertEq(prog.tiles.length, 6, 'one entry per tile:');
  const t00 = prog.tiles[0];
  assertEq(t00.weight, -1, 'tile (0,0) weight:'); assertEq(t00.phaseLabel, 'π/2', 'tile (0,0) label:');
  assertEq(t00.heaterPowerMw, 12.5, 'tile (0,0) power:');
  // A different P_π scales every power linearly.
  assertEq(exportCrossbarProgram(W, { pPiMw: 30 }).heaterPowerMw[2][1], 45, 'P_π=30 → +1 tile = 45 mW:');
  assertEq(HEATER_P_PI_MW, 25, 'default P_π estimate:');
  // The program faithfully carries the weights: decoding the phases gives W back.
  let seed = 555;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 200; s++) {
    const Wr = [[nextTrit(), nextTrit(), nextTrit()],
                [nextTrit(), nextTrit(), nextTrit()],
                [nextTrit(), nextTrit(), nextTrit()]];
    assertDeepEq(programToWeights(exportCrossbarProgram(Wr)), Wr, `program round-trips W (sample ${s}):`);
  }
  // formatProgram is a readable table: header + one row per tile.
  assertEq(formatProgram(prog).split('\n').length, 1 + 6, 'formatProgram: header + 6 rows:');
});

test('P4 export → reprogrammed (modeled) chip computes the intended MAC', () => {
  // Feeding the exported heater phases back through the crossbar model must
  // reproduce the ideal MAC — and still recover it through the analog twin at
  // realistic device params (ties P4 to P3).
  let seed = 8191;
  const nextTrit = () => { seed = (seed * 75 + 74) % 65537; return (seed % 3) - 1; };
  for (let s = 0; s < 300; s++) {
    const x = [nextTrit(), nextTrit(), nextTrit()];
    const W = [[nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()],
               [nextTrit(), nextTrit(), nextTrit()]];
    const prog = exportCrossbarProgram(W);
    assertDeepEq(crossbarMacFromPhases(prog.phaseRad, x), crossbarMac(W, x),
      `reprogrammed phases reproduce MAC (sample ${s}):`);
    // The programmed weights, through the realistic analog chip (low noise),
    // still recover the exact trits.
    const Wprog = programToWeights(prog);
    assertEq(macFidelityOk(Wprog, x, { ...ANALOG_DEFAULTS, noise: 0.02, seed: s + 1 }), true,
      `programmed chip recovers ideal under realistic optics (sample ${s}):`);
  }
});

test('P4 trained ternary XOR layer programs onto the crossbar', () => {
  // The headline pipeline: trained (BitNet-absmean) ternary weights → device
  // program → the modeled crossbar computes the trained hidden layer. The XOR
  // net's layer 1 is 2 neurons over [a, b, bias]; the crossbar matrix is its
  // transpose Wcb[i][j] = W1[j][i] (3 inputs × 2 output columns).
  const { W1, seed } = trainTernaryXor();
  if (seed < 0) throw new Error('no trained ternary XOR net (P1 dependency)');
  const Wcb = [[W1[0][0], W1[1][0]],   // input a → neurons 0,1
               [W1[0][1], W1[1][1]],   // input b
               [W1[0][2], W1[1][2]]];  // bias
  const prog = exportCrossbarProgram(Wcb);
  assertDeepEq(programToWeights(prog), Wcb, 'trained weights survive the export:');
  const sgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const x = [a, b, 1];   // bias lane = +1
    const y = crossbarMacFromPhases(prog.phaseRad, x);
    // Programmed crossbar reproduces the layer's pre-activations …
    assertDeepEq(y, crossbarMac(Wcb, x), `programmed pre-activations (a=${a},b=${b}):`);
    // … whose signs are exactly the net's hidden activations h_j = sgn(W1[j]·x).
    for (let j = 0; j < 2; j++) {
      const hj = sgn(W1[j][0] * a + W1[j][1] * b + W1[j][2] * 1);
      assertEq(sgn(y[j]), hj, `hidden neuron ${j} via programmed chip (a=${a},b=${b}):`);
    }
  }
});

// ---- P5 end-to-end: a whole trained net running on the modeled chip --------
// The Push-2 capstone. Train (P1) → ternarize (P1) → program (P4) → run
// inference through the optical MAC model (P2/P3): the trained ternary XOR net,
// both layers, on ONE reused 3×3 crossbar.

test('P5 transpose maps [output][input] neuron rows to the crossbar [input][output] matrix', () => {
  assertDeepEq(transpose([[1, 0, -1], [-1, 1, 0]]), [[1, -1], [0, 1], [-1, 0]], 'transpose:');
  // Round-trips a square matrix and squares with crossbarMac's indexing: a layer
  // row-dotted with x equals the crossbar column-summed with x.
  const W1 = [[1, -1, 0], [0, 1, -1]];   // 2 neurons over 3 inputs
  const Wcb = transpose(W1), x = [1, 1, -1];
  for (let j = 0; j < 2; j++)
    assertEq(crossbarMac(Wcb, x)[j], W1[j][0] * x[0] + W1[j][1] * x[1] + W1[j][2] * x[2], `neuron ${j}:`);
});

test('P5 trained ternary XOR runs end-to-end on the modeled photonic crossbar', () => {
  // The full pipeline. trainTernaryXor (P1) gives a 2→2→1 ternary net; each layer
  // is a crossbar pass (programmed weights → analog optics → recovered MACs →
  // sign). With realistic device params but low noise it must classify XOR
  // correctly on all four inputs, agreeing with the reference net.
  const { W1, W2, seed } = trainTernaryXor();
  if (seed < 0) throw new Error('no trained ternary XOR net (P1 dependency)');
  const layers = [{ W: transpose(W1) }, { W: transpose([W2]) }];   // [a,b]+bias → h ; [h0,h1]+bias → y
  const sgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const params = { ...ANALOG_DEFAULTS, noise: 0.02 };
  let s = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const want = a !== b ? 1 : -1;                       // XOR on bipolar inputs
    const { y, trace } = inferMlpOnCrossbar(layers, [a, b], { ...params, seed: 10 * (++s) });
    assertEq(y.length, 1, 'single output:');
    assertEq(y[0], want, `XOR on chip (a=${a},b=${b}):`);
    // Agrees with the reference net AND the chip reproduced the hidden layer.
    assertEq(y[0], evalTernaryXorNet(W1, W2, a, b), `chip == reference net (a=${a},b=${b}):`);
    const hRef = [0, 1].map(j => sgn(W1[j][0] * a + W1[j][1] * b + W1[j][2] * 1));
    assertDeepEq(trace[0].act, hRef, `hidden layer on chip (a=${a},b=${b}):`);
  }
  // The deployable artifact: a faithful device program for each layer.
  for (const layer of layers)
    assertDeepEq(programToWeights(exportCrossbarProgram(layer.W)), layer.W, 'layer program round-trips:');
});

test('P5 end-to-end inference is SNR-limited — perfect at low noise, degrades at high', () => {
  // The honest caveat: the optics-in-the-loop net is reliable only above an SNR.
  const { W1, W2 } = trainTernaryXor();
  const layers = [{ W: transpose(W1) }, { W: transpose([W2]) }];
  const inputs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const accuracyAt = (noise) => {
    let ok = 0, total = 0;
    for (let trial = 0; trial < 60; trial++) {
      for (const [a, b] of inputs) {
        const want = a !== b ? 1 : -1;
        const { y } = inferMlpOnCrossbar(layers, [a, b], { ...ANALOG_DEFAULTS, noise, seed: 7 * (trial + 1) + 1 });
        if (y[0] === want) ok++;
        total++;
      }
    }
    return ok / total;
  };
  assertEq(accuracyAt(0.02), 1, 'low noise classifies XOR perfectly:');
  const hi = accuracyAt(0.8);
  if (!(hi < 1)) throw new Error(`heavy noise should cost accuracy, got ${hi}`);
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

test('A2 subLumpDelay charges a subcircuit its internal critical path', () => {
  // The timed solver runs a SUB: instance as one black box, so its delay should
  // be the longest internal gate chain — not a flat 1 (A2 follow-on). Build a
  // throwaway def: INPUT → STI → STI → OUTPUT plus a shortcut INPUT → OUTPUT.
  // Critical path = two unit-delay STIs = 2 (the shortcut doesn't shorten it).
  subcircuitDefs['ChainTest'] = {
    inputs: [{ name: 'x' }], outputs: [{ name: 'y' }],
    comps: [
      { id: 1, type: 'INPUT',  x: 0, y: 0, state: { name: 'x' } },
      { id: 2, type: 'STI',    x: 0, y: 0, state: {} },
      { id: 3, type: 'STI',    x: 0, y: 0, state: {} },
      { id: 4, type: 'OUTPUT', x: 0, y: 0, state: { name: 'y' } },
    ],
    wires: [
      { id: 1, fromId: 1, fromPort: 'out', toId: 2, toPort: 'in' },
      { id: 2, fromId: 2, fromPort: 'out', toId: 3, toPort: 'in' },
      { id: 3, fromId: 3, fromPort: 'out', toId: 4, toPort: 'in' },
      { id: 4, fromId: 1, fromPort: 'out', toId: 4, toPort: 'in' },   // shortcut
    ],
  };
  assertEq(subLumpDelay('ChainTest'), 2, 'two STIs deep ⇒ delay 2:');

  // A sequential element breaks the combinational chain: its output is stored
  // state, not a function of this settle's inputs. INPUT → STI → DFF → STI →
  // OUTPUT — the DFF resets accumulation, so only the post-DFF STI counts ⇒ 1.
  subcircuitDefs['SeqBreakTest'] = {
    inputs: [{ name: 'd' }], outputs: [{ name: 'q' }],
    comps: [
      { id: 1, type: 'INPUT',  x: 0, y: 0, state: { name: 'd' } },
      { id: 2, type: 'STI',    x: 0, y: 0, state: {} },
      { id: 3, type: 'DFF',    x: 0, y: 0, state: {} },
      { id: 4, type: 'STI',    x: 0, y: 0, state: {} },
      { id: 5, type: 'OUTPUT', x: 0, y: 0, state: { name: 'q' } },
    ],
    wires: [
      { id: 1, fromId: 1, fromPort: 'out', toId: 2, toPort: 'in' },
      { id: 2, fromId: 2, fromPort: 'out', toId: 3, toPort: 'd' },
      { id: 3, fromId: 3, fromPort: 'q',   toId: 4, toPort: 'in' },
      { id: 4, fromId: 4, fromPort: 'out', toId: 5, toPort: 'in' },
    ],
  };
  assertEq(subLumpDelay('SeqBreakTest'), 1, 'sequential breaks the chain ⇒ delay 1:');

  delete subcircuitDefs['ChainTest'];
  delete subcircuitDefs['SeqBreakTest'];

  // A real multi-gate kit subcircuit is deeper than the flat unit default.
  registerBuiltinSubcircuits();
  assertEq(subLumpDelay('FADD') > 1, true, 'a full-adder kit sub is deeper than 1:');
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

test('C1 bus datapath: an accumulator loops its word through bus wires', () => {
  const ex = EXAMPLES['bus-datapath'].build();
  const acc = ex.comps.find(c => c.type === 'REG3');
  const ma  = ex.comps.find(c => c.type === 'MERGE3');   // acc-value merge (declared first)
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    // The accumulator's value rides a bus wire even before any clock step.
    assertEq(isBus(outVals[`${ma.id}:bus`]), true, 'acc value is on a bus wire:');
    assertEq(outVals[`${ma.id}:bus`], packBus(acc.state.q), 'bus carries the acc word:');
    const seen = [];
    for (let i = 0; i < 8; i++) { stepSequential(); seen.push(tritsToInt(acc.state.q)); }
    assertEq(JSON.stringify(seen), JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4]),
             'acc increments once per rising edge (bi clock latches every 2 ticks):');
    // The bus still carries the live accumulator word after stepping.
    assertEq(outVals[`${ma.id}:bus`], packBus(acc.state.q), 'bus tracks acc after stepping:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('C1 bus-native ports: accumulator loops on Qw→Aw / Rw→Dw with no MERGE/SPLIT', () => {
  const ex = EXAMPLES['bus-ports'].build();
  // No MERGE/SPLIT blocks at all — the whole word loop is on the native ports.
  assertEq(ex.comps.some(c => c.type === 'MERGE3' || c.type === 'SPLIT3'), false,
           'example uses no MERGE3/SPLIT3:');
  const acc = ex.comps.find(c => c.type === 'REG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    // The accumulator's word is on its bus-native output port before any step.
    assertEq(outVals[`${acc.id}:qbus`], packBus(acc.state.q), 'acc word is on the Qw port:');
    const seen = [];
    for (let i = 0; i < 8; i++) { stepSequential(); seen.push(tritsToInt(acc.state.q)); }
    assertEq(JSON.stringify(seen), JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4]),
             'acc increments once per rising edge through the bus ports:');
    assertEq(outVals[`${acc.id}:qbus`], packBus(acc.state.q), 'Qw tracks acc after stepping:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
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

// ---- E3 Phase 1: microsequencer ----
test('MSEQ microsequencer picks the next µPC for CONT / DISP / FETCH', () => {
  if (!subcircuitDefs['MSEQ']) subcircuitDefs['MSEQ'] = buildMseqDef();
  const def = subcircuitDefs['MSEQ'];
  const run = (seqMode, disp0, disp1) => {
    const instance = { type: 'SUB:MSEQ', state: {}, subScope: cloneSubScope(def) };
    return simulateSubInstance(instance, { seqMode, disp0, disp1 });
  };
  // CONT (seqMode 0): jmp=0 so the µPC increments; the targets are don't-care.
  assertEq(run(0, 1, -1).jmp, 0, 'CONT: jmp=0 (µPC increments):');
  // DISP (seqMode +1): jmp=+1 and the dispatch address passes through.
  let o = run(1, 1, -1);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,1,-1', 'DISP: load the dispatch address:');
  o = run(1, -1, 0);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,-1,0', 'DISP routes a different dispatch address:');
  // FETCH (seqMode T): jmp=+1, target = µword 0 = (T,T) regardless of disp.
  o = run(-1, 1, 1);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,-1,-1', 'FETCH: jump to µword 0 (T,T):');
});

test('Microcode-seq demo: the µPC walks the control store CONT,CONT,CONT,FETCH', () => {
  const ex = EXAMPLES['microcode-seq'].build();
  const upc  = ex.comps.find(c => c.type === 'PC');
  const urom = ex.comps.find(c => c.type === 'RAM');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    const word = () => tritsToInt(upc.state.p) + 4;   // PC encoding
    assertEq(word(), 0, 'µPC starts at µword 0 (seeded p=(T,T)):');
    const seenPc = [], seenA = [];
    for (let i = 0; i < 8; i++) {
      stepSequential();
      seenPc.push(word());
      seenA.push(outVals[`${urom.id}:q1`] ?? null);   // ctrlA = µROM[µPC].q1
    }
    // bi clock latches every 2 ticks: µPC increments 0→1→2→3 then FETCH→0.
    assertEq(JSON.stringify(seenPc), JSON.stringify([1, 1, 2, 2, 3, 3, 0, 0]),
             'µPC walks 1,2,3 then fetch-resets to 0:');
    // ctrlA tracks the µROM word the µPC lands on: µ1=0, µ2=T, µ3=0, µ0=+1.
    assertEq(JSON.stringify(seenA), JSON.stringify([0, 0, -1, -1, 0, 0, 1, 1]),
             'control bit A follows the microprogram:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- E3 Phase 2: control store + microinstruction field decode ----
test('UFIELDS passes through fields and decodes the 1-of-3 memory control', () => {
  if (!subcircuitDefs['UFIELDS']) subcircuitDefs['UFIELDS'] = buildUfieldsDef();
  const def = subcircuitDefs['UFIELDS'];
  const run = (f) => {
    const instance = { type: 'SUB:UFIELDS', state: {}, subScope: cloneSubScope(def) };
    return simulateSubInstance(instance, f);
  };
  // Pass-through fields surface unchanged under their semantic names.
  let o = run({ m_seq: -1, m_alu: 1, m_accW: 1, m_accSrc: -1, m_mem: -1, m_pc: 1 });
  assertEq(`${o.seqMode},${o.aluOp},${o.accWrite},${o.accSrc},${o.pcCtl}`, '-1,1,1,-1,1',
           'pass-through fields:');
  // memCtl 1-of-3 decode: T=none, 0=read, +1=write → two {0,+1} enables.
  const mem = (m) => { const r = run({ m_seq: 0, m_alu: 0, m_accW: 0, m_accSrc: 0, m_mem: m, m_pc: 0 });
                       return `${r.memWrite},${r.memRead}`; };
  assertEq(mem(1),  '1,0', 'm_mem=+1 → write:');
  assertEq(mem(0),  '0,1', 'm_mem=0 → read:');
  assertEq(mem(-1), '0,0', 'm_mem=T → neither (none):');
});

test('Microcode-fields demo: control lines follow the microprogram', () => {
  const ex = EXAMPLES['microcode-fields'].build();
  const upc = ex.comps.find(c => c.type === 'PC');
  const uf  = ex.comps.find(c => c.type === 'SUB:UFIELDS');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    assertEq(tritsToInt(upc.state.p) + 4, 0, 'µPC starts at µword 0:');
    const field = (n) => outVals[`${uf.id}:${n}`] ?? null;
    const seen = { alu: [], accW: [], memW: [], memR: [] };
    for (let i = 0; i < 8; i++) {
      stepSequential();
      seen.alu.push(field('aluOp')); seen.accW.push(field('accWrite'));
      seen.memW.push(field('memWrite')); seen.memR.push(field('memRead'));
    }
    // µPC walks µ1,µ1,µ2,µ2,µ3,µ3,µ0,µ0 (bi clock); fields are read at each.
    assertEq(JSON.stringify(seen.alu),  JSON.stringify([1, 1, -1, -1, 0, 0, 0, 0]),  'aluOp sequence:');
    assertEq(JSON.stringify(seen.accW), JSON.stringify([0, 0, 1, 1, 0, 0, 1, 1]),    'accWrite sequence:');
    assertEq(JSON.stringify(seen.memW), JSON.stringify([1, 1, 0, 0, 0, 0, 0, 0]),    'memWrite (µ1 only):');
    assertEq(JSON.stringify(seen.memR), JSON.stringify([0, 0, 0, 0, 1, 1, 1, 1]),    'memRead (µ3,µ0):');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- E3 Phase 3: dispatch map + fetch/dispatch/return loop ----
test('Microcode-dispatch demo: macro-ops dispatch to multi-cycle microroutines', () => {
  // The fetch→dispatch→routine→FETCH loop. Macro-program is ADDI, LOAD, ADDI,
  // LOAD (then NOPs): ADDI is a 1-µword routine (µ1), LOAD a 2-µword routine
  // (µ2,µ3). µ0 is the shared dispatch word — it routes the µPC to the current
  // opcode's routine entry (via the dispatch ROM) AND advances the macro-PC;
  // routine µwords hold the macro-PC. We watch both program counters walk.
  const ex = EXAMPLES['microcode-dispatch'].build();
  // Two PCs: the macro-PC is the higher one (y=80), the µPC sits lower (y=380).
  const macroPc = ex.comps.filter(c => c.type === 'PC').find(c => c.y === 80);
  const microPc = ex.comps.filter(c => c.type === 'PC').find(c => c.y === 380);
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    const uWord = () => tritsToInt(microPc.state.p) + 4;
    const mWord = () => tritsToInt(macroPc.state.p) + 4;
    assertEq(uWord(), 0, 'µPC starts at the dispatch word µ0:');
    assertEq(mWord(), 0, 'macro-PC starts at instruction 0:');
    const seenU = [], seenM = [];
    for (let i = 0; i < 16; i++) {
      stepSequential();
      seenU.push(uWord());
      seenM.push(mWord());
    }
    // bi clock latches every 2 ticks, so each logical step is sampled twice.
    // Logical µPC trajectory: dispatch→µ1(ADDI), FETCH→µ0, dispatch→µ2(LOAD),
    // CONT→µ3, FETCH→µ0, dispatch→µ1(ADDI), FETCH→µ0, dispatch→µ2(LOAD)…
    assertEq(JSON.stringify(seenU),
             JSON.stringify([1, 1, 0, 0, 2, 2, 3, 3, 0, 0, 1, 1, 0, 0, 2, 2]),
             'µPC dispatches into routines and FETCHes back:');
    // Macro-PC advances once per instruction (at the dispatch word) and holds
    // through the rest of each routine: stays on 1 across ADDI's single µword
    // and the FETCH, on 2 across LOAD's two µwords + FETCH, etc.
    assertEq(JSON.stringify(seenM),
             JSON.stringify([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4]),
             'macro-PC advances one instruction per routine, holds mid-routine:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- E3 Phase 4: macro-PC sequencer + the microcoded CPU3 datapath ----
test('MPCSEQ macro-PC sequencer: advance / hold / jump', () => {
  if (!subcircuitDefs['MPCSEQ']) subcircuitDefs['MPCSEQ'] = buildMpcseqDef();
  const def = subcircuitDefs['MPCSEQ'];
  const run = (pcCtl, p0, p1, t0, t1) => {
    const instance = { type: 'SUB:MPCSEQ', state: {}, subScope: cloneSubScope(def) };
    return simulateSubInstance(instance, { pcCtl, p0, p1, t0, t1 });
  };
  // ADV (pcCtl=0): jmp=0 so the native PC increments; targets don't-care.
  assertEq(run(0, 1, -1, 0, 1).jmp, 0, 'ADV: jmp=0 (PC increments):');
  // HOLD (pcCtl=+1): jmp=+1 and j ← the PC's own address (self-reload = hold).
  let o = run(1, 1, -1, 0, 0);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,1,-1', 'HOLD: reload self (p0,p1):');
  // JMP (pcCtl=T): jmp=+1 and j ← the jump target (the instruction operand).
  o = run(-1, 1, -1, -1, 1);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,-1,1', 'JMP: load the target (t0,t1):');
});

test('CMPCSEQ conditional macro-PC sequencer: ADV / HOLD / conditional jump', () => {
  if (!subcircuitDefs['CMPCSEQ']) subcircuitDefs['CMPCSEQ'] = buildCmpcseqDef();
  const def = subcircuitDefs['CMPCSEQ'];
  // pcCtl, p0,p1, t0,t1, isPos,isZero, cAlways,cPos,cZero
  const run = (pcCtl, isPos, isZero, cA, cP, cZ) => {
    const instance = { type: 'SUB:CMPCSEQ', state: {}, subScope: cloneSubScope(def) };
    return simulateSubInstance(instance, {
      pcCtl, p0: 1, p1: -1, t0: -1, t1: 0, isPos, isZero, cAlways: cA, cPos: cP, cZero: cZ });
  };
  // ADV: increment regardless of any condition.
  assertEq(run(0, 1, 0, 0, 1, 0).jmp, 0, 'ADV: jmp=0:');
  // HOLD: reload self (p0,p1); conditions ignored.
  let o = run(1, 1, 1, 1, 1, 1);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,1,-1', 'HOLD: reload self:');
  // CJUMP, unconditional (cAlways): always jumps to the target.
  o = run(-1, 0, 0, 1, 0, 0);
  assertEq(`${o.jmp},${o.j0},${o.j1}`, '1,-1,0', 'CJUMP cAlways: take the target:');
  // CJUMP if-positive: taken iff ACC is positive.
  assertEq(run(-1, 1, 0, 0, 1, 0).jmp, 1, 'CJUMP cPos + ACC>0: taken:');
  assertEq(run(-1, 0, 0, 0, 1, 0).jmp, 0, 'CJUMP cPos + ACC≤0: not taken:');
  // CJUMP if-zero: taken iff ACC is zero.
  assertEq(run(-1, 0, 1, 0, 0, 1).jmp, 1, 'CJUMP cZero + ACC=0: taken:');
  assertEq(run(-1, 0, 0, 0, 0, 1).jmp, 0, 'CJUMP cZero + ACC≠0: not taken:');
  // A conditional flag must NOT fire while holding (µ0 dispatch is HOLD).
  assertEq(run(1, 1, 0, 0, 1, 0).j0, 1, 'HOLD ignores cPos (stays on self):');
});

test('CPU3 (microcoded) runs the counter — ACC climbs 0,1,2,3 like CPU2', () => {
  // The microengine drives the real ACC/ALU datapath. The default program is
  // the same counter CPU2 runs (ADDI +1 / JMP 0). CPU3 is multi-cycle (two
  // clocks per instruction: dispatch + execute), so ACC climbs more slowly in
  // wall-clock steps, but the VALUE progression must be identical: 0,1,2,3,…
  const ex = EXAMPLES['cpu3'].build();
  const acc = ex.comps.find(c => c.type === 'REG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    assertEq(tritsToInt(acc.state.q), 0, 'ACC starts at 0:');
    const seen = [];
    for (let i = 0; i < 24; i++) { stepSequential(); seen.push(tritsToInt(acc.state.q)); }
    // Collapse runs of equal values: ACC must only ever step up by 1, never
    // skip or decrement — the microcoded counter agrees with CPU2's semantics.
    const progression = seen.filter((v, i) => i === 0 || v !== seen[i - 1]);
    assertEq(JSON.stringify(progression), JSON.stringify([0, 1, 2, 3]),
             'ACC increments by 1 each loop (0→1→2→3), no skips:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('CPU3 STORE / LOAD round-trip through DMEM', () => {
  // Exercises the microcoded DMEM datapath: STORE writes ACC to memory, a later
  // ADDI changes ACC, then LOAD pulls the stored value back. Program:
  //   0 ADDI +1      ACC = 1
  //   1 STORE @5     DMEM[5] = 1
  //   2 ADDI +1      ACC = 2
  //   3 LOAD  @5     ACC = DMEM[5] = 1   (so ACC drops 2 → 1)
  //   4 JMP 4        spin
  const ex = EXAMPLES['cpu3'].build();
  const alu = ex.comps.find(c => c.type === 'ALU');
  // imem_lo feeds ALU.b0 (oper0); imem_hi feeds ALU.b1 (oper1).
  const loId = ex.wires.find(z => z.toId === alu.id && z.toPort === 'b0').fromId;
  const hiId = ex.wires.find(z => z.toId === alu.id && z.toPort === 'b1').fromId;
  const imemLo = ex.comps.find(c => c.id === loId);
  const imemHi = ex.comps.find(c => c.id === hiId);
  imemLo.state.mem = [
    [0, 0, 1],   // 0: ADDI +1
    [1, 1, 1],   // 1: STORE  opL=+1,opH=+1, oper0=+1  → DMEM addr (1,0)=idx5
    [0, 0, 1],   // 2: ADDI +1
    [0, 1, 1],   // 3: LOAD   opL=0, opH=+1, oper0=+1  → DMEM addr (1,0)=idx5
    [0, -1, 0],  // 4: JMP    opL=0, opH=T,  oper0=0   → target (0,0)=word4 (self)
    [-1, -1, 0], [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],
  ];
  imemHi.state.mem = [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ];
  const acc = ex.comps.find(c => c.type === 'REG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    const seen = [];
    for (let i = 0; i < 24; i++) { stepSequential(); seen.push(tritsToInt(acc.state.q)); }
    assertEq(seen.includes(2), true, 'ACC reaches 2 (second ADDI, before LOAD):');
    assertEq(tritsToInt(acc.state.q), 1, 'LOAD restores ACC to the STORE-d value 1:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

// ---- full CPU3: all 9 ops incl. conditional jumps ----
test('CPU3-full runs the JMPP counter — ACC climbs 0,1,2,3 via a conditional jump', () => {
  const ex = EXAMPLES['cpu3-full'].build();
  const acc = ex.comps.find(c => c.type === 'REG3');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    assertEq(tritsToInt(acc.state.q), 0, 'ACC starts at 0:');
    const seen = [];
    for (let i = 0; i < 24; i++) { stepSequential(); seen.push(tritsToInt(acc.state.q)); }
    const progression = seen.filter((v, i) => i === 0 || v !== seen[i - 1]);
    assertEq(JSON.stringify(progression), JSON.stringify([0, 1, 2, 3]),
             'ACC climbs by 1 each loop — the JMPP branch is taken every lap:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('CPU3-full conditional jumps (JMPP / JMPZ) agree with CPU2', () => {
  // Run the same v2 program on the microcoded CPU3-full and on the
  // single-cycle CPU2 (whose JMPP/JMPZ are independently tested) and compare
  // the final ACC. Loading an image into either machine's two IMEM banks is
  // identical: imem_lo feeds ALU.b0, imem_hi feeds ALU.b1.
  const runV2 = (exName, res, steps) => {
    const ex = EXAMPLES[exName].build();
    const alu = ex.comps.find(c => c.type === 'ALU');
    const loId = ex.wires.find(z => z.toId === alu.id && z.toPort === 'b0').fromId;
    const hiId = ex.wires.find(z => z.toId === alu.id && z.toPort === 'b1').fromId;
    const lo = ex.comps.find(c => c.id === loId);
    const hi = ex.comps.find(c => c.id === hiId);
    lo.state.mem = res.mem_lo.map(x => x.slice()); lo.state.clkPrev = 0;
    hi.state.mem = res.mem_hi.map(x => x.slice()); hi.state.clkPrev = 0;
    const acc = ex.comps.find(c => c.type === 'REG3');
    const sC = comps, sW = wires, sO = outVals, sT = tick;
    try {
      setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
      syncCompMap(); simulate();
      for (let i = 0; i < steps; i++) stepSequential();
      return tritsToInt(acc.state.q);
    } finally {
      setComps(sC); setWires(sW); setOutVals(sO); setTick(sT); syncCompMap();
    }
  };
  const programs = [
    // JMPZ taken: ACC 0→1→0, JMPZ fires (ACC=0) → skip the ADDI, halt at 0.
    'ADDI 1\nADDI -1\nJMPZ done\nADDI 1\ndone: JMP done\n',
    // JMPP not taken: ACC 0→-1, JMPP not taken (ACC≤0) → ADDI 5 runs → 4, halt.
    'ADDI -1\nJMPP skip\nADDI 5\nskip: JMP skip\n',
  ];
  for (const src of programs) {
    const res = assembleV2(src);
    if (res.errors.length) throw new Error('assemble failed: ' + JSON.stringify(res.errors));
    const full = runV2('cpu3-full', res, 80);
    const cpu2 = runV2('cpu2', res, 80);
    assertEq(full, cpu2, `CPU3-full == CPU2 on "${src.split('\n')[0]}…":`);
  }
});

// ---- E5: read-only memory (ROM) ----
test('ROM reads its 6-trit word combinationally for every address', () => {
  // The rom-lookup preset stores x² of the signed address; sweep all nine
  // addresses and confirm the (combinational, clockless) read returns it.
  const ex = EXAMPLES['rom-lookup'].build();
  const a0 = ex.comps.find(c => c.state.name === 'a0');
  const a1 = ex.comps.find(c => c.state.name === 'a1');
  const rom = ex.comps.find(c => c.type === 'ROM');
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0); syncCompMap();
    for (let addr = -4; addr <= 4; addr++) {
      const [t0, t1] = intToTrits(addr, 2);
      a0.state.value = t0; a1.state.value = t1;
      simulate();
      const word = [0, 1, 2, 3, 4, 5].map(i => outVals[`${rom.id}:q${i}`] ?? 0);
      assertEq(tritsToInt(word), addr * addr, `ROM[addr=${addr}] = addr²:`);
    }
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
  }
});

test('RAM / ROM contents are hand-editable via inspector word fields', () => {
  // The in-canvas memory editor exposes one text field per word, parsed as a
  // trit string in PIN ORDER q0→q{n} (T/− = −1, 1/+ = +1, else 0; short pads,
  // long truncates). Lets a ROM/RAM be authored on the canvas, not only via a
  // preset / save / the assembler.
  const rom = { id: 1, type: 'ROM', x: 0, y: 0, state: TYPES.ROM.defaults() };
  const rf = TYPES.ROM.inspector(rom);
  assertEq(rf.length, 9, 'ROM exposes one field per word:');
  rf[3].set('T10+0x');   // +→+1, x→0  ⇒ q0..q5 = −1,1,0,1,0,0
  assertDeepEq(rom.state.mem[3], [-1, 1, 0, 1, 0, 0], 'parsed in pin order; bad chars → 0:');
  assertEq(rf[3].get(), 'T10100', 'formats back as T/0/1 in pin order:');
  rf[4].set('1');        // short string zero-pads the high pins
  assertDeepEq(rom.state.mem[4], [1, 0, 0, 0, 0, 0], 'short word zero-pads to width 6:');
  // The edited word reads back combinationally on the q outputs.
  assertEq(TYPES.ROM.eval(rom, { a0: -1, a1: -1 }).q0, rom.state.mem[0][0], 'eval reads mem[0]:');

  // RAM uses 3-trit words through the same editor.
  const ram = { id: 2, type: 'RAM', x: 0, y: 0, state: TYPES.RAM.defaults() };
  const ra = TYPES.RAM.inspector(ram);
  assertEq(ra.length, 9, 'RAM exposes one field per word:');
  ra[0].set('1T');       // width 3, zero-pads the high trit
  assertDeepEq(ram.state.mem[0], [1, -1, 0], 'RAM word parsed + zero-padded to width 3:');
});

test('Field-decoded microcode editor: control-store detection + word decode', () => {
  // Only a ROM wired as a UFIELDS control store (its q0 → UFIELDS.m_seq) gets
  // the field editor. In cpu3 that's the `ustore` ROM; the dispatch-map ROM and
  // a plain lookup ROM must NOT be detected.
  const ex = EXAMPLES['cpu3'].build();
  const scope = { comps: ex.comps, wires: ex.wires };
  const roms = ex.comps.filter(c => c.type === 'ROM');
  const stores = roms.filter(r => microcodeStoreUf(r.id, scope));
  assertEq(stores.length, 1, 'exactly one ROM is the control store:');
  const ustore = stores[0];
  const uf = microcodeStoreUf(ustore.id, scope);
  assertEq(uf.type, 'SUB:UFIELDS', 'detection returns the UFIELDS it feeds:');
  // The other ROM(s) in cpu3 (the dispatch map) are not control stores.
  for (const r of roms) {
    if (r === ustore) continue;
    assertEq(microcodeStoreUf(r.id, scope), null, 'dispatch-map ROM is not a control store:');
  }
  // A standalone lookup ROM is not a control store either.
  const lk = EXAMPLES['rom-lookup'].build();
  const lkRom = lk.comps.find(c => c.type === 'ROM');
  assertEq(microcodeStoreUf(lkRom.id, { comps: lk.comps, wires: lk.wires }), null,
           'lookup-table ROM is not a control store:');
  // Word decode: µ0 dispatches + holds; µ2 (ADDI) is FETCH/ADD/write/ALU.
  const d0 = decodeMicroWord(ustore.state.mem[0]);
  assertEq(d0.seq, 'DISP', 'µ0 seq = DISP:');
  assertEq(d0.pc,  'HOLD', 'µ0 pc = HOLD:');
  const d2 = decodeMicroWord(ustore.state.mem[2]);
  assertDeepEq([d2.seq, d2.alu, d2.accW, d2.accSrc, d2.pc],
               ['FETCH', 'ADD', 'write', 'ALU', 'ADV'], 'µ2 (ADDI) decodes correctly:');
});

// ---- E3 Phase 5: debugger µPC / microinstruction view ----
test('Debugger detects the CPU3 µPC + reads the live microinstruction', () => {
  const ex = EXAMPLES['cpu3'].build();
  const micro = findMicrocodeTargets({ comps: ex.comps, wires: ex.wires });
  assertEq(micro != null, true, 'CPU3 is detected as microcoded:');
  assertEq(micro.uf.type, 'SUB:UFIELDS', 'UFIELDS located:');
  // The µPC is the control-store PC, NOT the macro-PC. cpu3 places the
  // macro-PC at y=120 and the µPC at y=430.
  assertEq(micro.upc.y, 430, 'µPC is the control-store PC (not the macro-PC):');
  const macroPc = ex.comps.filter(c => c.type === 'PC').find(c => c.y === 120);
  assertEq(micro.upc.id !== macroPc.id, true, 'µPC is distinct from the macro-PC:');

  // CPU2 is single-cycle — no UFIELDS, so it is not detected as microcoded.
  const cpu2 = EXAMPLES['cpu2'].build();
  assertEq(findMicrocodeTargets({ comps: cpu2.comps, wires: cpu2.wires }), null,
           'CPU2 (single-cycle) is not microcoded:');

  // Live read: at reset the µPC sits on µ0, whose seqMode field is DISP (+1) —
  // exactly what the debugger's µcode line surfaces.
  const savedComps = comps, savedWires = wires, savedOutVals = outVals, savedTick = tick;
  try {
    setComps(ex.comps); setWires(ex.wires); setOutVals({}); setTick(0);
    syncCompMap(); simulate();
    assertEq(outVals[`${micro.uf.id}:seqMode`], 1, 'µ0 microinstruction is DISP:');
  } finally {
    setComps(savedComps); setWires(savedWires); setOutVals(savedOutVals); setTick(savedTick);
    syncCompMap();
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
test('I3 shareable circuits: encodeShare/decodeShare round-trips a circuit, URL-safe + gzipped', async () => {
  // A real preset, wrapped as a save object, must survive the link round-trip.
  const ex = EXAMPLES['bus-ports'].build();
  const data = { version: SAVE_FORMAT_VERSION, comps: ex.comps, wires: ex.wires,
                 view: { tx: 40, ty: 40, scale: 1 }, subcircuitDefs: {}, customGates: {} };
  const enc = await encodeShare(data);
  // base64url + a 1-char scheme prefix — only [A-Za-z0-9_-], so URL-hash-safe.
  assertEq(/^[A-Za-z0-9_-]+$/.test(enc), true, 'encoded form is URL-safe:');
  assertDeepEq(await decodeShare(enc), data, 'decode(encode(circuit)) is identity:');
  // A round-trip through upgradeSave (the real load path) is a no-op at current
  // version, so an encoded current circuit loads cleanly.
  assertDeepEq(upgradeSave(await decodeShare(enc)), data, 'decoded circuit migrates to a no-op:');
  // Non-ASCII (a user-named gate with symbols) survives the UTF-8 path.
  const u = { version: SAVE_FORMAT_VERSION, note: 'trit ≡ −1/0/+1 ✓', comps: [], wires: [] };
  assertDeepEq(await decodeShare(await encodeShare(u)), u, 'unicode survives the round-trip:');
  // gzip should actually shrink a repetitive circuit (scheme '1' = gzipped).
  assertEq(enc[0], '1', 'a real circuit encodes with the gzip scheme:');
  // A legacy un-prefixed raw-base64 link (pre-scheme format, ASCII JSON) must
  // still decode (back-compat). Such links begin with 'e' (base64 of '{'), never
  // '0'/'1', so the scheme sniff treats them as legacy.
  const ascii = { version: SAVE_FORMAT_VERSION, comps: [], wires: [] };
  const legacy = btoa(JSON.stringify(ascii)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assertDeepEq(await decodeShare(legacy), ascii, 'legacy un-prefixed base64 link still loads:');
});

// ---- B2 decompression-bomb guard -----------------------------------------
//
// Share links are public, untrusted input. A tiny gzipped payload can expand to
// hundreds of MB; decodeShare must cap the decompressed size and throw (the
// boot path turns that into the friendly "invalid link" toast) rather than OOM.
test('B2 decodeShare rejects an oversized (decompression-bomb) gzip payload', async () => {
  if (typeof CompressionStream !== 'function') return;   // env without gzip — nothing to cap
  // Valid JSON (would parse fine) but ~8 MB decompressed — well past the 4 MB cap.
  // Using real JSON, not garbage, proves the guard is the *size* cap and not an
  // incidental JSON.parse failure: without the cap this would decode cleanly.
  const huge = JSON.stringify({ comps: [], wires: [], pad: 'a'.repeat(8 * 1024 * 1024) });
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(huge)); w.close();
  const r = cs.readable.getReader();
  const parts = []; let n = 0;
  for (;;) { const { value, done } = await r.read(); if (done) break; parts.push(value); n += value.length; }
  const gz = new Uint8Array(n); let off = 0; for (const p of parts) { gz.set(p, off); off += p.length; }
  let bin = ''; for (let i = 0; i < gz.length; i++) bin += String.fromCharCode(gz[i]);   // avoid spread on large arrays
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let threw = false;
  try { await decodeShare('1' + b64url); } catch { threw = true; }
  assertEq(threw, true, 'an over-cap decompressed payload must throw, not expand:');
});

// ---- I1 front door — landing-page deep links -----------------------------
//
// The landing page (index.html) is the public front door; its "try this" cards
// deep-link into the app as `app.html?example=<name>`, resolved at boot by
// pickBootExample. Two contracts: the resolver only accepts known examples, and
// every example the landing page names actually exists.
test('I1 pickBootExample resolves only known ?example= names', () => {
  assertEq(pickBootExample('?example=min-max'), 'min-max', 'a real example resolves:');
  assertEq(pickBootExample('?foo=1&example=cpu2&bar=2'), 'cpu2', 'mid-query param resolves:');
  assertEq(pickBootExample('?example=min%2Dmax'), 'min-max', 'percent-encoding is decoded:');
  assertEq(pickBootExample(''), null, 'empty search → null:');
  assertEq(pickBootExample('?example='), null, 'blank value → null:');
  assertEq(pickBootExample('?example=does-not-exist'), null, 'unknown name → null:');
  assertEq(pickBootExample('?other=min-max'), null, 'a non-example param → null:');
});
test('I1 every landing-page "try this" example exists', () => {
  // Mirrors the entry points wired in index.html; keep in sync if the cards change.
  const entryPoints = ['min-max', 'half-adder', 'cpu2', 'ternary-mlp'];
  for (const name of entryPoints) {
    if (!EXAMPLES[name]) throw new Error(`landing page links a missing example: ${name}`);
    assertEq(pickBootExample('?example=' + name), name, `${name} resolves at boot:`);
  }
});

// ---- I4 embed mode -------------------------------------------------------
//
// `?embed=1` strips the editor chrome to a run-only iframe view; the circuit
// rides in the hash (`#c=…`) or query (`?c=…`), and the embed snippet / "Open in
// TritLogic" link are built from pure helpers.
test('I4 isEmbed recognises the embed flag', () => {
  assertEq(isEmbed('?embed=1'), true, 'embed=1:');
  assertEq(isEmbed('?embed'), true, 'bare embed:');
  assertEq(isEmbed('?a=1&embed=1&b=2'), true, 'mid-query embed:');
  assertEq(isEmbed('?embed=0'), false, 'embed=0 opts out:');
  assertEq(isEmbed('?embed=false'), false, 'embed=false opts out:');
  assertEq(isEmbed(''), false, 'no query:');
  assertEq(isEmbed('?example=cpu2'), false, 'unrelated param:');
  assertEq(isEmbed('?embedded=1'), false, 'a different param is not embed:');
});
test('I4 shareParamFrom reads the circuit from hash or query, hash wins', () => {
  assertEq(shareParamFrom('#c=ABC', ''), 'ABC', 'hash form:');
  assertEq(shareParamFrom('', '?c=XYZ'), 'XYZ', 'query form (embed snippet):');
  assertEq(shareParamFrom('#c=H', '?c=Q'), 'H', 'hash wins over query:');
  assertEq(shareParamFrom('#other=1', '?embed=1'), null, 'no circuit present:');
  assertEq(shareParamFrom('', ''), null, 'empty:');
});
test('I4 fullAppUrlFromEmbed points back at the full editor with the same circuit', () => {
  assertEq(fullAppUrlFromEmbed('?embed=1', '#c=ABC'), 'app.html#c=ABC', 'carries the shared circuit:');
  assertEq(fullAppUrlFromEmbed('?embed=1&c=QQ', ''), 'app.html#c=QQ', 'query-c becomes a hash link:');
  assertEq(fullAppUrlFromEmbed('?embed=1&example=min-max', ''), 'app.html?example=min-max', 'carries the example:');
  assertEq(fullAppUrlFromEmbed('?embed=1', ''), 'app.html', 'bare app when no circuit:');
});
test('I4 buildEmbedCode emits a valid iframe snippet that re-loads in embed mode', () => {
  const code = buildEmbedCode('https://tern-pi.vercel.app/app', '1ENC');
  assertEq(/^<iframe /.test(code) && /<\/iframe>$/.test(code), true, 'is an <iframe> element:');
  assertEq(code.includes('src="https://tern-pi.vercel.app/app?embed=1#c=1ENC"'), true, 'src loads embed + circuit:');
  // The src round-trips through the boot helpers: embed view + the same circuit.
  const m = code.match(/src="([^"]+)"/);
  const url = new URL(m[1]);
  assertEq(isEmbed(url.search), true, 'snippet URL is an embed view:');
  assertEq(shareParamFrom(url.hash, url.search), '1ENC', 'snippet URL carries the circuit:');
  // Custom dimensions are honoured.
  assertEq(buildEmbedCode('x', 'e', { width: 800, height: 300 }).includes('width="800" height="300"'), true, 'custom size:');
});

// ---- I2 guided tutorials -------------------------------------------------
//
// Each tutorial is an ordered list of steps with an instruction and optional
// check()/onEnter(api). These tests guard the data shape, that the picker only
// lists real tutorials, that every preset a step loads actually exists, and that
// no check() throws when handed an empty circuit.
test('I2 pickBootTutorial resolves only known ?tutorial= keys', () => {
  assertEq(pickBootTutorial('?tutorial=first-gate'), 'first-gate', 'a real lesson resolves:');
  assertEq(pickBootTutorial('?x=1&tutorial=run-cpu'), 'run-cpu', 'mid-query resolves:');
  assertEq(pickBootTutorial(''), null, 'empty:');
  assertEq(pickBootTutorial('?tutorial='), null, 'blank:');
  assertEq(pickBootTutorial('?tutorial=nope'), null, 'unknown key:');
});
test('I2 tutorials are well-formed and the picker lists only real ones', () => {
  for (const k in TUTORIALS) {
    const t = TUTORIALS[k];
    if (!t.name || !t.tagline) throw new Error(`${k}: missing name/tagline`);
    if (!Array.isArray(t.steps) || t.steps.length === 0) throw new Error(`${k}: no steps`);
    t.steps.forEach((s, i) => {
      if (typeof s.text !== 'string' || !s.text) throw new Error(`${k} step ${i}: no text`);
      if (s.check && typeof s.check !== 'function') throw new Error(`${k} step ${i}: check not a fn`);
      if (s.onEnter && typeof s.onEnter !== 'function') throw new Error(`${k} step ${i}: onEnter not a fn`);
    });
  }
  for (const [, keys] of TUTORIAL_LIST)
    for (const k of keys)
      if (!TUTORIALS[k]) throw new Error(`picker lists a missing tutorial: ${k}`);
});
test('I2 every example a tutorial loads exists, and no check throws on an empty circuit', () => {
  // Mock api: onEnter only calls loadExample/clearCanvas; record the loads.
  const loaded = [];
  const onEnterApi = { loadExample: (n) => loaded.push(n), clearCanvas: () => {} };
  // A defaults-only api so every check() returns a boolean without throwing.
  const emptyApi = {
    loadExample: () => {}, clearCanvas: () => {},
    countType: () => 0, firstType: () => null, byName: () => null,
    inVal: () => null, outVal: () => null, wireBetween: () => false, modalOpen: () => false,
  };
  for (const k in TUTORIALS) {
    for (const s of TUTORIALS[k].steps) {
      if (s.onEnter) s.onEnter(onEnterApi);
      if (s.check) {
        const r = s.check(emptyApi);
        if (typeof r !== 'boolean') throw new Error(`${k}: check did not return a boolean`);
      }
    }
  }
  for (const name of loaded)
    if (!EXAMPLES[name]) throw new Error(`a tutorial loads a missing example: ${name}`);
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

test('Cheaper undo: comp state is deep-copied; immutable defs survive shallow share', () => {
  // The cheaper-undo change shallow-copies the subcircuitDefs/customGates
  // containers (defs are immutable) but must still deep-copy mutable comp state.
  registerBuiltinSubcircuits();
  const savedComps = comps, savedWires = wires;
  const savedNextC = nextCompId, savedNextW = nextWireId;
  const savedUndo = undoStack.slice(), savedRedo = redoStack.slice();
  try {
    setComps([{ id: 1, type: 'RAM', x: 0, y: 0, state: { mem: [[0, 0, 0]], clkPrev: 0 } }]);
    setWires([]); setNextCompId(2); setNextWireId(1);
    syncCompMap(); undoStack.length = 0; redoStack.length = 0;
    // Snapshot, then mutate the RAM's stored word IN PLACE.
    pushHistory();
    comps[0].state.mem[0] = [1, 1, 1];
    // Undo must restore the pre-mutation word — proving state was deep-copied
    // into the snapshot, not shared by reference.
    undo();
    assertDeepEq(comps[0].state.mem[0], [0, 0, 0],
                 'in-place state mutation reverted by undo (state deep-copied):');
    // Built-in subcircuit defs survive undo/redo even though the snapshot only
    // shallow-copies the defs container (immutable, so safe to share).
    assertEq(!!subcircuitDefs['MAC3'], true, 'built-in def intact after undo:');
    redo();
    assertEq(comps[0].state.mem[0][0], 1, 'redo re-applies the mutation:');
    assertEq(!!subcircuitDefs['MAC3'], true, 'built-in def intact after redo:');
  } finally {
    setComps(savedComps); setWires(savedWires);
    setNextCompId(savedNextC); setNextWireId(savedNextW);
    syncCompMap();
    undoStack.length = 0; redoStack.length = 0;
    for (const s of savedUndo) undoStack.push(s);
    for (const s of savedRedo) redoStack.push(s);
  }
});

test('Duplicate selection clones comps + only the internal wires, remapped & offset', () => {
  const savedComps = comps, savedWires = wires;
  const savedNextC = nextCompId, savedNextW = nextWireId;
  const savedUndo = undoStack.slice(), savedRedo = redoStack.slice();
  try {
    // INPUT(1) → STI(2) → OUTPUT(3) selected; an external INPUT(4) → STI(2) wire
    // crosses the boundary and must NOT be duplicated.
    setComps([
      { id: 1, type: 'INPUT',  x: 0,   y: 0,  state: { value: 1, name: 'a' } },
      { id: 2, type: 'STI',    x: 80,  y: 0,  state: {} },
      { id: 3, type: 'OUTPUT', x: 160, y: 0,  state: { name: 'y' } },
      { id: 4, type: 'INPUT',  x: 0,   y: 80, state: { value: 0, name: 'b' } },
    ]);
    setWires([
      { id: 1, fromId: 1, fromPort: 'out', toId: 2, toPort: 'in' },   // internal
      { id: 2, fromId: 2, fromPort: 'out', toId: 3, toPort: 'in' },   // internal
      { id: 3, fromId: 4, fromPort: 'out', toId: 2, toPort: 'in' },   // boundary
    ]);
    setNextCompId(5); setNextWireId(4);
    syncCompMap();
    selection.clear(); selection.add(1); selection.add(2); selection.add(3);
    undoStack.length = 0; redoStack.length = 0;

    duplicateSelection();

    assertEq(comps.length, 7, 'three of four comps duplicated:');
    assertEq(wires.length, 5, 'two internal wires duplicated, boundary one skipped:');
    assertEq(selection.size, 3, 'the copies become the new selection:');
    // Both new wires must connect two duplicated (selected) comps, not originals.
    for (const w of wires.filter(w => w.id > 3)) {
      assertEq(selection.has(w.fromId) && selection.has(w.toId), true,
               'new wire is remapped to the duplicated comps:');
    }
    // Offset applied + snapped (orig INPUT x=0 → +20).
    const dupIn = comps.find(c => c.id > 4 && c.type === 'INPUT');
    assertEq(dupIn.x, 20, 'clone offset by +20:');
    // Undo removes the whole duplicate group.
    undo();
    assertEq(comps.length, 4, 'undo removes the duplicated comps:');
    assertEq(wires.length, 3, 'undo removes the duplicated wires:');
  } finally {
    setComps(savedComps); setWires(savedWires);
    setNextCompId(savedNextC); setNextWireId(savedNextW);
    syncCompMap(); selection.clear();
    undoStack.length = 0; redoStack.length = 0;
    for (const s of savedUndo) undoStack.push(s);
    for (const s of savedRedo) redoStack.push(s);
  }
});

test('Arrow-nudge moves the selection and coalesces a run into one undo entry', () => {
  const savedComps = comps, savedWires = wires;
  const savedNextC = nextCompId, savedNextW = nextWireId;
  const savedUndo = undoStack.slice(), savedRedo = redoStack.slice();
  try {
    setComps([{ id: 1, type: 'STI', x: 50, y: 50, state: {} },
              { id: 2, type: 'STI', x: 100, y: 50, state: {} }]);
    setWires([]); setNextCompId(3); setNextWireId(1); syncCompMap();
    selection.clear(); selection.add(1); selection.add(2);
    undoStack.length = 0; redoStack.length = 0;
    // Three nudges in one run (no keyup between them) move both comps and add
    // exactly ONE undo entry (the run is coalesced; _nudgeRun starts false).
    const c1 = () => comps.find(c => c.id === 1);
    const c2 = () => comps.find(c => c.id === 2);
    nudgeSelection(10, 0);
    nudgeSelection(10, 0);
    nudgeSelection(0, 10);
    assertEq(c1().x, 70, 'comp 1 moved +20 in x:');
    assertEq(c1().y, 60, 'comp 1 moved +10 in y:');
    assertEq(c2().x, 120, 'comp 2 moved with the group:');
    assertEq(undoStack.length, 1, 'the whole nudge run is a single undo entry:');
    undo();
    assertEq(c1().x, 50, 'undo reverts the run (x):');
    assertEq(c1().y, 50, 'undo reverts the run (y):');
  } finally {
    setComps(savedComps); setWires(savedWires);
    setNextCompId(savedNextC); setNextWireId(savedNextW);
    syncCompMap(); selection.clear();
    undoStack.length = 0; redoStack.length = 0;
    for (const s of savedUndo) undoStack.push(s);
    for (const s of savedRedo) redoStack.push(s);
  }
});

// ---- B4: wire labels ------------------------------------------------------
//
// A wire can carry an optional `label` (a user-typed net name set in the
// inspector, drawn at the wire's midpoint). It is a purely additive field on
// the wire object, so it must (a) survive the JSON save/load round-trip — save
// serializes the whole wires array verbatim — (b) survive undo/redo's deep
// clone, and (c) be ignored by the simulator (the engine keys only on
// from/to ids + ports). This guards all three.
test('Wire label is additive — survives save round-trip + undo/redo, ignored by sim', () => {
  const savedComps = comps, savedWires = wires;
  const savedNextC = nextCompId, savedNextW = nextWireId;
  const savedUndo = undoStack.slice(), savedRedo = redoStack.slice();
  try {
    setComps([]); setWires([]); setNextCompId(1); setNextWireId(1);
    syncCompMap(); undoStack.length = 0; redoStack.length = 0;
    comps.push({ id: setNextCompId(nextCompId + 1), type: 'INPUT', x: 0, y: 0, state: { value: 1 } });
    comps.push({ id: setNextCompId(nextCompId + 1), type: 'STI', x: 0, y: 80, state: {} });
    syncCompMap();
    wires.push({ id: setNextWireId(nextWireId + 1), fromId: 1, fromPort: 'out',
                 toId: 2, toPort: 'in', label: 'clk' });
    // (a) Save serializes the whole wire object via JSON — the label must survive.
    const roundTrip = JSON.parse(JSON.stringify({ wires }));
    assertEq(roundTrip.wires[0].label, 'clk', 'label survives JSON save/load:');
    // (c) The simulator keys on ids/ports only — the label must not break eval,
    // and the wire must still carry the INPUT's value to the STI.
    simulate();
    assertEq(outVals['1:out'], 1, 'labelled wire still propagates its source value:');
    // (b) Undo/redo deep-clone the whole state — the label must survive that too.
    pushHistory();
    wires[0].label = 'reset';
    undo();
    assertEq(wires[0].label, 'clk', 'undo restores the previous label:');
    redo();
    assertEq(wires[0].label, 'reset', 'redo reapplies the new label:');
  } finally {
    setComps(savedComps); setWires(savedWires);
    setNextCompId(savedNextC); setNextWireId(savedNextW);
    setOutVals({}); syncCompMap();
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

// ---- F1: ternary logic minimizer ------------------------------------------
//
// The non-negotiable invariant: a minimized expression must reproduce its
// source truth table on EVERY input. We check that across a battery of named
// functions and a deterministic pseudo-random sweep, then separately confirm
// the minimizer never costs more gates than the naive canonical form and that
// it genuinely shrinks a mergeable function.

// Build a table { "a,b,..": out } from a function over combos.
function tableFromFn(n, fn) {
  const t = {};
  const rec = (prefix) => {
    if (prefix.length === n) { t[prefix.join(',')] = fn(prefix); return; }
    for (const v of [-1, 0, 1]) rec([...prefix, v]);
  };
  rec([]);
  return t;
}
function eachCombo(n, visit) {
  const rec = (prefix) => {
    if (prefix.length === n) { visit(prefix); return; }
    for (const v of [-1, 0, 1]) rec([...prefix, v]);
  };
  rec([]);
}
// Assert a minimized table round-trips on every input.
function assertMinimizes(n, table, label) {
  const expr = minimizeTernary(table, n);
  eachCombo(n, (c) => {
    const want = table[c.join(',')] ?? 0;
    const got = evalMinimizedExpr(expr, c);
    if (got !== want) {
      throw new Error(`${label} f(${c.join(',')}): expected ${want}, minimized gives ${got}`);
    }
  });
  // The minimized form must never be more expensive than the canonical baseline.
  const before = canonicalGateCount(table, n), after = minimizedGateCount(expr);
  if (after > before) {
    throw new Error(`${label}: minimized ${after} gates > canonical ${before}`);
  }
  return expr;
}

test('Minimizer reproduces every named ternary function exactly', () => {
  // 1-input: the three inverters + identity.
  assertMinimizes(1, tableFromFn(1, ([a]) => -a || 0), 'STI');
  assertMinimizes(1, tableFromFn(1, ([a]) => (a === 1 ? -1 : 1)), 'PTI');
  assertMinimizes(1, tableFromFn(1, ([a]) => (a === -1 ? 1 : -1)), 'NTI');
  assertMinimizes(1, tableFromFn(1, ([a]) => a), 'identity');
  // 2-input: MIN, MAX, ADD-without-carry (sum trit), equality.
  assertMinimizes(2, tableFromFn(2, ([a, b]) => Math.min(a, b)), 'MIN');
  assertMinimizes(2, tableFromFn(2, ([a, b]) => Math.max(a, b)), 'MAX');
  assertMinimizes(2, tableFromFn(2, ([a, b]) => { const s = a + b; return s === 0 ? 0 : s > 0 ? (s > 1 ? -1 : 1) : (s < -1 ? 1 : -1); }), 'sumTrit');
  assertMinimizes(2, tableFromFn(2, ([a, b]) => (a === b ? 1 : -1)), 'equals');
  // 3-input: full-adder sum trit (a+b+c reduced to its low trit).
  const sumTrit = (s) => { let r = ((s % 3) + 3) % 3; return r === 2 ? -1 : r; };
  assertMinimizes(3, tableFromFn(3, ([a, b, c]) => sumTrit(a + b + c)), 'adderSum');
  // Constants.
  for (const k of [-1, 0, 1]) assertMinimizes(2, tableFromFn(2, () => k), `const${k}`);
});

test('Minimizer reproduces pseudo-random truth tables (n = 1..3)', () => {
  // Deterministic LCG so the test is stable.
  let seed = 0x1234abcd;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 1; n <= 3; n++) {
    for (let trial = 0; trial < 12; trial++) {
      const table = tableFromFn(n, () => [-1, 0, 1][Math.floor(rnd() * 3)]);
      assertMinimizes(n, table, `rand n=${n} #${trial}`);
    }
  }
});

test('Minimizer shrinks a mergeable function and trivialises constants', () => {
  // f(a,b) = +1 whenever a = +1 (any b), else T. Canonically that is three
  // 2-literal minterms; minimized it should collapse to the single literal
  // "a = +1" (b is don't-care) — far fewer gates.
  const table = tableFromFn(2, ([a]) => (a === 1 ? 1 : -1));
  const expr = assertMinimizes(2, table, 'a==+1');
  assertEq(expr.terms.length, 1, 'one product term after merge:');
  assertEq(expr.terms[0].sets[1].length, 3, 'input b folded to a don\'t-care:');
  assertEq(minimizedGateCount(expr) < canonicalGateCount(table, 2), true,
           'minimized uses strictly fewer gates than canonical:');
  // A constant function is a single capless/literalless term.
  const c1 = minimizeTernary(tableFromFn(2, () => 1), 2);
  assertEq(c1.terms.length, 1, 'constant +1 ⇒ one term:');
  assertEq(c1.terms[0].sets.every(s => s.length === 3), true, 'all inputs don\'t-care:');
  assertEq(minimizedGateCount(c1), 0, 'constant ⇒ zero gates:');
  // Constant T (all −1) ⇒ no terms at all.
  const cT = minimizeTernary(tableFromFn(2, () => -1), 2);
  assertEq(cT.terms.length, 0, 'constant T ⇒ empty expression:');
});

test('Minimizer materializes a subcircuit that reproduces the table (F1 Phase 2)', () => {
  // "Compile a custom gate to gates": materializeMinimized builds a real
  // subcircuit of MIN/MAX/STI/PTI/NTI primitives; simulated as a SUB instance it
  // must reproduce the source table on every input — the same invariant the
  // algebraic minimizer satisfies, now through actual placed-and-wired gates.
  const sumTrit = (s) => { const r = ((s % 3) + 3) % 3; return r === 2 ? -1 : r; };
  const cases = [
    { n: 1, fn: ([a]) => -a || 0,                     label: 'STI' },
    { n: 2, fn: ([a, b]) => Math.min(a, b),           label: 'MIN' },
    { n: 2, fn: ([a, b]) => Math.max(a, b),           label: 'MAX' },
    { n: 2, fn: ([a, b]) => (a === b ? 1 : -1),       label: 'equals' },
    { n: 2, fn: ([a, b]) => (a === 1 ? 1 : (b === -1 ? 0 : -1)), label: 'mixed-cap' },
    { n: 3, fn: ([a, b, c]) => sumTrit(a + b + c),    label: 'adderSum' },
    { n: 2, fn: () => 1,  label: 'const+1' },
    { n: 2, fn: () => 0,  label: 'const0'  },
    { n: 2, fn: () => -1, label: 'constT'  },
  ];
  for (const { n, fn, label } of cases) {
    const table = tableFromFn(n, fn);
    const inNames = Array.from({ length: n }, (_, i) => 'abc'[i]);
    const def = materializeMinimized(table, n, inNames, 'out');
    assertEq(def.inputs.length, n, `${label}: ${n} input pins:`);
    assertEq(def.outputs.length, 1, `${label}: one output pin:`);
    subcircuitDefs['_MatTest'] = def;
    eachCombo(n, (combo) => {
      const vIn = {};
      inNames.forEach((name, i) => { vIn[name] = combo[i]; });
      // Fresh instance per combo so a cached subScope never carries state over.
      const out = simulateSubInstance({ type: 'SUB:_MatTest', state: {} }, vIn);
      const want = table[combo.join(',')] ?? 0;
      assertEq(out.out, want, `${label} f(${combo.join(',')}):`);
    });
    delete subcircuitDefs['_MatTest'];
  }
});

// Async so individual tests may be async (e.g. the gzip share round-trip).
// `await t.fn()` is transparent for the sync tests — awaiting a non-promise is a
// no-op, and a synchronous throw still propagates into the catch.
async function runAllTests() {
  const results = [];
  for (const t of TESTS) {
    try { await t.fn(); results.push({ name: t.name, pass: true }); }
    catch (e) { results.push({ name: t.name, pass: false, error: e.message }); }
  }
  return results;
}

  return { TESTS, runAllTests };
}
