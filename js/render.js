// ============================================================================
//  RENDER
// ============================================================================
//
//  All canvas drawing — component shapes, wires, waveform, the DRAW registry
//  (D2) — plus the small bit of waveform-cursor input handling that's tightly
//  coupled to the private _waveCursor* state.
//
//  Exposed as a `createRender(deps)` factory so we can take the app-internal
//  helpers it depends on (TYPES, compDef, wirePath, etc.) as parameters
//  instead of via an import cycle. State (canvas refs, view, comps, wires,
//  hover/selection) and trit utilities are imported directly so their live
//  bindings remain visible.

import {
  cv, ctx, waveCv, waveCtx, minimapCv, minimapCtx,
  view, comps, wires, mouse, drag, hoverPin, selection, selectedWire,
  pendingWire, animTime, outVals, tick, switchingNets,
} from './state.js';
import { tritColor, tritLabel, intToTrits, tritsToInt, isBus, busLabel, BUS_COLOR } from './util.js';

export function createRender(deps) {
  // `inputValueFromWires` comes from engine.js, which depends back on render
  // (draw / drawWaves). To break the cycle we read it lazily through deps.*
  // — the caller fills it in after createEngine returns.
  const {
    RAM_WORDS, TYPES,
    compDef, fanoutPins, getComp,
    invalidatePathCache, pathCacheRev,
    pinAbsPos, screenToWorld, segHitsBox, wirePath,
  } = deps;
  const inputValueFromWires = (...args) => deps.inputValueFromWires(...args);

// ============================================================================
//  DRAWING
// ============================================================================

function draw() {
  // Wire paths are cached per wire id; the cache survives across draws and
  // is invalidated only when geometry actually mutates (comp move, comp /
  // wire add or remove, undo, load — see invalidatePathCache call sites).
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

  drawMinimap();
}

// ---- Mini-map navigation (B5) --------------------------------------------
// A small overview in the bottom-right corner showing every component plus a
// rectangle for the current viewport. Click or drag on it to recentre the
// main view (click-to-jump). It only appears once the circuit overflows the
// visible canvas, so small circuits that already fit on screen stay
// uncluttered.
//
// `_miniXform` caches the world→minimap-pixel transform the last frame drew,
// so the pointer handlers below can invert it without recomputing the fit.
let _miniXform = null;

function drawMinimap() {
  if (!minimapCv || !minimapCtx) return;
  if (comps.length === 0) { minimapCv.style.display = 'none'; _miniXform = null; return; }

  // Content bounds (world space).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of comps) {
    const def = compDef(c);
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + def.w > maxX) maxX = c.x + def.w;
    if (c.y + def.h > maxY) maxY = c.y + def.h;
  }

  // Current viewport (world space).
  const v0 = screenToWorld(0, 0);
  const v1 = screenToWorld(cv.width, cv.height);

  // Only show the mini-map when the whole circuit doesn't already fit in the
  // viewport — i.e. once it has "outgrown the visible canvas".
  if (minX >= v0.x && minY >= v0.y && maxX <= v1.x && maxY <= v1.y) {
    minimapCv.style.display = 'none'; _miniXform = null; return;
  }
  minimapCv.style.display = 'block';

  // Fit region = union of content and viewport, so both stay visible.
  const rx0 = Math.min(minX, v0.x), ry0 = Math.min(minY, v0.y);
  const rx1 = Math.max(maxX, v1.x), ry1 = Math.max(maxY, v1.y);
  const rw = Math.max(1, rx1 - rx0), rh = Math.max(1, ry1 - ry0);
  const MW = minimapCv.width, MH = minimapCv.height, PAD = 6;
  const s = Math.min((MW - 2 * PAD) / rw, (MH - 2 * PAD) / rh);
  const offX = (MW - rw * s) / 2 - rx0 * s;
  const offY = (MH - rh * s) / 2 - ry0 * s;
  const w2m = (wx, wy) => ({ x: offX + wx * s, y: offY + wy * s });
  _miniXform = { s, offX, offY };

  const m = minimapCtx;
  m.clearRect(0, 0, MW, MH);
  // Components — selected ones in accent blue, the rest a muted grey.
  for (const c of comps) {
    const def = compDef(c);
    const p = w2m(c.x, c.y);
    m.fillStyle = selection.has(c.id) ? '#6ea8ff' : '#7b8696';
    m.fillRect(p.x, p.y, Math.max(1, def.w * s), Math.max(1, def.h * s));
  }
  // Viewport rectangle (amber, matching the floating-input accent).
  const a = w2m(v0.x, v0.y), b = w2m(v1.x, v1.y);
  m.strokeStyle = '#e3a55a';
  m.lineWidth = 1.5;
  m.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
}

// Recentre the main view on the world point under the mini-map cursor.
function miniJump(e) {
  if (!_miniXform) return;
  const r = minimapCv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // Map client px → buffer px (handles any CSS scaling), then invert the
  // cached world→minimap transform.
  const px = (e.clientX - r.left) * (minimapCv.width / r.width);
  const py = (e.clientY - r.top) * (minimapCv.height / r.height);
  const wx = (px - _miniXform.offX) / _miniXform.s;
  const wy = (py - _miniXform.offY) / _miniXform.s;
  view.tx = cv.width / 2 - wx * view.scale;
  view.ty = cv.height / 2 - wy * view.scale;
  draw();
}

let _miniDragging = false;
minimapCv.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  _miniDragging = true;
  e.preventDefault();
  e.stopPropagation();
  miniJump(e);
});
window.addEventListener('mousemove', (e) => { if (_miniDragging) miniJump(e); });
window.addEventListener('mouseup', () => { _miniDragging = false; });

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
  (DRAW[c.type] || def.draw)(c);
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
    // A bus pin (MERGE out / SPLIT in) draws as a larger violet square so it
    // reads as "many trits, one wire" and is obviously not a single-trit pin.
    if (def.pins[port].bus) {
      ctx.fillStyle = (v == null) ? TRIT_COLOR_UNDEF : BUS_COLOR;
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
      continue;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = tritColor(v);
    ctx.fill();
  }
}
const TRIT_COLOR_UNDEF = '#44485a';   // mirrors util TRIT_COLOR.undef

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
function drawROM(c) {
  const t = TYPES.ROM;
  ctx.fillStyle = '#2a2630'; ctx.fillRect(0, 0, t.w, t.h);   // violet-ish tint vs RAM
  ctx.strokeRect(0.5, 0.5, t.w-1, t.h-1);
  // Title
  ctx.fillStyle = '#d8dde6'; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('ROM', t.w/2, 4);
  // Live memory map: nine words top-to-bottom, six trit cells per word.
  const mem = c.state.mem || [];
  const cw = 11, ch = 11, gx = 1, gy = 2;
  const gridW = 6 * cw + 5 * gx;
  const x0 = (t.w - gridW) / 2, y0 = 22;
  for (let word = 0; word < RAM_WORDS; word++) {
    const wv = mem[word] || [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = tritColor(wv[i]);
      ctx.fillRect(x0 + i * (cw + gx), y0 + word * (ch + gy), cw, ch);
    }
  }
  // Pin labels
  ctx.fillStyle = '#8a92a1'; ctx.font = '9px monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('A0', 4, 24); ctx.fillText('A1', 4, 44);
  ctx.textAlign = 'right';
  for (let i = 0; i < 6; i++) ctx.fillText('Q' + i, t.w-4, 24 + i * 20);
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
function drawTriBuf(c) {
  const t = TYPES.TRIBUF;
  // Buffer triangle pointing toward the output.
  ctx.beginPath();
  ctx.moveTo(10, 5);
  ctx.lineTo(t.w - 12, t.h / 2);
  ctx.lineTo(10, t.h - 5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8a92a1'; ctx.font = '8px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('in', 3, 14);
  ctx.fillText('en', 3, 32);
  ctx.textAlign = 'right';
  ctx.fillText('out', t.w - 2, 22);
}
// Bus merge: N trit pins funnel into a single violet bus pin. Width-generic —
// reads the trit pins from the type, so MERGE3 and MERGE6 share it.
function drawMerge(c) {
  const t = TYPES[c.type];
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w - 1, t.h - 1);
  const busDy = t.pins.bus.dy;
  const ins = Object.keys(t.pins).filter(p => p !== 'bus');
  ctx.strokeStyle = BUS_COLOR; ctx.lineWidth = 1.5 / view.scale;
  ctx.beginPath();
  for (const p of ins) { ctx.moveTo(12, t.pins[p].dy); ctx.lineTo(t.w - 14, busDy); }
  ctx.stroke();
  ctx.fillStyle = BUS_COLOR; ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('MRG', t.w / 2, 4);
  ctx.fillStyle = '#8a92a1'; ctx.font = '8px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const p of ins) ctx.fillText(p.slice(1), 4, t.pins[p].dy);
}
// Bus tri-state buffer: a buffer triangle with violet (bus) data pins.
function drawTriBuf3(c) {
  const t = TYPES.TRIBUF3;
  ctx.beginPath();
  ctx.moveTo(10, 5);
  ctx.lineTo(t.w - 12, t.h / 2);
  ctx.lineTo(10, t.h - 5);
  ctx.closePath();
  ctx.strokeStyle = BUS_COLOR; ctx.fill(); ctx.stroke();
  ctx.fillStyle = BUS_COLOR; ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('▷3', t.w / 2 - 4, t.h / 2);
  ctx.fillStyle = '#8a92a1'; ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('en', 3, 32);
}
// Bus split: a single violet bus pin fans out to N trit pins. Width-generic —
// SPLIT3 and SPLIT6 share it.
function drawSplit(c) {
  const t = TYPES[c.type];
  ctx.fillStyle = '#262a32'; ctx.fillRect(0, 0, t.w, t.h);
  ctx.strokeRect(0.5, 0.5, t.w - 1, t.h - 1);
  const busDy = t.pins.bus.dy;
  const outs = Object.keys(t.pins).filter(p => p !== 'bus');
  ctx.strokeStyle = BUS_COLOR; ctx.lineWidth = 1.5 / view.scale;
  ctx.beginPath();
  for (const p of outs) { ctx.moveTo(14, busDy); ctx.lineTo(t.w - 12, t.pins[p].dy); }
  ctx.stroke();
  ctx.fillStyle = BUS_COLOR; ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('SPL', t.w / 2, 4);
  ctx.fillStyle = '#8a92a1'; ctx.font = '8px monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const p of outs) ctx.fillText(p.slice(1), t.w - 4, t.pins[p].dy);
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
let _crossingsRev = -1;  // path-cache revision the crossings map was built against
function computeWireCrossings() {
  // Crossings depend only on routed wire paths. invalidatePathCache() bumps
  // a revision counter (see state.js / pathCacheRev()) so we can skip the
  // O(W²) recompute when nothing has changed since last frame.
  const rev = pathCacheRev();
  if (rev === _crossingsRev) return;
  _crossingsRev = rev;
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
  // A bus wire (driven by a MERGE/SPLIT `bus` pin) renders thick + violet with
  // a decimal word label, so a bundled datapath word reads differently from a
  // single-trit wire.
  const src = getComp(w.fromId);
  const srcDef = src && compDef(src);
  const busWire = !!(srcDef && srcDef.pins[w.fromPort] && srcDef.pins[w.fromPort].bus);
  // Pull the crossings list for this wire (horizontal-segment crossings
  // only — by convention horizontal wires hump over vertical wires).
  const crossings = _wireCrossings.get(w.id) || [];
  const jumpR = 5;
  // Trace the wire path (with arc-jumps over crossings) into the current
  // sub-path; factored out so we can stroke it twice — once for the yellow
  // switching glow underlay, once for the value-coloured wire on top.
  const tracePath = () => {
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
  };

  // Switching overlay (A2): in Timing mode, a net transitioning at the cursor
  // time glows yellow underneath the coloured wire, so the propagation
  // wavefront visibly sweeps and a glitching net flashes again on its glitch.
  if (switchingNets.has(`${w.fromId}:${w.fromPort}`)) {
    ctx.save();
    ctx.strokeStyle = '#ffd000';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 8 / view.scale;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    tracePath();
    ctx.stroke();
    ctx.restore();
  }

  // Bus wire: violet when carrying a word; a floating (Z) / contended (X) /
  // undefined bus falls back to the normal cyan / magenta / undef colour so
  // those states still read.
  ctx.strokeStyle = busWire ? (isBus(v) ? BUS_COLOR : tritColor(v)) : tritColor(v);
  ctx.lineWidth = ((selectedWire === w.id ? 3 : 2) + (busWire ? 1.5 : 0)) / view.scale;
  // Live wires get a dashed pattern whose offset advances each animation
  // tick, producing a slow "marching ants" toward the destination.
  // Floating wires stay solid — visually flagging the dead segment. A
  // high-impedance ('Z') or contention ('X') wire isn't carrying a flowing
  // signal either, so it stays solid too (just coloured cyan / magenta).
  const animated = (v != null && v !== 'Z' && v !== 'X');
  if (animated) {
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -animTime % 10;
  } else {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  tracePath();
  ctx.stroke();
  ctx.setLineDash([]);  // reset state for other shapes

  // Bus value label, centred on the wire's midpoint segment.
  if (busWire && isBus(v) && path.length >= 2) {
    const mid = path[Math.floor((path.length - 1) / 2)];
    const next = path[Math.floor((path.length - 1) / 2) + 1] || mid;
    const lx = (mid.x + next.x) / 2, ly = (mid.y + next.y) / 2;
    const label = busLabel(v);   // width inferred from the packed value
    ctx.font = `${10 / view.scale}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const pad = 3 / view.scale, tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(20,22,28,0.82)';
    ctx.fillRect(lx - tw / 2 - pad, ly - 14 / view.scale, tw + 2 * pad, 13 / view.scale);
    ctx.fillStyle = BUS_COLOR;
    ctx.fillText(label, lx, ly - 2 / view.scale);
  }

  // User-assigned wire label (B4): a net name set in the inspector. Drawn on a
  // dark chip at the wire's midpoint. If this is also a value-labelled bus, the
  // name sits one line higher so the two don't overlap.
  if (w.label && path.length >= 2) {
    const mid = path[Math.floor((path.length - 1) / 2)];
    const next = path[Math.floor((path.length - 1) / 2) + 1] || mid;
    const lx = (mid.x + next.x) / 2, ly = (mid.y + next.y) / 2;
    const lift = ((busWire && isBus(v)) ? -14 : 0) / view.scale;
    ctx.font = `${10 / view.scale}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const pad = 3 / view.scale, tw = ctx.measureText(w.label).width;
    ctx.fillStyle = 'rgba(20,22,28,0.82)';
    ctx.fillRect(lx - tw / 2 - pad, ly - 14 / view.scale + lift, tw + 2 * pad, 13 / view.scale);
    ctx.fillStyle = selectedWire === w.id ? '#9fc0ff' : '#cfd4de';
    ctx.fillText(w.label, lx, ly - 2 / view.scale + lift);
  }
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
// ============================================================================
//  RENDER REGISTRY  (D2 — draw functions decoupled from TYPES logic)
// ============================================================================
//
//  Each component's drawXxx function used to live as a `draw:` field on
//  its TYPES entry. They are now looked up here, keeping TYPES focused on
//  pure logic (pins, eval, defaults, latch). drawComp() falls back to
//  `def.draw` for dynamically-built defs (SUB:, GATE:, unknown).

const DRAW = {
  INPUT:    drawInput,
  CONST:    drawConst,
  TRYTE_IN: drawTryteIn,
  CLOCK:    drawClock,
  OUTPUT:   drawOutput,
  TRYTE_OUT:drawTryteOut,
  WAVE:     drawWave,
  ADDER:    drawAdder,
  MUX:      drawMUX,
  TRIBUF:   drawTriBuf,
  DFF:      drawDFF,
  REG3:     drawReg,
  RAM:      drawRAM,
  ROM:      drawROM,
  ALU:      drawALU,
  PC:       drawPC,
  MERGE3:   drawMerge,
  SPLIT3:   drawSplit,
  MERGE6:   drawMerge,
  SPLIT6:   drawSplit,
  TRIBUF3:  drawTriBuf3,
  // Inverter family — same shape function, different label trit.
  STI: (c) => drawInverterShape(c, 'STI'),
  NTI: (c) => drawInverterShape(c, 'NTI'),
  PTI: (c) => drawInverterShape(c, 'PTI'),
  // Binary family — same shape, different label.
  MIN: (c) => drawBinaryShape(c, 'MIN'),
  MAX: (c) => drawBinaryShape(c, 'MAX'),
};

  return { draw, drawMinimap, drawCustomGate, drawCustomGateMissing, drawSubInstance, drawSubMissing, drawWaves, DRAW };
}
