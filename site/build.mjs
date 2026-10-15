// Builds the download page into _site/ (what GitHub Pages serves).
//
//   node site/build.mjs
//
// The page is plain HTML and CSS. The only script that matters is the popup
// demo, which is the extension's own popup code and stylesheet bundled with a
// stand-in background, so the demo is always the current interface and cannot
// drift from it.

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'demo'), { recursive: true });

await build({
  entryPoints: [join(root, 'site', 'demo', 'entry.ts')],
  outfile: join(out, 'demo', 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  logLevel: 'warning'
});
await build({
  entryPoints: [join(root, 'extension', 'src', 'popup', 'styles', 'index.css')],
  outfile: join(out, 'demo', 'popup.css'),
  bundle: true,
  logLevel: 'warning'
});

// The demo page is the extension's popup.html with its two assets pointed at
// the bundles above, and without the Settings button, which has nowhere to go.
const popup = await readFile(join(root, 'extension', 'src', 'popup', 'popup.html'), 'utf8');
const demo = popup
  .replace('../../dist/popup.css', 'popup.css')
  .replace('../../dist/popup.js', 'app.js')
  .replace('</head>', '  <style>#settings-btn { display: none; }</style>\n</head>');
if (demo === popup || !demo.includes('app.js') || !demo.includes('popup.css')) {
  throw new Error('extension/src/popup/popup.html no longer has the asset paths the demo build rewrites');
}
await writeFile(join(out, 'demo', 'index.html'), demo);

for (const file of ['index.html', 'site.css', 'site.js']) {
  await copyFile(join(root, 'site', file), join(out, file));
}
await copyFile(join(root, 'extension', 'public', 'icons', 'icon-128.png'), join(out, 'icon.png'));
await copyFile(join(root, 'extension', 'public', 'icons', 'icon-32.png'), join(out, 'favicon.png'));
await writeFile(join(out, '.nojekyll'), '');

console.log(`Built ${out}`);
