import { describe, expect, it } from 'vitest';
import type { ParsedDash } from './dash-parser';
import type { ParsedM3U8 } from './m3u8-parser';
import { buildDashQualities, buildHlsQualities } from './manifest-qualities';

function hls(overrides: Partial<ParsedM3U8> = {}): ParsedM3U8 {
  return {
    type: 'master',
    variants: [],
    ...overrides
  };
}

describe('buildHlsQualities', () => {
  it('projects ordinary variants as video qualities in parser order', () => {
    const qualities = buildHlsQualities(hls({
      variants: [
        { url: 'https://cdn.example/1080.m3u8', bandwidth: 5_000_000, width: 1920, height: 1080, name: '1080p' },
        { url: 'https://cdn.example/720.m3u8', bandwidth: 2_500_000, width: 1280, height: 720, name: '720p' }
      ]
    }));

    expect(qualities).toEqual([
      {
        height: 1080,
        width: 1920,
        bitrate: 5_000_000,
        url: 'https://cdn.example/1080.m3u8',
        label: '1080p',
        kind: 'video'
      },
      {
        height: 720,
        width: 1280,
        bitrate: 2_500_000,
        url: 'https://cdn.example/720.m3u8',
        label: '720p',
        kind: 'video'
      }
    ]);
  });

  it('creates one muxed choice per alternate audio track and prioritizes the default', () => {
    const qualities = buildHlsQualities(hls({
      variants: [{
        url: 'https://cdn.example/video.m3u8',
        bandwidth: 2_500_000,
        height: 720,
        name: '720p',
        audioGroupId: 'main'
      }],
      mediaRenditions: [
        { type: 'AUDIO', groupId: 'main', name: 'English', language: 'en', uri: 'https://cdn.example/en.m3u8', autoselect: true },
        { type: 'AUDIO', groupId: 'main', name: 'Português', language: 'pt', uri: 'https://cdn.example/pt.m3u8', default: true }
      ]
    }), 'https://app.example/lesson');

    expect(qualities.slice(0, 2).map((quality) => quality.label)).toEqual([
      '720p - Português',
      '720p - English'
    ]);
    expect(qualities[0].formatArgs).toEqual([
      '-referer', 'https://app.example/lesson',
      '-headers', 'Origin: https://app.example\r\n',
      '-i', 'https://cdn.example/video.m3u8',
      '-referer', 'https://app.example/lesson',
      '-headers', 'Origin: https://app.example\r\n',
      '-i', 'https://cdn.example/pt.m3u8',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy'
    ]);
    expect(qualities.slice(2).map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'audio', label: 'Audio — English' },
      { kind: 'audio', label: 'Audio — Português' }
    ]);
  });

  it('keeps active audio and subtitle renditions but ignores unrelated groups and captions', () => {
    const qualities = buildHlsQualities(hls({
      variants: [{
        url: 'https://cdn.example/video.m3u8',
        bandwidth: 1,
        audioGroupId: 'audio',
        subtitleGroupId: 'subs'
      }],
      mediaRenditions: [
        { type: 'audio', groupId: 'audio', language: 'pt', uri: 'https://cdn.example/audio.m3u8' },
        { type: 'subtitles', groupId: 'subs', language: 'en', uri: 'https://cdn.example/subs.m3u8' },
        { type: 'AUDIO', groupId: 'unused', uri: 'https://cdn.example/unused.m3u8' },
        { type: 'CLOSED-CAPTIONS', groupId: 'subs', uri: 'https://cdn.example/captions.m3u8' },
        { type: 'VIDEO', groupId: 'subs', uri: 'https://cdn.example/alternate-video.m3u8' }
      ]
    }));

    expect(qualities.map(({ kind, label, url }) => ({ kind, label, url }))).toEqual([
      { kind: 'video', label: 'Video - pt', url: 'https://cdn.example/video.m3u8' },
      { kind: 'audio', label: 'Audio — pt', url: 'https://cdn.example/audio.m3u8' },
      { kind: 'subtitle', label: 'Subtitles — en', url: 'https://cdn.example/subs.m3u8' }
    ]);
  });

  it('omits referer arguments when no source page is known', () => {
    const [quality] = buildHlsQualities(hls({
      variants: [{ url: 'https://cdn.example/video.m3u8', bandwidth: 1, name: 'Video', audioGroupId: 'audio' }],
      mediaRenditions: [{ type: 'AUDIO', groupId: 'audio', uri: 'https://cdn.example/audio.m3u8' }]
    }));

    expect(quality.formatArgs).toEqual([
      '-i', 'https://cdn.example/video.m3u8',
      '-i', 'https://cdn.example/audio.m3u8',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy'
    ]);
  });
});

describe('buildDashQualities', () => {
  it('projects video variants and subtitle tracks with explicit kinds', () => {
    const parsed: ParsedDash = {
      type: 'master',
      variants: [{
        url: 'https://cdn.example/manifest.mpd',
        bandwidth: 4_000_000,
        width: 1920,
        height: 1080,
        name: '1080p',
        encrypted: false
      }],
      subtitleTracks: [
        { url: 'https://cdn.example/pt.vtt', lang: 'pt', mimeType: 'text/vtt' },
        { url: 'https://cdn.example/default.vtt' }
      ]
    };

    expect(buildDashQualities(parsed)).toEqual([
      {
        height: 1080,
        width: 1920,
        bitrate: 4_000_000,
        url: 'https://cdn.example/manifest.mpd',
        label: '1080p',
        kind: 'video'
      },
      {
        height: 0,
        url: 'https://cdn.example/pt.vtt',
        bitrate: 0,
        label: 'Subtitles — pt',
        kind: 'subtitle',
        language: 'pt'
      },
      {
        height: 0,
        url: 'https://cdn.example/default.vtt',
        bitrate: 0,
        label: 'Subtitles',
        kind: 'subtitle',
        language: undefined
      }
    ]);
  });
});
