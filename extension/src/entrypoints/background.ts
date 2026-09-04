// Flux Downloader Service Worker (Background Script)
// Manifest V3 — webRequest, media detection, download orchestration.

import { NativeClient } from '../download/native-client';
import { VideoInfo, HistoryEntry } from '../shared/types';
import { M3U8ParserWrapper } from '../detection/m3u8-parser';
import { DashParserWrapper } from '../detection/dash-parser';
import { loadSettings, Settings, DEFAULT_SETTINGS } from '../shared/settings';
import { videoKey } from '../detection/video-key';
import { PageMetadata, TabStateStore } from '../catalog/tab-state';
import { HistoryStore } from '../catalog/history-store';
import { isMediaUrl, isYouTubeUrl, mediaTypeFromUrl } from '../detection/media-url';
import {
  mergeChildUrls,
  mergeQualities,
  upsertDetectedVideo,
  visibleVideos
} from '../catalog/video-catalog';
import {
  getContentType,
  getFfmpegHttpArgs,
  getMediaTypeFromContentType,
  getRequestReferer
} from '../detection/http-media';
import {
  ensureFilenameExtension,
  formatFfmpegError,
  getDefaultExtension,
  joinOutputPath,
  pickBatchQuality,
  sanitizeFilename
} from '../download/download-plan';
import { describeCoAppError, isCoAppUnreachable } from '../shared/errors';
import { isPopupRequest } from '../shared/popup-protocol';
import type {
  PopupMessage,
  PopupRequest
} from '../shared/popup-protocol';
import { isRuntimeRequest } from '../shared/content-protocol';
import type {
  DetectedVideo,
  MediaUrlMapMessage,
  RuntimeRequest
} from '../shared/content-protocol';
import { applyPageMetadataToVideos, mergePageMetadata } from '../detection/page-context';
import { buildYtdlpVideo, fallbackYtdlpQualities } from '../detection/youtube';
import { inferRelayCodec, mergeRelayCodecs, resolveRelayUrl } from '../detection/relay-codec';
import { DownloadTracker } from '../download/download-tracker';
import type { ActiveDownload } from '../download/download-tracker';
import { buildDashQualities, buildHlsQualities } from '../detection/manifest-qualities';
import { rewriteHlsManifestUris } from '../download/hls-rewrite';
import { BatchRun } from '../download/batch-run';
import { DownloadRunGate } from '../download/download-run-gate';
import type { DownloadLease } from '../download/download-run-gate';
import { prepareHlsInputArguments } from '../download/hls-arguments';
import type { ManifestFile } from '../download/hls-arguments';

const nativeClient = new NativeClient();

const tabStates = new TabStateStore();

function resetTabState(tabId: number): void {
  tabStates.resetPage(tabId);
  chrome.action.setBadgeText({ tabId, text: '' }, () => { void chrome.runtime.lastError; });
}

function learnRelayCodec(tabId: number, originalUrl: string, relayUrl: string): void {
  const learned = inferRelayCodec(originalUrl, relayUrl);
  if (!learned) return;

  const state = tabStates.ensure(tabId);
  const mappings = state.relayMappings || new Map<string, string>();
  mappings.set(learned.originalUrl, learned.relayUrl);
  state.relayMappings = mappings;

  const codecs = state.relayCodecs || new Map();
  const merged = mergeRelayCodecs(codecs.get(learned.originalOrigin), learned.codec);
  if (!merged) return;
  codecs.set(learned.originalOrigin, merged);
  state.relayCodecs = codecs;
}

function getRelayUrl(tabId: number, originalUrl: string): string | undefined {
  const state = tabStates.get(tabId);
  return resolveRelayUrl(originalUrl, state?.relayMappings, state?.relayCodecs);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined) {
    tabStates.ensure(tabId).currentPageUrl = changeInfo.url;
  }
  if (changeInfo.status === 'loading' || changeInfo.url !== undefined) {
    tabStates.ensure(tabId).navigationGeneration = undefined;
    resetTabState(tabId);
    // An open popup should stop showing that tab's videos as current.
    notifyPopups();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  notifyPopups();
});

const activeDownloads = new DownloadTracker();
const downloadRunGate = new DownloadRunGate();

interface DownloadRunContext {
  lease: DownloadLease;
  releaseOnFinish: boolean;
}

const downloadRunByKey = new Map<string, DownloadRunContext>();

function trackDownload(
  key: string,
  download: ActiveDownload,
  run: DownloadRunContext
): void {
  activeDownloads.set(key, download);
  downloadRunByKey.set(key, run);
}

function finishDownload(key: string, succeeded: boolean): void {
  const tracked = activeDownloads.finish(key, succeeded);
  if (!tracked) return;
  const run = downloadRunByKey.get(key);
  downloadRunByKey.delete(key);
  if (run?.releaseOnFinish) downloadRunGate.release(run.lease);
  const sourceUrl = tracked?.sourceUrl || tracked?.video?.url;
  if (succeeded && sourceUrl) {
    history.markDownloaded(sourceUrl).catch(() => { /* marker is best-effort */ });
  }
}

function waitForDownload(key: string): Promise<boolean> {
  return activeDownloads.wait(key);
}

// Popup connections
const popupPorts = new Set<chrome.runtime.Port>();

function postPopup(port: chrome.runtime.Port, message: PopupMessage): void {
  try {
    port.postMessage(message);
  } catch {
    popupPorts.delete(port);
  }
}

// Default download directory (sent by CoApp or fallback)
let defaultDownloadDir = '';
let coappPlatform = '';
let cachedSettings: Settings | null = null;

async function getSettings(): Promise<Settings> {
  if (!cachedSettings) {
    cachedSettings = await loadSettings();
  }
  return cachedSettings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    // Merge over the defaults: a settings object saved by an older build has
    // no keepHistory, and an undefined flag must not read as "off".
    cachedSettings = changes.settings.newValue
      ? { ...DEFAULT_SETTINGS, ...changes.settings.newValue }
      : null;
  }
});

function notify(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
    title: `Flux — ${title}`,
    message
  });
}

// Register handlers for CoApp → extension calls (push progress)
nativeClient.listen({
  // FFmpeg progress push: (progressTime, currentSeconds, info)
  convertOutput: (progressTime: number, currentSeconds: number, info: any) => {
    for (const [key, dl] of activeDownloads) {
      if (!activeDownloads.isRunning(key)) continue;
      if (!dl.video) continue;
      if (dl.type !== 'convert' && dl.type !== 'ytdlp') continue;
      const duration = dl.video.duration || 0;
      const percent = info?.percent != null
        ? Math.min(100, info.percent)
        : duration > 0 ? Math.min(100, (currentSeconds / duration) * 100) : 0;
      dl.lastProgress = { percent, speed: info?.speed || '', eta: info?.eta };
      popupPorts.forEach(port => {
        postPopup(port, {
          type: 'DOWNLOAD_PROGRESS',
          downloadId: key,
          progress: { percent, currentSeconds, speed: info?.speed || '', eta: info?.eta, bitrate: info?.bitrate || '' }
        });
      });
    }
  },

  // CoApp tells us the ffmpeg PID for a convert operation
  convertStartNotification: (startHandler: any, pid: number) => {
    const key = String(startHandler);
    const keyedDownload = activeDownloads.get(key);
    if (keyedDownload && keyedDownload.type === 'convert') {
      keyedDownload.pid = pid;
      if (activeDownloads.cancelledType(key)) {
        void nativeClient.abortConvert(pid).finally(() => finishDownload(key, false));
      }
      return;
    }
    if (keyedDownload && keyedDownload.type === 'ytdlp') {
      keyedDownload.pid = pid;
      if (activeDownloads.cancelledType(key)) {
        void nativeClient.abortYtdlp(pid).finally(() => finishDownload(key, false));
      }
      return;
    }

    // Stop a process whose PID arrived just after an early cancellation.
    const cancelledType = activeDownloads.cancelledType(key);
    if (cancelledType === 'convert') void nativeClient.abortConvert(pid).catch(() => {});
    if (cancelledType === 'ytdlp') void nativeClient.abortYtdlp(pid).catch(() => {});

    // Fallback for older CoApp calls without startHandler.
    for (const dl of activeDownloads.values()) {
      if (dl.type === 'convert' && dl.pid === undefined) {
        dl.pid = pid;
        break;
      }
    }
  },

  // Direct download complete (pushed by CoApp)
  downloadComplete: (downloadId: number, outputPath: string) => {
    const key = `direct_${downloadId}`;
    if (activeDownloads.isRunning(key)) {
      popupPorts.forEach(port => {
        postPopup(port, { type: 'DOWNLOAD_COMPLETE', downloadId: key, outputPath });
      });
      finishDownload(key, true);
    }
  },

  // Direct download error (pushed by CoApp)
  downloadError: (downloadId: number, error: string) => {
    const key = `direct_${downloadId}`;
    if (!activeDownloads.isRunning(key)) return;
    popupPorts.forEach(port => {
      postPopup(port, { type: 'DOWNLOAD_ERROR', downloadId: key, error });
    });
    finishDownload(key, false);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Flux] Extension installed');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Flux] Service worker starting');
});

// --- Media detection via webRequest (works in MV3 service worker) ---

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(details.url);
    } catch {
      return;
    }

    if (!isMediaUrl(parsedUrl)) return;

    void handleInterceptedMedia(details.tabId, details.url, undefined, getRequestReferer(details.initiator));
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.statusCode < 200 || details.statusCode >= 300) return;

    const type = getMediaTypeFromContentType(getContentType(details.responseHeaders));
    if (type) {
      void handleInterceptedMedia(details.tabId, details.url, type, getRequestReferer(details.initiator));
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

function generateVideoId(url: string): string {
  // Safe base64 for non-ASCII URLs
  try {
    return `video_${btoa(encodeURIComponent(url)).substring(0, 20)}_${Date.now()}`;
  } catch {
    return `video_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
  }
}

function commitVideos(tabId: number, videos: VideoInfo[]): void {
  tabStates.ensure(tabId).media = videos;
  const visible = getVisibleVideosForTab(tabId);
  const visibleCount = visible.length;
  chrome.action.setBadgeText({ tabId, text: visibleCount > 0 ? String(visibleCount) : '' });
  if (visibleCount > 0) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
  }
  recordHistory(tabId, visible);
  notifyPopups(tabId);
}

// --- Detection history (global, persisted across reloads and restarts) ---

// Switching history off is destructive by design — the user asked for the
// list to hold only what is playing — so react the moment it is saved.
let lastKeepHistory: boolean | null = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const keep = changes.settings.newValue?.keepHistory !== false;
  if (keep === lastKeepHistory) return;
  lastKeepHistory = keep;
  if (!keep) history.schedulePruneIfOff();
});

const history = new HistoryStore({
  currentKeys: () => currentMediaPayload().currentKeys,
  keepHistory: async () => (await getSettings()).keepHistory,
  broadcast: (entries) => {
    popupPorts.forEach((port) => postPopup(port, { type: 'HISTORY_LIST', entries }));
  }
});

/** Records what a tab is playing, tagged with that tab's page identity. */
function recordHistory(tabId: number, videos: VideoInfo[]): Promise<void> {
  const state = tabStates.get(tabId);
  const metadata = state?.pageMetadata;
  return history.record(videos, {
    pageUrl: metadata?.pageUrl || state?.currentPageUrl || undefined,
    pageTitle: metadata?.title
  });
}

function renameDetectedVideo(tabId: number | undefined, key: string, title: string): void {
  const trimmed = title.trim();
  if (typeof tabId !== 'number' || !trimmed) return;
  const videos = tabStates.get(tabId)?.media;
  if (!videos?.length) return;

  let changed = false;
  const next = videos.map((video) => {
    if (videoKey(video.url) !== key || video.title === trimmed) return video;
    changed = true;
    return { ...video, title: trimmed };
  });
  if (changed) commitVideos(tabId, next);
}

// Statuses a signed CDN returns once a link's token has expired.
const EXPIRED_LINK_STATUSES = new Set([401, 403, 404, 410]);

// Returns undefined when the check itself couldn't run — never block a
// download because the probe failed.
async function probeLinkStatus(url: string, referer?: string): Promise<number | undefined> {
  try {
    const result = await nativeClient.probeStatus(url, referer);
    return typeof result?.status === 'number' ? result.status : undefined;
  } catch {
    return undefined;
  }
}

// --- Batch download ("Download all" from history) ---

let batch: BatchRun | null = null;

function broadcastBatch(): void {
  popupPorts.forEach((port) => {
    postPopup(port, { type: 'BATCH_STATUS', batch: batch?.snapshot() || null });
  });
}

// Downloads run one at a time: ffmpeg is network-bound and parallel pulls from
// the same CDN tend to get throttled.
async function runBatchDownload(videos: VideoInfo[], tabId?: number, quality?: 'best' | 'worst'): Promise<void> {
  if (batch) return;
  const lease = downloadRunGate.acquire('batch');
  if (!lease) {
    popupPorts.forEach((port) => postPopup(port, {
      type: 'ERROR',
      message: 'Another download is already running.'
    }));
    return;
  }
  const run: DownloadRunContext = { lease, releaseOnFinish: false };

  // Each run drops its files in its own folder, stamped with the epoch
  // milliseconds so two runs in the same second can't collide.
  const folder = `Flux_${Date.now()}`;
  const state = new BatchRun(videos, folder);
  // Reserve the batch before the first await so two requests cannot both pass
  // the guard while settings or directory creation is pending.
  batch = state;
  broadcastBatch();

  let result: ReturnType<BatchRun['snapshot']> | undefined;
  try {
    const settings = await getSettings();
    const preference = quality || settings.batchQuality;
    const directory = joinOutputPath(defaultDownloadDir, folder, coappPlatform);
    try {
      await nativeClient.ensureDir(directory);
    } catch (error: unknown) {
      // A missing CoApp surfaces here first, so say that rather than blaming
      // the folder this run happened to be creating.
      const message = isCoAppUnreachable(error)
        ? describeCoAppError(error)
        : `Could not create ${folder}: ${describeCoAppError(error)}`;
      popupPorts.forEach((port) => postPopup(port, { type: 'ERROR', message }));
      return;
    }

    for (const video of videos) {
      if (state.cancelled) break;
      const chosen = pickBatchQuality(video, preference);
      if (!chosen) {
        state.skip(video);
        broadcastBatch();
        continue;
      }

      state.begin(video);
      broadcastBatch();

      try {
        const started = await startDownload(
          { ...video, url: chosen.url, qualities: [chosen] },
          run,
          video.title,
          tabId,
          video.url,
          true,
          directory
        );
        const downloadId = started?.downloadId;
        const cancelLateStart = state.attachDownload(downloadId);
        if (cancelLateStart && downloadId) {
          await handleCancelDownload(downloadId).catch(() => { /* already finished */ });
        }
        const succeeded = downloadId ? await waitForDownload(downloadId) : false;
        const outcome = state.complete(video, succeeded);
        if (outcome.markFailed) {
          await history.markFailed(video.url).catch(() => { /* badge is best-effort */ });
        }
      } catch (error: any) {
        const outcome = state.complete(video, false);
        if (outcome.markFailed) {
          await history.markFailed(video.url).catch(() => { /* badge is best-effort */ });
        }
        const message = error?.message || String(error);
        popupPorts.forEach((port) => {
          postPopup(port, { type: 'ERROR', message: `${video.title}: ${message}` });
        });
      }
      broadcastBatch();
    }

    result = state.snapshot();
  } finally {
    if (batch === state) batch = null;
    downloadRunGate.release(lease);
    broadcastBatch();
  }

  if (!result) return;
  notify(
    result.cancelled ? 'Batch download cancelled' : 'Batch download finished',
    `${result.completed} downloaded, ${result.failed} failed`
  );
}

// Cancels only the batch's own download — a manually started one keeps running.
async function cancelBatchDownload(): Promise<void> {
  if (!batch) return;
  const key = batch.cancel();
  broadcastBatch();
  if (key) {
    try { await handleCancelDownload(key); } catch { /* already finished */ }
  }
}

function getVisibleVideosForTab(tabId: number): VideoInfo[] {
  const state = tabStates.get(tabId);
  return visibleVideos(state?.media || [], state?.pageMetadata?.pageUrl);
}

function upsertVideo(tabId: number, video: VideoInfo): void {
  const state = tabStates.ensure(tabId);
  // A media URL often belongs to a CDN or embedded player. Ownership always
  // follows the top-level page whose tab exposed it.
  const previous = state.media || [];
  const videos = upsertDetectedVideo(
    previous,
    video,
    state.pageMetadata?.pageUrl || state.currentPageUrl || video.pageUrl || undefined
  );
  if (videos !== previous) commitVideos(tabId, videos);
}

async function getTabTitle(tabId: number): Promise<string> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      resolve(tab?.title || 'Detected media');
    });
  });
}

async function handleInterceptedMedia(
  tabId: number,
  url: string,
  forcedType?: VideoInfo['type'],
  requestReferer?: string
): Promise<void> {
  const state = tabStates.ensure(tabId);
  const generation = state.pageGeneration;
  const seen = state.interceptedMedia || new Set<string>();
  if (seen.has(url)) return;
  seen.add(url);
  state.interceptedMedia = seen;

  const metadata = state.pageMetadata;
  const title = metadata?.title || await getTabTitle(tabId);
  if (!tabStates.isCurrentPageGeneration(tabId, generation)) return;
  const type = forcedType || mediaTypeFromUrl(url);
  const referer = requestReferer || metadata?.pageUrl;

  // Deduplicate HLS/DASH manifests from redirect chains (same path, different CDN host)
  if (type === 'hls' || type === 'dash') {
    let urlPath: string;
    try { urlPath = new URL(url).pathname; } catch { urlPath = url; }
    const existing = (tabStates.get(tabId)?.media || []).find(v =>
      v.type === type && (() => { try { return new URL(v.url).pathname === urlPath; } catch { return false; } })()
    );
    if (existing) return;
  }

  let qualities: VideoInfo['qualities'] = [];
  let childUrls: string[] | undefined;
  let duration: number | undefined;
  let fileSize: number | undefined;

  if (type === 'hls') {
    try {
      const parsed = await M3U8ParserWrapper.fetchAndParse(url, referer);
      duration = parsed.duration;
      childUrls = parsed.childUrls;
      qualities = buildHlsQualities(parsed, referer);

      // Fallback: fetch media playlist for duration if master had none
      if (!duration && parsed.variants.length > 0) {
        try {
          const mediaPlaylist = await M3U8ParserWrapper.fetchAndParse(parsed.variants[0].url, referer);
          duration = mediaPlaylist.duration;
        } catch {
          // ignore
        }
      }
    } catch (error) {
      console.warn('[Flux] Failed to parse HLS manifest:', error);
      seen.delete(url);
      return;
    }
  }

  if (type === 'dash') {
    try {
      const parsed = await DashParserWrapper.fetchAndParse(url, referer);
      duration = parsed.duration;
      childUrls = parsed.childUrls;
      qualities = buildDashQualities(parsed);
    } catch (error) {
      console.warn('[Flux] Failed to parse DASH manifest:', error);
    }
  }

  if (type === 'mp4' || type === 'webm') {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      if (contentLength) fileSize = parseInt(contentLength, 10);
    } catch {
      // ignore — some servers don't support HEAD
    }

    try {
      await ensureCoAppConnected();
      const probe = await nativeClient.probe(url, true);
      const vStream = probe?.streams?.find((s: any) => s.codec_type === 'video');
      if (vStream) {
        const height = parseInt(vStream.height, 10) || 0;
        const width = parseInt(vStream.width, 10) || 0;
        qualities = [{
          height,
          width: width || undefined,
          bitrate: 0,
          url,
          label: M3U8ParserWrapper.getQualityName(height)
        }];
      }
      if (probe?.format?.duration) {
        duration = parseFloat(probe.format.duration);
      }
      if (probe?.format?.size && !fileSize) {
        fileSize = parseInt(probe.format.size, 10);
      }
    } catch {
      // ffprobe unavailable or URL unreachable — keep HEAD-only result
    }
  }

  if (!tabStates.isCurrentPageGeneration(tabId, generation)) return;
  upsertVideo(tabId, {
    id: generateVideoId(url),
    title,
    url,
    type,
    qualities,
    childUrls,
    referer,
    pageUrl: metadata?.pageUrl || state.currentPageUrl || undefined,
    duration: duration || metadata?.duration,
    thumbnail: metadata?.thumbnail,
    fileSize
  });

  console.log('[Flux] Intercepted media:', url, type);
}

// --- Popup communication ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port);

    port.onMessage.addListener((message) => {
      if (isPopupRequest(message)) handlePopupMessage(port, message);
    });

    port.onDisconnect.addListener(() => {
      popupPorts.delete(port);
    });
  }
});

function handlePopupMessage(port: chrome.runtime.Port, msg: PopupRequest): void {
  switch (msg.type) {
    case 'GET_MEDIA':
      postPopup(port, { type: 'MEDIA_LIST', ...currentMediaPayload() });
      // Nothing known usually means this worker was restarted and lost the
      // map, not that the tabs are empty — ask them to say again.
      if (!tabStates.hasMediaState()) void rescanAllTabs();
      break;

    case 'REFRESH_TABS':
      refreshOpenTabs()
        .catch((error) => console.warn('[Flux] Failed to refresh open tabs:', error))
        .then(() => {
          postPopup(port, { type: 'MEDIA_LIST', ...currentMediaPayload() });
          return history.settled()
            .then(() => history.read())
            .then((entries) => history.decorate(entries))
            .then((entries) => postPopup(port, { type: 'HISTORY_LIST', entries }));
        })
        .catch((error) => console.warn('[Flux] Failed to send refreshed history:', error));
      break;

    case 'DOWNLOAD':
      {
        const lease = downloadRunGate.acquire('single');
        if (!lease) {
          postPopup(port, { type: 'ERROR', message: 'Another download is already running.' });
          break;
        }
        const run: DownloadRunContext = { lease, releaseOnFinish: true };
        startDownload(msg.video, run, msg.filename, msg.tabId, msg.sourceUrl, msg.checkFreshness)
          .then(result => postPopup(port, { type: 'DOWNLOAD_STARTED', ...result }))
          .catch(err => {
            downloadRunGate.release(lease);
            postPopup(port, { type: 'ERROR', message: describeCoAppError(err) });
          });
      }
      break;

    case 'CANCEL_DOWNLOAD':
      handleCancelDownload(msg.downloadId)
        .then(result => postPopup(port, { type: 'DOWNLOAD_CANCELLED', ...result }))
        .catch(err => postPopup(port, { type: 'ERROR', message: describeCoAppError(err) }));
      break;

    case 'GET_HISTORY':
      history.schedulePruneIfOff();
      history.settled()
        .then(() => history.read())
        .then((entries) => history.decorate(entries))
        .then((entries) => postPopup(port, { type: 'HISTORY_LIST', entries }))
        .catch(() => postPopup(port, { type: 'HISTORY_LIST', entries: [] }));
      break;

    case 'RENAME_HISTORY_ITEM':
      history.rename(msg.key, msg.title || '')
        .catch((error) => console.warn('[Flux] Failed to rename history entry:', error));
      break;

    case 'REORDER_HISTORY':
      history.reorder(msg.keys || [])
        .catch((error) => console.warn('[Flux] Failed to reorder history:', error));
      break;

    case 'RENAME_VIDEO':
      renameDetectedVideo(msg.tabId, msg.key, msg.title || '');
      break;

    case 'DELETE_HISTORY_ITEMS':
      history.remove(msg.keys || [])
        .catch((error) => console.warn('[Flux] Failed to delete history entries:', error));
      break;

    case 'CLEAR_HISTORY':
      history.clear()
        .catch((error) => console.warn('[Flux] Failed to clear history:', error));
      break;

    case 'DOWNLOAD_ALL':
      runBatchDownload(msg.videos || [], msg.tabId, msg.quality)
        .catch((err) => postPopup(port, { type: 'ERROR', message: describeCoAppError(err) }));
      break;

    case 'CANCEL_BATCH':
      cancelBatchDownload().catch(() => { /* nothing left to cancel */ });
      break;

    case 'GET_BATCH_STATUS':
      postPopup(port, { type: 'BATCH_STATUS', batch: batch?.snapshot() || null });
      break;

    case 'GET_ACTIVE_DOWNLOAD': {
      const tabId = msg.tabId;
      const entry = activeDownloads.findForTab(tabId);
      if (entry) {
        const [key, dl] = entry;
        postPopup(port, {
          type: 'ACTIVE_DOWNLOAD',
          downloadId: key,
          video: dl.video,
          sourceUrl: dl.sourceUrl || dl.video?.url,
          filename: dl.filename,
          progress: dl.lastProgress || { percent: 0 }
        });
      } else {
        postPopup(port, { type: 'NO_ACTIVE_DOWNLOAD' });
      }
      break;
    }
  }
}

function notifyPopups(_tabId?: number): void {
  history.schedulePruneIfOff();
  const payload = currentMediaPayload();
  popupPorts.forEach(port => {
    postPopup(port, { type: 'MEDIA_LIST', ...payload });
  });
}

/**
 * Reinsert anything still playing before asking pages to scan again. Network-
 * only streams may no longer have a discoverable DOM node, but the background
 * still owns their current tab state and can restore a deleted history row.
 */
async function restoreCurrentMediaToHistory(): Promise<void> {
  for (const [tabId] of tabStates.mediaEntries()) {
    void recordHistory(tabId, getVisibleVideosForTab(tabId));
  }
  await history.settled();
}

/** The single refresh path used by the popup for every open browser tab. */
async function refreshOpenTabs(): Promise<void> {
  await restoreCurrentMediaToHistory();
  await rescanAllTabs();
  await history.settled();
}

/**
 * Ask every http(s) tab's content script to re-announce what it has found.
 * Tabs without the content script (chrome:// pages, the web store, tabs open
 * from before an extension reload) simply do not answer.
 */
async function rescanAllTabs(): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number' || !tab.url || !/^https?:/i.test(tab.url)) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
    } catch {
      // No listener in that tab; nothing to collect from it.
    }
  }));
}

// Every video any open tab is showing right now. The popup uses this to pin
// and badge them, so switching tabs needs no reload.
function currentMediaPayload(): { videos: VideoInfo[]; currentKeys: string[] } {
  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  for (const [tabId] of tabStates.mediaEntries()) {
    for (const video of getVisibleVideosForTab(tabId)) {
      const key = videoKey(video.url);
      if (seen.has(key)) continue;
      seen.add(key);
      videos.push(video);
    }
  }
  return { videos, currentKeys: [...seen] };
}

// --- Download orchestration ---

async function ensureCoAppConnected(): Promise<void> {
  if (!nativeClient.connected) {
    await nativeClient.connect();
  }

  if (!defaultDownloadDir) {
    try {
      const info = await nativeClient.info();
      defaultDownloadDir = info?.downloadDir || '';
      coappPlatform = info?.platform || '';
    } catch (error) {
      console.warn('[Flux] Failed to read CoApp info:', error);
    }
  }
}

interface NativeProcessResult {
  exitCode: number;
  stderr: string;
}

function monitorNativeProcess(
  downloadKey: string,
  filename: string,
  operation: Promise<NativeProcessResult>,
  failureMessage: (result: NativeProcessResult) => string,
  outputPath?: string
): void {
  operation.then((result) => {
    if (!activeDownloads.isRunning(downloadKey)) return;
    const succeeded = result.exitCode === 0;
    notify(succeeded ? 'Download complete' : 'Download failed', filename);
    popupPorts.forEach((port) => {
      if (succeeded) {
        postPopup(port, {
          type: 'DOWNLOAD_COMPLETE',
          downloadId: downloadKey,
          ...(outputPath ? { outputPath } : {})
        });
      } else {
        postPopup(port, {
          type: 'DOWNLOAD_ERROR',
          downloadId: downloadKey,
          error: failureMessage(result)
        });
      }
    });
    finishDownload(downloadKey, succeeded);
  }).catch((error) => {
    if (!activeDownloads.isRunning(downloadKey)) return;
    const message = error?.message || String(error);
    notify('Download failed', message);
    popupPorts.forEach((port) => {
      postPopup(port, { type: 'DOWNLOAD_ERROR', downloadId: downloadKey, error: message });
    });
    finishDownload(downloadKey, false);
  });
}

async function rewriteHlsInput(
  tabId: number,
  inputUrl: string,
  referer: string | undefined,
  manifestIndex: number
): Promise<ManifestFile | null> {
  let origin: string;
  try { origin = new URL(inputUrl).origin; } catch { return null; }
  if (!tabStates.get(tabId)?.relayCodecs?.has(origin)) return null;

  const parsed = await M3U8ParserWrapper.fetchAndParse(inputUrl, referer);
  if (parsed.type !== 'media' || !parsed.manifest) return null;

  const manifestUrl = parsed.manifestUrl || inputUrl;
  const rewritten = rewriteHlsManifestUris(
    parsed.manifest,
    manifestUrl,
    (absoluteUrl) => getRelayUrl(tabId, absoluteUrl)
  );

  if (rewritten.rewrittenCount === 0 || rewritten.unresolvedUrls.length > 0) {
    throw new Error('Browser relay mapping is incomplete. Start playback for a few seconds and retry the download.');
  }
  return {
    placeholder: `__MEDIA_GRABBER_HLS_MANIFEST_${manifestIndex}__`,
    content: rewritten.content
  };
}

async function startDownload(
  video: VideoInfo,
  run: DownloadRunContext,
  filename?: string,
  tabId?: number,
  sourceUrl?: string,
  checkFreshness = false,
  directoryOverride?: string
): Promise<any> {
  await ensureCoAppConnected();

  // History links are often hours old; a dead one fails deep inside ffmpeg
  // with an opaque error, so check before starting.
  if (checkFreshness) {
    const status = await probeLinkStatus(video.url, video.referer);
    if (status !== undefined && EXPIRED_LINK_STATUSES.has(status)) {
      throw new Error(`Link expired (HTTP ${status}) — reopen the page to refresh it.`);
    }
  }

  const type = video.type === 'm3u8' ? 'hls' : video.type === 'mpd' ? 'dash' : video.type;
  const directory = directoryOverride || defaultDownloadDir;
  let outFilename = ensureFilenameExtension(
    sanitizeFilename(filename || `${video.title || 'video'}`),
    getDefaultExtension(video, type)
  );
  try {
    outFilename = await nativeClient.uniquePath(directory, outFilename);
  } catch {
    // CoApp unreachable for this check — keep the original name rather than blocking the download.
  }

  if (type === 'hls' || type === 'dash') {
    // FFmpeg convert path
    const isSubtitle = video.qualities[0]?.kind === 'subtitle';
    const codecArg = isSubtitle ? ['-c:s', 'copy'] : ['-c', 'copy'];
    const formatArgs = video.qualities[0]?.formatArgs;
    const downloadKey = `convert_${Date.now()}`;
    const outputPath = joinOutputPath(directory, outFilename, coappPlatform);

    const inputArgs = [...getFfmpegHttpArgs(video.referer), '-i', video.url];
    const baseArgs = formatArgs && formatArgs.length > 0
      ? [...formatArgs, '-y', outputPath]
      : [...inputArgs, ...codecArg, '-y', outputPath];
    const prepared = type === 'hls'
      ? await prepareHlsInputArguments(
        baseArgs,
        (inputUrl, manifestIndex) => rewriteHlsInput(
          tabId ?? -1,
          inputUrl,
          video.referer,
          manifestIndex
        )
      )
      : { args: baseArgs, manifestFiles: [] };

    trackDownload(downloadKey, {
      sourceUrl,
      type: 'convert',
      video,
      directory,
      filename: outFilename,
      tabId
    }, run);

    // Start ffmpeg asynchronously — progress comes via convertOutput push.
    monitorNativeProcess(
      downloadKey,
      outFilename,
      nativeClient.convert(
        prepared.args,
        { progressTime: 1000, startHandler: downloadKey, manifestFiles: prepared.manifestFiles }
      ),
      (result) => formatFfmpegError(result.exitCode, result.stderr),
      outputPath
    );

    return { success: true, downloadId: downloadKey };
  } else if (video.type === 'mse') {
    // MSE stream — use FFmpeg with captured segment URLs if available
    const downloadKey = `convert_${Date.now()}`;
    const outputPath = joinOutputPath(directory, outFilename, coappPlatform);
    const formatArgs = video.qualities[0]?.formatArgs;

    trackDownload(downloadKey, {
      sourceUrl,
      type: 'convert',
      video,
      directory,
      filename: outFilename,
      tabId
    }, run);

    const ffmpegArgs = formatArgs && formatArgs.length > 0
      ? [...formatArgs, '-y', outputPath]
      : ['-i', video.url, '-c', 'copy', '-y', outputPath];

    monitorNativeProcess(
      downloadKey,
      outFilename,
      nativeClient.convert(
        ffmpegArgs,
        { progressTime: 1000, startHandler: downloadKey }
      ),
      (result) => formatFfmpegError(result.exitCode, result.stderr),
      outputPath
    );

    return { success: true, downloadId: downloadKey };
  } else if (video.type === 'ytdlp') {
    // yt-dlp path (YouTube etc.)
    const downloadKey = `ytdlp_${Date.now()}`;
    const formatArgs = video.qualities[0]?.formatArgs || fallbackYtdlpQualities(video.url)[0].formatArgs;

    trackDownload(downloadKey, {
      sourceUrl,
      type: 'ytdlp',
      video,
      directory,
      filename: outFilename,
      tabId
    }, run);

    monitorNativeProcess(
      downloadKey,
      outFilename,
      nativeClient.ytdlp(
        video.url,
        formatArgs,
        { progressTime: 1000, startHandler: downloadKey, outputDir: directory || undefined, filename: outFilename.replace(/\.[^.]+$/, '.%(ext)s') }
      ),
      (result) => `yt-dlp exit code ${result.exitCode}: ${result.stderr}`
    );

    return { success: true, downloadId: downloadKey };
  } else {
    // Direct download path
    const downloadId = await nativeClient.downloadFile({
      url: video.url,
      directory: directory || undefined,
      filename: outFilename
    });

    const downloadKey = `direct_${downloadId}`;
    trackDownload(downloadKey, {
      sourceUrl,
      type: 'direct',
      downloadId,
      video,
      directory,
      filename: outFilename,
      tabId
    }, run);

    // Poll for direct download progress (CoApp pushes complete/error, but we poll for bytes)
    startDirectProgressPolling(downloadKey, downloadId, video.duration);

    return { success: true, downloadId: downloadKey };
  }
}

function startDirectProgressPolling(downloadKey: string, downloadId: number, duration?: number): void {
  const timer = setInterval(async () => {
    if (!activeDownloads.isRunning(downloadKey)) {
      clearInterval(timer);
      return;
    }
    try {
      const results = await nativeClient.searchDownloads(downloadId);
      if (!activeDownloads.isRunning(downloadKey)) {
        clearInterval(timer);
        return;
      }
      if (!results || results.length === 0) {
        clearInterval(timer);
        return;
      }

      const dl = results[0];
      const percent = dl.totalBytes > 0 ? (dl.bytesReceived / dl.totalBytes) * 100 : 0;

      const activeDl = activeDownloads.get(downloadKey);
      if (activeDl) {
        activeDl.lastProgress = { percent, bytesReceived: dl.bytesReceived, totalBytes: dl.totalBytes };
      }

      popupPorts.forEach(port => {
        postPopup(port, {
          type: 'DOWNLOAD_PROGRESS',
          downloadId: downloadKey,
          progress: { percent, bytesReceived: dl.bytesReceived, totalBytes: dl.totalBytes }
        });
      });

      if (dl.state === 'complete') {
        clearInterval(timer);
        finishDownload(downloadKey, true);
      } else if (dl.state === 'interrupted') {
        clearInterval(timer);
        popupPorts.forEach(port => {
          postPopup(port, { type: 'DOWNLOAD_ERROR', downloadId: downloadKey, error: dl.error || 'Download interrupted' });
        });
        finishDownload(downloadKey, false);
      }
    } catch {
      // Single poll failure — don't abort, just skip this tick
    }
  }, 2000);
}

async function handleCancelDownload(downloadId: string): Promise<any> {
  const dl = activeDownloads.beginCancel(downloadId);
  if (!dl) {
    return { success: false, error: 'Download not found' };
  }

  try {
    if (dl.type === 'convert' && dl.pid !== undefined) {
      await nativeClient.abortConvert(dl.pid);
    } else if (dl.type === 'ytdlp' && dl.pid !== undefined) {
      await nativeClient.abortYtdlp(dl.pid);
    } else if (dl.type === 'direct' && dl.downloadId !== undefined) {
      await nativeClient.cancelDownload(dl.downloadId);
    }
  } finally {
    finishDownload(downloadId, false);
  }
  return { success: true };
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeRequest(message)) {
    sendResponse({ error: 'Unknown runtime message' });
    return false;
  }
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'VIDEO_DETECTED':
      return handleVideoDetected(sender.tab?.id, message.video, sender.frameId, sender.url, sender.tab?.url);

    case 'MEDIA_URL_MAP':
      return handleMediaUrlMap(sender.tab?.id, message, sender.frameId, sender.url, sender.tab?.url);

    case 'PAGE_METADATA':
      return handlePageMetadata(sender.tab?.id, message.metadata, sender.frameId, sender.url, sender.tab?.url);

    case 'PAGE_NAVIGATION':
      return handlePageNavigation(sender.tab?.id, message.pageUrl, message.generation, sender.frameId, sender.url, sender.tab?.url);

    case 'GET_VIDEOS':
      return getVideosForTab(message.tabId);

    case 'PING': {
      let connected = false;
      let version: string | undefined;
      let error: string | undefined;
      try {
        // A cold service worker has no connection yet, so a plain "is it
        // connected" check would report a working CoApp as down.
        if (!nativeClient.connected) await nativeClient.connect();
        connected = nativeClient.connected;
        if (connected) {
          const info = await nativeClient.info();
          version = info?.version || 'unknown';
        }
      } catch (err: any) {
        error = err?.message || String(err);
      }
      return { success: true, timestamp: Date.now(), connected, version, error };
    }

  }
}

function currentTopPageUrl(tabId: number, senderTabUrl?: string): string | undefined {
  const state = tabStates.get(tabId);
  const trackedUrl = state?.currentPageUrl;
  if (trackedUrl === null) return undefined;
  if (trackedUrl && senderTabUrl && trackedUrl !== senderTabUrl) return undefined;
  if (trackedUrl) return trackedUrl;
  if (senderTabUrl) {
    tabStates.ensure(tabId).currentPageUrl = senderTabUrl;
    return senderTabUrl;
  }
  return undefined;
}

function isCurrentContentGeneration(tabId: number, generation: unknown, isTopFrame: boolean): boolean {
  if (typeof generation !== 'number' || !Number.isInteger(generation)) return false;

  const state = tabStates.ensure(tabId);
  const knownGeneration = state.navigationGeneration;
  if (knownGeneration === undefined) {
    if (!isTopFrame) return false;
    state.navigationGeneration = generation;
    return true;
  }

  return generation === knownGeneration;
}

function handleVideoDetected(tabId: number | undefined, video: DetectedVideo, frameId?: number, frameUrl?: string, senderTabUrl?: string): any {
  if (tabId === undefined) return { error: 'No tabId' };
  const detectedPageUrl = video.pageUrl;
  const generation = video.generation;
  const currentUrl = currentTopPageUrl(tabId, senderTabUrl);
  if (!detectedPageUrl || !frameUrl || detectedPageUrl !== frameUrl || !currentUrl) {
    return { success: true, stale: true };
  }
  if (frameId === 0 && detectedPageUrl !== currentUrl) {
    return { success: true, stale: true };
  }
  if (!isCurrentContentGeneration(tabId, generation, frameId === 0)) {
    return { success: true, stale: true };
  }
  upsertVideo(tabId, video);
  console.log(`[Flux] Detected video on tab ${tabId}:`, video.title);
  return { success: true, count: (tabStates.get(tabId)?.media || []).length };
}

function handleMediaUrlMap(tabId: number | undefined, mapping: MediaUrlMapMessage, frameId?: number, frameUrl?: string, senderTabUrl?: string): any {
  if (tabId === undefined) return { error: 'No tabId' };
  const currentUrl = currentTopPageUrl(tabId, senderTabUrl);
  if (!mapping.pageUrl || !frameUrl || mapping.pageUrl !== frameUrl || !currentUrl) {
    return { success: true, stale: true };
  }
  if (frameId === 0 && mapping.pageUrl !== currentUrl) {
    return { success: true, stale: true };
  }
  if (!isCurrentContentGeneration(tabId, mapping.generation, frameId === 0)) {
    return { success: true, stale: true };
  }
  if (typeof mapping.originalUrl !== 'string' || typeof mapping.relayUrl !== 'string') {
    return { success: true };
  }

  learnRelayCodec(tabId, mapping.originalUrl, mapping.relayUrl);
  return { success: true };
}

function handlePageNavigation(tabId: number | undefined, pageUrl: string, generation: number, frameId?: number, frameUrl?: string, senderTabUrl?: string): any {
  if (tabId === undefined) return { error: 'No tabId' };
  const currentUrl = currentTopPageUrl(tabId, senderTabUrl);
  if (frameId !== 0 || !pageUrl || !frameUrl || pageUrl !== frameUrl || pageUrl !== senderTabUrl || pageUrl !== currentUrl) {
    return { success: true, stale: true };
  }

  const state = tabStates.ensure(tabId);
  const previousGeneration = state.navigationGeneration;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || (previousGeneration !== undefined && generation <= previousGeneration)) {
    return { success: true, stale: true };
  }

  state.navigationGeneration = generation;
  resetTabState(tabId);
  return { success: true };
}

async function loadYouTubeFormats(tabId: number, url: string, videoId: string, metadata: PageMetadata, generation: number): Promise<void> {
  try {
    await ensureCoAppConnected();
    const info = await nativeClient.ytdlpFormats(url);
    const currentMetadata = tabStates.get(tabId)?.pageMetadata || metadata;
    if (!tabStates.isCurrentPageGeneration(tabId, generation) || currentMetadata.pageUrl !== url) return;

    upsertVideo(tabId, buildYtdlpVideo(videoId, url, currentMetadata, info));
  } catch (error) {
    console.warn('[Flux] Failed to load yt-dlp formats:', error);
    const currentMetadata = tabStates.get(tabId)?.pageMetadata || metadata;
    if (!tabStates.isCurrentPageGeneration(tabId, generation) || currentMetadata.pageUrl !== url) return;
    upsertVideo(tabId, buildYtdlpVideo(videoId, url, currentMetadata));
  }
}

function addYouTubeVideo(tabId: number, metadata: PageMetadata): void {
  const url = metadata.pageUrl!;
  const videoId = `ytdlp_${tabId}`;
  const state = tabStates.ensure(tabId);

  const existing = (state.media || []).find(v => v.id === videoId);
  if (existing) {
    const urlChanged = existing.url !== url;
    const videos = (state.media || []).map(v =>
      v.id === videoId
        ? {
            ...v,
            title: metadata.title || v.title,
            thumbnail: metadata.thumbnail || v.thumbnail,
            duration: metadata.duration || v.duration,
            pageUrl: metadata.pageUrl,
            url,
            qualities: urlChanged ? [] : v.qualities
          }
        : v
    );
    commitVideos(tabId, videos);
  }

  if (state.ytdlpFormatUrl === url) return;
  state.ytdlpFormatUrl = url;
  void loadYouTubeFormats(tabId, url, videoId, metadata, state.pageGeneration);
}

function handlePageMetadata(tabId: number | undefined, metadata: PageMetadata, frameId?: number, frameUrl?: string, senderTabUrl?: string): any {
  if (tabId === undefined) return { error: 'No tabId' };

  const isTopFrame = frameId === 0;
  if (!metadata.pageUrl || !frameUrl || metadata.pageUrl !== frameUrl) {
    return { success: true, stale: true };
  }

  if (isTopFrame) {
    if (!senderTabUrl || metadata.pageUrl !== senderTabUrl) {
      return { success: true, stale: true };
    }

    const state = tabStates.ensure(tabId);
    const trackedUrl = state.currentPageUrl;
    if (trackedUrl === null) {
      return { success: true, stale: true };
    }
    state.currentPageUrl = metadata.pageUrl;
    if (trackedUrl && trackedUrl !== metadata.pageUrl) {
      state.navigationGeneration = undefined;
      resetTabState(tabId);
    }

    if (typeof metadata.generation !== 'number' || !Number.isInteger(metadata.generation)) {
      return { success: true, stale: true };
    }
    if (!isCurrentContentGeneration(tabId, metadata.generation, true)) {
      return { success: true, stale: true };
    }
  } else if (!currentTopPageUrl(tabId, senderTabUrl)) {
    return { success: true, stale: true };
  }

  if (!isTopFrame && !isCurrentContentGeneration(tabId, metadata.generation, false)) {
    return { success: true, stale: true };
  }

  let previous = tabStates.get(tabId)?.pageMetadata || {};
  if (!isTopFrame && !previous.pageUrl) {
    return { success: true, stale: true };
  }
  if (isTopFrame && previous.pageUrl && metadata.pageUrl && previous.pageUrl !== metadata.pageUrl) {
    resetTabState(tabId);
    previous = {};
  }

  const merged = mergePageMetadata(previous, metadata, isTopFrame);

  tabStates.ensure(tabId).pageMetadata = merged;

  if (merged.pageUrl && isYouTubeUrl(merged.pageUrl)) {
    addYouTubeVideo(tabId, merged);
  }

  const videos = tabStates.get(tabId)?.media;
  if (videos?.length) {
    const updated = applyPageMetadataToVideos(videos, merged);

    if (updated !== videos) {
      commitVideos(tabId, updated);
    } else {
      // Source title/URL can arrive after the media itself without changing
      // its thumbnail or duration. Give history a chance to repair context.
      void recordHistory(tabId, videos);
    }
  }

  return { success: true };
}

function getVideosForTab(tabId: number): any {
  return { videos: tabStates.get(tabId)?.media || [] };
}
