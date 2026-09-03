import { describe, it, expect } from 'vitest';
import type { VideoInfo, VideoQuality } from '../lib/types';
import {
  formatBandwidth, formatDuration, formatETA, formatFileSize,
  formatRelativeTime, formatSpeed, getQualityLabel, getSizeLabel, getTypeLabel
} from './format';

describe('getQualityLabel', () => {
  it.each([[2160, '4K'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']])(
    'names %ip as %s', (height, label) => expect(getQualityLabel(height)).toBe(label));

  it('rounds an odd height up to the band it belongs to', () => {
    expect(getQualityLabel(1082)).toBe('1080p');
  });

  it('says so when the height is unknown', () => {
    expect(getQualityLabel(undefined)).toBe('Unknown');
  });
});

describe('getTypeLabel', () => {
  it.each([['hls', 'HLS'], ['m3u8', 'HLS'], ['dash', 'DASH'], ['ytdlp', 'YT-DLP'], ['mp4', 'MP4']])(
    'shows %s as %s', (type, label) => expect(getTypeLabel(type)).toBe(label));

  it('falls back for anything unrecognised', () => {
    expect(getTypeLabel('something-new')).toBe('Video');
  });
});

describe('formatDuration', () => {
  it('drops the hour when there is none', () => expect(formatDuration(1523)).toBe('25:23'));
  it('includes the hour when there is one', () => expect(formatDuration(3600)).toBe('1:00:00'));
  it('pads seconds', () => expect(formatDuration(65)).toBe('1:05'));
});

describe('formatFileSize', () => {
  it.each([[512, '512 B'], [2048, '2.0 KB'], [5_242_880, '5.0 MB'], [2_147_483_648, '2.00 GB']])(
    'renders %i as %s', (bytes, out) => expect(formatFileSize(bytes)).toBe(out));
});

describe('formatBandwidth', () => {
  it('uses Mbps above a million', () => expect(formatBandwidth(2_800_000)).toBe('2.8 Mbps'));
  it('uses Kbps below it', () => expect(formatBandwidth(700_000)).toBe('700 Kbps'));
});

describe('formatSpeed', () => {
  it('scales to MB/s', () => expect(formatSpeed(1_450_000)).toBe('1.4 MB/s'));
  it('scales to KB/s', () => expect(formatSpeed(51_200)).toBe('51 KB/s'));
  it('says nothing for no speed', () => expect(formatSpeed(0)).toBe(''));
});

describe('formatETA', () => {
  it('reads as minutes and seconds', () => expect(formatETA(92)).toBe('1:32'));
  it('switches to hours when long', () => expect(formatETA(7200)).toBe('2h 0m'));
  it('shows a placeholder when unknown', () => expect(formatETA(Infinity)).toBe('--:--'));
});

describe('formatRelativeTime', () => {
  const ago = (ms: number) => formatRelativeTime(Date.now() - ms);
  it('says just now under a minute', () => expect(ago(30_000)).toBe('just now'));
  it('counts minutes', () => expect(ago(42 * 60_000)).toBe('42m ago'));
  it('counts hours', () => expect(ago(5 * 3_600_000)).toBe('5h ago'));
  it('counts days', () => expect(ago(2 * 86_400_000)).toBe('2d ago'));
  it('never reads as negative when a clock is skewed', () => {
    expect(formatRelativeTime(Date.now() + 60_000)).toBe('just now');
  });
});

describe('getSizeLabel', () => {
  const video = { duration: 1523, qualities: [] } as unknown as VideoInfo;

  it('prefers a size the server actually reported', () => {
    expect(getSizeLabel({ fileSize: 5_242_880 } as VideoQuality, video)).toBe('5.0 MB');
  });

  it('estimates from bitrate and duration when there is no size', () => {
    // 2.8 Mbps over 1523s ≈ 533 MB, marked as an estimate.
    expect(getSizeLabel({ bitrate: 2_800_000 } as VideoQuality, video)).toMatch(/^~\d+\.\d MB$/);
  });

  it('gives up rather than guessing without a duration', () => {
    const noDuration = { qualities: [] } as unknown as VideoInfo;
    expect(getSizeLabel({ bitrate: 2_800_000 } as VideoQuality, noDuration)).toBeUndefined();
  });
});
