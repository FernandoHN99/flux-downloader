import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const platformFolder = process.platform === 'win32' ? 'win' : process.platform;
const executableSuffix = process.platform === 'win32' ? '.exe' : '';

export function getInstallDir(): string {
  if (process.env.FLUX_INSTALL_DIR) {
    return process.env.FLUX_INSTALL_DIR;
  }

  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FluxDownloader');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'FluxDownloader');
  }

  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'FluxDownloader');
}

export function getRuntimeRoots(): string[] {
  return Array.from(new Set([
    process.env.FLUX_HOME,
    process.cwd(),
    getInstallDir(),
    path.dirname(process.execPath),
    path.resolve(__dirname, '..')
  ].filter((value): value is string => Boolean(value))));
}

export function getRuntimeBinary(kind: 'ffmpeg' | 'ffprobe' | 'ytdlp'): string {
  const name = kind === 'ytdlp' ? `yt-dlp${executableSuffix}` : `${kind}${executableSuffix}`;
  const folder = kind === 'ytdlp' ? 'ytdlp' : 'ffmpeg';
  return path.join(folder, platformFolder, name);
}

export function findRuntimeExecutable(
  kind: 'ffmpeg' | 'ffprobe' | 'ytdlp',
  extraCandidates: string[] = []
): string {
  const name = kind === 'ytdlp' ? `yt-dlp${executableSuffix}` : `${kind}${executableSuffix}`;
  const systemDirs = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    : process.platform === 'win32'
      ? []
      : [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin'];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [
    ...getRuntimeRoots().map(root => path.join(root, getRuntimeBinary(kind))),
    ...extraCandidates,
    ...systemDirs.map(dir => path.join(dir, name)),
    ...pathDirs.map(dir => path.join(dir, name))
  ];

  for (const candidate of new Set(candidates)) {
    try {
      fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep looking. The bare command below gives a useful spawn error when
      // a runtime genuinely is not installed anywhere we know about.
    }
  }
  return name;
}

export function getHostBinaryPath(): string {
  return path.join(getInstallDir(), `coapp${executableSuffix}`);
}

export interface NativeMessagingTarget {
  browser: string;
  /** The folder this browser reads native messaging host manifests from. */
  dir: string;
}

/**
 * Every Chromium-based browser Flux can register with on macOS and Linux.
 * Windows has no such folders: it registers through the registry instead.
 *
 * `scripts/install.sh` carries the same list in bash; a test keeps the two
 * from drifting apart.
 */
export function nativeMessagingTargets(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  configHome: string | undefined = process.env.XDG_CONFIG_HOME
): NativeMessagingTarget[] {
  if (platform === 'darwin') {
    const support = path.posix.join(home, 'Library', 'Application Support');
    return [
      { browser: 'Google Chrome', dir: path.posix.join(support, 'Google', 'Chrome', 'NativeMessagingHosts') },
      { browser: 'Chromium', dir: path.posix.join(support, 'Chromium', 'NativeMessagingHosts') },
      { browser: 'Brave', dir: path.posix.join(support, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
      { browser: 'Microsoft Edge', dir: path.posix.join(support, 'Microsoft Edge', 'NativeMessagingHosts') },
      { browser: 'Vivaldi', dir: path.posix.join(support, 'Vivaldi', 'NativeMessagingHosts') }
    ];
  }
  if (platform === 'linux') {
    const config = configHome || path.posix.join(home, '.config');
    return [
      { browser: 'Google Chrome', dir: path.posix.join(config, 'google-chrome', 'NativeMessagingHosts') },
      { browser: 'Chromium', dir: path.posix.join(config, 'chromium', 'NativeMessagingHosts') },
      { browser: 'Brave', dir: path.posix.join(config, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
      { browser: 'Microsoft Edge', dir: path.posix.join(config, 'microsoft-edge', 'NativeMessagingHosts') },
      { browser: 'Vivaldi', dir: path.posix.join(config, 'vivaldi', 'NativeMessagingHosts') }
    ];
  }
  return [];
}

/**
 * The browsers that are actually installed, told by their profile folder
 * existing: registering for a browser nobody uses would only litter its config
 * directory. When none is found Chrome is registered anyway, because a browser
 * that has never been started has no profile folder yet.
 */
export function installedNativeMessagingTargets(
  targets: NativeMessagingTarget[] = nativeMessagingTargets(),
  exists: (candidate: string) => boolean = (candidate) => fs.existsSync(candidate)
): NativeMessagingTarget[] {
  const present = targets.filter((target) => exists(path.posix.dirname(target.dir)));
  return present.length > 0 ? present : targets.slice(0, 1);
}
