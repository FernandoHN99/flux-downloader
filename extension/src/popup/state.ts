import type { HistoryEntry } from '../shared/types';
import type { BatchQuality, BatchStatus, ProgressDetail } from '../shared/popup-protocol';

export type { BatchQuality, BatchStatus, ProgressDetail } from '../shared/popup-protocol';

/**
 * Everything the background owns. Replaced wholesale when a message arrives,
 * so nothing here may be edited locally — that is what `UiState` is for.
 */
export interface RemoteState {
  history: HistoryEntry[];
  /** Videos any open tab is playing right now, by videoKey. */
  currentKeys: ReadonlySet<string>;
  batch: BatchStatus | null;
  /** Set while a one-off download is in flight. */
  manualDownloadKey: string | null;
  /** Its id, needed to cancel it. */
  manualDownloadId: string | null;
  /** The one video being written, whichever kind of run it belongs to. */
  activeDownloadKey: string | null;
  progress: ProgressDetail | null;
}

/**
 * Everything the user is doing in the popup. Kept apart from `RemoteState`
 * on purpose: a detection arriving mid-flow must never clear a selection, a
 * rename or an open panel.
 */
export interface UiState {
  search: string;
  refreshing: boolean;
  selectionMode: boolean;
  selectedForDeletion: ReadonlySet<string>;
  /** The one row showing its download options. */
  expandedKey: string | null;
  renamingKey: string | null;
  collapsedGroups: ReadonlySet<string>;
  draggingKey: string | null;
  batchQuality: BatchQuality;
  groupByDomain: boolean;
  /** Index into the expanded row's quality list. */
  selectedQualityIndex: number;
  status: { text: string; tone: 'info' | 'error' | 'success' };
  error: string | null;
}

export interface AppState {
  remote: RemoteState;
  ui: UiState;
}

export function initialState(): AppState {
  return {
    remote: {
      history: [],
      currentKeys: new Set(),
      batch: null,
      manualDownloadKey: null,
      manualDownloadId: null,
      activeDownloadKey: null,
      progress: null
    },
    ui: {
      search: '',
      refreshing: false,
      selectionMode: false,
      selectedForDeletion: new Set(),
      expandedKey: null,
      renamingKey: null,
      collapsedGroups: new Set(),
      draggingKey: null,
      batchQuality: 'best',
      groupByDomain: false,
      selectedQualityIndex: 0,
      status: { text: 'Checking for media…', tone: 'info' },
      error: null
    }
  };
}

type Listener = (state: AppState) => void;

/**
 * One store, two halves, one subscription. Components read the whole state
 * and redraw; nothing mutates the state object in place.
 */
export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private notifying = false;
  private restartNotify = false;

  constructor(state: AppState = initialState()) {
    this.state = state;
  }

  get(): AppState {
    return this.state;
  }

  setRemote(patch: Partial<RemoteState>): void {
    this.state = { ...this.state, remote: { ...this.state.remote, ...patch } };
    this.notify();
  }

  setUi(patch: Partial<UiState>): void {
    this.state = { ...this.state, ui: { ...this.state.ui, ...patch } };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    // A listener that sets state again must not recurse, but its change still
    // has to reach everyone: coalesce it into another pass once this one ends.
    if (this.notifying) {
      this.restartNotify = true;
      return;
    }
    this.notifying = true;
    try {
      do {
        this.restartNotify = false;
        const snapshot = this.state;
        for (const listener of [...this.listeners]) listener(snapshot);
      } while (this.restartNotify);
    } finally {
      this.notifying = false;
      this.restartNotify = false;
    }
  }
}
