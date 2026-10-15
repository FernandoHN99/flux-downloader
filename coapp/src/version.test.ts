import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const root = path.resolve(__dirname, '..', '..');
const readJson = (relative: string) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

// A release is `npm run version:set`. If someone edits one of these by hand,
// the installer, the manifest and the host would each report a different
// version.
describe('version', () => {
  it('is the same in every file that carries it', () => {
    expect(readJson('coapp/package.json').version).toBe(VERSION);
    expect(readJson('extension/package.json').version).toBe(VERSION);
    expect(readJson('extension/manifest.json').version).toBe(VERSION);
    expect(readJson('package.json').version).toBe(VERSION);
  });
});
