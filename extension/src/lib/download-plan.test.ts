import { describe, expect, it } from 'vitest';
import type { VideoInfo, VideoQuality } from './types';
import {
  ensureFilenameExtension,
  formatFfmpegError,
  getDefaultExtension,
  joinOutputPath,
  pickBatchQuality,
  sanitizeFilename
} from './download-plan';

function quality(
  height: number,
  overrides: Partial<VideoQuality> = {}
): VideoQuality {
  return {
    height,
    bitrate: height * 1000,
    url: `https://cdn.example/${height || 'audio'}`,
    ...overrides
  };
}

function video(qualities: VideoQuality[] = []): VideoInfo {
  return {
    id: 'one',
    title: 'Lesson',
    url: 'https://cdn.example/master.m3u8',
    type: 'hls',
    qualities
  };
}

describe('pickBatchQuality', () => {
  it('selects the highest or lowest video rendition', () => {
    const item = video([quality(720), quality(1080), quality(360)]);
    expect(pickBatchQuality(item, 'best')?.height).toBe(1080);
    expect(pickBatchQuality(item, 'worst')?.height).toBe(360);
  });

  it('does not choose audio over an available video', () => {
    const audio = quality(0, { kind: 'audio', label: 'Portuguese' });
    const picture = quality(720, { kind: 'video' });
    expect(pickBatchQuality(video([audio, picture]), 'worst')).toBe(picture);
  });

  it('falls back to non-video renditions and handles an empty list', () => {
    const audio = quality(0, { kind: 'audio' });
    expect(pickBatchQuality(video([audio]), 'best')).toBe(audio);
    expect(pickBatchQuality(video(), 'best')).toBeUndefined();
  });
});

describe('download filenames', () => {
  it('replaces forbidden characters and trims the result', () => {
    expect(sanitizeFilename('  lesson: 1?.mp4  ', 1)).toBe('lesson_ 1_.mp4');
  });

  it('uses a deterministic fallback for an empty sanitized name', () => {
    expect(sanitizeFilename('  ', 123)).toBe('video_123');
  });

  it('replaces known media extensions and accepts a dotted target', () => {
    expect(ensureFilenameExtension('lesson.M3U8', '.mp4')).toBe('lesson.mp4');
    expect(ensureFilenameExtension('lesson.part', 'webm')).toBe('lesson.part.webm');
  });

  it.each([
    [quality(0, { kind: 'subtitle', ext: 'srt' }), 'hls', 'srt'],
    [quality(0, { kind: 'subtitle' }), 'hls', 'vtt'],
    [quality(0, { kind: 'audio', ext: 'opus' }), 'dash', 'opus'],
    [quality(0, { kind: 'audio' }), 'dash', 'm4a'],
    [quality(720), 'webm', 'webm'],
    [quality(0, { ext: 'mp3' }), 'ytdlp', 'mp3'],
    [quality(720), 'hls', 'mp4']
  ] as const)('chooses the output extension for %s', (item, type, extension) => {
    expect(getDefaultExtension(video([item]), type)).toBe(extension);
  });
});

describe('joinOutputPath', () => {
  it('joins POSIX and Windows paths without duplicate separators', () => {
    expect(joinOutputPath('/downloads///', 'lesson.mp4', 'linux'))
      .toBe('/downloads/lesson.mp4');
    expect(joinOutputPath('C:\\Downloads\\\\', 'lesson.mp4', 'win32'))
      .toBe('C:\\Downloads\\lesson.mp4');
  });

  it('returns the filename when no directory is configured', () => {
    expect(joinOutputPath('', 'lesson.mp4', 'darwin')).toBe('lesson.mp4');
  });
});

describe('formatFfmpegError', () => {
  it('turns expired and unreadable streams into actionable messages', () => {
    expect(formatFfmpegError(1, 'HTTP error 403 Forbidden')).toContain('устарела');
    expect(formatFfmpegError(1, 'Invalid data found')).toContain('не смог открыть');
  });

  it('keeps only the useful tail of an unknown error', () => {
    const error = formatFfmpegError(9, 'x'.repeat(1100));
    expect(error).toBe(`FFmpeg exit code 9: ${'x'.repeat(1000)}`);
  });
});
