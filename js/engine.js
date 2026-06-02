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
import { deepClone, resolveDrivers, coerceForLogic } from './util.js';

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
//  Two phases.  Phase A is purely combinational: settle every output from its
//  inputs via the event-driven solver in `simulateScope` (A1 — a dirty work
//  queue that only re-evaluates a component when one of its inputs actually
//  changed, rather than re-scanning every component each pass).  Phase B
//  ("step") is the sequential edge-triggered update, executed only when the
//  user clicks Step or auto-play fires.  After Phase B we re-run Phase A.

// The resolved value on a component's input net: gather every driver wired to
// (compId, portName) and resolve them with tri-state rules (A3). Returns the
// raw resolved value, which may be 'Z' (floating) or 'X' (contention) — display
// and probes want that; logic consumers coerce it via coerceForLogic.
function inputValueFromWires(scope, compId, portName) {
  let srcs = null;
  for (const w of scope.wires) {
    if (w.toId === compId && w.toPort === portName) {
      const v = scope.outVals[`${w.fromId}:${w.fromPort}`] ?? null;
      if (!srcs) srcs = [v];
      else srcs.push(v);
    }
  }
  if (!srcs) return null;
  return srcs.length === 1 ? srcs[0] : resolveDrivers(srcs);
}

const DEFAULT_DELAY = 1;

// Propagation delay (abstract integer time units) for a component in the timed
// solver (A2). Per-instance `c.state.delay` overrides a per-type
// `TYPES[type].delay`, which overrides the default. Always a positive integer
// so the timed event wheel strictly advances.
function delayOf(c) {
  const d = c.state && c.state.delay;
  if (Number.isInteger(d) && d >= 1) return d;
  const t = TYPES[c.type] && TYPES[c.type].delay;
  if (Number.isInteger(t) && t >= 1) return t;
  return DEFAULT_DELAY;
}

// Wiring indices shared by both solvers, built once per call:
//   destOf:  "toId:toPort"     -> [ "fromId:fromPort", ... ]  (all drivers of
//            an input net; usually one, but a tri-state bus has several — A3)
//   fanout:  "fromId:fromPort" -> [toId, ...]                  (consumers to wake)
//   byId:    compId            -> component
function buildIndices(scope) {
  const destOf = new Map();
  const fanout = new Map();
  for (const w of scope.wires) {
    const dk = `${w.toId}:${w.toPort}`;
    const fk = `${w.fromId}:${w.fromPort}`;
    const da = destOf.get(dk);
    if (da) da.push(fk); else destOf.set(dk, [fk]);
    const fa = fanout.get(fk);
    if (fa) fa.push(w.toId); else fanout.set(fk, [w.toId]);
  }
  const byId = new Map();
  for (const c of scope.comps) byId.set(c.id, c);
  return { destOf, fanout, byId };
}

// Gather a component's input-port values from a net-value map (keyed by
// "fromId:fromPort") via the destOf index. Each input net resolves its
// driver(s) with tri-state rules (A3); the result is then coerced to a plain
// trit/null for ordinary components — only tri-state-aware ones (def.tristate,
// e.g. TRIBUF) receive raw 'Z'/'X'.
function gatherInputs(def, id, destOf, vals) {
  const vIn = {};
  for (const port in def.pins) {
    if (def.pins[port].kind === 'in') {
      const srcs = destOf.get(`${id}:${port}`);
      let v = null;
      if (srcs) v = srcs.length === 1 ? (vals[srcs[0]] ?? null)
                                      : resolveDrivers(srcs.map(k => vals[k] ?? null));
      vIn[port] = def.tristate ? v : coerceForLogic(v);
    }
  }
  return vIn;
}

// Evaluate one component's outputs from already-gathered inputs, wrapping the
// SUB-instance recursion and the per-eval error guard shared by both solvers.
// On a thrown eval, every output goes null and a per-scope counter is bumped.
function evalComp(scope, c, def, vIn) {
  try {
    if (c.type.startsWith('SUB:')) return simulateSubInstance(c, vIn) || {};
    return def.eval(c, vIn) || {};
  } catch (err) {
    scope._evalErrors = (scope._evalErrors || 0) + 1;
    if (!scope._evalLogged) {
      scope._evalLogged = true;
      console.warn(`eval error in ${c.type} #${c.id}:`, err);
    }
    const out = {};
    for (const port in def.pins) if (def.pins[port].kind === 'out') out[port] = null;
    return out;
  }
}

function simulateScope(scope) {
  // Event-driven fixed point (A1): a dirty work queue that only re-evaluates a
  // component when one of its inputs changed, propagating along the fanout map
  // so a deep chain settles in dependency order instead of (depth × full-pass)
  // sweeps.
  const { destOf, fanout, byId } = buildIndices(scope);

  // Initialize: combinational outputs to null (only if unset — prior values
  // are kept so re-simulating a settled circuit starts warm); sequential
  // outputs already hold their stored state, so a DFF participates correctly
  // as a source of its stored q.
  for (const c of scope.comps) {
    const def = compDef(c);
    for (const port in def.pins) {
      if (def.pins[port].kind === 'out') {
        const key = `${c.id}:${port}`;
        if (scope.outVals[key] === undefined) scope.outVals[key] = null;
      }
    }
  }

  // Dirty work queue, seeded with every component once.
  const queue = [];
  const queued = new Set();
  const enqueue = (id) => { if (!queued.has(id)) { queued.add(id); queue.push(id); } };
  for (const c of scope.comps) enqueue(c.id);

  // Oscillation guard: 300 evals per component (floor for tiny scopes). A DAG
  // drains in ~O(edges) evals; only a real oscillator hits the cap → unstable.
  const maxEvals = Math.max(1000, scope.comps.length * 300);
  let evals = 0;
  let overflow = false;

  while (queue.length) {
    if (evals >= maxEvals) { overflow = true; break; }
    const id = queue.shift();
    queued.delete(id);
    const c = byId.get(id);
    if (!c) continue;
    const def = compDef(c);
    evals++;
    const vOut = evalComp(scope, c, def, gatherInputs(def, id, destOf, scope.outVals));
    for (const port in vOut) {
      const key = `${id}:${port}`;
      if (scope.outVals[key] !== vOut[port]) {
        scope.outVals[key] = vOut[port];
        const outs = fanout.get(key);
        if (outs) for (const toId of outs) enqueue(toId);
      }
    }
  }

  // `iters` now counts component evaluations (the event-driven work metric),
  // not full passes; the stat panel surfaces it as "Evals".
  scope.lastIters = evals;
  scope.stable = !overflow;
  return { iters: evals, stable: scope.stable };
}

// ----------------------------------------------------------------------------
//  TIMED SIMULATION (A2 — propagation delays)
// ----------------------------------------------------------------------------
//
//  An opt-in timed model over the same wiring graph as the instant solver.
//  Each component has an integer propagation delay (delayOf); when a net
//  changes at time t, every consuming component is re-evaluated at t + its own
//  delay. Because a gate is re-evaluated once per arriving input edge, inputs
//  that reconverge with unequal delay drive the gate to transient intermediate
//  values — i.e. real dynamic hazards/glitches, which we surface.
//
//  Two ways to drive it:
//    • cold start (default): every source / sequential output establishes at
//      t=0 (computed from the cold snapshot so chained reads still incur their
//      own delay), then the combinational wavefront propagates. Good for
//      "watch the circuit settle".
//    • { base, stimulus }: start from a known steady state `base` (a vals map,
//      e.g. captured from simulateScope) and apply source changes `stimulus`
//      ([{key,value}]) at t=0. Good for "toggle an input and watch the
//      response" — this is what exposes static hazards on a transition.
//
//  Returns { changes:[{t,key,value}], hazards:[{key,count}], settleTime,
//            finalVals, settled }. `finalVals` matches the instant solver's
//            steady state for the same inputs; any net that changed more than
//            once (count>1) is flagged as a hazard.
function simulateTimed(scope, opts = {}) {
  const { destOf, fanout, byId } = buildIndices(scope);

  // Starting net values.
  const vals = {};
  if (opts.base) {
    Object.assign(vals, opts.base);
  } else {
    for (const c of scope.comps) {
      const def = compDef(c);
      for (const port in def.pins) {
        if (def.pins[port].kind === 'out') vals[`${c.id}:${port}`] = null;
      }
    }
  }

  const changes = [];
  const changeCount = new Map();   // netKey -> times it changed (>1 ⇒ glitch)
  const pending = new Map();       // time -> Set(compId)
  const schedule = (id, t) => {
    let s = pending.get(t);
    if (!s) { s = new Set(); pending.set(t, s); }
    s.add(id);
  };
  const applyChange = (key, v, t) => {
    if (vals[key] === v) return;
    vals[key] = v;
    changes.push({ t, key, value: v });
    changeCount.set(key, (changeCount.get(key) || 0) + 1);
    const outs = fanout.get(key);
    if (outs) for (const toId of outs) {
      const d = byId.get(toId);
      if (d) schedule(toId, t + delayOf(d));
    }
  };

  // Seed at t=0.
  if (opts.stimulus) {
    for (const s of opts.stimulus) applyChange(s.key, s.value, 0);
  } else {
    // Establish source / sequential outputs from the cold snapshot, then apply
    // them together — so a sequential→sequential combinational read still
    // incurs its own delay (via scheduling) rather than collapsing to t=0.
    const seeds = [];
    for (const c of scope.comps) {
      const def = compDef(c);
      const hasIn = Object.values(def.pins).some(p => p.kind === 'in');
      if (!hasIn || def.isSequential) {
        seeds.push([c, evalComp(scope, c, def, gatherInputs(def, c.id, destOf, vals))]);
      }
    }
    for (const [c, vOut] of seeds) {
      for (const port in vOut) applyChange(`${c.id}:${port}`, vOut[port], 0);
    }
  }

  // Process the event wheel in ascending time order.
  const maxEvals = Math.max(1000, scope.comps.length * 300);
  let evals = 0, overflow = false;
  while (pending.size && !overflow) {
    let T = Infinity;
    for (const t of pending.keys()) if (t < T) T = t;
    const ids = pending.get(T);
    pending.delete(T);
    for (const id of ids) {
      if (evals >= maxEvals) { overflow = true; break; }
      const c = byId.get(id);
      if (!c) continue;
      const def = compDef(c);
      evals++;
      const vOut = evalComp(scope, c, def, gatherInputs(def, id, destOf, vals));
      for (const port in vOut) applyChange(`${c.id}:${port}`, vOut[port], T);
    }
  }

  let settleTime = 0;
  for (const ch of changes) if (ch.t > settleTime) settleTime = ch.t;
  const hazards = [];
  for (const [key, n] of changeCount) if (n > 1) hazards.push({ key, count: n });
  return { changes, hazards, settleTime, finalVals: vals, settled: !overflow };
}

// Net keys transitioning at exactly time t in a timed run's change log — the
// live wavefront edge at that instant. Drives the yellow "switching" overlay in
// Timing mode (A2): as the cursor advances each net flashes on the step it
// flips, so the wavefront sweeps and a glitching net flashes again when it
// flips back. `changes` is ascending in t, so we can stop at the first later
// event.
function switchingKeysAt(changes, t) {
  const keys = new Set();
  for (const ch of changes) {
    if (ch.t === t) keys.add(ch.key);
    else if (ch.t > t) break;
  }
  return keys;
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
              // Flip-flops aren't tri-state-aware: a Z/X data line samples as
              // undefined (null), not a literal 'Z'/'X'.
              vIn[port] = coerceForLogic(inputValueFromWires(scope, c.id, port));
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

  return { simulate, simulateScope, simulateTimed, switchingKeysAt, stepSequential, subInstanceDef, simulateSubInstance, cloneSubScope, inputValueFromWires };
}
