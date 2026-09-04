import { describe, expect, it } from 'vitest';
import { isPopupRequest } from './popup-protocol';

describe('isPopupRequest', () => {
  it.each([
    { type: 'GET_MEDIA', tabId: null },
    { type: 'REFRESH_TABS' },
    { type: 'DOWNLOAD_ALL', videos: [], tabId: null, quality: 'best' },
    { type: 'CLEAR_HISTORY' }
  ])('accepts the popup request discriminant in $type', (message) => {
    expect(isPopupRequest(message)).toBe(true);
  });

  it.each([
    null,
    undefined,
    'GET_MEDIA',
    {},
    { type: 1 },
    { type: 'VIDEO_DETECTED' },
    { type: 'UNKNOWN' }
  ])('rejects unrelated traffic', (message) => {
    expect(isPopupRequest(message)).toBe(false);
  });
});
