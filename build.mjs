// Build script.
//   node build.mjs site       -> dist/      static site for Cloudflare Pages / any host / Capacitor (default)
//   node build.mjs artifact   -> artifact/  one self-contained HTML file, three.js from a CDN (claude.ai artifact)
//   node build.mjs test       -> test/out/  one HTML file wired to local three.js + fonts (headless tests)
// Add --dev to skip minification.
import { build } from 'esbuild';
import fs from 'node:fs';
import crypto from 'node:crypto';

const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'site';
const dev = process.argv.includes('--dev');
const THREE_VERSION = JSON.parse(fs.readFileSync('node_modules/three/package.json', 'utf8')).version;

const FONTS = [
  ['Unbounded', 'unbounded', [600, 700, 800, 900]],
  ['Chakra Petch', 'chakra-petch', [400, 500, 600, 700]],
];
const fontFile = (pkg, w) => `${pkg}-latin-${w}-normal.woff2`;
const fontFaces = (urlFor) =>
  FONTS.flatMap(([fam, pkg, weights]) =>
    weights.map((w) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(${urlFor(pkg, w)}) format('woff2');}`)
  ).join('\n');

const FAVICON_INLINE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='29' fill='%23ffb547'/%3E%3Cpath d='M32 13l16.5 9.5v19L32 51 15.5 41.5v-19z' fill='%23151b29'/%3E%3Cpath d='M29 25l5-3v20' stroke='%235cc8ff' stroke-width='5' fill='none' stroke-linejoin='round'/%3E%3C/svg%3E";

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

async function bundle(threeFromGlobal) {
  const res = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: threeFromGlobal ? 'iife' : 'esm',
    minify: !dev,
    write: false,
    alias: threeFromGlobal ? { three: './src/three-global.cjs' } : {},
    target: ['es2020', 'safari15'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  return res.outputFiles[0].text;
}

function page(head, scripts) {
  const css = fs.readFileSync('src/style.css', 'utf8');
  return fs
    .readFileSync('src/index.html', 'utf8')
    .replace('<!--__HEAD__-->', () => head)
    .replace('/*__CSS__*/', () => css)
    .replace('<!--__SCRIPTS__-->', () => scripts);
}

// Loads three.js from the given URLs (first that works), then runs the inlined game.
function cdnBoot(urls, gameJs) {
  return `<script type="module">
const THREE_URLS = ${JSON.stringify(urls)};
let T = null;
for (const u of THREE_URLS) {
  try { T = await import(u); break; } catch (e) { console.warn('three.js not loaded from', u); }
}
if (!T) {
  document.getElementById('loadingText').textContent = 'Impossibile caricare il motore 3D. Controlla la connessione e ricarica la pagina.';
} else {
  globalThis.__THREE__ = T;
${gameJs.replace(/<\/script/gi, '<\\/script')}
}
</script>`;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

if (target === 'site') {
  const out = 'dist';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(`${out}/assets`, { recursive: true });
  fs.mkdirSync(`${out}/fonts`, { recursive: true });

  const js = await bundle(false);
  const jsName = `game-${hash(js)}.js`;
  fs.writeFileSync(`${out}/assets/${jsName}`, js);

  const fontFiles = [];
  for (const [, pkg, weights] of FONTS) {
    for (const w of weights) {
      const f = fontFile(pkg, w);
      fs.copyFileSync(`node_modules/@fontsource/${pkg}/files/${f}`, `${out}/fonts/${f}`);
      fontFiles.push(`./fonts/${f}`);
    }
  }
  for (const f of fs.readdirSync('public')) fs.copyFileSync(`public/${f}`, `${out}/${f}`);

  const head = [
    '<link rel="icon" href="./favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="./apple-touch-icon.png">',
    '<link rel="manifest" href="./manifest.webmanifest">',
    `<link rel="preload" href="./fonts/${fontFile('unbounded', 800)}" as="font" type="font/woff2" crossorigin>`,
    `<style>\n${fontFaces((pkg, w) => './fonts/' + fontFile(pkg, w))}\n</style>`,
  ].join('\n');
  const scripts = [`<script type="module" src="./assets/${jsName}"></script>`];
  if (!dev) {
    scripts.push(
      "<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));</script>"
    );
  }
  const html = page(head, scripts.join('\n'));
  fs.writeFileSync(`${out}/index.html`, html);

  const precache = ['./', `./assets/${jsName}`, ...fontFiles, './favicon.svg', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
  const sw = fs
    .readFileSync('src/sw.js', 'utf8')
    .replace('__VERSION__', 'mm-' + hash(html + js))
    .replace('__PRECACHE__', JSON.stringify(precache));
  fs.writeFileSync(`${out}/sw.js`, sw);
  console.log(`dist/index.html ${kb(html.length)} · dist/assets/${jsName} ${kb(js.length)} · ${fontFiles.length} fonts · three ${THREE_VERSION}`);
} else if (target === 'artifact') {
  const js = await bundle(true);
  const urls = [
    `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
    `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
  ];
  const head = [
    `<link rel="icon" href="${FAVICON_INLINE}">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&amp;family=Unbounded:wght@600;700;800;900&amp;display=swap">',
  ].join('\n');
  const html = page(head, cdnBoot(urls, js));
  fs.mkdirSync('artifact', { recursive: true });
  fs.writeFileSync('artifact/index.html', html);
  console.log(`artifact/index.html ${kb(html.length)}`);
} else if (target === 'test') {
  const js = await bundle(true);
  const head = [`<link rel="icon" href="${FAVICON_INLINE}">`, `<style>\n${fontFaces((pkg, w) => `/node_modules/@fontsource/${pkg}/files/${fontFile(pkg, w)}`)}\n</style>`].join('\n');
  const html = page(head, cdnBoot(['/node_modules/three/build/three.module.js'], js));
  fs.mkdirSync('test/out', { recursive: true });
  fs.writeFileSync('test/out/test.html', html);
  console.log(`test/out/test.html ${kb(html.length)}`);
} else {
  console.error(`unknown target "${target}" (use site, artifact or test)`);
  process.exit(1);
}
