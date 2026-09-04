import { describe, it, expect } from 'vitest';
import { videoKey, domainOf } from './video-key';

describe('videoKey', () => {
  it('ignores the query string so a rotated token is the same video', () => {
    expect(videoKey('https://cdn.x/l9/play.m3u8?token=NEW'))
      .toBe(videoKey('https://cdn.x/l9/play.m3u8?token=OLD'));
  });

  it('keeps origin and path, which are what identify the file', () => {
    expect(videoKey('https://cdn.x/l9/play.m3u8?t=1')).toBe('https://cdn.x/l9/play.m3u8');
  });

  it('separates different paths on the same host', () => {
    expect(videoKey('https://cdn.x/a.m3u8')).not.toBe(videoKey('https://cdn.x/b.m3u8'));
  });

  it('falls back to the raw string when the url will not parse', () => {
    expect(videoKey('not a url')).toBe('not a url');
  });
});

describe('domainOf', () => {
  it('prefers the page over the media host', () => {
    expect(domainOf('https://app.rocketseat.com.br/aula-9', 'https://cdn.rocketseat.com/x.m3u8'))
      .toBe('app.rocketseat.com.br');
  });

  it('drops the www prefix so one site is one folder', () => {
    expect(domainOf('https://www.udemy.com/course', 'x')).toBe('udemy.com');
  });

  it('falls back to the media host when the page is unknown', () => {
    expect(domainOf(undefined, 'https://cdn.example.com/a.mp4')).toBe('cdn.example.com');
  });

  it('buckets anything unparseable together rather than throwing', () => {
    expect(domainOf(undefined, 'blob:whatever')).toBe('Other');
  });
});
