import { describe, it, expect, beforeEach } from 'vitest';
import type { HistoryEntry } from '../shared/types';
import { applyIncoming } from './incoming';
import { Store } from './state';

const RS9 = 'https://cdn.rs.com/l9/ep12.m3u8';
const RS8 = 'https://cdn.rs.com/l8/aula08.m3u8';
const entry = (url: string): HistoryEntry =>
  ({ id: url, title: url, url, type: 'hls', qualities: [], detectedAt: 0 }) as HistoryEntry;

let store: Store;
beforeEach(() => { store = new Store(); });

describe('MEDIA_LIST', () => {
  it('marks every video the open tabs are playing', () => {
    applyIncoming(store, { type: 'MEDIA_LIST', videos: [], currentKeys: [RS9, RS8] });
    expect([...store.get().remote.currentKeys]).toEqual([RS9, RS8]);
  });

  it('counts what was found', () => {
    applyIncoming(store, { type: 'MEDIA_LIST', videos: [{} as never], currentKeys: [RS9] });
    expect(store.get().ui.status).toEqual({ text: '1 media found', tone: 'success' });

    applyIncoming(store, { type: 'MEDIA_LIST', videos: [{} as never, {} as never], currentKeys: [] });
    expect(store.get().ui.status.text).toBe('2 media found');
  });

  it('does not claim success with nothing found', () => {
    applyIncoming(store, { type: 'MEDIA_LIST', videos: [], currentKeys: [] });
    expect(store.get().ui.status).toEqual({ text: '0 media found', tone: 'info' });
  });

  it('finishes the visible refresh state when the scan result arrives', () => {
    store.setUi({ refreshing: true });
    applyIncoming(store, { type: 'MEDIA_LIST', videos: [], currentKeys: [] });
    expect(store.get().ui.refreshing).toBe(false);
  });

  // The whole point of the remote/ui split.
  it('leaves a rename and a selection in progress alone', () => {
    store.setUi({ renamingKey: RS8, selectionMode: true, selectedForDeletion: new Set([RS9]) });
    applyIncoming(store, { type: 'MEDIA_LIST', videos: [], currentKeys: [RS9] });
    expect(store.get().ui.renamingKey).toBe(RS8);
    expect(store.get().ui.selectionMode).toBe(true);
    expect(store.get().ui.selectedForDeletion.has(RS9)).toBe(true);
  });
});

describe('HISTORY_LIST', () => {
  it('replaces the list wholesale', () => {
    applyIncoming(store, { type: 'HISTORY_LIST', entries: [entry(RS9)] });
    expect(store.get().remote.history).toHaveLength(1);
    applyIncoming(store, { type: 'HISTORY_LIST', entries: [] });
    expect(store.get().remote.history).toEqual([]);
  });

  it('survives a message with nothing in it', () => {
    applyIncoming(store, { type: 'HISTORY_LIST' });
    expect(store.get().remote.history).toEqual([]);
  });
});

describe('BATCH_STATUS', () => {
  const batch = (patch = {}) =>
    ({ total: 3, completed: 0, failed: 0, remainingKeys: [RS9, RS8], currentSourceKey: RS9,
       activeSourceKeys: [RS9], concurrency: 4, cancelled: false, ...patch });

  it('tracks which video the run is on', () => {
    applyIncoming(store, { type: 'BATCH_STATUS', batch: batch() });
    expect(store.get().remote.activeDownloadKey).toBe(RS9);
    expect(store.get().remote.batch!.remainingKeys).toEqual([RS9, RS8]);
  });

  it('clears itself when the run ends', () => {
    applyIncoming(store, { type: 'BATCH_STATUS', batch: batch() });
    applyIncoming(store, { type: 'BATCH_STATUS', batch: null });
    expect(store.get().remote.batch).toBeNull();
    expect(store.get().remote.activeDownloadKey).toBeNull();
  });

  // These are separate runs; one ending must not blank the other's panel.
  it('hands the active row back to a one-off download still running', () => {
    store.setRemote({ manualDownloadKey: RS8 });
    applyIncoming(store, { type: 'BATCH_STATUS', batch: null });
    expect(store.get().remote.activeDownloadKey).toBe(RS8);
  });

  it('keeps the most recently reporting item selected while it remains active', () => {
    applyIncoming(store, { type: 'BATCH_STATUS', batch: batch({ activeSourceKeys: [RS9, RS8] }) });
    applyIncoming(store, {
      type: 'DOWNLOAD_PROGRESS', sourceKey: RS8, progress: { percent: 61 }
    });
    applyIncoming(store, { type: 'BATCH_STATUS', batch: batch({ activeSourceKeys: [RS9, RS8] }) });

    expect(store.get().remote.activeDownloadKey).toBe(RS8);
    expect(store.get().remote.progressByKey.get(RS8)?.percent).toBe(61);
  });
});

describe('a one-off download', () => {
  it('remembers its id so it can be cancelled', () => {
    applyIncoming(store, { type: 'DOWNLOAD_STARTED', success: true, downloadId: 'd1' });
    expect(store.get().remote.manualDownloadId).toBe('d1');
    expect(store.get().ui.status.text).toBe('Download started…');
  });

  it('records progress as it arrives', () => {
    applyIncoming(store, {
      type: 'DOWNLOAD_PROGRESS', sourceKey: RS9, progress: { percent: 37.6, eta: 92 }
    });
    expect(store.get().remote.progress).toEqual({ percent: 37.6, eta: 92 });
    expect(store.get().remote.progressByKey.get(RS9)).toEqual({ percent: 37.6, eta: 92 });
  });

  it('accepts progress sent flat rather than nested', () => {
    applyIncoming(store, { type: 'DOWNLOAD_PROGRESS', percent: 12, speed: 500 } as never);
    expect(store.get().remote.progress!.percent).toBe(12);
    expect(store.get().remote.progress!.speed).toBe(500);
  });

  it('frees the row and the panel when it completes', () => {
    store.setRemote({ manualDownloadKey: RS9, manualDownloadId: 'd1', activeDownloadKey: RS9,
      progress: { percent: 99 } });
    applyIncoming(store, { type: 'DOWNLOAD_COMPLETE' });
    expect(store.get().remote.manualDownloadKey).toBeNull();
    expect(store.get().remote.progress).toBeNull();
    expect(store.get().ui.status.tone).toBe('success');
  });

  it('frees the row on failure too, and says why', () => {
    store.setRemote({ manualDownloadKey: RS9, manualDownloadId: 'd1' });
    applyIncoming(store, { type: 'DOWNLOAD_ERROR', error: 'ffmpeg exited 1' });
    expect(store.get().remote.manualDownloadKey).toBeNull();
    expect(store.get().ui.error).toBe('ffmpeg exited 1');
    expect(store.get().ui.status.tone).toBe('error');
  });

  it('does not blank a running batch when a one-off download ends', () => {
    const batch = { total: 2, completed: 0, failed: 0, remainingKeys: [RS8],
      currentSourceKey: RS8, cancelled: false };
    store.setRemote({ batch, manualDownloadKey: RS9, progress: { percent: 40 } });
    applyIncoming(store, { type: 'DOWNLOAD_COMPLETE' });
    expect(store.get().remote.batch).toBe(batch);
    expect(store.get().remote.activeDownloadKey).toBe(RS8);
    expect(store.get().remote.progress).not.toBeNull();
  });
});

// The bug: opening the popup during a download left no row marked.
describe('ACTIVE_DOWNLOAD', () => {
  it('re-marks the busy row when the popup reopens', () => {
    applyIncoming(store, {
      type: 'ACTIVE_DOWNLOAD', downloadId: 'd9',
      sourceUrl: `${RS8}?token=NEW`, progress: { percent: 22 }
    });
    expect(store.get().remote.manualDownloadKey).toBe(RS8);
    expect(store.get().remote.activeDownloadKey).toBe(RS8);
    expect(store.get().remote.progress).toEqual({ percent: 22 });
  });

  it('starts from zero when no progress came with it', () => {
    applyIncoming(store, { type: 'ACTIVE_DOWNLOAD', downloadId: 'd9', sourceUrl: RS8 });
    expect(store.get().remote.progress).toEqual({ percent: 0 });
  });

  it('restores batch progress without creating a phantom manual run', () => {
    applyIncoming(store, {
      type: 'ACTIVE_DOWNLOAD', downloadId: 'd-batch', runKind: 'batch',
      sourceUrl: RS8, progress: { percent: 44 }
    });
    expect(store.get().remote.manualDownloadId).toBeNull();
    expect(store.get().remote.manualDownloadKey).toBeNull();
    expect(store.get().remote.activeDownloadKey).toBe(RS8);
    expect(store.get().remote.progressByKey.get(RS8)?.percent).toBe(44);
  });

  it('clears the marks when there turns out to be nothing running', () => {
    store.setRemote({ manualDownloadKey: RS8, manualDownloadId: 'd9' });
    applyIncoming(store, { type: 'NO_ACTIVE_DOWNLOAD' });
    expect(store.get().remote.manualDownloadKey).toBeNull();
  });
});

describe('ERROR', () => {
  it('surfaces the message and stops treating a row as busy', () => {
    store.setRemote({ manualDownloadKey: RS9 });
    applyIncoming(store, { type: 'ERROR', message: 'CoApp not running' });
    expect(store.get().ui.error).toBe('CoApp not running');
    expect(store.get().remote.manualDownloadKey).toBeNull();
  });
});
