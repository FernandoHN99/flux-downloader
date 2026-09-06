import type { HistoryEntry } from '../shared/types';
import { domainOf, videoKey } from '../detection/video-key';
import type { AppState } from './state';

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
  const current: HistoryEntry[] = [];
  const rest: HistoryEntry[] = [];
  for (const [key, entry] of unique) {
    // A master playlist speaks for its variants; a variant row detected before
    // the master arrived is the same video and must not show alongside it.
    if (owned.has(key)) continue;
    (isCurrent(state, key) ? current : rest).push(entry);
  }
  return [...current, ...rest];
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

export function visibleEntries(state: AppState): HistoryEntry[] {
  return orderedEntries(state).filter((entry) => matchesSearch(entry, state.ui.search));
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

/** Rows outside a reorder zone: pinned current ones, and any mid-download. */
export function canReorder(state: AppState, key: string): boolean {
  return !isCurrent(state, key) && !isDownloading(state, key) && !state.ui.selectionMode;
}
