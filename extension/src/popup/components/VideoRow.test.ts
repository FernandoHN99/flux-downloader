import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HistoryEntry } from '../../shared/types';
import { VideoRow, type VideoRowState } from './VideoRow';

const entry = (patch: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'v1', title: 'aula-08-hooks', url: 'https://cdn.x/l8/aula-08-hooks.m3u8',
  pageUrl: 'https://app.rocketseat.com.br/aula-8', type: 'hls', duration: 980,
  qualities: [{ height: 1080, url: 'a', bitrate: 2_500_000 }],
  detectedAt: Date.now() - 60_000, ...patch
}) as HistoryEntry;

function mount(state: Partial<VideoRowState> = {}) {
  const handlers = {
    onActivate: vi.fn(), onStartRename: vi.fn(), onCommitRename: vi.fn(),
    onCancelRename: vi.fn(), onSelect: vi.fn(), onSelectQuality: vi.fn(), onDownload: vi.fn(),
    onToggleMove: vi.fn(), onMoveToFolder: vi.fn(), onNewFolderFor: vi.fn()
  };
  const row = new VideoRow({
    entry: entry(), isCurrent: false, isBusy: false, isLocked: false, busyLabel: '', selectionMode: false,
    isPicked: false, isExpanded: false, isRenaming: false, downloadDisabled: false,
    selectedQualityIndex: 0, canMove: true, isMoving: false, folders: [], ...state
  }, handlers);
  document.body.appendChild(row.el);
  row.update();
  return { row, handlers };
}

const q = (row: VideoRow, sel: string) => row.el.querySelector(sel);
const visibleButtons = (row: VideoRow) =>
  [...row.el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

describe('VideoRow', () => {
  beforeEach(() => document.body.replaceChildren());

  it('shows the title and what the video is', () => {
    const { row } = mount();
    expect(q(row, '.media-title-text')!.textContent).toBe('aula-08-hooks');
    expect(q(row, '.media-kind')!.textContent).toBe('HLS');
    expect(q(row, '.media-length')!.textContent).toBe('16 min 20 s');
  });

  it('shows how long the video is instead of when it was detected', () => {
    const { row } = mount();
    const meta = q(row, '.media-meta')!.textContent!;

    expect(meta).toBe('16 min 20 s HLS');
    expect(meta).not.toMatch(/ago|just now/);
  });

  it('shows just the type when the length is not known', () => {
    const { row } = mount({ entry: entry({ duration: undefined }) });

    expect(q(row, '.media-meta')!.textContent).toBe('HLS');
  });

  describe('at rest', () => {
    it('offers rename and delete, and a grip to reorder', () => {
      const { row } = mount();
      expect(visibleButtons(row)).toEqual(['Move to folder', 'Rename', 'Select (Shift-click to select a range)']);
      expect(q(row, '.drag-handle')).not.toBeNull();
      expect(row.el.draggable).toBe(true);
    });

    it('reports a click so the row can open', () => {
      const { row, handlers } = mount();
      row.el.click();
      expect(handlers.onActivate).toHaveBeenCalledWith(
        'https://cdn.x/l8/aula-08-hooks.m3u8', { range: false, toggle: false }
      );
    });
  });

  describe('a current video', () => {
    it('is flagged and can be dragged, but is never reorderable', () => {
      const { row } = mount({ isCurrent: true });
      expect(q(row, '.current-badge')).not.toBeNull();
      expect(q(row, '.drag-handle')).not.toBeNull();
      expect(row.el.draggable).toBe(true);
      expect(row.el.dataset.reorderable).toBe('false');
    });

    it('says its grip drags into a folder, not to reorder', () => {
      const { row } = mount({ isCurrent: true });

      expect((q(row, '.drag-handle') as HTMLElement).title).toBe('Drag into a folder');
    });

    it('is still held in place while it is downloading', () => {
      const { row } = mount({ isCurrent: true, isBusy: true });

      expect(row.el.draggable).toBe(false);
    });

    it('puts the flag at the end of the line, not inside the title', () => {
      const { row } = mount({ isCurrent: true });
      const head = q(row, '.media-head')!;
      expect(head.lastElementChild!.classList.contains('current-badge')).toBe(true);
      expect(q(row, '.media-title-row .current-badge')).toBeNull();
    });

    it('can still be deleted even though it never reorders', () => {
      const { row, handlers } = mount({ isCurrent: true });
      row.el.querySelector<HTMLButtonElement>('.select-btn')!.click();
      expect(handlers.onSelect).toHaveBeenCalled();
    });
  });

  describe('while downloading', () => {
    it('trades its actions for a spinner and says how far along it is', () => {
      const { row } = mount({ isBusy: true, busyLabel: 'Downloading… 38%' });
      expect(q(row, '.row-spinner')).not.toBeNull();
      expect(q(row, '.media-actions')).toBeNull();
      expect(q(row, '.media-meta')!.textContent).toBe('Downloading… 38%');
    });

    it('says it is waiting when it is not the one being written', () => {
      const { row } = mount({ isBusy: true, busyLabel: 'Queued' });
      expect(q(row, '.media-meta')!.textContent).toBe('Queued');
    });

    it('holds still and ignores clicks', () => {
      const { row, handlers } = mount({ isBusy: true, busyLabel: 'Queued' });
      expect(row.el.draggable).toBe(false);
      row.el.click();
      expect(handlers.onActivate).not.toHaveBeenCalled();
    });
  });

  describe('as part of a running download', () => {
    it('trades its actions for a lock, even when its own download is already done', () => {
      const { row } = mount({ isLocked: true });
      expect(q(row, '.row-lock')).not.toBeNull();
      expect(q(row, '.media-actions')).toBeNull();
      expect(q(row, '.rename-btn')).toBeNull();
      expect(q(row, '.select-btn')).toBeNull();
      expect(q(row, '.move-btn')).toBeNull();
      expect(row.el.classList.contains('locked')).toBe(true);
    });

    it('still shows how long it is, since it is not mid-download', () => {
      const { row } = mount({ isLocked: true });
      expect(q(row, '.media-length')!.textContent).toBe('16 min 20 s');
      expect(q(row, '.media-kind')!.textContent).toBe('HLS');
    });

    it('cannot be dragged', () => {
      const { row } = mount({ isLocked: true });
      expect(row.el.draggable).toBe(false);
      expect(q(row, '.drag-handle')).toBeNull();
    });

    it('cannot be picked, by Shift, Ctrl or Cmd', () => {
      const { row, handlers } = mount({ isLocked: true });
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      expect(handlers.onActivate).not.toHaveBeenCalled();
    });

    it('shows no tick to pick while the list is being picked, but keeps the row aligned', () => {
      const { row, handlers } = mount({ isLocked: true, selectionMode: true });
      expect(q(row, '.select-dot.unavailable')).not.toBeNull();
      expect(q(row, '.select-dot.checked')).toBeNull();
      row.el.click();
      expect(handlers.onActivate).not.toHaveBeenCalled();
    });

    it('never opens its move choices', () => {
      const { row } = mount({ isLocked: true, isMoving: true, canMove: false });
      expect(q(row, '.move-panel')).toBeNull();
    });
  });

  describe('modifier clicks', () => {
    const KEY = 'https://cdn.x/l8/aula-08-hooks.m3u8';

    it('reports a plain click as neither a range nor a toggle', () => {
      const { row, handlers } = mount();
      row.el.click();
      expect(handlers.onActivate).toHaveBeenCalledWith(KEY, { range: false, toggle: false });
    });

    it('reports Shift as a range', () => {
      const { row, handlers } = mount();
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      expect(handlers.onActivate).toHaveBeenCalledWith(KEY, { range: true, toggle: false });
    });

    it('reports Ctrl and Cmd as a toggle', () => {
      const { row, handlers } = mount();
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      row.el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      expect(handlers.onActivate).toHaveBeenNthCalledWith(1, KEY, { range: false, toggle: true });
      expect(handlers.onActivate).toHaveBeenNthCalledWith(2, KEY, { range: false, toggle: true });
    });

    it('reports Shift+Enter from the keyboard as a range too', () => {
      const { row, handlers } = mount();
      row.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      expect(handlers.onActivate).toHaveBeenCalledWith(KEY, { range: true, toggle: false });
    });

    it('keeps a Shift-click from painting a text selection across the rows', () => {
      const { row } = mount();
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true });
      row.el.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);

      const plain = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      row.el.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);
    });
  });

  // The flow-isolation rule, enforced here rather than in a stylesheet where
  // one rule silently stopped hiding anything.
  describe('while renaming', () => {
    it('leaves only the confirm and cancel controls', () => {
      const { row } = mount({ isRenaming: true });
      expect(visibleButtons(row)).toEqual(['Save title', 'Cancel rename']);
      expect(q(row, '.rename-btn')).toBeNull();
      expect(q(row, '.select-btn')).toBeNull();
      expect(q(row, '.drag-handle')).toBeNull();
      expect(q(row, '.current-badge')).toBeNull();
    });

    it('starts from the current title', () => {
      const { row } = mount({ isRenaming: true });
      expect(q(row, '.rename-input')!.getAttribute('value') ?? (q(row, '.rename-input') as HTMLInputElement).value)
        .toBe('aula-08-hooks');
    });

    it('commits what was typed', () => {
      const { row, handlers } = mount({ isRenaming: true });
      const input = row.el.querySelector<HTMLInputElement>('.rename-input')!;
      input.value = '  Aula 8 renomeada  ';
      row.el.querySelector<HTMLButtonElement>('.icon-btn-confirm')!.click();
      expect(handlers.onCommitRename).toHaveBeenCalledWith(expect.any(String), 'Aula 8 renomeada');
    });

    it('commits on Enter and abandons on Escape', () => {
      const { row, handlers } = mount({ isRenaming: true });
      const input = row.el.querySelector<HTMLInputElement>('.rename-input')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(handlers.onCommitRename).toHaveBeenCalled();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(handlers.onCancelRename).toHaveBeenCalled();
    });

    it('does not treat typing in the field as a click on the row', () => {
      const { row, handlers } = mount({ isRenaming: true });
      row.el.querySelector<HTMLInputElement>('.rename-input')!.click();
      expect(handlers.onActivate).not.toHaveBeenCalled();
    });

    // The regression: updates were dropped while an input was open, because
    // redrawing wiped what was being typed.
    it('survives a redraw with the caret where it was', () => {
      const { row } = mount({ isRenaming: true });
      const input = row.el.querySelector<HTMLInputElement>('.rename-input')!;
      input.focus();
      input.value = 'meio digitado';
      input.setSelectionRange(5, 5);

      row.setState({ entry: entry({ detectedAt: Date.now() }) });

      const after = row.el.querySelector<HTMLInputElement>('.rename-input')!;
      expect(document.activeElement).toBe(after);
      expect(after.selectionStart).toBe(5);
    });
  });

  describe('while picking rows to delete', () => {
    it('leaves the row with nothing but its tick', () => {
      const { row } = mount({ selectionMode: true, isPicked: true });
      expect(visibleButtons(row)).toEqual([]);
      expect(q(row, '.select-dot.checked')).not.toBeNull();
      expect(q(row, '.drag-handle')).toBeNull();
      expect(row.el.draggable).toBe(false);
    });

    it('reports a click on the row as a tick', () => {
      const { row, handlers } = mount({ selectionMode: true });
      row.el.click();
      expect(handlers.onActivate).toHaveBeenCalled();
    });

    it('keeps the panel shut even if a row was open', () => {
      const { row } = mount({ selectionMode: true, isExpanded: true });
      expect(q(row, '.media-expand')).toBeNull();
    });
  });

  describe('when expanded', () => {
    it('shows its download options underneath', () => {
      const { row } = mount({ isExpanded: true });
      expect(q(row, '.media-expand')).not.toBeNull();
      expect(row.el.classList.contains('expanded')).toBe(true);
    });

    it('passes the download through with the chosen option', () => {
      const { row, handlers } = mount({ isExpanded: true });
      row.el.querySelector<HTMLButtonElement>('.expand-download-btn')!.click();
      expect(handlers.onDownload).toHaveBeenCalledWith(expect.objectContaining({ label: '1080p' }));
    });

    it('disables its download button while another run is going', () => {
      const { row } = mount({ isExpanded: true, downloadDisabled: true });
      expect(row.el.querySelector<HTMLButtonElement>('.expand-download-btn')!.disabled).toBe(true);
    });
  });

  it('marks a failed download without shouting over a busy one', () => {
    const { row } = mount({ entry: entry({ failed: true }) });
    expect(q(row, '.failed-badge')).not.toBeNull();

    const { row: busy } = mount({ entry: entry({ failed: true }), isBusy: true, busyLabel: 'Queued' });
    expect(q(busy, '.failed-badge')).toBeNull();
  });
});

describe('VideoRow folders', () => {
  beforeEach(() => document.body.replaceChildren());
  const folders = [{ id: 'f1', name: 'Aulas' }, { id: 'f2', name: 'Cursos' }];
  const choices = (row: VideoRow) =>
    [...row.el.querySelectorAll('.move-choice')].map((b) => b.textContent);

  it('offers "Move to folder" on an idle row', () => {
    const { row } = mount();

    expect(visibleButtons(row)).toContain('Move to folder');
  });

  it('offers it on the video playing now as well', () => {
    const { row } = mount({ isCurrent: true });

    expect(visibleButtons(row)).toContain('Move to folder');
  });

  it('hides it while the row is being downloaded or the list is being picked', () => {
    expect(visibleButtons(mount({ canMove: false }).row)).not.toContain('Move to folder');
  });

  it('opens the choices when asked and reports the click', () => {
    const { row, handlers } = mount();

    (row.el.querySelector('.move-btn') as HTMLButtonElement).click();

    expect(handlers.onToggleMove).toHaveBeenCalledWith('https://cdn.x/l8/aula-08-hooks.m3u8');
  });

  it('lists every folder, then the way to a new one', () => {
    const { row } = mount({ isMoving: true, folders });

    expect(choices(row)).toEqual(['Aulas', 'Cursos', 'New folder…']);
  });

  it('files the video into the folder that was picked', () => {
    const { row, handlers } = mount({ isMoving: true, folders });

    (row.el.querySelectorAll('.move-choice')[1] as HTMLButtonElement).click();

    expect(handlers.onMoveToFolder)
      .toHaveBeenCalledWith('https://cdn.x/l8/aula-08-hooks.m3u8', 'f2');
  });

  it('marks the folder it is already in and offers to take it out', () => {
    const { row, handlers } = mount({
      isMoving: true, folders, entry: entry({ folderId: 'f1' })
    });

    const [inFolder] = [...row.el.querySelectorAll('.move-choice')] as HTMLButtonElement[];
    expect(inFolder.disabled).toBe(true);
    expect(choices(row)).toContain('Remove from folder');

    (row.el.querySelectorAll('.move-choice')[2] as HTMLButtonElement).click();
    expect(handlers.onMoveToFolder)
      .toHaveBeenCalledWith('https://cdn.x/l8/aula-08-hooks.m3u8', null);
  });

  it('starts a new folder for this video', () => {
    const { row, handlers } = mount({ isMoving: true, folders });

    (row.el.querySelector('.move-new') as HTMLButtonElement).click();

    expect(handlers.onNewFolderFor).toHaveBeenCalledWith('https://cdn.x/l8/aula-08-hooks.m3u8');
  });

  it('carries its folder on the element so a drag knows where it came from', () => {
    expect(mount({ entry: entry({ folderId: 'f1' }) }).row.el.dataset.folder).toBe('f1');
    expect(mount().row.el.dataset.folder).toBeUndefined();
  });
});

