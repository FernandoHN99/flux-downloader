import type { HistoryEntry, VideoFolder } from '../../shared/types';
import { videoKey } from '../../detection/video-key';
import { formatLength, getTypeLabel } from '../format';
import type { QualityOption } from '../quality';
import { Component } from './base';
import { badge, dragHandle, iconButton, playIcon, selectDot, spinner } from './icons';
import { QualityPanel } from './QualityPanel';

export interface VideoRowState {
  entry: HistoryEntry;
  isCurrent: boolean;
  isBusy: boolean;
  /** What a busy row says: a percentage, or that it is waiting its turn. */
  busyLabel: string;
  selectionMode: boolean;
  isPicked: boolean;
  isExpanded: boolean;
  isRenaming: boolean;
  downloadDisabled: boolean;
  selectedQualityIndex: number;
  /** Can be filed into a folder: any row that is not mid-download or being picked. */
  canMove: boolean;
  /** Showing its "move to folder" choices. */
  isMoving: boolean;
  folders: VideoFolder[];
}

export interface VideoRowHandlers {
  onActivate(key: string): void;
  onStartRename(key: string): void;
  onCommitRename(key: string, title: string): void;
  onCancelRename(): void;
  onTrash(key: string): void;
  onSelectQuality(index: number): void;
  onDownload(option: QualityOption): void;
  onToggleMove(key: string): void;
  /** `folderId: null` takes the video back out of its folder. */
  onMoveToFolder(key: string, folderId: string | null): void;
  onNewFolderFor(key: string): void;
}

/**
 * One video in the list: a header line, and — when it is the open one — its
 * download options underneath.
 *
 * Starting a flow narrows the row to that flow. Renaming leaves only the
 * confirm and cancel controls; picking rows to delete leaves only the tick.
 * Both used to be enforced from a stylesheet, where one rule silently got the
 * wrong body and stopped hiding anything.
 */
export class VideoRow extends Component<VideoRowState> {
  private panel: QualityPanel | null = null;

  constructor(state: VideoRowState, private readonly handlers: VideoRowHandlers) {
    super({ className: 'media-item media-item-history', state });
    this.el.setAttribute('role', 'option');
    this.el.tabIndex = 0;
    this.el.addEventListener('click', () => this.activate());
    this.el.addEventListener('keydown', (event) => {
      if (event.target !== this.el) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.activate();
    });
  }

  get key(): string {
    return videoKey(this.state.entry.url);
  }

  private activate(): void {
    if (this.state.isBusy && !this.state.selectionMode) return;
    this.handlers.onActivate(this.key);
  }

  protected render(): void {
    const { entry, isCurrent, isBusy, selectionMode, isPicked, isExpanded, isRenaming } = this.state;

    this.el.dataset.key = this.key;
    if (entry.folderId) this.el.dataset.folder = entry.folderId;
    else delete this.el.dataset.folder;
    this.el.classList.toggle('media-item-current-page', isCurrent);
    this.el.classList.toggle('busy', isBusy);
    this.el.classList.toggle('picked', selectionMode && isPicked);
    this.el.classList.toggle('expanded', isExpanded);
    this.el.classList.toggle('selected', isExpanded);
    this.el.classList.toggle('editing', isRenaming);
    this.el.setAttribute('aria-selected', String(isExpanded));
    // Busy rows hold still, and so does the whole list while picking. The video
    // playing now can be dragged — into a folder — but stays pinned: it is not
    // reorderable, so the list keeps it out of every reorder zone.
    this.el.draggable = !isBusy && !selectionMode && !isRenaming;
    this.el.dataset.reorderable = String(this.el.draggable && !isCurrent);
    if (entry.pageUrl) this.el.title = entry.pageUrl;

    this.el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'media-head';
    this.el.appendChild(head);

    if (selectionMode) head.appendChild(selectDot(isPicked));
    else if (this.el.draggable) head.appendChild(dragHandle(isCurrent));

    head.appendChild(this.buildThumbnail());
    head.appendChild(isRenaming ? this.buildRenameForm() : this.buildInfo());

    if (isRenaming) return;

    if (isBusy) head.appendChild(spinner());
    else if (!selectionMode) head.appendChild(this.buildActions());

    // Last, so it sits against the row's right edge rather than riding along
    // with the title.
    if (isCurrent) {
      head.appendChild(badge('current-badge', 'current', 'Detected on the page you have open'));
    }

    if (this.state.isMoving && this.state.canMove && !selectionMode && !isBusy) {
      this.el.appendChild(this.buildMovePanel());
    }

    if (isExpanded && !selectionMode && !isBusy) {
      this.panel = new QualityPanel(
        {
          video: entry,
          selectedIndex: this.state.selectedQualityIndex,
          downloadDisabled: this.state.downloadDisabled
        },
        {
          onSelect: (index) => this.handlers.onSelectQuality(index),
          onDownload: (option) => this.handlers.onDownload(option)
        }
      );
      this.panel.update();
      this.el.appendChild(this.panel.el);
    } else {
      this.panel = null;
    }
  }

  private buildThumbnail(): HTMLElement {
    const { entry } = this.state;
    if (!entry.thumbnail) return playIcon('media-icon');

    const wrapper = document.createElement('div');
    wrapper.className = 'media-thumbnail-wrapper';
    const image = document.createElement('img');
    image.className = 'media-thumbnail';
    image.alt = '';
    image.src = entry.thumbnail;
    image.addEventListener('error', () => {
      wrapper.replaceChildren(playIcon('media-icon'));
    });
    wrapper.appendChild(image);
    return wrapper;
  }

  private buildInfo(): HTMLElement {
    const { entry, isBusy, busyLabel } = this.state;
    const info = document.createElement('div');
    info.className = 'media-info';

    const title = document.createElement('div');
    title.className = 'media-title media-title-row';
    const text = document.createElement('span');
    text.className = 'media-title-text';
    text.textContent = entry.title || 'Unknown Video';
    title.appendChild(text);
    if (entry.failed && !isBusy) {
      title.appendChild(badge('failed-badge', 'error', 'Last download failed'));
    }
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'media-meta';
    meta.textContent = isBusy ? busyLabel : [
      getTypeLabel(entry.type),
      // The length, not when it was detected: it is what tells one lesson from
      // the next at a glance.
      entry.duration ? formatLength(entry.duration) : ''
    ].filter(Boolean).join(' · ');
    info.appendChild(meta);

    return info;
  }

  private buildRenameForm(): HTMLElement {
    const info = document.createElement('div');
    info.className = 'media-info';

    const form = document.createElement('div');
    form.className = 'rename-form';
    form.addEventListener('click', (event) => event.stopPropagation());

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = this.state.entry.title || '';
    input.setAttribute('aria-label', 'New title');
    // Survives the redraws that detections arriving mid-rename cause.
    input.dataset.focusId = 'rename';

    const commit = (): void => this.handlers.onCommitRename(this.key, input.value.trim());
    const confirm = iconButton('confirm', 'Save title');
    const cancel = iconButton('cancel', 'Cancel rename');
    confirm.addEventListener('click', (event) => { event.stopPropagation(); commit(); });
    cancel.addEventListener('click', (event) => { event.stopPropagation(); this.handlers.onCancelRename(); });

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); this.handlers.onCancelRename(); }
    });

    form.append(input, confirm, cancel);
    info.appendChild(form);

    // Focus only on the first paint; afterwards the base class carries it.
    queueMicrotask(() => {
      if (!input.isConnected || document.activeElement === input) return;
      if (this.el.contains(document.activeElement)) return;
      input.focus();
      input.select();
    });

    return info;
  }

  /** Where this video can go: each folder, out of its folder, or a new one. */
  private buildMovePanel(): HTMLElement {
    const { entry, folders } = this.state;
    const panel = document.createElement('div');
    panel.className = 'move-panel';
    panel.setAttribute('role', 'menu');
    panel.addEventListener('click', (event) => event.stopPropagation());

    const choice = (label: string, onPick: () => void, current = false): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = current ? 'move-choice current' : 'move-choice';
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.disabled = current;
      button.addEventListener('click', onPick);
      return button;
    };

    for (const folder of folders) {
      panel.appendChild(choice(
        folder.name,
        () => this.handlers.onMoveToFolder(this.key, folder.id),
        entry.folderId === folder.id
      ));
    }
    if (entry.folderId) {
      panel.appendChild(choice('Remove from folder', () => this.handlers.onMoveToFolder(this.key, null)));
    }
    const create = choice('New folder…', () => this.handlers.onNewFolderFor(this.key));
    create.classList.add('move-new');
    panel.appendChild(create);
    return panel;
  }

  private buildActions(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'media-actions';

    if (this.state.canMove) {
      const move = iconButton('folderPlus', 'Move to folder');
      move.classList.add('move-btn');
      move.setAttribute('aria-expanded', String(this.state.isMoving));
      move.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onToggleMove(this.key);
      });
      actions.appendChild(move);
    }

    const rename = iconButton('rename', 'Rename');
    rename.classList.add('rename-btn');
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onStartRename(this.key);
    });

    const remove = iconButton('remove', 'Select to delete');
    remove.classList.add('remove-btn');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onTrash(this.key);
    });

    actions.append(rename, remove);
    return actions;
  }
}
