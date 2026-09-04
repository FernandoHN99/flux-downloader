import { describe, expect, it } from 'vitest';
import type { HistoryEntry, VideoInfo } from './types';
import {
  decorateHistoryEntries,
  markHistoryDownloaded,
  markHistoryFailed,
  mergeDetectedVideosIntoHistory,
  removeHistoryEntries,
  renameHistoryTitle,
  reorderHistoryEntries,
  retainHistoryEntries,
  sameHistoryContent
} from './history';
import { domainOf, videoKey } from './video-key';

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
    expect(renameHistoryTitle(history, videoKey(two.url), 'Two')).toBe(history);
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
