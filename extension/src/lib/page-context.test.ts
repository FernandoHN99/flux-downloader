import { describe, expect, it } from 'vitest';
import type { VideoInfo } from './types';
import { applyPageMetadataToVideos, mergePageMetadata } from './page-context';

function video(overrides: Partial<VideoInfo> = {}): VideoInfo {
  return {
    id: 'one',
    title: 'Stream',
    url: 'https://vz-cdn.example/stream.m3u8',
    type: 'hls',
    qualities: [],
    ...overrides
  };
}

describe('mergePageMetadata', () => {
  it('lets the top frame replace page identity while retaining absent details', () => {
    expect(mergePageMetadata({
      pageUrl: 'https://course.example/old',
      title: 'Old lesson',
      thumbnail: 'https://course.example/old.jpg',
      duration: 30,
      generation: 1
    }, {
      pageUrl: 'https://course.example/new',
      title: 'New lesson',
      generation: 2
    }, true)).toEqual({
      pageUrl: 'https://course.example/new',
      title: 'New lesson',
      thumbnail: 'https://course.example/old.jpg',
      duration: 30,
      generation: 2
    });
  });

  it('does not let a child frame replace the top page URL or title', () => {
    expect(mergePageMetadata({
      pageUrl: 'https://app.rocketseat.com.br/jornada/react/aula/one',
      title: 'Rocketseat lesson',
      generation: 4
    }, {
      pageUrl: 'https://vz-123.b-cdn.net/embed',
      title: 'CDN player',
      thumbnail: 'https://vz-123.b-cdn.net/poster.jpg',
      duration: 125,
      generation: 99
    }, false)).toEqual({
      pageUrl: 'https://app.rocketseat.com.br/jornada/react/aula/one',
      title: 'Rocketseat lesson',
      thumbnail: 'https://vz-123.b-cdn.net/poster.jpg',
      duration: 125,
      generation: 4
    });
  });

  it('allows a child frame to fill a missing top title', () => {
    expect(mergePageMetadata({ pageUrl: 'https://course.example/lesson', generation: 1 }, {
      title: 'Embedded lesson', duration: 60
    }, false)).toMatchObject({
      pageUrl: 'https://course.example/lesson',
      title: 'Embedded lesson',
      duration: 60,
      generation: 1
    });
  });
});

describe('applyPageMetadataToVideos', () => {
  it('assigns the exact top page to CDN media', () => {
    const result = applyPageMetadataToVideos([video()], {
      pageUrl: 'https://app.rocketseat.com.br/jornada/react/aula/one',
      thumbnail: 'https://app.rocketseat.com.br/poster.jpg',
      duration: 90
    });
    expect(result[0]).toMatchObject({
      url: 'https://vz-cdn.example/stream.m3u8',
      pageUrl: 'https://app.rocketseat.com.br/jornada/react/aula/one',
      thumbnail: 'https://app.rocketseat.com.br/poster.jpg',
      duration: 90
    });
  });

  it('preserves richer media metadata', () => {
    const original = video({
      pageUrl: 'https://course.example/old',
      thumbnail: 'https://cdn.example/media-poster.jpg',
      duration: 120
    });
    const videos = [original];
    const result = applyPageMetadataToVideos(videos, {
      pageUrl: 'https://course.example/lesson',
      thumbnail: 'https://course.example/page-poster.jpg',
      duration: 90
    });
    expect(result).not.toBe(videos);
    expect(result[0]).toMatchObject({
      pageUrl: 'https://course.example/lesson',
      thumbnail: 'https://cdn.example/media-poster.jpg',
      duration: 120
    });
  });

  it('returns the same snapshot when no field changes', () => {
    const original = video({ pageUrl: 'https://course.example/lesson', duration: 120 });
    const videos = [original];
    expect(applyPageMetadataToVideos(videos, {
      pageUrl: 'https://course.example/lesson', duration: 90
    })).toBe(videos);
  });
});
