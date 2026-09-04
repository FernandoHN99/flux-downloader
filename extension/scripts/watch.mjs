import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');

const targets = [
  ['src/background.ts', 'dist/background.js'],
  ['src/content.ts', 'dist/content.js'],
  ['src/mse-inject.ts', 'dist/mse-inject.js', 'iife'],
  ['src/popup/index.ts', 'dist/popup.js'],
  ['src/popup/settings.ts', 'dist/settings.js'],
  ['src/popup/styles/index.css', 'dist/popup.css']
];

await mkdir(resolve(extensionRoot, 'dist'), { recursive: true });

const contexts = [];
let checker;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (checker && checker.exitCode === null) checker.kill();
  await Promise.all(contexts.map((build) => build.dispose()));
  process.exit(exitCode);
}

try {
  for (const [entryPoint, outfile, format] of targets) {
    contexts.push(await context({
      entryPoints: [resolve(extensionRoot, entryPoint)],
      outfile: resolve(extensionRoot, outfile),
      bundle: true,
      platform: 'browser',
      ...(format ? { format } : {})
    }));
  }

  await Promise.all(contexts.map((build) => build.watch()));

  checker = spawn(process.execPath, [
    tscPath,
    '-p', 'tsconfig.json',
    '--noEmit',
    '--watch',
    '--preserveWatchOutput'
  ], {
    cwd: extensionRoot,
    stdio: 'inherit'
  });

  checker.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[watch] TypeScript exited (${signal || code || 0}).`);
    void stop(code || 1);
  });

  process.once('SIGINT', () => { void stop(0); });
  process.once('SIGTERM', () => { void stop(0); });
  console.log('[watch] Extension type-checker and six bundles are watching for changes.');
} catch (error) {
  console.error('[watch] Could not start extension watchers:', error);
  await stop(1);
}
