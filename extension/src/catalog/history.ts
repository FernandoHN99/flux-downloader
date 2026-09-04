import type { HistoryEntry, VideoInfo } from '../shared/types';
import { videoKey } from '../detection/video-key';

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

export function retainHistoryEntries(
  history: HistoryEntry[],
  keys: Iterable<string>
): HistoryEntry[] {
  const retained = new Set(keys);
  const next = history.filter((entry) => retained.has(videoKey(entry.url)));
  return next.length === history.length ? history : next;
}

export function removeHistoryEntries(
  history: HistoryEntry[],
  keys: Iterable<string>
): HistoryEntry[] {
  const removed = new Set(keys);
  if (removed.size === 0) return history;
  const next = history.filter((entry) => !removed.has(videoKey(entry.url)));
  return next.length === history.length ? history : next;
}

export function renameHistoryTitle(
  history: HistoryEntry[],
  key: string,
  title: string
): HistoryEntry[] {
  const trimmed = title.trim();
  if (!trimmed) return history;
  let changed = false;
  const next = history.map((entry) => {
    if (videoKey(entry.url) !== key || entry.title === trimmed) return entry;
    changed = true;
    return { ...entry, title: trimmed };
  });
  return changed ? next : history;
}

/** Visible keys lead; entries omitted by popup filtering retain their order. */
export function reorderHistoryEntries(
  history: HistoryEntry[],
  keys: Iterable<string>
): HistoryEntry[] {
  const byKey = new Map(history.map((entry) => [videoKey(entry.url), entry]));
  const reordered: HistoryEntry[] = [];
  for (const key of keys) {
    const entry = byKey.get(key);
    if (!entry) continue;
    reordered.push(entry);
    byKey.delete(key);
  }
  return [
    ...reordered,
    ...history.filter((entry) => byKey.has(videoKey(entry.url)))
  ];
}

export function decorateHistoryEntries(
  history: HistoryEntry[],
  downloadedKeys: Iterable<string>,
  failedKeys: Iterable<string>
): HistoryEntry[] {
  const downloaded = new Set(downloadedKeys);
  const failed = new Set(failedKeys);
  return history.map((entry) => {
    const key = videoKey(entry.url);
    return {
      ...entry,
      downloaded: downloaded.has(key),
      failed: failed.has(key)
    };
  });
}

export interface DownloadMarkers {
  downloaded: string[];
  failed: string[];
}

export function markHistoryDownloaded(
  markers: DownloadMarkers,
  key: string,
  limit: number
): DownloadMarkers {
  const alreadyDownloaded = markers.downloaded.includes(key);
  if (alreadyDownloaded && !markers.failed.includes(key)) return markers;
  return {
    downloaded: alreadyDownloaded
      ? markers.downloaded
      : [key, ...markers.downloaded].slice(0, limit),
    failed: markers.failed.filter((entry) => entry !== key)
  };
}

export function markHistoryFailed(
  markers: DownloadMarkers,
  key: string,
  limit: number
): DownloadMarkers {
  if (markers.failed.includes(key)) return markers;
  return {
    ...markers,
    failed: [key, ...markers.failed].slice(0, limit)
  };
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
