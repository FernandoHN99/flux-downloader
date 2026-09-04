import type { HistoryEntry } from '../../lib/types';
import { domainOf, videoKey } from '../../lib/video-key';
import { groupByDomain } from '../selectors';
import { Component } from './base';
import { VideoGroup } from './VideoGroup';
import { VideoRow, type VideoRowHandlers, type VideoRowState } from './VideoRow';

export interface VideoListState {
  entries: HistoryEntry[];
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
  }

  protected render(): void {
    this.el.replaceChildren();
    if (!this.state.grouped) {
      this.appendRows(this.el, this.state.entries);
      return;
    }

    for (const [domain, items] of groupByDomain(this.state.entries)) {
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
      (row.el.draggable ? movable : loose).push(row);
    }

    for (const row of loose) parent.appendChild(row.el);
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
      this.el.querySelectorAll('.reorder-zone.drop-target')
        .forEach((zone) => zone.classList.remove('drop-target'));
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
