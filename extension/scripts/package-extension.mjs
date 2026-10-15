import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageExtension } from './stage-extension.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(extensionRoot, process.env.MEDIA_GRABBER_OUTPUT || 'FluxDownloader-extension.zip');
const stagingPath = await mkdtemp(join(tmpdir(), 'flux-downloader-extension-'));

try {
  await stageExtension(stagingPath);

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
