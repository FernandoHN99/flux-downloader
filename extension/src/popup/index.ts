import { loadSettings, updateSetting } from '../shared/settings';
import { initTheme } from '../shared/theme';
import type { HistoryEntry } from '../shared/types';
import { videoKey } from '../detection/video-key';
import { ListHeader } from './components/ListHeader';
import { ProgressPanel } from './components/ProgressPanel';
import { RefreshButton } from './components/RefreshButton';
import { VideoList } from './components/VideoList';
import { entriesForDomain } from './components/VideoList';
import type { RowModifiers, VideoRowState } from './components/VideoRow';
import { loadCollapsedFolders, saveCollapsedFolders } from './collapsed-folders';
import { applyIncoming } from './incoming';
import { Messenger } from './messages';
import type { QualityOption } from './quality';
import {
  busyLabel, canMoveToFolder, displayOrder, downloadInProgress, isCurrent, isDownloading,
  keysBetween, orderedEntries, progressDetail, progressView, unfiledEntries, visibleEntries
} from './selectors';
import { Store, type AppState, type BatchQuality } from './state';

/**
 * The popup shell: it owns the store, the port, and the three components the
 * page is made of. Everything it does is either "send a message" or "patch
 * the ui half of the state" — no component reaches for the DOM outside
 * itself, and no message writes to `ui`.
 */
class App {
  private readonly store = new Store();
  private readonly messenger = new Messenger((message) => applyIncoming(this.store, message));
  private activeTabId: number | null = null;

  private readonly header: ListHeader;
  private readonly progress: ProgressPanel;
  private readonly refresh: RefreshButton;
  private readonly list: VideoList;

  constructor(private readonly root: {
    section: HTMLElement; progress: HTMLElement; refresh: HTMLElement;
    empty: HTMLElement; status: HTMLElement; error: HTMLElement;
  }) {
    this.progress = new ProgressPanel({ view: null, detail: null }, () => this.stop());
    this.refresh = new RefreshButton({ refreshing: false }, () => this.refreshTabs());

    this.header = new ListHeader(
      { selectionMode: false, renaming: false, selectedCount: 0, visibleCount: 0, totalCount: 0,
        batchQuality: 'best', downloadDisabled: false, search: '', folders: [], canUnfile: false,
        movingSelection: false, creatingFolder: null },
      {
        onQuality: (quality) => this.setBatchQuality(quality),
        onDownloadAll: () => this.downloadAll(visibleEntries(this.store.get())),
        onSearch: (search) => this.store.setUi({ search }),
        onNewFolder: () => this.openNewFolder(),
        onSelectAll: () => this.selectAll(),
        onExitSelection: () => this.exitSelection(),
        onDeleteSelected: () => this.deleteSelected(),
        onToggleMoveSelection: () => this.store.setUi({
          movingSelection: !this.store.get().ui.movingSelection
        }),
        onMoveSelectedTo: (folderId) => this.moveSelectedTo(folderId),
        onCommitNewFolder: (name) => this.commitNewFolder(name),
        onCommitNewFolderWithUnfiled: (name) => this.commitNewFolder(name, true),
        onCancelNewFolder: () => this.store.setUi({ creatingFolder: null })
      }
    );

    this.list = new VideoList(
      { entries: [], folders: [], searching: false, collapsedFolders: new Set(),
        renamingFolderId: null, rangeAnchor: null, grouped: false, collapsedGroups: new Set(),
        downloadDisabled: false, rowState: (entry) => this.rowState(entry) },
      {
        onActivate: (key, modifiers) => this.activate(key, modifiers),
        onStartRename: (key) => this.store.setUi({ renamingKey: key, expandedKey: null }),
        onCommitRename: (key, title) => this.commitRename(key, title),
        onCancelRename: () => this.store.setUi({ renamingKey: null }),
        onSelect: (key) => this.enterSelection(key),
        onSelectQuality: (index) => this.store.setUi({ selectedQualityIndex: index }),
        onDownload: (option) => this.download(option),
        onReorder: (keys) => this.messenger.send({ type: 'REORDER_HISTORY', keys }),
        onToggleGroup: (domain) => this.toggleGroup(domain),
        onDownloadGroup: (domain) => this.downloadGroup(domain),
        onToggleMove: (key) => this.toggleMove(key),
        onMoveToFolder: (key, folderId) => this.moveToFolder([key], folderId),
        onNewFolderFor: (key) => this.store.setUi({
          creatingFolder: { keys: [key] }, movingKey: null, renamingFolderId: null
        }),
        onToggleFolder: (id) => this.toggleFolder(id),
        onDownloadFolder: (id) => this.downloadFolder(id),
        onStartRenameFolder: (id) => this.store.setUi({
          renamingFolderId: id, creatingFolder: null, movingKey: null
        }),
        onCommitRenameFolder: (id, name) => this.commitRenameFolder(id, name),
        onCancelRenameFolder: () => this.store.setUi({ renamingFolderId: null }),
        onDeleteFolder: (id) => this.deleteFolder(id),
        onDropToFolder: (keys, folderId) => this.moveToFolder(keys, folderId)
      }
    );
  }

  async start(): Promise<void> {
    initTheme();
    this.mount();
    this.store.subscribe((state) => this.render(state));
    this.messenger.connect();

    this.activeTabId = await activeTab();
    const settings = await loadSettings().catch(() => null);
    if (settings) {
      this.store.setUi({
        batchQuality: settings.batchQuality,
        groupByDomain: settings.groupByDomain
      });
    }

    // Before the first render, so a folder the user closed never flashes open.
    this.store.setUi({ collapsedFolders: await loadCollapsedFolders() });

    this.messenger.send({ type: 'GET_HISTORY' });
    this.messenger.send({ type: 'GET_BATCH_STATUS' });
    // Always asked for: it is what marks the current rows, and skipping it
    // during a download is how they used to go missing.
    this.messenger.send({ type: 'GET_MEDIA', tabId: this.activeTabId });
    if (this.activeTabId !== null) {
      this.messenger.send({ type: 'GET_ACTIVE_DOWNLOAD', tabId: this.activeTabId });
    }
    this.render(this.store.get());
  }

  private mount(): void {
    this.root.progress.replaceWith(this.progress.el);
    this.root.refresh.replaceWith(this.refresh.el);
    this.root.section.append(this.header.el, this.list.el);

    document.getElementById('settings-btn')?.addEventListener('click', () => {
      window.location.href = 'settings.html';
    });
    document.getElementById('error-dismiss')?.addEventListener('click', () => {
      this.store.setUi({ error: null });
    });
    // Esc backs out one step: the name field first, then the picking itself.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) return;
      const { ui } = this.store.get();
      if (ui.creatingFolder) this.store.setUi({ creatingFolder: null });
      else if (ui.selectionMode) this.exitSelection();
    });
  }

  private render(state: AppState): void {
    const entries = visibleEntries(state);
    const blocked = downloadInProgress(state);

    this.progress.setState({ view: progressView(state), detail: progressDetail(state) });
    this.refresh.setState({ refreshing: state.ui.refreshing });

    const { ui, remote } = state;
    this.header.setState({
      selectionMode: ui.selectionMode,
      renaming: ui.renamingKey !== null,
      selectedCount: ui.selected.size,
      visibleCount: ui.selectionMode ? displayOrder(state).length : entries.length,
      totalCount: orderedEntries(state).length,
      batchQuality: ui.batchQuality,
      downloadDisabled: blocked,
      search: ui.search,
      folders: remote.folders,
      canUnfile: ui.selectionMode && entries.some((entry) =>
        Boolean(entry.folderId) && ui.selected.has(videoKey(entry.url))),
      movingSelection: ui.movingSelection,
      creatingFolder: ui.creatingFolder ? {
        videoCount: ui.creatingFolder.keys.length,
        // Someone who picked their videos has already chosen which ones.
        unfiledCount: ui.selectionMode ? 0 : unfiledEntries(state).length
      } : null
    });

    this.list.setState({
      entries,
      folders: state.remote.folders,
      searching: state.ui.search.trim() !== '',
      collapsedFolders: state.ui.collapsedFolders,
      renamingFolderId: state.ui.renamingFolderId,
      rangeAnchor: state.ui.selectionAnchor ?? state.ui.expandedKey,
      grouped: state.ui.groupByDomain,
      collapsedGroups: state.ui.collapsedGroups,
      downloadDisabled: blocked || state.ui.selectionMode,
      rowState: (entry) => this.rowState(entry)
    });
    // Folders the user made stay on screen even before any video is filed.
    const empty = state.remote.history.length === 0 && state.remote.folders.length === 0
      && state.ui.creatingFolder === null;
    this.root.empty.classList.toggle('hidden', !empty);
    this.root.section.classList.toggle('hidden', empty);

    this.root.status.className = `status-bar ${state.ui.status.tone}`;
    this.root.status.textContent = state.ui.status.text;

    this.root.error.classList.toggle('hidden', state.ui.error === null);
    const message = this.root.error.querySelector('#error-message');
    if (message) message.textContent = state.ui.error ?? '';
  }

  private rowState(entry: HistoryEntry): Omit<VideoRowState, 'entry'> {
    const state = this.store.get();
    const key = videoKey(entry.url);
    return {
      isCurrent: isCurrent(state, key),
      isBusy: isDownloading(state, key),
      busyLabel: busyLabel(state, key),
      selectionMode: state.ui.selectionMode,
      isPicked: state.ui.selected.has(key),
      isExpanded: state.ui.expandedKey === key,
      isRenaming: state.ui.renamingKey === key,
      downloadDisabled: downloadInProgress(state),
      selectedQualityIndex: state.ui.selectedQualityIndex,
      canMove: canMoveToFolder(state, key),
      isMoving: state.ui.movingKey === key,
      folders: state.remote.folders
    };
  }

  // --- intents ---

  private refreshTabs(): void {
    if (this.store.get().ui.refreshing) return;
    this.store.setUi({
      refreshing: true,
      status: { text: 'Refreshing all open tabs…', tone: 'info' }
    });
    if (this.messenger.send({ type: 'REFRESH_TABS' })) return;
    this.store.setUi({
      refreshing: false,
      status: { text: 'Could not reach the background service', tone: 'error' }
    });
  }

  /**
   * A click on a row. Shift picks everything from the last row picked (or
   * opened) to this one; Ctrl/Cmd, or any click while picking, flips this row;
   * a plain click otherwise opens or closes it.
   */
  private activate(key: string, modifiers: RowModifiers): void {
    const { ui } = this.store.get();
    if (modifiers.range) return this.selectRange(key);
    if (modifiers.toggle || ui.selectionMode) return this.toggleSelection(key);
    this.store.setUi({
      expandedKey: ui.expandedKey === key ? null : key,
      selectedQualityIndex: 0,
      movingKey: null
    });
  }

  private toggleMove(key: string): void {
    const { ui } = this.store.get();
    this.store.setUi({
      movingKey: ui.movingKey === key ? null : key,
      expandedKey: null
    });
  }

  /** Files videos into a folder, or (null) back out of one. */
  private moveToFolder(keys: string[], folderId: string | null): void {
    if (keys.length === 0) return;
    this.messenger.send({ type: 'MOVE_TO_FOLDER', keys, folderId });
    this.store.setUi({ movingKey: null });
  }

  /** Opens the new-folder form, for the picked videos if some are picked. */
  private openNewFolder(): void {
    const { ui } = this.store.get();
    this.store.setUi({
      creatingFolder: { keys: ui.selectionMode ? [...ui.selected] : [] },
      renamingFolderId: null, movingKey: null, expandedKey: null, movingSelection: false
    });
  }

  /** `withUnfiled` also files every video that is in no folder into the new one. */
  private commitNewFolder(name: string, withUnfiled = false): void {
    const state = this.store.get();
    const pending = state.ui.creatingFolder;
    this.store.setUi({ creatingFolder: null });
    if (!pending || !name.trim()) return;
    const loose = withUnfiled ? unfiledEntries(state).map((entry) => videoKey(entry.url)) : [];
    const keys = [...new Set([...pending.keys, ...loose])];
    this.messenger.send({ type: 'CREATE_FOLDER', name: name.trim(), keys });
    // The picked videos are filed now; keeping them picked would offer to file
    // or delete them a second time.
    if (state.ui.selectionMode) this.exitSelection();
  }

  private moveSelectedTo(folderId: string | null): void {
    this.moveToFolder([...this.store.get().ui.selected], folderId);
    this.exitSelection();
  }

  private commitRenameFolder(id: string, name: string): void {
    this.store.setUi({ renamingFolderId: null });
    const current = this.store.get().remote.folders.find((folder) => folder.id === id);
    if (!name.trim() || name.trim() === current?.name) return;
    this.messenger.send({ type: 'RENAME_FOLDER', id, name: name.trim() });
  }

  private deleteFolder(id: string): void {
    this.messenger.send({ type: 'DELETE_FOLDER', id });
  }

  private toggleFolder(id: string): void {
    const collapsed = new Set(this.store.get().ui.collapsedFolders);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    this.store.setUi({ collapsedFolders: collapsed });
    void saveCollapsedFolders(collapsed, this.store.get().remote.folders.map((folder) => folder.id));
  }

  /** Every video in a folder, downloaded into that folder. */
  private downloadFolder(id: string): void {
    this.downloadAll(visibleEntries(this.store.get()).filter((entry) => entry.folderId === id));
  }

  /** Flips one row, starting to pick if nothing is picked yet. */
  private toggleSelection(key: string): void {
    const { ui } = this.store.get();
    if (!ui.selectionMode) return this.enterSelection(key);
    const picked = new Set(ui.selected);
    if (picked.has(key)) picked.delete(key);
    else picked.add(key);
    // Emptying the selection leaves the mode, so there is no way to be stuck.
    if (picked.size === 0) return this.exitSelection();
    this.store.setUi({ selected: picked, selectionAnchor: key, movingSelection: false });
  }

  /** Picks every row between the anchor and `key`, on top of what is picked. */
  private selectRange(key: string): void {
    const state = this.store.get();
    const { ui } = state;
    const anchor = ui.selectionAnchor ?? ui.expandedKey;
    if (!anchor) return this.enterSelection(key);

    // A row being written cannot be filed or dropped from under its download.
    const spanned = keysBetween(displayOrder(state), anchor, key)
      .filter((spannedKey) => !isDownloading(state, spannedKey));
    this.store.setUi({
      selectionMode: true,
      selected: new Set([...(ui.selectionMode ? ui.selected : []), ...spanned]),
      selectionAnchor: key,
      expandedKey: null,
      renamingKey: null,
      movingKey: null,
      movingSelection: false
    });
  }

  private selectAll(): void {
    const state = this.store.get();
    const keys = displayOrder(state).filter((key) => !isDownloading(state, key));
    if (keys.length === 0) return;
    this.store.setUi({ selected: new Set(keys), movingSelection: false });
  }

  private enterSelection(key: string): void {
    this.store.setUi({
      selectionMode: true,
      selected: new Set([key]),
      selectionAnchor: key,
      expandedKey: null,
      renamingKey: null,
      movingKey: null,
      creatingFolder: null
    });
  }

  private exitSelection(): void {
    this.store.setUi({
      selectionMode: false,
      selected: new Set(),
      selectionAnchor: null,
      movingSelection: false,
      creatingFolder: null
    });
  }

  private deleteSelected(): void {
    const state = this.store.get();
    const keys = [...state.ui.selected];
    if (keys.length === 0) return;
    // Everything picked is the whole list: wipe it, which also drops the rows
    // a master playlist hides, rather than leaving them behind to resurface.
    const everything = orderedEntries(state).map((entry) => videoKey(entry.url));
    const wipe = everything.every((key) => state.ui.selected.has(key));
    this.messenger.send(wipe ? { type: 'CLEAR_HISTORY' } : { type: 'DELETE_HISTORY_ITEMS', keys });
    this.exitSelection();
  }

  private commitRename(key: string, title: string): void {
    this.store.setUi({ renamingKey: null });
    const entry = this.store.get().remote.history.find((e) => videoKey(e.url) === key);
    if (!title || title === entry?.title) return;
    this.messenger.send({ type: 'RENAME_HISTORY_ITEM', key, title });
    if (isCurrent(this.store.get(), key)) {
      this.messenger.send({ type: 'RENAME_VIDEO', tabId: this.activeTabId, key, title });
    }
  }

  private toggleGroup(domain: string): void {
    const collapsed = new Set(this.store.get().ui.collapsedGroups);
    if (collapsed.has(domain)) collapsed.delete(domain);
    else collapsed.add(domain);
    this.store.setUi({ collapsedGroups: collapsed });
  }

  private downloadGroup(domain: string): void {
    this.downloadAll(entriesForDomain(visibleEntries(this.store.get()), domain));
  }

  private downloadAll(videos: HistoryEntry[]): void {
    const state = this.store.get();
    if (videos.length === 0 || downloadInProgress(state)) return;
    this.messenger.send({
      type: 'DOWNLOAD_ALL', videos, tabId: this.activeTabId, quality: state.ui.batchQuality
    });
  }

  private download(option: QualityOption): void {
    const state = this.store.get();
    if (downloadInProgress(state)) return;
    const key = state.ui.expandedKey;
    const video = state.remote.history.find((e) => videoKey(e.url) === key);
    if (!video) return;

    this.store.setRemote({
      manualDownloadKey: videoKey(video.url),
      activeDownloadKey: videoKey(video.url),
      progress: { percent: 0 }
    });
    this.store.setUi({ expandedKey: null, status: { text: 'Downloading…', tone: 'info' } });

    this.messenger.send({
      type: 'DOWNLOAD',
      tabId: this.activeTabId,
      sourceUrl: video.url,
      // Only history links are old enough to have expired; skip the probe for
      // what a tab is playing right now.
      checkFreshness: !isCurrent(state, videoKey(video.url)),
      video: {
        ...video,
        url: option.url,
        qualities: [{
          height: option.height ?? 0, width: option.width, bitrate: option.bandwidth,
          url: option.url, label: option.label, formatArgs: option.formatArgs,
          formatId: option.formatId, ext: option.ext, fps: option.fps,
          fileSize: option.fileSize, kind: option.kind, language: option.language
        }]
      },
      filename: video.title || 'video'
    });
  }

  private stop(): void {
    const { remote } = this.store.get();
    if (remote.batch) {
      this.messenger.send({ type: 'CANCEL_BATCH' });
      return;
    }
    if (remote.manualDownloadId) {
      this.messenger.send({ type: 'CANCEL_DOWNLOAD', downloadId: remote.manualDownloadId });
    }
    this.store.setRemote({ manualDownloadKey: null, manualDownloadId: null,
      activeDownloadKey: null, progress: null });
    this.store.setUi({ status: { text: 'Download cancelled', tone: 'error' } });
  }

  private setBatchQuality(batchQuality: BatchQuality): void {
    this.store.setUi({ batchQuality });
    updateSetting('batchQuality', batchQuality).catch(() => { /* preference is optional */ });
  }
}

function activeTab(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const root = {
    section: document.getElementById('history-section')!,
    progress: document.getElementById('download-progress')!,
    refresh: document.getElementById('refresh-tabs')!,
    empty: document.getElementById('empty-state')!,
    status: document.getElementById('status-bar')!,
    error: document.getElementById('error')!
  };
  void new App(root).start();
});

export { App };
