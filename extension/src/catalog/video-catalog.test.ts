import { describe, expect, it } from 'vitest';
import type { VideoInfo, VideoQuality } from '../shared/types';
import {
  mergeChildUrls,
  mergeQualities,
  upsertDetectedVideo,
  visibleVideos
} from './video-catalog';

function quality(url: string, height = 720): VideoQuality {
  return { url, height, bitrate: height * 1000 };
}

function video(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    id: 'video-1',
    title: 'Lesson',
    url: 'https://cdn.example/video.mp4',
    type: 'mp4',
    qualities: [],
    ...overrides
  };
}

describe('mergeQualities', () => {
  it('deduplicates by URL while preserving first-seen order and metadata', () => {
    const original = quality('https://cdn.example/720.m3u8', 720);
    const duplicate = { ...original, height: 1080 };
    const second = quality('https://cdn.example/480.m3u8', 480);

    expect(mergeQualities([original], [duplicate, second])).toEqual([original, second]);
  });

  it('ignores entries without a URL', () => {
    expect(mergeQualities([{ height: 720, url: '', bitrate: 1 }], [])).toEqual([]);
  });
});

describe('mergeChildUrls', () => {
  it('returns unique URLs or undefined for an empty result', () => {
    expect(mergeChildUrls(['one', 'two'], ['two', 'three'])).toEqual(['one', 'two', 'three']);
    expect(mergeChildUrls()).toBeUndefined();
  });
});

describe('visibleVideos', () => {
  it('shows only yt-dlp entries on YouTube pages', () => {
    const direct = video();
    const ytdlp = video({ id: 'youtube', type: 'ytdlp', url: 'https://youtube.com/watch?v=1' });
    expect(visibleVideos([direct, ytdlp], 'https://www.youtube.com/watch?v=1')).toEqual([ytdlp]);
  });

  it('prefers entries with finite positive durations', () => {
    const incidental = video();
    const infinite = video({ id: 'infinite', url: 'https://cdn.example/live.mp4', duration: Infinity });
    const primary = video({ id: 'primary', url: 'https://cdn.example/lesson.mp4', duration: 90 });
    expect(visibleVideos([incidental, infinite, primary])).toEqual([primary]);
  });

  it('keeps every entry when none has a useful duration', () => {
    const videos = [video(), video({ id: 'zero', url: 'https://cdn.example/zero.mp4', duration: 0 })];
    expect(visibleVideos(videos)).toBe(videos);
  });
});

describe('upsertDetectedVideo', () => {
  it('adds a detection with top-page ownership without mutating the old snapshot', () => {
    const previous = [video({ id: 'first', url: 'https://cdn.example/first.mp4' })];
    const incoming = video({ id: 'second', url: 'https://cdn.example/second.mp4' });
    const next = upsertDetectedVideo(previous, incoming, 'https://course.example/lesson');

    expect(next).not.toBe(previous);
    expect(previous).toHaveLength(1);
    expect(next[1].pageUrl).toBe('https://course.example/lesson');
  });

  it('preserves useful existing fields when an update is partial', () => {
    const existing = video({
      pageUrl: 'https://course.example/lesson',
      thumbnail: 'https://course.example/poster.jpg',
      duration: 90,
      fileSize: 1000,
      qualities: [quality('https://cdn.example/720.m3u8')],
      childUrls: ['https://cdn.example/child.m3u8']
    });
    const partial = video({ title: '', pageUrl: undefined });
    const next = upsertDetectedVideo([existing], partial);

    expect(next[0]).toMatchObject({
      title: 'Lesson',
      pageUrl: 'https://course.example/lesson',
      thumbnail: 'https://course.example/poster.jpg',
      duration: 90,
      fileSize: 1000,
      qualities: existing.qualities,
      childUrls: existing.childUrls
    });
  });

  it('ignores a child playlist already owned by an HLS master', () => {
    const childUrl = 'https://cdn.example/720.m3u8';
    const master = video({
      id: 'master',
      type: 'hls',
      url: 'https://cdn.example/master.m3u8',
      qualities: [quality(childUrl)]
    });
    const previous = [master];
    const next = upsertDetectedVideo(previous, video({ type: 'hls', url: childUrl }));
    expect(next).toBe(previous);
  });

  it('removes known HLS children when their master arrives later', () => {
    const qualityChild = video({ id: 'quality', type: 'hls', url: 'https://cdn.example/720.m3u8' });
    const listedChild = video({ id: 'listed', type: 'hls', url: 'https://cdn.example/audio.m3u8' });
    const unrelated = video({ id: 'other', url: 'https://cdn.example/video.mp4' });
    const master = video({
      id: 'master',
      type: 'hls',
      url: 'https://cdn.example/master.m3u8',
      qualities: [quality(qualityChild.url)],
      childUrls: [listedChild.url]
    });

    expect(upsertDetectedVideo([qualityChild, listedChild, unrelated], master))
      .toEqual([unrelated, master]);
  });
});

describe('upsertDetectedVideo identity', () => {
  it('updates the existing row when a signed link comes back with a new token', () => {
    const existing = [video({ url: 'https://cdn.test/lesson.mp4?token=aaa', title: 'Lesson' })];

    const next = upsertDetectedVideo(
      existing,
      video({ url: 'https://cdn.test/lesson.mp4?token=bbb', duration: 120 })
    );

    expect(next).toHaveLength(1);
    expect(next[0].duration).toBe(120);
  });

  it('keeps two genuinely different videos on the same host apart', () => {
    const existing = [video({ url: 'https://cdn.test/one.mp4' })];

    const next = upsertDetectedVideo(existing, video({ url: 'https://cdn.test/two.mp4' }));

    expect(next).toHaveLength(2);
  });

  it('keeps two YouTube videos apart despite the shared /watch path', () => {
    const existing = [video({ url: 'https://www.youtube.com/watch?v=aaa', type: 'ytdlp' })];

    const next = upsertDetectedVideo(
      existing,
      video({ url: 'https://www.youtube.com/watch?v=bbb', type: 'ytdlp' })
    );

    expect(next).toHaveLength(2);
  });
});
