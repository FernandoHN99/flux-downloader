import type { VideoInfo } from '../shared/types';
import { isYouTubeUrl } from '../detection/media-url';
import { videoKey } from '../detection/video-key';

export function mergeQualities(
  first: VideoInfo['qualities'] = [],
  second: VideoInfo['qualities'] = []
): VideoInfo['qualities'] {
  const merged = new Map<string, VideoInfo['qualities'][number]>();
  for (const quality of [...first, ...second]) {
    if (quality?.url && !merged.has(quality.url)) merged.set(quality.url, quality);
  }
  return [...merged.values()];
}

export function mergeChildUrls(first?: string[], second?: string[]): string[] | undefined {
  const merged = [...new Set([...(first || []), ...(second || [])])];
  return merged.length > 0 ? merged : undefined;
}

/**
 * Keep the user-facing representation of a tab small and useful. YouTube is
 * owned by yt-dlp; elsewhere, entries with a known duration outrank incidental
 * requests made by the same page.
 */
export function visibleVideos(videos: VideoInfo[], pageUrl?: string): VideoInfo[] {
  if (pageUrl && isYouTubeUrl(pageUrl)) {
    return videos.filter((video) => video.type === 'ytdlp');
  }

  const timed = videos.filter((video) =>
    typeof video.duration === 'number' && Number.isFinite(video.duration) && video.duration > 0
  );
  return timed.length > 0 ? timed : videos;
}

/**
 * Add or update one detected entry without mutating the previous snapshot.
 * Master HLS playlists own their variants, so child manifests never become
 * duplicate rows and are removed if the master arrives later.
 */
export function upsertDetectedVideo(
  videos: VideoInfo[],
  incoming: VideoInfo,
  ownerPageUrl?: string
): VideoInfo[] {
  const video: VideoInfo = {
    ...incoming,
    pageUrl: ownerPageUrl || incoming.pageUrl || undefined
  };
  let current = videos;

  if (video.type === 'hls') {
    const childUrls = new Set([
      ...(video.qualities || []).map((quality) => quality.url),
      ...(video.childUrls || [])
    ]);

    const belongsToExistingMaster = current.some((existing) =>
      existing.type === 'hls' &&
      existing.url !== video.url &&
      (
        existing.qualities?.some((quality) => quality.url === video.url) ||
        existing.childUrls?.includes(video.url)
      )
    );
    if (belongsToExistingMaster) return videos;

    if (childUrls.size > 0) {
      current = current.filter((existing) =>
        !(existing.type === 'hls' && existing.url !== video.url && childUrls.has(existing.url))
      );
    }
  }

  // Identity is videoKey, not the raw URL: a signed CDN link comes back with a
  // rotated token on every visit, and matching the exact string would append a
  // second row for the same video.
  const key = videoKey(video.url);
  const existingIndex = current.findIndex((existing) => videoKey(existing.url) === key);
  if (existingIndex < 0) return [...current, video];

  const existing = current[existingIndex];
  const updated: VideoInfo = {
    ...existing,
    ...video,
    title: video.title || existing.title,
    pageUrl: video.pageUrl || existing.pageUrl,
    qualities: video.qualities?.length ? video.qualities : existing.qualities,
    childUrls: video.childUrls?.length ? video.childUrls : existing.childUrls,
    thumbnail: video.thumbnail || existing.thumbnail,
    duration: video.duration || existing.duration,
    fileSize: video.fileSize || existing.fileSize
  };

  return [
    ...current.slice(0, existingIndex),
    updated,
    ...current.slice(existingIndex + 1)
  ];
}
