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

  // Detection can report one video more than once in a single batch — the DOM
  // and the network see it under different signed URLs. Keyed accumulation
  // keeps the first row and folds the rest into it, rather than emitting two.
  const incoming = new Map<string, HistoryEntry>();
  for (const video of videos) {
    const key = videoKey(video.url);
    const existing = previous.get(key);
    previous.delete(key);

    // Content-script generations are transport metadata, not history data.
    const { generation: _generation, ...persistedVideo } = video as VideoInfo & { generation?: number };
    const entry: HistoryEntry = {
      ...persistedVideo,
      // A title the user typed outlives every later detection of the same
      // video, so leaving and re-entering the current list keeps their name.
      title: existing?.titleByUser ? existing.title : (persistedVideo.title || existing?.title),
      titleByUser: existing?.titleByUser,
      pageUrl: context.pageUrl || video.pageUrl || existing?.pageUrl,
      pageTitle: context.pageTitle || existing?.pageTitle,
      detectedAt: now
    };
    const alreadyIncoming = incoming.get(key);
    incoming.set(key, alreadyIncoming ? preferRicher(alreadyIncoming, entry) : entry);
  }

  // A video already in the list keeps its slot. Only genuinely new detections
  // go to the front: re-detecting one the user dragged into place must not
  // yank it back to the top, and the popup pins current media anyway.
  const known = new Set(history.map((entry) => videoKey(entry.url)));
  const fresh: HistoryEntry[] = [];
  for (const [key, entry] of incoming) if (!known.has(key)) fresh.push(entry);

  const kept = history
    .map((entry) => incoming.get(videoKey(entry.url)) ?? entry)
    .filter((entry) => {
      const key = videoKey(entry.url);
      return incoming.has(key) || previous.has(key);
    });

  return [...fresh, ...kept].slice(0, limit);
}

/**
 * Folds a second sighting of one video into the row already held. The first
 * sighting owns the list position and the URL that was resolved for it; the
 * later one only fills in facts the first was missing.
 */
function preferRicher(held: HistoryEntry, other: HistoryEntry): HistoryEntry {
  return {
    ...held,
    title: held.titleByUser ? held.title : (held.title || other.title),
    titleByUser: held.titleByUser || other.titleByUser,
    pageUrl: held.pageUrl || other.pageUrl,
    pageTitle: held.pageTitle || other.pageTitle,
    qualities: held.qualities?.length ? held.qualities : other.qualities,
    childUrls: held.childUrls?.length ? held.childUrls : other.childUrls,
    thumbnail: held.thumbnail || other.thumbnail,
    duration: held.duration || other.duration,
    fileSize: held.fileSize || other.fileSize
  };
}

/**
 * Collapses rows that describe the same video. Nothing should produce a
 * duplicate any more, but a list persisted by an older build still holds them,
 * so every read goes through here. Returns the same array when it was clean,
 * which callers use to skip a write.
 */
export function dedupeHistoryEntries(history: HistoryEntry[]): HistoryEntry[] {
  const byKey = new Map<string, HistoryEntry>();
  for (const entry of history) {
    const key = videoKey(entry.url);
    const held = byKey.get(key);
    byKey.set(key, held ? preferRicher(held, entry) : entry);
  }
  return byKey.size === history.length ? history : [...byKey.values()];
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
    if (videoKey(entry.url) !== key) return entry;
    if (entry.title === trimmed && entry.titleByUser) return entry;
    changed = true;
    // Flagged so later detections of the same video leave the name alone.
    return { ...entry, title: trimmed, titleByUser: true };
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
    entry.pageTitle || '',
    // A merge that only marks the title as the user's still has to be written.
    entry.titleByUser ? 1 : 0
  ]));
}
