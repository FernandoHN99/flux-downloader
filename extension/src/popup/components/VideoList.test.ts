import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HistoryEntry } from '../../lib/types';
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
    onReorder: vi.fn(), onToggleGroup: vi.fn(), onDownloadGroup: vi.fn()
  };
  const rowState = (e: HistoryEntry): Omit<VideoRowState, 'entry'> => ({
    isCurrent: CURRENT.has(e.url), isBusy: false, busyLabel: '', selectionMode: false,
    isPicked: false, isExpanded: false, isRenaming: false, downloadDisabled: false,
    selectedQualityIndex: 0
  });
  const list = new VideoList(
    { entries: ENTRIES, grouped: false, collapsedGroups: new Set(),
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

  it('gives a grip only to the rows that can move', () => {
    const { list } = mount();
    expect(list.el.querySelectorAll('.drag-handle')).toHaveLength(3);
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
