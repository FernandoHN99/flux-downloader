import { describe, expect, it } from 'vitest';
import {
  buildYtdlpVideo,
  fallbackYtdlpQualities,
  normalizeYtdlpQualities
} from './youtube';

const URL = 'https://www.youtube.com/watch?v=abc';

describe('fallbackYtdlpQualities', () => {
  it('marks video and MP3 as different media kinds', () => {
    const [best, audio] = fallbackYtdlpQualities(URL);
    expect(best).toMatchObject({ label: 'Best', kind: 'video', url: URL });
    expect(audio).toMatchObject({ label: 'Audio MP3', kind: 'audio', ext: 'mp3', url: URL });
  });
});

describe('normalizeYtdlpQualities', () => {
  it('normalizes numeric wire values and keeps supported metadata', () => {
    expect(normalizeYtdlpQualities(URL, [{
      height: '1080',
      width: '1920',
      bitrate: '4500000',
      fps: '60',
      fileSize: '1234',
      label: '1080p 60fps',
      formatId: '137',
      ext: 'mp4',
      kind: 'video',
      language: 'en',
      formatArgs: ['-f', '137+ba']
    }])).toEqual([{
      height: 1080,
      width: 1920,
      bitrate: 4500000,
      fps: 60,
      fileSize: 1234,
      label: '1080p 60fps',
      formatId: '137',
      ext: 'mp4',
      kind: 'video',
      language: 'en',
      url: URL,
      formatArgs: ['-f', '137+ba']
    }]);
  });

  it('infers audio and subtitle kinds from legacy CoApp arguments', () => {
    const [audio, subtitle] = normalizeYtdlpQualities(URL, [
      { height: 0, ext: 'mp3', label: 'Audio MP3', formatArgs: ['-x', '--audio-format', 'mp3'] },
      { height: 0, ext: 'vtt', label: 'Subtitles', formatArgs: ['--write-subs', '--sub-lang', 'pt'] }
    ]);
    expect(audio.kind).toBe('audio');
    expect(subtitle.kind).toBe('subtitle');
  });

  it('rejects malformed entries and non-string arguments', () => {
    expect(normalizeYtdlpQualities(URL, null)).toEqual([]);
    expect(normalizeYtdlpQualities(URL, [
      null,
      {},
      { formatArgs: [] },
      { formatArgs: [1, false] }
    ])).toEqual([]);
  });

  it('drops non-finite and non-positive numeric metadata', () => {
    expect(normalizeYtdlpQualities(URL, [{
      height: -1,
      width: 'invalid',
      bitrate: Infinity,
      fps: 0,
      fileSize: -20,
      formatArgs: ['-f', 'best']
    }])[0]).toMatchObject({
      height: 0,
      bitrate: 0,
      kind: 'video'
    });
  });
});

describe('buildYtdlpVideo', () => {
  it('uses native metadata and normalized qualities when available', () => {
    const item = buildYtdlpVideo('youtube-1', URL, {
      pageUrl: URL,
      title: 'Page title',
      duration: 10,
      thumbnail: 'page.jpg'
    }, {
      title: 'Native title',
      duration: 20,
      thumbnail: 'native.jpg',
      qualities: [{ label: '720p', height: 720, formatArgs: ['-f', '22'] }]
    });
    expect(item).toMatchObject({
      id: 'youtube-1',
      title: 'Native title',
      duration: 20,
      thumbnail: 'native.jpg',
      pageUrl: URL,
      type: 'ytdlp'
    });
    expect(item.qualities[0]).toMatchObject({ height: 720, kind: 'video', url: URL });
  });

  it('falls back to page metadata and safe formats', () => {
    const item = buildYtdlpVideo('youtube-1', URL, {
      pageUrl: URL,
      title: 'Page title',
      duration: 10
    });
    expect(item.title).toBe('Page title');
    expect(item.duration).toBe(10);
    expect(item.qualities).toEqual(fallbackYtdlpQualities(URL));
  });
});
