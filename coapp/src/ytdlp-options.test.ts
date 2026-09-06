import { describe, expect, it } from 'vitest';
import { buildYtDlpDownloadArgs, YTDLP_CONCURRENT_FRAGMENTS } from './ytdlp-options';

describe('buildYtDlpDownloadArgs', () => {
  it('enables bounded fragment concurrency without moving selected arguments', () => {
    const args = buildYtDlpDownloadArgs(
      'https://youtube.com/watch?v=one',
      ['-f', '137+140'],
      '/downloads/Lesson.%(ext)s',
      '/runtime/ffmpeg'
    );

    expect(YTDLP_CONCURRENT_FRAGMENTS).toBe(8);
    expect(args).toEqual([
      '--no-playlist', '--no-warnings', '--newline',
      '--concurrent-fragments', '8',
      '-o', '/downloads/Lesson.%(ext)s',
      '--ffmpeg-location', '/runtime/ffmpeg',
      '-f', '137+140',
      'https://youtube.com/watch?v=one'
    ]);
  });

  it('omits an unavailable FFmpeg location', () => {
    expect(buildYtDlpDownloadArgs('https://example/video', [], 'out.%(ext)s'))
      .not.toContain('--ffmpeg-location');
  });
});
