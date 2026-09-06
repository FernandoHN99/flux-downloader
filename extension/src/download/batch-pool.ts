export const DEFAULT_BATCH_CONCURRENCY = 4;

/** Run a bounded worker pool while letting cancellation stop new dispatches. */
export async function runBatchPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean,
  concurrency = DEFAULT_BATCH_CONCURRENCY
): Promise<void> {
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency) || DEFAULT_BATCH_CONCURRENCY)
  );
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (!shouldStop()) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
