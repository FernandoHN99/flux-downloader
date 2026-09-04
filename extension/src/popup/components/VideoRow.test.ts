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
    onCancelRename: vi.fn(), onTrash: vi.fn(), onSelectQuality: vi.fn(), onDownload: vi.fn()
  };
  const row = new VideoRow({
    entry: entry(), isCurrent: false, isBusy: false, busyLabel: '', selectionMode: false,
    isPicked: false, isExpanded: false, isRenaming: false, downloadDisabled: false,
    selectedQualityIndex: 0, ...state
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
    expect(q(row, '.media-meta')!.textContent).toContain('HLS');
    expect(q(row, '.media-meta')!.textContent).toContain('16:20');
  });

  describe('at rest', () => {
    it('offers rename and delete, and a grip to reorder', () => {
      const { row } = mount();
      expect(visibleButtons(row)).toEqual(['Rename', 'Select to delete']);
      expect(q(row, '.drag-handle')).not.toBeNull();
      expect(row.el.draggable).toBe(true);
    });

    it('reports a click so the row can open', () => {
      const { row, handlers } = mount();
      row.el.click();
      expect(handlers.onActivate).toHaveBeenCalledWith('https://cdn.x/l8/aula-08-hooks.m3u8');
    });
  });

  describe('a current video', () => {
    it('is flagged, pinned and takes no reorder gutter', () => {
      const { row } = mount({ isCurrent: true });
      expect(q(row, '.current-badge')).not.toBeNull();
      expect(q(row, '.drag-handle')).toBeNull();
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
      row.el.querySelector<HTMLButtonElement>('.remove-btn')!.click();
      expect(handlers.onTrash).toHaveBeenCalled();
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

  // The flow-isolation rule, enforced here rather than in a stylesheet where
  // one rule silently stopped hiding anything.
  describe('while renaming', () => {
    it('leaves only the confirm and cancel controls', () => {
      const { row } = mount({ isRenaming: true });
      expect(visibleButtons(row)).toEqual(['Save title', 'Cancel rename']);
      expect(q(row, '.rename-btn')).toBeNull();
      expect(q(row, '.remove-btn')).toBeNull();
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
