import type { VideoFolder } from '../../shared/types';
import type { BatchQuality } from '../state';
import { Component } from './base';
import { FolderComposer } from './FolderComposer';
import { folderIcon, folderPlusIcon, iconButton } from './icons';

export interface ListHeaderState {
  selectionMode: boolean;
  renaming: boolean;
  selectedCount: number;
  /** Videos on screen: what "Select all" would pick. */
  visibleCount: number;
  /** Every video in the list, for the count beside the title. */
  totalCount: number;
  batchQuality: BatchQuality;
  downloadDisabled: boolean;
  search: string;
  folders: VideoFolder[];
  /** At least one picked video is in a folder, so it can be taken out. */
  canUnfile: boolean;
  /** The "move to folder" choices are open under the selection bar. */
  movingSelection: boolean;
  /** The new-folder form is open, with how many videos it will receive. */
  creatingFolder: { videoCount: number; unfiledCount: number } | null;
}

export interface ListHeaderHandlers {
  onQuality(quality: BatchQuality): void;
  onDownloadAll(): void;
  onSearch(value: string): void;
  /** Opens the new-folder form: with the picked videos while picking, else empty. */
  onNewFolder(): void;
  onSelectAll(): void;
  onExitSelection(): void;
  onDeleteSelected(): void;
  onToggleMoveSelection(): void;
  /** `folderId: null` takes the picked videos out of their folders. */
  onMoveSelectedTo(folderId: string | null): void;
  onCommitNewFolder(name: string): void;
  onCommitNewFolderWithUnfiled(name: string): void;
  onCancelNewFolder(): void;
}

/**
 * Everything above the list that does not scroll: the action bar, the
 * new-folder form, and the search box.
 *
 * Starting a flow narrows the bar to that flow. Picking rows swaps it for the
 * selection bar, naming a folder swaps it for the name field, and renaming a
 * row leaves none, so the only controls on screen belong to what the user is
 * doing. The form lives here, not in the list, because the list scrolls: after
 * picking forty rows, the field has to be where the user is looking.
 */
export class ListHeader extends Component<ListHeaderState> {
  constructor(state: ListHeaderState, private readonly handlers: ListHeaderHandlers) {
    // Just the bar and the search box: the list is a sibling, not a child,
    // so redrawing this cannot detach it.
    super({ className: 'history-head', state });
  }

  protected render(): void {
    const { selectionMode, renaming, creatingFolder } = this.state;
    this.el.replaceChildren();
    this.el.classList.toggle('selecting', selectionMode);

    if (creatingFolder) this.el.appendChild(this.buildComposer(creatingFolder));
    else if (selectionMode) this.el.appendChild(this.buildSelectionBar());
    else if (!renaming) this.el.appendChild(this.buildActionBar());
    else this.el.appendChild(this.buildTitleBar());

    if (selectionMode && !creatingFolder && this.state.movingSelection) {
      this.el.appendChild(this.buildMoveMenu());
    }
    this.el.appendChild(this.buildSearch());
  }

  /** The title with its count, alone while a rename holds the rest still. */
  private buildTitleBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'history-header';
    bar.appendChild(this.buildTitle());
    return bar;
  }

  private buildTitle(): HTMLElement {
    const title = document.createElement('span');
    title.className = 'history-label';
    title.textContent = 'Videos';
    if (this.state.totalCount > 0) {
      const count = document.createElement('span');
      count.className = 'history-count';
      count.textContent = String(this.state.totalCount);
      title.appendChild(count);
    }
    return title;
  }

  private buildActionBar(): HTMLElement {
    const { batchQuality, downloadDisabled } = this.state;
    const bar = this.buildTitleBar();
    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const newFolder = textButton('new-folder-btn', 'New folder', () => this.handlers.onNewFolder());
    newFolder.prepend(folderPlusIcon());
    newFolder.title = 'Create a folder to organise videos in';

    // One joined control: the quality belongs to the button beside it.
    const download = document.createElement('div');
    download.className = 'download-all';
    const downloadAll = document.createElement('button');
    downloadAll.id = 'download-all-btn';
    downloadAll.className = 'download-all-btn';
    downloadAll.textContent = 'Download all';
    downloadAll.disabled = downloadDisabled;
    downloadAll.addEventListener('click', () => this.handlers.onDownloadAll());
    download.append(this.buildQualityToggle(batchQuality), downloadAll);

    actions.append(newFolder, download);
    bar.appendChild(actions);
    return bar;
  }

  private buildSelectionBar(): HTMLElement {
    const { selectedCount, visibleCount, folders } = this.state;
    const bar = document.createElement('div');
    bar.className = 'history-header selection-bar';

    const lead = document.createElement('div');
    lead.className = 'selection-lead';
    const exit = iconButton('cancel', 'Cancel selection (Esc)');
    exit.id = 'exit-selection-btn';
    exit.addEventListener('click', () => this.handlers.onExitSelection());
    const count = document.createElement('span');
    count.className = 'selection-count';
    count.textContent = `${selectedCount} selected`;
    lead.append(exit, count);
    if (selectedCount < visibleCount) {
      lead.appendChild(textButton('select-all-btn', 'Select all', () => this.handlers.onSelectAll()));
    }
    bar.appendChild(lead);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const newFolder = textButton('new-folder-btn', 'New folder', () => this.handlers.onNewFolder());
    newFolder.classList.add('primary');
    newFolder.prepend(folderPlusIcon());
    newFolder.title = `Put the ${selectedCount} selected in a new folder`;
    actions.appendChild(newFolder);

    if (folders.length > 0) {
      const move = textButton('move-selected-btn', 'Move to…', () => this.handlers.onToggleMoveSelection());
      move.setAttribute('aria-expanded', String(this.state.movingSelection));
      actions.appendChild(move);
    }

    const remove = textButton('delete-selected-btn', 'Delete', () => this.handlers.onDeleteSelected());
    remove.classList.add('danger');
    remove.title = `Remove the ${selectedCount} selected from the list`;
    actions.appendChild(remove);

    bar.appendChild(actions);
    return bar;
  }

  /** Where the picked videos can go: each folder, or out of their folders. */
  private buildMoveMenu(): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'move-panel selection-move';
    menu.setAttribute('role', 'menu');

    const choice = (label: string, onPick: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = 'move-choice';
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.addEventListener('click', onPick);
      return button;
    };

    for (const folder of this.state.folders) {
      const item = choice(folder.name, () => this.handlers.onMoveSelectedTo(folder.id));
      item.prepend(folderIcon());
      menu.appendChild(item);
    }
    if (this.state.canUnfile) {
      menu.appendChild(choice('Remove from folder', () => this.handlers.onMoveSelectedTo(null)));
    }
    return menu;
  }

  private buildComposer(creating: NonNullable<ListHeaderState['creatingFolder']>): HTMLElement {
    const composer = new FolderComposer(creating, {
      onCommit: (name) => this.handlers.onCommitNewFolder(name),
      onCommitWithUnfiled: (name) => this.handlers.onCommitNewFolderWithUnfiled(name),
      onCancel: () => this.handlers.onCancelNewFolder()
    });
    composer.update();
    return composer.el;
  }

  private buildSearch(): HTMLInputElement {
    const field = document.createElement('input');
    field.type = 'search';
    field.id = 'history-search';
    field.className = 'history-search';
    field.placeholder = 'Search videos';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Search videos');
    field.value = this.state.search;
    // Typing here redraws the list, which redraws this header: without a
    // focus id the box would lose the caret on every keystroke.
    field.dataset.focusId = 'search';
    field.addEventListener('input', () => this.handlers.onSearch(field.value));
    return field;
  }

  private buildQualityToggle(active: BatchQuality): HTMLElement {
    const group = document.createElement('div');
    group.className = 'quality-toggle';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Quality for Download all');

    for (const [quality, label] of [['best', 'Best'], ['worst', 'Lowest']] as const) {
      const button = document.createElement('button');
      button.className = quality === active ? 'quality-badge selected' : 'quality-badge';
      button.dataset.quality = quality;
      button.textContent = label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(quality === active));
      button.addEventListener('click', () => this.handlers.onQuality(quality));
      group.appendChild(button);
    }
    return group;
  }
}

function textButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'btn-link';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
