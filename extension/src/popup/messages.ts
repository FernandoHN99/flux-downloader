// The popup's half of the port protocol, in one place so the message names
// are not scattered as string literals across the UI.

import type { HistoryEntry, VideoInfo } from '../lib/types';
import type { BatchQuality, BatchStatus, ProgressDetail } from './state';

export interface OutgoingVideo extends VideoInfo {
  qualities: VideoInfo['qualities'];
}

/** What the popup sends. */
export type Outgoing =
  | { type: 'GET_MEDIA'; tabId: number | null }
  | { type: 'GET_HISTORY' }
  | { type: 'GET_BATCH_STATUS' }
  | { type: 'GET_ACTIVE_DOWNLOAD'; tabId: number }
  | { type: 'RESCAN' }
  | { type: 'DOWNLOAD'; tabId: number | null; sourceUrl: string; checkFreshness: boolean;
      video: OutgoingVideo; filename: string }
  | { type: 'DOWNLOAD_ALL'; videos: HistoryEntry[]; tabId: number | null; quality: BatchQuality }
  | { type: 'CANCEL_DOWNLOAD'; downloadId: string }
  | { type: 'CANCEL_BATCH' }
  | { type: 'RENAME_HISTORY_ITEM'; key: string; title: string }
  | { type: 'RENAME_VIDEO'; tabId: number | null; key: string; title: string }
  | { type: 'REORDER_HISTORY'; keys: string[] }
  | { type: 'DELETE_HISTORY_ITEMS'; keys: string[] }
  | { type: 'CLEAR_HISTORY' };

/** What the background sends back. */
export type Incoming =
  | { type: 'MEDIA_LIST'; videos: VideoInfo[]; currentKeys?: string[] }
  | { type: 'HISTORY_LIST'; entries?: HistoryEntry[] }
  | { type: 'BATCH_STATUS'; batch: BatchStatus | null }
  | { type: 'DOWNLOAD_STARTED'; success: boolean; downloadId?: string; error?: string }
  | { type: 'DOWNLOAD_PROGRESS'; progress?: ProgressDetail } & Partial<ProgressDetail>
  | { type: 'DOWNLOAD_COMPLETE' }
  | { type: 'DOWNLOAD_ERROR'; error?: string }
  | { type: 'ACTIVE_DOWNLOAD'; downloadId: string; sourceUrl?: string; filename?: string;
      progress?: ProgressDetail }
  | { type: 'NO_ACTIVE_DOWNLOAD' }
  | { type: 'ERROR'; message: string };

/**
 * A typed wrapper over the port. It stays usable after a disconnect —
 * Chrome shuts the service worker down while the popup is open, and a send
 * that throws must not take the UI down with it.
 */
export class Messenger {
  private port: chrome.runtime.Port | null = null;

  constructor(private readonly onMessage: (message: Incoming) => void) {}

  connect(): void {
    this.port = chrome.runtime.connect({ name: 'popup' });
    this.port.onMessage.addListener((message) => this.onMessage(message as Incoming));
    this.port.onDisconnect.addListener(() => { this.port = null; });
  }

  send(message: Outgoing): void {
    if (!this.port) return;
    try {
      this.port.postMessage(message);
    } catch {
      // The worker went away mid-send; the next open reconnects.
      this.port = null;
    }
  }

  get connected(): boolean {
    return this.port !== null;
  }
}
