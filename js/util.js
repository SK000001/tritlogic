// ============================================================================
//  TRIT VALUES & UTILITIES
// ============================================================================
//
//  A "trit" is one of -1, 0, +1.  We use the JavaScript number type directly
//  because it makes arithmetic in component eval() functions natural.
//  The value `null` represents an undefined / floating wire — propagates
//  through gates as null.
//
//  Two extra signal levels (A3) ride alongside the trits as STRINGS so they
//  never collide with the numeric -1/0/+1:
//    'Z' — high-impedance: a tri-state driver that isn't driving the net.
//    'X' — contention: two or more strong drivers disagree on one net.
//  Ordinary gates can't compute on 'Z'/'X', so the engine coerces them to
//  null (undefined) before a non-tri-state component's eval (coerceForLogic).

export const TRIT_COLOR = {
  '-1': '#e35555', '0': '#888c95', '1': '#54c060', undef: '#44485a',
  Z: '#3fb6c8', X: '#d957c8',
};
export const tritColor = (v) => v == null ? TRIT_COLOR.undef : (TRIT_COLOR[String(v)] || TRIT_COLOR.undef);
export const tritLabel = (v) => v === -1 ? 'T' : v === 0 ? '0' : v === 1 ? '1'
                              : v === 'Z' ? 'Z' : v === 'X' ? 'X' : '?';
export const tritClass = (v) => v === -1 ? 'trit-T' : v === 0 ? 'trit-0' : v === 1 ? 'trit-P' : '';

// A "strong" value is an actually-driven trit (−1/0/+1), as opposed to 'Z'
// (not driving), 'X' (contention), or null (undefined).
export const isStrong = (v) => v === -1 || v === 0 || v === 1;

// ---- Bus values (C1) ------------------------------------------------------
//
//  A "bus" bundles several trits onto one wire so a datapath word travels as a
//  single net. The packed value is a canonical STRING — a 'b' marker followed
//  by the per-slot trits comma-joined ('_' for a floating slot, 'Z'/'X' kept
//  verbatim). Being a scalar string it (a) never collides with a single trit
//  (a number) or 'Z'/'X', and (b) compares by value, so the event-driven
//  engine's `!==` change-detection settles a bus exactly like any other net —
//  no engine changes needed. MERGE/SPLIT components are the only producers /
//  consumers; render styles bus pins + wires from the pin's `bus:true` flag.
export const BUS_COLOR = '#a98eff';   // violet — distinct from trits / Z / X
const busSlot = (t) => t == null ? '_' : String(t);
export function packBus(trits) {
  // All-floating ⇒ the bus itself is undefined (null), so an unwired MERGE
  // floats like any other component rather than emitting a "b_,_,_" string.
  if (trits.every(t => t == null)) return null;
  return 'b' + trits.map(busSlot).join(',');
}
export function unpackBus(v, width) {
  const out = new Array(width).fill(null);
  if (typeof v !== 'string' || v[0] !== 'b') return out;
  const parts = v.slice(1).split(',');
  for (let i = 0; i < width; i++) {
    const s = parts[i];
    if (s == null || s === '_') out[i] = null;
    else if (s === 'Z' || s === 'X') out[i] = s;
    else out[i] = parseInt(s, 10);
  }
  return out;
}
export const isBus = (v) => typeof v === 'string' && v[0] === 'b';
// Short human label for a bus value: the balanced-ternary pattern (MSB first,
// '?' for a non-strong slot) plus the decimal word value when fully strong.
// Width is inferred from the packed value when not given (the string already
// encodes its slot count), so the same label works for any bus width.
export function busLabel(v, width) {
  if (!isBus(v)) return '?';
  const n = width ?? v.slice(1).split(',').length;
  const trits = unpackBus(v, n);
  const pat = trits.slice().reverse()
    .map(t => t === -1 ? 'T' : t === 0 ? '0' : t === 1 ? '1' : '?').join('');
  return trits.every(isStrong) ? `${pat}=${tritsToInt(trits)}` : pat;
}

// Coerce a resolved net value for a component that doesn't understand
// tri-state: 'Z' and 'X' become null (undefined) so ordinary gate eval()s,
// which already treat null as "floating", behave sensibly.
export const coerceForLogic = (v) => (v === 'Z' || v === 'X') ? null : v;

// Resolve the values several drivers put on one shared net (A3 buses):
//   • any driver at 'X', or two strong drivers that disagree → 'X' (contention)
//   • exactly the strong drivers agree (≥1, all equal)        → that trit
//   • no strong driver, but at least one 'Z'                  → 'Z' (floating bus)
//   • nothing driving at all (only nulls / empty)             → null
// null/undefined drivers contribute nothing (a not-yet-settled source).
export function resolveDrivers(vals) {
  let strong = null, conflict = false, sawZ = false;
  for (const v of vals) {
    if (v === 'X') return 'X';
    if (v === 'Z') { sawZ = true; continue; }
    if (v == null) continue;
    if (strong === null) strong = v;
    else if (strong !== v) conflict = true;
  }
  if (conflict) return 'X';
  if (strong !== null) return strong;
  return sawZ ? 'Z' : null;
}

// File format version for save/load.  Increment when the JSON shape
// changes incompatibly so the loader can either upgrade or warn.
export const SAVE_FORMAT_VERSION = 1;

// ---- Save-format migrations ----------------------------------------------
//
// `SAVE_MIGRATIONS` is a list of `[fromVersion, upgradeFn(data) → data]`
// pairs. `upgradeSave(data)` walks the chain from `data.version` up to
// `SAVE_FORMAT_VERSION`, applying each migrator in turn and bumping the
// version field. Missing `data.version` is treated as 0 (legacy file
// from before the field was added).
//
// To add a migration for a future format bump:
//   1. Bump `SAVE_FORMAT_VERSION` to N.
//   2. Append `[N - 1, data => { ...rewrite...; data.version = N; return data; }]`
//      to `SAVE_MIGRATIONS`.
//   3. Add a test case in tests.js mirroring `Save migration chain ...`.
//
// The 0→1 migrator is a no-op today: the v0 → v1 bump (the day the
// `version` field was added) didn't change any field shapes, only the
// presence of the field itself. It's listed explicitly so the chain
// machinery is exercised by every legacy load.
export const SAVE_MIGRATIONS = [
  [0, (data) => { data.version = 1; return data; }],
];

export function upgradeSave(data) {
  if (!data || typeof data !== 'object') return data;
  let v = (typeof data.version === 'number') ? data.version : 0;
  if (v > SAVE_FORMAT_VERSION) return data;  // newer than us — caller decides
  while (v < SAVE_FORMAT_VERSION) {
    const step = SAVE_MIGRATIONS.find(m => m[0] === v);
    if (!step) {
      throw new Error(`save migration: no upgrader registered for version ${v} → ${v + 1}`);
    }
    data = step[1](data);
    v = (typeof data.version === 'number') ? data.version : v + 1;
  }
  return data;
}

// ---- Shareable-circuit encoding (I3) --------------------------------------
//
//  Encode a circuit's save object into a compact, URL-safe string so a circuit
//  can travel as a link (`…/#c=<encoded>`). The body is the save JSON; we gzip
//  it (CompressionStream — native in modern browsers + Node 18+) when that
//  shrinks it, then base64url it (the `+ / =` of base64 swapped for `- _` and
//  stripped, so it's safe in a URL hash). A 1-char SCHEME prefix says how to
//  read the rest:
//      '1' + base64url(gzip(json))  — gzipped (the usual case; a big win on the
//                                      very repetitive circuit JSON)
//      '0' + base64url(json)        — raw (gzip didn't help / wasn't available)
//      <other first char>           — legacy: the whole string is raw base64url
//                                      (pre-prefix links keep loading)
//  The inverse re-parses to the save object, which the normal load path (with
//  upgradeSave migrations) then consumes — so old links keep working as the
//  format evolves. Encode/decode are async because gzip is stream-based.
function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Push `bytes` through a (De)CompressionStream and collect the result. Writing
// without awaiting + reading to completion is the standard one-shot pattern (no
// backpressure deadlock for our modest sizes).
//
// `maxBytes` (optional) caps the collected output: as soon as the running total
// exceeds it we cancel the stream and throw. This bounds gzip decompression of
// untrusted share links so a tiny payload can't expand to hundreds of MB and
// OOM the tab (a "decompression bomb").
async function streamThrough(bytes, transform, maxBytes = Infinity) {
  const writer = transform.writable.getWriter();
  writer.write(bytes); writer.close();
  const reader = transform.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new RangeError('decompressed payload exceeds size cap');
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
// Hard cap on a decompressed share payload (4 MB). A genuine circuit JSON is a
// few KB even when large; anything past this is malformed or hostile.
const MAX_SHARE_BYTES = 4 * 1024 * 1024;
const hasGzip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function encodeShare(data) {
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if (hasGzip) {
    try {
      const gz = await streamThrough(raw, new CompressionStream('gzip'));
      if (gz.length < raw.length) return '1' + bytesToBase64url(gz);
    } catch { /* gzip failed — fall through to raw */ }
  }
  return '0' + bytesToBase64url(raw);
}
export async function decodeShare(str) {
  const scheme = str[0];
  if (scheme === '1') {
    const raw = await streamThrough(base64urlToBytes(str.slice(1)), new DecompressionStream('gzip'), MAX_SHARE_BYTES);
    return JSON.parse(new TextDecoder().decode(raw));
  }
  // '0' (explicit raw) or a legacy pre-prefix link (the whole string is base64url).
  const payload = scheme === '0' ? str.slice(1) : str;
  const rawBytes = base64urlToBytes(payload);
  if (rawBytes.length > MAX_SHARE_BYTES) throw new RangeError('share payload exceeds size cap');
  return JSON.parse(new TextDecoder().decode(rawBytes));
}

// Prefer the platform's structuredClone (faster + preserves more JS types)
// and fall back to the JSON round-trip when it isn't available.  This
// shows up in cleanComps() and cloneSubScope() in particular.
export const deepClone = (typeof structuredClone === 'function')
  ? structuredClone
  : (x => JSON.parse(JSON.stringify(x)));

// Decimal → balanced-ternary digit array, LSB first, length N.
//
// JS `%` returns negative remainders for negative dividends (-7 % 3 === -1),
// and `Math.trunc(n/3)` truncates toward zero — together those mean a naive
// loop produces wrong digits for negatives.  The fix: take the raw signed
// remainder, map 2 → -1 and -2 → +1, and update n via the exact identity
// (n - r) / 3 which is always an integer.
export function intToTrits(n, width) {
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

export function tritsToInt(trits) {
  let s = 0;
  for (let i = 0; i < trits.length; i++) s += (trits[i] ?? 0) * Math.pow(3, i);
  return s;
}

// Parse a balanced-ternary trit string, MSB first — the digits T (−1), 0
// and +1.  Strictly ternary: a string of only 0s and 1s is a trit pattern,
// NOT a decimal number ("000111" → trits, value 13).  Decimal entry has its
// own dedicated field, so there is no ambiguous decimal fallback here.
export function parseTryteString(s, width = 6) {
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
  return { trits: new Array(width).fill(0),
           warning: `could not parse "${s}"; expected a balanced-ternary string of T, 0 and 1 — use the Decimal value field for numbers` };
}

export function formatTryte(trits) {
  const bt = trits.slice().reverse().map(t => t === -1 ? 'T' : t === 0 ? '0' : '1').join('');
  return `${bt} (${tritsToInt(trits)})`;
}

// HTML-escape user-controlled text before splicing into innerHTML.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Sanity check on startup: every 6-trit value must round-trip. Cheap (~729
// iterations) and saves debugging time. Fires once at module load.
for (let n = -364; n <= 364; n++) {
  const back = tritsToInt(intToTrits(n, 6));
  if (back !== n) {
    console.error(`intToTrits round-trip failed: ${n} → ${back}`);
    break;
  }
}
