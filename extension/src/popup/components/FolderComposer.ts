import { Component } from './base';
import { folderIcon, iconButton } from './icons';

export interface FolderComposerState {
  /** How many videos will be filed into the new folder; 0 makes it empty. */
  videoCount: number;
  /** Videos in no folder at all: what "add every loose video" would take. */
  unfiledCount: number;
}

export interface FolderComposerHandlers {
  onCommit(name: string): void;
  /** Create the folder and file every video that is in no folder into it. */
  onCommitWithUnfiled(name: string): void;
  onCancel(): void;
}

/** The one-line form for naming a new folder. */
export class FolderComposer extends Component<FolderComposerState> {
  constructor(state: FolderComposerState, private readonly handlers: FolderComposerHandlers) {
    super({ className: 'folder-composer', state });
  }

  protected render(): void {
    this.el.replaceChildren(folderIcon());

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.maxLength = 60;
    input.placeholder = this.state.videoCount > 0
      ? `Name the folder for ${this.state.videoCount} video${this.state.videoCount === 1 ? '' : 's'}`
      : 'Folder name';
    input.setAttribute('aria-label', 'New folder name');
    input.dataset.focusId = 'new-folder';

    const commit = (): void => this.handlers.onCommit(input.value);
    const confirm = iconButton('confirm', 'Create folder');
    const cancel = iconButton('cancel', 'Cancel');
    confirm.addEventListener('click', commit);
    cancel.addEventListener('click', () => this.handlers.onCancel());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); this.handlers.onCancel(); }
    });

    this.el.append(input, confirm, cancel);

    // A second way to finish: take every loose video along. Offered only when
    // there is something loose to take.
    if (this.state.unfiledCount > 0) {
      const all = document.createElement('button');
      all.className = 'folder-add-all';
      const count = this.state.unfiledCount;
      all.textContent = `Create with all ${count} video${count === 1 ? '' : 's'} not in a folder`;
      all.addEventListener('click', () => this.handlers.onCommitWithUnfiled(input.value));
      this.el.appendChild(all);
    }

    queueMicrotask(() => {
      if (input.isConnected && !this.el.contains(document.activeElement)) input.focus();
    });
  }
}
