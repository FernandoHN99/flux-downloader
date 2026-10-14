import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../shared/types';
import { FolderStore } from './folder-store';

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const local = {
    get: vi.fn(async (keys: string | string[]) => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, patch); })
  };
  (globalThis as any).chrome = { ...(globalThis as any).chrome, storage: { local } };
  return { data, local };
}

function makeStore() {
  let n = 0;
  const changed = vi.fn();
  const store = new FolderStore({
    changed,
    newId: () => `f${++n}`
  });
  return { store, changed };
}

const A = 'https://cdn.test/a.m3u8';
const B = 'https://cdn.test/b.m3u8';
const entry = (url: string): HistoryEntry => ({
  id: url, url: `${url}?token=1`, title: url, type: 'hls', qualities: [], detectedAt: 1
});

describe('FolderStore', () => {
  beforeEach(() => { fakeStorage(); });

  it('reads nothing from an empty or damaged store', async () => {
    fakeStorage({ videoFolders: 'broken', folderAssignments: [1, 2] });
    const { store } = makeStore();

    await expect(store.read()).resolves.toEqual({ folders: [], assignments: {} });
  });

  it('creates a folder, files videos into it and announces the change', async () => {
    const { data } = fakeStorage();
    const { store, changed } = makeStore();

    const id = await store.create('Aulas', [A]);

    expect(id).toBe('f1');
    expect(data.videoFolders).toEqual([{ id: 'f1', name: 'Aulas' }]);
    expect(data.folderAssignments).toEqual({ [A]: 'f1' });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('files the video that is playing now like any other', async () => {
    const { data } = fakeStorage();
    const { store } = makeStore();

    await store.create('Aulas', [A, B]);

    expect(data.folderAssignments).toEqual({ [A]: 'f1', [B]: 'f1' });
  });

  it('moves between folders and back out', async () => {
    const { data } = fakeStorage({
      videoFolders: [{ id: 'f1', name: 'A' }, { id: 'f2', name: 'B' }],
      folderAssignments: { [A]: 'f1' }
    });
    const { store } = makeStore();

    await store.move([A], 'f2');
    expect(data.folderAssignments).toEqual({ [A]: 'f2' });

    await store.move([A], null);
    expect(data.folderAssignments).toEqual({});
  });

  it('deleting a folder frees its videos', async () => {
    const { data } = fakeStorage({
      videoFolders: [{ id: 'f1', name: 'A' }],
      folderAssignments: { [A]: 'f1' }
    });
    const { store } = makeStore();

    await store.remove('f1');

    expect(data.videoFolders).toEqual([]);
    expect(data.folderAssignments).toEqual({});
  });

  it('drops assignments that point at a vanished folder when reading', async () => {
    fakeStorage({
      videoFolders: [{ id: 'f1', name: 'A' }],
      folderAssignments: { [A]: 'f1', [B]: 'gone' }
    });
    const { store } = makeStore();

    expect((await store.read()).assignments).toEqual({ [A]: 'f1' });
  });

  it('forgets videos removed from history, one or all', async () => {
    const { data } = fakeStorage({
      videoFolders: [{ id: 'f1', name: 'A' }],
      folderAssignments: { [A]: 'f1', [B]: 'f1' }
    });
    const { store } = makeStore();

    await store.forget([A]);
    expect(data.folderAssignments).toEqual({ [B]: 'f1' });

    await store.forgetAll();
    expect(data.folderAssignments).toEqual({});
  });

  it('decorates entries by identity, so a re-signed link keeps its folder', async () => {
    fakeStorage({
      videoFolders: [{ id: 'f1', name: 'A' }],
      folderAssignments: { [A]: 'f1' }
    });
    const { store } = makeStore();

    const [filed, loose] = await store.decorate([entry(A), entry(B)]);

    expect(filed.folderId).toBe('f1');
    expect(loose.folderId).toBeUndefined();
  });

  it('names the download directory for a filed video, safely', async () => {
    fakeStorage({
      videoFolders: [{ id: 'f1', name: '../Cursos: React' }],
      folderAssignments: { [A]: 'f1' }
    });
    const { store } = makeStore();

    await expect(store.directoryNameFor(`${A}?token=zzz`)).resolves.toBe('_Cursos_ React');
    const directory = await store.directoryNameFor(A);
    expect(directory).not.toMatch(/[\\/]/);
    expect(directory?.startsWith('.')).toBe(false);
    await expect(store.directoryNameFor(B)).resolves.toBeUndefined();
  });

  it('keeps writes in order when several arrive at once', async () => {
    const { data } = fakeStorage();
    const { store } = makeStore();

    await Promise.all([store.create('One'), store.create('Two'), store.create('Three')]);

    expect((data.videoFolders as { name: string }[]).map((f) => f.name)).toEqual(['One', 'Two', 'Three']);
  });
});
