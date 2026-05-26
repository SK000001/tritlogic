// ============================================================================
//  ENGINE — simulation core + subcircuit instancing
// ============================================================================
//
//  Two phases of work happen here:
//    1. SIMULATION — `simulateScope` runs a fixed-point pass on a {comps,
//       wires, outVals} bag; `simulate` runs it on the live world; `tick`
//       and `stepSequential` advance clocked components.
//    2. SUBCIRCUITS — `subInstanceDef` builds the dynamic TYPES-shaped def
//       for a SUB:Name instance, `simulateSubInstance` runs the contained
//       scope, `cloneSubScope` lazily materialises the per-instance comp
//       / wire bag.
//
//  Exposed as a `createEngine(deps)` factory taking the app-internal
//  helpers it can't define itself (TYPES, compDef, refreshDebugger) so it
//  can stay import-cycle-free with app.js.

import {
  comps, wires, outVals, subcircuitDefs, tick, _subDepth,
  setOutVals, setTick, setSubDepth,
} from './state.js';
import { deepClone } from './util.js';

export function createEngine(deps) {
  // TYPES + compDef are read once; draw / drawWaves / refreshDebugger are
  // resolved lazily through `deps.*` because they come from sibling modules
  // (render, debugger) that themselves take engine handles as deps — the
  // caller fills these slots in on `deps` AFTER both factories have run.
  const { TYPES, compDef } = deps;

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
  setOutVals(root.outVals);
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
  setTick(tick + 1);
  document.getElementById('stat-tick').textContent = tick;
  deps.drawWaves();
  deps.draw();
  if (typeof deps.refreshDebugger === 'function') deps.refreshDebugger();
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
             draw: (cc) => deps.drawSubMissing(cc, defName) };
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
    draw: (cc) => deps.drawSubInstance(cc, defName, def),
  };
}

// Module-level counter so a runaway recursion (subcircuit cycle) doesn't
// blow the JS stack with a confusing trace — we bail at a sensible depth.
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
  setSubDepth(_subDepth + 1);
  try { simulateScope(instance.subScope); }
  finally { setSubDepth(_subDepth - 1); }
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

  return { simulate, simulateScope, stepSequential, subInstanceDef, simulateSubInstance, cloneSubScope, inputValueFromWires };
}
