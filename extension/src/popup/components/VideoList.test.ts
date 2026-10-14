import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HistoryEntry } from '../../shared/types';
import { VideoList, entriesForDomain, type VideoListState } from './VideoList';
import type { VideoRowState } from './VideoRow';

const RS = 'https://app.rocketseat.com.br/aula-';
const entry = (title: string, url: string, pageUrl: string): HistoryEntry =>
  ({ id: title, title, url, pageUrl, type: 'hls', duration: 100,
     qualities: [{ height: 720, url: 'q' }], detectedAt: 0 }) as HistoryEntry;

const ENTRIES = [
  entry('ep12', 'https://cdn.rs.com/l9/ep12.m3u8', `${RS}9`),
  entry('deep house', 'https://youtube.com/watch', 'https://www.youtube.com/watch?v=1'),
  entry('aula08', 'https://cdn.rs.com/l8/aula08.m3u8', `${RS}8`),
  entry('aula07', 'https://cdn.rs.com/l7/aula07.m3u8', `${RS}7`),
  entry('design', 'https://cdn.udemy.com/d.mp4', 'https://www.udemy.com/c')
];

const CURRENT = new Set(['https://cdn.rs.com/l9/ep12.m3u8', 'https://youtube.com/watch']);

function mount(overrides: Partial<VideoListState> = {}) {
  const handlers = {
    onActivate: vi.fn(), onStartRename: vi.fn(), onCommitRename: vi.fn(), onCancelRename: vi.fn(),
    onTrash: vi.fn(), onSelectQuality: vi.fn(), onDownload: vi.fn(),
    onReorder: vi.fn(), onToggleGroup: vi.fn(), onDownloadGroup: vi.fn(),
    onToggleMove: vi.fn(), onMoveToFolder: vi.fn(), onNewFolderFor: vi.fn(),
    onToggleFolder: vi.fn(), onDownloadFolder: vi.fn(), onStartRenameFolder: vi.fn(),
    onCommitRenameFolder: vi.fn(), onCancelRenameFolder: vi.fn(), onDeleteFolder: vi.fn(),
    onCommitNewFolder: vi.fn(), onCommitNewFolderWithUnfiled: vi.fn(), onCancelNewFolder: vi.fn(), onDropToFolder: vi.fn()
  };
  const rowState = (e: HistoryEntry): Omit<VideoRowState, 'entry'> => ({
    isCurrent: CURRENT.has(e.url), isBusy: false, busyLabel: '', selectionMode: false,
    isPicked: false, isExpanded: false, isRenaming: false, downloadDisabled: false,
    selectedQualityIndex: 0, canMove: true, isMoving: false, folders: []
  });
  const list = new VideoList(
    { entries: ENTRIES, folders: [], searching: false, collapsedFolders: new Set(),
      renamingFolderId: null, creatingFolder: null, unfiledCount: 0, grouped: false, collapsedGroups: new Set(),
      downloadDisabled: false, rowState, ...overrides },
    handlers
  );
  document.body.appendChild(list.el);
  list.update();
  return { list, handlers };
}

const titles = (root: ParentNode) =>
  [...root.querySelectorAll('.media-item .media-title-text')].map((n) => n.textContent);

/**
 * happy-dom has no DragEvent — constructing one yields a plain Event that
 * drops both clientY and dataTransfer, which silently turns every drag test
 * into a no-op. A MouseEvent carries the coordinate, and the listeners only
 * ever ask dataTransfer for setData/effectAllowed/dropEffect.
 */
const dt = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' }) as unknown as DataTransfer;

function fire(el: Element, type: string, clientY = 0, transfer = dt()): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: transfer, configurable: true });
  el.dispatchEvent(event);
}

describe('VideoList (flat)', () => {
  beforeEach(() => document.body.replaceChildren());

  it('keeps pinned rows outside the reorder zone', () => {
    const { list } = mount();
    const loose = [...list.el.children].filter((c) => c.classList.contains('media-item'));
    expect(loose.map((r) => r.querySelector('.media-title-text')!.textContent))
      .toEqual(['ep12', 'deep house']);
    expect(titles(list.el.querySelector('.reorder-zone')!)).toEqual(['aula08', 'aula07', 'design']);
  });

  it('gives every row that can be dragged a grip, the pinned ones included', () => {
    const { list } = mount();
    expect(list.el.querySelectorAll('.drag-handle')).toHaveLength(5);
    expect(list.el.querySelectorAll('.media-item')).toHaveLength(5);
  });

  it('has no zone at all when nothing can be reordered', () => {
    const { list } = mount({ entries: ENTRIES.slice(0, 2) });
    expect(list.el.querySelector('.reorder-zone')).toBeNull();
  });

  // The rule: a dragged row can never end up above a current video.
  it('clamps a drag aimed above everything to the top of its zone', () => {
    const { list } = mount();
    const zone = list.el.querySelector<HTMLElement>('.reorder-zone')!;
    const dragged = [...zone.querySelectorAll('.media-item')].at(-1)!;
    const transfer = dt();

    fire(dragged, 'dragstart', 0, transfer);
    fire(zone, 'dragover', list.el.getBoundingClientRect().top - 500, transfer);

    expect(titles(zone)[0]).toBe('design');
    expect(titles(list.el)[0]).toBe('ep12');
  });

  it('outlines only the zone, never the whole list', () => {
    const { list } = mount();
    const zone = list.el.querySelector<HTMLElement>('.reorder-zone')!;
    const dragged = zone.querySelector('.media-item')!;
    const transfer = dt();

    fire(dragged, 'dragstart', 0, transfer);
    fire(zone, 'dragover', 0, transfer);

    expect(zone.classList.contains('drop-target')).toBe(true);
    expect(list.el.classList.contains('drop-target')).toBe(false);
  });

  it('reports the whole flat order on drop, pinned rows included', () => {
    const { list, handlers } = mount();
    const zone = list.el.querySelector<HTMLElement>('.reorder-zone')!;
    const dragged = zone.querySelector('.media-item')!;   // aula08, first movable
    const transfer = dt();

    fire(dragged, 'dragstart', 0, transfer);
    fire(zone, 'dragover', 0, transfer);                  // past every midpoint: to the end
    expect(titles(zone)).toEqual(['aula07', 'design', 'aula08']);

    fire(zone, 'drop', 0, transfer);

    // The stored order is one flat list, so the pinned rows have to be in it.
    expect(handlers.onReorder).toHaveBeenCalledWith([
      'https://cdn.rs.com/l9/ep12.m3u8',
      'https://youtube.com/watch',
      'https://cdn.rs.com/l7/aula07.m3u8',
      'https://cdn.udemy.com/d.mp4',
      'https://cdn.rs.com/l8/aula08.m3u8'
    ]);
  });

  it('clears the outline when the drag ends', () => {
    const { list } = mount();
    const zone = list.el.querySelector<HTMLElement>('.reorder-zone')!;
    const dragged = zone.querySelector('.media-item')!;
    const transfer = dt();
    fire(dragged, 'dragstart', 0, transfer);
    fire(zone, 'dragover', 0, transfer);
    fire(dragged, 'dragend', 0, transfer);
    expect(zone.classList.contains('drop-target')).toBe(false);
  });
});

describe('VideoList (grouped)', () => {
  beforeEach(() => document.body.replaceChildren());

  it('makes one folder per site, in the order they appear', () => {
    const { list } = mount({ grouped: true });
    expect([...list.el.querySelectorAll('.group-name')].map((n) => n.textContent))
      .toEqual(['app.rocketseat.com.br', 'youtube.com', 'udemy.com']);
  });

  it('counts what each folder holds', () => {
    const { list } = mount({ grouped: true });
    expect([...list.el.querySelectorAll('.group-count')].map((n) => n.textContent))
      .toEqual(['3', '1', '1']);
  });

  it('hides a collapsed folder’s rows', () => {
    const { list } = mount({ grouped: true, collapsedGroups: new Set(['app.rocketseat.com.br']) });
    const group = list.el.querySelector('[data-domain="app.rocketseat.com.br"]')!;
    expect(titles(group)).toEqual([]);
    expect(group.querySelector('.group-head')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks to download only that folder', () => {
    const { list, handlers } = mount({ grouped: true });
    list.el.querySelector<HTMLButtonElement>('.group-icon')!.click();
    expect(handlers.onDownloadGroup).toHaveBeenCalledWith('app.rocketseat.com.br');
  });

  it('stops offering downloads while a run is going', () => {
    const { list, handlers } = mount({ grouped: true, downloadDisabled: true });
    const icon = list.el.querySelector<HTMLButtonElement>('.group-icon')!;
    expect(icon.disabled).toBe(true);
    icon.click();
    expect(handlers.onDownloadGroup).not.toHaveBeenCalled();
  });

  it('does not treat the download icon as a click on the folder', () => {
    const { list, handlers } = mount({ grouped: true });
    list.el.querySelector<HTMLButtonElement>('.group-icon')!.click();
    expect(handlers.onToggleGroup).not.toHaveBeenCalled();
  });

  it('gives each folder its own zone, with the current row outside it', () => {
    const { list } = mount({ grouped: true });
    const rocketseat = list.el.querySelector('[data-domain="app.rocketseat.com.br"]')!;
    expect(titles(rocketseat.querySelector('.reorder-zone')!)).toEqual(['aula08', 'aula07']);
    // youtube's only video is current, so it gets no zone at all
    expect(list.el.querySelector('[data-domain="youtube.com"] .reorder-zone')).toBeNull();
  });

  // A video belongs to its site; dragging it into another folder would be a
  // lie about where it came from.
  it('refuses a drop into another site’s folder', () => {
    const { list } = mount({ grouped: true });
    const zones = [...list.el.querySelectorAll<HTMLElement>('.reorder-zone')];
    const [rocketseat, udemy] = zones;
    const dragged = rocketseat.querySelector('.media-item')!;
    const transfer = dt();

    fire(dragged, 'dragstart', 0, transfer);
    const before = titles(udemy);
    fire(udemy, 'dragover', 0, transfer);

    expect(titles(udemy)).toEqual(before);
    expect(dragged.parentElement).toBe(rocketseat);
    expect(udemy.classList.contains('drop-target')).toBe(false);
  });

  it('reorders happily within its own folder', () => {
    const { list } = mount({ grouped: true });
    const zone = list.el.querySelector<HTMLElement>('.reorder-zone')!;
    const dragged = [...zone.querySelectorAll('.media-item')].at(-1)!;
    const transfer = dt();

    fire(dragged, 'dragstart', 0, transfer);
    fire(zone, 'dragover', -500, transfer);

    expect(titles(zone)).toEqual(['aula07', 'aula08']);
  });
});

describe('entriesForDomain', () => {
  it('picks out one site’s videos in list order', () => {
    expect(entriesForDomain(ENTRIES, 'app.rocketseat.com.br').map((e) => e.title))
      .toEqual(['ep12', 'aula08', 'aula07']);
  });
});

describe('VideoList folders', () => {
  beforeEach(() => document.body.replaceChildren());

  const FOLDERS = [{ id: 'f1', name: 'Aulas' }, { id: 'f2', name: 'Cursos' }];
  const filed = (title: string, folderId: string) =>
    ({ ...ENTRIES.find((e) => e.title === title)!, folderId }) as HistoryEntry;
  const withFiled = () => ENTRIES.map((e) =>
    e.title === 'aula08' ? filed('aula08', 'f1') : e.title === 'design' ? filed('design', 'f2') : e);
  const group = (list: VideoList, id: string) =>
    list.el.querySelector<HTMLElement>(`.user-folder[data-folder-id="${id}"]`)!;

  it('shows the folders above the unfiled videos, each with its own', () => {
    const { list } = mount({ entries: withFiled(), folders: FOLDERS });

    const order = [...list.el.children].map((el) => el.className.split(' ')[0]);
    expect(order.slice(0, 2)).toEqual(['media-group', 'media-group']);
    expect(titles(group(list, 'f1'))).toEqual(['aula08']);
    expect(titles(group(list, 'f2'))).toEqual(['design']);
    expect(titles(list.el).filter((t) => ['ep12', 'deep house', 'aula07'].includes(t)))
      .toEqual(['ep12', 'deep house', 'aula07']);
  });

  it('keeps a filed video out of the main list', () => {
    const { list } = mount({ entries: withFiled(), folders: FOLDERS });

    const loose = [...list.el.children].filter((el) => !el.classList.contains('user-folder'));
    expect(loose.flatMap((el) => titles(el))).not.toContain('aula08');
  });

  it('lists an empty folder so a row can be dropped on it', () => {
    const { list } = mount({ folders: FOLDERS });

    expect(group(list, 'f1')).not.toBeNull();
    expect(group(list, 'f1').querySelector('.group-count')!.textContent).toBe('0');
  });

  it('hides folders without a match while searching', () => {
    const { list } = mount({ entries: [filed('aula08', 'f1')], folders: FOLDERS, searching: true });

    expect(group(list, 'f1')).not.toBeNull();
    expect(group(list, 'f2')).toBeNull();
  });

  it('collapses a folder body', () => {
    const { list } = mount({
      entries: withFiled(), folders: FOLDERS, collapsedFolders: new Set(['f1'])
    });

    expect(titles(group(list, 'f1'))).toEqual([]);
  });

  it('opens the new-folder form, saying how many videos it will hold', () => {
    const { list } = mount({ creatingFolder: { keys: ['a', 'b'] } });

    const input = list.el.querySelector<HTMLInputElement>('.folder-composer input')!;
    expect(input.placeholder).toContain('2 videos');
  });

  it('creates the folder with the typed name on Enter', () => {
    const { list, handlers } = mount({ creatingFolder: { keys: [] } });
    const input = list.el.querySelector<HTMLInputElement>('.folder-composer input')!;

    input.value = 'Meu curso';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(handlers.onCommitNewFolder).toHaveBeenCalledWith('Meu curso');
  });

  it('offers to create the folder with every video that is in no folder', () => {
    const { list, handlers } = mount({ creatingFolder: { keys: [] }, unfiledCount: 4 });
    const input = list.el.querySelector<HTMLInputElement>('.folder-composer input')!;
    const all = list.el.querySelector<HTMLButtonElement>('.folder-add-all')!;

    expect(all.textContent).toBe('Create with all 4 videos not in a folder');
    input.value = 'Tudo';
    all.click();

    expect(handlers.onCommitNewFolderWithUnfiled).toHaveBeenCalledWith('Tudo');
    expect(handlers.onCommitNewFolder).not.toHaveBeenCalled();
  });

  it('says "video" for a single loose one and hides the button when none are loose', () => {
    const one = mount({ creatingFolder: { keys: [] }, unfiledCount: 1 });
    expect(one.list.el.querySelector('.folder-add-all')!.textContent)
      .toBe('Create with all 1 video not in a folder');

    document.body.replaceChildren();
    const none = mount({ creatingFolder: { keys: [] }, unfiledCount: 0 });
    expect(none.list.el.querySelector('.folder-add-all')).toBeNull();
  });

  it('cancels the new-folder form on Escape', () => {
    const { list, handlers } = mount({ creatingFolder: { keys: [] } });
    const input = list.el.querySelector<HTMLInputElement>('.folder-composer input')!;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(handlers.onCancelNewFolder).toHaveBeenCalled();
  });

  it('renames a folder from its heading', () => {
    const { list, handlers } = mount({ folders: FOLDERS, renamingFolderId: 'f1' });
    const input = group(list, 'f1').querySelector<HTMLInputElement>('.rename-input')!;

    input.value = 'Novo nome';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(handlers.onCommitRenameFolder).toHaveBeenCalledWith('f1', 'Novo nome');
  });

  it('reports download, rename and delete from the folder heading', () => {
    const { list, handlers } = mount({ entries: withFiled(), folders: FOLDERS });
    const head = group(list, 'f1');

    (head.querySelector('.folder-download') as HTMLButtonElement).click();
    (head.querySelector('.icon-btn-rename') as HTMLButtonElement).click();
    (head.querySelector('.folder-delete') as HTMLButtonElement).click();

    expect(handlers.onDownloadFolder).toHaveBeenCalledWith('f1');
    expect(handlers.onStartRenameFolder).toHaveBeenCalledWith('f1');
    expect(handlers.onDeleteFolder).toHaveBeenCalledWith('f1');
  });

  it('cannot download an empty folder', () => {
    const { list } = mount({ folders: FOLDERS });

    expect((group(list, 'f1').querySelector('.folder-download') as HTMLButtonElement).disabled).toBe(true);
  });

  describe('dragging into folders', () => {
    const drag = (target: HTMLElement, type: string, dragged?: HTMLElement) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true }) as any;
      event.dataTransfer = { setData: vi.fn(), dropEffect: '', effectAllowed: '' };
      if (dragged) dragged.classList.add('dragging');
      target.dispatchEvent(event);
      return event as Event;
    };
    const rowOf = (list: VideoList, title: string) =>
      [...list.el.querySelectorAll<HTMLElement>('.media-item')]
        .find((row) => row.querySelector('.media-title-text')!.textContent === title)!;

    it('files a dragged row into the folder it is dropped on', () => {
      const { list, handlers } = mount({ folders: FOLDERS });
      const row = rowOf(list, 'aula07');

      drag(row, 'dragstart');
      row.classList.add('dragging');
      drag(group(list, 'f2'), 'dragover');
      drag(group(list, 'f2'), 'drop');

      expect(handlers.onDropToFolder).toHaveBeenCalledWith(['https://cdn.rs.com/l7/aula07.m3u8'], 'f2');
    });

    it('takes a filed row back out when it is dropped on the main list', () => {
      const { list, handlers } = mount({ entries: withFiled(), folders: FOLDERS });
      const row = rowOf(list, 'aula08');

      drag(row, 'dragstart');
      row.classList.add('dragging');
      drag(list.el, 'dragover');
      drag(list.el, 'drop');

      expect(handlers.onDropToFolder).toHaveBeenCalledWith(['https://cdn.rs.com/l8/aula08.m3u8'], null);
    });

    it('ignores a drop on the folder the row is already in', () => {
      const { list, handlers } = mount({ entries: withFiled(), folders: FOLDERS });
      const row = rowOf(list, 'aula08');

      drag(row, 'dragstart');
      row.classList.add('dragging');
      drag(group(list, 'f1'), 'drop');

      expect(handlers.onDropToFolder).not.toHaveBeenCalled();
    });

    it('files the video playing now when it is dropped on a folder', () => {
      const { list, handlers } = mount({ folders: FOLDERS });
      const row = rowOf(list, 'ep12');

      expect(row.draggable).toBe(true);
      drag(row, 'dragstart');
      row.classList.add('dragging');
      drag(group(list, 'f1'), 'dragover');
      drag(group(list, 'f1'), 'drop');

      expect(handlers.onDropToFolder).toHaveBeenCalledWith(['https://cdn.rs.com/l9/ep12.m3u8'], 'f1');
    });

    it('keeps the video playing now out of the reorder zone, so it can never be reordered', () => {
      const { list } = mount({ folders: FOLDERS });
      const zone = list.el.querySelector('.reorder-zone')!;

      expect(zone.contains(rowOf(list, 'ep12'))).toBe(false);
      expect(zone.contains(rowOf(list, 'aula07'))).toBe(true);
    });
  });
});

