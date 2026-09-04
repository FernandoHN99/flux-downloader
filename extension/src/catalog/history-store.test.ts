import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryStore } from './history-store';
import type { HistoryEntry, VideoInfo } from '../shared/types';

/** In-memory chrome.storage.local, so writes are observable across calls. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const local = {
    get: vi.fn(async (keys: string | string[]) => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, patch); }),
    remove: vi.fn(async (key: string) => { delete data[key]; })
  };
  (globalThis as any).chrome = { ...(globalThis as any).chrome, storage: { local } };
  return { data, local };
}

function video(url: string, title = 'Clip'): VideoInfo {
  return { url, title, type: 'mp4' } as VideoInfo;
}

function makeStore(overrides: Partial<Parameters<typeof HistoryStore.prototype.constructor>[0]> = {}) {
  const broadcast = vi.fn();
  const store = new HistoryStore({
    currentKeys: () => [],
    keepHistory: async () => true,
    broadcast,
    ...(overrides as object)
  } as any);
  return { store, broadcast };
}

describe('HistoryStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fakeStorage();
  });

  it('reads an empty list when nothing has been stored', async () => {
    const { store } = makeStore();
    await expect(store.read()).resolves.toEqual([]);
  });

  it('reads an empty list when the stored value is not an array', async () => {
    fakeStorage({ mediaHistory: { broken: true } });
    const { store } = makeStore();
    await expect(store.read()).resolves.toEqual([]);
  });

  it('records detected videos and broadcasts the merged list', async () => {
    const { data } = fakeStorage();
    const { store, broadcast } = makeStore();

    await store.record([video('https://cdn.test/a.mp4')], {
      pageUrl: 'https://site.test/watch',
      pageTitle: 'Watch'
    });

    expect((data.mediaHistory as HistoryEntry[]).length).toBe(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('skips the write entirely when there are no videos', async () => {
    const { local } = fakeStorage();
    const { store, broadcast } = makeStore();

    await store.record([], { pageUrl: 'https://site.test' });

    expect(local.set).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('serializes concurrent writes so neither merge is lost', async () => {
    const { data } = fakeStorage();
    const { store } = makeStore();

    await Promise.all([
      store.record([video('https://cdn.test/a.mp4')], {}),
      store.record([video('https://cdn.test/b.mp4')], {}),
      store.record([video('https://cdn.test/c.mp4')], {})
    ]);

    // Interleaved read-modify-write would drop entries; the queue keeps all three.
    expect((data.mediaHistory as HistoryEntry[]).length).toBe(3);
  });

  it('keeps the queue alive after a write fails', async () => {
    const { data, local } = fakeStorage();
    const { store } = makeStore();
    local.set.mockRejectedValueOnce(new Error('quota'));

    await expect(store.record([video('https://cdn.test/a.mp4')], {})).rejects.toThrow('quota');
    await store.record([video('https://cdn.test/b.mp4')], {});

    expect((data.mediaHistory as HistoryEntry[]).length).toBe(1);
  });

  it('settles only once queued writes have run', async () => {
    const { data } = fakeStorage();
    const { store } = makeStore();

    void store.record([video('https://cdn.test/a.mp4')], {});
    expect(data.mediaHistory).toBeUndefined();

    await store.settled();
    expect((data.mediaHistory as HistoryEntry[]).length).toBe(1);
  });

  it('clears the stored list and broadcasts the empty result', async () => {
    const { data } = fakeStorage({ mediaHistory: [{ key: 'k', url: 'u' }] });
    const { store, broadcast } = makeStore();

    await store.clear();

    expect(data.mediaHistory).toBeUndefined();
    expect(broadcast).toHaveBeenCalledWith([]);
  });

  it('does not write or broadcast when a transform changes nothing', async () => {
    const { local } = fakeStorage({ mediaHistory: [] });
    const { store, broadcast } = makeStore();

    await store.remove(['missing-key']);

    expect(local.set).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('drops entries that are no longer playing when history is off', async () => {
    const { data } = fakeStorage({
      mediaHistory: [
        { key: 'https://cdn.test/live.mp4', url: 'https://cdn.test/live.mp4' },
        { key: 'https://cdn.test/gone.mp4', url: 'https://cdn.test/gone.mp4' }
      ]
    });
    const { store } = makeStore({
      keepHistory: async () => false,
      currentKeys: () => ['https://cdn.test/live.mp4']
    });

    await store.schedulePruneIfOff();

    expect((data.mediaHistory as HistoryEntry[]).map((e) => e.key)).toEqual([
      'https://cdn.test/live.mp4'
    ]);
  });

  it('leaves the stored list alone while history is on', async () => {
    const { local } = fakeStorage({
      mediaHistory: [{ key: 'https://cdn.test/gone.mp4', url: 'https://cdn.test/gone.mp4' }]
    });
    const { store } = makeStore({ keepHistory: async () => true, currentKeys: () => [] });

    await store.schedulePruneIfOff();

    expect(local.set).not.toHaveBeenCalled();
  });

  it('marks a url downloaded and republishes the decorated list', async () => {
    const { data } = fakeStorage({
      mediaHistory: [{ key: 'https://cdn.test/a.mp4', url: 'https://cdn.test/a.mp4' }]
    });
    const { store, broadcast } = makeStore();

    await store.markDownloaded('https://cdn.test/a.mp4?token=xyz');

    expect(data.downloadedVideos).toContain('https://cdn.test/a.mp4');
    expect(broadcast.mock.lastCall?.[0][0].downloaded).toBe(true);
  });

  it('marks a url failed without touching the downloaded list', async () => {
    const { data } = fakeStorage({ mediaHistory: [] });
    const { store } = makeStore();

    await store.markFailed('https://cdn.test/a.mp4');

    expect(data.failedVideos).toContain('https://cdn.test/a.mp4');
    expect(data.downloadedVideos).toBeUndefined();
  });

  it('decorates entries with both markers', async () => {
    fakeStorage({
      downloadedVideos: ['https://cdn.test/a.mp4'],
      failedVideos: ['https://cdn.test/b.mp4']
    });
    const { store } = makeStore();

    const decorated = await store.decorate([
      { key: 'https://cdn.test/a.mp4', url: 'https://cdn.test/a.mp4' } as HistoryEntry,
      { key: 'https://cdn.test/b.mp4', url: 'https://cdn.test/b.mp4' } as HistoryEntry
    ]);

    expect(decorated[0].downloaded).toBe(true);
    expect(decorated[1].failed).toBe(true);
  });
});
