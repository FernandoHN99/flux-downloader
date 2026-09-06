import { describe, expect, it } from 'vitest';
import {
  getContentType,
  getDirectHttpHeaders,
  getFfmpegHttpArgs,
  getMediaTypeFromContentType,
  getRequestReferer
} from './http-media';

describe('getContentType', () => {
  it('finds the header case-insensitively and strips parameters', () => {
    expect(getContentType([
      { name: 'Cache-Control', value: 'no-cache' },
      { name: 'Content-Type', value: ' Application/Dash+XML ; charset=utf-8' }
    ])).toBe('application/dash+xml');
  });

  it('returns an empty value for missing headers', () => {
    expect(getContentType()).toBe('');
    expect(getContentType([{ name: 'content-type' }])).toBe('');
  });
});

describe('getMediaTypeFromContentType', () => {
  it.each([
    ['application/vnd.apple.mpegurl', 'hls'],
    ['application/x-mpegurl', 'hls'],
    ['audio/mpegurl', 'hls'],
    ['audio/x-mpegurl', 'hls'],
    ['application/dash+xml', 'dash']
  ] as const)('maps %s to %s', (contentType, type) => {
    expect(getMediaTypeFromContentType(contentType)).toBe(type);
  });

  it('ignores non-manifest content', () => {
    expect(getMediaTypeFromContentType('video/mp4')).toBeUndefined();
  });
});

describe('getRequestReferer', () => {
  it('uses only the HTTP origin', () => {
    expect(getRequestReferer('https://course.example/lesson?id=1'))
      .toBe('https://course.example/');
  });

  it.each([undefined, '', 'null', 'chrome-extension://id/page', 'not a URL'])
    ('rejects %s', (value) => {
      expect(getRequestReferer(value)).toBeUndefined();
    });
});

describe('getFfmpegHttpArgs', () => {
  it('sets Referer and Origin for a valid page URL', () => {
    expect(getFfmpegHttpArgs('https://course.example/lesson')).toEqual([
      '-referer',
      'https://course.example/lesson',
      '-headers',
      'Origin: https://course.example\r\n'
    ]);
  });

  it('returns no args without a referer and a safe subset for malformed input', () => {
    expect(getFfmpegHttpArgs()).toEqual([]);
    expect(getFfmpegHttpArgs('not a URL')).toEqual(['-referer', 'not a URL']);
  });
});

describe('getDirectHttpHeaders', () => {
  it('forwards page context to every native HTTP request', () => {
    expect(getDirectHttpHeaders('https://course.example/lesson?id=1')).toEqual([
      { name: 'Referer', value: 'https://course.example/lesson?id=1' },
      { name: 'Origin', value: 'https://course.example' }
    ]);
  });

  it('keeps a malformed referer but omits an invented origin', () => {
    expect(getDirectHttpHeaders('not a URL')).toEqual([
      { name: 'Referer', value: 'not a URL' }
    ]);
    expect(getDirectHttpHeaders()).toEqual([]);
  });
});
