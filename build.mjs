// Build step for the Vercel deploy. Bundles every ES module reachable from
// js/app.js into one minified IIFE, runs it through javascript-obfuscator, then
// emits the obfuscated bundle + a minified stylesheet + an index.html that
// points at the bundle. The readable source in js/ + the original index.html
// are left untouched (local dev and the headless test runner keep using them);
// only dist/ is deployed, so the raw modules and the internal *.md design docs
// never reach the server.
//
//   npm run build              →  dist/{index.html, app.min.js, styles.css}
//   OBFUSCATE=0 npm run build  →  same, but minify-only (faster, debuggable)
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'dist';
const OBFUSCATE = process.env.OBFUSCATE !== '0';
mkdirSync(OUT, { recursive: true });

// 1) Bundle + minify the app into one IIFE (no public module graph to walk).
//    write:false so we can hand the code to the obfuscator before it hits disk.
const result = await build({
  entryPoints: ['js/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  write: false,
  outfile: `${OUT}/app.min.js`,
});
let code = result.outputFiles[0].text;

// 2) Obfuscate. Deliberately a MODERATE profile, not max-paranoia: this app has
//    a hot simulation/animation loop, and the heavy options (full control-flow
//    flattening, dead-code injection, object-key transforms) wreck runtime perf
//    and are the most likely to subtly break the app. Notably OFF:
//      · debugProtection / selfDefending — the user-hostile "freeze devtools"
//        traps; trivially bypassed and they punish legitimate inspection.
//      · transformObjectKeys / deadCodeInjection — break risk + size bloat.
//    Obfuscation raises the casual-reader bar; it is a deterrent, not a lock.
//    Dial controlFlowFlatteningThreshold down (or OBFUSCATE=0) if the sim feels
//    sluggish.
if (OBFUSCATE) {
  code = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'mangled-shuffled',
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: false,
    debugProtection: false,
    selfDefending: false,
    disableConsoleOutput: false,
    numbersToExpressions: false,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayCallsTransform: true,
    stringArrayWrappersType: 'variable',
  }).getObfuscatedCode();
}
writeFileSync(`${OUT}/app.min.js`, code);

// 3) Minify the stylesheet (filename unchanged so index.html's <link> resolves).
await build({
  entryPoints: ['styles.css'],
  minify: true,
  loader: { '.css': 'css' },
  outfile: `${OUT}/styles.css`,
});

// 4) Emit the app page (app.html) pointing at the bundle instead of the raw
//    module. The simulator lives at /app since the I1 front door took over "/".
let html = readFileSync('app.html', 'utf8');
const before = html;
html = html.replace(
  /<script\s+type="module"\s+src="js\/app\.js"><\/script>/,
  '<script src="app.min.js"></script>',
);
if (html === before) {
  throw new Error('build: could not find the js/app.js module tag to rewrite in app.html');
}
writeFileSync(`${OUT}/app.html`, html);

// 5) Copy the landing page (index.html) verbatim — it's self-contained (inline
//    CSS + a tiny vanilla-JS demo + the share-link redirect shim), so it needs
//    no bundling, just to be served at "/".
writeFileSync(`${OUT}/index.html`, readFileSync('index.html', 'utf8'));

console.log(`Built dist/ → index.html (landing) + app.html + app.min.js (${OBFUSCATE ? 'obfuscated' : 'minify-only'}) + styles.css`);
