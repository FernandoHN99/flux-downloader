import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderGroup, type FolderGroupState } from './FolderGroup';

function mount(state: Partial<FolderGroupState> = {}) {
  const handlers = {
    onToggle: vi.fn(), onDownload: vi.fn(), onStartRename: vi.fn(),
    onCommitRename: vi.fn(), onCancelRename: vi.fn(), onDelete: vi.fn()
  };
  const group = new FolderGroup({
    id: 'f1', name: 'Módulo 1', count: 3, collapsed: false, renaming: false,
    downloadDisabled: false, locked: false, ...state
  }, handlers);
  document.body.appendChild(group.el);
  group.update();
  return { group, handlers };
}

const button = (group: FolderGroup, selector: string) =>
  group.el.querySelector<HTMLButtonElement>(selector)!;

describe('FolderGroup', () => {
  beforeEach(() => document.body.replaceChildren());

  it('says that deleting it deletes the videos in it', () => {
    const { group } = mount({ count: 3 });
    expect(button(group, '.folder-delete').title).toBe('Delete folder and the videos in it');
    expect(button(mount({ count: 0 }).group, '.folder-delete').title).toBe('Delete folder');
  });

  it('reports the delete and the rename', () => {
    const { group, handlers } = mount();
    button(group, '.folder-delete').click();
    button(group, '.icon-btn-rename').click();

    expect(handlers.onDelete).toHaveBeenCalledWith('f1');
    expect(handlers.onStartRename).toHaveBeenCalledWith('f1');
  });

  it('cannot be renamed or deleted while a video filed in it is downloading', () => {
    const { group, handlers } = mount({ locked: true });
    const remove = button(group, '.folder-delete');
    const rename = button(group, '.icon-btn-rename');

    expect(remove.disabled).toBe(true);
    expect(rename.disabled).toBe(true);
    expect(remove.title).toBe('Locked while its videos are downloading');
    remove.click();
    rename.click();
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(handlers.onStartRename).not.toHaveBeenCalled();
  });
});
