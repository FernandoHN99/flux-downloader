import { Component } from './base';
import { downloadIcon, folderIcon, iconButton } from './icons';

export interface FolderGroupState {
  id: string;
  name: string;
  count: number;
  collapsed: boolean;
  renaming: boolean;
  /** No downloading while a run is going, rows are being picked, or it is empty. */
  downloadDisabled: boolean;
  /** A video filed here is part of a running download: no renaming, no deleting. */
  locked: boolean;
}

export interface FolderGroupHandlers {
  onToggle(id: string): void;
  onDownload(id: string): void;
  onStartRename(id: string): void;
  onCommitRename(id: string, name: string): void;
  onCancelRename(): void;
  onDelete(id: string): void;
}

/**
 * A folder the user made. Its heading offers the folder-wide actions; its
 * body is where the rows go, and the whole element is what a dragged row is
 * dropped onto, which is the list's concern rather than this component's.
 */
export class FolderGroup extends Component<FolderGroupState> {
  readonly body: HTMLElement;
  private readonly head: HTMLElement;

  constructor(state: FolderGroupState, private readonly handlers: FolderGroupHandlers) {
    super({ className: 'media-group user-folder', state });
    this.head = document.createElement('div');
    this.head.className = 'group-head folder-head';
    this.head.setAttribute('role', 'button');
    this.head.tabIndex = 0;
    this.head.addEventListener('click', () => {
      if (!this.state.renaming) this.handlers.onToggle(this.state.id);
    });
    this.head.addEventListener('keydown', (event) => {
      if (event.target !== this.head) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.handlers.onToggle(this.state.id);
    });

    this.body = document.createElement('div');
    this.body.className = 'group-body folder-body';
    this.el.append(this.head, this.body);
  }

  protected render(): void {
    const { id, name, count, collapsed, renaming, downloadDisabled, locked } = this.state;
    this.el.dataset.folderId = id;
    this.head.setAttribute('aria-expanded', String(!collapsed));
    this.head.replaceChildren(folderIcon());

    if (renaming) {
      this.head.appendChild(this.buildRenameForm());
    } else {
      const label = document.createElement('span');
      label.className = 'group-name';
      label.textContent = name;
      this.head.appendChild(label);

      const badge = document.createElement('span');
      badge.className = 'group-count';
      badge.textContent = String(count);
      this.head.appendChild(badge);

      this.head.appendChild(this.buildActions(id, count, downloadDisabled, locked));

      const chevron = document.createElement('span');
      chevron.className = collapsed ? 'group-chevron' : 'group-chevron open';
      chevron.setAttribute('aria-hidden', 'true');
      this.head.appendChild(chevron);
    }

    this.body.hidden = collapsed;
    this.body.classList.toggle('empty', count === 0);
  }

  private buildActions(
    id: string,
    count: number,
    downloadDisabled: boolean,
    locked: boolean
  ): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const download = iconButton('download', `Download all ${count} in this folder`);
    download.classList.add('folder-download');
    download.replaceChildren(downloadIcon());
    download.disabled = downloadDisabled || count === 0;
    download.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!download.disabled) this.handlers.onDownload(id);
    });

    const holdStill = 'Locked while its videos are downloading';
    const rename = iconButton('rename', locked ? holdStill : 'Rename folder');
    rename.disabled = locked;
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!rename.disabled) this.handlers.onStartRename(id);
    });

    const remove = iconButton('remove', locked
      ? holdStill
      : count === 0 ? 'Delete folder' : 'Delete folder and the videos in it');
    remove.classList.add('folder-delete');
    remove.disabled = locked;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!remove.disabled) this.handlers.onDelete(id);
    });

    actions.append(download, rename, remove);
    return actions;
  }

  private buildRenameForm(): HTMLElement {
    const form = document.createElement('div');
    form.className = 'rename-form folder-rename';
    form.addEventListener('click', (event) => event.stopPropagation());

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = this.state.name;
    input.maxLength = 60;
    input.setAttribute('aria-label', 'Folder name');
    input.dataset.focusId = 'folder-rename';

    const commit = (): void => this.handlers.onCommitRename(this.state.id, input.value);
    const confirm = iconButton('confirm', 'Save folder name');
    const cancel = iconButton('cancel', 'Cancel rename');
    confirm.addEventListener('click', (event) => { event.stopPropagation(); commit(); });
    cancel.addEventListener('click', (event) => { event.stopPropagation(); this.handlers.onCancelRename(); });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); this.handlers.onCancelRename(); }
    });

    form.append(input, confirm, cancel);
    queueMicrotask(() => {
      if (!input.isConnected || document.activeElement === input) return;
      if (this.el.contains(document.activeElement)) return;
      input.focus();
      input.select();
    });
    return form;
  }
}
