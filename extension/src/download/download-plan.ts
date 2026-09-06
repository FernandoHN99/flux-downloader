import type { VideoInfo, VideoQuality } from '../shared/types';

export type QualityPreference = 'best' | 'worst';

export interface BatchDownloadPlan {
  source: VideoInfo;
  selected?: VideoInfo;
  filename?: string;
}

export function pickBatchQuality(
  video: VideoInfo,
  preference: QualityPreference
): VideoQuality | undefined {
  const all = video.qualities || [];
  const videoOnly = all.filter((quality) => (quality.kind || 'video') === 'video');
  const candidates = videoOnly.length > 0 ? videoOnly : all;
  if (candidates.length === 0) return undefined;

  return candidates.reduce((chosen, quality) => {
    const better = preference === 'worst'
      ? (quality.height || 0) < (chosen.height || 0)
      : (quality.height || 0) > (chosen.height || 0);
    return better ? quality : chosen;
  }, candidates[0]);
}

/**
 * Pick every batch rendition up front and reserve distinct sanitized names.
 * A fresh batch directory is empty, but parallel starts can otherwise all see
 * the same title as available before any process creates its output file.
 */
export function buildBatchDownloadPlans(
  videos: readonly VideoInfo[],
  preference: QualityPreference
): BatchDownloadPlan[] {
  const plans = videos.map((source) => {
    const quality = pickBatchQuality(source, preference);
    if (!quality) return { source };
    const selected: VideoInfo = { ...source, url: quality.url, qualities: [quality] };
    const type = selected.type === 'm3u8'
      ? 'hls'
      : selected.type === 'mpd'
        ? 'dash'
        : selected.type;
    return {
      source,
      selected,
      filename: ensureFilenameExtension(
        sanitizeFilename(source.title || 'video'),
        getDefaultExtension(selected, type)
      )
    };
  });

  const used = new Set<string>();
  for (const plan of plans) {
    if (!plan.filename) continue;
    const original = plan.filename;
    let candidate = original;
    let suffix = 0;
    while (used.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = appendFilenameSuffix(original, suffix);
    }
    used.add(candidate.toLowerCase());
    plan.filename = candidate;
  }
  return plans;
}

export function sanitizeFilename(name: string, now = Date.now()): string {
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return sanitized || `video_${now}`;
}

export function ensureFilenameExtension(filename: string, extension: string): string {
  const baseName = filename.replace(
    /\.(mp4|webm|mkv|mov|m4v|avi|ts|m3u8|mp3|m4a|aac|opus|wav|flac|vtt|srt|ttml)$/i,
    ''
  );
  return `${baseName}.${extension.replace(/^\./, '')}`;
}

function appendFilenameSuffix(filename: string, suffix: number): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}_${suffix}`;
  return `${filename.slice(0, dot)}_${suffix}${filename.slice(dot)}`;
}

export function getDefaultExtension(
  video: VideoInfo,
  type: VideoInfo['type']
): string {
  const quality = video.qualities[0];
  if (quality?.kind === 'subtitle') return quality.ext || 'vtt';
  if (quality?.kind === 'audio') return quality.ext || 'm4a';
  if (type === 'webm') return 'webm';
  if (quality?.ext === 'mp3') return 'mp3';
  return 'mp4';
}

export function formatFfmpegError(exitCode: number | null, stderr: string): string {
  const details = stderr.trim();
  if (/HTTP error (401|403|410)|Server returned 4XX/i.test(details)) {
    return 'Ссылка на поток недоступна или устарела. Запустите плеер заново и повторите загрузку.';
  }
  if (/Invalid data found|Error opening input/i.test(details)) {
    return 'FFmpeg не смог открыть поток. Запустите плеер на несколько секунд и повторите загрузку.';
  }
  return `FFmpeg exit code ${exitCode}: ${details.slice(-1000)}`;
}

export function joinOutputPath(
  directory: string,
  filename: string,
  platform: string
): string {
  if (!directory) return filename;
  const separator = platform === 'win32' ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${filename}`;
}
