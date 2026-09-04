import type { BatchStatus } from '../shared/popup-protocol';
import type { VideoInfo } from '../shared/types';
import { videoKey } from '../detection/video-key';

/**
 * Owns the synchronous state transitions of one sequential batch. Effects
 * such as creating directories and starting/cancelling downloads stay in the
 * service worker.
 */
export class BatchRun {
  private readonly state: BatchStatus;
  private currentDownloadId?: string;

  constructor(videos: VideoInfo[], folder: string) {
    this.state = {
      total: videos.length,
      completed: 0,
      failed: 0,
      folder,
      cancelled: false,
      remainingKeys: videos.map((video) => videoKey(video.url))
    };
  }

  get cancelled(): boolean {
    return this.state.cancelled;
  }

  begin(video: VideoInfo): void {
    this.state.currentTitle = video.title;
    this.state.currentSourceKey = videoKey(video.url);
    this.currentDownloadId = undefined;
  }

  /** Returns true when a cancellation arrived before the ID was known. */
  attachDownload(downloadId: string | undefined): boolean {
    this.currentDownloadId = downloadId;
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

  /** Mark the queue cancelled and return the active native download, if known. */
  cancel(): string | undefined {
    this.state.cancelled = true;
    this.state.remainingKeys = [];
    return this.currentDownloadId;
  }

  snapshot(): BatchStatus {
    return {
      ...this.state,
      remainingKeys: [...(this.state.remainingKeys || [])]
    };
  }

  private finishItem(video: VideoInfo): void {
    this.currentDownloadId = undefined;
    this.state.currentTitle = undefined;
    this.state.currentSourceKey = undefined;
    const done = videoKey(video.url);
    this.state.remainingKeys = (this.state.remainingKeys || []).filter((key) => key !== done);
  }
}
