import type { BatchQuality } from '../state';
import { Component } from './base';

export interface ListHeaderState {
  selectionMode: boolean;
  renaming: boolean;
  selectedCount: number;
  batchQuality: BatchQuality;
  downloadDisabled: boolean;
  search: string;
}

export interface ListHeaderHandlers {
  onQuality(quality: BatchQuality): void;
  onDownloadAll(): void;
  onClearAll(): void;
  onClearSelected(): void;
  onSearch(value: string): void;
}

/**
 * The row of actions above the list, plus the search box.
 *
 * Starting a flow narrows it to that flow: picking rows leaves only the two
 * clear buttons, and renaming leaves none, so the only controls on screen
 * belong to what the user is doing.
 */
export class ListHeader extends Component<ListHeaderState> {
  constructor(state: ListHeaderState, private readonly handlers: ListHeaderHandlers) {
    super({ className: 'history-section', state });
    this.el.id = 'history-section';
  }

  protected render(): void {
    const { selectionMode, renaming, selectedCount, batchQuality, downloadDisabled, search } = this.state;
    this.el.replaceChildren();

    const bar = document.createElement('div');
    bar.className = 'history-header';

    const title = document.createElement('span');
    title.className = 'history-label';
    title.textContent = 'Videos';
    bar.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    bar.appendChild(actions);

    if (selectionMode) {
      const clearAll = linkButton('clear-all-btn', 'Clear All', () => this.handlers.onClearAll());
      clearAll.classList.add('danger-solid');
      const clearSelected = linkButton('clear-selected-btn', `Clear (${selectedCount})`,
        () => this.handlers.onClearSelected());
      clearSelected.classList.add('danger');
      actions.append(clearAll, clearSelected);
    } else if (!renaming) {
      actions.append(this.buildQualityToggle(batchQuality));
      const downloadAll = linkButton('download-all-btn', 'Download all', () => this.handlers.onDownloadAll());
      downloadAll.disabled = downloadDisabled;
      actions.appendChild(downloadAll);
    }

    const field = document.createElement('input');
    field.type = 'search';
    field.id = 'history-search';
    field.className = 'history-search';
    field.placeholder = 'Search';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.setAttribute('aria-label', 'Search videos');
    field.value = search;
    // Typing here redraws the list, which redraws this header: without a
    // focus id the box would lose the caret on every keystroke.
    field.dataset.focusId = 'search';
    field.addEventListener('input', () => this.handlers.onSearch(field.value));

    this.el.append(bar, field);
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

function linkButton(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'btn-link';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
