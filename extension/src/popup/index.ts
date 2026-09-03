import { loadSettings, updateSetting } from '../lib/settings';
import { initTheme } from '../lib/theme';
import type { HistoryEntry } from '../lib/types';
import { videoKey } from '../lib/video-key';
import { ListHeader } from './components/ListHeader';
import { ProgressPanel } from './components/ProgressPanel';
import { RefreshButton } from './components/RefreshButton';
import { VideoList } from './components/VideoList';
import { entriesForDomain } from './components/VideoList';
import type { VideoRowState } from './components/VideoRow';
import { applyIncoming } from './incoming';
import { Messenger } from './messages';
import type { QualityOption } from './quality';
import {
  busyLabel, downloadInProgress, isCurrent, isDownloading, progressView, visibleEntries
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
      { selectionMode: false, renaming: false, selectedCount: 0, batchQuality: 'best',
        downloadDisabled: false, search: '' },
      {
        onQuality: (quality) => this.setBatchQuality(quality),
        onDownloadAll: () => this.downloadAll(visibleEntries(this.store.get())),
        onClearAll: () => { this.messenger.send({ type: 'CLEAR_HISTORY' }); this.exitSelection(); },
        onClearSelected: () => this.deleteSelected(),
        onSearch: (search) => this.store.setUi({ search })
      }
    );

    this.list = new VideoList(
      { entries: [], grouped: false, collapsedGroups: new Set(),
        downloadDisabled: false, rowState: (entry) => this.rowState(entry) },
      {
        onActivate: (key) => this.activate(key),
        onStartRename: (key) => this.store.setUi({ renamingKey: key, expandedKey: null }),
        onCommitRename: (key, title) => this.commitRename(key, title),
        onCancelRename: () => this.store.setUi({ renamingKey: null }),
        onTrash: (key) => this.enterSelection(key),
        onSelectQuality: (index) => this.store.setUi({ selectedQualityIndex: index }),
        onDownload: (option) => this.download(option),
        onReorder: (keys) => this.messenger.send({ type: 'REORDER_HISTORY', keys }),
        onToggleGroup: (domain) => this.toggleGroup(domain),
        onDownloadGroup: (domain) => this.downloadGroup(domain)
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
  }

  private render(state: AppState): void {
    const entries = visibleEntries(state);
    const blocked = downloadInProgress(state);

    this.progress.setState({ view: progressView(state), detail: state.remote.progress });
    this.refresh.setState({ refreshing: state.ui.refreshing });

    this.header.setState({
      selectionMode: state.ui.selectionMode,
      renaming: state.ui.renamingKey !== null,
      selectedCount: state.ui.selectedForDeletion.size,
      batchQuality: state.ui.batchQuality,
      downloadDisabled: blocked,
      search: state.ui.search
    });

    this.list.setState({
      entries,
      grouped: state.ui.groupByDomain,
      collapsedGroups: state.ui.collapsedGroups,
      downloadDisabled: blocked || state.ui.selectionMode,
      rowState: (entry) => this.rowState(entry)
    });
    const empty = state.remote.history.length === 0;
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
      isPicked: state.ui.selectedForDeletion.has(key),
      isExpanded: state.ui.expandedKey === key,
      isRenaming: state.ui.renamingKey === key,
      downloadDisabled: downloadInProgress(state),
      selectedQualityIndex: state.ui.selectedQualityIndex
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

  /** A click on a row: a tick while picking, otherwise open or close it. */
  private activate(key: string): void {
    const { ui } = this.store.get();
    if (ui.selectionMode) return this.toggleSelection(key);
    this.store.setUi({
      expandedKey: ui.expandedKey === key ? null : key,
      selectedQualityIndex: 0
    });
  }

  private toggleSelection(key: string): void {
    const picked = new Set(this.store.get().ui.selectedForDeletion);
    if (picked.has(key)) picked.delete(key);
    else picked.add(key);
    // Emptying the selection leaves the mode, so there is no way to be stuck.
    if (picked.size === 0) return this.exitSelection();
    this.store.setUi({ selectedForDeletion: picked });
  }

  private enterSelection(key: string): void {
    this.store.setUi({
      selectionMode: true,
      selectedForDeletion: new Set([key]),
      expandedKey: null,
      renamingKey: null
    });
  }

  private exitSelection(): void {
    this.store.setUi({ selectionMode: false, selectedForDeletion: new Set() });
  }

  private deleteSelected(): void {
    const keys = [...this.store.get().ui.selectedForDeletion];
    if (keys.length === 0) return;
    this.messenger.send({ type: 'DELETE_HISTORY_ITEMS', keys });
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
