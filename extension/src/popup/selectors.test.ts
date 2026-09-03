import { describe, it, expect } from 'vitest';
import type { HistoryEntry } from '../lib/types';
import { initialState, type AppState } from './state';
import {
  busyLabel, canReorder, downloadInProgress, groupByDomain,
  isDownloading, orderedEntries, progressView, visibleEntries
} from './selectors';

const entry = (title: string, url: string, pageUrl?: string): HistoryEntry =>
  ({ id: title, title, url, pageUrl, type: 'hls', qualities: [], detectedAt: 0 }) as HistoryEntry;

const RS9 = 'https://cdn.rocketseat.com/l9/ep12.m3u8';
const RS8 = 'https://cdn.rocketseat.com/l8/aula08.m3u8';
const YT = 'https://youtube.com/watch';
const UDEMY = 'https://cdn.udemy.com/design.mp4';

function stateWith(patch: Partial<AppState['remote']> = {}, ui: Partial<AppState['ui']> = {}): AppState {
  const base = initialState();
  return { remote: { ...base.remote, ...patch }, ui: { ...base.ui, ...ui } };
}

describe('orderedEntries', () => {
  it('pins the videos playing right now above the rest', () => {
    const state = stateWith({
      history: [entry('old', RS8), entry('playing', RS9), entry('older', UDEMY)],
      currentKeys: new Set([RS9])
    });
    expect(orderedEntries(state).map((e) => e.title)).toEqual(['playing', 'old', 'older']);
  });

  it('matches a current video whose signed token has rotated', () => {
    const state = stateWith({
      history: [entry('same video', `${RS9}?token=OLD`)],
      currentKeys: new Set([RS9])
    });
    expect(orderedEntries(state)[0].title).toBe('same video');
    expect(visibleEntries(state)).toHaveLength(1);
  });

  it('keeps the stored order among the rest', () => {
    const state = stateWith({ history: [entry('a', RS8), entry('b', UDEMY), entry('c', YT)] });
    expect(orderedEntries(state).map((e) => e.title)).toEqual(['a', 'b', 'c']);
  });
});

describe('visibleEntries', () => {
  it('filters on the title, case-insensitively', () => {
    const state = stateWith({ history: [entry('Aula de React', RS8), entry('Deep House', YT)] },
      { search: 'react' });
    expect(visibleEntries(state).map((e) => e.title)).toEqual(['Aula de React']);
  });

  it('shows everything when the box is empty', () => {
    const state = stateWith({ history: [entry('a', RS8), entry('b', YT)] });
    expect(visibleEntries(state)).toHaveLength(2);
  });
});

describe('groupByDomain', () => {
  it('buckets by the page the video was found on', () => {
    const groups = groupByDomain([
      entry('a', RS9, 'https://app.rocketseat.com.br/aula-9'),
      entry('b', YT, 'https://www.youtube.com/watch?v=1'),
      entry('c', RS8, 'https://app.rocketseat.com.br/aula-8')
    ]);
    expect([...groups.keys()]).toEqual(['app.rocketseat.com.br', 'youtube.com']);
    expect(groups.get('app.rocketseat.com.br')!.map((e) => e.title)).toEqual(['a', 'c']);
  });

  it('falls back to the media host when the page is unknown', () => {
    const groups = groupByDomain([entry('a', UDEMY)]);
    expect([...groups.keys()]).toEqual(['cdn.udemy.com']);
  });
});

describe('download gating', () => {
  it('reports a one-off download as in progress', () => {
    expect(downloadInProgress(stateWith({ manualDownloadKey: RS9 }))).toBe(true);
  });

  it('reports a batch as in progress while anything is queued', () => {
    const batch = { total: 2, completed: 0, failed: 0, remainingKeys: [RS9], cancelled: false };
    expect(downloadInProgress(stateWith({ batch }))).toBe(true);
  });

  it('is idle once the queue empties', () => {
    const batch = { total: 2, completed: 2, failed: 0, remainingKeys: [], cancelled: false };
    expect(downloadInProgress(stateWith({ batch }))).toBe(false);
  });

  it('marks every queued video as busy, not just the active one', () => {
    const batch = { total: 2, completed: 0, failed: 0, remainingKeys: [RS9, RS8], cancelled: false };
    const state = stateWith({ batch, activeDownloadKey: RS9 });
    expect(isDownloading(state, RS9)).toBe(true);
    expect(isDownloading(state, RS8)).toBe(true);
    expect(isDownloading(state, UDEMY)).toBe(false);
  });
});

describe('busyLabel', () => {
  it('gives a percentage only to the video actually being written', () => {
    const state = stateWith({ activeDownloadKey: RS9, progress: { percent: 37.6 } });
    expect(busyLabel(state, RS9)).toBe('Downloading… 38%');
    expect(busyLabel(state, RS8)).toBe('Queued');
  });

  it('omits the percentage until there is one', () => {
    const state = stateWith({ activeDownloadKey: RS9, progress: { percent: 0 } });
    expect(busyLabel(state, RS9)).toBe('Downloading…');
  });
});

describe('progressView', () => {
  it('counts the video being fetched, so a run of five opens at 1 / 5', () => {
    const batch = { total: 5, completed: 0, failed: 0, remainingKeys: [], cancelled: false };
    expect(progressView(stateWith({ batch }))).toEqual({ current: 1, total: 5, kind: 'batch' });
  });

  it('advances as videos finish, counting failures too', () => {
    const batch = { total: 5, completed: 2, failed: 1, remainingKeys: [], cancelled: false };
    expect(progressView(stateWith({ batch }))!.current).toBe(4);
  });

  it('never counts past the total on the last video', () => {
    const batch = { total: 3, completed: 3, failed: 0, remainingKeys: [], cancelled: false };
    expect(progressView(stateWith({ batch }))!.current).toBe(3);
  });

  it('shows a one-off download as 1 / 1', () => {
    expect(progressView(stateWith({ manualDownloadKey: RS9 })))
      .toEqual({ current: 1, total: 1, kind: 'single' });
  });

  it('shows nothing when idle', () => {
    expect(progressView(stateWith())).toBeNull();
  });
});

describe('canReorder', () => {
  it('excludes the pinned current videos', () => {
    const state = stateWith({ currentKeys: new Set([RS9]) });
    expect(canReorder(state, RS9)).toBe(false);
    expect(canReorder(state, RS8)).toBe(true);
  });

  it('holds a row still while it is being written', () => {
    const batch = { total: 1, completed: 0, failed: 0, remainingKeys: [RS8], cancelled: false };
    expect(canReorder(stateWith({ batch }), RS8)).toBe(false);
  });

  it('stops entirely while rows are being picked for deletion', () => {
    expect(canReorder(stateWith({}, { selectionMode: true }), RS8)).toBe(false);
  });
});
