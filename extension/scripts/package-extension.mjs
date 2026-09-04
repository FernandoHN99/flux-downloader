import { access, cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(extensionRoot, process.env.MEDIA_GRABBER_OUTPUT || 'FluxDownloader-extension.zip');
const stagingPath = await mkdtemp(join(tmpdir(), 'flux-downloader-extension-'));

async function validateLocalAssets(relativeHtmlPath) {
  const htmlPath = join(stagingPath, relativeHtmlPath);
  const html = await readFile(htmlPath, 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((reference) => reference && !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

  for (const reference of references) {
    const assetPath = resolve(dirname(htmlPath), reference.split(/[?#]/, 1)[0]);
    if (!assetPath.startsWith(`${stagingPath}${sep}`)) {
      throw new Error(`Packaged HTML references a path outside the archive: ${reference}`);
    }
    try {
      await access(assetPath);
    } catch {
      throw new Error(`${relativeHtmlPath} references missing packaged asset: ${reference}`);
    }
  }
}

try {
  const manifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
  if (process.env.MEDIA_GRABBER_VERSION) {
    manifest.version = process.env.MEDIA_GRABBER_VERSION;
  }
  await writeFile(join(stagingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bundleFiles = [
    'background.js',
    'content.js',
    'mse-inject.js',
    'popup.js',
    'popup.css',
    'settings.js'
  ];
  await mkdir(join(stagingPath, 'dist'));
  for (const file of bundleFiles) {
    await copyFile(join(extensionRoot, 'dist', file), join(stagingPath, 'dist', file));
  }
  await cp(join(extensionRoot, 'public'), join(stagingPath, 'public'), { recursive: true });
  await cp(join(extensionRoot, 'src', 'popup'), join(stagingPath, 'src', 'popup'), {
    recursive: true,
    filter: (source) => source.endsWith(`${join('src', 'popup')}`) || /\.(html|css)$/.test(source)
  });
  await Promise.all([
    validateLocalAssets(join('src', 'popup', 'popup.html')),
    validateLocalAssets(join('src', 'popup', 'settings.html'))
  ]);

  const archiveCommand = process.platform === 'win32'
    ? [
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `$staging = '${stagingPath.replaceAll("'", "''")}'; ` +
        `$output = '${outputPath.replaceAll("'", "''")}'; ` +
        'Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $output -Force']
    ]
    : [
      'zip',
      ['-qr', outputPath, '.']
    ];

  const result = spawnSync(archiveCommand[0], archiveCommand[1], {
    cwd: stagingPath,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`Could not create extension archive (exit code ${result.status})`);
  }

  console.log(`Created ${outputPath}`);
} finally {
  await rm(stagingPath, { recursive: true, force: true });
}
