import type { HistoryEntry, VideoInfo } from './types';

export type BatchQuality = 'best' | 'worst';

export interface BatchStatus {
  total: number;
  completed: number;
  failed: number;
  currentTitle?: string;
  currentSourceKey?: string;
  remainingKeys?: string[];
  folder?: string;
  cancelled: boolean;
}

export interface ProgressDetail {
  percent: number;
  speed?: number | string;
  eta?: number;
  bytesReceived?: number;
  totalBytes?: number;
  currentSeconds?: number;
  bitrate?: number | string;
}

export interface OutgoingVideo extends VideoInfo {
  qualities: VideoInfo['qualities'];
}

/** Requests sent over the long-lived popup port. */
export type PopupRequest =
  | { type: 'GET_MEDIA'; tabId: number | null }
  | { type: 'GET_HISTORY' }
  | { type: 'GET_BATCH_STATUS' }
  | { type: 'GET_ACTIVE_DOWNLOAD'; tabId: number }
  | { type: 'REFRESH_TABS' }
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

/** Events and command results sent from the service worker to the popup. */
export type PopupMessage =
  | { type: 'MEDIA_LIST'; videos: VideoInfo[]; currentKeys?: string[] }
  | { type: 'HISTORY_LIST'; entries?: HistoryEntry[] }
  | { type: 'BATCH_STATUS'; batch: BatchStatus | null }
  | { type: 'DOWNLOAD_STARTED'; success: boolean; downloadId?: string; error?: string }
  | { type: 'DOWNLOAD_CANCELLED'; success: boolean; error?: string }
  | ({ type: 'DOWNLOAD_PROGRESS'; downloadId?: string; progress?: ProgressDetail } &
      Partial<ProgressDetail>)
  | { type: 'DOWNLOAD_COMPLETE'; downloadId?: string; outputPath?: string }
  | { type: 'DOWNLOAD_ERROR'; downloadId?: string; error?: string }
  | { type: 'ACTIVE_DOWNLOAD'; downloadId: string; video?: VideoInfo; sourceUrl?: string;
      filename?: string; progress?: ProgressDetail }
  | { type: 'NO_ACTIVE_DOWNLOAD' }
  | { type: 'ERROR'; message: string };

const POPUP_REQUEST_TYPES = new Set<PopupRequest['type']>([
  'GET_MEDIA',
  'GET_HISTORY',
  'GET_BATCH_STATUS',
  'GET_ACTIVE_DOWNLOAD',
  'REFRESH_TABS',
  'DOWNLOAD',
  'DOWNLOAD_ALL',
  'CANCEL_DOWNLOAD',
  'CANCEL_BATCH',
  'RENAME_HISTORY_ITEM',
  'RENAME_VIDEO',
  'REORDER_HISTORY',
  'DELETE_HISTORY_ITEMS',
  'CLEAR_HISTORY'
]);

/** Reject unrelated port traffic before routing by discriminant. */
export function isPopupRequest(value: unknown): value is PopupRequest {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && POPUP_REQUEST_TYPES.has(type as PopupRequest['type']);
}
