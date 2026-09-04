import { describe, expect, it } from 'vitest';
import { BatchRun } from './batch-run';
import type { VideoInfo } from './types';
import { videoKey } from './video-key';

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
    const run = new BatchRun([one, two], 'Flux_123');

    expect(run.snapshot()).toEqual({
      total: 2,
      completed: 0,
      failed: 0,
      folder: 'Flux_123',
      cancelled: false,
      remainingKeys: [videoKey(one.url), videoKey(two.url)]
    });
  });

  it('announces the active source and counts successful and failed items', () => {
    const one = video('one');
    const two = video('two');
    const run = new BatchRun([one, two], 'Flux_123');

    run.begin(one);
    expect(run.snapshot()).toMatchObject({
      currentTitle: 'Lesson one',
      currentSourceKey: videoKey(one.url)
    });
    expect(run.attachDownload('convert_1')).toBe(false);
    expect(run.complete(one, true)).toEqual({ markFailed: false });

    run.begin(two);
    run.attachDownload('convert_2');
    expect(run.complete(two, false)).toEqual({ markFailed: true });
    expect(run.snapshot()).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      folder: 'Flux_123',
      cancelled: false,
      remainingKeys: [],
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

  it('returns the active download on cancellation without counting it as failed', () => {
    const one = video('one');
    const run = new BatchRun([one], 'Flux_123');
    run.begin(one);
    run.attachDownload('direct_9');

    expect(run.cancel()).toBe('direct_9');
    expect(run.complete(one, false)).toEqual({ markFailed: false });
    expect(run.snapshot()).toMatchObject({
      completed: 0,
      failed: 0,
      cancelled: true,
      remainingKeys: []
    });
  });

  it('detects cancellation that happened before the native ID arrived', () => {
    const one = video('one');
    const run = new BatchRun([one], 'Flux_123');
    run.begin(one);

    expect(run.cancel()).toBeUndefined();
    expect(run.attachDownload('convert_late')).toBe(true);
  });

  it('returns snapshots that cannot mutate the live queue', () => {
    const one = video('one');
    const run = new BatchRun([one], 'Flux_123');
    const snapshot = run.snapshot();

    snapshot.remainingKeys!.length = 0;
    snapshot.completed = 99;

    expect(run.snapshot()).toMatchObject({
      completed: 0,
      remainingKeys: [videoKey(one.url)]
    });
  });
});
