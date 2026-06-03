// Build step for the Vercel deploy. Bundles every ES module reachable from
// js/app.js into one minified IIFE, minifies the stylesheet, and emits an
// index.html that points at the bundle. The readable source in js/ + the
// original index.html are left untouched (local dev and the headless test
// runner keep using them); only dist/ is deployed, so the raw modules and the
// internal *.md design docs never reach the server.
//
//   npm run build   →   dist/{index.html, app.min.js, styles.css}
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'dist';
mkdirSync(OUT, { recursive: true });

// 1) Bundle + minify the app. IIFE so the deployed page needs no module/CORS
//    handling and there is no public module graph to walk.
await build({
  entryPoints: ['js/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  outfile: `${OUT}/app.min.js`,
});

// 2) Minify the stylesheet (filename unchanged so index.html's <link> still
//    resolves).
await build({
  entryPoints: ['styles.css'],
  minify: true,
  loader: { '.css': 'css' },
  outfile: `${OUT}/styles.css`,
});

// 3) Emit index.html pointing at the bundle instead of the raw module.
let html = readFileSync('index.html', 'utf8');
const before = html;
html = html.replace(
  /<script\s+type="module"\s+src="js\/app\.js"><\/script>/,
  '<script src="app.min.js"></script>',
);
if (html === before) {
  throw new Error('build: could not find the js/app.js module tag to rewrite in index.html');
}
writeFileSync(`${OUT}/index.html`, html);

console.log('Built dist/ → index.html + app.min.js + styles.css');
