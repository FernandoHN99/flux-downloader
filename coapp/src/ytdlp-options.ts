export const YTDLP_CONCURRENT_FRAGMENTS = 8;

export function buildYtDlpDownloadArgs(
  url: string,
  selectedArgs: string[],
  outputTemplate: string,
  ffmpegDir?: string
): string[] {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--concurrent-fragments', String(YTDLP_CONCURRENT_FRAGMENTS),
    '-o', outputTemplate
  ];
  if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir);
  return [...args, ...selectedArgs, url];
}
