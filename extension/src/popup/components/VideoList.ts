import type { HistoryEntry, VideoFolder } from '../../shared/types';
import { domainOf, videoKey } from '../../detection/video-key';
import { groupByDomain, splitByFolder } from '../selectors';
import { Component } from './base';
import { FolderComposer } from './FolderComposer';
import { FolderGroup } from './FolderGroup';
import { VideoGroup } from './VideoGroup';
import { VideoRow, type VideoRowHandlers, type VideoRowState } from './VideoRow';

export interface VideoListState {
  entries: HistoryEntry[];
  folders: VideoFolder[];
  /** A search is active, so folders without a match are left out. */
  searching: boolean;
  collapsedFolders: ReadonlySet<string>;
  renamingFolderId: string | null;
  /** The new-folder form is open, with how many videos it will receive. */
  creatingFolder: { keys: string[] } | null;
  /** Videos in no folder, offered to the new-folder form as one click. */
  unfiledCount: number;
  grouped: boolean;
  collapsedGroups: ReadonlySet<string>;
  downloadDisabled: boolean;
  /** Everything a row needs that the list itself does not decide. */
  rowState(entry: HistoryEntry): Omit<VideoRowState, 'entry'>;
}

export interface VideoListHandlers extends VideoRowHandlers {
  onReorder(keys: string[]): void;
  onToggleGroup(domain: string): void;
  onDownloadGroup(domain: string): void;
  onToggleFolder(id: string): void;
  onDownloadFolder(id: string): void;
  onStartRenameFolder(id: string): void;
  onCommitRenameFolder(id: string, name: string): void;
  onCancelRenameFolder(): void;
  onDeleteFolder(id: string): void;
  onCommitNewFolder(name: string): void;
  onCommitNewFolderWithUnfiled(name: string): void;
  onCancelNewFolder(): void;
  /** A dragged row was dropped on a folder, or (null) back on the main list. */
  onDropToFolder(keys: string[], folderId: string | null): void;
}

/**
 * The list, flat or foldered.
 *
 * Rows that can be reordered live inside a `.reorder-zone`; pinned and busy
 * rows sit outside it. That is what keeps a dragged row from landing above
 * the current videos, confines a drop to its own site's folder, and stops the
 * dashed outline from wrapping rows that were never going to move — all of
 * which used to be enforced by filtering inside the pointer maths.
 */
export class VideoList extends Component<VideoListState> {
  private draggingKey: string | null = null;

  constructor(state: VideoListState, private readonly handlers: VideoListHandlers) {
    super({ className: 'video-list', state });
    this.el.id = 'history-list';
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Detected media');
    this.attachUnfileTarget();
  }

  protected render(): void {
    this.el.replaceChildren();
    const { creatingFolder, folders, searching } = this.state;

    if (creatingFolder) {
      const composer = new FolderComposer(
        { videoCount: creatingFolder.keys.length, unfiledCount: this.state.unfiledCount },
        {
          onCommit: (name) => this.handlers.onCommitNewFolder(name),
          onCommitWithUnfiled: (name) => this.handlers.onCommitNewFolderWithUnfiled(name),
          onCancel: () => this.handlers.onCancelNewFolder()
        }
      );
      composer.update();
      this.el.appendChild(composer.el);
    }

    // The user's folders come first, then whatever is not filed anywhere.
    const split = splitByFolder(this.state.entries, folders, searching);
    for (const { folder, entries } of split.sections) this.appendFolder(folder, entries);
    this.appendUnfiled(split.unfiled);
  }

  private appendFolder(folder: VideoFolder, entries: HistoryEntry[]): void {
    const collapsed = this.state.collapsedFolders.has(folder.id);
    const group = new FolderGroup(
      {
        id: folder.id,
        name: folder.name,
        count: entries.length,
        collapsed,
        renaming: this.state.renamingFolderId === folder.id,
        downloadDisabled: this.state.downloadDisabled
      },
      {
        onToggle: (id) => this.handlers.onToggleFolder(id),
        onDownload: (id) => this.handlers.onDownloadFolder(id),
        onStartRename: (id) => this.handlers.onStartRenameFolder(id),
        onCommitRename: (id, name) => this.handlers.onCommitRenameFolder(id, name),
        onCancelRename: () => this.handlers.onCancelRenameFolder(),
        onDelete: (id) => this.handlers.onDeleteFolder(id)
      }
    );
    group.update();
    if (!collapsed) this.appendFolderRows(group.body, entries);
    this.attachFolderTarget(group.el, folder.id);
    this.el.appendChild(group.el);
  }

  /**
   * Rows inside a folder are not reorderable, so there is no drop zone here:
   * they only ever leave it, for another folder or for the main list. The
   * rows that can be dragged (not playing now, not downloading) still are.
   */
  private appendFolderRows(parent: HTMLElement, entries: HistoryEntry[]): void {
    for (const entry of entries) {
      const row = new VideoRow({ entry, ...this.state.rowState(entry) }, this.handlers);
      row.update();
      if (row.el.draggable) this.attachDrag(row.el);
      parent.appendChild(row.el);
    }
  }

  private appendUnfiled(entries: HistoryEntry[]): void {
    if (!this.state.grouped) {
      this.appendRows(this.el, entries);
      return;
    }

    for (const [domain, items] of groupByDomain(entries)) {
      const collapsed = this.state.collapsedGroups.has(domain);
      const group = new VideoGroup(
        {
          domain,
          count: items.length,
          pageUrl: items[0]?.pageUrl || `https://${domain}/`,
          collapsed,
          downloadDisabled: this.state.downloadDisabled
        },
        {
          onToggle: (d) => this.handlers.onToggleGroup(d),
          onDownloadAll: (d) => this.handlers.onDownloadGroup(d)
        }
      );
      group.update();
      if (!collapsed) this.appendRows(group.body, items);
      this.el.appendChild(group.el);
    }
  }

  /** Pinned rows loose at the top, the rest inside a drop zone below them. */
  private appendRows(parent: HTMLElement, entries: HistoryEntry[]): void {
    const loose: VideoRow[] = [];
    const movable: VideoRow[] = [];

    for (const entry of entries) {
      const rowState = this.state.rowState(entry);
      const row = new VideoRow({ entry, ...rowState }, this.handlers);
      row.update();
      (row.el.dataset.reorderable === 'true' ? movable : loose).push(row);
    }

    // Pinned rows sit outside every zone, but one that can be dragged still
    // needs its handlers: it can be dropped on a folder.
    for (const row of loose) {
      if (row.el.draggable) this.attachDrag(row.el);
      parent.appendChild(row.el);
    }
    if (movable.length === 0) return;

    const zone = document.createElement('div');
    zone.className = 'reorder-zone';
    for (const row of movable) {
      this.attachDrag(row.el);
      zone.appendChild(row.el);
    }
    this.attachDropZone(zone);
    parent.appendChild(zone);
  }

  private attachDrag(row: HTMLElement): void {
    row.addEventListener('dragstart', (event) => {
      this.draggingKey = row.dataset.key || null;
      row.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', this.draggingKey || '');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      this.draggingKey = null;
      this.el.querySelectorAll('.drop-target')
        .forEach((target) => target.classList.remove('drop-target'));
      this.el.classList.remove('unfile-target');
    });
  }

  /** The row being dragged, if it is one of ours. */
  private draggedRow(): HTMLElement | null {
    return this.draggingKey ? this.el.querySelector<HTMLElement>('.media-item.dragging') : null;
  }

  /** A folder takes any dragged row that is not already inside it. */
  private attachFolderTarget(group: HTMLElement, folderId: string): void {
    const accept = (event: DragEvent): HTMLElement | null => {
      const dragged = this.draggedRow();
      if (!dragged) return null;
      // The list itself also listens, for rows being taken out of a folder.
      // Anything over a folder is the folder's to handle, including a row
      // dropped back where it already is, which must not leave the folder.
      event.stopPropagation();
      event.preventDefault();
      if (dragged.dataset.folder === folderId) return null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return dragged;
    };

    group.addEventListener('dragover', (event) => {
      if (accept(event)) group.classList.add('drop-target');
    });
    group.addEventListener('dragleave', (event) => {
      if (!group.contains(event.relatedTarget as Node)) group.classList.remove('drop-target');
    });
    group.addEventListener('drop', (event) => {
      const dragged = accept(event);
      group.classList.remove('drop-target');
      if (dragged?.dataset.key) this.handlers.onDropToFolder([dragged.dataset.key], folderId);
    });
  }

  /** Dropping a filed row on the main list takes it back out of its folder. */
  private attachUnfileTarget(): void {
    const accept = (event: DragEvent): HTMLElement | null => {
      const dragged = this.draggedRow();
      if (!dragged || !dragged.dataset.folder) return null;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return dragged;
    };

    this.el.addEventListener('dragover', (event) => {
      if (accept(event)) this.el.classList.add('unfile-target');
    });
    this.el.addEventListener('dragleave', (event) => {
      if (!this.el.contains(event.relatedTarget as Node)) this.el.classList.remove('unfile-target');
    });
    this.el.addEventListener('drop', (event) => {
      const dragged = accept(event);
      this.el.classList.remove('unfile-target');
      if (dragged?.dataset.key) this.handlers.onDropToFolder([dragged.dataset.key], null);
    });
  }

  private attachDropZone(zone: HTMLElement): void {
    // A zone accepts only the rows it already holds, which is what keeps a
    // video from being dragged into another site's folder.
    const accept = (event: DragEvent): HTMLElement | null => {
      const dragged = this.el.querySelector<HTMLElement>('.dragging');
      if (!this.draggingKey || !dragged || dragged.parentElement !== zone) return null;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return dragged;
    };

    zone.addEventListener('dragover', (event) => {
      const dragged = accept(event);
      if (!dragged) return;
      zone.classList.add('drop-target');
      const after = rowAfterPointer(zone, event.clientY);
      if (after !== dragged) zone.insertBefore(dragged, after);
    });

    zone.addEventListener('dragleave', (event) => {
      if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove('drop-target');
    });

    zone.addEventListener('drop', (event) => {
      if (!accept(event)) return;
      zone.classList.remove('drop-target');
      // The stored order is one flat list, so report every row on screen.
      const keys = [...this.el.querySelectorAll<HTMLElement>('.media-item')]
        .map((row) => row.dataset.key)
        .filter((key): key is string => Boolean(key));
      this.handlers.onReorder(keys);
    });
  }
}

/** The first row in this zone whose midpoint is below the pointer. */
export function rowAfterPointer(zone: HTMLElement, clientY: number): HTMLElement | null {
  for (const child of zone.children) {
    const row = child as HTMLElement;
    if (!row.classList.contains('media-item') || row.classList.contains('dragging')) continue;
    const box = row.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return row;
  }
  return null;
}

/** The videos in one site's folder, in the order the list shows them. */
export function entriesForDomain(entries: HistoryEntry[], domain: string): HistoryEntry[] {
  return entries.filter((entry) => domainOf(entry.pageUrl, entry.url) === domain);
}

export { videoKey };
