import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListHeader, type ListHeaderState } from './ListHeader';

function mount(state: Partial<ListHeaderState> = {}) {
  const handlers = {
    onQuality: vi.fn(), onDownloadAll: vi.fn(), onClearAll: vi.fn(),
    onClearSelected: vi.fn(), onSearch: vi.fn()
  };
  const header = new ListHeader({
    selectionMode: false, renaming: false, selectedCount: 0, batchQuality: 'best',
    downloadDisabled: false, search: '', ...state
  }, handlers);
  document.body.appendChild(header.el);
  header.update();
  return { header, handlers };
}

const buttons = (h: ListHeader) =>
  [...h.el.querySelectorAll('.history-actions button')].map((b) => b.textContent);

describe('ListHeader', () => {
  beforeEach(() => document.body.replaceChildren());

  it('offers the quality toggle and Download all at rest — and no Clear', () => {
    const { header } = mount();
    expect(buttons(header)).toEqual(['Best', 'Lowest', 'Download all']);
  });

  it('marks the chosen batch quality', () => {
    const { header } = mount({ batchQuality: 'worst' });
    const selected = header.el.querySelector('.quality-badge.selected')!;
    expect(selected.textContent).toBe('Lowest');
    expect(selected.getAttribute('aria-checked')).toBe('true');
  });

  it('reports a quality change', () => {
    const { header, handlers } = mount();
    header.el.querySelector<HTMLButtonElement>('[data-quality="worst"]')!.click();
    expect(handlers.onQuality).toHaveBeenCalledWith('worst');
  });

  it('disables Download all while a run holds the CoApp', () => {
    const { header, handlers } = mount({ downloadDisabled: true });
    const button = header.el.querySelector<HTMLButtonElement>('#download-all-btn')!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(handlers.onDownloadAll).not.toHaveBeenCalled();
  });

  describe('while picking rows to delete', () => {
    it('swaps everything for the two clear buttons', () => {
      const { header } = mount({ selectionMode: true, selectedCount: 2 });
      expect(buttons(header)).toEqual(['Clear All', 'Clear (2)']);
      expect(header.el.querySelector('.quality-toggle')).toBeNull();
      expect(header.el.querySelector('#download-all-btn')).toBeNull();
    });

    it('counts the ticks', () => {
      const { header } = mount({ selectionMode: true, selectedCount: 1 });
      expect(header.el.querySelector('#clear-selected-btn')!.textContent).toBe('Clear (1)');
      header.setState({ selectedCount: 3 });
      expect(header.el.querySelector('#clear-selected-btn')!.textContent).toBe('Clear (3)');
    });

    it('keeps the two clears apart: one wipes, one deletes the ticks', () => {
      const { header, handlers } = mount({ selectionMode: true, selectedCount: 2 });
      header.el.querySelector<HTMLButtonElement>('#clear-all-btn')!.click();
      expect(handlers.onClearAll).toHaveBeenCalledTimes(1);
      expect(handlers.onClearSelected).not.toHaveBeenCalled();

      header.el.querySelector<HTMLButtonElement>('#clear-selected-btn')!.click();
      expect(handlers.onClearSelected).toHaveBeenCalledTimes(1);
    });
  });

  it('shows nothing at all while a rename is open', () => {
    const { header } = mount({ renaming: true });
    expect(buttons(header)).toEqual([]);
  });

  describe('search', () => {
    it('reports what was typed', () => {
      const { header, handlers } = mount();
      const field = header.el.querySelector<HTMLInputElement>('#history-search')!;
      field.value = 'react';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      expect(handlers.onSearch).toHaveBeenCalledWith('react');
    });

    it('stays visible in every flow, since it is how you find a row', () => {
      expect(mount({ selectionMode: true }).header.el.querySelector('#history-search')).not.toBeNull();
      expect(mount({ renaming: true }).header.el.querySelector('#history-search')).not.toBeNull();
    });

    // Every keystroke redraws the list, which redraws this header.
    it('keeps the caret while typing', () => {
      const { header } = mount({ search: 'reac' });
      const field = header.el.querySelector<HTMLInputElement>('#history-search')!;
      field.focus();
      field.setSelectionRange(4, 4);

      header.setState({ search: 'react' });

      const after = header.el.querySelector<HTMLInputElement>('#history-search')!;
      expect(document.activeElement).toBe(after);
      expect(after.value).toBe('react');
      expect(after.selectionStart).toBe(4);
    });
  });
});
