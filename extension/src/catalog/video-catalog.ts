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
 * Whether a network-seen manifest is already represented, so fetching and
 * parsing it again would only produce a duplicate. Another host serving the
 * same path is a redirect chain and counts as covered. A bare sighting on the
 * *same* host does not: the page reported the playlist before it was parsed,
 * and skipping the parse would leave that row without renditions for good, so
 * its variants would show up as separate rows.
 */
export function isManifestCovered(
  videos: readonly VideoInfo[],
  url: string,
  type: VideoInfo['type']
): boolean {
  let path: string;
  try { path = new URL(url).pathname; } catch { return false; }
  const key = videoKey(url);

  return videos.some((existing) => {
    if (existing.type !== type) return false;
    try {
      if (new URL(existing.url).pathname !== path) return false;
    } catch { return false; }
    const unparsedSameHost = videoKey(existing.url) === key && !existing.qualities?.length;
    return !unparsedSameHost;
  });
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
    // Signed links rotate, so a variant is matched to its master by identity:
    // the master listed it under one token and the network reports another.
    const ownKey = videoKey(video.url);
    const childKeys = new Set([
      ...(video.qualities || []).map((quality) => videoKey(quality.url)),
      ...(video.childUrls || []).map(videoKey)
    ]);

    const belongsToExistingMaster = current.some((existing) =>
      existing.type === 'hls' &&
      videoKey(existing.url) !== ownKey &&
      (
        existing.qualities?.some((quality) => videoKey(quality.url) === ownKey) ||
        existing.childUrls?.some((url) => videoKey(url) === ownKey)
      )
    );
    if (belongsToExistingMaster) return videos;

    if (childKeys.size > 0) {
      current = current.filter((existing) => {
        const key = videoKey(existing.url);
        return !(existing.type === 'hls' && key !== ownKey && childKeys.has(key));
      });
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
    // The page also reports the capture's blob URL as a plain <video src>.
    // Only the MSE capture carries the segment arguments, so it keeps the type.
    type: existing.type === 'mse' ? existing.type : video.type,
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
