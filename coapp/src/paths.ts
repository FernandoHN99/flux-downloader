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
