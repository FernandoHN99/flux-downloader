import { describe, expect, it } from 'vitest';
import type { HistoryEntry, VideoInfo } from '../shared/types';
import {
  decorateHistoryEntries,
  dedupeHistoryEntries,
  markHistoryDownloaded,
  markHistoryFailed,
  mergeDetectedVideosIntoHistory,
  removeHistoryEntries,
  renameHistoryTitle,
  reorderHistoryEntries,
  retainHistoryEntries,
  sameHistoryContent
} from './history';
import { domainOf, videoKey } from '../detection/video-key';

const lessonUrl = 'https://app.rocketseat.com.br/jornada/react-2025/aula/testando-com-babel-repl';
const mediaUrl = 'https://vz-dc851587-83d.b-cdn.net/course/playlist.m3u8?token=new';

function video(patch: Partial<VideoInfo> = {}): VideoInfo {
  return {
    id: 'video-1',
    title: 'Testando com Babel REPL',
    url: mediaUrl,
    type: 'hls',
    qualities: [],
    ...patch
  };
}

function entry(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return { ...video(), detectedAt: 1, ...patch };
}

describe('mergeDetectedVideosIntoHistory', () => {
  it('uses the page that detected a video instead of its CDN host', () => {
    const [merged] = mergeDetectedVideosIntoHistory(
      [],
      [video({ pageUrl: lessonUrl })],
      {},
      10,
      50
    );

    expect(merged.pageUrl).toBe(lessonUrl);
    expect(domainOf(merged.pageUrl, merged.url)).toBe('app.rocketseat.com.br');
  });

  it('lets authoritative tab metadata repair an older wrong source', () => {
    const old = entry({ pageUrl: 'https://vz-dc851587-83d.b-cdn.net/' });
    const [merged] = mergeDetectedVideosIntoHistory(
      [old],
      [video()],
      { pageUrl: lessonUrl, pageTitle: 'Estruturação | React | Rocketseat' },
      10,
      50
    );

    expect(merged.pageUrl).toBe(lessonUrl);
    expect(merged.pageTitle).toBe('Estruturação | React | Rocketseat');
  });

  it('restores a current video after it was deleted from history', () => {
    const restored = mergeDetectedVideosIntoHistory([], [video()], { pageUrl: lessonUrl }, 10, 50);

    expect(restored).toHaveLength(1);
    expect(restored[0].url).toBe(mediaUrl);
  });

  it('does not persist content-script generation bookkeeping', () => {
    const detected = { ...video(), generation: 7 };
    const [merged] = mergeDetectedVideosIntoHistory([], [detected], {}, 10, 50);

    expect(merged).not.toHaveProperty('generation');
  });

  it('keeps older videos in their existing order and obeys the limit', () => {
    const older = entry({ id: 'old', url: 'https://cdn.example.com/old.mp4' });
    const oldest = entry({ id: 'oldest', url: 'https://cdn.example.com/oldest.mp4' });
    const merged = mergeDetectedVideosIntoHistory([older, oldest], [video()], {}, 10, 2);

    expect(merged.map((item) => item.id)).toEqual(['video-1', 'old']);
  });
});

describe('sameHistoryContent', () => {
  it('ignores only a refreshed detection timestamp', () => {
    expect(sameHistoryContent([entry({ detectedAt: 1 })], [entry({ detectedAt: 99 })])).toBe(true);
  });

  it('notices when the source page is learned later', () => {
    expect(sameHistoryContent(
      [entry({ pageUrl: undefined })],
      [entry({ pageUrl: lessonUrl })]
    )).toBe(false);
  });
});

describe('history list mutations', () => {
  const one = entry({ id: 'one', url: 'https://cdn.example/one.mp4', title: 'One' });
  const two = entry({ id: 'two', url: 'https://cdn.example/two.mp4', title: 'Two' });
  const three = entry({ id: 'three', url: 'https://cdn.example/three.mp4', title: 'Three' });

  it('retains only current keys and preserves a no-op snapshot', () => {
    expect(retainHistoryEntries([one, two], [videoKey(one.url)])).toEqual([one]);
    const history = [one, two];
    expect(retainHistoryEntries(history, history.map((item) => videoKey(item.url))))
      .toBe(history);
  });

  it('removes requested keys and ignores unknown or empty selections', () => {
    expect(removeHistoryEntries([one, two], [videoKey(two.url)])).toEqual([one]);
    const history = [one, two];
    expect(removeHistoryEntries(history, [])).toBe(history);
    expect(removeHistoryEntries(history, ['unknown'])).toBe(history);
  });

  it('trims a title and returns the old snapshot when nothing changes', () => {
    expect(renameHistoryTitle([one, two], videoKey(two.url), '  Renamed  ')[1].title)
      .toBe('Renamed');
    const history = [one, two];
    // Retyping the detected title still claims it as the user's, so the entry
    // is rewritten; only an already-claimed title is a true no-op.
    const claimed = renameHistoryTitle(history, videoKey(two.url), 'Two');
    expect(claimed[1].titleByUser).toBe(true);
    expect(renameHistoryTitle(claimed, videoKey(two.url), 'Two')).toBe(claimed);
    expect(renameHistoryTitle(history, videoKey(two.url), '   ')).toBe(history);
  });

  it('puts ordered visible keys first and keeps omitted entries afterward', () => {
    expect(reorderHistoryEntries(
      [one, two, three],
      [videoKey(three.url), videoKey(one.url), 'unknown', videoKey(three.url)]
    )).toEqual([three, one, two]);
  });
});

describe('history download markers', () => {
  const item = entry({ url: 'https://cdn.example/video.mp4?token=new' });
  const key = videoKey(item.url);

  it('decorates entries from stable downloaded and failed keys', () => {
    expect(decorateHistoryEntries([item], [key], [key])[0]).toMatchObject({
      downloaded: true,
      failed: true
    });
    expect(decorateHistoryEntries([item], [], [])[0]).toMatchObject({
      downloaded: false,
      failed: false
    });
  });

  it('adds a successful key once and clears its previous failure', () => {
    expect(markHistoryDownloaded({ downloaded: [], failed: [key, 'other'] }, key, 500))
      .toEqual({ downloaded: [key], failed: ['other'] });
    const markers = { downloaded: [key], failed: [] };
    expect(markHistoryDownloaded(markers, key, 500)).toBe(markers);
  });

  it('prepends failed keys once and enforces the marker limit', () => {
    expect(markHistoryFailed({ downloaded: [], failed: ['old'] }, key, 1))
      .toEqual({ downloaded: [], failed: [key] });
    const markers = { downloaded: [], failed: [key] };
    expect(markHistoryFailed(markers, key, 10)).toBe(markers);
  });
});

describe('duplicate rows', () => {
  it('emits one row when detection reports the same video twice in one batch', () => {
    const next = mergeDetectedVideosIntoHistory(
      [],
      [
        video({ url: 'https://cdn.test/lesson.m3u8?token=aaa', title: 'Lesson' }),
        video({ url: 'https://cdn.test/lesson.m3u8?token=bbb', title: 'Lesson' })
      ],
      {},
      1_000,
      50
    );

    expect(next).toHaveLength(1);
  });

  it('fills gaps in the first sighting from the second instead of adding a row', () => {
    const next = mergeDetectedVideosIntoHistory(
      [],
      [
        video({ url: 'https://cdn.test/lesson.m3u8?token=aaa', title: 'Lesson', duration: undefined }),
        video({ url: 'https://cdn.test/lesson.m3u8?token=bbb', title: 'Lesson', duration: 300 })
      ],
      {},
      1_000,
      50
    );

    expect(next).toHaveLength(1);
    expect(next[0].duration).toBe(300);
  });

  it('does not merge two different videos that share a page', () => {
    const next = mergeDetectedVideosIntoHistory(
      [],
      [
        video({ url: 'https://cdn.test/one.m3u8' }),
        video({ url: 'https://cdn.test/two.m3u8' })
      ],
      {},
      1_000,
      50
    );

    expect(next).toHaveLength(2);
  });
});

describe('dedupeHistoryEntries', () => {
  function entry(url: string, patch: Partial<HistoryEntry> = {}): HistoryEntry {
    return { ...video({ url }), detectedAt: 1_000, ...patch };
  }

  it('collapses rows a previous build persisted for the same video', () => {
    const next = dedupeHistoryEntries([
      entry('https://cdn.test/lesson.m3u8?token=aaa'),
      entry('https://cdn.test/lesson.m3u8?token=bbb')
    ]);

    expect(next).toHaveLength(1);
  });

  it('keeps the first row position and fills its gaps from the later one', () => {
    const next = dedupeHistoryEntries([
      entry('https://cdn.test/a.m3u8?token=aaa', { title: 'First', duration: undefined }),
      entry('https://cdn.test/a.m3u8?token=bbb', { title: 'Second', duration: 42 })
    ]);

    expect(next[0].title).toBe('First');
    expect(next[0].duration).toBe(42);
  });

  it('returns the same array when the list is already clean', () => {
    const clean = [entry('https://cdn.test/a.m3u8'), entry('https://cdn.test/b.m3u8')];

    expect(dedupeHistoryEntries(clean)).toBe(clean);
  });
});

describe('a user-given name survives re-detection', () => {
  const url = 'https://cdn.test/lesson.m3u8?token=aaa';

  it('keeps the typed title when the video is detected again', () => {
    const named = renameHistoryTitle([entry({ url })], videoKey(url), 'My lesson');

    const [merged] = mergeDetectedVideosIntoHistory(
      named,
      [video({ url: 'https://cdn.test/lesson.m3u8?token=bbb', title: 'playlist' })],
      { pageTitle: 'Some tab title' },
      2_000,
      50
    );

    expect(merged.title).toBe('My lesson');
    expect(merged.titleByUser).toBe(true);
  });

  it('keeps the row in place instead of moving it back to the top', () => {
    const first = entry({ url: 'https://cdn.test/a.m3u8', id: 'a' });
    const second = entry({ url: 'https://cdn.test/b.m3u8', id: 'b' });

    const merged = mergeDetectedVideosIntoHistory(
      [first, second],
      [video({ url: 'https://cdn.test/b.m3u8' })],
      {},
      2_000,
      50
    );

    expect(merged.map((item) => item.url)).toEqual([first.url, second.url]);
  });

  it('still puts a genuinely new detection first', () => {
    const known = entry({ url: 'https://cdn.test/a.m3u8' });

    const merged = mergeDetectedVideosIntoHistory(
      [known],
      [video({ url: 'https://cdn.test/new.m3u8' })],
      {},
      2_000,
      50
    );

    expect(merged.map((item) => item.url)).toEqual(['https://cdn.test/new.m3u8', known.url]);
  });

  it('still adopts a detected title when the user never set one', () => {
    const [merged] = mergeDetectedVideosIntoHistory(
      [entry({ url, title: 'playlist' })],
      [video({ url, title: 'Real lesson name' })],
      {},
      2_000,
      50
    );

    expect(merged.title).toBe('Real lesson name');
  });
});
