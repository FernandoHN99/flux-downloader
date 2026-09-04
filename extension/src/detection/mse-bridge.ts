import type { MseState } from './mse-media';

interface MseBridgeBase {
  source: 'Flux-MSE';
  pageUrl: string;
  generation: number;
}

export type MseBridgeMessage = MseBridgeBase & (
  | { type: 'navigation' }
  | { type: 'source-buffer'; blobUrl?: string | null; mimeType: string; codecs?: string | null }
  | { type: 'segment-url'; url: string; isInit: boolean }
  | { type: 'duration'; duration: number }
  | { type: 'media-url-map'; originalUrl: string; relayUrl: string }
  | { type: 'progress'; totalBytes: number }
);

export type MseStateMessage = Extract<
  MseBridgeMessage,
  { type: 'source-buffer' | 'segment-url' | 'duration' | 'progress' }
>;

function bridgeBase(value: unknown): value is Record<string, unknown> & MseBridgeBase {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.source === 'Flux-MSE' &&
    typeof item.pageUrl === 'string' &&
    Number.isSafeInteger(item.generation) &&
    Number(item.generation) >= 0;
}

/** Validate page-world messages before they can mutate isolated-world state. */
export function isMseBridgeMessage(value: unknown): value is MseBridgeMessage {
  if (!bridgeBase(value)) return false;

  switch (value.type) {
    case 'navigation':
      return true;
    case 'source-buffer':
      return typeof value.mimeType === 'string' && value.mimeType.length > 0 &&
        (value.blobUrl === undefined || value.blobUrl === null || typeof value.blobUrl === 'string') &&
        (value.codecs === undefined || value.codecs === null || typeof value.codecs === 'string');
    case 'segment-url':
      return typeof value.url === 'string' && value.url.length > 0 &&
        typeof value.isInit === 'boolean';
    case 'duration':
      return typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0;
    case 'media-url-map':
      return typeof value.originalUrl === 'string' && value.originalUrl.length > 0 &&
        typeof value.relayUrl === 'string' && value.relayUrl.length > 0;
    case 'progress':
      return typeof value.totalBytes === 'number' && Number.isFinite(value.totalBytes) &&
        value.totalBytes >= 0;
    default:
      return false;
  }
}

export function isMseStateMessage(message: MseBridgeMessage): message is MseStateMessage {
  return message.type === 'source-buffer' || message.type === 'segment-url' ||
    message.type === 'duration' || message.type === 'progress';
}

export interface MseStateUpdate {
  state: MseState;
  announce: boolean;
}

/** Apply one validated observation without DOM, window, or Chrome APIs. */
export function reduceMseState(state: MseState, message: MseStateMessage): MseStateUpdate {
  switch (message.type) {
    case 'source-buffer':
      return {
        state: {
          ...state,
          blobUrl: message.blobUrl || state.blobUrl,
          mimeType: message.mimeType,
          codecs: message.codecs || undefined
        },
        announce: true
      };

    case 'segment-url': {
      const alreadyKnown = state.segmentUrls.includes(message.url);
      const atLimit = state.segmentUrls.length >= 500;
      if (alreadyKnown || atLimit) return { state, announce: false };

      const segmentUrls = [...state.segmentUrls, message.url];
      return {
        state: {
          ...state,
          initSegmentUrl: message.isInit && !state.initSegmentUrl
            ? message.url
            : state.initSegmentUrl,
          segmentUrls
        },
        announce: segmentUrls.length === 1 || segmentUrls.length % 20 === 0
      };
    }

    case 'duration':
      if (state.duration === message.duration) return { state, announce: false };
      return { state: { ...state, duration: message.duration }, announce: true };

    case 'progress':
      if (state.totalBytes === message.totalBytes) return { state, announce: false };
      return { state: { ...state, totalBytes: message.totalBytes }, announce: false };
  }
}
