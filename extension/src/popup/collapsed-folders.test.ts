import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCollapsedFolders, saveCollapsedFolders } from './collapsed-folders';

function storage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const local = {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, patch); })
  };
  (globalThis as any).chrome = { ...(globalThis as any).chrome, storage: { local } };
  return { data, local };
}

describe('collapsed folders', () => {
  beforeEach(() => { storage(); });

  it('starts with every folder open', async () => {
    await expect(loadCollapsedFolders()).resolves.toEqual(new Set());
  });

  it('remembers which folders were collapsed', async () => {
    const { data } = storage();

    await saveCollapsedFolders(new Set(['f1', 'f3']));

    expect(data.collapsedFolders).toEqual(['f1', 'f3']);
    await expect(loadCollapsedFolders()).resolves.toEqual(new Set(['f1', 'f3']));
  });

  it('drops ids of folders that no longer exist when told which do', async () => {
    const { data } = storage();

    await saveCollapsedFolders(new Set(['f1', 'gone']), ['f1', 'f2']);

    expect(data.collapsedFolders).toEqual(['f1']);
  });

  it('ignores a damaged stored value', async () => {
    storage({ collapsedFolders: { not: 'a list' } });
    await expect(loadCollapsedFolders()).resolves.toEqual(new Set());

    storage({ collapsedFolders: ['f1', 7, null, 'f2'] });
    await expect(loadCollapsedFolders()).resolves.toEqual(new Set(['f1', 'f2']));
  });

  it('survives storage being unavailable', async () => {
    (globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      storage: { local: {
        get: vi.fn(async () => { throw new Error('blocked'); }),
        set: vi.fn(async () => { throw new Error('blocked'); })
      } }
    };

    await expect(loadCollapsedFolders()).resolves.toEqual(new Set());
    await expect(saveCollapsedFolders(new Set(['f1']))).resolves.toBeUndefined();
  });
});
