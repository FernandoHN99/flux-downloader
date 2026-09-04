import { describe, expect, it } from 'vitest';
import { announcedVideo, detectionReplayKey, emptyMseState, mseDetection } from './mse-media';

const PAGE = 'https://course.example/lesson';

describe('mseDetection', () => {
  it('starts with an isolated empty state', () => {
    const first = emptyMseState();
    const second = emptyMseState();
    first.segmentUrls.push('one');
    expect(second).toEqual({ totalBytes: 0, segmentUrls: [] });
  });

  it('needs both a MIME type and a usable URL', () => {
    expect(mseDetection(emptyMseState(), PAGE, 1)).toBeNull();
    expect(mseDetection({ ...emptyMseState(), mimeType: 'video/mp4' }, PAGE, 1)).toBeNull();
  });

  it('builds a video quality from a blob and first codec', () => {
    const media = mseDetection({
      ...emptyMseState(),
      blobUrl: 'blob:https://course.example/id',
      mimeType: 'video/mp4',
      codecs: 'avc1.640028, mp4a.40.2',
      duration: 95
    }, PAGE, 3);

    expect(media).toMatchObject({
      type: 'mse',
      url: 'blob:https://course.example/id',
      pageUrl: PAGE,
      generation: 3,
      duration: 95,
      qualities: [{ label: 'avc1.640028', kind: 'video' }]
    });
  });

  it('labels audio-only source buffers honestly', () => {
    const media = mseDetection({
      ...emptyMseState(),
      blobUrl: 'blob:https://course.example/audio',
      mimeType: 'audio/mp4',
      codecs: 'mp4a.40.2'
    }, PAGE, 0);
    expect(media?.qualities[0]).toMatchObject({ label: 'Audio', kind: 'audio' });
  });

  it('prefers the init URL and builds bounded segment arguments', () => {
    const segments = Array.from(
      { length: 230 },
      (_, index) => 'https://cdn.example/' + index + '.m4s'
    );
    const media = mseDetection({
      ...emptyMseState(),
      blobUrl: 'blob:https://course.example/id',
      initSegmentUrl: segments[0],
      segmentUrls: segments,
      mimeType: 'video/mp4'
    }, PAGE, 2)!;

    expect(media.url).toBe(segments[0]);
    expect(media.qualities[1].label).toBe('All Segments');
    expect(media.qualities[1].formatArgs?.filter((arg) => arg === '-i')).toHaveLength(200);
    expect(media.qualities[1].formatArgs).not.toContain(segments[200]);
  });

  it('replaces earlier MSE snapshots while ordinary media stays keyed by URL', () => {
    expect(detectionReplayKey({
      type: 'mse',
      url: 'blob:https://course.example/old',
      pageUrl: PAGE,
      generation: 1
    })).toBe('mse');
    expect(detectionReplayKey({
      type: 'mp4',
      url: 'https://cdn.example/video.mp4',
      pageUrl: PAGE,
      generation: 1
    })).toBe('https://cdn.example/video.mp4');
  });
});

describe('announcedVideo', () => {
  it('uses captured MSE duration before the DOM fallback', () => {
    const media = mseDetection({
      ...emptyMseState(),
      blobUrl: 'blob:https://course.example/id',
      mimeType: 'video/mp4',
      duration: 45
    }, PAGE, 4)!;

    expect(announcedVideo(media, 'mse_1', 'Lesson', {
      duration: 99,
      thumbnail: 'https://course.example/poster.jpg'
    })).toMatchObject({
      id: 'mse_1',
      title: 'Lesson',
      duration: 45,
      thumbnail: 'https://course.example/poster.jpg',
      generation: 4
    });
  });

  it('falls back to page duration for ordinary detections', () => {
    expect(announcedVideo({
      type: 'mp4',
      url: 'https://cdn.example/a.mp4',
      pageUrl: PAGE,
      generation: 1
    }, 'video_1', 'A', { duration: 12 })).toMatchObject({
      duration: 12,
      qualities: []
    });
  });
});
