// ============================================================================
//  TRIT VALUES & UTILITIES
// ============================================================================
//
//  A "trit" is one of -1, 0, +1.  We use the JavaScript number type directly
//  because it makes arithmetic in component eval() functions natural.
//  The value `null` represents an undefined / floating wire — propagates
//  through gates as null.

export const TRIT_COLOR = {
  '-1': '#e35555', '0': '#888c95', '1': '#54c060', undef: '#44485a',
};
export const tritColor = (v) => v == null ? TRIT_COLOR.undef : (TRIT_COLOR[String(v)] || TRIT_COLOR.undef);
export const tritLabel = (v) => v === -1 ? 'T' : v === 0 ? '0' : v === 1 ? '1' : '?';
export const tritClass = (v) => v === -1 ? 'trit-T' : v === 0 ? 'trit-0' : v === 1 ? 'trit-P' : '';

// File format version for save/load.  Increment when the JSON shape
// changes incompatibly so the loader can either upgrade or warn.
export const SAVE_FORMAT_VERSION = 1;

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
