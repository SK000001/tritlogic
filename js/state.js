// ============================================================================
//  STATE
// ============================================================================
//
//  Mutable module-scope globals shared across the app. ES module bindings are
//  immutable from the importer's side, so every reassignment site (`comps =
//  []`, `tick++`, etc.) goes through a setter exported from here. Reads work
//  directly via the live `let` binding.

// ---- world model ---------------------------------------------------------
export let comps = [];     // { id, type, x, y, state, subScope? }
export let wires = [];     // { id, fromId, fromPort, toId, toPort }
export let nextCompId = 1;
export let nextWireId = 1;
export let outVals = {};

export let subcircuitDefs = {};   // name -> { inputs:[{name}], outputs:[{name}], comps, wires, nextCompId, nextWireId }
export let customGates = {};      // name -> { numInputs, table } — gate-builder defs

export let view = { tx: 40, ty: 40, scale: 1 };
export let tick = 0;
export let autoPlay = null;

// ---- tool / interaction state -------------------------------------------
export let tool = 'select';
export let placeType = null;
export let mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, spaceDown: false };
export let drag = null;             // { kind:'comp'|'pan'|'rect', startX, startY, ... }
export let rmbDelete = true;        // right-click deletes the comp/wire under the cursor
export let pendingWire = null;
export let hoverPin = null;
export let selection = new Set();   // Set of component IDs
export let selectedWire = null;
export let lastClickPos = null;

// ---- comp-id index, undo, debugger, sim depth, anim ---------------------
export let compById = new Map();
export let undoStack = [];
export let redoStack = [];
export let lastAsmProgram = null;
export let _subDepth = 0;
export let _pathCache = new Map();
export let _wireOccupied = new Map();
export let animTime = 0;
export let _lastAnim = 0;

// ---- setters ------------------------------------------------------------
// Each setter returns the PREVIOUS value of the binding. That preserves the
// semantics of postfix increment after the mechanical transform turns
// `tick++` into `setTick(tick + 1)` — which then evaluates to the old tick
// just like the postfix form does.
export function setComps(v)           { const o = comps; comps = v; return o; }
export function setWires(v)           { const o = wires; wires = v; return o; }
export function setNextCompId(v)      { const o = nextCompId; nextCompId = v; return o; }
export function setNextWireId(v)      { const o = nextWireId; nextWireId = v; return o; }
export function setOutVals(v)         { const o = outVals; outVals = v; return o; }
export function setSubcircuitDefs(v)  { const o = subcircuitDefs; subcircuitDefs = v; return o; }
export function setCustomGates(v)     { const o = customGates; customGates = v; return o; }
export function setView(v)            { const o = view; view = v; return o; }
export function setTick(v)            { const o = tick; tick = v; return o; }
// `setAutoPlay` and `setTool` collide with existing higher-level helpers
// defined in app.js, so the state-module setters use a different prefix.
export function assignAutoPlay(v)     { const o = autoPlay; autoPlay = v; return o; }
export function assignTool(v)         { const o = tool; tool = v; return o; }
export function setPlaceType(v)       { const o = placeType; placeType = v; return o; }
export function setMouse(v)           { const o = mouse; mouse = v; return o; }
export function setDrag(v)            { const o = drag; drag = v; return o; }
export function setRmbDelete(v)       { const o = rmbDelete; rmbDelete = v; return o; }
export function setPendingWire(v)     { const o = pendingWire; pendingWire = v; return o; }
export function setHoverPin(v)        { const o = hoverPin; hoverPin = v; return o; }
export function setSelection(v)       { const o = selection; selection = v; return o; }
export function setSelectedWire(v)    { const o = selectedWire; selectedWire = v; return o; }
export function setLastClickPos(v)    { const o = lastClickPos; lastClickPos = v; return o; }
export function setCompById(v)        { const o = compById; compById = v; return o; }
export function setLastAsmProgram(v)  { const o = lastAsmProgram; lastAsmProgram = v; return o; }
export function setSubDepth(v)        { const o = _subDepth; _subDepth = v; return o; }
export function setAnimTime(v)        { const o = animTime; animTime = v; return o; }
export function setLastAnim(v)        { const o = _lastAnim; _lastAnim = v; return o; }

// ---- DOM refs (resolved at module-load time) -----------------------------
// In the browser the script tag is `type="module"`, so it is deferred and
// the DOM is present by the time this evaluates. In the headless test
// runner, document.getElementById returns a fake element whose .getContext
// returns a proxy that absorbs every call — so the same lookups work there.
export const cv       = document.getElementById('cv');
export const ctx      = cv ? cv.getContext('2d') : null;
export const statusEl = document.getElementById('status');
export const selInfo  = document.getElementById('sel-info');
export const waveCv   = document.getElementById('wave-cv');
export const waveCtx  = waveCv ? waveCv.getContext('2d') : null;
