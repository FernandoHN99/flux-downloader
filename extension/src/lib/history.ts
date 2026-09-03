import type { HistoryEntry, VideoInfo } from './types';
import { videoKey } from './video-key';

export interface HistoryPageContext {
  pageUrl?: string;
  pageTitle?: string;
}

/**
 * Places freshly detected videos first and carries their page context into
 * persistent history. The page URL is deliberately distinct from the media
 * URL: a Rocketseat lesson may stream from a b-cdn.net host, but it still
 * belongs to the Rocketseat page that exposed it.
 */
export function mergeDetectedVideosIntoHistory(
  history: HistoryEntry[],
  videos: VideoInfo[],
  context: HistoryPageContext,
  now: number,
  limit: number
): HistoryEntry[] {
  const previous = new Map(history.map((entry) => [videoKey(entry.url), entry]));

  const incoming = videos.map((video): HistoryEntry => {
    const key = videoKey(video.url);
    const existing = previous.get(key);
    previous.delete(key);

    // Content-script generations are transport metadata, not history data.
    const { generation: _generation, ...persistedVideo } = video as VideoInfo & { generation?: number };
    return {
      ...persistedVideo,
      pageUrl: context.pageUrl || video.pageUrl || existing?.pageUrl,
      pageTitle: context.pageTitle || existing?.pageTitle,
      detectedAt: now
    };
  });

  return [
    ...incoming,
    ...history.filter((entry) => previous.has(videoKey(entry.url)))
  ].slice(0, limit);
}

/**
 * Compares the fields that define list identity and source ownership while
 * ignoring volatile detection timestamps and signed URL query strings.
 */
export function sameHistoryContent(a: HistoryEntry[], b: HistoryEntry[]): boolean {
  return historySignature(a) === historySignature(b);
}

function historySignature(entries: HistoryEntry[]): string {
  return JSON.stringify(entries.map((entry) => [
    videoKey(entry.url),
    entry.title,
    entry.qualities?.length || 0,
    entry.pageUrl || '',
    entry.pageTitle || ''
  ]));
}
