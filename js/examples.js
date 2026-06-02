// ============================================================================
//  EXAMPLES — preset circuits surfaced in the toolbar's Load-Example dropdown
// ============================================================================
//
//  Each entry has a `label` (UI string) and a `build()` factory that returns
//  { comps, wires }. The factory closes over `buildExample` (the id-assigning
//  helper from app.js) and, for a handful of presets, over the subcircuit
//  builders from app.js. Those are injected at module-init via a factory
//  pattern so this file stays import-cycle-free.
//
//  A few presets seed their own subcircuits into the global `subcircuitDefs`
//  object before referencing them by name — that's also injected.

export function createExamples({
  buildExample,
  buildTmulDef, buildMac3Def, buildActDef,
  buildTsumDef, buildDecode2Def, buildAccSignDef, buildMseqDef, buildUfieldsDef,
  buildMpcseqDef,
  subcircuitDefs,
}) {
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
  'tristate-bus': {
    label: 'Tri-state bus (two drivers share one wire)',
    build: () => buildExample((c, w) => ({
      comps: [
        c('da', 'INPUT',  100, 110, { value: 1,  name: 'da' }),
        c('ea', 'INPUT',  100, 168, { value: 1,  name: 'enA' }),
        c('db', 'INPUT',  100, 250, { value: -1, name: 'db' }),
        c('eb', 'INPUT',  100, 308, { value: 0,  name: 'enB' }),
        c('ta', 'TRIBUF', 290, 120),
        c('tb', 'TRIBUF', 290, 268),
        c('y',  'OUTPUT', 480, 196, { name: 'bus' }),
      ],
      // Both buffer outputs drive the one probe input — the shared bus. enA=1,
      // enB=0 ⇒ bus shows da (=1). Toggle enA off ⇒ bus floats (Z); turn both
      // on with da≠db ⇒ contention (X).
      wires: [
        w('da', 'out', 'ta', 'in'),
        w('ea', 'out', 'ta', 'en'),
        w('db', 'out', 'tb', 'in'),
        w('eb', 'out', 'tb', 'en'),
        w('ta', 'out', 'y', 'in'),
        w('tb', 'out', 'y', 'in'),
      ],
    })),
  },
  'regfile-bus': {
    label: 'Tri-state register file (one-hot read onto a shared bus)',
    build: () => buildExample((c, w) => ({
      // A two-entry, 3-trit register-file read port. Two REG3s pre-seeded with
      // distinct values each drive the shared 3-trit read bus through a column
      // of TRIBUFs gated by a per-register read-enable. Asserting exactly one
      // read-enable (one-hot) selects which register's value appears on the
      // bus0..bus2 probes; asserting none floats the bus (Z); asserting both
      // (with differing trits) is contention (X). The d/clk/ld ports are left
      // unconnected — the registers simply hold their seeded contents, so the
      // demo is purely about the read side. Scales to N registers by adding
      // more rows; the bus resolution is unchanged.
      comps: [
        // One-hot read-enable lines (default: R0 selected).
        c('rd0', 'INPUT', 80, 120, { value: 1, name: 'rdR0' }),
        c('rd1', 'INPUT', 80, 360, { value: 0, name: 'rdR1' }),
        // Two registers, pre-seeded with distinct 3-trit values.
        c('r0', 'REG3', 220,  80, { q: [ 1, -1,  0] }),
        c('r1', 'REG3', 220, 320, { q: [-1,  0,  1] }),
        // R0's read-port column: one TRIBUF per trit, all gated by rdR0.
        c('a0', 'TRIBUF', 430,  70),
        c('a1', 'TRIBUF', 430, 130),
        c('a2', 'TRIBUF', 430, 190),
        // R1's read-port column, gated by rdR1.
        c('b0', 'TRIBUF', 430, 310),
        c('b1', 'TRIBUF', 430, 370),
        c('b2', 'TRIBUF', 430, 430),
        // The shared bus: each line driven by both registers' trit-i buffers.
        c('y0', 'OUTPUT', 650, 150, { name: 'bus0' }),
        c('y1', 'OUTPUT', 650, 250, { name: 'bus1' }),
        c('y2', 'OUTPUT', 650, 350, { name: 'bus2' }),
      ],
      wires: [
        // R0 trits → its buffers; rdR0 → each buffer's enable.
        w('r0', 'q0', 'a0', 'in'), w('r0', 'q1', 'a1', 'in'), w('r0', 'q2', 'a2', 'in'),
        w('rd0', 'out', 'a0', 'en'), w('rd0', 'out', 'a1', 'en'), w('rd0', 'out', 'a2', 'en'),
        // R1 trits → its buffers; rdR1 → each buffer's enable.
        w('r1', 'q0', 'b0', 'in'), w('r1', 'q1', 'b1', 'in'), w('r1', 'q2', 'b2', 'in'),
        w('rd1', 'out', 'b0', 'en'), w('rd1', 'out', 'b1', 'en'), w('rd1', 'out', 'b2', 'en'),
        // Both registers' trit-i buffers share bus line i.
        w('a0', 'out', 'y0', 'in'), w('b0', 'out', 'y0', 'in'),
        w('a1', 'out', 'y1', 'in'), w('b1', 'out', 'y1', 'in'),
        w('a2', 'out', 'y2', 'in'), w('b2', 'out', 'y2', 'in'),
      ],
    })),
  },
  'word-bus': {
    label: 'Word bus (merge 3 trits → one wire → split)',
    build: () => buildExample((c, w) => ({
      // Three trit inputs (a low-first word) are MERGEd onto a single bus wire,
      // carried as one violet labelled wire, then SPLIT back into three trits.
      // Edit the inputs and watch the bus label (balanced-ternary + decimal)
      // follow. The point of C1: a datapath word travels as one wire, not three.
      comps: [
        c('i0', 'INPUT',  90, 110, { value:  1, name: 't0 (low)' }),
        c('i1', 'INPUT',  90, 190, { value: -1, name: 't1' }),
        c('i2', 'INPUT',  90, 270, { value:  1, name: 't2 (high)' }),
        c('m',  'MERGE3', 270, 150),
        c('s',  'SPLIT3', 480, 150),
        c('o0', 'OUTPUT', 660, 110, { name: 'o0' }),
        c('o1', 'OUTPUT', 660, 190, { name: 'o1' }),
        c('o2', 'OUTPUT', 660, 270, { name: 'o2' }),
      ],
      wires: [
        w('i0', 'out', 'm', 't0'), w('i1', 'out', 'm', 't1'), w('i2', 'out', 'm', 't2'),
        w('m', 'bus', 's', 'bus'),
        w('s', 't0', 'o0', 'in'), w('s', 't1', 'o1', 'in'), w('s', 't2', 'o2', 'in'),
      ],
    })),
  },
  'regfile-wordbus': {
    label: 'Register file (word bus — one wire instead of six)',
    build: () => buildExample((c, w) => ({
      // The same two-entry, 3-trit register-file read port as `regfile-bus`,
      // but each register's word is MERGEd to a bus and driven onto a single
      // shared bus wire through a TRIBUF3, gated by a one-hot read-enable.
      // Asserting one enable puts that register's word on the bus; none floats
      // it (Z); both (differing words) is contention (X). A SPLIT3 recovers the
      // trits at the destination. Six tri-state wires collapse to one.
      comps: [
        c('rd0', 'INPUT', 70, 110, { value: 1, name: 'rdR0' }),
        c('rd1', 'INPUT', 70, 330, { value: 0, name: 'rdR1' }),
        c('r0', 'REG3', 200,  70, { q: [ 1, -1,  0] }),
        c('r1', 'REG3', 200, 300, { q: [-1,  0,  1] }),
        c('m0', 'MERGE3', 360,  80),
        c('m1', 'MERGE3', 360, 310),
        c('g0', 'TRIBUF3', 470, 110),
        c('g1', 'TRIBUF3', 470, 340),
        c('s',  'SPLIT3', 620, 200),
        c('o0', 'OUTPUT', 770, 160, { name: 'bus0' }),
        c('o1', 'OUTPUT', 770, 220, { name: 'bus1' }),
        c('o2', 'OUTPUT', 770, 280, { name: 'bus2' }),
      ],
      wires: [
        // R0 word → MERGE → TRIBUF3 (gated by rdR0).
        w('r0', 'q0', 'm0', 't0'), w('r0', 'q1', 'm0', 't1'), w('r0', 'q2', 'm0', 't2'),
        w('m0', 'bus', 'g0', 'in'), w('rd0', 'out', 'g0', 'en'),
        // R1 word → MERGE → TRIBUF3 (gated by rdR1).
        w('r1', 'q0', 'm1', 't0'), w('r1', 'q1', 'm1', 't1'), w('r1', 'q2', 'm1', 't2'),
        w('m1', 'bus', 'g1', 'in'), w('rd1', 'out', 'g1', 'en'),
        // Both buffers share ONE bus wire into the splitter.
        w('g0', 'out', 's', 'bus'), w('g1', 'out', 's', 'bus'),
        w('s', 't0', 'o0', 'in'), w('s', 't1', 'o1', 'in'), w('s', 't2', 'o2', 'in'),
      ],
    })),
  },
  'tryte-bus': {
    label: 'Tryte bus (6-trit word on one wire)',
    build: () => buildExample((c, w) => ({
      // A whole tryte (6 trits, ±364) travels as ONE bus wire: a TRYTE_IN's six
      // trit pins are MERGEd onto the bus, carried as a single violet labelled
      // wire, then SPLIT back into a TRYTE_OUT. Edit the source's decimal /
      // balanced-ternary value and watch the bus label + the readout follow.
      comps: [
        c('in', 'TRYTE_IN',  90, 150, { value: 215 }),
        c('m',  'MERGE6',    260, 140),
        c('s',  'SPLIT6',    470, 140),
        c('out', 'TRYTE_OUT', 640, 150),
      ],
      wires: [
        w('in', 't0', 'm', 't0'), w('in', 't1', 'm', 't1'), w('in', 't2', 'm', 't2'),
        w('in', 't3', 'm', 't3'), w('in', 't4', 'm', 't4'), w('in', 't5', 'm', 't5'),
        w('m', 'bus', 's', 'bus'),
        w('s', 't0', 'out', 't0'), w('s', 't1', 'out', 't1'), w('s', 't2', 'out', 't2'),
        w('s', 't3', 'out', 't3'), w('s', 't4', 'out', 't4'), w('s', 't5', 'out', 't5'),
      ],
    })),
  },
  'bus-datapath': {
    label: 'Bus datapath — accumulator loop on word wires',
    build: () => buildExample((c, w) => ({
      // A word travels as ONE wire end-to-end through a compute loop. Press
      // Play (or Step): each rising clock edge the accumulator REG3 reloads
      // with acc + 1. The accumulator's value rides a single bus wire into the
      // ALU (watch its violet label count up), the ALU's sum rides another bus
      // wire back into the register — so the whole datapath is two labelled
      // word wires instead of six parallel trit wires.
      comps: [
        c('clk', 'CLOCK', 60, 360, { value: -1, mode: 'bi' }),
        c('ld',  'CONST', 60, 140, { value: 1 }),       // load-enable held high
        c('acc', 'REG3',  180, 120, { q: [0, 0, 0] }),
        c('ma',  'MERGE3', 340, 140),                   // acc value → bus
        c('sa',  'SPLIT3', 470, 140),                   // bus → ALU operand A
        c('cb0', 'CONST', 470, 300, { value: 1 }),      // operand B = +1 word
        c('cb1', 'CONST', 470, 350, { value: 0 }),
        c('cb2', 'CONST', 470, 400, { value: 0 }),
        c('op',  'CONST', 470, 450, { value: 0 }),       // op 0 = ADD
        c('alu', 'ALU',   620, 220),
        c('mr',  'MERGE3', 810, 250),                   // ALU sum → bus
        c('sd',  'SPLIT3', 940, 250),                   // bus → acc.d (feedback)
        c('o0',  'OUTPUT', 200, 300, { name: 'acc0' }),
        c('o1',  'OUTPUT', 270, 300, { name: 'acc1' }),
        c('o2',  'OUTPUT', 340, 300, { name: 'acc2' }),
      ],
      wires: [
        w('ld', 'out', 'acc', 'ld'), w('clk', 'out', 'acc', 'clk'),
        // acc value bundled onto a bus into the ALU's A operand.
        w('acc', 'q0', 'ma', 't0'), w('acc', 'q1', 'ma', 't1'), w('acc', 'q2', 'ma', 't2'),
        w('ma', 'bus', 'sa', 'bus'),
        w('sa', 't0', 'alu', 'a0'), w('sa', 't1', 'alu', 'a1'), w('sa', 't2', 'alu', 'a2'),
        // ALU B = constant +1, op = ADD.
        w('cb0', 'out', 'alu', 'b0'), w('cb1', 'out', 'alu', 'b1'), w('cb2', 'out', 'alu', 'b2'),
        w('op', 'out', 'alu', 'op'),
        // ALU sum bundled onto a bus, fed back into the register's data port.
        w('alu', 'r0', 'mr', 't0'), w('alu', 'r1', 'mr', 't1'), w('alu', 'r2', 'mr', 't2'),
        w('mr', 'bus', 'sd', 'bus'),
        w('sd', 't0', 'acc', 'd0'), w('sd', 't1', 'acc', 'd1'), w('sd', 't2', 'acc', 'd2'),
        // Readout taps the live accumulator.
        w('acc', 'q0', 'o0', 'in'), w('acc', 'q1', 'o1', 'in'), w('acc', 'q2', 'o2', 'in'),
      ],
    })),
  },
  'microcode-seq': {
    label: 'Microcode sequencer (µPC walks a control store)',
    build: () => {
      if (!subcircuitDefs['MSEQ']) subcircuitDefs['MSEQ'] = buildMseqDef();
      return buildExample((c, w) => ({
        // E3 Phase 1 (see MICROCODE.md). A horizontal-microcode control unit
        // running "dry": a PC acts as the µPC, a RAM is the control store
        // (µROM), and the MSEQ subcircuit picks the next µPC from each
        // microinstruction's 1-trit seqMode field (q0). The microprogram is
        // CONT,CONT,CONT,FETCH, so the µPC walks 0,1,2,3 then resets to 0 and
        // loops — a control sequence cycling on its own. q1/q2 are demo control
        // bits (ctrlA/ctrlB) that pulse through a fixed pattern each cycle.
        //   µword = [seqMode, ctrlA, ctrlB]   (seqMode: 0=CONT, +1=DISP, T=FETCH)
        comps: [
          c('clk',  'CLOCK',    40, 380, { value: -1, mode: 'bi' }),
          // Seed the µPC at µword 0 — PC encodes word index as tritsToInt(p)+4,
          // so p=(T,T) is word 0 (its default p=(0,0) would start at word 4).
          c('upc',  'PC',       190, 320, { p: [-1, -1] }),
          c('urom', 'RAM',      370, 170, { mem: [
            [0,  1,  0],   // µ0: CONT, ctrlA=+1
            [0,  0,  1],   // µ1: CONT, ctrlB=+1
            [0, -1, -1],   // µ2: CONT, ctrlA=ctrlB=T
            [-1, 0,  0],   // µ3: FETCH → µPC back to 0
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          c('zero', 'CONST',    370, 470, { value: 0 }),
          c('mseq', 'SUB:MSEQ', 620, 300),
          c('oA',   'OUTPUT',   860, 180, { name: 'ctrlA' }),
          c('oB',   'OUTPUT',   860, 240, { name: 'ctrlB' }),
          c('op0',  'OUTPUT',   860, 320, { name: 'uPC0' }),
          c('op1',  'OUTPUT',   860, 380, { name: 'uPC1' }),
          c('wA',   'WAVE',     860, 460, { name: 'ctrlA', trace: [] }),
        ],
        wires: [
          w('clk', 'out', 'upc', 'clk'), w('clk', 'out', 'urom', 'clk'),
          // µPC addresses the control store.
          w('upc', 'p0', 'urom', 'a0'), w('upc', 'p1', 'urom', 'a1'),
          // Control store is read-only.
          w('zero', 'out', 'urom', 'we'),
          w('zero', 'out', 'urom', 'd0'), w('zero', 'out', 'urom', 'd1'), w('zero', 'out', 'urom', 'd2'),
          // seqMode field → microsequencer; no dispatch in this demo (disp = 0).
          w('urom', 'q0', 'mseq', 'seqMode'),
          w('zero', 'out', 'mseq', 'disp0'), w('zero', 'out', 'mseq', 'disp1'),
          // Microsequencer drives the µPC.
          w('mseq', 'jmp', 'upc', 'jmp'), w('mseq', 'j0', 'upc', 'j0'), w('mseq', 'j1', 'upc', 'j1'),
          // Readouts: the two control bits + the µPC address.
          w('urom', 'q1', 'oA', 'in'), w('urom', 'q2', 'oB', 'in'),
          w('upc', 'p0', 'op0', 'in'), w('upc', 'p1', 'op1', 'in'),
          w('urom', 'q1', 'wA', 'in'),
        ],
      }));
    },
  },
  'microcode-fields': {
    label: 'Microcode control store (µword → named control lines)',
    build: () => {
      if (!subcircuitDefs['MSEQ'])    subcircuitDefs['MSEQ']    = buildMseqDef();
      if (!subcircuitDefs['UFIELDS']) subcircuitDefs['UFIELDS'] = buildUfieldsDef();
      return buildExample((c, w) => ({
        // E3 Phase 2 (see MICROCODE.md). The control store is now TWO parallel
        // RAM banks holding a horizontal 6-trit microinstruction per µword;
        // UFIELDS taps them into named control lines. The µPC (PC) + MSEQ walk
        // a 4-µword microprogram (CONT,CONT,CONT,FETCH) and the control lines
        // aluOp / accWrite / memWrite / memRead change per µstep — the control
        // unit "running dry" (no datapath yet; that's Phase 4).
        //   µword = [m_seq, m_alu, m_accW] (lo) + [m_accSrc, m_mem, m_pc] (hi)
        //   m_mem: T=none, 0=read, +1=write  (decoded to memWrite/memRead)
        comps: [
          c('clk',   'CLOCK',       40, 470, { value: -1, mode: 'bi' }),
          c('upc',   'PC',          180, 410, { p: [-1, -1] }),   // start at µword 0
          c('romLo', 'RAM',         360, 120, { mem: [
            [0,  0,  1],   // µ0: seq=CONT, alu=ADD,  accW=+1
            [0,  1,  0],   // µ1: seq=CONT, alu=MAX,  accW=0
            [0, -1,  1],   // µ2: seq=CONT, alu=MIN,  accW=+1
            [-1, 0,  0],   // µ3: seq=FETCH
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          c('romHi', 'RAM',         360, 470, { mem: [
            [0,  0,  0],   // µ0: accSrc=0, mem=read,  pc=0
            [0,  1,  0],   // µ1: accSrc=0, mem=write, pc=0
            [1, -1,  1],   // µ2: accSrc=+1, mem=none, pc=+1
            [0,  0,  0],   // µ3
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          c('zero',  'CONST',       360, 770, { value: 0 }),
          c('uf',    'SUB:UFIELDS', 620, 230),
          c('mseq',  'SUB:MSEQ',    620, 470),
          c('oAlu',  'OUTPUT',      900, 150, { name: 'aluOp' }),
          c('oAccW', 'OUTPUT',      900, 210, { name: 'accWrite' }),
          c('oMemW', 'OUTPUT',      900, 270, { name: 'memWrite' }),
          c('oMemR', 'OUTPUT',      900, 330, { name: 'memRead' }),
          c('op0',   'OUTPUT',      900, 410, { name: 'uPC0' }),
          c('op1',   'OUTPUT',      900, 470, { name: 'uPC1' }),
          c('wW',    'WAVE',        900, 560, { name: 'memWrite', trace: [] }),
        ],
        wires: [
          w('clk', 'out', 'upc', 'clk'), w('clk', 'out', 'romLo', 'clk'), w('clk', 'out', 'romHi', 'clk'),
          // µPC addresses both control-store banks.
          w('upc', 'p0', 'romLo', 'a0'), w('upc', 'p1', 'romLo', 'a1'),
          w('upc', 'p0', 'romHi', 'a0'), w('upc', 'p1', 'romHi', 'a1'),
          // Read-only control store.
          w('zero', 'out', 'romLo', 'we'), w('zero', 'out', 'romLo', 'd0'), w('zero', 'out', 'romLo', 'd1'), w('zero', 'out', 'romLo', 'd2'),
          w('zero', 'out', 'romHi', 'we'), w('zero', 'out', 'romHi', 'd0'), w('zero', 'out', 'romHi', 'd1'), w('zero', 'out', 'romHi', 'd2'),
          // µword trits → UFIELDS.
          w('romLo', 'q0', 'uf', 'm_seq'), w('romLo', 'q1', 'uf', 'm_alu'), w('romLo', 'q2', 'uf', 'm_accW'),
          w('romHi', 'q0', 'uf', 'm_accSrc'), w('romHi', 'q1', 'uf', 'm_mem'), w('romHi', 'q2', 'uf', 'm_pc'),
          // seqMode field → microsequencer → µPC (no dispatch in this demo).
          w('uf', 'seqMode', 'mseq', 'seqMode'),
          w('zero', 'out', 'mseq', 'disp0'), w('zero', 'out', 'mseq', 'disp1'),
          w('mseq', 'jmp', 'upc', 'jmp'), w('mseq', 'j0', 'upc', 'j0'), w('mseq', 'j1', 'upc', 'j1'),
          // Named control lines → readouts.
          w('uf', 'aluOp', 'oAlu', 'in'), w('uf', 'accWrite', 'oAccW', 'in'),
          w('uf', 'memWrite', 'oMemW', 'in'), w('uf', 'memRead', 'oMemR', 'in'),
          w('upc', 'p0', 'op0', 'in'), w('upc', 'p1', 'op1', 'in'),
          w('uf', 'memWrite', 'wW', 'in'),
        ],
      }));
    },
  },
  'microcode-dispatch': {
    label: 'Microcode dispatch (macro-op → microroutine, multi-cycle)',
    build: () => {
      if (!subcircuitDefs['MSEQ'])    subcircuitDefs['MSEQ']    = buildMseqDef();
      if (!subcircuitDefs['UFIELDS']) subcircuitDefs['UFIELDS'] = buildUfieldsDef();
      return buildExample((c, w) => ({
        // E3 Phase 3 (see MICROCODE.md). The fetch→dispatch→routine→FETCH loop:
        // a macro-PC walks IMEM, each macro-op DISPATCHES the µPC to its
        // microroutine, the routine runs one µword per clock, and a FETCH µword
        // sends the µPC back to µ0 (the shared dispatch word) for the next op.
        // No datapath yet — this proves the *control flow* is multi-cycle.
        //
        //   ┌── macro side ──┐        ┌──────── micro side ────────┐
        //   mPC → IMEM(op) → dispatch ROM → MSEQ.disp ─┐
        //                                              ▼
        //                       µPC → control store → UFIELDS → MSEQ → µPC
        //
        // The DISPATCH MAP is a 9-word mapping ROM addressed by the opcode
        // (a0=opL, a1=opH → word = opL+3·opH+4, one slot per v2 opcode), each
        // slot holding the routine-entry µaddr in q0/q1. µ0 is the shared
        // fetch/dispatch word: seqMode=DISP routes MSEQ to the dispatch addr and
        // pcCtl=ADV bumps the macro-PC; routine µwords set pcCtl=HOLD so the
        // macro-PC freezes mid-instruction (the PC "holds" by reloading itself —
        // pcCtl→jmp, j0/j1←its own p0/p1). Last routine µword is seqMode=FETCH.
        //
        // Two-op micro-ISA: ADDI = 1 µword routine (µ1), LOAD = 2 µwords (µ2,µ3).
        // Macro-program: ADDI, LOAD, ADDI, LOAD, then NOPs.
        //   µword = [m_seq,m_alu,m_accW] (lo) + [m_accSrc,m_mem,m_pc] (hi)
        //   m_pc (pcCtl): 0 = advance macro-PC, +1 = hold (self-reload)
        comps: [
          c('clk',    'CLOCK',       40, 560, { value: -1, mode: 'bi' }),
          // --- macro side ---
          c('mpc',    'PC',          180, 80,  { p: [-1, -1] }),   // macro-PC at word 0
          c('imemLo', 'RAM',         360, 40,  { mem: [
            [0, 0, 0],   // 0: ADDI (opL=0)
            [0, 0, 0],   // 1: LOAD (opL=0)
            [0, 0, 0],   // 2: ADDI
            [0, 0, 0],   // 3: LOAD
            [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0],   // NOP (opL=T)
          ] }),
          c('imemHi', 'RAM',         360, 220, { mem: [
            [0, 0, 0],   // 0: ADDI (opH=0)
            [1, 0, 0],   // 1: LOAD (opH=+1)
            [0, 0, 0],   // 2: ADDI
            [1, 0, 0],   // 3: LOAD
            [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0],   // NOP (opH=T)
          ] }),
          // Dispatch map: opcode (a0=opL, a1=opH) → routine-entry µaddr in q0/q1.
          c('dmap',   'RAM',         620, 130, { mem: [
            [0, 0, 0],    // 0 NOP  → µ4 (p=[0,0])
            [-1, -1, 0],  // 1 JMP  → µ0 (unused)
            [-1, -1, 0],  // 2 JMPP → µ0 (unused)
            [-1, -1, 0],  // 3 JMPZ → µ0 (unused)
            [0, -1, 0],   // 4 ADDI → µ1 (p=[0,T])
            [-1, -1, 0],  // 5 MAXI → µ0 (unused)
            [-1, -1, 0],  // 6 MINI → µ0 (unused)
            [1, -1, 0],   // 7 LOAD → µ2 (p=[+1,T])
            [-1, -1, 0],  // 8 STORE→ µ0 (unused)
          ] }),
          // --- micro side ---
          c('upc',    'PC',          180, 380, { p: [-1, -1] }),   // µPC at µword 0
          c('romLo',  'RAM',         360, 380, { mem: [
            [1, 0, 0],    // µ0: DISP            (fetch/dispatch word)
            [-1, 0, 0],   // µ1: FETCH           (ADDI routine, 1 µword)
            [0, 0, 0],    // µ2: CONT            (LOAD routine, step 1)
            [-1, 0, 0],   // µ3: FETCH           (LOAD routine, step 2)
            [-1, 0, 0],   // µ4: FETCH           (NOP routine)
            [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0],
          ] }),
          c('romHi',  'RAM',         360, 560, { mem: [
            [0, -1, 0],   // µ0: pcCtl=ADV  (advance macro-PC on dispatch)
            [0, -1, 1],   // µ1: pcCtl=HOLD
            [0, -1, 1],   // µ2: pcCtl=HOLD
            [0, -1, 1],   // µ3: pcCtl=HOLD
            [0, -1, 1],   // µ4: pcCtl=HOLD
            [0, -1, 1], [0, -1, 1], [0, -1, 1], [0, -1, 1],
          ] }),
          c('zero',   'CONST',       360, 760, { value: 0 }),
          c('uf',     'SUB:UFIELDS', 620, 360),
          c('mseq',   'SUB:MSEQ',    620, 560),
          // --- readouts ---
          c('oOpL',   'OUTPUT',      900, 60,  { name: 'opL' }),
          c('oOpH',   'OUTPUT',      900, 120, { name: 'opH' }),
          c('oMpc0',  'OUTPUT',      900, 180, { name: 'mPC0' }),
          c('oMpc1',  'OUTPUT',      900, 240, { name: 'mPC1' }),
          c('oUpc0',  'OUTPUT',      900, 320, { name: 'uPC0' }),
          c('oUpc1',  'OUTPUT',      900, 380, { name: 'uPC1' }),
          c('oSeq',   'OUTPUT',      900, 440, { name: 'seqMode' }),
          c('oPc',    'OUTPUT',      900, 500, { name: 'pcCtl' }),
          c('wU',     'WAVE',        900, 580, { name: 'uPC0', trace: [] }),
        ],
        wires: [
          // Clock fans out to every sequential element.
          w('clk', 'out', 'mpc', 'clk'),
          w('clk', 'out', 'imemLo', 'clk'), w('clk', 'out', 'imemHi', 'clk'),
          w('clk', 'out', 'dmap', 'clk'),
          w('clk', 'out', 'upc', 'clk'),
          w('clk', 'out', 'romLo', 'clk'), w('clk', 'out', 'romHi', 'clk'),
          // Macro-PC addresses IMEM (both banks).
          w('mpc', 'p0', 'imemLo', 'a0'), w('mpc', 'p1', 'imemLo', 'a1'),
          w('mpc', 'p0', 'imemHi', 'a0'), w('mpc', 'p1', 'imemHi', 'a1'),
          // Read-only IMEM.
          w('zero', 'out', 'imemLo', 'we'), w('zero', 'out', 'imemLo', 'd0'), w('zero', 'out', 'imemLo', 'd1'), w('zero', 'out', 'imemLo', 'd2'),
          w('zero', 'out', 'imemHi', 'we'), w('zero', 'out', 'imemHi', 'd0'), w('zero', 'out', 'imemHi', 'd1'), w('zero', 'out', 'imemHi', 'd2'),
          // Opcode (opL=imemLo.q0, opH=imemHi.q0) addresses the dispatch ROM.
          w('imemLo', 'q0', 'dmap', 'a0'), w('imemHi', 'q0', 'dmap', 'a1'),
          // Read-only dispatch ROM.
          w('zero', 'out', 'dmap', 'we'), w('zero', 'out', 'dmap', 'd0'), w('zero', 'out', 'dmap', 'd1'), w('zero', 'out', 'dmap', 'd2'),
          // µPC addresses the two-bank control store.
          w('upc', 'p0', 'romLo', 'a0'), w('upc', 'p1', 'romLo', 'a1'),
          w('upc', 'p0', 'romHi', 'a0'), w('upc', 'p1', 'romHi', 'a1'),
          // Read-only control store.
          w('zero', 'out', 'romLo', 'we'), w('zero', 'out', 'romLo', 'd0'), w('zero', 'out', 'romLo', 'd1'), w('zero', 'out', 'romLo', 'd2'),
          w('zero', 'out', 'romHi', 'we'), w('zero', 'out', 'romHi', 'd0'), w('zero', 'out', 'romHi', 'd1'), w('zero', 'out', 'romHi', 'd2'),
          // µword trits → UFIELDS.
          w('romLo', 'q0', 'uf', 'm_seq'), w('romLo', 'q1', 'uf', 'm_alu'), w('romLo', 'q2', 'uf', 'm_accW'),
          w('romHi', 'q0', 'uf', 'm_accSrc'), w('romHi', 'q1', 'uf', 'm_mem'), w('romHi', 'q2', 'uf', 'm_pc'),
          // Microsequencer: seqMode from UFIELDS, dispatch addr from the map.
          w('uf', 'seqMode', 'mseq', 'seqMode'),
          w('dmap', 'q0', 'mseq', 'disp0'), w('dmap', 'q1', 'mseq', 'disp1'),
          w('mseq', 'jmp', 'upc', 'jmp'), w('mseq', 'j0', 'upc', 'j0'), w('mseq', 'j1', 'upc', 'j1'),
          // Macro-PC control: pcCtl=0 advances (jmp=0), pcCtl=+1 holds by
          // reloading the PC's own address (jmp=+1, j0/j1 ← p0/p1).
          w('uf', 'pcCtl', 'mpc', 'jmp'),
          w('mpc', 'p0', 'mpc', 'j0'), w('mpc', 'p1', 'mpc', 'j1'),
          // Readouts.
          w('imemLo', 'q0', 'oOpL', 'in'), w('imemHi', 'q0', 'oOpH', 'in'),
          w('mpc', 'p0', 'oMpc0', 'in'), w('mpc', 'p1', 'oMpc1', 'in'),
          w('upc', 'p0', 'oUpc0', 'in'), w('upc', 'p1', 'oUpc1', 'in'),
          w('uf', 'seqMode', 'oSeq', 'in'), w('uf', 'pcCtl', 'oPc', 'in'),
          w('upc', 'p0', 'wU', 'in'),
        ],
      }));
    },
  },
  'cpu3': {
    label: 'CPU3 — microcoded processor (microengine drives the datapath)',
    build: () => {
      if (!subcircuitDefs['MSEQ'])    subcircuitDefs['MSEQ']    = buildMseqDef();
      if (!subcircuitDefs['UFIELDS']) subcircuitDefs['UFIELDS'] = buildUfieldsDef();
      if (!subcircuitDefs['MPCSEQ'])  subcircuitDefs['MPCSEQ']  = buildMpcseqDef();
      return buildExample((c, w) => ({
        // E3 Phase 4 (see MICROCODE.md). The microcoded counterpart of CPU2:
        // the same ACC / ALU / DMEM datapath and the same v2 instruction words,
        // but the single-cycle DECODE2 + combinational control is replaced by a
        // MICROENGINE. Each macro-op now runs a multi-cycle MICROROUTINE.
        //
        //   macro side                         micro side (the control unit)
        //   ──────────                         ─────────────────────────────
        //   mPC → IMEM(lo,hi) → opcode         µPC → control store(romLo,romHi)
        //          │  │            │                   → UFIELDS → control lines
        //          │  │            ▼                        │ seqMode → MSEQ → µPC
        //          │  │     dispatch ROM ─ entry µaddr ─────┘ disp
        //          │  └── operand → ALU.b / DMEM.addr / jump target
        //          ▼
        //   datapath: ALU(ACC, operand) → accSrc MUX(ALU | DMEM) → ACC ; DMEM
        //   mPC steered by MPCSEQ from the pcCtl field (ADV / HOLD / JMP).
        //
        // CONTROL FLOW: µ0 is the shared fetch/dispatch word — seqMode=DISP
        // sends the µPC to the opcode's routine, pcCtl=HOLD keeps the macro-PC
        // on the current instruction (so its operand stays valid all through the
        // routine). The routine's last µword does the work AND advances: pcCtl=
        // ADV (next instruction) or JMP (load the operand as target), seqMode=
        // FETCH (µPC back to µ0). Microprogram (9 µwords, fits the 9×3 store):
        //   µ0 dispatch · µ1 NOP · µ2 ADDI · µ3 MAXI · µ4 MINI · µ5 JMP
        //   µ6 LOAD · µ7 STORE · µ8 spare. (JMPP/JMPZ deferred — they need a
        //   conditional sequencer + the µword budget is full; see MICROCODE.md.)
        //
        // The default program is the v2 COUNTER (identical to CPU2's): word 0
        // ADDI +1, word 1 JMP 0. Press Play — ACC climbs 0,1,2,3,… exactly like
        // CPU2, just taking two clocks per instruction (dispatch + execute).
        comps: [
          c('clk',    'CLOCK',       40, 760, { value: -1, mode: 'bi' }),
          // ---- macro side ----
          c('mpc',    'PC',          170, 120, { p: [-1, -1] }),
          c('imem_lo', 'RAM',        340,  60, { mem: [
            [0, 0,  1],   // word 0: ADDI +1   (opL=0,opH=0, oper0=+1)
            [0, -1, -1],  // word 1: JMP  0    (opL=0,opH=T, oper0=T)
            [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],
            [-1, -1, 0], [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],   // NOP padding
          ] }),
          c('imem_hi', 'RAM',        340, 250, { mem: [
            [0, 0, 0],    // word 0
            [-1, 0, 0],   // word 1: oper1=T  → jump target = (oper0,oper1)=(T,T)=word 0
            [0, 0, 0], [0, 0, 0], [0, 0, 0],
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          // Dispatch ROM: opcode (a0=opL, a1=opH) → routine entry µaddr in q0/q1.
          c('dmap',   'RAM',         560, 120, { mem: [
            [0, -1, 0],   // 0 NOP  → µ1
            [1, 0, 0],    // 1 JMP  → µ5
            [0, -1, 0],   // 2 JMPP → µ1 (deferred)
            [0, -1, 0],   // 3 JMPZ → µ1 (deferred)
            [1, -1, 0],   // 4 ADDI → µ2
            [-1, 0, 0],   // 5 MAXI → µ3
            [0, 0, 0],    // 6 MINI → µ4
            [-1, 1, 0],   // 7 LOAD → µ6
            [0, 1, 0],    // 8 STORE→ µ7
          ] }),
          // ---- micro side ----
          c('upc',    'PC',          170, 430, { p: [-1, -1] }),
          c('romLo',  'RAM',         340, 430, { mem: [
            [1, 0, 0],    // µ0: DISP
            [-1, 0, 0],   // µ1: NOP   (FETCH)
            [-1, 0, 1],   // µ2: ADDI  (FETCH, ADD, accW)
            [-1, 1, 1],   // µ3: MAXI  (FETCH, MAX, accW)
            [-1, -1, 1],  // µ4: MINI  (FETCH, MIN, accW)
            [-1, 0, 0],   // µ5: JMP   (FETCH)
            [-1, 0, 1],   // µ6: LOAD  (FETCH, accW)
            [-1, 0, 0],   // µ7: STORE (FETCH)
            [-1, 0, 0],   // µ8: spare (FETCH)
          ] }),
          c('romHi',  'RAM',         340, 620, { mem: [
            [0, -1, 1],   // µ0: accSrc dc, mem none, pcCtl=HOLD
            [0, -1, 0],   // µ1: pcCtl=ADV
            [0, -1, 0],   // µ2: accSrc=ALU, mem none, pcCtl=ADV
            [0, -1, 0],   // µ3: ADV
            [0, -1, 0],   // µ4: ADV
            [0, -1, -1],  // µ5: pcCtl=JMP
            [1, 0, 0],    // µ6: accSrc=DMEM, mem=read, pcCtl=ADV
            [0, 1, 0],    // µ7: mem=write, pcCtl=ADV
            [0, -1, 0],   // µ8: ADV
          ] }),
          c('zero',   'CONST',       340, 880, { value: 0 }),
          c('uf',     'SUB:UFIELDS', 560, 470),
          c('mseq',   'SUB:MSEQ',    560, 700),
          c('mpcseq', 'SUB:MPCSEQ',  560, 860),
          // ---- datapath ----
          c('alu',    'ALU',         820, 160),
          c('accSrc0', 'MUX',        1020, 120),
          c('accSrc1', 'MUX',        1020, 240),
          c('accSrc2', 'MUX',        1020, 360),
          c('acc',    'REG3',        1200, 200),
          c('dmem',   'RAM',         820, 460),
          // ---- readouts ----
          c('oA0', 'OUTPUT', 1380, 200, { name: 'ACC0' }),
          c('oA1', 'OUTPUT', 1380, 240, { name: 'ACC1' }),
          c('oA2', 'OUTPUT', 1380, 280, { name: 'ACC2' }),
          c('wclk', 'WAVE',  40,  860, { name: 'clk',  trace: [] }),
          c('wacc', 'WAVE',  1380, 360, { name: 'ACC0', trace: [] }),
        ],
        wires: [
          // Clock distribution.
          w('clk', 'out', 'mpc', 'clk'),
          w('clk', 'out', 'imem_lo', 'clk'), w('clk', 'out', 'imem_hi', 'clk'),
          w('clk', 'out', 'dmap', 'clk'),
          w('clk', 'out', 'upc', 'clk'),
          w('clk', 'out', 'romLo', 'clk'), w('clk', 'out', 'romHi', 'clk'),
          w('clk', 'out', 'acc', 'clk'), w('clk', 'out', 'dmem', 'clk'),
          // Macro-PC addresses IMEM (both banks).
          w('mpc', 'p0', 'imem_lo', 'a0'), w('mpc', 'p1', 'imem_lo', 'a1'),
          w('mpc', 'p0', 'imem_hi', 'a0'), w('mpc', 'p1', 'imem_hi', 'a1'),
          w('zero', 'out', 'imem_lo', 'we'), w('zero', 'out', 'imem_lo', 'd0'), w('zero', 'out', 'imem_lo', 'd1'), w('zero', 'out', 'imem_lo', 'd2'),
          w('zero', 'out', 'imem_hi', 'we'), w('zero', 'out', 'imem_hi', 'd0'), w('zero', 'out', 'imem_hi', 'd1'), w('zero', 'out', 'imem_hi', 'd2'),
          // Opcode (opL=imem_lo.q0, opH=imem_lo.q1) addresses the dispatch ROM.
          w('imem_lo', 'q0', 'dmap', 'a0'), w('imem_lo', 'q1', 'dmap', 'a1'),
          w('zero', 'out', 'dmap', 'we'), w('zero', 'out', 'dmap', 'd0'), w('zero', 'out', 'dmap', 'd1'), w('zero', 'out', 'dmap', 'd2'),
          // µPC addresses the two-bank control store.
          w('upc', 'p0', 'romLo', 'a0'), w('upc', 'p1', 'romLo', 'a1'),
          w('upc', 'p0', 'romHi', 'a0'), w('upc', 'p1', 'romHi', 'a1'),
          w('zero', 'out', 'romLo', 'we'), w('zero', 'out', 'romLo', 'd0'), w('zero', 'out', 'romLo', 'd1'), w('zero', 'out', 'romLo', 'd2'),
          w('zero', 'out', 'romHi', 'we'), w('zero', 'out', 'romHi', 'd0'), w('zero', 'out', 'romHi', 'd1'), w('zero', 'out', 'romHi', 'd2'),
          // µword → UFIELDS.
          w('romLo', 'q0', 'uf', 'm_seq'), w('romLo', 'q1', 'uf', 'm_alu'), w('romLo', 'q2', 'uf', 'm_accW'),
          w('romHi', 'q0', 'uf', 'm_accSrc'), w('romHi', 'q1', 'uf', 'm_mem'), w('romHi', 'q2', 'uf', 'm_pc'),
          // Microsequencer: seqMode from UFIELDS, dispatch addr from the map.
          w('uf', 'seqMode', 'mseq', 'seqMode'),
          w('dmap', 'q0', 'mseq', 'disp0'), w('dmap', 'q1', 'mseq', 'disp1'),
          w('mseq', 'jmp', 'upc', 'jmp'), w('mseq', 'j0', 'upc', 'j0'), w('mseq', 'j1', 'upc', 'j1'),
          // Macro-PC sequencer: pcCtl + self-feedback + jump target (operand).
          w('uf', 'pcCtl', 'mpcseq', 'pcCtl'),
          w('mpc', 'p0', 'mpcseq', 'p0'), w('mpc', 'p1', 'mpcseq', 'p1'),
          w('imem_lo', 'q2', 'mpcseq', 't0'), w('imem_hi', 'q0', 'mpcseq', 't1'),
          w('mpcseq', 'jmp', 'mpc', 'jmp'), w('mpcseq', 'j0', 'mpc', 'j0'), w('mpcseq', 'j1', 'mpc', 'j1'),
          // ALU: a = ACC, b = operand[0..2], op = aluOp field.
          w('acc', 'q0', 'alu', 'a0'), w('acc', 'q1', 'alu', 'a1'), w('acc', 'q2', 'alu', 'a2'),
          w('imem_lo', 'q2', 'alu', 'b0'), w('imem_hi', 'q0', 'alu', 'b1'), w('imem_hi', 'q1', 'alu', 'b2'),
          w('uf', 'aluOp', 'alu', 'op'),
          // ACC data source MUX: accSrc=0 → ALU result (d0/dT), +1 → DMEM read (dP).
          w('uf', 'accSrc', 'accSrc0', 's'), w('uf', 'accSrc', 'accSrc1', 's'), w('uf', 'accSrc', 'accSrc2', 's'),
          w('alu', 'r0', 'accSrc0', 'd0'), w('alu', 'r1', 'accSrc1', 'd0'), w('alu', 'r2', 'accSrc2', 'd0'),
          w('alu', 'r0', 'accSrc0', 'dT'), w('alu', 'r1', 'accSrc1', 'dT'), w('alu', 'r2', 'accSrc2', 'dT'),
          w('dmem', 'q0', 'accSrc0', 'dP'), w('dmem', 'q1', 'accSrc1', 'dP'), w('dmem', 'q2', 'accSrc2', 'dP'),
          w('accSrc0', 'out', 'acc', 'd0'), w('accSrc1', 'out', 'acc', 'd1'), w('accSrc2', 'out', 'acc', 'd2'),
          // ACC write enable = accWrite field.
          w('uf', 'accWrite', 'acc', 'ld'),
          // DMEM: address = operand[0..1], data = ACC, we = memWrite field.
          w('imem_lo', 'q2', 'dmem', 'a0'), w('imem_hi', 'q0', 'dmem', 'a1'),
          w('acc', 'q0', 'dmem', 'd0'), w('acc', 'q1', 'dmem', 'd1'), w('acc', 'q2', 'dmem', 'd2'),
          w('uf', 'memWrite', 'dmem', 'we'),
          // Readouts.
          w('acc', 'q0', 'oA0', 'in'), w('acc', 'q1', 'oA1', 'in'), w('acc', 'q2', 'oA2', 'in'),
          w('clk', 'out', 'wclk', 'in'), w('acc', 'q0', 'wacc', 'in'),
        ],
      }));
    },
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
  'cpu-structural': {
    label: 'CPU (structural) — ALU3 / TPC / TREG3, gate-level compute path',
    build: () => {
      // Ensure every Sequential / Arithmetic Kit subcircuit this preset
      // touches is registered before the build runs.
      if (!subcircuitDefs['ALU3'])  subcircuitDefs['ALU3']  = buildAlu3Def();
      if (!subcircuitDefs['TPC'])   subcircuitDefs['TPC']   = buildTpcDef();
      if (!subcircuitDefs['TREG3']) subcircuitDefs['TREG3'] = buildTreg3Def();
      return buildExample((c, w) => ({
        // The Phase 7 datapath rebuilt with the Sequential / Arithmetic Kit
        // structural twins for every block on the *compute path* — `TPC`
        // for the program counter, `ALU3` for the ALU, `TREG3` for the
        // accumulator. Drill into any of them (middle-click in the palette
        // or double-click on the canvas) to see the gate-level reality:
        // TPC → TFLOP → TLATCH → cross-coupled MIN/MAX feedback; ALU3 →
        // FADD → TSUM → MUX3 → MIN/MAX/STI/PTI/NTI. The whole CPU bottoms
        // out at the three native gates.
        //
        // **IMEM stays native RAM.** TRAM's storage lives in 9 internal
        // TREG3 instances which bootstrap to zero on first instantiation;
        // there is currently no way to pre-load a program into a subcircuit
        // before the simulator runs. So this preset uses the native `RAM`
        // primitive (which accepts `{ mem: [...] }`) for the instruction
        // memory. IMEM is pure storage — no compute happens in it — so the
        // "structural" claim still holds for everything the CPU *computes*.
        //
        // **Caveat — bootstrap address is word 4.** TPC's internal TFLOPs
        // wake at q=0,0, which is balanced-ternary p=[0,0] = word index 4
        // (native PC has its own default of p=[-1,-1] = word 0). So the
        // default program lives at words 4-5; the loop is ADDI +1 / JMP 4
        // and execution begins immediately on the first clock edge. The
        // assembler always loads at word 0, so this preset is for *demo*
        // purposes — it does not interoperate with Assemble & Load. Use
        // the regular `CPU` preset for assembler-driven work.
        //
        // **Second caveat — TREG3's tri-state `ld`.** TREG3 interprets
        // ld = T as *clear*, ld = 0 as hold, ld = +1 as load. The native
        // CPU's decoder emits ld = STI(NTI(opcode)) which is +1 for ADDI/
        // MAXI and T for JMP — the T would erroneously clear ACC on every
        // JMP. So this preset clamps the load enable with one extra MAX
        // gate against CONST 0: `ldClamp = MAX(STI(NTI(opcode)), 0)` —
        // emits +1 for ADDI/MAXI and 0 (hold) for JMP.
        //
        //   word 4: ADDI +1   imem[4] = [1, 0, 0]    ACC = ACC + 1
        //   word 5: JMP  4    imem[5] = [0, 0, T]    jump back to word 4
        //
        // ACC climbs by 1 each full clock cycle, same as the native CPU.
        comps: [
          c('clk',  'CLOCK',     60,  340, { value: -1, mode: 'bi' }),
          c('pc',   'SUB:TPC',   220, 290),
          c('imem', 'RAM',       430, 200, { mem: [
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
            [1, 0, 0], [0, 0, -1],
            [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          // Decoder: NTI off the opcode trit drives PC.jmp (and feeds the
          // load-enable clamp); a MAX with CONST 0 turns STI's T output
          // into a 0 so TREG3 holds (not clears) on JMP cycles.
          c('nti',  'NTI',       760, 150),
          c('sti',  'STI',       880, 150),
          c('zero', 'CONST',     760, 230, { value: 0 }),
          c('ldCl', 'MAX',      1000, 170),
          c('alu',  'SUB:ALU3',  760, 320),
          c('acc',  'SUB:TREG3', 1080, 320),
          c('wclk', 'WAVE',      60,  470, { name: 'clk',  trace: [] }),
          c('wacc', 'WAVE',     1080, 480, { name: 'ACC0', trace: [] }),
        ],
        wires: [
          // Clock distribution.
          w('clk', 'out', 'pc',   'clk'),
          w('clk', 'out', 'imem', 'clk'),
          w('clk', 'out', 'acc',  'clk'),
          // PC drives the IMEM address pair.
          w('pc',  'p0', 'imem', 'a0'),
          w('pc',  'p1', 'imem', 'a1'),
          // IMEM is read-only — tie the write port to 0.
          w('zero', 'out', 'imem', 'we'),
          w('zero', 'out', 'imem', 'd0'),
          w('zero', 'out', 'imem', 'd1'),
          w('zero', 'out', 'imem', 'd2'),
          // Decoder: opcode → NTI (jmp) → STI → MAX-clamp to {0,+1} for ld.
          w('imem', 'q2', 'nti',  'in'),
          w('nti',  'out', 'pc',  'jmp'),
          w('imem', 'q0', 'pc',   'j0'),
          w('imem', 'q1', 'pc',   'j1'),
          w('nti',  'out', 'sti', 'in'),
          w('sti',  'out', 'ldCl', 'a'),
          w('zero', 'out', 'ldCl', 'b'),
          w('ldCl', 'out', 'acc', 'ld'),
          // ALU: a = ACC.q, b = operand (high trit sign-extended 0), op = opcode.
          w('acc',  'q0', 'alu', 'a0'),
          w('acc',  'q1', 'alu', 'a1'),
          w('acc',  'q2', 'alu', 'a2'),
          w('imem', 'q0', 'alu', 'b0'),
          w('imem', 'q1', 'alu', 'b1'),
          w('zero', 'out', 'alu', 'b2'),
          w('imem', 'q2', 'alu', 'op'),
          // ACC ← ALU result.
          w('alu', 'r0', 'acc', 'd0'),
          w('alu', 'r1', 'acc', 'd1'),
          w('alu', 'r2', 'acc', 'd2'),
          // Probes.
          w('clk', 'out', 'wclk', 'in'),
          w('acc', 'q0', 'wacc', 'in'),
        ],
      }));
    },
  },
  'cpu2': {
    label: 'CPU2 — wider 9-op ISA (v2 — see ISA_v2.md)',
    build: () => {
      // CPU2's decoder is a 2-trit DECODE2 subcircuit; make sure its
      // definition is registered before the preset references it.
      if (!subcircuitDefs['DECODE2'])  subcircuitDefs['DECODE2']  = buildDecode2Def();
      if (!subcircuitDefs['TSUM'])     subcircuitDefs['TSUM']     = buildTsumDef();
      if (!subcircuitDefs['ACC_SIGN']) subcircuitDefs['ACC_SIGN'] = buildAccSignDef();
      return buildExample((c, w) => ({
        // Phase C of the v2 ISA — all 9 ops wired (NOP / ADDI / MAXI / MINI /
        // JMP / JMPP / JMPZ / LOAD / STORE). LOAD/STORE add a second 9×3-trit
        // RAM (`dmem`) addressed by the operand's low 2 trits and a per-trit
        // 3:1 MUX picking ALU result vs DMEM read for ACC's data input.
        //
        // Each logical instruction is 6 trits, spread across two parallel
        // 3-trit RAM blocks that share the PC address pins:
        //
        //   imem_lo word = [opL, opH, oper0]
        //   imem_hi word = [oper1, oper2, oper3]
        //
        // Default program (counter v2 — semantically identical to the v1
        // CPU's counter):
        //   word 0: ADDI +1   imem_lo[0]=[0,0,+1]  imem_hi[0]=[0,0,0]
        //   word 1: JMP  0    imem_lo[1]=[0,T,T]   imem_hi[1]=[T,0,0]
        //   words 2..8: NOP   imem_lo[i]=[T,T,0]   imem_hi[i]=[0,0,0]
        //
        // ALU op selector — the entire arithmetic-mode picker collapses to
        // one TSUM gate: aluOpSel = TSUM(en_MAXI, NEG(en_MINI)). For ADDI
        // both enables are 0 → ALU computes ADD; MAXI gives +1 → MAX;
        // MINI gives -1 → MIN.
        comps: [
          c('clk',     'CLOCK',      40,  430, { value: -1, mode: 'bi' }),
          c('pc',      'PC',         170, 380),
          // Parallel RAMs share the PC address; total 6 trits/word.
          c('imem_lo', 'RAM',        340, 200, { mem: [
            [0, 0,  1], [0, -1, -1],
            [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],
            [-1, -1, 0], [-1, -1, 0], [-1, -1, 0], [-1, -1, 0],
          ] }),
          c('imem_hi', 'RAM',        340, 460, { mem: [
            [0, 0, 0], [-1, 0, 0],
            [0, 0, 0], [0, 0, 0], [0, 0, 0],
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
          ] }),
          c('zero',    'CONST',      370, 700, { value: 0 }),
          // Decoder + ALU-op selection.
          c('decode',  'SUB:DECODE2', 580, 230),
          c('negMini', 'STI',        800, 360),
          c('tsumOp',  'SUB:TSUM',   820, 410),
          c('alu',     'ALU',        980, 520),
          // ACC write enable: any of en_ADDI / en_MAXI / en_MINI / en_LOAD.
          c('accW1',   'MAX',        800, 200),
          c('accW2',   'MAX',        950, 230),
          c('accW3',   'MAX',       1080, 260),
          // ACC data source: en_LOAD picks DMEM read; default is ALU result.
          // MUX selects dT/d0/dP by s ∈ {T,0,+1}; en_LOAD ∈ {0,+1}, so dT is
          // unreachable but wired to the ALU result for safety.
          c('accSrc0', 'MUX',       1080, 480),
          c('accSrc1', 'MUX',       1080, 600),
          c('accSrc2', 'MUX',       1080, 720),
          c('acc',     'REG3',      1240, 540),
          // Data memory — 9 words × 3 trits, addressed by oper0/oper1.
          c('dmem',    'RAM',        980, 860),
          // ACC_SIGN + the conditional-jump combiner.
          //   jmpEn = MAX(en_JMP, MIN(en_JMPP, isPos), MIN(en_JMPZ, isZero))
          // All enables and the isPos/isZero flags live in the {0,+1} domain,
          // so MIN acts as AND and MAX as OR.
          c('accSign', 'SUB:ACC_SIGN', 1340, 540),
          c('jmpP',    'MIN',          1560, 360),
          c('jmpZ',    'MIN',          1560, 460),
          c('jmpOR1',  'MAX',          1720, 320),
          c('jmpOR2',  'MAX',          1880, 380),
          c('wclk',    'WAVE',       40,  580, { name: 'clk',  trace: [] }),
          c('wacc',    'WAVE',      1140, 700, { name: 'ACC0', trace: [] }),
        ],
        wires: [
          // Clock distribution.
          w('clk', 'out', 'pc',      'clk'),
          w('clk', 'out', 'imem_lo', 'clk'),
          w('clk', 'out', 'imem_hi', 'clk'),
          w('clk', 'out', 'acc',     'clk'),
          // PC drives both IMEM banks' addresses.
          w('pc', 'p0', 'imem_lo', 'a0'),
          w('pc', 'p1', 'imem_lo', 'a1'),
          w('pc', 'p0', 'imem_hi', 'a0'),
          w('pc', 'p1', 'imem_hi', 'a1'),
          // Both IMEMs are read-only — tie write port to 0.
          w('zero', 'out', 'imem_lo', 'we'),
          w('zero', 'out', 'imem_lo', 'd0'),
          w('zero', 'out', 'imem_lo', 'd1'),
          w('zero', 'out', 'imem_lo', 'd2'),
          w('zero', 'out', 'imem_hi', 'we'),
          w('zero', 'out', 'imem_hi', 'd0'),
          w('zero', 'out', 'imem_hi', 'd1'),
          w('zero', 'out', 'imem_hi', 'd2'),
          // Decoder: opL = imem_lo.q0, opH = imem_lo.q1.
          w('imem_lo', 'q0', 'decode', 'opL'),
          w('imem_lo', 'q1', 'decode', 'opH'),
          // ALU operand: oper0..oper2 = imem_lo.q2, imem_hi.q0, imem_hi.q1.
          w('acc',     'q0', 'alu', 'a0'),
          w('acc',     'q1', 'alu', 'a1'),
          w('acc',     'q2', 'alu', 'a2'),
          w('imem_lo', 'q2', 'alu', 'b0'),
          w('imem_hi', 'q0', 'alu', 'b1'),
          w('imem_hi', 'q1', 'alu', 'b2'),
          // ALU op selector: TSUM(en_MAXI, NEG(en_MINI)).
          w('decode',  'en_MINI', 'negMini', 'in'),
          w('decode',  'en_MAXI', 'tsumOp',  'x'),
          w('negMini', 'out',     'tsumOp',  'y'),
          w('tsumOp',  'sum',     'alu',     'op'),
          // ACC write enable: en_ADDI ∨ en_MAXI ∨ en_MINI ∨ en_LOAD.
          w('decode', 'en_ADDI', 'accW1', 'a'),
          w('decode', 'en_MAXI', 'accW1', 'b'),
          w('accW1',  'out',     'accW2', 'a'),
          w('decode', 'en_MINI', 'accW2', 'b'),
          w('accW2',  'out',     'accW3', 'a'),
          w('decode', 'en_LOAD', 'accW3', 'b'),
          w('accW3',  'out',     'acc',   'ld'),
          // ACC source MUX: en_LOAD selects between ALU.r* (default) and
          // dmem.q* (when LOAD is active).
          w('decode', 'en_LOAD', 'accSrc0', 's'),
          w('decode', 'en_LOAD', 'accSrc1', 's'),
          w('decode', 'en_LOAD', 'accSrc2', 's'),
          w('alu', 'r0', 'accSrc0', 'd0'),
          w('alu', 'r1', 'accSrc1', 'd0'),
          w('alu', 'r2', 'accSrc2', 'd0'),
          w('alu', 'r0', 'accSrc0', 'dT'),
          w('alu', 'r1', 'accSrc1', 'dT'),
          w('alu', 'r2', 'accSrc2', 'dT'),
          w('dmem', 'q0', 'accSrc0', 'dP'),
          w('dmem', 'q1', 'accSrc1', 'dP'),
          w('dmem', 'q2', 'accSrc2', 'dP'),
          w('accSrc0', 'out', 'acc', 'd0'),
          w('accSrc1', 'out', 'acc', 'd1'),
          w('accSrc2', 'out', 'acc', 'd2'),
          // DMEM wiring: clock, address from operand[0..1], data from ACC,
          // write-enable from en_STORE. Read port q* feeds the accSrc MUX.
          w('clk',     'out', 'dmem', 'clk'),
          w('imem_lo', 'q2',  'dmem', 'a0'),
          w('imem_hi', 'q0',  'dmem', 'a1'),
          w('acc',     'q0',  'dmem', 'd0'),
          w('acc',     'q1',  'dmem', 'd1'),
          w('acc',     'q2',  'dmem', 'd2'),
          w('decode',  'en_STORE', 'dmem', 'we'),
          // ACC fans into the sign detector for the conditional jumps.
          w('acc', 'q0', 'accSign', 'q0'),
          w('acc', 'q1', 'accSign', 'q1'),
          w('acc', 'q2', 'accSign', 'q2'),
          // PC jump control:
          //   jmpEn = en_JMP OR (en_JMPP AND isPos) OR (en_JMPZ AND isZero)
          w('decode',  'en_JMPP', 'jmpP',   'a'),
          w('accSign', 'isPos',   'jmpP',   'b'),
          w('decode',  'en_JMPZ', 'jmpZ',   'a'),
          w('accSign', 'isZero',  'jmpZ',   'b'),
          w('decode',  'en_JMP',  'jmpOR1', 'a'),
          w('jmpP',    'out',     'jmpOR1', 'b'),
          w('jmpOR1',  'out',     'jmpOR2', 'a'),
          w('jmpZ',    'out',     'jmpOR2', 'b'),
          w('jmpOR2',  'out',     'pc',     'jmp'),
          w('imem_lo', 'q2',      'pc',     'j0'),
          w('imem_hi', 'q0',      'pc',     'j1'),
          // Probes.
          w('clk', 'out', 'wclk', 'in'),
          w('acc', 'q0',  'wacc', 'in'),
        ],
      }));
    },
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


  return EXAMPLES;
}
