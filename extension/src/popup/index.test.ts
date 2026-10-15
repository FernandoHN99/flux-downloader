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

describe('App picking rows', () => {
  const key = (n: number) => `https://cdn.example/l${n}/playlist.m3u8`;
  const lesson = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `v${n}`, title: `Aula ${n}`, url: key(n), type: 'hls', qualities: [], detectedAt: 0, ...extra
  });

  const rows = () => [...document.querySelectorAll<HTMLElement>('.media-item')];
  const click = (index: number, modifiers: MouseEventInit = {}) =>
    rows()[index].dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
  const picked = () => rows().filter((row) => row.classList.contains('picked')).map((row) => row.dataset.key);
  const count = () => document.querySelector('.selection-count')?.textContent;
  const press = (selector: string) => (document.querySelector(selector) as HTMLButtonElement).click();

  async function open(extra: { folders?: any[]; entries?: any[] } = {}) {
    postMessage = vi.fn();
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: Incoming) => void) => { receive = listener; }) },
      onDisconnect: { addListener: vi.fn() }
    } as unknown as chrome.runtime.Port;
    vi.mocked(chrome.runtime.connect).mockReturnValue(port);
    const app = new App(shell());
    await app.start();
    receive({
      type: 'HISTORY_LIST',
      folders: extra.folders ?? [],
      entries: (extra.entries ?? [1, 2, 3, 4, 5, 6].map((n) => lesson(n))) as any
    });
    postMessage.mockClear();
    return app;
  }

  it('picks everything from the row that was opened to the one Shift-clicked', async () => {
    await open();
    click(1);
    click(4, { shiftKey: true });

    expect(count()).toBe('4 selected');
    expect(picked()).toEqual([key(2), key(3), key(4), key(5)]);
  });

  it('picks just the one row when Shift is the first thing pressed', async () => {
    await open();
    click(2, { shiftKey: true });

    expect(count()).toBe('1 selected');
    expect(picked()).toEqual([key(3)]);
  });

  it('extends from the last row picked, so Shift-clicks chain', async () => {
    await open();
    click(0, { shiftKey: true });
    click(2, { shiftKey: true });
    click(5, { shiftKey: true });

    expect(count()).toBe('6 selected');
  });

  it('spans upward as well', async () => {
    await open();
    click(4, { shiftKey: true });
    click(2, { shiftKey: true });

    expect(picked()).toEqual([key(3), key(4), key(5)]);
  });

  it('flips one row with Ctrl or Cmd, without opening it', async () => {
    await open();
    click(1, { ctrlKey: true });
    click(3, { metaKey: true });
    expect(picked()).toEqual([key(2), key(4)]);
    expect(document.querySelector('.media-expand')).toBeNull();

    click(1);
    expect(picked()).toEqual([key(4)]);
  });

  it('leaves picking when the last row is dropped', async () => {
    await open();
    click(1, { ctrlKey: true });
    click(1);

    expect(document.querySelector('.selection-bar')).toBeNull();
    expect(picked()).toEqual([]);
  });

  it('does not run a range across a folder that is collapsed', async () => {
    await open({
      folders: [{ id: 'f1', name: 'Curso' }],
      entries: [lesson(1, { folderId: 'f1' }), lesson(2, { folderId: 'f1' }), lesson(3), lesson(4)]
    });
    (document.querySelector('.user-folder .group-head') as HTMLElement).click();
    click(0, { shiftKey: true });
    click(1, { shiftKey: true });

    expect(count()).toBe('2 selected');
  });

  it('selects every row on screen from the bar, and leaves the button out afterwards', async () => {
    await open();
    click(0, { shiftKey: true });
    press('#select-all-btn');

    expect(count()).toBe('6 selected');
    expect(document.querySelector('#select-all-btn')).toBeNull();
  });

  describe('then New folder', () => {
    it('names a folder for the picked videos and files them, then stops picking', async () => {
      await open();
      click(1);
      click(3, { shiftKey: true });
      press('#new-folder-btn');

      const input = document.querySelector<HTMLInputElement>('.folder-composer input')!;
      expect(input.placeholder).toContain('3 videos');
      expect(document.querySelector('.folder-add-all')).toBeNull();
      input.value = 'Módulo 1';
      press('.folder-composer .icon-btn-confirm');

      expect(postMessage).toHaveBeenCalledWith({
        type: 'CREATE_FOLDER', name: 'Módulo 1', keys: [key(2), key(3), key(4)]
      });
      expect(document.querySelector('.selection-bar')).toBeNull();
    });

    it('keeps the picks if the form is cancelled, so the user can go back', async () => {
      await open();
      click(0, { shiftKey: true });
      click(2, { shiftKey: true });
      press('#new-folder-btn');
      press('.folder-composer .icon-btn-cancel');

      expect(count()).toBe('3 selected');
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('keeps the picks when the name was left empty', async () => {
      await open();
      click(0, { shiftKey: true });
      press('#new-folder-btn');
      press('.folder-composer .icon-btn-confirm');

      expect(count()).toBe('1 selected');
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('then Move to', () => {
    const folders = [{ id: 'f1', name: 'Curso' }, { id: 'f2', name: 'Extras' }];

    it('files the picked videos into the chosen folder and stops picking', async () => {
      await open({ folders });
      click(0, { shiftKey: true });
      click(2, { shiftKey: true });
      press('#move-selected-btn');
      (document.querySelectorAll('.selection-move .move-choice')[1] as HTMLButtonElement).click();

      expect(postMessage).toHaveBeenCalledWith({
        type: 'MOVE_TO_FOLDER', keys: [key(1), key(2), key(3)], folderId: 'f2'
      });
      expect(document.querySelector('.selection-bar')).toBeNull();
    });

    it('takes picked videos out of their folders', async () => {
      await open({
        folders,
        entries: [lesson(1, { folderId: 'f1' }), lesson(2, { folderId: 'f1' }), lesson(3)]
      });
      click(0, { shiftKey: true });
      press('#move-selected-btn');
      const choices = [...document.querySelectorAll<HTMLButtonElement>('.selection-move .move-choice')];
      choices.find((choice) => choice.textContent === 'Remove from folder')!.click();

      expect(postMessage).toHaveBeenCalledWith({
        type: 'MOVE_TO_FOLDER', keys: [key(1)], folderId: null
      });
    });
  });

  describe('then Delete', () => {
    it('removes just the picked videos', async () => {
      await open();
      click(1, { shiftKey: true });
      click(2, { shiftKey: true });
      press('#delete-selected-btn');

      expect(postMessage).toHaveBeenCalledWith({
        type: 'DELETE_HISTORY_ITEMS', keys: [key(2), key(3)]
      });
    });

    it('clears the whole history when everything is picked', async () => {
      await open();
      click(0, { shiftKey: true });
      press('#select-all-btn');
      press('#delete-selected-btn');

      expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_HISTORY' });
    });
  });

  it('leaves picking on Escape, and closes the name form first', async () => {
    await open();
    click(0, { shiftKey: true });
    press('#new-folder-btn');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.folder-composer')).toBeNull();
    expect(count()).toBe('1 selected');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.selection-bar')).toBeNull();
  });

  it('leaves picking from the bar', async () => {
    await open();
    click(0, { shiftKey: true });
    press('#exit-selection-btn');

    expect(document.querySelector('.selection-bar')).toBeNull();
  });

  it('starts picking from a row\'s own select button', async () => {
    await open();
    (rows()[2].querySelector('.select-btn') as HTMLButtonElement).click();

    expect(picked()).toEqual([key(3)]);
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

