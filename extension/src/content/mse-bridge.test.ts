import { describe, expect, it } from 'vitest';
import { emptyMseState } from './mse-media';
import { isMseBridgeMessage, reduceMseState } from './mse-bridge';

const base = {
  source: 'MediaGrabber-MSE' as const,
  pageUrl: 'https://course.example/lesson',
  generation: 3
};

describe('isMseBridgeMessage', () => {
  it.each([
    { ...base, type: 'navigation' },
    { ...base, type: 'source-buffer', blobUrl: 'blob:https://course.example/id', mimeType: 'video/mp4', codecs: null },
    { ...base, type: 'segment-url', url: 'https://cdn.example/init.m4s', isInit: true },
    { ...base, type: 'duration', duration: 95.5 },
    { ...base, type: 'media-url-map', originalUrl: 'https://cdn.example/a.m4s', relayUrl: 'https://cdn.example/b.m4s' },
    { ...base, type: 'progress', totalBytes: 1234 }
  ])('accepts a valid $type event', (message) => {
    expect(isMseBridgeMessage(message)).toBe(true);
  });

  it.each([
    null,
    { ...base, source: 'other', type: 'navigation' },
    { ...base, generation: -1, type: 'navigation' },
    { ...base, generation: 1.5, type: 'navigation' },
    { ...base, type: 'source-buffer', mimeType: '' },
    { ...base, type: 'segment-url', url: undefined, isInit: false },
    { ...base, type: 'duration', duration: Infinity },
    { ...base, type: 'duration', duration: 0 },
    { ...base, type: 'media-url-map', originalUrl: '', relayUrl: 'x' },
    { ...base, type: 'progress', totalBytes: -1 },
    { ...base, type: 'unknown' }
  ])('rejects malformed bridge traffic %#', (message) => {
    expect(isMseBridgeMessage(message)).toBe(false);
  });
});

describe('reduceMseState', () => {
  it('records source-buffer details and requests an announcement', () => {
    const update = reduceMseState(emptyMseState(), {
      ...base,
      type: 'source-buffer',
      blobUrl: 'blob:https://course.example/id',
      mimeType: 'video/mp4',
      codecs: 'avc1.640028'
    });

    expect(update.announce).toBe(true);
    expect(update.state).toMatchObject({
      blobUrl: 'blob:https://course.example/id',
      mimeType: 'video/mp4',
      codecs: 'avc1.640028'
    });
  });

  it('announces the first and every twentieth unique segment only', () => {
    let state = emptyMseState();
    const announcements: number[] = [];
    for (let index = 1; index <= 21; index += 1) {
      const update = reduceMseState(state, {
        ...base,
        type: 'segment-url',
        url: `https://cdn.example/${index}.m4s`,
        isInit: index === 1
      });
      state = update.state;
      if (update.announce) announcements.push(index);
    }

    expect(announcements).toEqual([1, 20]);
    expect(state.initSegmentUrl).toBe('https://cdn.example/1.m4s');

    const duplicate = reduceMseState(state, {
      ...base,
      type: 'segment-url',
      url: 'https://cdn.example/20.m4s',
      isInit: false
    });
    expect(duplicate).toEqual({ state, announce: false });
  });

  it('caps retained segment URLs at 500', () => {
    const state = {
      ...emptyMseState(),
      segmentUrls: Array.from({ length: 500 }, (_, index) => `https://cdn.example/${index}.m4s`)
    };
    const update = reduceMseState(state, {
      ...base,
      type: 'segment-url',
      url: 'https://cdn.example/overflow.m4s',
      isInit: false
    });
    expect(update).toEqual({ state, announce: false });
  });

  it('announces a changed duration but only records byte progress', () => {
    const duration = reduceMseState(emptyMseState(), {
      ...base,
      type: 'duration',
      duration: 42
    });
    expect(duration).toEqual({
      state: { ...emptyMseState(), duration: 42 },
      announce: true
    });

    const progress = reduceMseState(duration.state, {
      ...base,
      type: 'progress',
      totalBytes: 2048
    });
    expect(progress.state.totalBytes).toBe(2048);
    expect(progress.announce).toBe(false);
  });
});
