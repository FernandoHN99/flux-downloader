import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { findRuntimeExecutable, getRuntimeBinary } from './paths';

describe('runtime executable discovery', () => {
  const originalInstallDir = process.env.FLUX_INSTALL_DIR;
  const originalPath = process.env.PATH;
  const temporaryRoots: string[] = [];

  afterEach(() => {
    if (originalInstallDir === undefined) delete process.env.FLUX_INSTALL_DIR;
    else process.env.FLUX_INSTALL_DIR = originalInstallDir;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds a bundled executable even when the browser PATH is restricted', () => {
    const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-runtime-'));
    temporaryRoots.push(installRoot);
    const executable = path.join(installRoot, getRuntimeBinary('ffprobe'));
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(executable, 0o755);
    process.env.FLUX_INSTALL_DIR = installRoot;
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

    expect(findRuntimeExecutable('ffprobe')).toBe(executable);
  });
});
