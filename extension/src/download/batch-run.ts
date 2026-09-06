import type { BatchStatus } from '../shared/popup-protocol';
import type { VideoInfo } from '../shared/types';
import { videoKey } from '../detection/video-key';

/**
 * Owns the synchronous state transitions of one concurrent batch. Effects
 * such as creating directories and starting/cancelling downloads stay in the
 * service worker.
 */
export class BatchRun {
  private readonly state: BatchStatus;
  private readonly active = new Map<string, { title: string; downloadId?: string }>();

  constructor(videos: VideoInfo[], folder: string, concurrency = 1) {
    this.state = {
      total: videos.length,
      completed: 0,
      failed: 0,
      folder,
      cancelled: false,
      remainingKeys: videos.map((video) => videoKey(video.url)),
      activeSourceKeys: [],
      concurrency
    };
  }

  get cancelled(): boolean {
    return this.state.cancelled;
  }

  begin(video: VideoInfo): void {
    this.active.set(videoKey(video.url), { title: video.title });
    this.syncActiveState();
  }

  /** Returns true when a cancellation arrived before the ID was known. */
  attachDownload(video: VideoInfo, downloadId: string | undefined): boolean {
    const active = this.active.get(videoKey(video.url));
    if (active) active.downloadId = downloadId;
    return Boolean(downloadId && this.state.cancelled);
  }

  /**
   * Complete the current item. A cancelled transfer is not a failed video and
   * therefore must not receive a persistent failure marker.
   */
  complete(video: VideoInfo, succeeded: boolean): { markFailed: boolean } {
    const markFailed = !succeeded && !this.state.cancelled;
    if (!this.state.cancelled) {
      if (succeeded) this.state.completed += 1;
      else this.state.failed += 1;
    }
    this.finishItem(video);
    return { markFailed };
  }

  skip(video: VideoInfo): void {
    if (!this.state.cancelled) this.state.failed += 1;
    this.finishItem(video);
  }

  /** Mark the queue cancelled and return every active native download already known. */
  cancel(): string[] {
    this.state.cancelled = true;
    this.state.remainingKeys = [...this.active.keys()];
    return [...this.active.values()]
      .map((item) => item.downloadId)
      .filter((downloadId): downloadId is string => Boolean(downloadId));
  }

  snapshot(): BatchStatus {
    return {
      ...this.state,
      remainingKeys: [...(this.state.remainingKeys || [])],
      activeSourceKeys: [...(this.state.activeSourceKeys || [])]
    };
  }

  private finishItem(video: VideoInfo): void {
    const done = videoKey(video.url);
    this.active.delete(done);
    this.state.remainingKeys = (this.state.remainingKeys || []).filter((key) => key !== done);
    this.syncActiveState();
  }

  private syncActiveState(): void {
    const entries = [...this.active.entries()];
    this.state.activeSourceKeys = entries.map(([key]) => key);
    this.state.currentSourceKey = entries[0]?.[0];
    this.state.currentTitle = entries[0]?.[1].title;
  }
}
