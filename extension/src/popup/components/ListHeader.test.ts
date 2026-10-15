import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListHeader, type ListHeaderState } from './ListHeader';

function mount(state: Partial<ListHeaderState> = {}) {
  const handlers = {
    onQuality: vi.fn(), onDownloadAll: vi.fn(), onSearch: vi.fn(), onNewFolder: vi.fn(),
    onSelectAll: vi.fn(), onExitSelection: vi.fn(), onDeleteSelected: vi.fn(),
    onToggleMoveSelection: vi.fn(), onMoveSelectedTo: vi.fn(),
    onCommitNewFolder: vi.fn(), onCommitNewFolderWithUnfiled: vi.fn(), onCancelNewFolder: vi.fn()
  };
  const header = new ListHeader({
    selectionMode: false, renaming: false, selectedCount: 0, visibleCount: 10, totalCount: 10,
    batchQuality: 'best', downloadDisabled: false, search: '', folders: [], canUnfile: false,
    movingSelection: false, creatingFolder: null, ...state
  }, handlers);
  document.body.appendChild(header.el);
  header.update();
  return { header, handlers };
}

const buttons = (h: ListHeader) =>
  [...h.el.querySelectorAll('.history-actions button')].map((b) => b.textContent);
const click = (h: ListHeader, selector: string) =>
  h.el.querySelector<HTMLButtonElement>(selector)!.click();

describe('ListHeader', () => {
  beforeEach(() => document.body.replaceChildren());

  it('offers New folder, the quality toggle and Download all at rest', () => {
    const { header } = mount();
    expect(buttons(header)).toEqual(['New folder', 'Best', 'Lowest', 'Download all']);
  });

  it('counts the videos beside the title, and leaves the count out when there are none', () => {
    expect(mount({ totalCount: 44 }).header.el.querySelector('.history-count')!.textContent).toBe('44');
    document.body.replaceChildren();
    expect(mount({ totalCount: 0 }).header.el.querySelector('.history-count')).toBeNull();
  });

  it('puts the quality inside the Download all control it belongs to', () => {
    const { header } = mount();
    const joined = header.el.querySelector('.download-all')!;
    expect(joined.querySelector('.quality-toggle')).not.toBeNull();
    expect(joined.querySelector('#download-all-btn')).not.toBeNull();
  });

  it('marks the chosen batch quality', () => {
    const { header } = mount({ batchQuality: 'worst' });
    const selected = header.el.querySelector('.quality-badge.selected')!;
    expect(selected.textContent).toBe('Lowest');
    expect(selected.getAttribute('aria-checked')).toBe('true');
  });

  it('reports a quality change', () => {
    const { header, handlers } = mount();
    click(header, '[data-quality="worst"]');
    expect(handlers.onQuality).toHaveBeenCalledWith('worst');
  });

  it('disables Download all while a run holds the CoApp', () => {
    const { header, handlers } = mount({ downloadDisabled: true });
    const button = header.el.querySelector<HTMLButtonElement>('#download-all-btn')!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(handlers.onDownloadAll).not.toHaveBeenCalled();
  });

  it('shows nothing but the title while a rename is open', () => {
    const { header } = mount({ renaming: true });
    expect(buttons(header)).toEqual([]);
    expect(header.el.querySelector('.history-label')).not.toBeNull();
  });

  describe('while picking rows', () => {
    const picking = (state: Partial<ListHeaderState> = {}) =>
      mount({ selectionMode: true, selectedCount: 3, ...state });

    it('swaps the action bar for the selection bar', () => {
      const { header } = picking();
      expect(header.el.querySelector('.quality-toggle')).toBeNull();
      expect(header.el.querySelector('#download-all-btn')).toBeNull();
      expect(header.el.querySelector('.selection-bar')).not.toBeNull();
    });

    it('says how many are picked', () => {
      const { header } = picking({ selectedCount: 1 });
      expect(header.el.querySelector('.selection-count')!.textContent).toBe('1 selected');
      header.setState({ selectedCount: 12 });
      expect(header.el.querySelector('.selection-count')!.textContent).toBe('12 selected');
    });

    it('offers New folder and Delete, and Move to only once there is a folder to move to', () => {
      expect(buttons(picking().header)).toEqual(['New folder', 'Delete']);
      document.body.replaceChildren();
      const withFolder = picking({ folders: [{ id: 'f1', name: 'Curso' }] });
      expect(buttons(withFolder.header)).toEqual(['New folder', 'Move to…', 'Delete']);
    });

    it('reports New folder, Delete, Select all and leaving', () => {
      const { header, handlers } = picking({ selectedCount: 3, visibleCount: 10 });
      click(header, '#new-folder-btn');
      click(header, '#delete-selected-btn');
      click(header, '#select-all-btn');
      click(header, '#exit-selection-btn');
      expect(handlers.onNewFolder).toHaveBeenCalledTimes(1);
      expect(handlers.onDeleteSelected).toHaveBeenCalledTimes(1);
      expect(handlers.onSelectAll).toHaveBeenCalledTimes(1);
      expect(handlers.onExitSelection).toHaveBeenCalledTimes(1);
    });

    it('stops offering Select all once everything on screen is picked', () => {
      const { header } = picking({ selectedCount: 10, visibleCount: 10 });
      expect(header.el.querySelector('#select-all-btn')).toBeNull();
    });

    describe('moving the picked videos', () => {
      const folders = [{ id: 'f1', name: 'Curso' }, { id: 'f2', name: 'Extras' }];

      it('opens a menu of folders from Move to', () => {
        const { header, handlers } = picking({ folders });
        click(header, '#move-selected-btn');
        expect(handlers.onToggleMoveSelection).toHaveBeenCalled();
        expect(header.el.querySelector('.selection-move')).toBeNull();

        header.setState({ movingSelection: true });
        const items = [...header.el.querySelectorAll('.selection-move .move-choice')];
        expect(items.map((item) => item.textContent)).toEqual(['Curso', 'Extras']);
      });

      it('files the picked videos into the chosen folder', () => {
        const { header, handlers } = picking({ folders, movingSelection: true });
        (header.el.querySelectorAll('.selection-move .move-choice')[1] as HTMLButtonElement).click();
        expect(handlers.onMoveSelectedTo).toHaveBeenCalledWith('f2');
      });

      it('offers to take them out of their folders only when one is filed', () => {
        const without = picking({ folders, movingSelection: true });
        expect([...without.header.el.querySelectorAll('.selection-move .move-choice')]
          .map((item) => item.textContent)).not.toContain('Remove from folder');

        document.body.replaceChildren();
        const withFiled = picking({ folders, movingSelection: true, canUnfile: true });
        (withFiled.header.el.querySelector('.selection-move .move-choice:last-child') as HTMLButtonElement).click();
        expect(withFiled.handlers.onMoveSelectedTo).toHaveBeenCalledWith(null);
      });
    });
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
      expect(mount({ creatingFolder: { videoCount: 0, unfiledCount: 0 } })
        .header.el.querySelector('#history-search')).not.toBeNull();
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

describe('ListHeader new folder', () => {
  beforeEach(() => document.body.replaceChildren());

  it('offers "New folder" at rest and reports the click', () => {
    const { header, handlers } = mount();
    click(header, '#new-folder-btn');
    expect(handlers.onNewFolder).toHaveBeenCalled();
  });

  it('leaves it out while renaming', () => {
    expect(mount({ renaming: true }).header.el.querySelector('#new-folder-btn')).toBeNull();
  });

  describe('the name form', () => {
    const naming = (state: Partial<ListHeaderState['creatingFolder'] & object> = {}) =>
      mount({ creatingFolder: { videoCount: 0, unfiledCount: 0, ...state } });
    const input = (h: ListHeader) => h.el.querySelector<HTMLInputElement>('.folder-composer input')!;

    it('takes the bar over, so nothing else competes with naming the folder', () => {
      const { header } = naming();
      expect(header.el.querySelector('.folder-composer')).not.toBeNull();
      expect(header.el.querySelector('.history-header')).toBeNull();
    });

    it('says how many videos it will hold', () => {
      expect(input(naming({ videoCount: 2 }).header).placeholder).toContain('2 videos');
      document.body.replaceChildren();
      expect(input(naming({ videoCount: 1 }).header).placeholder).toContain('1 video');
    });

    it('creates the folder with the typed name on Enter', () => {
      const { header, handlers } = naming();
      input(header).value = 'Meu curso';
      input(header).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(handlers.onCommitNewFolder).toHaveBeenCalledWith('Meu curso');
    });

    it('offers to create the folder with every video that is in no folder', () => {
      const { header, handlers } = naming({ unfiledCount: 4 });
      const all = header.el.querySelector<HTMLButtonElement>('.folder-add-all')!;

      expect(all.textContent).toBe('Create with all 4 videos not in a folder');
      input(header).value = 'Tudo';
      all.click();

      expect(handlers.onCommitNewFolderWithUnfiled).toHaveBeenCalledWith('Tudo');
      expect(handlers.onCommitNewFolder).not.toHaveBeenCalled();
    });

    it('says "video" for a single loose one and hides the button when none are loose', () => {
      expect(naming({ unfiledCount: 1 }).header.el.querySelector('.folder-add-all')!.textContent)
        .toBe('Create with all 1 video not in a folder');
      document.body.replaceChildren();
      expect(naming({ unfiledCount: 0 }).header.el.querySelector('.folder-add-all')).toBeNull();
    });

    it('cancels on Escape', () => {
      const { header, handlers } = naming();
      input(header).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(handlers.onCancelNewFolder).toHaveBeenCalled();
    });

    it('keeps the caret in the name field while the header redraws around it', () => {
      const { header } = naming();
      input(header).value = 'Cur';
      input(header).focus();
      input(header).setSelectionRange(3, 3);

      header.setState({ search: 'x' });

      expect(document.activeElement).toBe(input(header));
    });
  });
});
