import { describe, expect, it } from 'vitest';
import type { VideoInfo, VideoQuality } from '../shared/types';
import {
  batchNumberPrefix,
  buildBatchDownloadPlans,
  ensureFilenameExtension,
  formatFfmpegError,
  getDefaultExtension,
  joinOutputPath,
  pickBatchQuality,
  rankFallbackRenditions,
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

  describe('batch numbering', () => {
    const make = (title: string, url = `https://cdn.example/${title}`, qualities?: VideoQuality[]) => {
      const item = video(qualities ?? [quality(720, { url })]);
      item.title = title;
      return item;
    };
    const names = (videos: VideoInfo[]) =>
      buildBatchDownloadPlans(videos, 'best').map((plan) => plan.filename);

    it('numbers every file by when it was added: the last in the list is 01, the first is the total', () => {
      expect(names([make('Newest'), make('Middle'), make('Oldest')])).toEqual([
        '03-Newest.mp4',
        '02-Middle.mp4',
        '01-Oldest.mp4'
      ]);
    });

    it('keeps lessons that a player titles alike apart, in order', () => {
      expect(names([
        make('Course', 'https://cdn.example/c'),
        make('Course', 'https://cdn.example/b'),
        make('Course', 'https://cdn.example/a')
      ])).toEqual(['03-Course.mp4', '02-Course.mp4', '01-Course.mp4']);
    });

    it('sanitizes the name and keeps the number in front of it', () => {
      expect(names([make('Lesson: 2?'), make('Lesson: 1?')])).toEqual([
        '02-Lesson_ 2_.mp4',
        '01-Lesson_ 1_.mp4'
      ]);
    });

    it('keeps a video\'s number when another in the batch cannot be planned, so a gap shows a missing lesson', () => {
      const plans = buildBatchDownloadPlans(
        [make('Three'), make('Two', 'https://cdn.example/two', []), make('One')],
        'best'
      );

      expect(plans.map((plan) => plan.filename)).toEqual(['03-Three.mp4', undefined, '01-One.mp4']);
      expect(plans[1].selected).toBeUndefined();
    });

    it('pads to the width of the total, so a long course still sorts', () => {
      const videos = Array.from({ length: 100 }, (_, index) => make(`Lesson ${index}`));
      const plans = names(videos);

      expect(plans[0]).toBe('100-Lesson 0.mp4');
      expect(plans[99]).toBe('001-Lesson 99.mp4');
      expect(new Set(plans).size).toBe(100);
    });

    it('leaves a batch of one unnumbered: there is nothing to order', () => {
      expect(names([make('Only')])).toEqual(['Only.mp4']);
    });

    it('keeps the chosen rendition with its file', () => {
      const plans = buildBatchDownloadPlans(
        [make('B', 'https://cdn.example/b'), make('A', 'https://cdn.example/a')],
        'best'
      );

      expect(plans.map((plan) => plan.selected?.url)).toEqual(['https://cdn.example/b', 'https://cdn.example/a']);
    });
  });

  describe('batchNumberPrefix', () => {
    it('is two digits for a short batch and widens with the total', () => {
      expect(batchNumberPrefix(1, 5)).toBe('01-');
      expect(batchNumberPrefix(99, 99)).toBe('99-');
      expect(batchNumberPrefix(7, 100)).toBe('007-');
      expect(batchNumberPrefix(1, 1000)).toBe('0001-');
    });

    it('is empty when nothing needs ordering', () => {
      expect(batchNumberPrefix(1, 1)).toBe('');
    });
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

describe('rankFallbackRenditions', () => {
  const dead = quality(2160, { url: 'https://cdn.example/uhd' });
  const siblings = [dead, quality(1080), quality(360), quality(720), quality(0, { kind: 'audio' })];

  it('offers the other video renditions, best first, never the dead one', () => {
    expect(rankFallbackRenditions(siblings, dead).map((item) => item.height))
      .toEqual([1080, 720, 360]);
  });

  it('puts renditions at or below the failed height ahead of higher ones', () => {
    const failed = quality(720);
    const all = [quality(1080), failed, quality(360)];

    expect(rankFallbackRenditions(all, failed).map((item) => item.height))
      .toEqual([360, 1080]);
  });

  it('returns nothing when the failed rendition was the only one', () => {
    expect(rankFallbackRenditions([dead], dead)).toEqual([]);
  });
});

