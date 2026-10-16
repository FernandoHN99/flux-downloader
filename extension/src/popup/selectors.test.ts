import { describe, it, expect } from 'vitest';
import type { HistoryEntry } from '../shared/types';
import { initialState, type AppState } from './state';
import {
  busyLabel, canMoveToFolder, canReorder, displayOrder, downloadInProgress, groupByDomain, inStoredOrder,
  isDownloading, keysBetween, splitByFolder, unfiledEntries, orderedEntries, progressDetail,
  progressView, visibleEntries
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

  it('stays blocked until the background retires the batch object', () => {
    const batch = { total: 2, completed: 2, failed: 0, remainingKeys: [], cancelled: false };
    expect(downloadInProgress(stateWith({ batch }))).toBe(true);
    expect(downloadInProgress(stateWith({ batch: null }))).toBe(false);
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
    const state = stateWith({
      manualDownloadKey: RS9,
      activeDownloadKey: RS9,
      progress: { percent: 37.6 }
    });
    expect(busyLabel(state, RS9)).toBe('Downloading… 38%');
    expect(busyLabel(state, RS8)).toBe('Queued');
  });

  it('omits the percentage until there is one', () => {
    const state = stateWith({ manualDownloadKey: RS9, activeDownloadKey: RS9, progress: { percent: 0 } });
    expect(busyLabel(state, RS9)).toBe('Downloading…');
  });

  it('shows independent progress for every active batch row', () => {
    const batch = {
      total: 3, completed: 0, failed: 0, remainingKeys: [RS9, RS8, UDEMY],
      activeSourceKeys: [RS9, RS8], cancelled: false
    };
    const state = stateWith({
      batch,
      progressByKey: new Map([[RS9, { percent: 22 }], [RS8, { percent: 67 }]])
    });
    expect(busyLabel(state, RS9)).toBe('Downloading… 22%');
    expect(busyLabel(state, RS8)).toBe('Downloading… 67%');
    expect(busyLabel(state, UDEMY)).toBe('Queued');
  });
});

describe('progressView', () => {
  it('reports settled and active counts for a concurrent batch', () => {
    const batch = {
      total: 5, completed: 0, failed: 0, remainingKeys: [RS9, RS8],
      activeSourceKeys: [RS9, RS8], concurrency: 4, cancelled: false
    };
    expect(progressView(stateWith({ batch }))).toEqual({
      current: 0, total: 5, kind: 'batch', active: 2, concurrency: 4
    });
  });

  it('advances as videos finish, counting failures too', () => {
    const batch = { total: 5, completed: 2, failed: 1, remainingKeys: [], cancelled: false };
    expect(progressView(stateWith({ batch }))!.current).toBe(3);
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

  it('aggregates completed and fractional active item progress', () => {
    const batch = {
      total: 4, completed: 1, failed: 0, remainingKeys: [RS9, RS8, UDEMY],
      activeSourceKeys: [RS9, RS8], cancelled: false
    };
    const detail = progressDetail(stateWith({
      batch,
      progressByKey: new Map([[RS9, { percent: 50 }], [RS8, { percent: 25 }]])
    }));
    expect(detail?.percent).toBe(43.75);
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

describe('orderedEntries never shows one video twice', () => {
  const signed = (token: string) => `https://cdn.rocketseat.com/l9/ep12.m3u8?token=${token}`;

  it('renders one row when two history entries are the same signed video', () => {
    const state = stateWith({
      history: [entry('Lesson', signed('aaa')), entry('Lesson', signed('bbb'))]
    });

    expect(orderedEntries(state)).toHaveLength(1);
  });

  it('pins the single surviving row when that video is playing now', () => {
    const state = stateWith({
      history: [entry('older', UDEMY), entry('Lesson', signed('aaa')), entry('Lesson', signed('bbb'))],
      currentKeys: new Set([RS9])
    });

    const rows = orderedEntries(state);
    expect(rows.map((e) => e.title)).toEqual(['Lesson', 'older']);
  });

  it('hides a variant row once the master playlist that owns it is listed', () => {
    const master = {
      ...entry('Lesson', RS9),
      childUrls: [RS8]
    } as HistoryEntry;
    const state = stateWith({ history: [master, entry('variant 720p', RS8)] });

    expect(orderedEntries(state).map((e) => e.title)).toEqual(['Lesson']);
  });

  it('hides a variant listed as one of the master qualities', () => {
    const master = {
      ...entry('Lesson', RS9),
      qualities: [{ url: RS8, height: 720, bitrate: 720_000 }]
    } as HistoryEntry;
    const state = stateWith({ history: [master, entry('variant', RS8)] });

    expect(orderedEntries(state)).toHaveLength(1);
  });

  it('keeps an entry that lists its own url among its qualities', () => {
    const single = {
      ...entry('Lesson', RS9),
      qualities: [{ url: RS9, height: 1080, bitrate: 1_000_000 }]
    } as HistoryEntry;
    const state = stateWith({ history: [single] });

    expect(orderedEntries(state)).toHaveLength(1);
  });

  it('leaves genuinely different videos alone', () => {
    const state = stateWith({ history: [entry('a', RS9), entry('b', RS8), entry('c', UDEMY)] });

    expect(orderedEntries(state)).toHaveLength(3);
  });
});

describe('orderedEntries shows a playable rendition, not its capture twin', () => {
  const page = 'https://portal.example/lessons?id=1';
  const master = {
    ...entry('Lesson', 'https://player.example/abc/playlist.m3u8'),
    pageUrl: page,
    qualities: [{ url: 'https://player.example/abc/360p/video.m3u8', height: 360, bitrate: 1 }]
  } as HistoryEntry;
  const capture = {
    ...entry('Lesson', 'blob:https://portal.example/cb28'),
    type: 'mse',
    pageUrl: page
  } as HistoryEntry;

  it('hides the MSE capture when an HLS master with qualities came from the same page', () => {
    const state = stateWith({ history: [master, capture] });

    expect(orderedEntries(state).map((e) => e.url)).toEqual([master.url]);
  });

  it('keeps the MSE capture when the master has no qualities yet', () => {
    const bare = { ...master, qualities: [] } as HistoryEntry;
    const state = stateWith({ history: [bare, capture] });

    expect(orderedEntries(state)).toHaveLength(2);
  });

  it('keeps the MSE capture when the other row came from a different page', () => {
    const elsewhere = { ...master, pageUrl: 'https://portal.example/lessons?id=2' } as HistoryEntry;
    const state = stateWith({ history: [elsewhere, capture] });

    expect(orderedEntries(state)).toHaveLength(2);
  });
});

describe('canMoveToFolder', () => {
  it('lets an idle history row be filed', () => {
    expect(canMoveToFolder(stateWith({ history: [entry('a', RS8)] }), RS8)).toBe(true);
  });

  it('lets the video playing now be filed too', () => {
    expect(canMoveToFolder(stateWith({ currentKeys: new Set([RS9]) }), RS9)).toBe(true);
  });

  it('blocks a row that is being downloaded and the whole list while picking rows', () => {
    expect(canMoveToFolder(stateWith({ manualDownloadKey: RS8 }), RS8)).toBe(false);
    expect(canMoveToFolder(stateWith({}, { selectionMode: true }), RS8)).toBe(false);
  });
});

describe('splitByFolder', () => {
  const folders = [{ id: 'f1', name: 'Aulas' }, { id: 'f2', name: 'Cursos' }];
  const filed = (title: string, url: string, folderId: string): HistoryEntry =>
    ({ ...entry(title, url), folderId });

  it('puts each video under its folder and leaves the rest unfiled, keeping order', () => {
    const split = splitByFolder(
      [filed('a', RS8, 'f1'), entry('loose', YT), filed('b', UDEMY, 'f1'), filed('c', RS9, 'f2')],
      folders
    );

    expect(split.sections.map((s) => [s.folder.name, s.entries.map((e) => e.title)]))
      .toEqual([['Aulas', ['a', 'b']], ['Cursos', ['c']]]);
    expect(split.unfiled.map((e) => e.title)).toEqual(['loose']);
  });

  it('lists an empty folder so it can be dropped into', () => {
    expect(splitByFolder([], folders).sections).toHaveLength(2);
  });

  it('hides folders without a match while searching', () => {
    const split = splitByFolder([filed('a', RS8, 'f1')], folders, true);

    expect(split.sections.map((s) => s.folder.id)).toEqual(['f1']);
  });

  it('treats a video pointing at a vanished folder as unfiled', () => {
    const split = splitByFolder([filed('a', RS8, 'gone')], folders);

    expect(split.unfiled).toHaveLength(1);
  });
});

describe('unfiledEntries', () => {
  const folders = [{ id: 'f1', name: 'Aulas' }];

  it('lists the videos that are in no folder, the playing one included', () => {
    const state = stateWith({
      folders,
      history: [{ ...entry('filed', RS8), folderId: 'f1' } as HistoryEntry, entry('loose', UDEMY), entry('playing', RS9)],
      currentKeys: new Set([RS9])
    });

    expect(unfiledEntries(state).map((e) => e.title)).toEqual(['playing', 'loose']);
  });

  it('ignores the search: "all of them" means all of them', () => {
    const state = stateWith(
      { folders, history: [entry('alpha', RS8), entry('beta', UDEMY)] },
      { search: 'alpha' }
    );

    expect(unfiledEntries(state)).toHaveLength(2);
  });

  it('counts a video whose folder no longer exists as unfiled', () => {
    const state = stateWith({
      folders, history: [{ ...entry('orphan', RS8), folderId: 'gone' } as HistoryEntry]
    });

    expect(unfiledEntries(state)).toHaveLength(1);
  });
});

describe('displayOrder', () => {
  const folders = [{ id: 'f1', name: 'Aulas' }];
  const filed = (title: string, url: string) => ({ ...entry(title, url), folderId: 'f1' }) as HistoryEntry;
  const A = 'https://cdn.example/a.m3u8';
  const B = 'https://cdn.example/b.m3u8';
  const C = 'https://cdn.example/c.m3u8';

  it('lists a flat list in the order it is shown', () => {
    const state = stateWith({ history: [entry('a', A), entry('b', B), entry('c', C)] });
    expect(displayOrder(state)).toEqual([A, B, C]);
  });

  it('puts the folders first, as the list draws them', () => {
    const state = stateWith({ folders, history: [entry('a', A), filed('b', B), entry('c', C)] });
    expect(displayOrder(state)).toEqual([B, A, C]);
  });

  it('leaves out the rows of a collapsed folder, which are not on screen', () => {
    const state = stateWith(
      { folders, history: [entry('a', A), filed('b', B)] },
      { collapsedFolders: new Set(['f1']) }
    );
    expect(displayOrder(state)).toEqual([A]);
  });

  it('follows the site groups when grouped, and skips a collapsed site', () => {
    const history = [
      entry('a', A, 'https://one.example/1'),
      entry('b', B, 'https://two.example/1'),
      entry('c', C, 'https://one.example/2')
    ];
    expect(displayOrder(stateWith({ history }, { groupByDomain: true }))).toEqual([A, C, B]);
    expect(displayOrder(stateWith({ history }, { groupByDomain: true, collapsedGroups: new Set(['one.example']) })))
      .toEqual([B]);
  });

  it('keeps only what the search leaves on screen', () => {
    const state = stateWith({ history: [entry('alpha', A), entry('beta', B)] }, { search: 'bet' });
    expect(displayOrder(state)).toEqual([B]);
  });
});

describe('keysBetween', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('spans both ends, in either direction', () => {
    expect(keysBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(keysBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('is just the one row when both ends are the same', () => {
    expect(keysBetween(order, 'c', 'c')).toEqual(['c']);
  });

  it('falls back to the target alone when the anchor is not on screen', () => {
    expect(keysBetween(order, 'gone', 'c')).toEqual(['c']);
  });
});

describe('inStoredOrder', () => {
  const A = 'https://cdn.example/a.m3u8';
  const B = 'https://cdn.example/b.m3u8';
  const C = 'https://cdn.example/c.m3u8';

  it('puts videos in the order the history stores them, newest first', () => {
    const state = stateWith({ history: [entry('a', A), entry('b', B), entry('c', C)] });

    expect(inStoredOrder(state, [entry('c', C), entry('a', A), entry('b', B)]).map((e) => e.title))
      .toEqual(['a', 'b', 'c']);
  });

  it('ignores what the screen pins: the video playing now keeps its place in the history', () => {
    const state = stateWith({
      history: [entry('new', A), entry('mid', B), entry('old', C)],
      currentKeys: new Set([C])
    });
    const onScreen = visibleEntries(state);

    expect(onScreen.map((e) => e.title)).toEqual(['old', 'new', 'mid']);
    expect(inStoredOrder(state, onScreen).map((e) => e.title)).toEqual(['new', 'mid', 'old']);
  });

  it('matches a video whose signed link has rotated, and puts unknown ones last', () => {
    const state = stateWith({ history: [entry('a', A), entry('b', B)] });

    const ordered = inStoredOrder(state, [entry('stranger', C), entry('b', `${B}?token=new`), entry('a', A)]);

    expect(ordered.map((e) => e.title)).toEqual(['a', 'b', 'stranger']);
  });

  it('does not change the list it was given', () => {
    const state = stateWith({ history: [entry('a', A), entry('b', B)] });
    const given = [entry('b', B), entry('a', A)];

    inStoredOrder(state, given);

    expect(given.map((e) => e.title)).toEqual(['b', 'a']);
  });
});
