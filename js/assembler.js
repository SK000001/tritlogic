// ============================================================================
//  ASSEMBLER (Phase 8 — ternary ISA, plus the wider v2 ISA from ISA_v2.md)
// ============================================================================
//
//  Text-to-trit assemblers for the two CPU ISAs:
//    - assemble()   — original 3-op ISA (ADDI / MAXI / JMP)
//    - assembleV2() — v2 ISA (9 opcodes, 6-trit words across two RAM blocks)
//
//  Both depend only on intToTrits / tritsToInt from util.js — no DOM, no
//  state. The decodeImemWord* functions invert each encoding for use by the
//  debugger and self-tests.

import { intToTrits, tritsToInt } from './util.js';

export const ASM_OPCODES = {
  ADDI: { opTrit:  0, operandKind: 'imm'  },
  MAXI: { opTrit:  1, operandKind: 'imm'  },
  JMP:  { opTrit: -1, operandKind: 'addr' },
};
export const ASM_PROGRAM_WORDS = 9;

export function assemble(text) {
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

// ---- v2 assembler -- ISA v2 (see tritlogic/ISA_v2.md) -------------------
//
// The v2 ISA widens the opcode to 2 trits (9 op codepoints) and the
// instruction word to 6 trits, packed across two parallel RAM blocks.
// The assembler accepts ALL 9 mnemonics; in Phase A only 5 of them
// (NOP/ADDI/MAXI/MINI/JMP) actually do anything on CPU2 — the others
// assemble but their datapath wiring lands in phases B / C.
//
//   mem_lo[i] = [opL, opH, oper0]
//   mem_hi[i] = [oper1, oper2, oper3]
//
export const ASM2_OPCODES = {
  NOP:   { opH: -1, opL: -1, kind: 'none' },
  JMP:   { opH: -1, opL:  0, kind: 'addr' },
  JMPP:  { opH: -1, opL:  1, kind: 'addr' },
  JMPZ:  { opH:  0, opL: -1, kind: 'addr' },
  ADDI:  { opH:  0, opL:  0, kind: 'imm'  },
  MAXI:  { opH:  0, opL:  1, kind: 'imm'  },
  MINI:  { opH:  1, opL: -1, kind: 'imm'  },
  LOAD:  { opH:  1, opL:  0, kind: 'addr' },
  STORE: { opH:  1, opL:  1, kind: 'addr' },
};
export const ASM2_IMM_RANGE  = 40;   // 4-trit balanced range
export const ASM2_ADDR_RANGE = 8;

export function assembleV2(text) {
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
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
      errors.push({ line: i + 1, msg: `program exceeds ${ASM_PROGRAM_WORDS} words` });
      continue;
    }
    // v2 allows NOP with no operand — match that first.
    const mNoOp = s.match(/^([A-Za-z]+)\s*$/);
    if (mNoOp) {
      stmts.push({ srcLine: i + 1, mnem: mNoOp[1].toUpperCase(), operand: null });
      pc++;
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
  const mem_lo = Array.from({ length: ASM_PROGRAM_WORDS }, () => [0, 0, 0]);
  const mem_hi = Array.from({ length: ASM_PROGRAM_WORDS }, () => [0, 0, 0]);
  for (let idx = 0; idx < stmts.length; idx++) {
    const st = stmts[idx];
    const op = ASM2_OPCODES[st.mnem];
    if (!op) {
      errors.push({ line: st.srcLine, msg: `unknown mnemonic "${st.mnem}" — v2 ops: ${Object.keys(ASM2_OPCODES).join(' / ')}` });
      continue;
    }
    let oper = [0, 0, 0, 0];
    if (op.kind === 'none') {
      if (st.operand != null && st.operand !== '') {
        errors.push({ line: st.srcLine, msg: `${st.mnem} takes no operand` });
        continue;
      }
    } else if (op.kind === 'imm') {
      const n = Number(st.operand);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        errors.push({ line: st.srcLine, msg: `expected integer operand, got: ${st.operand}` });
        continue;
      }
      if (n < -ASM2_IMM_RANGE || n > ASM2_IMM_RANGE) {
        errors.push({ line: st.srcLine, msg: `${st.mnem} immediate ${n} out of range −${ASM2_IMM_RANGE}..+${ASM2_IMM_RANGE} (4-trit operand)` });
        continue;
      }
      oper = intToTrits(n, 4);
    } else if (op.kind === 'addr') {
      let value;
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
      if (value < 0 || value > ASM2_ADDR_RANGE) {
        errors.push({ line: st.srcLine, msg: `${st.mnem} address ${value} out of range 0..${ASM2_ADDR_RANGE}` });
        continue;
      }
      // PC stores p where tritsToInt(p) + 4 = word index. oper2/oper3 zero.
      const tr = intToTrits(value - 4, 2);
      oper = [tr[0], tr[1], 0, 0];
    }
    mem_lo[idx] = [op.opL, op.opH, oper[0]];
    mem_hi[idx] = [oper[1], oper[2], oper[3]];
  }
  const addrToLine = Array.from({ length: ASM_PROGRAM_WORDS }, () => null);
  for (let i = 0; i < stmts.length; i++) addrToLine[i] = stmts[i].srcLine;
  return { errors, mem_lo, mem_hi, labels, words: stmts.length, addrToLine };
}

// Decode one v2 instruction word (a pair of 3-trit RAM rows) back to its
// mnemonic string. Inverse of the assembler's per-statement encoder; shared
// by the debugger panel and the tests so the two can't drift.
export function decodeImemWordV2(word_lo, word_hi) {
  if (!word_lo || !word_hi) return '?';
  const opL = word_lo[0], opH = word_lo[1];
  if (opL == null || opH == null) return '?';
  const name = Object.keys(ASM2_OPCODES).find(k =>
    ASM2_OPCODES[k].opH === opH && ASM2_OPCODES[k].opL === opL);
  if (!name) return '?';
  const op = ASM2_OPCODES[name];
  if (op.kind === 'none') return name;
  const oper = [word_lo[2], word_hi[0], word_hi[1], word_hi[2]];
  if (op.kind === 'imm') {
    const v = tritsToInt(oper);
    return `${name} ${v >= 0 ? '+' : ''}${v}`;
  }
  // addr — first two trits encode (addr − 4); ignore oper2/oper3.
  const addr = tritsToInt([oper[0], oper[1]]) + 4;
  return `${name} ${addr}`;
}

// A small library of pre-written v2 programs.
export const ASM2_EXAMPLES = {
  'counter2': {
    label: 'Counter v2 — ADDI +1 / JMP LOOP (CPU2 default)',
    src:
`; Same semantics as the v1 counter, encoded in v2's wider format.
LOOP:
  ADDI +1
  JMP  LOOP
`,
  },
  'mini-demo': {
    label: 'MINI demo — bounce ACC between +3 and -3 via MAXI/MINI',
    src:
`; MAXI then MINI clamps ACC. ADDI keeps trying to push it up.
LOOP:
  ADDI +1
  MAXI -3
  MINI +3
  JMP  LOOP
`,
  },
  'nop-padding': {
    label: 'NOP padding — three NOPs then increment',
    src:
`LOOP:
  NOP
  NOP
  NOP
  ADDI +1
  JMP  LOOP
`,
  },
};

// A small library of pre-written programs the modal's example dropdown
// surfaces. Each is a string of assembly text.
export const ASM_EXAMPLES = {
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

// ---- decoders -----------------------------------------------------------

export function decodeImemWord(word) {
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
