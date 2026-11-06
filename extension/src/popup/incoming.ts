import { videoKey } from '../detection/video-key';
import type { Incoming } from './messages';
import type { AppState, BatchStatus, Store } from './state';

/**
 * Everything the background says, folded into the store.
 *
 * Only `remote` is touched here. A detection landing while the user is
 * renaming or picking rows must not disturb either, which is the whole
 * reason the two halves are kept apart.
 */
export function applyIncoming(store: Store, message: Incoming): void {
  switch (message.type) {
    case 'MEDIA_LIST': {
      const keys = new Set(message.currentKeys || []);
      const count = message.videos?.length ?? 0;
      store.setRemote({ currentKeys: keys });
      store.setUi({
        refreshing: false,
        status: {
          text: count === 1 ? '1 media found' : `${count} media found`,
          tone: count > 0 ? 'success' : 'info'
        }
      });
      break;
    }

    case 'HISTORY_LIST':
      store.setRemote({
        history: message.entries || [],
        // A message without `folders` leaves them as they were: an older
        // worker, or the empty fallback sent when reading history failed.
        ...(message.folders ? { folders: message.folders } : {})
      });
      break;

    case 'BATCH_STATUS': {
      const batch = message.batch;
      const previous = store.get().remote;
      if (batch && !previous.batch) store.setUi({ notice: null });
      else if (!batch && previous.batch) endBatch(store, previous.batch);
      const activeKeys = new Set(
        batch?.activeSourceKeys || (batch?.currentSourceKey ? [batch.currentSourceKey] : [])
      );
      const progressByKey = new Map(previous.progressByKey);
      for (const key of progressByKey.keys()) {
        if (!activeKeys.has(key) && key !== previous.manualDownloadKey) progressByKey.delete(key);
      }
      const retainedActive = previous.activeDownloadKey && activeKeys.has(previous.activeDownloadKey)
        ? previous.activeDownloadKey
        : null;
      const activeDownloadKey = batch
        ? retainedActive || batch.currentSourceKey || null
        : previous.manualDownloadKey;
      store.setRemote({
        batch,
        // A finished batch must not clear a one-off download's panel.
        // With the batch gone, the active row is whatever a one-off
        // download is still writing, if anything.
        activeDownloadKey,
        progressByKey,
        progress: activeDownloadKey
          ? progressByKey.get(activeDownloadKey) ||
            (activeDownloadKey === previous.activeDownloadKey ? previous.progress : null)
          : null
      });
      break;
    }

    case 'DOWNLOAD_STARTED':
      if (message.success) {
        store.setRemote({ manualDownloadId: message.downloadId ?? null });
        store.setUi({ notice: null, status: { text: 'Download started…', tone: 'info' } });
      } else {
        finishDownload(store, message.error || 'Download failed');
      }
      break;

    case 'DOWNLOAD_PROGRESS': {
      const detail = message.progress ?? {
        percent: message.percent ?? 0,
        speed: message.speed,
        eta: message.eta,
        bytesReceived: message.bytesReceived,
        totalBytes: message.totalBytes
      };
      const sourceKey = message.sourceKey;
      const progressByKey = new Map(store.get().remote.progressByKey);
      if (sourceKey) progressByKey.set(sourceKey, detail);
      store.setRemote({
        progress: detail,
        progressByKey,
        ...(sourceKey ? { activeDownloadKey: sourceKey } : {})
      });
      break;
    }

    case 'DOWNLOAD_COMPLETE': {
      removeProgress(store, message.sourceKey);
      const insideBatch = store.get().remote.batch !== null;
      clearManualDownload(store);
      // One item of a batch is not "complete": the run is, once all of it is.
      // The batch announces that itself when it ends (see `endBatch`).
      if (!insideBatch) finishRun(store, COMPLETE);
      break;
    }

    case 'DOWNLOAD_ERROR':
      removeProgress(store, message.sourceKey);
      finishDownload(store, message.error || 'Download failed');
      break;

    case 'ACTIVE_DOWNLOAD': {
      // Reopening the popup mid-download has to re-mark the busy row.
      const key = message.sourceUrl ? videoKey(message.sourceUrl) : null;
      const progress = message.progress ?? { percent: 0 };
      const progressByKey = key
        ? new Map(store.get().remote.progressByKey).set(key, progress)
        : store.get().remote.progressByKey;
      if (message.runKind === 'batch') {
        store.setRemote({
          activeDownloadKey: key,
          progress,
          progressByKey
        });
        break;
      }
      store.setRemote({
        manualDownloadId: message.downloadId,
        manualDownloadKey: key,
        activeDownloadKey: key,
        progress,
        progressByKey
      });
      store.setUi({ notice: null, status: { text: 'Downloading…', tone: 'info' } });
      break;
    }

    case 'NO_ACTIVE_DOWNLOAD':
      clearManualDownload(store);
      break;

    case 'ERROR':
      finishDownload(store, message.message);
      break;
  }
}

const COMPLETE = { text: 'Download complete!', tone: 'success' } as const;

/**
 * A run is over and says how it went. The status line is emptied so that, once
 * the notice is dismissed, it does not fall back to a stale "Downloading…".
 */
function finishRun(store: Store, notice: NonNullable<AppState['ui']['notice']>): void {
  store.setUi({ notice, status: { text: '', tone: 'info' } });
}

/** The batch is gone from the background: report it as a whole, not per item. */
function endBatch(store: Store, last: BatchStatus): void {
  if (last.cancelled) {
    store.setUi({ notice: null, status: { text: 'Download cancelled', tone: 'error' } });
  } else if (last.failed > 0) {
    finishRun(store, { text: `${last.completed} downloaded, ${last.failed} failed`, tone: 'error' });
  } else {
    finishRun(store, COMPLETE);
  }
}

/** A one-off download ended: free its row and put the panel away. */
function clearManualDownload(store: Store): void {
  const { batch, manualDownloadKey, progressByKey } = store.get().remote;
  const nextProgress = new Map(progressByKey);
  if (manualDownloadKey) nextProgress.delete(manualDownloadKey);
  const activeDownloadKey = batch?.currentSourceKey || null;
  store.setRemote({
    manualDownloadKey: null,
    manualDownloadId: null,
    activeDownloadKey,
    progressByKey: nextProgress,
    progress: activeDownloadKey ? nextProgress.get(activeDownloadKey) || { percent: 0 } : null
  });
}

function removeProgress(store: Store, sourceKey: string | undefined): void {
  if (!sourceKey) return;
  const progressByKey = new Map(store.get().remote.progressByKey);
  progressByKey.delete(sourceKey);
  store.setRemote({ progressByKey });
}

function finishDownload(store: Store, error: string): void {
  clearManualDownload(store);
  store.setUi({ error, notice: null, status: { text: 'Error', tone: 'error' } });
}
