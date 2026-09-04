import { describe, it, expect } from 'vitest';
import type { VideoInfo } from '../shared/types';
import { activeShortcut, buildQualityOptions, lowestQualityIndex, type QualityOption } from './quality';

const video = (patch: Partial<VideoInfo>): VideoInfo =>
  ({ id: 'v', title: 't', url: 'https://cdn.x/a.m3u8', type: 'hls', qualities: [], ...patch }) as VideoInfo;

const opt = (height: number, kind?: QualityOption['kind']): QualityOption =>
  ({ label: `${height}p`, bandwidth: 0, bandwidthLabel: '', url: 'u', height, kind });

describe('buildQualityOptions', () => {
  it('carries every rendition through with a readable label', () => {
    const options = buildQualityOptions(video({
      qualities: [
        { height: 1080, width: 1920, bitrate: 2_800_000, url: 'a' },
        { height: 720, width: 1280, bitrate: 1_400_000, url: 'b' }
      ]
    }));
    expect(options.map((o) => o.label)).toEqual(['1080p', '720p']);
    expect(options[0].resolution).toBe('1920x1080');
    expect(options[0].bandwidthLabel).toBe('2.8 Mbps');
  });

  it('keeps a label the parser already supplied', () => {
    const options = buildQualityOptions(video({ qualities: [{ height: 0, url: 'a', label: 'Audio 128k' }] }));
    expect(options[0].label).toBe('Audio 128k');
  });

  it('offers the link itself when nothing was parsed', () => {
    const options = buildQualityOptions(video({ type: 'mp4', qualities: [], url: 'https://cdn.x/v.mp4' }));
    expect(options).toEqual([expect.objectContaining({ label: 'Direct', url: 'https://cdn.x/v.mp4' })]);
  });

  // YouTube formats arrive later from yt-dlp; a Direct row would download the
  // watch page instead of the video.
  it('offers nothing for a YouTube video still waiting on its formats', () => {
    expect(buildQualityOptions(video({ type: 'ytdlp', qualities: [] }))).toEqual([]);
  });
});

describe('lowestQualityIndex', () => {
  it('picks the last real rendition', () => {
    expect(lowestQualityIndex([opt(1080), opt(720), opt(480)])).toBe(2);
  });

  it('skips audio and subtitle tracks sorted below the video', () => {
    const options = [opt(1080), opt(480), opt(0, 'audio'), opt(0, 'subtitle')];
    expect(lowestQualityIndex(options)).toBe(1);
  });

  it('still returns something when there is no video at all', () => {
    expect(lowestQualityIndex([opt(0, 'audio')])).toBe(0);
  });
});

describe('activeShortcut', () => {
  const options = [opt(1080), opt(720), opt(480)];

  it('lights Best on the top rendition', () => expect(activeShortcut(options, 0)).toBe('best'));
  it('lights Lowest on the bottom one', () => expect(activeShortcut(options, 2)).toBe('worst'));

  // Showing "Best" lit while 720p is chosen would be a lie.
  it('lights neither when a middle quality was picked by hand', () => {
    expect(activeShortcut(options, 1)).toBeNull();
  });

  it('lights Best when the only option is both', () => {
    expect(activeShortcut([opt(1080)], 0)).toBe('best');
  });
});
