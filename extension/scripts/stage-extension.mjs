import { access, cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The version to stamp into the packaged manifest, if the caller set one. */
export function requestedVersion() {
  return process.env.FLUX_VERSION || process.env.MEDIA_GRABBER_VERSION || undefined;
}

async function validateLocalAssets(stagingPath, relativeHtmlPath) {
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

/**
 * Copies exactly what the browser needs into `stagingPath` (an empty folder):
 * the manifest, the built bundles, the icons and the two HTML pages with their
 * styles. Used for the extension archive and for the portable bundle, so both
 * contain the same files. Fails if a packaged page points at a missing asset.
 */
export async function stageExtension(stagingPath) {
  const manifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
  const version = requestedVersion();
  if (version) manifest.version = version;
  await writeFile(join(stagingPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const bundleFiles = ['background.js', 'content.js', 'mse-inject.js', 'popup.js', 'popup.css', 'settings.js'];
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
    validateLocalAssets(stagingPath, join('src', 'popup', 'popup.html')),
    validateLocalAssets(stagingPath, join('src', 'popup', 'settings.html'))
  ]);
  return manifest;
}
