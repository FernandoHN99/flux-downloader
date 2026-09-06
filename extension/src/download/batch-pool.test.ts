import { describe, expect, it } from 'vitest';
import { DEFAULT_BATCH_CONCURRENCY, runBatchPool } from './batch-pool';

describe('runBatchPool', () => {
  it('keeps the configured number of jobs in flight', async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const firstWave = new Promise<void>((resolve) => { release = resolve; });
    const started: number[] = [];

    const run = runBatchPool([0, 1, 2, 3, 4, 5], async (item) => {
      started.push(item);
      active += 1;
      maximum = Math.max(maximum, active);
      await firstWave;
      active -= 1;
    }, () => false, 3);

    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    release();
    await run;

    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maximum).toBe(3);
    expect(DEFAULT_BATCH_CONCURRENCY).toBe(4);
  });

  it('does not dispatch another item after cancellation', async () => {
    let cancelled = false;
    const started: number[] = [];
    await runBatchPool([0, 1, 2], async (item) => {
      started.push(item);
      cancelled = true;
    }, () => cancelled, 1);

    expect(started).toEqual([0]);
  });
});
