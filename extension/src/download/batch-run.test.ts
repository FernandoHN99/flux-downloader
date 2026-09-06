import { describe, expect, it } from 'vitest';
import { BatchRun } from './batch-run';
import type { VideoInfo } from '../shared/types';
import { videoKey } from '../detection/video-key';

function video(name: string): VideoInfo {
  return {
    id: name,
    title: `Lesson ${name}`,
    url: `https://cdn.example/${name}/master.m3u8?token=volatile`,
    type: 'hls',
    qualities: []
  };
}

describe('BatchRun', () => {
  it('initializes a transport-safe status for the complete queue', () => {
    const one = video('one');
    const two = video('two');
    const run = new BatchRun([one, two], 'Flux_123', 4);

    expect(run.snapshot()).toEqual({
      total: 2,
      completed: 0,
      failed: 0,
      folder: 'Flux_123',
      cancelled: false,
      remainingKeys: [videoKey(one.url), videoKey(two.url)],
      activeSourceKeys: [],
      concurrency: 4
    });
  });

  it('tracks several active sources and counts independent outcomes', () => {
    const one = video('one');
    const two = video('two');
    const run = new BatchRun([one, two], 'Flux_123', 4);

    run.begin(one);
    run.begin(two);
    expect(run.snapshot()).toMatchObject({
      currentTitle: 'Lesson one',
      currentSourceKey: videoKey(one.url),
      activeSourceKeys: [videoKey(one.url), videoKey(two.url)]
    });
    expect(run.attachDownload(one, 'convert_1')).toBe(false);
    expect(run.attachDownload(two, 'convert_2')).toBe(false);
    expect(run.complete(two, false)).toEqual({ markFailed: true });
    expect(run.snapshot()).toMatchObject({
      completed: 0,
      failed: 1,
      currentSourceKey: videoKey(one.url),
      activeSourceKeys: [videoKey(one.url)]
    });

    expect(run.complete(one, true)).toEqual({ markFailed: false });
    expect(run.snapshot()).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      folder: 'Flux_123',
      cancelled: false,
      remainingKeys: [],
      activeSourceKeys: [],
      concurrency: 4,
      currentTitle: undefined,
      currentSourceKey: undefined
    });
  });

  it('counts a video with no selectable quality as failed and advances the queue', () => {
    const one = video('one');
    const two = video('two');
    const run = new BatchRun([one, two], 'Flux_123');

    run.skip(one);
    expect(run.snapshot()).toMatchObject({
      completed: 0,
      failed: 1,
      remainingKeys: [videoKey(two.url)]
    });
  });

  it('returns every known active ID on cancellation without counting failures', () => {
    const one = video('one');
    const two = video('two');
    const three = video('three');
    const run = new BatchRun([one, two, three], 'Flux_123', 4);
    run.begin(one);
    run.begin(two);
    run.attachDownload(one, 'direct_9');
    run.attachDownload(two, 'convert_4');

    expect(run.cancel()).toEqual(['direct_9', 'convert_4']);
    expect(run.snapshot().remainingKeys).toEqual([videoKey(one.url), videoKey(two.url)]);
    expect(run.complete(one, false)).toEqual({ markFailed: false });
    expect(run.complete(two, false)).toEqual({ markFailed: false });
    expect(run.snapshot()).toMatchObject({
      completed: 0,
      failed: 0,
      cancelled: true,
      remainingKeys: [],
      activeSourceKeys: []
    });
  });

  it('detects cancellation separately for every ID that arrives late', () => {
    const one = video('one');
    const two = video('two');
    const run = new BatchRun([one, two], 'Flux_123');
    run.begin(one);
    run.begin(two);

    expect(run.cancel()).toEqual([]);
    expect(run.attachDownload(one, 'convert_late')).toBe(true);
    expect(run.attachDownload(two, 'direct_late')).toBe(true);
  });

  it('returns snapshots that cannot mutate the live queues', () => {
    const one = video('one');
    const run = new BatchRun([one], 'Flux_123');
    run.begin(one);
    const snapshot = run.snapshot();

    snapshot.remainingKeys!.length = 0;
    snapshot.activeSourceKeys!.length = 0;
    snapshot.completed = 99;

    expect(run.snapshot()).toMatchObject({
      completed: 0,
      remainingKeys: [videoKey(one.url)],
      activeSourceKeys: [videoKey(one.url)]
    });
  });
});
