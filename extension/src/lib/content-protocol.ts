import type { PageMetadata } from './tab-state';
import type { VideoInfo } from './types';

export type DetectedVideo = VideoInfo & {
  pageUrl: string;
  generation: number;
};

export interface MediaUrlMapMessage {
  type: 'MEDIA_URL_MAP';
  originalUrl: string;
  relayUrl: string;
  pageUrl: string;
  generation: number;
}

/** Requests sent through chrome.runtime.sendMessage to the service worker. */
export type RuntimeRequest =
  | { type: 'VIDEO_DETECTED'; video: DetectedVideo }
  | MediaUrlMapMessage
  | { type: 'PAGE_METADATA'; metadata: PageMetadata }
  | { type: 'PAGE_NAVIGATION'; pageUrl: string; generation: number }
  | { type: 'GET_VIDEOS'; tabId: number }
  | { type: 'PING' };

/** Commands sent directly from the service worker to a content script. */
export type ContentCommand = { type: 'RESCAN' };

const RUNTIME_REQUEST_TYPES = new Set<RuntimeRequest['type']>([
  'VIDEO_DETECTED',
  'MEDIA_URL_MAP',
  'PAGE_METADATA',
  'PAGE_NAVIGATION',
  'GET_VIDEOS',
  'PING'
]);

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' &&
    RUNTIME_REQUEST_TYPES.has(type as RuntimeRequest['type']);
}

export function isContentCommand(value: unknown): value is ContentCommand {
  return !!value && typeof value === 'object' &&
    (value as { type?: unknown }).type === 'RESCAN';
}
