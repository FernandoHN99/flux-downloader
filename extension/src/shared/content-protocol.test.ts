import { describe, expect, it } from 'vitest';
import { isContentCommand, isRuntimeRequest } from './content-protocol';

describe('isRuntimeRequest', () => {
  it.each([
    { type: 'VIDEO_DETECTED' },
    { type: 'MEDIA_URL_MAP' },
    { type: 'PAGE_METADATA' },
    { type: 'PAGE_NAVIGATION' },
    { type: 'GET_VIDEOS' },
    { type: 'PING' }
  ])('recognizes $type', (message) => {
    expect(isRuntimeRequest(message)).toBe(true);
  });

  it.each([null, undefined, {}, { type: 2 }, { type: 'RESCAN' }, { type: 'GET_MEDIA' }])
    ('rejects unrelated runtime traffic', (message) => {
      expect(isRuntimeRequest(message)).toBe(false);
    });
});

describe('isContentCommand', () => {
  it('accepts only the rescan command', () => {
    expect(isContentCommand({ type: 'RESCAN' })).toBe(true);
    expect(isContentCommand({ type: 'PAGE_METADATA' })).toBe(false);
    expect(isContentCommand(null)).toBe(false);
  });
});
