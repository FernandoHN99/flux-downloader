import type { HistoryEntry, VideoFolder } from '../shared/types';
import { domainOf, videoKey } from '../detection/video-key';
import type { AppState, RemoteState } from './state';

/** A video any open tab is playing right now. */
export function isCurrent(state: AppState, key: string): boolean {
  return state.remote.currentKeys.has(key);
}

/**
 * Every known video, with the ones playing right now pinned to the top.
 * The stored order is otherwise the user's, set by dragging.
 *
 * The list is deduplicated here as well as at every producer: one video must
 * never occupy two rows, and the row the user can see is the last place to
 * catch it. Rows sharing an identity are the same video, so the first one wins
 * and keeps the position the user dragged it to.
 */
export function orderedEntries(state: AppState): HistoryEntry[] {
  const unique = new Map<string, HistoryEntry>();
  for (const entry of state.remote.history) {
    const key = videoKey(entry.url);
    if (!unique.has(key)) unique.set(key, entry);
  }

  const owned = childKeysOf(unique.values());
  const playablePages = pagesWithPlayableManifest(unique.values());
  const current: HistoryEntry[] = [];
  const rest: HistoryEntry[] = [];
  for (const [key, entry] of unique) {
    // A master playlist speaks for its variants; a variant row detected before
    // the master arrived is the same video and must not show alongside it.
    if (owned.has(key)) continue;
    // An MSE capture is the fallback for a page whose manifest is unknown. Once
    // the page has an HLS/DASH row with renditions, the capture is its twin.
    if (entry.type === 'mse' && entry.pageUrl && playablePages.has(entry.pageUrl)) continue;
    (isCurrent(state, key) ? current : rest).push(entry);
  }
  return [...current, ...rest];
}

/** Pages that already expose an HLS/DASH manifest whose renditions are known. */
function pagesWithPlayableManifest(entries: Iterable<HistoryEntry>): Set<string> {
  const pages = new Set<string>();
  for (const entry of entries) {
    const manifest = entry.type === 'hls' || entry.type === 'dash'
      || entry.type === 'm3u8' || entry.type === 'mpd';
    if (manifest && entry.pageUrl && (entry.qualities?.length ?? 0) > 0) pages.add(entry.pageUrl);
  }
  return pages;
}

/** Keys of every rendition and child manifest some other entry already owns. */
function childKeysOf(entries: Iterable<HistoryEntry>): Set<string> {
  const owned = new Set<string>();
  for (const entry of entries) {
    const ownerKey = videoKey(entry.url);
    for (const url of [
      ...(entry.childUrls || []),
      ...(entry.qualities || []).map((quality) => quality.url)
    ]) {
      if (!url) continue;
      const key = videoKey(url);
      // An entry whose own URL is listed among its renditions still owns itself.
      if (key !== ownerKey) owned.add(key);
    }
  }
  return owned;
}

export function matchesSearch(entry: HistoryEntry, search: string): boolean {
  if (!search) return true;
  return (entry.title || '').toLowerCase().includes(search.toLowerCase());
}

/**
 * `videos` in the order they were added, newest first: the order the history
 * stores, not the one on screen, which pins whatever is playing to the top.
 * A batch is numbered from this order, so a lesson that is open in a tab must
 * keep its place in the course instead of becoming the highest number.
 */
export function inStoredOrder(state: AppState, videos: readonly HistoryEntry[]): HistoryEntry[] {
  const position = new Map<string, number>();
  state.remote.history.forEach((entry, index) => {
    const key = videoKey(entry.url);
    if (!position.has(key)) position.set(key, index);
  });
  const placeOf = (entry: HistoryEntry): number => position.get(videoKey(entry.url)) ?? Infinity;
  return [...videos].sort((a, b) => placeOf(a) - placeOf(b));
}

export function visibleEntries(state: AppState): HistoryEntry[] {
  return orderedEntries(state).filter((entry) => matchesSearch(entry, state.ui.search));
}

/**
 * Keys of the rows on screen, top to bottom: the folders first, then what is
 * loose. A collapsed folder or site hides its rows, so a range cannot run
 * through them.
 */
export function displayOrder(state: AppState): string[] {
  const { search, collapsedFolders, collapsedGroups } = state.ui;
  const split = splitByFolder(visibleEntries(state), state.remote.folders, search.trim() !== '');
  const keys: string[] = [];
  const add = (entries: HistoryEntry[]): void => {
    for (const entry of entries) keys.push(videoKey(entry.url));
  };

  for (const { folder, entries } of split.sections) {
    if (!collapsedFolders.has(folder.id)) add(entries);
  }
  if (!state.ui.groupByDomain) {
    add(split.unfiled);
    return keys;
  }
  for (const [domain, entries] of groupByDomain(split.unfiled)) {
    if (!collapsedGroups.has(domain)) add(entries);
  }
  return keys;
}

/** Every key from `from` to `to` inclusive, in either direction. */
export function keysBetween(order: readonly string[], from: string, to: string): string[] {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** One bucket per site, in the order the sites first appear. */
export function groupByDomain(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const domain = domainOf(entry.pageUrl, entry.url);
    const bucket = groups.get(domain);
    if (bucket) bucket.push(entry);
    else groups.set(domain, [entry]);
  }
  return groups;
}

/** A user-visible run is in flight, so the popup must not start another. */
export function downloadInProgress(state: AppState): boolean {
  return state.remote.manualDownloadKey !== null || state.remote.batch !== null;
}

function batchKeys(state: AppState): ReadonlySet<string> {
  return new Set(state.remote.batch?.remainingKeys || []);
}

function activeBatchKeys(state: AppState): ReadonlySet<string> {
  const batch = state.remote.batch;
  if (!batch) return new Set();
  if (batch.activeSourceKeys) return new Set(batch.activeSourceKeys);
  return new Set(batch.currentSourceKey ? [batch.currentSourceKey] : []);
}

export function isDownloading(state: AppState, key: string): boolean {
  if (key === state.remote.manualDownloadKey) return true;
  return (state.remote.batch?.remainingKeys || []).includes(key);
}

const lockedByRemote = new WeakMap<RemoteState, ReadonlySet<string>>();

/**
 * Every video a download was started for, finished ones included: the whole
 * batch stays read-only until the run ends, not just the rows still going.
 * Computed once per `remote` snapshot, since every row asks.
 */
export function lockedKeys(state: AppState): ReadonlySet<string> {
  const cached = lockedByRemote.get(state.remote);
  if (cached) return cached;
  const { batch, manualDownloadKey } = state.remote;
  const keys = new Set(batch?.keys ?? batch?.remainingKeys ?? []);
  if (manualDownloadKey) keys.add(manualDownloadKey);
  lockedByRemote.set(state.remote, keys);
  return keys;
}

/** Part of a running download: it cannot be renamed, filed, picked or deleted. */
export function isLocked(state: AppState, key: string): boolean {
  return lockedKeys(state).has(key);
}

/** `keys` without the locked ones: what an edit is still allowed to touch. */
export function editable(state: AppState, keys: readonly string[]): string[] {
  const locked = lockedKeys(state);
  return locked.size === 0 ? [...keys] : keys.filter((key) => !locked.has(key));
}

/**
 * Folders holding a locked video. Renaming one would split a running batch
 * across two directories, and deleting one would delete a video mid-download.
 */
export function lockedFolderIds(state: AppState): ReadonlySet<string> {
  const locked = lockedKeys(state);
  const ids = new Set<string>();
  if (locked.size === 0) return ids;
  for (const entry of state.remote.history) {
    if (entry.folderId && locked.has(videoKey(entry.url))) ids.add(entry.folderId);
  }
  return ids;
}

/**
 * Active batch rows have independent percentages; work not dispatched yet is
 * still queued.
 */
export function busyLabel(state: AppState, key: string): string {
  const active = key === state.remote.manualDownloadKey || activeBatchKeys(state).has(key);
  if (!active) return 'Queued';
  const detail = state.remote.progressByKey.get(key) ||
    (key === state.remote.activeDownloadKey ? state.remote.progress : null);
  const percent = detail?.percent ?? 0;
  return percent > 0 ? `Downloading… ${Math.round(percent)}%` : 'Downloading…';
}

export interface ProgressView {
  /** Completed/failed batch items, or 1 for a single download. */
  current: number;
  total: number;
  kind: 'single' | 'batch';
  active?: number;
  concurrency?: number;
}

/**
 * What the progress panel counts. Concurrent batches expose both settled and
 * active counts so the UI does not pretend only one item is being written.
 */
export function progressView(state: AppState): ProgressView | null {
  const { batch, manualDownloadKey } = state.remote;
  if (batch) {
    return {
      current: Math.min(batch.total, batch.completed + batch.failed),
      total: batch.total,
      kind: 'batch',
      active: activeBatchKeys(state).size,
      concurrency: batch.concurrency
    };
  }
  if (manualDownloadKey) return { current: 1, total: 1, kind: 'single' };
  return null;
}

/** Aggregate batch completion while retaining the ordinary single detail. */
export function progressDetail(state: AppState): AppState['remote']['progress'] {
  const batch = state.remote.batch;
  if (!batch || batch.total <= 0) return state.remote.progress;
  const activeKeys = [...activeBatchKeys(state)];
  let fractionalItems = 0;
  for (const key of activeKeys) {
    const detail = state.remote.progressByKey.get(key) ||
      (key === state.remote.activeDownloadKey ? state.remote.progress : null);
    const percent = detail?.percent;
    if (typeof percent === 'number' && Number.isFinite(percent)) {
      fractionalItems += Math.min(100, Math.max(0, percent)) / 100;
    }
  }
  return {
    percent: Math.min(100, ((batch.completed + batch.failed + fractionalItems) / batch.total) * 100)
  };
}

/** Rows outside a reorder zone: pinned current ones, and any part of a download. */
export function canReorder(state: AppState, key: string): boolean {
  return !isCurrent(state, key) && !isLocked(state, key) && !state.ui.selectionMode;
}

/**
 * Whether a row may be filed into a folder. A video playing right now can be;
 * one that is part of a running download cannot be shuffled under it, and the
 * whole list holds still while rows are being picked for deletion.
 */
export function canMoveToFolder(state: AppState, key: string): boolean {
  return !isLocked(state, key) && !state.ui.selectionMode;
}

/**
 * Every video not filed in a folder, whatever the search says: "all the loose
 * ones" means all of them, not just the ones currently on screen. Videos of a
 * running download are not loose to take: they cannot be filed right now.
 */
export function unfiledEntries(state: AppState): HistoryEntry[] {
  const known = new Set(state.remote.folders.map((folder) => folder.id));
  const locked = lockedKeys(state);
  return orderedEntries(state).filter((entry) =>
    (!entry.folderId || !known.has(entry.folderId)) && !locked.has(videoKey(entry.url)));
}

export interface FolderSection {
  folder: VideoFolder;
  entries: HistoryEntry[];
}

export interface FolderSplit {
  /** Folders in the user's order, each with its videos in list order. */
  sections: FolderSection[];
  /** Everything not filed anywhere: what the site/flat list shows. */
  unfiled: HistoryEntry[];
}

/**
 * Separates filed videos from the rest. A folder is always listed so it can
 * be dropped into while empty, except while searching, when only the folders
 * that hold a match are worth showing.
 */
export function splitByFolder(
  entries: HistoryEntry[],
  folders: readonly VideoFolder[],
  searching = false
): FolderSplit {
  const known = new Set(folders.map((folder) => folder.id));
  const filed = new Map<string, HistoryEntry[]>();
  const unfiled: HistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.folderId && known.has(entry.folderId)) {
      const bucket = filed.get(entry.folderId);
      if (bucket) bucket.push(entry);
      else filed.set(entry.folderId, [entry]);
    } else {
      unfiled.push(entry);
    }
  }
  const sections = folders
    .map((folder) => ({ folder, entries: filed.get(folder.id) ?? [] }))
    .filter((section) => !searching || section.entries.length > 0);
  return { sections, unfiled };
}
