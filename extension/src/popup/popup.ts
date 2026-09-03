// Popup Script
// Handles quality selection, download initiation, and progress display

import { loadSettings } from '../lib/settings';
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

// Connect to background script
function initPopup(): void {
  const version = document.querySelector('.version');
  if (version) version.textContent = `MediaGrabber v${chrome.runtime.getManifest().version}`;

  port = chrome.runtime.connect({ name: 'popup' });
  
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'MEDIA_LIST':
        renderMediaList(msg.videos);
        break;
      case 'HISTORY_LIST':
        historyEntries = msg.entries || [];
        renderHistory();
        break;
      case 'BATCH_STATUS':
        renderBatchStatus(msg.batch);
        break;
      case 'DOWNLOAD_STARTED':
        if (msg.success) {
          showDownloadStarted(msg.downloadId);
        } else {
          showError(msg.error || 'Download failed');
        }
        break;
      case 'DOWNLOAD_PROGRESS':
        updateProgressUI(msg.progress || msg);
        break;
      case 'DOWNLOAD_COMPLETE':
        showDownloadComplete();
        break;
      case 'DOWNLOAD_ERROR':
        showError(msg.error || 'Download failed');
        break;
      case 'ACTIVE_DOWNLOAD':
        restoreDownloadUI(msg.downloadId, msg.filename, msg.progress);
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
  port?.postMessage({ type: 'GET_HISTORY' });
  port?.postMessage({ type: 'GET_BATCH_STATUS' });
  if (port && activeTabId != null) {
    updateStatus('Checking for media…');
    port.postMessage({ type: 'GET_ACTIVE_DOWNLOAD', tabId: activeTabId });
  } else {
    requestMediaList();
  }
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
  
  // Download button
  document.getElementById('download-btn')?.addEventListener('click', () => {
    if (selectedVideo && currentQualities.length > 0) {
      const quality = currentQualities[selectedQualityIndex];
      startDownload(selectedVideo, quality);
    }
  });
  
  // Cancel button
  document.getElementById('cancel-btn')?.addEventListener('click', () => {
    cancelDownload();
  });
  
  // Error dismiss button
  document.getElementById('error-dismiss')?.addEventListener('click', () => {
    hideError();
  });

  // Clear history button
  document.getElementById('clear-history-btn')?.addEventListener('click', () => {
    port?.postMessage({ type: 'CLEAR_HISTORY' });
  });

  // Download everything currently listed under History
  document.getElementById('download-all-btn')?.addEventListener('click', () => {
    const pending = visibleHistoryEntries();
    if (pending.length === 0) return;
    port?.postMessage({ type: 'DOWNLOAD_ALL', videos: pending, tabId: activeTabId });
  });

  document.getElementById('batch-stop-btn')?.addEventListener('click', () => {
    port?.postMessage({ type: 'CANCEL_BATCH' });
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
 * Render the list of detected media
 */
function renderMediaList(videos: VideoInfo[]): void {
  const emptyState = document.getElementById('empty-state')!;
  const videoList = document.getElementById('video-list')!;
  const mediaDetails = document.getElementById('media-details')!;
  const downloadSection = document.getElementById('download-section')!;
  const container = document.getElementById('videos')!;
  const timedVideos = videos.filter(
    (video) => typeof video.duration === 'number' && isFinite(video.duration) && video.duration > 0
  );
  const displayVideos = timedVideos.length > 0 ? timedVideos : videos;
  currentVideos = displayVideos || [];
  renderHistory();

  if (!displayVideos || displayVideos.length === 0) {
    emptyState.classList.remove('hidden');
    videoList.classList.add('hidden');
    mediaDetails.classList.add('hidden');
    downloadSection.classList.add('hidden');
    updateStatus('No media detected on this page', 'info');
    return;
  }
  
  emptyState.classList.add('hidden');
  videoList.classList.remove('hidden');
  
  container.replaceChildren();
  let updatedSelectedVideo: VideoInfo | null = null;
  let updatedSelectedElement: HTMLElement | null = null;
  
  displayVideos.forEach((video, index) => {
    const videoEl = createMediaItem(video, index);
    container.appendChild(videoEl);
    if (selectedVideo?.id === video.id) {
      updatedSelectedVideo = video;
      updatedSelectedElement = videoEl;
    }
  });

  if (updatedSelectedVideo && updatedSelectedElement) {
    selectMedia(updatedSelectedVideo, updatedSelectedElement);
  }
  
  updateStatus(`${displayVideos.length} media found`, 'success');
}

interface BatchStatus {
  total: number;
  completed: number;
  failed: number;
  currentTitle?: string;
  cancelled: boolean;
}

function renderBatchStatus(batch: BatchStatus | null): void {
  const bar = document.getElementById('batch-status')!;
  const downloadAll = document.getElementById('download-all-btn') as HTMLButtonElement | null;

  if (!batch) {
    bar.classList.add('hidden');
    if (downloadAll) downloadAll.disabled = false;
    return;
  }

  bar.classList.remove('hidden');
  if (downloadAll) downloadAll.disabled = true;
  const done = batch.completed + batch.failed;
  document.getElementById('batch-count')!.textContent = `${done} / ${batch.total}`;
  document.getElementById('batch-title')!.textContent = batch.cancelled
    ? 'Stopping…'
    : (batch.currentTitle || '');
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
 * History minus whatever is already listed as detected on the current page
 */
function visibleHistoryEntries(): HistoryEntry[] {
  const currentKeys = new Set(currentVideos.map((video) => videoKey(video.url)));
  return historyEntries.filter((entry) => !currentKeys.has(videoKey(entry.url)));
}

function matchesHistorySearch(entry: HistoryEntry): boolean {
  if (!historySearch) return true;
  const haystack = `${entry.title || ''} ${entry.pageUrl || ''}`.toLowerCase();
  return haystack.includes(historySearch);
}

/**
 * Render previously detected media, excluding whatever is already on this page
 */
function renderHistory(): void {
  const section = document.getElementById('history-section')!;
  const container = document.getElementById('history-list')!;
  const emptyNote = document.getElementById('history-empty')!;

  // A detection arriving mid-rename would wipe what's being typed.
  if (container.querySelector('.editing')) return;

  const available = visibleHistoryEntries();
  const entries = available.filter(matchesHistorySearch);

  container.replaceChildren();
  if (available.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  emptyNote.classList.toggle('hidden', entries.length > 0);

  entries.forEach((entry, index) => {
    const element = createMediaItem(entry, index, entry);
    if (selectedVideo?.id === entry.id) {
      element.classList.add('selected');
      element.setAttribute('aria-selected', 'true');
    }
    container.appendChild(element);
  });
}

// --- Drag to reorder ---

function attachDragBehaviour(element: HTMLElement, entry: HistoryEntry): void {
  element.dataset.key = videoKey(entry.url);

  element.addEventListener('dragstart', (event) => {
    draggingKey = element.dataset.key || null;
    element.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', draggingKey || '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('dragging');
    draggingKey = null;
    persistHistoryOrder();
  });

  element.addEventListener('dragover', (event) => {
    if (!draggingKey || element.dataset.key === draggingKey) return;
    event.preventDefault();
    const container = element.parentElement;
    const dragged = container?.querySelector('.dragging') as HTMLElement | null;
    if (!container || !dragged) return;
    const box = element.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    container.insertBefore(dragged, after ? element.nextSibling : element);
  });
}

// Reordering only ever touches the visible rows; the background keeps the rest.
function persistHistoryOrder(): void {
  const container = document.getElementById('history-list');
  if (!container || !port) return;
  const keys = [...container.children]
    .map((child) => (child as HTMLElement).dataset.key)
    .filter((key): key is string => Boolean(key));
  port.postMessage({ type: 'REORDER_HISTORY', keys });
}

// --- Inline rename ---

function startRename(element: HTMLElement, entry: HistoryEntry): void {
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
  input.value = entry.title || '';
  input.setAttribute('aria-label', 'New title');

  const confirm = createIconButton('confirm', 'Save title', 'M20 6 9 17l-5-5');
  const cancel = createIconButton('cancel', 'Cancel rename', 'M18 6 6 18M6 6l12 12');

  form.append(input, confirm, cancel);
  info.replaceChildren(form);
  input.focus();
  input.select();

  const close = (): void => {
    element.classList.remove('editing');
    element.draggable = true;
    info.innerHTML = original;
  };

  const commit = (): void => {
    const title = input.value.trim();
    close();
    if (!title || title === entry.title) return;
    port?.postMessage({ type: 'RENAME_HISTORY_ITEM', key: videoKey(entry.url), title });
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

/**
 * Create a media item element
 */
function createMediaItem(video: VideoInfo, index: number, historyEntry?: HistoryEntry): HTMLElement {
  const div = document.createElement('div');
  div.className = 'media-item';
  div.dataset.index = String(index);
  div.setAttribute('role', 'option');
  div.setAttribute('aria-selected', 'false');
  div.tabIndex = 0;
  
  // Calculate duration if available
  const durationStr = video.duration ? formatDuration(video.duration) : '';

  if (video.thumbnail) {
    const wrapper = document.createElement('div');
    wrapper.className = 'media-thumbnail-wrapper';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'media-thumbnail';
    thumbnail.alt = video.title || 'Video thumbnail';
    thumbnail.width = 64;
    thumbnail.height = 40;
    thumbnail.src = video.thumbnail;
    wrapper.appendChild(thumbnail);
    div.appendChild(wrapper);

    const fallback = createMediaIcon('media-icon media-icon-fallback hidden');
    div.appendChild(fallback);
    thumbnail.addEventListener('error', () => {
      wrapper.classList.add('hidden');
      fallback.classList.remove('hidden');
    });
  } else {
    div.appendChild(createMediaIcon('media-icon'));
  }

  const info = document.createElement('div');
  info.className = 'media-info';

  const type = document.createElement('div');
  type.className = 'media-type';
  type.textContent = getTypeLabel(video.type);
  info.appendChild(type);

  const title = document.createElement('div');
  title.className = 'media-title';
  title.textContent = video.title || 'Unknown Video';
  info.appendChild(title);

  if (durationStr) {
    const duration = document.createElement('div');
    duration.className = 'media-duration';
    duration.textContent = durationStr;
    info.appendChild(duration);
  }

  if (historyEntry) {
    // History rows are denser: one meta line instead of separate type/duration
    // blocks, so the extra controls fit without growing the popup.
    div.classList.add('media-item-history');
    div.draggable = true;
    type.classList.add('hidden');
    if (durationStr) info.querySelector('.media-duration')?.classList.add('hidden');

    // The badge must sit outside the ellipsised text, not inside it.
    const titleText = document.createElement('span');
    titleText.className = 'media-title-text';
    titleText.textContent = video.title || 'Unknown Video';
    title.textContent = '';
    title.classList.add('media-title-row');
    title.appendChild(titleText);

    if (historyEntry.downloaded) {
      const badge = document.createElement('span');
      badge.className = 'downloaded-badge';
      badge.textContent = '✓';
      badge.title = 'Already downloaded';
      badge.setAttribute('aria-label', 'Already downloaded');
      title.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'media-meta';
    meta.textContent = [
      getTypeLabel(video.type),
      durationStr,
      getSiteLabel(historyEntry.pageUrl),
      formatRelativeTime(historyEntry.detectedAt)
    ].filter(Boolean).join(' · ');
    if (historyEntry.pageUrl) div.title = historyEntry.pageUrl;
    info.appendChild(meta);

    div.prepend(createDragHandle());
    attachDragBehaviour(div, historyEntry);
  }

  div.appendChild(info);

  if (historyEntry) {
    const rename = createIconButton('rename', 'Rename', 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z');
    rename.classList.add('rename-btn');
    rename.addEventListener('click', (event) => {
      event.stopPropagation();
      startRename(div, historyEntry);
    });
    div.appendChild(rename);
  }

  div.addEventListener('click', () => selectMedia(video, div));
  div.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectMedia(video, div);
    }
  });
  
  return div;
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
 * Select a media item and show quality options
 */
function selectMedia(video: VideoInfo, element: HTMLElement): void {
  // Remove previous selection
  document.querySelectorAll('.media-item').forEach(el => {
    el.classList.remove('selected');
    el.setAttribute('aria-selected', 'false');
  });
  
  // Select this one
  element.classList.add('selected');
  element.setAttribute('aria-selected', 'true');
  
  selectedVideo = video;
  
  // Show media details with quality options
  const mediaDetails = document.getElementById('media-details')!;
  const downloadSection = document.getElementById('download-section')!;
  
  document.getElementById('media-title')!.textContent = video.title || 'Unknown Video';
  
  // Convert qualities to options
  currentQualities = video.qualities.map(q => ({
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
  
  // If no qualities from detection, use direct URL
  if (currentQualities.length === 0 && video.type !== 'ytdlp') {
    currentQualities = [{
      label: 'Direct',
      bandwidth: 0,
      bandwidthLabel: 'Unknown',
      url: video.url,
      sizeLabel: video.fileSize ? formatFileSize(video.fileSize) : undefined
    }];
  }
  
  renderQualityList();
  
  mediaDetails.classList.remove('hidden');
  downloadSection.classList.remove('hidden');
  
  // Set default filename
  const filenameInput = document.getElementById('filename') as HTMLInputElement;
  if (filenameInput) {
    const suffix = currentQualities[0]?.label ? `_${currentQualities[0].label}` : '';
    filenameInput.value = `${video.title || 'video'}${suffix}`;
  }
}

/**
 * Render quality selection list
 */
function renderQualityList(): void {
  const container = document.getElementById('quality-list')!;
  const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement | null;
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
  
  quickOptions.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const quality = target.dataset.quality;
      
      if (quality === 'best') {
        selectQuality(0);
      } else if (quality === 'worst') {
        const index = findLowestVideoQualityIndex();
        selectQuality(index >= 0 ? index : currentQualities.length - 1);
      }
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
  
  // Select quality based on defaultQuality setting
  loadSettings().then(settings => {
    if (settings.defaultQuality === 'worst') {
      selectQuality(currentQualities.length - 1);
    } else {
      selectQuality(0);
    }
  }).catch(() => selectQuality(0));
}

/**
 * Select a quality option
 */
function selectQuality(index: number): void {
  if (index < 0 || index >= currentQualities.length) return;
  selectedQualityIndex = index;
  
  // Update visual selection
  document.querySelectorAll('.quality-option').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
    const radio = el.querySelector('input[type="radio"]') as HTMLInputElement;
    if (radio) {
      radio.checked = i === index;
      radio.tabIndex = i === index ? 0 : -1;
      radio.setAttribute('aria-checked', String(i === index));
    }
  });
  
  // Update filename with selected quality
  if (selectedVideo) {
    const quality = currentQualities[index];
    const filenameInput = document.getElementById('filename') as HTMLInputElement;
    if (filenameInput) {
      filenameInput.value = `${selectedVideo.title || 'video'}_${quality.label}`;
    }
  }
}

/**
 * Start a download
 */
function startDownload(video: VideoInfo, quality: QualityOption): void {
  const filenameInput = document.getElementById('filename') as HTMLInputElement;
  const filename = filenameInput?.value || `${video.title || 'video'}`;
  
  // Show progress UI
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

function showDownloadingUI(): void {
  const emptyState = document.getElementById('empty-state')!;
  const videoList = document.getElementById('video-list')!;
  const mediaDetails = document.getElementById('media-details')!;
  const downloadSection = document.getElementById('download-section')!;
  const downloadProgress = document.getElementById('download-progress')!;
  const error = document.getElementById('error')!;
  
  emptyState.classList.add('hidden');
  videoList.classList.add('hidden');
  mediaDetails.classList.add('hidden');
  downloadSection.classList.add('hidden');
  error.classList.add('hidden');
  downloadProgress.classList.remove('hidden');
  updateStatus('Downloading…', 'info');
  document.getElementById('cancel-btn')?.focus();
  
  // Reset progress
  updateProgressUI({ percent: 0, speed: 0 });
}

function restoreDownloadUI(downloadId: string, filename: string, progress: any): void {
  currentDownloadId = downloadId;

  const emptyState = document.getElementById('empty-state')!;
  const videoList = document.getElementById('video-list')!;
  const mediaDetails = document.getElementById('media-details')!;
  const downloadSection = document.getElementById('download-section')!;
  const downloadProgress = document.getElementById('download-progress')!;
  const error = document.getElementById('error')!;

  emptyState.classList.add('hidden');
  videoList.classList.add('hidden');
  mediaDetails.classList.add('hidden');
  downloadSection.classList.add('hidden');
  error.classList.add('hidden');
  downloadProgress.classList.remove('hidden');

  const filenameEl = document.getElementById('progress-filename');
  if (filenameEl && filename) {
    filenameEl.textContent = filename;
  }

  updateProgressUI(progress || { percent: 0 });
  updateStatus('Downloading…', 'info');
  document.getElementById('cancel-btn')?.focus();
}

function showDownloadStarted(downloadId: string): void {
  currentDownloadId = downloadId;
  updateStatus('Download started…', 'info');
}

function updateProgressUI(progress: any): void {
  const fill = document.getElementById('progress-fill');
  const percentEl = document.getElementById('progress-percent');
  const speedEl = document.getElementById('progress-speed');
  const etaEl = document.getElementById('progress-eta');

  if (speedEl) speedEl.textContent = '';
  if (etaEl) etaEl.textContent = '';

  const percent = typeof progress.percent === 'number' && Number.isFinite(progress.percent)
    ? progress.percent
    : 0;
  const measuredPercent = Math.min(100, Math.max(0, percent));
  const hasMeasuredProgress = percent > 0;

  if (fill) {
    if (hasMeasuredProgress) {
      fill.classList.remove('indeterminate');
      fill.style.width = `${measuredPercent}%`;
      fill.setAttribute('aria-valuenow', String(measuredPercent));
      fill.setAttribute('aria-valuetext', `${Math.round(measuredPercent)}%`);
    } else {
      fill.classList.add('indeterminate');
      fill.style.width = '35%';
      fill.removeAttribute('aria-valuenow');
      fill.setAttribute('aria-valuetext', 'Downloading…');
    }
  }

  if (percentEl) {
    percentEl.textContent = hasMeasuredProgress ? `${Math.round(measuredPercent)}%` : '…';
  }

  // Handle FFmpeg speed (string like "1.5x") vs direct download (bytes)
  if (speedEl && progress.speed) {
    if (typeof progress.speed === 'string') {
      const label = progress.speed.trim().toLowerCase().endsWith('x')
        ? 'Processing speed'
        : 'Download speed';
      speedEl.textContent = `${label}: ${progress.speed}`;
    } else if (typeof progress.speed === 'number' && progress.speed > 0) {
      speedEl.textContent = `Download speed: ${formatSpeed(progress.speed)}`;
    }
  }

  // Handle direct download byte progress
  if (speedEl && progress.bytesReceived !== undefined && progress.totalBytes > 0) {
    const mbReceived = (progress.bytesReceived / 1000000).toFixed(1);
    const mbTotal = (progress.totalBytes / 1000000).toFixed(1);
    speedEl.textContent = `${mbReceived} / ${mbTotal} MB`;
  }

  if (etaEl && progress.eta) {
    etaEl.textContent = formatETA(progress.eta);
  }
}

function showDownloadComplete(): void {
  currentDownloadId = null;
  updateStatus('Download complete!', 'success');
  
  const downloadProgress = document.getElementById('download-progress')!;
  const fill = document.getElementById('progress-fill');
  
  updateProgressUI({ percent: 100 });
  if (fill) fill.style.background = 'var(--success)';
  
  // Auto close after 2 seconds
  setTimeout(() => {
    resetUI();
    requestMediaList();
    document.getElementById('settings-btn')?.focus();
  }, 2000);
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
  const emptyState = document.getElementById('empty-state')!;
  const videoList = document.getElementById('video-list')!;
  const mediaDetails = document.getElementById('media-details')!;
  const downloadSection = document.getElementById('download-section')!;
  const downloadProgress = document.getElementById('download-progress')!;
  const error = document.getElementById('error')!;
  const fill = document.getElementById('progress-fill');
  
  emptyState.classList.add('hidden');
  videoList.classList.remove('hidden');
  mediaDetails.classList.add('hidden');
  downloadSection.classList.add('hidden');
  downloadProgress.classList.add('hidden');
  error.classList.add('hidden');
  
  if (fill) {
    fill.classList.remove('indeterminate');
    fill.style.width = '0%';
    fill.style.background = 'var(--accent)';
  }

  const selectedElement = document.querySelector('.media-item.selected') as HTMLElement | null;
  (selectedElement || document.getElementById('settings-btn'))?.focus();
}

function showError(message: string): void {
  currentDownloadId = null;
  const errorEl = document.getElementById('error')!;
  const errorMsgEl = document.getElementById('error-message')!;
  
  if (errorMsgEl) errorMsgEl.textContent = message;
  errorEl.classList.remove('hidden');
  
  const downloadProgress = document.getElementById('download-progress')!;
  downloadProgress.classList.add('hidden');
  
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
