import { describe, expect, it } from 'vitest';
import { isMediaUrl, isYouTubeUrl, mediaTypeFromUrl, resolveMediaUrl } from './media-url';

const PAGE = 'https://course.example/lesson/intro';

describe('mediaTypeFromUrl', () => {
  it.each([
    ['https://cdn.example/master.m3u8?token=1', 'hls'],
    ['https://cdn.example/path/video.MPD/manifest', 'dash'],
    ['https://cdn.example/video.MP4?token=1', 'mp4'],
    ['https://cdn.example/video.webm#time=2', 'webm'],
    ['https://cdn.example/stream', 'direct'],
    ['not a URL', 'direct']
  ] as const)('classifies %s as %s', (url, type) => {
    expect(mediaTypeFromUrl(url)).toBe(type);
  });

  it('resolves relative paths before classifying them', () => {
    expect(mediaTypeFromUrl('../media/lesson.m3u8', PAGE)).toBe('hls');
  });
});

describe('isMediaUrl', () => {
  it.each([
    'https://cdn.example/master.m3u8',
    'https://cdn.example/master.m3u8/redirect',
    'https://cdn.example/manifest.mpd?x=1',
    'https://cdn.example/video.mp4',
    'https://cdn.example/video.webm'
  ])('recognizes %s', (url) => {
    expect(isMediaUrl(url)).toBe(true);
  });

  it.each([
    'https://cdn.example/video.mp4/chunk',
    'https://cdn.example/manifest',
    'https://cdn.example/file.ts',
    'blob:https://course.example/id',
    'data:video/mp4;base64,AAAA',
    'not a URL'
  ])('rejects arbitrary candidate %s', (url) => {
    expect(isMediaUrl(url)).toBe(false);
  });

  it('recognizes a relative media attribute against the page URL', () => {
    expect(isMediaUrl('/assets/video.mp4', PAGE)).toBe(true);
  });

  it('accepts URL objects for webRequest callers', () => {
    expect(isMediaUrl(new URL('https://cdn.example/master.m3u8'))).toBe(true);
  });
});

describe('resolveMediaUrl', () => {
  it('normalizes relative paths to one absolute dedup key', () => {
    expect(resolveMediaUrl('../media/lesson one.mp4', PAGE))
      .toBe('https://course.example/media/lesson%20one.mp4');
  });

  it('keeps absolute blob URLs for media-element evidence', () => {
    expect(resolveMediaUrl('blob:https://course.example/id', PAGE))
      .toBe('blob:https://course.example/id');
  });

  it('returns null for a malformed base and value', () => {
    expect(resolveMediaUrl('video.mp4', 'not a base')).toBeNull();
  });
});

describe('isYouTubeUrl', () => {
  it.each([
    'https://youtube.com/watch?v=1',
    'https://www.youtube.com/watch?v=1',
    'https://m.youtube.com/watch?v=1',
    'https://youtu.be/id',
    'https://www.youtube-nocookie.com/embed/id'
  ])('recognizes %s', (url) => {
    expect(isYouTubeUrl(url)).toBe(true);
  });

  it.each([
    'https://notyoutube.com/watch?v=1',
    'https://youtube.com.example/watch?v=1',
    'not a URL'
  ])('rejects %s', (url) => {
    expect(isYouTubeUrl(url)).toBe(false);
  });
});
