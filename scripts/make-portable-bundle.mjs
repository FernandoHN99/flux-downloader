// Builds the portable release archive for macOS and Linux: everything already
// built, so installing is `./install.sh` and nothing is compiled on the
// user's machine. Run `npm run build` and `npm run bundle --workspace coapp`
// first (the `package:portable` script does all three).
//
//   node scripts/make-portable-bundle.mjs [output.tar.gz]

import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageExtension } from '../extension/scripts/stage-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, 'release', 'flux-downloader-portable.tar.gz'));
const NAME = 'flux-downloader-portable';

async function requireFile(path, hint) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Missing ${path}. ${hint}`);
  }
}

await requireFile(join(root, 'coapp', 'dist', 'main.bundle.cjs'), 'Run: npm run bundle --workspace coapp');
await requireFile(join(root, 'extension', 'dist', 'background.js'), 'Run: npm run build');

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const work = await mkdtemp(join(tmpdir(), 'flux-portable-'));
const stage = join(work, NAME);

try {
  await mkdir(join(stage, 'extension'), { recursive: true });
  await mkdir(join(stage, 'coapp'));
  await stageExtension(join(stage, 'extension'));
  await copyFile(join(root, 'coapp', 'dist', 'main.bundle.cjs'), join(stage, 'coapp', 'main.bundle.cjs'));
  await copyFile(join(root, 'scripts', 'install.sh'), join(stage, 'install.sh'));
  await chmod(join(stage, 'install.sh'), 0o755);
  await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  await copyFile(join(root, 'THIRD_PARTY_NOTICES.md'), join(stage, 'THIRD_PARTY_NOTICES.md'));
  await writeFile(join(stage, 'VERSION'), `${version}\n`);
  await writeFile(join(stage, 'README.txt'), `Flux Downloader ${version}, portable archive for macOS and Linux.

  ./install.sh              install or update (no root needed)
  ./install.sh --yt-dlp     also fetch yt-dlp, which YouTube needs
  ./install.sh --uninstall  remove it again

Needs Node.js 18 or newer and FFmpeg. The installer checks both, tells you
what is missing, and prints the last step: loading the extension folder in
your browser (chrome://extensions, Developer mode, Load unpacked).

Project, docs and issues: https://github.com/FernandoHN99/flux-downloader
`);

  await mkdir(dirname(output), { recursive: true });
  const tar = spawnSync('tar', ['-czf', output, '-C', work, NAME], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`tar failed with exit code ${tar.status}`);
  console.log(`Created ${output} (${version})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
