import type { ProgressDetail } from './popup-protocol';
import type { VideoInfo } from './types';

export interface ActiveDownload {
  pid?: number;
  downloadId?: number;
  type: 'convert' | 'direct' | 'ytdlp';
  video?: VideoInfo;
  /** The detected source URL; video.url may hold only the chosen quality. */
  sourceUrl?: string;
  directory: string;
  filename: string;
  tabId?: number;
  lastProgress?: ProgressDetail;
}

/**
 * Owns the complete in-memory lifecycle of active download IDs. A short job
 * may finish before its batch starts waiting, so outcomes remain briefly
 * available. Late duplicate callbacks are ignored once an ID is finished.
 */
export class DownloadTracker {
  private readonly active = new Map<string, ActiveDownload>();
  private readonly waiters = new Map<string, Array<(succeeded: boolean) => void>>();
  private readonly recentOutcomes = new Map<string, boolean>();
  private readonly outcomeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cancelled = new Map<string, ActiveDownload['type']>();
  private readonly cancellationTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly outcomeTtlMs = 30_000) {}

  set(key: string, download: ActiveDownload): this {
    this.clearRecentOutcome(key);
    this.clearCancellation(key);
    this.active.set(key, download);
    return this;
  }

  get(key: string): ActiveDownload | undefined {
    return this.active.get(key);
  }

  values(): IterableIterator<ActiveDownload> {
    return this.active.values();
  }

  entries(): IterableIterator<[string, ActiveDownload]> {
    return this.active.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, ActiveDownload]> {
    return this.entries();
  }

  findForTab(tabId: number): [string, ActiveDownload] | undefined {
    for (const entry of this.active) {
      if (entry[1].tabId === tabId && this.isRunning(entry[0])) return entry;
    }
    return undefined;
  }

  beginCancel(key: string): ActiveDownload | undefined {
    const tracked = this.active.get(key);
    if (!tracked) return undefined;
    this.clearCancellation(key);
    this.cancelled.set(key, tracked.type);
    this.cancellationTimers.set(key, setTimeout(() => {
      this.cancelled.delete(key);
      this.cancellationTimers.delete(key);
    }, this.outcomeTtlMs));
    return tracked;
  }

  isRunning(key: string): boolean {
    return this.active.has(key) && !this.cancelled.has(key);
  }

  cancelledType(key: string): ActiveDownload['type'] | undefined {
    return this.cancelled.get(key);
  }

  finish(key: string, succeeded: boolean): ActiveDownload | undefined {
    const tracked = this.active.get(key);
    const waiters = this.waiters.get(key);
    if (!tracked && !waiters?.length) return undefined;

    this.active.delete(key);
    if (waiters?.length) {
      this.waiters.delete(key);
      for (const resolve of waiters) resolve(succeeded);
      return tracked;
    }

    this.clearRecentOutcome(key);
    this.recentOutcomes.set(key, succeeded);
    this.outcomeTimers.set(key, setTimeout(() => {
      this.recentOutcomes.delete(key);
      this.outcomeTimers.delete(key);
    }, this.outcomeTtlMs));
    return tracked;
  }

  wait(key: string): Promise<boolean> {
    if (this.recentOutcomes.has(key)) {
      const outcome = this.recentOutcomes.get(key)!;
      this.clearRecentOutcome(key);
      return Promise.resolve(outcome);
    }

    return new Promise((resolve) => {
      const waiters = this.waiters.get(key) || [];
      waiters.push(resolve);
      this.waiters.set(key, waiters);
    });
  }

  private clearRecentOutcome(key: string): void {
    this.recentOutcomes.delete(key);
    const timer = this.outcomeTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.outcomeTimers.delete(key);
  }

  private clearCancellation(key: string): void {
    this.cancelled.delete(key);
    const timer = this.cancellationTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.cancellationTimers.delete(key);
  }
}
