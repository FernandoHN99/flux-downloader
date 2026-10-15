import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findRuntimeExecutable, getRuntimeBinary, installedNativeMessagingTargets, nativeMessagingTargets
} from './paths';

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

describe('native messaging targets', () => {
  it('lists the Chromium-based browsers for macOS, under Application Support', () => {
    const dirs = nativeMessagingTargets('darwin', '/Users/ana').map((target) => target.dir);

    expect(dirs).toContain('/Users/ana/Library/Application Support/Google/Chrome/NativeMessagingHosts');
    expect(dirs).toContain('/Users/ana/Library/Application Support/Microsoft Edge/NativeMessagingHosts');
    expect(dirs).toContain('/Users/ana/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts');
  });

  it('lists them for Linux under ~/.config, or under XDG_CONFIG_HOME when it is set', () => {
    expect(nativeMessagingTargets('linux', '/home/ana', {})[0].dir)
      .toBe('/home/ana/.config/google-chrome/NativeMessagingHosts');
    expect(nativeMessagingTargets('linux', '/home/ana', { XDG_CONFIG_HOME: '/home/ana/cfg' })[0].dir)
      .toBe('/home/ana/cfg/google-chrome/NativeMessagingHosts');
  });

  it('has none for Windows, which registers through the registry', () => {
    expect(nativeMessagingTargets('win32', 'C:\\Users\\ana')).toEqual([]);
  });

  it('registers only with browsers whose profile folder exists', () => {
    const targets = nativeMessagingTargets('linux', '/home/ana', {});
    const present = new Set(['/home/ana/.config/chromium', '/home/ana/.config/microsoft-edge']);

    const installed = installedNativeMessagingTargets(targets, (folder) => present.has(folder));

    expect(installed.map((target) => target.browser)).toEqual(['Chromium', 'Microsoft Edge']);
  });

  it('falls back to Chrome when no browser has run yet', () => {
    const targets = nativeMessagingTargets('linux', '/home/ana', {});

    expect(installedNativeMessagingTargets(targets, () => false).map((target) => target.browser))
      .toEqual(['Google Chrome']);
  });

  // install.sh keeps the same list in bash. Both must name the same folders, or
  // a browser gets registered by one install route and missed by the other.
  it('matches the folders scripts/install.sh registers with', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'install.sh'), 'utf8');
    const roots = {
      darwin: { base: '/Users/ana/Library/Application Support', variable: '$SUPPORT' },
      linux: { base: '/home/ana/.config', variable: '$CONFIG' }
    } as const;

    for (const platform of ['darwin', 'linux'] as const) {
      const { base, variable } = roots[platform];
      const home = platform === 'darwin' ? '/Users/ana' : '/home/ana';
      for (const { dir } of nativeMessagingTargets(platform, home, {})) {
        const relative = path.posix.relative(base, dir);
        expect(script, `${platform}: ${relative}`).toContain(`${variable}/${relative}`);
      }
    }
  });
});
