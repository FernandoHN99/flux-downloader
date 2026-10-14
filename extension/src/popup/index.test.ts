import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incoming } from './messages';
import { App } from './index';

let receive: (message: Incoming) => void;
let postMessage: ReturnType<typeof vi.fn>;

function shell() {
  document.body.innerHTML = `
    <button id="settings-btn"></button>
    <span id="refresh-tabs"></span>
    <div id="status-bar"></div>
    <div id="empty-state"></div>
    <div id="download-progress"></div>
    <div id="history-section"></div>
    <div id="error"><span id="error-message"></span><button id="error-dismiss"></button></div>
  `;
  return {
    section: document.getElementById('history-section')!,
    progress: document.getElementById('download-progress')!,
    refresh: document.getElementById('refresh-tabs')!,
    empty: document.getElementById('empty-state')!,
    status: document.getElementById('status-bar')!,
    error: document.getElementById('error')!
  };
}

describe('App refresh', () => {
  beforeEach(() => {
    postMessage = vi.fn();
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: Incoming) => void) => { receive = listener; }) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    vi.mocked(chrome.runtime.connect).mockReturnValue(port);
  });

  it('uses one request to refresh every tab and waits for its result', async () => {
    const app = new App(shell());
    await app.start();
    postMessage.mockClear();

    const button = document.getElementById('refresh-tabs-btn') as HTMLButtonElement;
    button.click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'REFRESH_TABS' });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Refreshing…');

    receive({ type: 'MEDIA_LIST', videos: [], currentKeys: [] });

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Refresh tabs');
  });
});

describe('App folders', () => {
  const lesson = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `v${n}`, title: `Aula ${n}`, url: `https://cdn.example/l${n}/playlist.m3u8`,
    type: 'hls', qualities: [], detectedAt: 0, ...extra
  });

  beforeEach(() => {
    postMessage = vi.fn();
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: Incoming) => void) => { receive = listener; }) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    vi.mocked(chrome.runtime.connect).mockReturnValue(port);
  });

  it('creates the folder with every video that is in no folder, the playing one too', async () => {
    const app = new App(shell());
    await app.start();
    receive({
      type: 'HISTORY_LIST',
      folders: [{ id: 'f1', name: 'Antigas' }],
      entries: [
        lesson(1), lesson(2), lesson(3, { folderId: 'f1' }), lesson(4)
      ] as any
    });
    receive({ type: 'MEDIA_LIST', videos: [], currentKeys: ['https://cdn.example/l4/playlist.m3u8'] });
    postMessage.mockClear();

    (document.getElementById('new-folder-btn') as HTMLButtonElement).click();
    const input = document.querySelector<HTMLInputElement>('.folder-composer input')!;
    input.value = '  Novas  ';
    (document.querySelector('.folder-add-all') as HTMLButtonElement).click();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'CREATE_FOLDER',
      name: 'Novas',
      keys: [
        'https://cdn.example/l4/playlist.m3u8',
        'https://cdn.example/l1/playlist.m3u8',
        'https://cdn.example/l2/playlist.m3u8'
      ]
    });
  });

  it('counts only the videos that are loose, on the button', async () => {
    const app = new App(shell());
    await app.start();
    receive({
      type: 'HISTORY_LIST',
      folders: [{ id: 'f1', name: 'Antigas' }],
      entries: [lesson(1), lesson(2, { folderId: 'f1' })] as any
    });

    (document.getElementById('new-folder-btn') as HTMLButtonElement).click();

    expect(document.querySelector('.folder-add-all')!.textContent)
      .toBe('Create with all 1 video not in a folder');
  });

  it('files only the video it was opened for when the plain confirm is used', async () => {
    const app = new App(shell());
    await app.start();
    receive({ type: 'HISTORY_LIST', folders: [], entries: [lesson(1), lesson(2)] as any });
    postMessage.mockClear();

    (document.querySelectorAll('.move-btn')[0] as HTMLButtonElement).click();
    (document.querySelector('.move-new') as HTMLButtonElement).click();
    const input = document.querySelector<HTMLInputElement>('.folder-composer input')!;
    input.value = 'So uma';
    (document.querySelector('.icon-btn-confirm') as HTMLButtonElement).click();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'CREATE_FOLDER', name: 'So uma', keys: ['https://cdn.example/l1/playlist.m3u8']
    });
  });
});

describe('App folder collapse memory', () => {
  const entries = [{
    id: 'v1', title: 'Aula 1', url: 'https://cdn.example/l1/playlist.m3u8',
    type: 'hls', qualities: [], detectedAt: 0, folderId: 'f1'
  }] as any;
  const folders = [{ id: 'f1', name: 'Curso' }, { id: 'f2', name: 'Outro' }];

  function connect() {
    postMessage = vi.fn();
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: Incoming) => void) => { receive = listener; }) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    vi.mocked(chrome.runtime.connect).mockReturnValue(port);
  }

  function storage(initial: Record<string, unknown> = {}) {
    const data: Record<string, unknown> = { ...initial };
    const local = {
      get: vi.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
      }),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(data, patch); })
    };
    (globalThis as any).chrome = { ...(globalThis as any).chrome, storage: { local } };
    return data;
  }

  beforeEach(connect);

  it('saves a folder as collapsed when it is closed, and as open again when reopened', async () => {
    const data = storage();
    const app = new App(shell());
    await app.start();
    receive({ type: 'HISTORY_LIST', folders, entries });

    (document.querySelector('.user-folder[data-folder-id="f1"] .group-head') as HTMLElement).click();
    expect(data.collapsedFolders).toEqual(['f1']);

    (document.querySelector('.user-folder[data-folder-id="f1"] .group-head') as HTMLElement).click();
    expect(data.collapsedFolders).toEqual([]);
  });

  it('brings a collapsed folder back closed the next time the popup opens', async () => {
    storage({ collapsedFolders: ['f1'] });
    const app = new App(shell());
    await app.start();
    receive({ type: 'HISTORY_LIST', folders, entries });

    const body = document.querySelector('.user-folder[data-folder-id="f1"] .group-body') as HTMLElement;
    expect(body.hidden).toBe(true);
    const other = document.querySelector('.user-folder[data-folder-id="f2"] .group-body') as HTMLElement;
    expect(other.hidden).toBe(false);
  });

  it('forgets a deleted folder instead of keeping its id forever', async () => {
    const data = storage({ collapsedFolders: ['f1', 'gone'] });
    const app = new App(shell());
    await app.start();
    receive({ type: 'HISTORY_LIST', folders, entries });

    (document.querySelector('.user-folder[data-folder-id="f2"] .group-head') as HTMLElement).click();

    expect(data.collapsedFolders).toEqual(['f1', 'f2']);
  });
});

