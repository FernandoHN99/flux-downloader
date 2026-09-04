import type { HistoryEntry, VideoInfo } from '../shared/types';
import { videoKey } from '../detection/video-key';
import {
  decorateHistoryEntries,
  dedupeHistoryEntries,
  markHistoryDownloaded,
  markHistoryFailed,
  mergeDetectedVideosIntoHistory,
  removeHistoryEntries,
  renameHistoryTitle,
  reorderHistoryEntries,
  retainHistoryEntries,
  sameHistoryContent
} from './history';

const HISTORY_KEY = 'mediaHistory';
const HISTORY_LIMIT = 50;
const DOWNLOADED_KEY = 'downloadedVideos';
const FAILED_KEY = 'failedVideos';
const DOWNLOADED_LIMIT = 500;

export interface PageContext {
  pageUrl?: string;
  pageTitle?: string;
}

export interface HistoryStoreDeps {
  /** Keys of media playing in some open tab, used when history is switched off. */
  currentKeys: () => string[];
  keepHistory: () => Promise<boolean>;
  /** Called with the decorated list whenever the stored history changes. */
  broadcast: (entries: HistoryEntry[]) => void;
}

/**
 * Owns the persisted detection history and the downloaded/failed markers that
 * decorate it. Every mutation is a read-modify-write against chrome.storage,
 * so writes are queued: commitVideos fires often enough that two interleaved
 * merges would lose entries.
 */
export class HistoryStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: HistoryStoreDeps) {}

  /**
   * Reads the stored list, collapsing any duplicate rows a previous build
   * persisted. The cleaned list is written back so the repair happens once
   * rather than on every read.
   */
  async read(): Promise<HistoryEntry[]> {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const entries = stored[HISTORY_KEY];
    if (!Array.isArray(entries)) return [];

    const deduped = dedupeHistoryEntries(entries);
    if (deduped !== entries) {
      await chrome.storage.local.set({ [HISTORY_KEY]: deduped });
    }
    return deduped;
  }

  /** Resolves once every queued write has run, so a read sees them. */
  settled(): Promise<void> {
    return this.writes;
  }

  /** Queues a merge of freshly detected videos. */
  record(videos: VideoInfo[], page: PageContext): Promise<void> {
    if (videos.length === 0) return this.writes;
    const snapshot = videos.map((video) => ({ ...video }));
    return this.enqueue(() => this.merge(snapshot, page));
  }

  /**
   * With history switched off the stored list is not allowed to outlive the
   * tabs: anything no longer playing somewhere is dropped. Queued behind any
   * write already in flight, and a no-op while the setting is on.
   */
  schedulePruneIfOff(): Promise<void> {
    return this.enqueue(async () => {
      if (await this.deps.keepHistory()) return;
      await this.commit((history) => retainHistoryEntries(history, this.deps.currentKeys()));
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await chrome.storage.local.remove(HISTORY_KEY);
      await this.publish([]);
    });
  }

  remove(keys: string[]): Promise<void> {
    return this.enqueue(() => this.commit((history) => removeHistoryEntries(history, keys)));
  }

  rename(key: string, title: string): Promise<void> {
    return this.enqueue(() => this.commit((history) => renameHistoryTitle(history, key, title)));
  }

  /**
   * `keys` is the order the popup shows; entries it filtered out (the current
   * page's videos) keep their data and land after them.
   */
  reorder(keys: string[]): Promise<void> {
    return this.enqueue(async () => {
      const history = await this.read();
      const next = reorderHistoryEntries(history, keys);
      await chrome.storage.local.set({ [HISTORY_KEY]: next });
      await this.publish(next);
    });
  }

  async markDownloaded(url: string): Promise<void> {
    const key = videoKey(url);
    const [downloaded, failed] = await this.readMarkers();
    const markers = { downloaded, failed };
    const next = markHistoryDownloaded(markers, key, DOWNLOADED_LIMIT);
    if (next === markers) return;

    await chrome.storage.local.set({
      [DOWNLOADED_KEY]: next.downloaded,
      [FAILED_KEY]: next.failed
    });
    await this.publish(await this.read());
  }

  async markFailed(url: string): Promise<void> {
    const key = videoKey(url);
    const [, failed] = await this.readMarkers();
    const markers = { downloaded: [], failed };
    const next = markHistoryFailed(markers, key, DOWNLOADED_LIMIT);
    if (next === markers) return;
    await chrome.storage.local.set({ [FAILED_KEY]: next.failed });
    await this.publish(await this.read());
  }

  /** Adds the downloaded/failed flags the popup renders as markers. */
  async decorate(entries: HistoryEntry[]): Promise<HistoryEntry[]> {
    const [downloaded, failed] = await this.readMarkers();
    return decorateHistoryEntries(entries, downloaded, failed);
  }

  /** Pushes the current stored list to listeners without changing it. */
  async publish(entries: HistoryEntry[]): Promise<void> {
    this.deps.broadcast(await this.decorate(entries));
  }

  /**
   * Runs `task` after every write already queued. The queue itself always
   * settles — a failed task must not wedge the writes that follow it — while
   * the returned promise still rejects for the caller.
   */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const result = this.writes.then(task);
    this.writes = result.catch(() => { /* kept alive for the next write */ });
    return result;
  }

  private async merge(videos: VideoInfo[], page: PageContext): Promise<void> {
    const history = await this.read();
    const next = mergeDetectedVideosIntoHistory(
      history,
      videos,
      { pageUrl: page.pageUrl, pageTitle: page.pageTitle },
      Date.now(),
      HISTORY_LIMIT
    );
    if (sameHistoryContent(next, history)) return;
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    await this.publish(next);
  }

  /** Applies a pure transform, writing and broadcasting only when it changed. */
  private async commit(
    transform: (history: HistoryEntry[]) => HistoryEntry[]
  ): Promise<void> {
    const history = await this.read();
    const next = transform(history);
    if (next === history) return;
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    await this.publish(next);
  }

  private async readMarkers(): Promise<[string[], string[]]> {
    const stored = await chrome.storage.local.get([DOWNLOADED_KEY, FAILED_KEY]);
    const asList = (value: unknown) => (Array.isArray(value) ? value : []);
    return [asList(stored[DOWNLOADED_KEY]), asList(stored[FAILED_KEY])];
  }
}
