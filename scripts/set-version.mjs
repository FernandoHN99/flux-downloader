// Sets the version everywhere it is written, so a release is one command and
// the files cannot disagree.
//
//   node scripts/set-version.mjs 1.2.0

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/set-version.mjs MAJOR.MINOR.PATCH');
  process.exit(1);
}

async function editJson(relativePath, edit) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  edit(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`updated ${relativePath}`);
}

await editJson('package.json', (json) => { json.version = version; });
await editJson('extension/package.json', (json) => { json.version = version; });
await editJson('coapp/package.json', (json) => { json.version = version; });
await editJson('extension/manifest.json', (json) => { json.version = version; });
await editJson('package-lock.json', (json) => {
  json.version = version;
  for (const key of ['', 'extension', 'coapp']) {
    if (json.packages?.[key]) json.packages[key].version = version;
  }
});

const versionFile = join(root, 'coapp/src/version.ts');
const source = await readFile(versionFile, 'utf8');
const updated = source.replace(/VERSION = '[^']*'/, `VERSION = '${version}'`);
if (updated === source && !source.includes(`'${version}'`)) throw new Error('Could not find VERSION in coapp/src/version.ts');
await writeFile(versionFile, updated);
console.log('updated coapp/src/version.ts');
