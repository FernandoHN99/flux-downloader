import type { PageMetadata } from '../catalog/tab-state';
import type { VideoInfo } from '../shared/types';

/**
 * Merge metadata while preserving top-frame ownership. Child frames may fill
 * missing presentation data, but never replace the source page URL/title.
 */
export function mergePageMetadata(
  previous: PageMetadata,
  incoming: PageMetadata,
  isTopFrame: boolean
): PageMetadata {
  return {
    pageUrl: isTopFrame ? (incoming.pageUrl || previous.pageUrl) : previous.pageUrl,
    title: isTopFrame
      ? (incoming.title || previous.title)
      : (previous.title || incoming.title),
    thumbnail: isTopFrame
      ? (incoming.thumbnail || previous.thumbnail)
      : (previous.thumbnail || incoming.thumbnail),
    duration: incoming.duration || previous.duration,
    generation: isTopFrame ? incoming.generation : previous.generation
  };
}

/** Apply authoritative page context without replacing richer media metadata. */
export function applyPageMetadataToVideos(
  videos: VideoInfo[],
  metadata: PageMetadata
): VideoInfo[] {
  let changed = false;
  const updated = videos.map((video) => {
    const next: VideoInfo = {
      ...video,
      pageUrl: metadata.pageUrl || video.pageUrl,
      thumbnail: video.thumbnail || metadata.thumbnail,
      duration: video.duration || metadata.duration
    };
    changed = changed || next.pageUrl !== video.pageUrl ||
      next.thumbnail !== video.thumbnail || next.duration !== video.duration;
    return next;
  });
  return changed ? updated : videos;
}
