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
 * The renditions to try when the chosen one turned out not to exist. A master
 * playlist can list a rendition its server answers 404 for (a 4K that was never
 * encoded), so "Best" would otherwise fail on a lesson that downloads fine at
 * 1080p. Those at or below the failed height come first, best to worst: the
 * user wanted that quality or lower, never silently something heavier.
 */
export function rankFallbackRenditions(
  qualities: readonly VideoQuality[],
  failed: VideoQuality
): VideoQuality[] {
  const isVideo = (quality: VideoQuality) => (quality.kind || 'video') === 'video';
  const others = qualities.filter((quality) =>
    quality.url !== failed.url && isVideo(quality) === isVideo(failed)
  );
  const byHeight = (a: VideoQuality, b: VideoQuality) => (b.height || 0) - (a.height || 0);
  const limit = failed.height || 0;
  const atOrBelow = others.filter((quality) => (quality.height || 0) <= limit).sort(byHeight);
  const above = others.filter((quality) => (quality.height || 0) > limit).sort(byHeight);
  return limit > 0 ? [...atOrBelow, ...above] : others.sort(byHeight);
}

/**
 * Pick every batch rendition up front and give every file a distinct name.
 *
 * Files are numbered by when their video was added, so a course sorts in the
 * order it was watched: `01-Lesson.mp4`. The batch is newest-first (the order
 * the history stores), so the last video is 01 and the first is the total. The
 * number is the position in the list, whether or not that video could be
 * planned, so a gap in the numbers means a lesson is missing, and it also makes
 * every name unique, which parallel starts need: they would otherwise all see
 * the same title as free before any process creates its file. A batch of one
 * has nothing to order and stays unnumbered.
 */
export function buildBatchDownloadPlans(
  videos: readonly VideoInfo[],
  preference: QualityPreference
): BatchDownloadPlan[] {
  const total = videos.length;
  return videos.map((source, index) => {
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
        `${batchNumberPrefix(total - index, total)}${sanitizeFilename(source.title || 'video')}`,
        getDefaultExtension(selected, type)
      )
    };
  });
}

/**
 * `01-` for the first of a batch, padded to the width of the total (two digits
 * at least) so a file manager sorts the names as the course runs.
 */
export function batchNumberPrefix(position: number, total: number): string {
  if (total < 2) return '';
  const width = Math.max(2, String(total).length);
  return `${String(position).padStart(width, '0')}-`;
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
