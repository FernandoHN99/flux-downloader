// Popup Script
// Handles quality selection, download initiation, and progress display

import { loadSettings, updateSetting } from '../lib/settings';
import { initTheme } from '../lib/theme';

interface VideoQuality {
  height: number;
  width?: number;
  bitrate?: number;
  url: string;
  label?: string;
  formatArgs?: string[];
  formatId?: string;
  ext?: string;
  fps?: number;
  fileSize?: number;
  kind?: 'video' | 'audio' | 'subtitle';
  language?: string;
}

interface VideoInfo {
  id: string;
  title: string;
  url: string;
  type: 'm3u8' | 'mpd' | 'direct' | 'hls' | 'dash' | 'mp4' | 'webm' | 'ytdlp' | 'mse';
  qualities: VideoQuality[];
  referer?: string;
  thumbnail?: string;
  duration?: number;
  fileSize?: number;
}

interface HistoryEntry extends VideoInfo {
  pageUrl?: string;
  pageTitle?: string;
  detectedAt: number;
  downloaded?: boolean;
  failed?: boolean;
}

interface QualityOption {
  label: string;
  bandwidth: number;
  bandwidthLabel: string;
  resolution?: string;
  url: string;
  height?: number;
  width?: number;
  sizeLabel?: string;
  formatArgs?: string[];
  formatId?: string;
  ext?: string;
  fps?: number;
  fileSize?: number;
  kind?: 'video' | 'audio' | 'subtitle';
  language?: string;
}

let port: chrome.runtime.Port;
let selectedVideo: VideoInfo | null = null;
let selectedQualityIndex = 0;
let currentQualities: QualityOption[] = [];
let activeTabId: number | null = null;
let currentDownloadId: string | null = null;
let currentVideos: VideoInfo[] = [];
let historyEntries: HistoryEntry[] = [];
let historySearch = '';
let draggingKey: string | null = null;
let currentKeys = new Set<string>();
let selectionMode = false;
const selectedForDeletion = new Set<string>();
// At most one row shows its download options at a time.
let expandedKey: string | null = null;
// Rows with a download in flight: one started from a row, the rest queued by
// a batch run.
let manualDownloadKey: string | null = null;
let batchBusyKeys = new Set<string>();
let batchQuality: 'best' | 'worst' = 'best';
let groupByDomain = false;
const collapsedGroups = new Set<string>();

/** What the single progress bar shows, whichever kind of run filled it. */
interface ProgressView {
  current: number;
  total: number;
  label: string;
  /** Live detail appended to the label, such as a percentage. */
  detail?: string;
  kind: 'single' | 'batch';
}
let progressView: ProgressView | null = null;

// Connect to background script
function initPopup(): void {
  port = chrome.runtime.connect({ name: 'popup' });
  
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'MEDIA_LIST':
        currentKeys = new Set(msg.currentKeys || []);
        renderMediaList(msg.videos);
        break;
      case 'HISTORY_LIST':
        historyEntries = msg.entries || [];
        renderHistory();
        break;
      case 'BATCH_STATUS':
        applyBatchStatus(msg.batch);
        break;
      case 'DOWNLOAD_STARTED':
        if (msg.success) {
          showDownloadStarted(msg.downloadId);
        } else {
          showError(msg.error || 'Download failed');
        }
        break;
      case 'DOWNLOAD_PROGRESS':
        updateSingleProgress(msg.progress || msg);
        break;
      case 'DOWNLOAD_COMPLETE':
        showDownloadComplete();
        break;
      case 'DOWNLOAD_ERROR':
        showError(msg.error || 'Download failed');
        break;
      case 'ACTIVE_DOWNLOAD':
        // Reopening the popup mid-download has to re-mark the busy row.
        manualDownloadKey = msg.sourceUrl ? videoKey(msg.sourceUrl) : null;
        restoreDownloadUI(msg.downloadId, msg.filename, msg.progress);
        renderHistory();
        break;
      case 'NO_ACTIVE_DOWNLOAD':
        requestMediaList();
        break;
      case 'ERROR':
        showError(msg.message);
        break;
    }
  });
  
  port.onDisconnect.addListener(() => {
    console.log('[Popup] Disconnected from background');
    port = null;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initPopup();
  setupEventListeners();
  initializePopupState();
});

async function initializePopupState(): Promise<void> {
  activeTabId = await getActiveTabId();
  const settings = await loadSettings().catch(() => null);
  if (settings) {
    batchQuality = settings.batchQuality;
    groupByDomain = settings.groupByDomain;
  }
  renderBatchQuality();
  port?.postMessage({ type: 'GET_HISTORY' });
  port?.postMessage({ type: 'GET_BATCH_STATUS' });
  if (port && activeTabId != null) {
    updateStatus('Checking for media…');
    port.postMessage({ type: 'GET_ACTIVE_DOWNLOAD', tabId: activeTabId });
  } else {
    requestMediaList();
  }
}

function renderBatchQuality(): void {
  document.querySelectorAll<HTMLButtonElement>('.quality-badge').forEach((badge) => {
    const selected = badge.dataset.quality === batchQuality;
    badge.classList.toggle('selected', selected);
    badge.setAttribute('aria-checked', String(selected));
  });
}

async function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

function setupEventListeners(): void {
  // Refresh button
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    requestMediaList();
  });
  
  // Settings button
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });
  
  // Error dismiss button
  document.getElementById('error-dismiss')?.addEventListener('click', () => {
    hideError();
  });

  // Clear: wipes everything normally, or just the ticked rows in selection mode
  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    if (selectionMode) {
      if (selectedForDeletion.size === 0) return;
      port?.postMessage({ type: 'DELETE_HISTORY_ITEMS', keys: [...selectedForDeletion] });
      exitSelectionMode();
      return;
    }
    port?.postMessage({ type: 'CLEAR_HISTORY' });
  });

  // Download everything currently listed
  document.getElementById('download-all-btn')?.addEventListener('click', () => {
    const pending = visibleHistoryEntries();
    if (pending.length === 0) return;
    port?.postMessage({ type: 'DOWNLOAD_ALL', videos: pending, tabId: activeTabId, quality: batchQuality });
  });

  document.querySelectorAll<HTMLButtonElement>('.quality-badge').forEach((badge) => {
    badge.addEventListener('click', () => {
      batchQuality = (badge.dataset.quality as 'best' | 'worst') || 'best';
      renderBatchQuality();
      updateSetting('batchQuality', batchQuality).catch(() => { /* preference is optional */ });
    });
  });

  document.getElementById('batch-stop-btn')?.addEventListener('click', () => {
    if (progressView?.kind === 'batch') port?.postMessage({ type: 'CANCEL_BATCH' });
    else cancelDownload();
  });

  document.getElementById('history-search')?.addEventListener('input', (event) => {
    historySearch = (event.target as HTMLInputElement).value.trim().toLowerCase();
    renderHistory();
  });
}

function requestMediaList(): void {
  if (port) {
    port.postMessage({ type: 'GET_MEDIA', tabId: activeTabId });
    updateStatus('Checking for media…');
  }
}

function updateStatus(text: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  if (statusBar && statusText) {
    statusBar.className = 'status-bar';
    if (type === 'error') statusBar.classList.add('error');
    if (type === 'success') statusBar.classList.add('success');
    statusText.textContent = text;
  }
}

/**
 * The current page's videos are no longer a separate list — they are the rows
 * history already holds, pinned to the top and badged as current.
 */
function renderMediaList(videos: VideoInfo[]): void {
  const timed = videos.filter(
    (video) => typeof video.duration === 'number' && isFinite(video.duration) && video.duration > 0
  );
  currentVideos = (timed.length > 0 ? timed : videos) || [];
  const count = currentVideos.length;
  updateStatus(count === 1 ? '1 media found' : `${count} media found`, count > 0 ? 'success' : 'info');
  renderHistory();
}

function isCurrentKey(key: string): boolean {
  return currentKeys.has(key);
}

interface BatchStatus {
  total: number;
  completed: number;
  failed: number;
  currentTitle?: string;
  currentSourceKey?: string;
  remainingKeys?: string[];
  folder?: string;
  cancelled: boolean;
}

function applyBatchStatus(batch: BatchStatus | null): void {
  batchBusyKeys = new Set(batch?.remainingKeys || []);

  const downloadAll = document.getElementById('download-all-btn') as HTMLButtonElement | null;
  if (downloadAll) downloadAll.disabled = Boolean(batch);

  if (!batch) {
    // A finished batch must not clear a single download's bar.
    if (progressView?.kind === 'batch') progressView = null;
  } else {
    progressView = {
      // The number names the video being fetched, not the ones already done,
      // so a run of five reads 1 / 5 while the first is downloading.
      current: Math.min(batch.total, batch.completed + batch.failed + 1),
      total: batch.total,
      label: batch.cancelled
        ? 'Stopping\u2026'
        : [batch.folder, batch.currentTitle].filter(Boolean).join(' \u00b7 '),
      kind: 'batch'
    };
  }

  renderProgress();
  renderHistory();
}

/**
 * A one-off download counts 1 / 1, so its percentage is what actually moves.
 * Batch runs ignore this — their movement is the counter.
 */
function updateSingleProgress(progress: any): void {
  if (progressView?.kind !== 'single') return;
  const percent = typeof progress?.percent === 'number' && Number.isFinite(progress.percent)
    ? Math.min(100, Math.max(0, progress.percent))
    : 0;
  progressView.detail = percent > 0 ? `${Math.round(percent)}%` : undefined;
  renderProgress();
}

/** The single bar at the top, shared by one-off downloads and batch runs. */
function renderProgress(): void {
  const bar = document.getElementById('batch-status')!;
  if (!progressView) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  document.getElementById('batch-count')!.textContent =
    `${progressView.current} / ${progressView.total}`;
  document.getElementById('batch-title')!.textContent =
    [progressView.label, progressView.detail].filter(Boolean).join(' \u00b7 ');
}

// Signed CDN links rotate their query token between visits, so the same video
// would otherwise look new every time. Match on the path instead.
function videoKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Every known video, with the current page's pinned to the top.
 */
function visibleHistoryEntries(): HistoryEntry[] {
  const current: HistoryEntry[] = [];
  const rest: HistoryEntry[] = [];
  for (const entry of historyEntries) {
    (isCurrentKey(videoKey(entry.url)) ? current : rest).push(entry);
  }
  return [...current, ...rest];
}

function matchesHistorySearch(entry: HistoryEntry): boolean {
  if (!historySearch) return true;
  return (entry.title || '').toLowerCase().includes(historySearch);
}

function renderHistory(): void {
  const section = document.getElementById('history-section')!;
  const container = document.getElementById('history-list')!;
  const emptyNote = document.getElementById('history-empty')!;
  const emptyState = document.getElementById('empty-state')!;

  // A detection arriving mid-rename would wipe what's being typed.
  if (container.querySelector('.editing')) return;

  const available = visibleHistoryEntries();
  const entries = available.filter(matchesHistorySearch);

  container.replaceChildren();
  if (available.length === 0) {
    section.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  section.classList.remove('hidden');
  emptyNote.classList.toggle('hidden', entries.length > 0);

  if (groupByDomain) renderGrouped(container, entries);
  else appendRows(container, entries, 0);

  updateClearButton();
}

/** One folder per site, in the order the sites appear in the list. */
function renderGrouped(container: HTMLElement, entries: HistoryEntry[]): void {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const domain = groupDomain(entry);
    const bucket = groups.get(domain);
    if (bucket) bucket.push(entry);
    else groups.set(domain, [entry]);
  }

  let index = 0;
  for (const [domain, items] of groups) {
    const group = document.createElement('div');
    group.className = 'media-group';
    group.dataset.domain = domain;

    const collapsed = collapsedGroups.has(domain);
    group.appendChild(createGroupHead(domain, items, collapsed));

    if (!collapsed) {
      const body = document.createElement('div');
      body.className = 'group-body';
      appendRows(body, items, index);
      group.appendChild(body);
    }

    container.appendChild(group);
    index += items.length;
  }
}

function createGroupHead(domain: string, items: HistoryEntry[], collapsed: boolean): HTMLElement {
  const head = document.createElement('div');
  head.className = 'group-head';
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', String(!collapsed));

  // The icon is the site's favicon until pointed at, when it offers to
  // download everything the site has.
  const icon = document.createElement('button');
  icon.className = 'group-icon';
  icon.title = `Download all ${items.length} from ${domain}`;
  icon.setAttribute('aria-label', icon.title);

  const favicon = document.createElement('img');
  favicon.className = 'group-favicon';
  favicon.alt = '';
  favicon.src = faviconUrl(items[0]?.pageUrl || `https://${domain}/`);
  icon.appendChild(favicon);

  const fallback = document.createElement('span');
  fallback.className = 'group-folder';
  fallback.setAttribute('aria-hidden', 'true');
  icon.appendChild(fallback);
  favicon.addEventListener('error', () => favicon.classList.add('hidden'));

  const download = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  download.setAttribute('class', 'group-download');
  download.setAttribute('viewBox', '0 0 24 24');
  download.setAttribute('fill', 'none');
  download.setAttribute('stroke', 'currentColor');
  download.setAttribute('stroke-width', '2.2');
  download.setAttribute('stroke-linecap', 'round');
  download.setAttribute('stroke-linejoin', 'round');
  download.setAttribute('aria-hidden', 'true');
  for (const d of ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    download.appendChild(path);
  }
  icon.appendChild(download);

  icon.disabled = batchBusyKeys.size > 0;
  icon.addEventListener('click', (event) => {
    event.stopPropagation();
    downloadGroup(items);
  });
  head.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = domain;
  head.appendChild(name);

  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = String(items.length);
  head.appendChild(count);

  const chevron = document.createElement('span');
  chevron.className = collapsed ? 'group-chevron' : 'group-chevron open';
  chevron.setAttribute('aria-hidden', 'true');
  head.appendChild(chevron);

  const toggle = (): void => {
    if (collapsedGroups.has(domain)) collapsedGroups.delete(domain);
    else collapsedGroups.add(domain);
    renderHistory();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });

  return head;
}

function downloadGroup(items: HistoryEntry[]): void {
  if (items.length === 0 || batchBusyKeys.size > 0) return;
  port?.postMessage({ type: 'DOWNLOAD_ALL', videos: items, tabId: activeTabId, quality: batchQuality });
}

// chrome's own favicon store — no request leaves the browser to fetch it.
function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

function groupDomain(entry: HistoryEntry): string {
  try {
    return new URL(entry.pageUrl || entry.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Other';
  }
}

/**
 * Current rows sit loose at the top; everything below them goes in a reorder
 * zone, which is both the drop target and the only part of the list that
 * shows the dashed outline while dragging.
 */
function appendRows(parent: HTMLElement, entries: HistoryEntry[], startIndex: number): void {
  const current: HistoryEntry[] = [];
  const rest: HistoryEntry[] = [];
  for (const entry of entries) {
    (isCurrentKey(videoKey(entry.url)) ? current : rest).push(entry);
  }

  current.forEach((entry, offset) => {
    parent.appendChild(createMediaItem(entry, startIndex + offset, entry));
  });

  if (rest.length === 0) return;

  const zone = document.createElement('div');
  zone.className = 'reorder-zone';
  rest.forEach((entry, offset) => {
    zone.appendChild(createMediaItem(entry, startIndex + current.length + offset, entry));
  });
  attachDropZone(zone);
  parent.appendChild(zone);
}

function attachDragBehaviour(element: HTMLElement): void {
  element.addEventListener('dragstart', (event) => {
    draggingKey = element.dataset.key || null;
    element.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', draggingKey || '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('dragging');
    draggingKey = null;
    document.querySelectorAll('.reorder-zone.drop-target')
      .forEach((zone) => zone.classList.remove('drop-target'));
  });
}

/**
 * Each zone accepts only its own rows: in grouped mode that keeps a video
 * from being dragged into another site's folder.
 */
function attachDropZone(zone: HTMLElement): void {
  const accept = (event: DragEvent): boolean => {
    const dragged = document.querySelector('.dragging') as HTMLElement | null;
    if (!draggingKey || !dragged || dragged.parentElement !== zone) return false;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    return true;
  };

  zone.addEventListener('dragover', (event) => {
    if (!accept(event)) return;
    zone.classList.add('drop-target');
    const dragged = document.querySelector('.dragging') as HTMLElement;
    const after = rowAfterPointer(zone, event.clientY);
    if (after !== dragged) zone.insertBefore(dragged, after);
  });

  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove('drop-target');
  });

  zone.addEventListener('drop', (event) => {
    if (!accept(event)) return;
    zone.classList.remove('drop-target');
    if (!port) return;
    // The stored order is flat, so send every row the list is showing.
    const keys = [...document.querySelectorAll('#history-list .media-item')]
      .map((row) => (row as HTMLElement).dataset.key)
      .filter((value): value is string => Boolean(value));
    port.postMessage({ type: 'REORDER_HISTORY', keys });
  });
}

// Where the dragged row should sit inside its own zone. Current rows live
// outside every zone, so they cannot be displaced.
function rowAfterPointer(container: HTMLElement, clientY: number): HTMLElement | null {
  const rows = [...container.querySelectorAll(':scope > .media-item:not(.dragging)')] as HTMLElement[];
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return row;
  }
  return null;
}

// --- Inline rename ---

function startRename(element: HTMLElement, video: VideoInfo, isCurrent: boolean): void {
  const info = element.querySelector('.media-info') as HTMLElement | null;
  if (!info || element.classList.contains('editing')) return;
  element.classList.add('editing');
  element.draggable = false;

  const original = info.innerHTML;
  const form = document.createElement('div');
  form.className = 'rename-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = video.title || '';
  input.setAttribute('aria-label', 'New title');

  const confirm = createIconButton('confirm', 'Save title', 'M20 6 9 17l-5-5');
  const cancel = createIconButton('cancel', 'Cancel rename', 'M18 6 6 18M6 6l12 12');

  form.append(input, confirm, cancel);
  info.replaceChildren(form);
  input.focus();
  input.select();

  const close = (): void => {
    element.classList.remove('editing');
    element.draggable = !isCurrent;
    info.innerHTML = original;
  };

  const commit = (): void => {
    const title = input.value.trim();
    close();
    if (!title || title === video.title) return;
    const key = videoKey(video.url);
    port?.postMessage({ type: 'RENAME_HISTORY_ITEM', key, title });
    if (isCurrent) port?.postMessage({ type: 'RENAME_VIDEO', tabId: activeTabId, key, title });
  };

  confirm.addEventListener('click', (event) => { event.stopPropagation(); commit(); });
  cancel.addEventListener('click', (event) => { event.stopPropagation(); close(); });
  form.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
}

function createIconButton(kind: string, label: string, path: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `icon-btn-sm icon-btn-${kind}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.appendChild(shape);
  button.appendChild(svg);
  return button;
}

/**
 * A row: a compact header, plus — when it is the one expanded row — the
 * download options underneath it.
 */
function createMediaItem(video: VideoInfo, index: number, historyEntry?: HistoryEntry): HTMLElement {
  const key = videoKey(video.url);
  const isCurrent = isCurrentKey(key);
  const busy = isDownloading(key);

  const div = document.createElement('div');
  div.className = historyEntry ? 'media-item media-item-history' : 'media-item media-item-current';
  div.dataset.index = String(index);
  div.dataset.key = key;
  div.setAttribute('role', 'option');
  div.setAttribute('aria-selected', 'false');
  div.tabIndex = 0;
  // Current-page rows stay pinned at the top, so only the rest reorder — and
  // a row being written to disk holds still.
  div.draggable = !isCurrent && !busy && !selectionMode;
  div.classList.toggle('media-item-current-page', isCurrent);
  div.classList.toggle('busy', busy);

  const head = document.createElement('div');
  head.className = 'media-head';
  div.appendChild(head);

  if (selectionMode) {
    head.appendChild(createSelectDot(selectedForDeletion.has(key)));
    div.classList.toggle('picked', selectedForDeletion.has(key));
  } else if (!isCurrent && !busy) {
    head.appendChild(createDragHandle());
  }

  if (video.thumbnail) {
    const wrapper = document.createElement('div');
    wrapper.className = 'media-thumbnail-wrapper';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'media-thumbnail';
    thumbnail.alt = video.title || 'Video thumbnail';
    thumbnail.src = video.thumbnail;
    wrapper.appendChild(thumbnail);
    head.appendChild(wrapper);

    const fallback = createMediaIcon('media-icon media-icon-fallback hidden');
    head.appendChild(fallback);
    thumbnail.addEventListener('error', () => {
      wrapper.classList.add('hidden');
      fallback.classList.remove('hidden');
    });
  } else {
    head.appendChild(createMediaIcon('media-icon'));
  }

  const info = document.createElement('div');
  info.className = 'media-info';

  const title = document.createElement('div');
  title.className = 'media-title media-title-row';
  const titleText = document.createElement('span');
  titleText.className = 'media-title-text';
  titleText.textContent = video.title || 'Unknown Video';
  title.appendChild(titleText);

  if (historyEntry?.failed && !busy) {
    title.appendChild(createBadge('failed-badge', 'error', 'Last download failed'));
  }
  info.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'media-meta';
  meta.textContent = busy ? 'Downloading…' : [
    getTypeLabel(video.type),
    video.duration ? formatDuration(video.duration) : '',
    historyEntry ? formatRelativeTime(historyEntry.detectedAt) : ''
  ].filter(Boolean).join(' · ');
  if (historyEntry?.pageUrl) div.title = historyEntry.pageUrl;
  info.appendChild(meta);

  head.appendChild(info);

  // A row being downloaded trades its actions for a spinner: renaming or
  // deleting it mid-write would leave the file and the entry disagreeing.
  if (busy) {
    head.appendChild(createSpinner());
  } else {
    const actions = document.createElement('div');
    actions.className = 'media-actions';

    const rename = createIconButton('rename', 'Rename', 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z');
    rename.classList.add('rename-btn');
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      startRename(div, video, isCurrent);
    });
    actions.appendChild(rename);

    const remove = createIconButton('remove', 'Select to delete',
      'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6');
    remove.classList.add('remove-btn');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      if (selectionMode) toggleSelection(key, div);
      else enterSelectionMode(key);
    });
    actions.appendChild(remove);

    head.appendChild(actions);
  }

  // Pinned last so it sits hard against the row's right edge, centred against
  // the whole card rather than riding along with the title.
  if (isCurrent) {
    head.appendChild(createBadge('current-badge', 'current', 'Detected on the page you have open'));
  }

  if (expandedKey === key && !selectionMode && !busy) {
    div.classList.add('expanded', 'selected');
    div.setAttribute('aria-selected', 'true');
    div.appendChild(buildExpandPanel(video));
  }

  if (!isCurrent && !busy && !selectionMode) attachDragBehaviour(div);

  const activate = (): void => {
    if (selectionMode) toggleSelection(key, div);
    else if (!busy) toggleExpand(video);
  };

  div.addEventListener('click', activate);
  div.addEventListener('keydown', (event) => {
    if (event.target !== div) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });

  return div;
}

function createDragHandle(): HTMLElement {
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.title = 'Drag to reorder';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  for (const y of [9, 15]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '4');
    line.setAttribute('x2', '20');
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    svg.appendChild(line);
  }
  handle.appendChild(svg);
  return handle;
}

function createSpinner(): HTMLElement {
  const spinner = document.createElement('span');
  spinner.className = 'row-spinner';
  spinner.title = 'Downloading — stop the download to edit this video';
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Downloading');
  return spinner;
}

function isDownloading(key: string): boolean {
  return key === manualDownloadKey || batchBusyKeys.has(key);
}

function createBadge(className: string, text: string, label: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = text;
  badge.title = label;
  badge.setAttribute('aria-label', label);
  return badge;
}

function createMediaIcon(className: string): HTMLElement {
  const icon = document.createElement('div');
  icon.className = className;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '5 3 19 12 5 21 5 3');
  svg.appendChild(polygon);
  icon.appendChild(svg);
  return icon;
}

/**
 * Clicking a row opens its download options underneath it; clicking it again
 * closes them. Only one row is ever open, so the panel can keep using the
 * shared selection state.
 */
function toggleExpand(video: VideoInfo): void {
  const key = videoKey(video.url);
  if (expandedKey === key) {
    collapseExpanded();
    return;
  }

  expandedKey = key;
  selectedVideo = video;
  currentQualities = buildQualityOptions(video);
  selectedQualityIndex = 0;
  renderHistory();
}

function collapseExpanded(): void {
  expandedKey = null;
  selectedVideo = null;
  currentQualities = [];
  selectedQualityIndex = 0;
  renderHistory();
}

function buildQualityOptions(video: VideoInfo): QualityOption[] {
  const options: QualityOption[] = video.qualities.map((q) => ({
    label: q.label || getQualityLabel(q.height),
    bandwidth: q.bitrate || 0,
    bandwidthLabel: q.bitrate ? formatBandwidth(q.bitrate) : 'Unknown',
    resolution: q.width && q.height ? `${q.width}x${q.height}` : undefined,
    url: q.url,
    height: q.height,
    width: q.width,
    sizeLabel: getSizeLabel(q, video),
    formatArgs: q.formatArgs,
    formatId: q.formatId,
    ext: q.ext,
    fps: q.fps,
    fileSize: q.fileSize,
    kind: q.kind,
    language: q.language
  }));

  // Nothing parsed out of the manifest — offer the link itself. YouTube is the
  // exception: its formats arrive later, from yt-dlp.
  if (options.length === 0 && video.type !== 'ytdlp') {
    return [{
      label: 'Direct',
      bandwidth: 0,
      bandwidthLabel: 'Unknown',
      url: video.url,
      sizeLabel: video.fileSize ? formatFileSize(video.fileSize) : undefined
    }];
  }
  return options;
}

function buildExpandPanel(video: VideoInfo): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'media-expand';
  // Picking a quality must not count as a click on the row itself.
  panel.addEventListener('click', (event) => event.stopPropagation());

  const list = document.createElement('div');
  list.className = 'quality-list';
  panel.appendChild(list);

  const button = document.createElement('button');
  button.className = 'btn btn-primary expand-download-btn';
  button.textContent = 'Download';
  button.addEventListener('click', () => {
    if (currentQualities.length === 0) return;
    startDownload(video, currentQualities[selectedQualityIndex]);
  });
  panel.appendChild(button);

  renderQualityList(list, button);
  return panel;
}

/**
 * Render quality selection list
 */
function renderQualityList(container: HTMLElement, downloadBtn: HTMLButtonElement | null): void {
  container.replaceChildren();
  
  if (currentQualities.length === 0) {
    const loading = document.createElement('p');
    loading.className = 'no-quality';
    loading.textContent = 'Loading YouTube qualities…';
    container.appendChild(loading);
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }
  if (downloadBtn) downloadBtn.disabled = false;
  
  // Quick options
  const quickOptions = document.createElement('div');
  quickOptions.className = 'quick-options';
  const bestButton = document.createElement('button');
  bestButton.className = 'quick-btn';
  bestButton.dataset.quality = 'best';
  bestButton.textContent = 'Best';
  const lowestButton = document.createElement('button');
  lowestButton.className = 'quick-btn';
  lowestButton.dataset.quality = 'worst';
  lowestButton.textContent = 'Lowest';
  quickOptions.append(bestButton, lowestButton);
  container.appendChild(quickOptions);
  
  quickOptions.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const quality = (event.currentTarget as HTMLButtonElement).dataset.quality;
      selectQuality(quality === 'worst' ? lowestQualityIndex() : 0);
    });
  });
  
  // Individual quality options
  const qualityOptions = document.createElement('div');
  qualityOptions.className = 'quality-options';
  qualityOptions.setAttribute('role', 'radiogroup');
  qualityOptions.setAttribute('aria-label', 'Quality options');
  container.appendChild(qualityOptions);

  currentQualities.forEach((q, index) => {
    const option = document.createElement('label');
    option.className = 'quality-option';
    option.dataset.index = String(index);
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'quality';
    radio.value = String(index);
    radio.className = 'quality-radio';
    radio.tabIndex = index === 0 ? 0 : -1;
    radio.setAttribute('aria-checked', 'false');
    option.appendChild(radio);

    const qualityLabel = document.createElement('span');
    qualityLabel.className = 'quality-label';
    qualityLabel.textContent = q.label;
    option.appendChild(qualityLabel);

    if (q.kind === 'audio' || q.kind === 'subtitle') {
      const kind = document.createElement('span');
      kind.className = q.kind === 'subtitle' ? 'quality-kind quality-kind-sub' : 'quality-kind';
      kind.textContent = q.kind === 'subtitle' ? 'SUB' : 'Audio';
      option.appendChild(kind);
    }

    if (q.resolution) {
      const resolution = document.createElement('span');
      resolution.className = 'quality-bandwidth';
      resolution.textContent = q.resolution;
      option.appendChild(resolution);
    }

    const bandwidth = document.createElement('span');
    bandwidth.className = 'quality-bandwidth';
    bandwidth.textContent = q.bandwidthLabel;
    option.appendChild(bandwidth);

    if (q.sizeLabel) {
      const size = document.createElement('span');
      size.className = 'quality-size';
      size.textContent = q.sizeLabel;
      option.appendChild(size);
    }

    radio.addEventListener('change', () => {
      if (radio.checked) {
        selectQuality(index);
      }
    });

    radio.addEventListener('keydown', (event) => {
      let nextIndex = index;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        nextIndex = (index + 1) % currentQualities.length;
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + currentQualities.length) % currentQualities.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = currentQualities.length - 1;
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectQuality(index);
        return;
      } else {
        return;
      }

      event.preventDefault();
      selectQuality(nextIndex);
      const nextRadio = qualityOptions.querySelectorAll<HTMLInputElement>('.quality-radio')[nextIndex];
      nextRadio?.focus();
    });
    
    option.addEventListener('click', () => {
      selectQuality(index);
    });
    
    qualityOptions.appendChild(option);
  });
  
  // The chosen index survives re-renders, so re-apply it rather than reset.
  selectQuality(selectedQualityIndex, container);
}

/**
 * Select a quality option
 */
function lowestQualityIndex(): number {
  const index = findLowestVideoQualityIndex();
  return index >= 0 ? index : currentQualities.length - 1;
}

/**
 * Best and Lowest are shortcuts to an option in the list, so each lights up
 * only while that option is the selected one — picking 720p by hand leaves
 * both unlit, which is the honest state.
 */
function updateQuickButtons(scope: ParentNode): void {
  const lowest = lowestQualityIndex();
  scope.querySelectorAll<HTMLButtonElement>('.quick-btn').forEach((button) => {
    const active = button.dataset.quality === 'worst'
      ? selectedQualityIndex === lowest
      : selectedQualityIndex === 0;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function selectQuality(index: number, root?: ParentNode): void {
  if (index < 0 || index >= currentQualities.length) return;
  selectedQualityIndex = index;

  // While a panel is being built its options are not in the document yet, so
  // the caller passes the container it is filling.
  const scope = root || document;
  updateQuickButtons(scope);
  scope.querySelectorAll('.quality-option').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
    const radio = el.querySelector('input[type="radio"]') as HTMLInputElement;
    if (radio) {
      radio.checked = i === index;
      radio.tabIndex = i === index ? 0 : -1;
      radio.setAttribute('aria-checked', String(i === index));
    }
  });
  
}

/**
 * Start a download
 */
function startDownload(video: VideoInfo, quality: QualityOption): void {
  const filename = video.title || 'video';

  // The row shows a spinner and locks its actions until this finishes.
  manualDownloadKey = videoKey(video.url);
  expandedKey = null;
  progressView = { current: 1, total: 1, label: filename, kind: 'single' };
  renderProgress();
  renderHistory();
  showDownloadingUI();
  
  if (port) {
    const fromHistory = historyEntries.some((entry) => videoKey(entry.url) === videoKey(video.url));
    port.postMessage({
      type: 'DOWNLOAD',
      tabId: activeTabId,
      sourceUrl: video.url,
      // Only history links are old enough to have expired; skip the probe for
      // what the current page just handed us.
      checkFreshness: fromHistory && !currentVideos.some((current) => videoKey(current.url) === videoKey(video.url)),
      video: {
        ...video,
        url: quality.url,
        qualities: [{
          height: quality.height,
          width: quality.width,
          bitrate: quality.bandwidth,
          url: quality.url,
          label: quality.label,
          formatArgs: quality.formatArgs,
          formatId: quality.formatId,
          ext: quality.ext,
          fps: quality.fps,
          fileSize: quality.fileSize,
          kind: quality.kind,
          language: quality.language
        }]
      },
      filename: filename
    });
  }
}

// --- Selection mode: the trash on a row turns every row into a checkbox ---

function enterSelectionMode(key: string): void {
  selectionMode = true;
  expandedKey = null;
  selectedForDeletion.clear();
  selectedForDeletion.add(key);
  renderHistory();
  updateClearButton();
}

function exitSelectionMode(): void {
  selectionMode = false;
  selectedForDeletion.clear();
  renderHistory();
  updateClearButton();
}

function toggleSelection(key: string, element: HTMLElement): void {
  if (selectedForDeletion.has(key)) selectedForDeletion.delete(key);
  else selectedForDeletion.add(key);

  // Emptying the selection leaves the mode, so there's no way to get stuck in it.
  if (selectedForDeletion.size === 0) {
    exitSelectionMode();
    return;
  }
  element.classList.toggle('picked', selectedForDeletion.has(key));
  element.querySelector('.select-dot')?.classList.toggle('checked', selectedForDeletion.has(key));
  updateClearButton();
}

function updateClearButton(): void {
  const button = document.getElementById('clear-history-btn');
  if (!button) return;
  button.textContent = selectionMode ? `Clear (${selectedForDeletion.size})` : 'Clear All';
  button.classList.toggle('danger', selectionMode);
}

function createSelectDot(checked: boolean): HTMLElement {
  const dot = document.createElement('span');
  dot.className = checked ? 'select-dot checked' : 'select-dot';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function showDownloadingUI(): void {
  document.getElementById('error')!.classList.add('hidden');
  updateStatus('Downloading\u2026', 'info');
  document.getElementById('batch-stop-btn')?.focus();
}

function restoreDownloadUI(downloadId: string, filename: string, _progress: any): void {
  currentDownloadId = downloadId;
  document.getElementById('error')!.classList.add('hidden');
  progressView = { current: 1, total: 1, label: filename || 'Downloading\u2026', kind: 'single' };
  renderProgress();
  updateStatus('Downloading\u2026', 'info');
}

function showDownloadStarted(downloadId: string): void {
  currentDownloadId = downloadId;
  updateStatus('Download started…', 'info');
}

function showDownloadComplete(): void {
  currentDownloadId = null;
  updateStatus('Download complete!', 'success');
  resetUI();
  requestMediaList();
}

function cancelDownload(): void {
  if (port && currentDownloadId) {
    port.postMessage({ type: 'CANCEL_DOWNLOAD', downloadId: currentDownloadId });
  }
  currentDownloadId = null;
  resetUI();
  updateStatus('Download cancelled', 'error');
}

function resetUI(): void {
  currentDownloadId = null;
  // Whatever happened to the download, the row goes back to being editable.
  manualDownloadKey = null;
  if (progressView?.kind === 'single') progressView = null;
  document.getElementById('error')!.classList.add('hidden');
  renderProgress();
  renderHistory();
}

function showError(message: string): void {
  currentDownloadId = null;
  const errorEl = document.getElementById('error')!;
  const errorMsgEl = document.getElementById('error-message')!;
  
  if (errorMsgEl) errorMsgEl.textContent = message;
  errorEl.classList.remove('hidden');
  
  // An error ends whatever run was showing, and frees its rows.
  manualDownloadKey = null;
  if (progressView?.kind === 'single') progressView = null;
  renderProgress();
  renderHistory();

  updateStatus('Error', 'error');
  document.getElementById('error-dismiss')?.focus();
}

function hideError(): void {
  const errorEl = document.getElementById('error')!;
  errorEl.classList.add('hidden');
  resetUI();
}

/**
 * Utility functions
 */
function getTypeLabel(type: string): string {
  switch (type) {
    case 'hls':
    case 'm3u8':
      return 'HLS';
    case 'dash':
    case 'mpd':
      return 'DASH';
    case 'mp4':
      return 'MP4';
    case 'webm':
      return 'WebM';
    case 'ytdlp':
      return 'YT-DLP';
    case 'mse':
      return 'MSE';
    default:
      return 'Video';
  }
}

function getQualityLabel(height?: number): string {
  if (!height) return 'Unknown';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

function formatBandwidth(bps: number): string {
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)} Mbps`;
  }
  return `${Math.round(bps / 1000)} Kbps`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  if (bytesPerSec > 1000000) {
    return `${(bytesPerSec / 1000000).toFixed(1)} MB/s`;
  }
  if (bytesPerSec > 1000) {
    return `${(bytesPerSec / 1000).toFixed(0)} KB/s`;
  }
  return `${bytesPerSec} B/s`;
}

function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function getSiteLabel(pageUrl?: string): string {
  if (!pageUrl) return '';
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function getSizeLabel(quality: VideoQuality, video: VideoInfo): string | undefined {
  if (quality.fileSize) return formatFileSize(quality.fileSize);
  if (video.fileSize) return formatFileSize(video.fileSize);
  if (quality.bitrate && video.duration) {
    return `~${formatFileSize((quality.bitrate * video.duration) / 8)}`;
  }
  return undefined;
}

function findLowestVideoQualityIndex(): number {
  for (let i = currentQualities.length - 1; i >= 0; i--) {
    if ((currentQualities[i].height || 0) > 0) return i;
  }
  return -1;
}
